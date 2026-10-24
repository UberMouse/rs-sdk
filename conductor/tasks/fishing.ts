import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { FISH_WAIT_TICKS, countAny, fish, tileOf } from '../actions/fish';
import { drop } from '../actions/drop';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, wait } from '../core/op';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { underAttackGuard } from '../lib/interrupts';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

interface Method {
    /** The spot option that starts this method. */
    option: RegExp;
    /** The spot's other option: tells spot types apart (Net/Bait spots from Lure/Bait spots, whose "Bait" catches pike). */
    otherOption: RegExp;
    /** The inventory item the game needs (equipment doesn't count, the engine reads the inventory). */
    tool: RegExp;
    toolName: string;
    /** Consumed one per catch; carried in the inventory. */
    bait?: { item: RegExp; name: string };
    level: number;
    /** What it catches, one exact name per fish, so dropping them never touches other raw food. */
    fish: readonly RegExp[];
}

// Levels, options and tools from server/content/scripts/skill_fishing (saltfish, freshfish and rarefish
// .rs2, memberfish.rs2, fishing.npc). Bots play members worlds, so the Net/Harpoon spot's shark is in. Its other
// option, big net (Net, level 16), catches mackerel, cod and bass among boots, seaweed, gloves, oysters and caskets
// that fill the inventory with junk; it is left out.
const METHODS = {
    net: {
        option: /^net$/i,
        otherOption: /^bait$/i,
        tool: /^small fishing net$/i,
        toolName: 'small fishing net',
        level: 1,
        fish: [/^raw shrimps$/i, /^raw anchovies$/i],
    },
    bait: {
        option: /^bait$/i,
        otherOption: /^net$/i,
        tool: /^fishing rod$/i,
        toolName: 'fishing rod',
        bait: { item: /^fishing bait$/i, name: 'fishing bait' },
        level: 5,
        fish: [/^raw sardine$/i, /^raw herring$/i],
    },
    lure: {
        option: /^lure$/i,
        otherOption: /^bait$/i,
        tool: /^fly fishing rod$/i,
        toolName: 'fly fishing rod',
        bait: { item: /^feather$/i, name: 'feathers' },
        level: 20,
        fish: [/^raw trout$/i, /^raw salmon$/i],
    },
    pike: {
        option: /^bait$/i,
        otherOption: /^lure$/i,
        tool: /^fishing rod$/i,
        toolName: 'fishing rod',
        bait: { item: /^fishing bait$/i, name: 'fishing bait' },
        level: 25,
        fish: [/^raw pike$/i],
    },
    harpoon: {
        option: /^harpoon$/i,
        otherOption: /^cage$/i,
        tool: /^harpoon$/i,
        toolName: 'harpoon',
        level: 35,
        fish: [/^raw tuna$/i, /^raw swordfish$/i],
    },
    shark: {
        option: /^harpoon$/i,
        otherOption: /^net$/i,
        tool: /^harpoon$/i,
        toolName: 'harpoon',
        level: 76,
        fish: [/^raw shark$/i],
    },
    cage: {
        option: /^cage$/i,
        otherOption: /^harpoon$/i,
        tool: /^lobster pot$/i,
        toolName: 'lobster pot',
        level: 40,
        fish: [/^raw lobster$/i],
    },
} as const satisfies Record<string, Method>;
type MethodName = keyof typeof METHODS;
const METHOD_NAMES = Object.keys(METHODS) as [MethodName, ...MethodName[]];

const SPOT_NAME = /^fishing spot$/i;

/**
 * How long with no spot in reach before failing. A spot re-arms its hop 280 + random(250) ticks after the last
 * (server fishing_movement.rs2), so it can be away from a small area for up to 530 ticks; this outlasts that.
 */
const NO_SPOT_GIVE_UP_TICKS = 700;
/** Consecutive failed fish attempts (timeouts, refused sends) before the task fails. */
const FISH_FAIL_LIMIT = 6;
/** Consecutive casts that ended with the spot gone and no fish caught. */
const SPOT_MOVE_LIMIT = 10;
/**
 * A timeout is silent, so the watchdog must outlast FISH_FAIL_LIMIT of them in a row (one more covers the
 * sends between them), and the no-spot wait, for the task to report them.
 */
export const SILENT_STREAK_TICKS = [
    failStreakTicks(FISH_FAIL_LIMIT, FISH_WAIT_TICKS),
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    NO_SPOT_GIVE_UP_TICKS,
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** The longest legitimate step is a walk back to a far area; the engine default (120s) can be shorter. */
const STEP_TIMEOUT_MS = 300_000;
/** The no-spot wait runs inside one step, so its step budget must cover it (plus the walk and a cast). */
const NO_SPOT_STEP_TIMEOUT_MS = Math.max(STEP_TIMEOUT_MS, (NO_SPOT_GIVE_UP_TICKS + 200) * TICK_MS);

const Params = z
    .object({
        method: z.enum(METHOD_NAMES).default('net'),
        /** Stay near here; walk back when further than `radius`. Omit to fish wherever the bot is. */
        area: AreaSchema.optional(),
        /** What to do when the inventory is full: drop the fish and keep fishing, or end the run holding them. */
        onFull: z.enum(['drop', 'stop']).default('drop'),
        /**
         * A second method to fish while no spot of `method` is fishable in the area (e.g. method harpoon, fallback shark
         * at Catherby, where the Cage/Harpoon spot is often away while the Net/Harpoon ones are not). A spot of `method`
         * coming back is taken as soon as the current catch lands. Its tool, bait and level are checked up front too. It only
         * helps where the two methods use different spot types in the area; must differ from `method`.
         */
        fallback: z.enum(METHOD_NAMES).optional(),
    })
    .refine(p => p.fallback === undefined || p.fallback !== p.method, {
        message: 'fallback must differ from method',
        path: ['fallback'],
    });

type FishingParams = z.infer<typeof Params>;
interface FishingMemory {
    /** The tick the bot first found no spot to fish, until it finds one again. */
    noSpotSinceTick: number | null;
    /** Idle ticks and the ones with a spot in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
    /** The spot the bot is fishing, while its last send landed: the server keeps fishing without a resend. */
    fishing: { index: number; x: number; z: number } | null;
    /** The method last cast, to log a switch between `method` and `fallback`. */
    active: MethodName | null;
}
type Ctx = TaskContext<FishingParams, FishingMemory>;

/** The methods the task fishes, in preference order: `method`, then `fallback`. */
const kinds = (params: FishingParams): MethodName[] =>
    params.fallback && params.fallback !== params.method ? [params.method, params.fallback] : [params.method];
const allFish = (params: FishingParams): RegExp[] => kinds(params).flatMap(k => [...METHODS[k].fish]);
const fishHeld = (ctx: Ctx) => countAny(ctx.state(), allFish(ctx.params));
const fullWithoutFish = (ctx: Ctx) => ({
    fail: `inventory full with no ${kinds(ctx.params).join('/')} fish`,
});

/** Why the bot can't fish now (no tool, no bait for `method` or `fallback`), or null. */
function missingSupply(ctx: Ctx): string | null {
    const inv = ctx.state().inventory;
    for (const k of kinds(ctx.params)) {
        const { tool, toolName, bait }: Method = METHODS[k];
        if (!inv.some(i => tool.test(i.name))) return `no ${toolName} in inventory`;
        if (bait && !inv.some(i => bait.item.test(i.name))) return `no ${bait.name} in inventory`;
    }
    return null;
}

/** A spot of method `kind` the bot can reach, wherever it is. */
function ofMethod(kind: MethodName): (npc: NearbyNpc) => boolean {
    const m = METHODS[kind];
    return n =>
        SPOT_NAME.test(n.name) &&
        n.reachable !== false &&
        n.options.some(o => m.option.test(o)) &&
        n.options.some(o => m.otherOption.test(o));
}

/** A spot of method `kind` the bot can fish now, inside the area. */
function fishable(params: FishingParams, kind: MethodName): (npc: NearbyNpc) => boolean {
    const ok = ofMethod(kind);
    return n => ok(n) && inArea(params.area, tileOf(n));
}

/** The method to fish now: the first of `kinds` with a fishable spot in view, and those spots; none if no kind has one. */
function pickKind(ctx: Ctx): { kind: MethodName; spots: NearbyNpc[] } | null {
    for (const kind of kinds(ctx.params)) {
        const spots = ctx.state().nearbyNpcs.filter(fishable(ctx.params, kind));
        if (spots.length > 0) return { kind, spots };
    }
    return null;
}

/** No spot of the kind in reach: stay put (returnToAreaStep keeps us inside) and wait, failing after NO_SPOT_GIVE_UP_TICKS. */
function* waitForSpot(ctx: Ctx): Op<Outcome> {
    const now = ctx.state().tick;
    if (ctx.memory.noSpotSinceTick === null) {
        ctx.memory.noSpotSinceTick = now;
        yield* log(`no ${kinds(ctx.params).join('/')} fishing spot available, waiting`);
    }
    const since = ctx.memory.noSpotSinceTick;
    const left = Math.max(0, since + NO_SPOT_GIVE_UP_TICKS - now);
    const isFishable = kinds(ctx.params).map(k => fishable(ctx.params, k));
    const ofKinds = kinds(ctx.params).map(ofMethod);
    const seen = (s: BotWorldState) =>
        outsideSighting(
            s,
            ctx.params.area,
            s.nearbyNpcs
                .filter(n => ofKinds.some(ok => ok(n)))
                .map(n => ({ name: n.name, ...tileOf(n), distance: n.distance })),
            () => true,
        );
    const found = yield* trackIdle(
        ctx,
        ctx.memory.areaWatch,
        seen,
        wait('fishing spot', s => s.nearbyNpcs.some(n => isFishable.some(f => f(n))), left),
    );
    if (found.kind === 'met') return;
    const seconds = Math.round(((found.state.tick - since) * TICK_MS) / 1000);
    const { area } = ctx.params;
    const kindsText = kinds(ctx.params).join('/');
    const outsideKinds = kinds(ctx.params).map(k => ({ k, ok: ofMethod(k) }));
    let where = '';
    for (const n of found.state.nearbyNpcs) {
        const hit = outsideKinds.find(o => o.ok(n));
        if (hit) {
            where = `; ${hit.k} spot exists outside area at (${tileOf(n).x},${tileOf(n).z})`;
            break;
        }
    }
    return {
        fail: area
            ? `area depleted: no reachable ${kindsText} fishing spot in radius ${area.radius} for ${seconds}s${where}`
            : `no reachable ${kindsText} fishing spot nearby for ${seconds}s`,
    };
}

export default defineTask({
    name: 'fishing',
    description:
        'Fish at fishing spots with one `method`: net (small fishing net, shrimps/anchovies, level 1), bait (fishing rod + bait, ' +
        'sardine/herring, 5), lure (fly fishing rod + feathers, trout/salmon, 20), pike (rod + bait at a Lure/Bait spot, 25), ' +
        'harpoon (tuna/swordfish at a Cage/Harpoon spot, 35), shark (harpoon at a Net/Harpoon spot, raw shark, 76; members), ' +
        'cage (lobster pot, lobster, 40). `fallback` (e.g. method harpoon, fallback shark) names a second method fished while no ' +
        'spot of `method` is fishable in the area (needs its tool and level too); a `method` spot coming back is taken once the ' +
        'current catch lands. Big net is not supported. The tool and any bait must be in the inventory. ' +
        'When the inventory is full, `onFull` "drop" (default) drops the fish and keeps fishing, "stop" ends the run done ' +
        '("inventory full: N fish") holding them, e.g. to feed a cooking task. Spots hop between tiles every 112-212 s; it follows them. ' +
        'With a small `area` the spot can be away from it for up to ~3.5 minutes per hop, and the task waits for it, failing ' +
        '("area depleted", naming a spot visible outside the area) only after 280 s with none. ' +
        'Fails on missing tool/bait (also when the bait runs out) or too low a level. ' +
        'In combat it pauses fishing and fails after 40 ticks of combat, or at once if auto-retaliate is off. ' +
        'With `area` it stays within `radius` of that centre; without it, it fishes wherever the bot stands. ' +
        'Live-tested at the Fishing Guild (Fishing 68; Net/Harpoon spot near (2605,3418)); Catherby seen only in a run log. ' +
        'Draynor Village Net/Bait spots: use area {x:3086,z:3227,radius:2} (dark wizards attack at the northern tiles). ' +
        'Refuses areas reaching the Wilderness.',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): FishingMemory => ({ noSpotSinceTick: null, areaWatch: newAreaWatch(), fishing: null, active: null }),
    // Fishing re-sends an interaction that would cancel auto-retaliate, so a bot under attack must not.
    guards: [underAttackGuard],
    stepTimeoutMs: NO_SPOT_STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const refused = missingSupply(ctx);
        if (refused) return refused;
        const skill = findSkill(ctx.state(), 'Fishing');
        if (!skill) return 'no Fishing skill in state';
        for (const k of kinds(ctx.params)) {
            const need = METHODS[k].level;
            if (skill.baseLevel < need) return `${k} needs fishing ${need}, bot has ${skill.baseLevel}`;
        }
        return refuseArea(ctx.params.area);
    },

    steps: [
        {
            name: 'no-supplies',
            when: ctx => missingSupply(ctx) !== null,
            // `when` held a tick ago, so a reason exists; the fallback only satisfies the type.
            run: ctx => ({ fail: missingSupply(ctx) ?? 'no supplies' }),
        },
        {
            name: 'stop-full',
            when: ctx => ctx.params.onFull === 'stop' && ctx.inventoryFull(),
            run(ctx) {
                const held = fishHeld(ctx);
                return held === 0 ? fullWithoutFish(ctx) : { done: `inventory full: ${held} fish` };
            },
        },
        {
            name: 'drop-fish',
            when: ctx => ctx.params.onFull === 'drop' && ctx.inventoryFull(),
            *run(ctx) {
                if (fishHeld(ctx) === 0) return fullWithoutFish(ctx);
                ctx.memory.fishing = null;
                let dropped = 0;
                let problem = '';
                for (const kind of allFish(ctx.params)) {
                    if (countItems(ctx.state(), kind) === 0) continue;
                    const r = yield* drop(ctx, kind);
                    if (r.ok) dropped += r.slotsDropped;
                    else problem = r.message;
                }
                if (ctx.inventoryFull())
                    return { fail: `inventory still full after dropping fish (${problem || `dropped ${dropped}`})` };
            },
        },
        returnToAreaStep<FishingParams>(params => params.area),
        {
            name: 'fish',
            when: () => true,
            *run(ctx) {
                const mem = ctx.memory;
                const picked = pickKind(ctx);
                if (!picked) {
                    mem.fishing = null;
                    return yield* waitForSpot(ctx);
                }
                // `spots` are all of one kind; a spot of an earlier kind returning replaces the current one at once.
                const { kind, spots } = picked;
                const m = METHODS[kind];
                const last = mem.fishing;
                // Still fishing the spot the last send started, if it hasn't moved: wait, don't recast.
                const current = last
                    ? spots.find(n => {
                          const t = tileOf(n);
                          return n.index === last.index && t.x === last.x && t.z === last.z;
                      })
                    : undefined;
                const spot = current ?? spots.sort((a, b) => a.distance - b.distance)[0];
                if (!spot) return yield* waitForSpot(ctx);
                mem.noSpotSinceTick = null;
                if (mem.active !== kind) {
                    if (mem.active !== null || kind !== ctx.params.method) yield* log(`fishing ${kind}`);
                    mem.active = kind;
                }
                // Cut off mid-wait (a guard, a stop): what the server is doing is unknown, so cast again.
                const resume = !!current;
                mem.fishing = null;
                const caught = yield* fish(ctx, spot, m.option, m.fish, { resume });
                const fails = ctx.streak('fishFails');
                const moves = ctx.streak('spotMoves');
                if (caught.ok) {
                    fails.reset();
                    moves.reset();
                    mem.fishing = { index: spot.index, ...tileOf(spot) };
                    return;
                }
                // A spot hopping away is how fishing spots work, not a failure, unless it never lets a fish land.
                if (caught.reason === 'spot-moved') {
                    yield* log(caught.message);
                    const at = tileOf(spot);
                    if (moves.add() >= SPOT_MOVE_LIMIT)
                        return {
                            fail: `spot keeps moving/leaving view at (${at.x},${at.z}) (${SPOT_MOVE_LIMIT} times without a catch)`,
                        };
                    return;
                }
                yield* log(`fish failed: ${caught.message}`);
                if (fails.add() >= FISH_FAIL_LIMIT)
                    return { fail: `${FISH_FAIL_LIMIT} fish attempts in a row failed (last: ${caught.message})` };
            },
        },
    ],
});
