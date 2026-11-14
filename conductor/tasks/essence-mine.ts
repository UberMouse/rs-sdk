import { z } from 'zod/v4';
import { interactLoc, interactNpc } from '../actions/interact';
import { CANT_REACH, messageCursor, messageSince } from '../actions/messages';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, ticks, wait } from '../core/op';
import {
    ESSENCE_PORTALS,
    inEssenceMine,
    nearestPoint,
    nearestReachableLoc,
    PORTAL,
    USE_OPTION,
} from '../lib/runecraft';
import { failStreak, MISSING_LIMIT, MISSING_WAIT_TICKS, missingTargetStreak } from '../lib/streak';
import { defineTask, type TaskContext } from '../lib/task';

/** Aubury's rune shop, south-east Varrock (the rune-mysteries plan's stand). */
const AUBURY = { name: /^aubury$/i, x: 3252, z: 3402, tolerance: 3 };
const TELEPORT_OPTION = /^teleport$/i;
const NOT_QUEST = /need to have completed the Rune Mysteries/i;

/** aubury.rs2: the curse casts, p_delay(4), then the jump; the portal: p_delay(1). Generous for a lagging tick. */
const TELEPORT_WAIT_TICKS = 15;
/** The portal is walked to first, up to a corner to corner of the 64-tile mine (2 tiles a tick running), then p_delay(1). */
const PORTAL_WAIT_TICKS = 40;
const FAIL_LIMIT = 3;
const PORTAL_TOLERANCE = 2;
const STEP_TIMEOUT_MS = 360_000;
const NO_AUBURY = missingTargetStreak('noAubury');
// Each look for the portal that finds none also walks to the nearest known one (WALK_MAX_TICKS) and waits.
const NO_PORTAL = failStreak({
    name: 'noPortal',
    limit: MISSING_LIMIT,
    worstTicks: WALK_MAX_TICKS + MISSING_WAIT_TICKS,
});
const WALK_FAILS = failStreak({ name: 'walkFails', limit: FAIL_LIMIT, worstTicks: WALK_MAX_TICKS });
const TELEPORT_FAILS = failStreak({ name: 'teleportFails', limit: FAIL_LIMIT, worstTicks: TELEPORT_WAIT_TICKS });
const PORTAL_FAILS = failStreak({ name: 'portalFails', limit: FAIL_LIMIT, worstTicks: PORTAL_WAIT_TICKS });
const SILENT = [TELEPORT_FAILS, PORTAL_FAILS, WALK_FAILS, NO_AUBURY, NO_PORTAL];

const Params = z.object({
    action: z
        .enum(['enter', 'leave'])
        .describe(
            '`enter`: Aubury teleports the bot into the mine. `leave`: step through a portal of the mine; that returns the bot beside Aubury (3253,3401) if the mine was entered through Aubury, otherwise to Sedridor in the Wizards Tower (a bot with no recorded entry point comes out at Sedridor).',
        ),
});
type EssenceMineParams = z.infer<typeof Params>;
type Ctx = TaskContext<EssenceMineParams>;

const nearestAubury = (ctx: Ctx) =>
    ctx
        .state()
        .nearbyNpcs.filter(n => AUBURY.name.test(n.name) && n.reachable !== false)
        .sort((a, b) => a.distance - b.distance)[0];

const atAubury = (ctx: Ctx) => {
    const p = ctx.state().player;
    return !!p && Math.max(Math.abs(p.worldX - AUBURY.x), Math.abs(p.worldZ - AUBURY.z)) <= AUBURY.tolerance;
};

export default defineTask({
    name: 'essence-mine',
    description:
        'Enters or leaves the Rune Essence Mine. `action` "enter" walks to Aubury in the Varrock rune shop (3252,3402) ' +
        'and uses his Teleport option (no dialog); done once inside the mine (x 2880-2943, z 4800-4863). ' +
        '`action` "leave" uses the nearest Portal in the mine; with no portal in view it walks to the nearest known one; done once outside.',
    rules: ['`enter` needs Rune Mysteries complete; otherwise it fails "Rune Mysteries is not complete".'],
    spots: [
        'Used before the mining task (rock "essence", onFull "stop") to mine the essence, and the runecraft task to craft it.',
    ],
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

    steps: [
        {
            name: 'finish',
            when: ctx => (ctx.params.action === 'enter') === inEssenceMine(ctx.state()),
            run: ctx => ({ done: ctx.params.action === 'enter' ? 'in the essence mine' : 'left the essence mine' }),
        },
        {
            name: 'walk-to-aubury',
            when: ctx => ctx.params.action === 'enter' && !atAubury(ctx) && !nearestAubury(ctx),
            *run(ctx) {
                const before = ctx.distanceTo(AUBURY.x, AUBURY.z);
                const r = yield* walkTo(ctx, AUBURY.x, AUBURY.z, AUBURY.tolerance);
                if (r.ok || timedOutAdvancing(r, before, ctx.distanceTo(AUBURY.x, AUBURY.z))) {
                    WALK_FAILS.clear(ctx);
                    return;
                }
                yield* log(`walk to Aubury failed (${r.reason}): ${r.message}`);
                return WALK_FAILS.missWith(ctx, `${FAIL_LIMIT} walks in a row failed: ${r.message}`);
            },
        },
        {
            name: 'teleport',
            when: ctx => ctx.params.action === 'enter',
            *run(ctx) {
                const aubury = nearestAubury(ctx);
                if (!aubury) {
                    const failed = NO_AUBURY.missWith(ctx, 'no reachable Aubury in sight');
                    if (failed) return failed;
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                NO_AUBURY.clear(ctx);
                const cursor = messageCursor(ctx.state());
                const sent = yield* interactNpc(aubury, TELEPORT_OPTION);
                if (!sent.ok && sent.reason === 'no-option')
                    return { fail: `Aubury has no Teleport option (${aubury.options.join(', ')})` };
                if (!sent.ok)
                    return TELEPORT_FAILS.missWith(ctx, `${FAIL_LIMIT} teleports in a row failed: ${sent.message}`);
                const w = yield* wait(
                    'teleport to the essence mine',
                    s =>
                        inEssenceMine(s) ||
                        !!messageSince(s, cursor, NOT_QUEST) ||
                        !!messageSince(s, cursor, CANT_REACH),
                    TELEPORT_WAIT_TICKS,
                );
                if (inEssenceMine(w.state)) return;
                if (messageSince(w.state, cursor, NOT_QUEST)) return { fail: 'Rune Mysteries is not complete' };
                const why = messageSince(w.state, cursor, CANT_REACH) ? 'cannot reach Aubury' : 'no teleport in time';
                yield* log(`teleport failed: ${why}`);
                return TELEPORT_FAILS.missWith(ctx, `${FAIL_LIMIT} teleports in a row failed: ${why}`);
            },
        },
        {
            name: 'portal',
            when: () => true,
            *run(ctx) {
                const portal = nearestReachableLoc(
                    ctx,
                    l => PORTAL.test(l.name) && l.options.some(o => USE_OPTION.test(o)),
                );
                if (!portal) {
                    // None in view: walk to the nearest known portal, then look again.
                    const known = nearestPoint(ctx, ESSENCE_PORTALS);
                    const failed = NO_PORTAL.missWith(
                        ctx,
                        `no reachable Portal in sight (known portals: ${ESSENCE_PORTALS.map(p => `(${p.x},${p.z})`).join(' ')}; nearest (${known.x},${known.z}) is ${Math.round(ctx.distanceTo(known.x, known.z))} tiles away)`,
                    );
                    if (failed) return failed;
                    const r = yield* walkTo(ctx, known.x, known.z, PORTAL_TOLERANCE);
                    if (!r.ok)
                        yield* log(`walk to the portal at (${known.x},${known.z}) failed (${r.reason}): ${r.message}`);
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                NO_PORTAL.clear(ctx);
                const used = yield* interactLoc(portal, USE_OPTION);
                if (used.ok) {
                    const w = yield* wait('leave the essence mine', s => !inEssenceMine(s), PORTAL_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log(`portal at (${portal.x},${portal.z}) did not take us out`);
                return PORTAL_FAILS.missWith(
                    ctx,
                    `${FAIL_LIMIT} portal uses in a row failed at (${portal.x},${portal.z}); try another portal`,
                );
            },
        },
    ],
});
