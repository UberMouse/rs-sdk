import { z } from 'zod/v4';
import type { NearbyLoc, NearbyNpc } from '../../sdk/types';
import {
    CONVERSE_MAX_TICKS,
    converse,
    startTalk,
    TALK_OPEN_TICKS,
    TALK_OPTION,
    type TalkProgress,
} from '../actions/talk';
import { useItemOnLoc } from '../actions/use';
import { timedOutAdvancing, WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, send, ticks } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

/** Failed walks, talks or uses in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Loops (2 ticks each) the NPC or loc may be out of sight before the task fails. */
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
const DEFAULT_TOLERANCE = 3;
/** A walk, then a conversation of up to CONVERSE_MAX_TICKS: both fit one step. */
const STEP_TIMEOUT_MS = 360_000;
/** A conversation changes nothing the watchdog sees until its item arrives: outlast the longest. */
const STUCK_AFTER_MS = stuckWindowMs(
    CONVERSE_MAX_TICKS,
    failStreakTicks(FAIL_LIMIT, TALK_OPEN_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

/** The walk's failure reasons that retrying cannot fix. */
const FINAL_WALK_FAILURES: readonly string[] = ['no-path', 'no-connector', 'bad-coordinates'];

const isPattern = (source: string) => {
    try {
        void new RegExp(source, 'i');
        return true;
    } catch {
        return false;
    }
};
const Pattern = z.string().refine(isPattern, 'not a valid regular expression');
const matcher = (source: string) => new RegExp(source, 'i');

const Params = z
    .object({
        /** Name (case-insensitive regex) of the NPC to talk to; omit for a run that only uses items. */
        npc: Pattern.optional(),
        /** Where to stand first: walked to (across floors, through doors) unless already within `tolerance`. */
        at: z
            .object({
                x: z.number(),
                z: z.number(),
                level: z.number().int().optional(),
                tolerance: z.number().int().min(1).default(DEFAULT_TOLERANCE),
            })
            .optional(),
        /** The NPC option that starts the conversation (regex on its text); default "Talk-to". */
        option: Pattern.default(TALK_OPTION.source),
        /**
         * The choices of the conversation, in order: a regex on the text of the option to click at each
         * multi-option page. "Click here to continue" pages need no entry.
         */
        choices: z.array(Pattern).default([]),
        /**
         * Inventory items (name regexes) to use, one each in order, on a loc (name regex) before the
         * conversation: raw meats on the Cauldron of Thunder.
         */
        use: z.object({ items: z.array(Pattern).min(1), onLoc: Pattern }).optional(),
    })
    .refine(p => p.npc !== undefined || p.use !== undefined, 'give an npc to talk to, a use, or both');

type TalkParams = z.infer<typeof Params>;
interface TalkMemory {
    /** Items of `use` already used. */
    used: number;
    /** Choices answered in the open conversation (converse updates it at each click). */
    progress: TalkProgress;
}
type Ctx = TaskContext<TalkParams, TalkMemory>;

/** Within `tolerance` tiles of `at` as walkTo counts them (Chebyshev, not straight-line), on its level. */
const atSpot = (ctx: Ctx) => {
    const { at } = ctx.params;
    const p = ctx.state().player;
    if (!at || !p) return true;
    return (
        Math.max(Math.abs(p.worldX - at.x), Math.abs(p.worldZ - at.z)) <= at.tolerance &&
        (at.level === undefined || p.level === at.level)
    );
};
const usesLeft = (ctx: Ctx) => ctx.params.use !== undefined && ctx.memory.used < ctx.params.use.items.length;

/** The nearest reachable NPC of that name that has the conversation's option. */
function findNpc(ctx: Ctx): NearbyNpc | undefined {
    const name = ctx.params.npc && matcher(ctx.params.npc);
    const option = matcher(ctx.params.option);
    return ctx
        .state()
        .nearbyNpcs.filter(
            n => name && name.test(n.name) && n.reachable !== false && n.options.some(o => option.test(o)),
        )
        .sort((a, b) => a.distance - b.distance)[0];
}

/** ", N out of reach" when matching NPCs stand in view but the client cannot route to them (walk closer, or open the way). */
function unreachableNote(ctx: Ctx): string {
    const name = ctx.params.npc && matcher(ctx.params.npc);
    const n = ctx.state().nearbyNpcs.filter(x => name && name.test(x.name) && x.reachable === false).length;
    return n > 0 ? ` (${n} in view but unreachable from here)` : '';
}

function findLoc(ctx: Ctx): NearbyLoc | undefined {
    const name = ctx.params.use && matcher(ctx.params.use.onLoc);
    return ctx
        .state()
        .nearbyLocs.filter(l => name && name.test(l.name) && l.reachable === true)
        .sort((a, b) => a.distance - b.distance)[0];
}

export default defineTask({
    name: 'talk',
    description:
        'Talk to an NPC and answer its dialog from a list of choices, e.g. to do a quest step. Params: `npc` (name regex), `at` {x,z,level?,tolerance?} ' +
        '(walked to first, across floors and through doors), `option` (default "Talk-to"), `choices` (regexes on the option text, one per multi-option page, in order; ' +
        '"click here to continue" pages pass by themselves), optional `use` {items, onLoc} (uses each inventory item on a nearby loc first; with no `npc` the run ends after the uses). ' +
        "Done once the dialog has closed after the last choice. Fails with the dialog's options when an expected option is missing or an unexpected choice appears, " +
        'and when the dialog closes with choices left. E.g. {"npc":"Duke Horacio","at":{"x":3210,"z":3220,"level":1},"choices":["quests for me","Sure"]}. ' +
        'Recipes and hazards: wiki/quests/rune-mysteries.md, learnings/hazards.md (Varrock stone circle dark wizards).',
    params: Params,
    memory: (): TalkMemory => ({ used: 0, progress: { answered: 0 } }),
    // The conversation is a dialog this task opens and answers itself: the dialog guard must not click under it.
    allow: ['dialog'],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const { at } = ctx.params;
        if (at && squareReachesWilderness(at.x, at.z, 0)) return `(${at.x},${at.z}) is in the Wilderness`;
        return null;
    },

    steps: [
        {
            name: 'walk',
            when: ctx => !!ctx.params.at && !!ctx.state().player && !ctx.state().dialog.isOpen && !atSpot(ctx),
            *run(ctx) {
                const { at } = ctx.params;
                // Narrowing only: when() guarantees it.
                if (!at) return;
                const before = ctx.distanceTo(at.x, at.z);
                const r = yield* walkTo(
                    ctx,
                    at.x,
                    at.z,
                    at.tolerance,
                    at.level === undefined ? {} : { level: at.level },
                );
                const fails = ctx.streak('walkFails');
                // `ok` while not at the spot (another floor, a different measure) must count as a failure, or this loops.
                if ((r.ok && atSpot(ctx)) || timedOutAdvancing(r, before, ctx.distanceTo(at.x, at.z))) {
                    fails.reset();
                    return;
                }
                const why = r.ok ? 'ended away from the spot' : r.reason;
                yield* log(`walk to (${at.x},${at.z}) failed (${why}): ${r.message}`);
                if (!r.ok && FINAL_WALK_FAILURES.includes(r.reason))
                    return { fail: `can't walk to (${at.x},${at.z}): ${r.message}` };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} walks in a row failed toward (${at.x},${at.z}); last: ${r.message}` };
            },
        },
        {
            name: 'use-items',
            when: usesLeft,
            *run(ctx) {
                const use = ctx.params.use;
                // Narrowing only: when() guarantees it.
                if (!use) return;
                const pattern = use.items[ctx.memory.used];
                const item = pattern && ctx.state().inventory.find(i => matcher(pattern).test(i.name));
                if (!pattern || !item)
                    return { fail: `no item matching /${pattern}/ in the inventory to use on ${use.onLoc}` };
                const loc = findLoc(ctx);
                const missing = ctx.streak('noLoc');
                if (!loc) {
                    if (missing.add() >= MISSING_LIMIT) return { fail: `no reachable ${use.onLoc} in sight` };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const used = yield* useItemOnLoc(ctx, item, loc);
                const fails = ctx.streak('useFails');
                if (used.ok) {
                    fails.reset();
                    ctx.memory.used++;
                    yield* log(`used ${item.name} on ${loc.name}`);
                    return;
                }
                yield* log(`using ${item.name} on ${loc.name} failed: ${used.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} uses in a row failed (last: ${used.message})` };
            },
        },
        {
            name: 'finish',
            when: ctx => ctx.params.npc === undefined,
            run: ctx => ({
                done: `used ${ctx.memory.used} item${ctx.memory.used === 1 ? '' : 's'} on ${ctx.params.use?.onLoc}`,
            }),
        },
        {
            name: 'talk',
            when: () => true,
            *run(ctx) {
                const { progress } = ctx.memory;
                // A stray dialog (not our conversation) while the walk or the uses are still due: close it, let those steps run.
                if (ctx.state().dialog.isOpen && progress.answered === 0 && (!atSpot(ctx) || usesLeft(ctx))) {
                    yield* send({ type: 'closeModal', reason: 'close a stray dialog before walking or using' });
                    yield* ticks(1);
                    return;
                }
                if (!ctx.state().dialog.isOpen) {
                    // A new conversation; an open dialog is one a cut-off step left, resumed where it was.
                    progress.answered = 0;
                    const npc = findNpc(ctx);
                    const missing = ctx.streak('noNpc');
                    if (!npc) {
                        if (missing.add() >= MISSING_LIMIT)
                            return { fail: `no reachable /${ctx.params.npc}/ in sight${unreachableNote(ctx)}` };
                        yield* ticks(MISSING_WAIT_TICKS);
                        return;
                    }
                    missing.reset();
                    const started = yield* startTalk(ctx, npc, matcher(ctx.params.option));
                    const fails = ctx.streak('talkFails');
                    if (!started.ok) {
                        yield* log(`talking to ${npc.name} failed: ${started.message}`);
                        if (fails.add() >= FAIL_LIMIT)
                            return {
                                fail: `${FAIL_LIMIT} tries to talk to ${npc.name} failed (last: ${started.message})`,
                            };
                        return;
                    }
                    fails.reset();
                }
                const choices = ctx.params.choices.map(matcher);
                const r = yield* converse(ctx, choices, progress);
                if (r.ok)
                    return {
                        done: `talked to ${ctx.params.npc}, ${r.answered} choice${r.answered === 1 ? '' : 's'} made`,
                    };
                // Leave no dialog open behind a failed run.
                if (ctx.state().dialog.isOpen)
                    yield* send({ type: 'closeModal', reason: 'close dialog after a failed talk' });
                return { fail: r.message };
            },
        },
    ],
});
