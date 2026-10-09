import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { waitUnlessThreatened } from '../lib/threat';
import { findSkill } from '../lib/util';

/**
 * Every rock is named "Rocks" and a mined-out rock is still named "Rocks" with a Mine option
 * (plainrock1/2, ids 450/452), so rock types are told apart by loc id only. Ids from
 * server/content/pack/loc.pack, levels from skill_mining/configs/mine.dbrow.
 * The four ids per type are rock1, rock2 and the macro_ variants of both.
 */
const ROCK_NAMES = [
    'clay',
    'copper',
    'tin',
    'iron',
    'silver',
    'coal',
    'gold',
    'mithril',
    'adamantite',
    'runite',
] as const;
type RockName = (typeof ROCK_NAMES)[number];

/** respawnTicks is rock_respawnrate from mine.dbrow (game ticks). */
const ROCKS = {
    clay: { level: 1, respawnTicks: 6, ore: 'Clay', ids: [2108, 2109, 2137, 2138] },
    copper: { level: 1, respawnTicks: 10, ore: 'Copper ore', ids: [2090, 2091, 2119, 2120] },
    tin: { level: 1, respawnTicks: 10, ore: 'Tin ore', ids: [2094, 2095, 2123, 2124] },
    iron: { level: 15, respawnTicks: 20, ore: 'Iron ore', ids: [2092, 2093, 2121, 2122] },
    silver: { level: 20, respawnTicks: 200, ore: 'Silver ore', ids: [2100, 2101, 2129, 2130] },
    coal: { level: 30, respawnTicks: 100, ore: 'Coal', ids: [2096, 2097, 2125, 2126] },
    gold: { level: 40, respawnTicks: 200, ore: 'Gold ore', ids: [2098, 2099, 2127, 2128] },
    mithril: { level: 55, respawnTicks: 400, ore: 'Mithril ore', ids: [2102, 2103, 2131, 2132] },
    adamantite: { level: 70, respawnTicks: 800, ore: 'Adamantite ore', ids: [2104, 2105, 2133, 2134] },
    runite: { level: 85, respawnTicks: 2400, ore: 'Runite ore', ids: [2106, 2107, 2135, 2136] },
} as const satisfies Record<RockName, { level: number; respawnTicks: number; ore: string; ids: readonly number[] }>;

/** Pickaxe levelrequire from skill_mining/configs/pickaxes.obj (pickaxe_checker.rs2 ignores a pickaxe below it). */
const PICKAXE_LEVELS: Record<string, number> = {
    bronze: 1,
    iron: 1,
    steel: 6,
    mithril: 21,
    adamant: 31,
    rune: 41,
};

const PICKAXE = /^(\w+) pickaxe$/i;

/** Mining level a pickaxe needs; an unknown pickaxe tier counts as unusable (Infinity). */
function pickaxeLevel(name: string): number {
    return PICKAXE_LEVELS[PICKAXE.exec(name)?.[1]?.toLowerCase() ?? ''] ?? Infinity;
}

/** The longest a mining attempt is awaited (ore gained or rock gone) before it counts as failed. */
const MINE_WAIT_MS = 30_000;
/** One wait for a respawn; it ends early when a rock appears or the bot is threatened. */
const RESPAWN_WAIT_MS = 5_000;
/** Live-server tick length; the local server's 400 ms ticks only make respawns faster than assumed. */
const TICK_MS = 600;
/** Minimum no-rock wait before failing, and the margin added to the slowest listed rock's respawn. */
const MIN_GIVE_UP_MS = 120_000;
const GIVE_UP_MARGIN_MS = 30_000;
/** Runite respawns in ~24 min, longer than the progress watchdog can be stretched to, so it is refused. */
const REFUSED_ROCKS: readonly RockName[] = ['runite'];
/** How long the no-rock wait lasts for a rock that respawns in `ticks`. */
const giveUpMsFor = (ticks: number) => Math.max(MIN_GIVE_UP_MS, ticks * TICK_MS + GIVE_UP_MARGIN_MS);
const STUCK_SLACK_MS = 30_000;
/** Give-up of the slowest accepted rock (adamantite) plus slack: stuckAfterMs is static, so a full respawn wait is not reported as a stall. */
const STUCK_AFTER_MS = giveUpMsFor(ROCKS.adamantite.respawnTicks) + STUCK_SLACK_MS;
/** Consecutive failed attempts before the task fails. */
const MINE_FAIL_LIMIT = 8;
/** Ticks one combat episode may last while the bot only waits for auto-retaliate to win it. */
const COMBAT_TICK_LIMIT = 40;
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    /** Required. One rock type or a list; the nearest minable rock of any listed type is mined. */
    rock: z.union([z.enum(ROCK_NAMES), z.array(z.enum(ROCK_NAMES)).min(1)]),
    /** Stay near here; walk back when further than `radius`. Omit to mine wherever the bot is. */
    area: AreaSchema.optional(),
    /** What to do when the inventory is full: drop the ores and keep mining, or end the run holding them. */
    onFull: z.enum(['drop', 'stop']).default('drop'),
});

type MiningParams = z.infer<typeof Params>;
type Ctx = TaskContext<MiningParams>;

interface Derived {
    rocks: RockName[];
    oreNames: string[];
    oreSet: Set<string>;
    ids: Set<number>;
    giveUpMs: number;
}

const derivedCache = new WeakMap<MiningParams, Derived>();
/** Everything derived from the params, computed once per run (it is read on every state tick). */
function derive(params: MiningParams): Derived {
    let d = derivedCache.get(params);
    if (!d) {
        const rocks = [...new Set(Array.isArray(params.rock) ? params.rock : [params.rock])];
        const oreNames = rocks.map(r => ROCKS[r].ore);
        const slowest = Math.max(...rocks.map(r => ROCKS[r].respawnTicks));
        d = {
            rocks,
            oreNames,
            oreSet: new Set(oreNames.map(n => n.toLowerCase())),
            ids: new Set(rocks.flatMap(r => ROCKS[r].ids)),
            giveUpMs: giveUpMsFor(slowest),
        };
        derivedCache.set(params, d);
    }
    return d;
}

const isOre = (params: MiningParams, name: string) => derive(params).oreSet.has(name.toLowerCase());

const countOres = (state: BotWorldState, params: MiningParams) =>
    state.inventory.filter(i => isOre(params, i.name)).reduce((n, i) => n + i.count, 0);

type MineOutcome = { kind: 'mined' } | { kind: 'threatened' } | { kind: 'failed'; message: string };

/**
 * Interact with the rock, then wait for ore or for the rock to change. Returns at once when
 * the bot is hurt or in combat so the low-HP interrupt runs before the next attempt.
 * Success needs ore gained: a rock mined out by someone else is a failed attempt.
 */
async function mineRock(ctx: Ctx, rock: NearbyLoc): Promise<MineOutcome> {
    await ctx.bot.dismissBlockingUI();
    const before = countOres(ctx.state(), ctx.params);
    // Raw send: bot.* has no mining porcelain (only chopTree etc.); success is judged by ore gained below.
    const sent = await ctx.sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
    if (!sent.success) return { kind: 'failed', message: sent.message };
    const rockGone = (s: BotWorldState) =>
        !s.nearbyLocs.some(l => l.x === rock.x && l.z === rock.z && l.id === rock.id);
    const waited = await waitUnlessThreatened(
        ctx.sdk,
        s => countOres(s, ctx.params) > before || rockGone(s),
        MINE_WAIT_MS,
    );
    if (waited.kind === 'timeout') return { kind: 'failed', message: 'timed out waiting for ore from rock' };
    if (waited.kind === 'threatened') return { kind: 'threatened' };
    if (countOres(waited.state, ctx.params) <= before)
        return { kind: 'failed', message: `rock at (${rock.x},${rock.z}) was mined out by someone else` };
    return { kind: 'mined' };
}

type StepResult = { fail: string } | undefined;

/**
 * Interacting with a rock cancels auto-retaliate, so a bot under attack must not touch one.
 * Waits a tick while in combat (undefined: end the step), fails if it cannot win; 'clear' otherwise.
 */
async function waitOutCombat(ctx: Ctx): Promise<StepResult | 'clear'> {
    const state = ctx.state();
    const p = state.player;
    if (p?.combat.inCombat) {
        const at = `(${p.worldX},${p.worldZ})`;
        if (state.autoRetaliateEnabled === false) return { fail: `attacked with auto-retaliate off at ${at}` };
        if (ctx.counter('combatTicks').add() > COMBAT_TICK_LIMIT)
            return { fail: `under attack for ${COMBAT_TICK_LIMIT} ticks at ${at}` };
        await ctx.sdk.waitForTicks(1);
        return undefined;
    }
    ctx.counter('combatTicks').reset();
    return 'clear';
}

/** No minable rock: mined-out rocks count as none, so stay put (returnToAreaStep keeps us inside) and wait, until the give-up. */
async function waitForRespawn(ctx: Ctx, d: Derived, isMinable: (r: NearbyLoc) => boolean): Promise<StepResult> {
    const a = ctx.params.area;
    const label = d.rocks.join('/');
    const stored = ctx.memory.noRockSince;
    const since = typeof stored === 'number' ? stored : Date.now();
    if (typeof stored !== 'number') {
        ctx.memory.noRockSince = since;
        ctx.log(`no ${label} rock available, waiting for a respawn`);
    }
    const waited = Date.now() - since;
    if (waited >= d.giveUpMs) {
        const waitedSeconds = Math.round(waited / 1000);
        return {
            fail: a
                ? `area depleted: no reachable ${label} rock in radius ${a.radius} for ${waitedSeconds}s`
                : `no reachable ${label} rock nearby for ${waitedSeconds}s`,
        };
    }
    await waitUnlessThreatened(ctx.sdk, s => s.nearbyLocs.some(isMinable), RESPAWN_WAIT_MS);
    return undefined;
}

export default defineTask({
    name: 'mining',
    description:
        'Mine one or more rock types (`rock`, required: clay, copper, tin, iron, silver, coal, gold, mithril, adamantite, or a list; ' +
        'runite is refused, its ~24 min respawn outlasts the progress watchdog); the nearest minable rock of any listed type is mined. ' +
        'When the inventory is full, `onFull` "drop" (default) drops the ores and keeps mining (for cheap ores; use "stop" for valuable ones), ' +
        '"stop" ends the run done ("inventory full: N ores") holding them, e.g. to smelt. Ores held before the run count toward the full load, ' +
        'and "drop" discards all held ore of the listed types, not only what the run mined. Needs a pickaxe ' +
        "(inventory or worn, usable at the base Mining level; Bob's Brilliant Axes in Lumbridge sells a bronze one) and the level for every listed rock. " +
        'When every listed rock in reach is mined out it waits for respawns, up to max(2 min, slowest listed rock respawn + 30 s) ' +
        '(mithril ~4.5 min, adamantite ~8.5 min), then fails: with `area` "area depleted: no reachable <rock> rock in radius N for Ns", ' +
        'without it "no reachable <rock> rock nearby for Ns". With `area` it stays within `radius` of that centre; without it, it mines ' +
        'wherever the bot stands. Verified spot: SE Varrock mine (3285,3365; copper, tin). Refuses areas reaching the Wilderness.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const d = derive(ctx.params);
        const refused = d.rocks.find(r => REFUSED_ROCKS.includes(r));
        if (refused) return `${refused} respawns too slowly for this task's progress watchdog`;
        const pickaxes = [...s.inventory, ...s.equipment].map(i => i.name).filter(n => PICKAXE.test(n));
        if (pickaxes.length === 0) return 'no pickaxe in inventory or equipped';
        const skill = findSkill(s, 'Mining');
        if (!skill) return 'no Mining skill in state';
        const usable = pickaxes.some(n => skill.baseLevel >= pickaxeLevel(n));
        if (!usable) return `no usable pickaxe at mining ${skill.baseLevel}: found ${pickaxes.join(', ')}`;
        for (const r of d.rocks)
            if (skill.baseLevel < ROCKS[r].level)
                return `${r} needs mining ${ROCKS[r].level}, bot has ${skill.baseLevel}`;
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'stop-full',
            when: ctx => ctx.params.onFull === 'stop' && ctx.inventoryFull(),
            async run(ctx) {
                const ores = countOres(ctx.state(), ctx.params);
                if (ores === 0) return { fail: `inventory full with no ${derive(ctx.params).oreNames.join('/')}` };
                return { done: `inventory full: ${ores} ores` };
            },
        },
        {
            name: 'drop-ores',
            when: ctx => ctx.params.onFull === 'drop' && ctx.inventoryFull(),
            async run(ctx) {
                // One drop per distinct ore item; a "not found" means it already left the inventory.
                const ores = new Map(
                    ctx
                        .state()
                        .inventory.filter(i => isOre(ctx.params, i.name))
                        .map(i => [i.id, i]),
                );
                const failures: string[] = [];
                for (const item of ores.values()) {
                    const r = await ctx.bot.dropItem(item, 'all');
                    if (!r.success && r.reason !== 'item_not_found') failures.push(r.message);
                }
                if (ctx.inventoryFull()) {
                    const others = ctx.state().inventory.filter(i => !isOre(ctx.params, i.name));
                    const names = others.map(i => (i.count > 1 ? `${i.name} x${i.count}` : i.name)).join(', ');
                    const why = failures.length > 0 ? `; drop errors: ${failures.join('; ')}` : '';
                    return { fail: `inventory full of non-ore items: ${names}${why}` };
                }
            },
        },
        returnToAreaStep<MiningParams>(params => params.area),
        {
            name: 'mine',
            when: () => true,
            async run(ctx) {
                const combat = await waitOutCombat(ctx);
                if (combat !== 'clear') return combat;
                const d = derive(ctx.params);
                const a = ctx.params.area;
                // Only rocks inside the area, or return-to-area and mine would trade the bot back and forth.
                const isMinable = (r: NearbyLoc) =>
                    d.ids.has(r.id) && r.reachable === true && r.options.some(o => /^mine$/i.test(o)) && inArea(a, r);
                const rock = ctx.sdk
                    .getNearbyLocs()
                    .filter(isMinable)
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!rock) return waitForRespawn(ctx, d, isMinable);
                delete ctx.memory.noRockSince;
                const r = await mineRock(ctx, rock);
                if (r.kind === 'threatened') {
                    // Pace the loop; the low-HP interrupt acts on the next one if HP is the problem.
                    await ctx.sdk.waitForTicks(1);
                    return;
                }
                const mineFails = ctx.counter('mineFails');
                if (r.kind === 'mined') {
                    mineFails.reset();
                    return;
                }
                ctx.log(`mine failed: ${r.message}`);
                if (mineFails.add() >= MINE_FAIL_LIMIT)
                    return { fail: `${MINE_FAIL_LIMIT} attempts in a row failed (last: ${r.message})` };
            },
        },
    ],
});
