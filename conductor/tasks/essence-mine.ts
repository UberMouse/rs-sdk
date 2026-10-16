import { z } from 'zod/v4';
import { interactLoc } from '../actions/interact';
import { CANT_REACH, messageCursor, messageSince } from '../actions/messages';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, send, ticks, wait } from '../core/op';
import {
    ESSENCE_PORTALS,
    inEssenceMine,
    nearestPoint,
    nearestReachableLoc,
    PORTAL,
    USE_OPTION,
} from '../lib/runecraft';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Aubury's rune shop, south-east Varrock (the rune-mysteries plan's stand). */
const AUBURY = { name: /^aubury$/i, x: 3252, z: 3402, tolerance: 3 };
const TELEPORT_OPTION = /^teleport$/i;
const NOT_QUEST = /need to have completed the Rune Mysteries/i;

/** aubury.rs2: the curse casts, p_delay(4), then the jump; the portal: p_delay(1). Generous for a lagging tick. */
const TELEPORT_WAIT_TICKS = 15;
/** The portal is walked to first, up to a corner to corner of the 64-tile mine (2 tiles a tick running), then p_delay(1). */
const PORTAL_WAIT_TICKS = 40;
const FAIL_LIMIT = 3;
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
const PORTAL_TOLERANCE = 2;
const STEP_TIMEOUT_MS = 360_000;
const STUCK_AFTER_MS = stuckWindowMs(
    failStreakTicks(FAIL_LIMIT, TELEPORT_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, PORTAL_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

const Params = z.object({
    /** `enter`: Aubury teleports the bot into the mine. `leave`: step through a portal of the mine, back to Aubury's shop. */
    action: z.enum(['enter', 'leave']),
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
        'Enter or leave the Rune Essence Mine (needs Rune Mysteries complete). `action` "enter": walks to Aubury in the Varrock rune shop (3252,3402) ' +
        'and uses his Teleport option (no dialog); done once inside the mine (map square 45_75, x 2880-2943, z 4800-4863). ' +
        '`action` "leave": uses the nearest Portal in the mine, which returns the bot beside Aubury (3253,3401) if the mine was entered through Aubury, otherwise to Sedridor in the Wizards Tower (a null exit coordinate defaults to Sedridor, essence_mine.rs2); with no portal in view it walks to the nearest known one; done once outside. ' +
        'Mine the essence with the mining task (rock "essence", onFull "stop"); craft it with the runecraft task.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

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
                const fails = ctx.streak('walkFails');
                if (r.ok || timedOutAdvancing(r, before, ctx.distanceTo(AUBURY.x, AUBURY.z))) {
                    fails.reset();
                    return;
                }
                yield* log(`walk to Aubury failed (${r.reason}): ${r.message}`);
                if (fails.add() >= FAIL_LIMIT) return { fail: `${FAIL_LIMIT} walks in a row failed: ${r.message}` };
            },
        },
        {
            name: 'teleport',
            when: ctx => ctx.params.action === 'enter',
            *run(ctx) {
                const aubury = nearestAubury(ctx);
                const missing = ctx.streak('noAubury');
                if (!aubury) {
                    if (missing.add() >= MISSING_LIMIT) return { fail: 'no reachable Aubury in sight' };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const option = aubury.optionsWithIndex.find(o => TELEPORT_OPTION.test(o.text));
                if (!option) return { fail: `Aubury has no Teleport option (${aubury.options.join(', ')})` };
                const cursor = messageCursor(ctx.state());
                const sent = yield* send({
                    type: 'interactNpc',
                    npcIndex: aubury.index,
                    optionIndex: option.opIndex,
                    reason: 'Teleport Aubury',
                });
                const fails = ctx.streak('teleportFails');
                const failed = (why: string): { fail: string } | undefined =>
                    fails.add() >= FAIL_LIMIT ? { fail: `${FAIL_LIMIT} teleports in a row failed: ${why}` } : undefined;
                if (!sent.success) return failed(sent.message);
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
                return failed(why);
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
                const missing = ctx.streak('noPortal');
                if (!portal) {
                    // None in view: walk to the nearest known portal, then look again.
                    const known = nearestPoint(ctx, ESSENCE_PORTALS);
                    if (missing.add() >= MISSING_LIMIT)
                        return {
                            fail: `no reachable Portal in sight (known portals: ${ESSENCE_PORTALS.map(p => `(${p.x},${p.z})`).join(' ')}; nearest (${known.x},${known.z}) is ${Math.round(ctx.distanceTo(known.x, known.z))} tiles away)`,
                        };
                    const r = yield* walkTo(ctx, known.x, known.z, PORTAL_TOLERANCE);
                    if (!r.ok)
                        yield* log(`walk to the portal at (${known.x},${known.z}) failed (${r.reason}): ${r.message}`);
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const used = yield* interactLoc(portal, USE_OPTION);
                const fails = ctx.streak('portalFails');
                if (used.ok) {
                    const w = yield* wait('leave the essence mine', s => !inEssenceMine(s), PORTAL_WAIT_TICKS);
                    if (w.kind === 'met') return;
                }
                yield* log(`portal at (${portal.x},${portal.z}) did not take us out`);
                if (fails.add() >= FAIL_LIMIT)
                    return {
                        fail: `${FAIL_LIMIT} portal uses in a row failed at (${portal.x},${portal.z}); try another portal`,
                    };
            },
        },
    ],
});
