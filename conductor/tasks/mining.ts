import { z } from 'zod/v4';
import type { NearbyLoc } from '../../sdk/types';
import { drop } from '../actions/drop';
import { MINE_OPTION, MINE_WAIT_TICKS, mine } from '../actions/mine';
import { log, type Op, wait } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill, TICK_MS } from '../lib/util';

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

/** Minimum no-rock wait before failing (2 min); a rock respawns in at most its listed ticks (mining.rs2 only scales them down by player count). */
const MIN_GIVE_UP_TICKS = 300;
/** Added to the slowest listed rock's respawn so a rock that appears just late is still seen (30 s). */
const GIVE_UP_MARGIN_TICKS = 75;
/** Each respawn wait is this long, so a step stays far inside the step budget however long the give-up is. */
const RESPAWN_CHUNK_TICKS = 100;
/** Runite respawns in ~24 min, longer than the progress watchdog can be stretched to, so it is refused. */
const REFUSED_ROCKS: readonly RockName[] = ['runite'];
/** How long the no-rock wait lasts for a rock that respawns in `ticks`. */
const giveUpTicksFor = (ticks: number) => Math.max(MIN_GIVE_UP_TICKS, ticks + GIVE_UP_MARGIN_TICKS);
/** Consecutive failed attempts before the task fails. */
const MINE_FAIL_LIMIT = 8;
const STUCK_SLACK_MS = 30_000;
/**
 * Give-up of the slowest accepted rock (adamantite) plus slack: stuckAfterMs is static, so a full respawn wait is
 * not reported as a stall. It also outlasts MINE_FAIL_LIMIT timed-out mines in a row (nothing changes during
 * one), plus one more wait for the sends between them, so the specific failure reason surfaces first. The watchdog is wall-clock but the give-up is in game
 * ticks, so the margin assumes the local tick length (TICK_MS); a slower-ticking server could fire the
 * watchdog before the slowest give-up.
 */
const STUCK_AFTER_MS = Math.max(
    giveUpTicksFor(ROCKS.adamantite.respawnTicks) * TICK_MS + STUCK_SLACK_MS,
    (MINE_FAIL_LIMIT + 1) * MINE_WAIT_TICKS * TICK_MS,
);
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
interface MiningMemory {
    /** The tick the bot first found no rock to mine, until it finds one again. */
    noRockSinceTick: number | null;
}
type Ctx = TaskContext<MiningParams, MiningMemory>;

interface Derived {
    rocks: RockName[];
    oreNames: string[];
    /** Exactly the listed rocks' ores, so other items never count. */
    orePattern: RegExp;
    ids: Set<number>;
    giveUpTicks: number;
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
            orePattern: new RegExp(oreNames.map(n => exactName(n).source).join('|'), 'i'),
            ids: new Set(rocks.flatMap(r => ROCKS[r].ids)),
            giveUpTicks: giveUpTicksFor(slowest),
        };
        derivedCache.set(params, d);
    }
    return d;
}

const oresHeld = (ctx: Ctx) => countItems(ctx.state(), derive(ctx.params).orePattern);

/**
 * A rock of the listed types the bot can mine now. Only rocks inside the area, or return-to-area and
 * mine would trade the bot back and forth; mined-out rocks keep their Mine option, so they are told
 * apart by loc id.
 */
function minable(params: MiningParams): (loc: NearbyLoc) => boolean {
    const { ids } = derive(params);
    return r =>
        ids.has(r.id) && r.reachable === true && r.options.some(o => MINE_OPTION.test(o)) && inArea(params.area, r);
}

/** No minable rock: mined-out rocks count as none, so stay put (returnToAreaStep keeps us inside) and wait, until the give-up. */
function* waitForRespawn(ctx: Ctx): Op<Outcome> {
    const d = derive(ctx.params);
    const now = ctx.state().tick;
    const label = d.rocks.join('/');
    if (ctx.memory.noRockSinceTick === null) {
        ctx.memory.noRockSinceTick = now;
        yield* log(`no ${label} rock available, waiting for a respawn`);
    }
    const since = ctx.memory.noRockSinceTick;
    const left = Math.max(0, since + d.giveUpTicks - now);
    const isMinable = minable(ctx.params);
    const respawn = yield* wait('rock respawn', s => s.nearbyLocs.some(isMinable), Math.min(left, RESPAWN_CHUNK_TICKS));
    if (respawn.kind === 'met' || respawn.state.tick - since < d.giveUpTicks) return;
    const seconds = Math.round(((respawn.state.tick - since) * TICK_MS) / 1000);
    const { area } = ctx.params;
    return {
        fail: area
            ? `area depleted: no reachable ${label} rock in radius ${area.radius} for ${seconds}s`
            : `no reachable ${label} rock nearby for ${seconds}s`,
    };
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
        'When every listed rock in reach is mined out it waits for respawns, up to max(300 ticks, slowest listed rock respawn ticks + 75 ticks) ' +
        '(2 min for rocks up to coal, mithril 190 s, adamantite 350 s), then fails: with `area` "area depleted: no reachable <rock> rock in radius N for Ns", ' +
        'without it "no reachable <rock> rock nearby for Ns". With `area` it stays within `radius` of that centre; without it, it mines ' +
        'wherever the bot stands. Verified spot: SE Varrock mine (3285,3365; copper, tin). Refuses areas reaching the Wilderness.',
    params: Params,
    memory: (): MiningMemory => ({ noRockSinceTick: null }),
    // Mining a rock cancels auto-retaliate, so a bot under attack must not touch one.
    guards: [underAttackGuard],
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
            run(ctx) {
                const ores = oresHeld(ctx);
                if (ores === 0) return { fail: `inventory full with no ${derive(ctx.params).oreNames.join('/')}` };
                return { done: `inventory full: ${ores} ores` };
            },
        },
        {
            name: 'drop-ores',
            when: ctx => ctx.params.onFull === 'drop' && ctx.inventoryFull(),
            *run(ctx) {
                const d = derive(ctx.params);
                // One drop per distinct ore item; no-item means it already left the inventory.
                const failures: string[] = [];
                for (const name of d.oreNames) {
                    const dropped = yield* drop(ctx, exactName(name));
                    if (!dropped.ok && dropped.reason !== 'no-item') failures.push(dropped.message);
                }
                if (ctx.inventoryFull()) {
                    const others = ctx.state().inventory.filter(i => !d.orePattern.test(i.name));
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
            *run(ctx) {
                const d = derive(ctx.params);
                const rock = ctx
                    .state()
                    .nearbyLocs.filter(minable(ctx.params))
                    .sort((x, y) => x.distance - y.distance)[0];
                if (!rock) return yield* waitForRespawn(ctx);
                ctx.memory.noRockSinceTick = null;
                const mined = yield* mine(ctx, rock, d.orePattern);
                const mineFails = ctx.streak('mineFails');
                if (mined.ok) {
                    mineFails.reset();
                    return;
                }
                yield* log(`mine failed: ${mined.message}`);
                if (mineFails.add() >= MINE_FAIL_LIMIT)
                    return { fail: `${MINE_FAIL_LIMIT} attempts in a row failed (last: ${mined.message})` };
            },
        },
    ],
});
