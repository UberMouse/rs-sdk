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
import { failStreak, MISSING_WAIT_TICKS, missingTargetStreak } from '../lib/streak';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, findSkill } from '../lib/util';
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
const NO_PORTAL = missingTargetStreak('noPortal');
const NO_ALTAR = missingTargetStreak('noAltar');
// One failed portal use: the wait to leave the temple (LEAVE_WAIT_TICKS).
const LEAVE_FAILS = failStreak({
    name: 'leaveFails',
    limit: FAIL_LIMIT,
    worstTicks: LEAVE_WAIT_TICKS,
    what: 'portal uses',
});
// One failed craft: the wait for the essence to go (CRAFT_WAIT_TICKS; CRAFT_DELAY_TICKS follows only a success).
const CRAFT_FAILS = failStreak({ name: 'craftFails', limit: FAIL_LIMIT, worstTicks: CRAFT_WAIT_TICKS, what: 'crafts' });
// One failed entry: the wait to land in the temple (ENTER_WAIT_TICKS).
const ENTER_FAILS = failStreak({ name: 'enterFails', limit: FAIL_LIMIT, worstTicks: ENTER_WAIT_TICKS });
// A walk toward the ruins ends within WALK_MAX_TICKS.
const WALK_FAILS = failStreak({ name: 'walkFails', limit: FAIL_LIMIT, worstTicks: WALK_MAX_TICKS });
// Counts arrivals at the ruins that find none: the first arrival moved the bot (visible), the repeats are re-walks from
// within the tolerance that end at once, so one attempt is a tick.
const RUINS_ABSENT = failStreak({ name: 'ruinsAbsent', limit: FAIL_LIMIT, worstTicks: 1 });
const STEP_TIMEOUT_MS = 360_000;
const SILENT = [ENTER_FAILS, LEAVE_FAILS, CRAFT_FAILS, WALK_FAILS, RUINS_ABSENT, NO_PORTAL, NO_ALTAR];

const Params = z.object({
    altar: z.enum(ALTAR_NAMES).describe('Which altar to craft at, so which rune.'),
});
type RunecraftParams = z.infer<typeof Params>;
interface RunecraftMemory {
    /** The essence was bound at the altar; the run now only has to get outside. */
    crafted: boolean;
    /** The run started inside the temple with no essence: it only leaves (a plan ended in the altar), and is done outside. */
    leaveOnly: boolean;
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
        'Does one runecrafting trip. ' +
        "It walks to the altar's Mysterious ruins, uses the talisman on them (no tiaras in this revision), " +
        'binds every rune essence at the altar (Craft-rune; one action for the whole stack), and leaves by the temple portal. ' +
        'Done once the essence is crafted and the bot is back outside by the ruins. Started inside the temple with no essence (a plan ended in the altar), it just leaves and is done. ' +
        'Runes stack: they take one inventory slot per type.',
    rules: [
        `The base Runecraft level must reach the altar's: ${ALTAR_NAMES.map(n => `${n} ${ALTARS[n].level}`).join(', ')}.`,
        `Needs rune essence held (get it with the essence-mine task and the mining task, rock "essence") and the altar's talisman in the inventory, which opens the ruins (${ALTAR_NAMES.map(n => ALTARS[n].talisman).join(', ')}); started inside the altar's temple it needs neither.`,
        'Refuses to start in the Rune Essence Mine (leave it first with the essence-mine task, action "leave") or at ruins in the Wilderness.',
    ],
    spots: [`Ruins: ${ALTAR_NAMES.map(n => `${n} (${ALTARS[n].ruins.x},${ALTARS[n].ruins.z})`).join(', ')}.`],
    params: Params,
    memory: (): RunecraftMemory => ({ crafted: false, leaveOnly: false }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

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
            when: ctx => (ctx.memory.crafted || ctx.memory.leaveOnly) && !inside(ctx),
            run: ctx => ({
                done: ctx.memory.crafted
                    ? `crafted ${ctx.params.altar} runes and left the temple`
                    : `left the ${ctx.params.altar} temple with no essence to craft`,
            }),
        },
        {
            name: 'leave',
            when: ctx => inside(ctx) && (ctx.memory.crafted || essenceHeld(ctx) === 0),
            *run(ctx) {
                // A temple with nothing to craft: leave and be done (`enter` would fail on the missing essence).
                if (!ctx.memory.crafted) ctx.memory.leaveOnly = true;
                const portal = nearest(ctx, l => PORTAL.test(l.name) && l.options.some(o => USE_OPTION.test(o)));
                if (!portal) {
                    const failed = NO_PORTAL.missWith(ctx, 'no reachable Portal in the temple');
                    if (failed) return failed;
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                NO_PORTAL.clear(ctx);
                const used = yield* interactLoc(portal, USE_OPTION);
                if (used.ok) {
                    const w = yield* wait('leave the temple', s => !inTemple(s, ctx.params.altar), LEAVE_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log('the portal did not take us out');
                return LEAVE_FAILS.miss(ctx);
            },
        },
        {
            name: 'craft',
            when: ctx => inside(ctx),
            *run(ctx) {
                const altar = nearest(ctx, l => ALTAR.test(l.name) && l.options.some(o => CRAFT_OPTION.test(o)));
                if (!altar) {
                    const failed = NO_ALTAR.missWith(ctx, 'no reachable Altar in the temple');
                    if (failed) return failed;
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                NO_ALTAR.clear(ctx);
                const sent = yield* interactLoc(altar, CRAFT_OPTION);
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
                if (sent.ok && essenceHeld(ctx) === 0) {
                    // The essence went after the wait gave up: the craft happened, so `leave` must not report an empty temple.
                    ctx.memory.crafted = true;
                    yield* log(`crafted ${ctx.params.altar} runes (late)`);
                    return;
                }
                yield* log(`craft failed: ${sent.ok ? 'the essence stayed in the inventory' : sent.message}`);
                return CRAFT_FAILS.miss(ctx);
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
                    if (r.ok || timedOutAdvancing(r, before, ctx.distanceTo(ruins.x, ruins.z))) {
                        WALK_FAILS.clear(ctx);
                        // Arrived with the ruins still out of sight: not the place we think.
                        if (r.ok && !loc)
                            return RUINS_ABSENT.missWith(
                                ctx,
                                `Mysterious ruins not found near (${ruins.x},${ruins.z})`,
                            );
                        return;
                    }
                    yield* log(`walk to the ${ctx.params.altar} ruins failed (${r.reason}): ${r.message}`);
                    return WALK_FAILS.missWith(ctx, `${FAIL_LIMIT} walks in a row failed: ${r.message}`);
                }
                RUINS_ABSENT.clear(ctx);
                const used = yield* useItemOnLoc(ctx, talisman, loc);
                if (used.ok) {
                    const w = yield* wait('enter the temple', s => inTemple(s, ctx.params.altar), ENTER_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log(`entering the ruins failed: ${used.ok ? 'no teleport' : used.message}`);
                return ENTER_FAILS.missWith(ctx, `${FAIL_LIMIT} tries to enter the ruins failed`);
            },
        },
    ],
});
