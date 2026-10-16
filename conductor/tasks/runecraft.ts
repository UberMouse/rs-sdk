import { z } from 'zod/v4';
import type { NearbyLoc } from '../../sdk/types';
import { interactLoc } from '../actions/interact';
import { useItemOnLoc } from '../actions/use';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, ticks, wait } from '../core/op';
import {
    ALTAR_NAMES,
    ALTARS,
    ESSENCE,
    inEssenceMine,
    inTemple,
    nearestReachableLoc as nearest,
    PORTAL,
    USE_OPTION,
} from '../lib/runecraft';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

const CRAFT_OPTION = /^craft-?rune$/i;
const RUINS = /^mysterious ruins$/i;
const ALTAR = /^altar$/i;
const RUINS_TOLERANCE = 3;

/** runecraft.rs2: the talisman use is a 1-tick delay then the jump; the portal and the craft (p_delay 3) are as short. */
const ENTER_WAIT_TICKS = 15;
const CRAFT_WAIT_TICKS = 15;
const LEAVE_WAIT_TICKS = 30;
const CRAFT_DELAY_TICKS = 3;
const FAIL_LIMIT = 3;
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
const STEP_TIMEOUT_MS = 360_000;
const STUCK_AFTER_MS = stuckWindowMs(
    failStreakTicks(FAIL_LIMIT, ENTER_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, LEAVE_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, CRAFT_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

const Params = z.object({
    /** Which altar (rune type): the F2P ones. The matching talisman opens its ruins. */
    altar: z.enum(ALTAR_NAMES),
});
type RunecraftParams = z.infer<typeof Params>;
interface RunecraftMemory {
    /** The essence was bound at the altar; the run now only has to get outside. */
    crafted: boolean;
}
type Ctx = TaskContext<RunecraftParams, RunecraftMemory>;

const altarOf = (ctx: Ctx) => ALTARS[ctx.params.altar];
const hasTalisman = (ctx: Ctx) =>
    ctx.state().inventory.some(i => i.name.toLowerCase() === altarOf(ctx).talisman.toLowerCase());
const essenceHeld = (ctx: Ctx) => countItems(ctx.state(), ESSENCE);
const inside = (ctx: Ctx) => inTemple(ctx.state(), ctx.params.altar);

export default defineTask({
    name: 'runecraft',
    description:
        "One runecrafting trip: with the altar's talisman and rune essence held, walk to its Mysterious ruins, use the talisman on them (no tiaras in this revision), " +
        'bind every rune essence at the altar (Craft-rune; one action for the whole stack), and leave by the temple portal. ' +
        '`altar`: air, mind, water, earth, fire or body (levels 1/2/5/9/14/20; ruins at air (2984,3291), mind (2981,3513), water (3184,3164), earth (3305,3473), fire (3312,3254), body (3052,3444)). ' +
        'Done once the essence is crafted and the bot is back outside by the ruins. Fails with no essence or talisman. Get essence with the essence-mine task + mining rock "essence". ' +
        'Runes stack: they take one inventory slot per type.',
    params: Params,
    memory: (): RunecraftMemory => ({ crafted: false }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const a = altarOf(ctx);
        const skill = findSkill(s, 'Runecraft');
        if (!skill) return 'no Runecraft skill in state';
        if (skill.baseLevel < a.level)
            return `${ctx.params.altar} runes need runecraft ${a.level}, bot has ${skill.baseLevel}`;
        if (inEssenceMine(s)) return 'in the Rune Essence Mine: leave it first (essence-mine task, action "leave")';
        if (squareReachesWilderness(a.ruins.x, a.ruins.z, 0))
            return `the ${ctx.params.altar} ruins are in the Wilderness`;
        if (!inTemple(s, ctx.params.altar)) {
            if (countItems(s, ESSENCE) === 0) return 'no rune essence held';
            if (!hasTalisman(ctx)) return `no ${a.talisman} in the inventory`;
        }
        return null;
    },

    steps: [
        {
            name: 'finish',
            when: ctx => ctx.memory.crafted && !inside(ctx),
            run: ctx => ({ done: `crafted ${ctx.params.altar} runes and left the temple` }),
        },
        {
            name: 'leave',
            when: ctx => inside(ctx) && (ctx.memory.crafted || essenceHeld(ctx) === 0),
            *run(ctx) {
                // A temple entered with nothing to craft: leave, then `enter` fails on the missing essence.
                const portal = nearest(ctx, l => PORTAL.test(l.name) && l.options.some(o => USE_OPTION.test(o)));
                const missing = ctx.streak('noPortal');
                if (!portal) {
                    if (missing.add() >= MISSING_LIMIT) return { fail: 'no reachable Portal in the temple' };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const used = yield* interactLoc(portal, USE_OPTION);
                const fails = ctx.streak('leaveFails');
                if (used.ok) {
                    const w = yield* wait('leave the temple', s => !inTemple(s, ctx.params.altar), LEAVE_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log('the portal did not take us out');
                if (fails.add() >= FAIL_LIMIT) return { fail: `${FAIL_LIMIT} portal uses in a row failed` };
            },
        },
        {
            name: 'craft',
            when: ctx => inside(ctx),
            *run(ctx) {
                const altar = nearest(ctx, l => ALTAR.test(l.name) && l.options.some(o => CRAFT_OPTION.test(o)));
                const missing = ctx.streak('noAltar');
                if (!altar) {
                    if (missing.add() >= MISSING_LIMIT) return { fail: 'no reachable Altar in the temple' };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const sent = yield* interactLoc(altar, CRAFT_OPTION);
                const fails = ctx.streak('craftFails');
                if (sent.ok) {
                    const w = yield* wait('bind the essence', s => countItems(s, ESSENCE) === 0, CRAFT_WAIT_TICKS);
                    if (w.kind === 'met') {
                        ctx.memory.crafted = true;
                        yield* log(`crafted ${ctx.params.altar} runes`);
                        // runecraft.rs2 deletes the essence, then p_delay(3): a portal click inside it is dropped.
                        yield* ticks(CRAFT_DELAY_TICKS);
                        return;
                    }
                }
                yield* log(`craft failed: ${sent.ok ? 'the essence stayed in the inventory' : sent.message}`);
                if (fails.add() >= FAIL_LIMIT) return { fail: `${FAIL_LIMIT} crafts in a row failed` };
            },
        },
        {
            name: 'enter',
            when: () => true,
            *run(ctx) {
                if (essenceHeld(ctx) === 0) return { fail: 'no rune essence held' };
                const name = altarOf(ctx).talisman;
                const talisman = ctx.state().inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
                if (!talisman) return { fail: `no ${name} in the inventory` };
                const { ruins } = altarOf(ctx);
                const isRuins = (l: NearbyLoc) =>
                    RUINS.test(l.name) && Math.abs(l.x - ruins.x) <= 2 && Math.abs(l.z - ruins.z) <= 2;
                const loc = nearest(ctx, isRuins);
                if (!loc || loc.distance > RUINS_TOLERANCE + 2) {
                    const before = ctx.distanceTo(ruins.x, ruins.z);
                    const r = yield* walkTo(ctx, ruins.x, ruins.z, RUINS_TOLERANCE);
                    const walkFails = ctx.streak('walkFails');
                    if (r.ok || timedOutAdvancing(r, before, ctx.distanceTo(ruins.x, ruins.z))) {
                        walkFails.reset();
                        // Arrived with the ruins still out of sight: not the place we think.
                        const absent = ctx.streak('ruinsAbsent');
                        if (r.ok && !loc && absent.add() >= FAIL_LIMIT)
                            return { fail: `Mysterious ruins not found near (${ruins.x},${ruins.z})` };
                        return;
                    }
                    yield* log(`walk to the ${ctx.params.altar} ruins failed (${r.reason}): ${r.message}`);
                    if (walkFails.add() >= FAIL_LIMIT)
                        return { fail: `${FAIL_LIMIT} walks in a row failed: ${r.message}` };
                    return;
                }
                ctx.streak('ruinsAbsent').reset();
                const used = yield* useItemOnLoc(ctx, talisman, loc);
                const fails = ctx.streak('enterFails');
                if (used.ok) {
                    const w = yield* wait('enter the temple', s => inTemple(s, ctx.params.altar), ENTER_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log(`entering the ruins failed: ${used.ok ? 'no teleport' : used.message}`);
                if (fails.add() >= FAIL_LIMIT) return { fail: `${FAIL_LIMIT} tries to enter the ruins failed` };
            },
        },
    ],
});
