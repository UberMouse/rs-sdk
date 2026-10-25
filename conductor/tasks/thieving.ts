import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { eat } from '../actions/eat';
import {
    PICKPOCKET_ACK_TICKS,
    PICKPOCKET_OPTION,
    PICKPOCKET_RESOLVE_TICKS,
    pickpocket,
    type PickpocketResult,
    STUN_MARGIN_TICKS,
    STUN_TICKS,
} from '../actions/pickpocket';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op, ticks, wait } from '../core/op';
import { areaWatchReport, type AreaWatch, newAreaWatch, outsideSighting, trackIdle } from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT, walkToArea } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { LOW_HP_FRACTION } from '../lib/threat';
import { exactName, findSkill } from '../lib/util';
import { isInWilderness } from '../lib/wilderness';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/**
 * Thieving level each pickpocketable NPC needs, by lower-case name, from
 * server/content/scripts/skill_thieving/configs/pickpocking/pickpocket.dbrow (a unit test checks every
 * level here against that file). The Viking quest NPCs (level 45, individually named, locked behind the
 * quest) are left out.
 */
export const PICKPOCKET_LEVELS: Readonly<Record<string, number>> = {
    man: 1,
    woman: 1,
    farmer: 10,
    'warrior woman': 25,
    'al-kharid warrior': 25,
    rogue: 32,
    guard: 40,
    'knight of ardougne': 55,
    watchman: 65,
    paladin: 70,
    gnome: 75,
    hero: 80,
};

const DEFAULT_EAT_BELOW = 0.6;
/**
 * Looks with no free reachable target before failing (100 x NO_TARGET_WAIT_TICKS = 300 ticks of waiting, plus any
 * recentre walks). Roaming NPCs such as the Ardougne Knights leave the area, fight, or go behind doors for a while.
 */
const NO_TARGET_LIMIT = 100;
const NO_TARGET_WAIT_TICKS = 3;
/** With an area, after this many looks (then every NO_TARGET_RECENTRE_EVERY) the bot walks back toward the area centre (within the walk tolerance), where the NPCs pass. */
const NO_TARGET_RECENTRE_AFTER = 5;
const NO_TARGET_RECENTRE_EVERY = 20;
/** Attempts in a row that never reached the NPC (walk failed, NPC gone, unreachable, no result). */
const PICK_FAIL_LIMIT = 6;
const PICK_RETRY_TICKS = 1;
/** Attempts the server ignored (stunned, mid-action) or refused for combat, in a row. */
const BLOCKED_LIMIT = 4;
const EAT_FAIL_LIMIT = 3;
/** An NPC further than this is walked to first (the walkTo op opens the doors on the way). */
const PICK_WALK_BEYOND = 2;
/** The op's own send takes a tick; walkTo's reserveTicks must count it. */
const SEND_TICKS = 1;
/** What the pickpocket step does after its walk: the send, then the op's two waits. */
export const AFTER_WALK_TICKS = SEND_TICKS + PICKPOCKET_ACK_TICKS + PICKPOCKET_RESOLVE_TICKS + PICK_RETRY_TICKS;
const NO_PLAYER_WAIT_TICKS = 1;
/** The most one caught attempt costs (2 for the warriors and rogues, 1 for the rest). */
const MAX_FAILURE_DAMAGE = 2;
/** Without food, the bot waits for HP to regenerate in slices of this many ticks... */
const REGEN_SLICE_TICKS = 5;
/** ...for at most this many ticks in a row (about 1 HP per 100 ticks) before failing. */
const REGEN_CAP_TICKS = 800;
const REGEN_SLICE_LIMIT = REGEN_CAP_TICKS / REGEN_SLICE_TICKS;
const STEP_TIMEOUT_MS = 300_000;

/** The watchdog waits for the longest silent failure streak, so each reports its own reason. */
export const SILENT_STREAK_TICKS = [
    NO_TARGET_LIMIT * NO_TARGET_WAIT_TICKS,
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(PICK_FAIL_LIMIT, WALK_MAX_TICKS + AFTER_WALK_TICKS),
    failStreakTicks(BLOCKED_LIMIT, AFTER_WALK_TICKS + STUN_TICKS + STUN_MARGIN_TICKS),
    REGEN_CAP_TICKS + REGEN_SLICE_TICKS,
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);

const Params = z.object({
    /** Exact NPC name (case-insensitive), e.g. "Man", "Farmer". Must be in PICKPOCKET_LEVELS. */
    npc: z.string().trim().min(1),
    /** Where to work. Optional: without it, any matching NPC in view. */
    area: AreaSchema.optional(),
    /** Food item names to eat below `eatBelow` of max HP. */
    food: z.array(z.string().trim()).default([]),
    eatBelow: z.number().min(0.1).max(0.9).default(DEFAULT_EAT_BELOW),
    /** End the run done once the inventory is full (coins stack, so this is mostly for seeds and loot). */
    stopWhenFull: z.boolean().default(false),
});

type ThievingParams = z.infer<typeof Params>;
interface ThievingMemory {
    /** The tick the stun from the last caught attempt ends; attempts sent before it are dropped silently. */
    stunnedUntil: number;
    /** Idle ticks and the ones with a target in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
}
type Ctx = TaskContext<ThievingParams, ThievingMemory>;

const levelNeeded = (npc: string) => PICKPOCKET_LEVELS[npc.toLowerCase()];

const foodInInventory = (s: BotWorldState, p: ThievingParams) =>
    s.inventory.find(i => p.food.some(f => exactName(f).test(i.name)));

/** The eat rule: HP below `eatBelow` of max and a configured food is held. */
const wantsToEat = (s: BotWorldState, p: ThievingParams) =>
    !!s.player && s.player.maxHp > 0 && s.player.hp < s.player.maxHp * p.eatBelow && !!foodInInventory(s, p);

/**
 * No food and too little HP to take one more caught attempt without dropping under the engine's
 * low-HP line, where its guard fails a bot in combat (a bot targeting an NPC counts as in combat).
 */
const needsRegen = (s: BotWorldState, p: ThievingParams) =>
    !!s.player &&
    s.player.maxHp > 0 &&
    !foodInInventory(s, p) &&
    s.player.hp < s.player.maxHp * LOW_HP_FRACTION + MAX_FAILURE_DAMAGE;

const stunFrom = (ctx: Ctx) => {
    ctx.memory.stunnedUntil = ctx.state().tick + STUN_TICKS + STUN_MARGIN_TICKS;
};

/** The nearest free, reachable, in-area NPC with a Pickpocket option. */
function pickTarget(state: BotWorldState, p: ThievingParams): NearbyNpc | undefined {
    return state.nearbyNpcs
        .filter(
            n =>
                freeNpc(n, p) &&
                inArea(p.area, n) &&
                // Without an area nothing refuses a route to the Wilderness before the bot is in it.
                (p.area !== undefined || !isInWilderness(state.player?.level ?? 0, n.x, n.z)),
        )
        .sort((a, b) => a.distance - b.distance)[0];
}

/** An NPC of the task's kind the bot could pick now, wherever it stands. */
const freeNpc = (n: NearbyNpc, p: ThievingParams) =>
    exactName(p.npc).test(n.name) &&
    n.reachable !== false &&
    !n.inCombat &&
    n.options.some(o => PICKPOCKET_OPTION.test(o));

/** Walks to a far NPC, then picks its pocket. */
function* walkAndPick(ctx: Ctx, npc: NearbyNpc): Op<PickpocketResult> {
    if (npc.distance > PICK_WALK_BEYOND) {
        const walked = yield* walkTo(ctx, npc.x, npc.z, PICK_WALK_BEYOND, { reserveTicks: AFTER_WALK_TICKS });
        if (!walked.ok)
            return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}: ${walked.message}` };
    }
    return yield* pickpocket(ctx, npc);
}

export default defineTask({
    name: 'thieving',
    description:
        'Pickpocket one kind of NPC (`npc`, exact name, e.g. "Man") repeating until stopped: picks the nearest ' +
        'reachable one inside the optional `area`, waits out the 8-tick stun after a caught attempt (1 damage, ' +
        '2 for warriors; the NPC does not fight back), eats optional `food` below `eatBelow` (with no food held it waits for HP to regenerate, and fails if it does not), and, when no free NPC is in the area, waits (walking back toward the area centre every so often) and fails after 100 looks (300 ticks). Loot (coins) accumulates; ' +
        "`stopWhenFull` ends the run done on a full inventory. Refuses an NPC above the bot's Thieving level " +
        '(Man/Woman 1, Farmer 10, Warrior 25, Guard 40...), areas reaching the Wilderness, and NPCs with no ' +
        'pickpocket config. Verified spot: Men around Lumbridge castle (3222,3218, radius 6) at Thieving 1.',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): ThievingMemory => ({ stunnedUntil: -Infinity, areaWatch: newAreaWatch() }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const p = ctx.params;
        const need = levelNeeded(p.npc);
        if (need === undefined)
            return `${p.npc} has no pickpocket config (known: ${Object.keys(PICKPOCKET_LEVELS).join(', ')})`;
        const skill = findSkill(ctx.state(), 'Thieving');
        if (!skill) return 'no Thieving skill in state';
        if (skill.baseLevel < need) return `${p.npc} needs thieving ${need}, bot has ${skill.baseLevel}`;
        return refuseArea(p.area);
    },

    steps: [
        {
            name: 'stop-full',
            when: ctx => ctx.params.stopWhenFull && ctx.inventoryFull(),
            run() {
                return { done: 'inventory full' };
            },
        },
        returnToAreaStep<ThievingParams>(params => params.area),
        {
            name: 'eat',
            when: ctx => wantsToEat(ctx.state(), ctx.params),
            *run(ctx) {
                const food = foodInInventory(ctx.state(), ctx.params);
                if (!food) return;
                const eatFails = ctx.streak('eatFails');
                const r = yield* eat(ctx, food);
                if (r.ok) {
                    eatFails.reset();
                    return;
                }
                if (eatFails.add() >= EAT_FAIL_LIMIT) return { fail: `could not eat ${food.name}: ${r.message}` };
            },
        },
        {
            name: 'regen',
            when: ctx => needsRegen(ctx.state(), ctx.params),
            *run(ctx) {
                const p = ctx.state().player;
                if (!p) return;
                const n = ctx.streak('regenSlices').add();
                if (n > REGEN_SLICE_LIMIT)
                    return {
                        fail: `no food, hp ${p.hp}/${p.maxHp}, not regenerating after ${REGEN_CAP_TICKS} ticks`,
                    };
                if (n === 1) yield* log(`no food, hp ${p.hp}/${p.maxHp}: waiting to regenerate`);
                yield* ticks(REGEN_SLICE_TICKS);
            },
        },
        {
            name: 'stunned',
            // Any pickpocket sent inside the stun is dropped silently, so wait it out (memory survives an
            // aborting guard, which resumes here).
            when: ctx => ctx.memory.stunnedUntil > ctx.state().tick,
            *run(ctx) {
                const left = ctx.memory.stunnedUntil - ctx.state().tick;
                yield* wait('stun', () => false, left);
            },
        },
        {
            name: 'pickpocket',
            when: () => true,
            *run(ctx) {
                const state = ctx.state();
                if (!state.player) {
                    yield* ticks(NO_PLAYER_WAIT_TICKS);
                    return;
                }
                const target = pickTarget(state, ctx.params);
                const noTarget = ctx.streak('noTarget');
                if (!target) {
                    const looks = noTarget.add();
                    if (looks >= NO_TARGET_LIMIT)
                        return {
                            fail: `no free reachable ${ctx.params.npc} ${ctx.params.area ? 'in the area' : 'in view'} after ${looks} looks`,
                        };
                    const area = ctx.params.area;
                    if (
                        area &&
                        looks >= NO_TARGET_RECENTRE_AFTER &&
                        (looks - NO_TARGET_RECENTRE_AFTER) % NO_TARGET_RECENTRE_EVERY === 0
                    ) {
                        // Waiting at the area's edge (or out of the NPCs' sight) only sees what wanders past it.
                        yield* log(`no ${ctx.params.npc} free for ${looks} looks: walking back toward the area centre`);
                        const failure = yield* walkToArea(ctx, area);
                        if (failure) return { fail: failure };
                    }
                    const seen = (s: BotWorldState) =>
                        outsideSighting(s, ctx.params.area, s.nearbyNpcs, n => freeNpc(n, ctx.params));
                    yield* trackIdle(ctx, ctx.memory.areaWatch, seen, ticks(NO_TARGET_WAIT_TICKS));
                    return;
                }
                noTarget.reset();

                const pickFails = ctx.streak('pickFails');
                const blocked = ctx.streak('blocked');
                const r = yield* walkAndPick(ctx, target);
                if (r.ok) {
                    pickFails.reset();
                    blocked.reset();
                    if (r.outcome === 'caught') {
                        stunFrom(ctx);
                    }
                    return;
                }
                yield* log(`pickpocket ${target.name} failed: ${r.message}`);
                if (r.reason === 'not-started' || r.reason === 'in-combat') {
                    // Most likely stunned or fighting: sending more only restarts the server's clock.
                    stunFrom(ctx);
                    if (blocked.add() >= BLOCKED_LIMIT)
                        return { fail: `${BLOCKED_LIMIT} pickpockets in a row refused (last: ${r.message})` };
                    return;
                }
                if (pickFails.add() >= PICK_FAIL_LIMIT)
                    return { fail: `${PICK_FAIL_LIMIT} pickpockets in a row failed (last: ${r.message})` };
                yield* ticks(PICK_RETRY_TICKS);
            },
        },
    ],
});
