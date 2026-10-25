import { z } from 'zod/v4';
import type { NearbyLoc } from '../../sdk/types';
import {
    CLOSE_WAIT_TICKS,
    COMBOLOCK_MAX_TICKS,
    type CombolockResult,
    lockOpen,
    type LockProgress,
    solveCombolock,
    wordValues,
} from '../actions/combolock';
import { INTERACT_WAIT_TICKS, interact } from '../actions/interaction';
import { dialogSince, messageCursor } from '../actions/messages';
import { CONVERSE_MAX_TICKS, converse, type TalkProgress } from '../actions/talk';
import { closeModalUntil } from '../actions/modal';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, send, ticks, wait } from '../core/op';
import { AtSchema, onTile, type Tile, TileSchema, walkToSpotStep } from '../lib/spot';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

/** Failed walks or interactions in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Loops (2 ticks each) the door may be out of sight before the task fails. */
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
/** Times the lock may close under the solve step (a click that closed it, a stray close) before the task gives up. */
const RELOCK_LIMIT = 3;
/** Ticks the lock gets to show after the door's dialogs have closed (the script opens it the same tick). */
const LOCK_OPEN_TICKS = 6;
/** One interaction, its dialog (CONVERSE_MAX_TICKS) and the wait for the lock fit one step; the walk is a step of its own. */
const STEP_TIMEOUT_MS = 360_000;
const STUCK_AFTER_MS = stuckWindowMs(
    CONVERSE_MAX_TICKS,
    COMBOLOCK_MAX_TICKS,
    failStreakTicks(FAIL_LIMIT, INTERACT_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

/**
 * Peer the Seer's six riddles (viking_peer.rs2 viking_seer_read_riddle), each told by the first line of its first
 * page ("My first is in ..."; the letters the four clues give spell the word). The riddle is chosen at random when
 * Peer accepts the challenge (`random(6)`), so it differs per account. Only the first page is matched: the client's
 * dialog record does not reliably keep the second.
 */
export const PEER_RIDDLES: readonly { clue: RegExp; word: string }[] = [
    { clue: /first is in mage,/i, word: 'MIND' },
    { clue: /first is in tar,/i, word: 'TREE' },
    { clue: /first is in the well,/i, word: 'LIFE' },
    { clue: /first is in fish,/i, word: 'FIRE' },
    { clue: /first is in water,/i, word: 'TIME' },
    { clue: /first is in wizard,/i, word: 'WIND' },
];

/** The two combination doors this task knows: where the door is, what it asks, and the word it takes (if fixed). */
const DOORS = {
    // quest_viking viking_seers_door1: Open starts a message box and a Read / Solve / Forget choice.
    peer: { tile: { x: 2631, z: 3667 }, word: undefined },
    // quest_totem combodoor (Handelmort Mansion): Open shows the lock at once; the password is "KURT" (quest_totem.rs2:41).
    tribal: { tile: { x: 2634, z: 3323 }, word: 'KURT' },
} as const;

const OPEN = /^open$/i;
const DOOR_NAME = /^door$/i;
const READ_THE_RIDDLE = /read the riddle/i;
const SOLVE_THE_RIDDLE = /solve the riddle/i;

/** Outside Peer's door (north of it): the trial's leave path from inside the room clears the trial items, so never open it from there. */
const PEER_OUTSIDE = { x: 2631, z: 3669 } as const;

const Params = z
    .object({
        /** Which combination door: Peer the Seer's riddle door (The Fremennik Trials) or the Tribal Totem door. */
        door: z.enum(['peer', 'tribal']).default('peer'),
        /**
         * The four-letter word to set, instead of the door's own: a tribal door takes KURT; Peer's depends on the riddle
         * the server picked, which the task reads from the door's riddle pages when this is omitted.
         */
        word: z
            .string()
            .refine(w => wordValues(w) !== undefined, 'a word of four letters')
            .optional(),
        /**
         * Where to stand first. Omit to work the door from where the bot is (the interaction walks the last tiles); Peer's
         * door defaults to the tile outside it (2631,3669), as opening it from inside leaves the trial.
         */
        at: AtSchema.optional(),
        /** The exact tile of the door loc, when other doors are near; default the chosen `door`'s own. */
        tile: TileSchema.optional(),
    })
    .transform(p => ({
        ...p,
        at: p.at ?? (p.door === 'peer' ? AtSchema.parse({ ...PEER_OUTSIDE, tolerance: 1 }) : undefined),
    }));

type Params = z.infer<typeof Params>;
interface Memory {
    /** The door interaction was sent (a cut-off step that finds its dialog open treats it as landed). */
    tried: boolean;
    /** The interaction landed: only its dialog and the lock are left. */
    sent: boolean;
    /** The message cursor from before the interaction: the riddle pages are the dialog pages after it. */
    cursor: number;
    /** Choices answered in the door's dialog. */
    progress: TalkProgress;
    /** The word the lock takes, once known (a riddle read); the `word` param and the tribal door's own are used first. */
    riddleWord: string | null;
    /** The solve's confirm state. */
    lock: LockProgress;
    /** Times the lock closed under the solve step. */
    relocks: number;
}
type Ctx = TaskContext<Params, Memory>;

/** The word to set: the param, the tribal door's own, or the word the riddle named. */
const wordOf = (ctx: Ctx): string | undefined =>
    ctx.params.word ?? DOORS[ctx.params.door].word ?? ctx.memory.riddleWord ?? undefined;

const doorTile = (ctx: Ctx): Tile => ctx.params.tile ?? DOORS[ctx.params.door].tile;

/** The door in reach: named Door, on the chosen tile, offering Open. */
function doorsInView(ctx: Ctx): NearbyLoc[] {
    const tile = doorTile(ctx);
    return ctx
        .state()
        .nearbyLocs.filter(
            l =>
                DOOR_NAME.test(l.name) &&
                onTile(l, tile) &&
                l.reachable !== false &&
                l.optionsWithIndex.some(o => OPEN.test(o.text)),
        )
        .sort((a, b) => a.distance - b.distance);
}

/** The door on the chosen tile is open already (it offers Close, not Open). */
const doorStandsOpen = (ctx: Ctx): boolean =>
    ctx
        .state()
        .nearbyLocs.some(
            l =>
                DOOR_NAME.test(l.name) &&
                onTile(l, doorTile(ctx)) &&
                l.optionsWithIndex.some(o => /^close$/i.test(o.text)),
        );

/** Forgets the interaction, so the open step sends the door again. */
function reset(ctx: Ctx): void {
    ctx.memory.tried = false;
    ctx.memory.sent = false;
    ctx.memory.progress.answered = 0;
    ctx.memory.riddleWord = null;
    ctx.memory.lock.confirmCursor = null;
}

/** Closes a lock that is open before the open step fails, so a failed run never leaves one over the inventory. */
function* closeLockIfOpen(ctx: Ctx): Op<void> {
    if (!lockOpen(ctx.state())) return;
    const c = yield* closeModalUntil(ctx, 'combination lock', s => !lockOpen(s), CLOSE_WAIT_TICKS);
    if (!c.ok) yield* log(`combination lock did not close: ${c.message}`);
}

/** The tribal door, once solved, opens like any door: the interaction's effect is the door changing or the bot passing it. */
const DOOR_OPENED = /^(the loc changed|the loc is gone|the player moved to )/;

export default defineTask({
    name: 'combolock',
    description:
        'Solves a four-wheel combination lock door: opens the door, sets the letters and confirms, done when the game says the combination is right. ' +
        '`door` "peer" (default): Peer the Seer\'s riddle door in Rellekka (2631,3667) in The Fremennik Trials, needs Peer\'s trial started ' +
        '(the door says "a combination lock ... a riddle"); `at` defaults to the tile outside it (2631,3669), never inside, as opening it from inside leaves the trial. Without `word` it chooses "Read the riddle", reads the riddle ' +
        'from the pages and sets its answer (MIND, TREE, LIFE, FIRE, TIME or WIND, picked at random by the server per account); with `word` it chooses "Solve the riddle" and sets that. ' +
        'Done sets the trial to riddle solved; the next step of the trial (empty inventory, through the door) is another task. ' +
        '`door` "tribal": the Tribal Totem door inside Handelmort Mansion (2634,3323), password KURT; done once the lock is solved (bit 0 of the door varp), after which the door opens like any door; a door that just opens with no lock (already solved, e.g. a restart) is done too. ' +
        'Each wheel is read from the interface and set by the fewest arrow clicks (A..Z wraps), so a cut-off or lost click recovers; a lock that closes under it is reopened (the wheels restart at A) up to 3 times. ' +
        "Fails with the game's refusal when the lock rejects the word, and when the riddle is not one of the six. `at` {x,z} is walked to first (Peer's default above), `tile` picks the door loc, `word` overrides the door's word. " +
        "Verified live: Peer's door (riddles MIND and WIND) and the tribal door (KURT).",
    params: Params,
    memory: (): Memory => ({
        tried: false,
        sent: false,
        cursor: 0,
        progress: { answered: 0 },
        riddleWord: null,
        lock: { confirmCursor: null },
        relocks: 0,
    }),
    // Peer's door opens a message box and a choice that the open step answers itself; the tribal door has no dialog.
    allowGuards: params => (params.door === 'peer' ? ['dialog'] : []),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    steps: [
        {
            name: 'solve',
            // The lock shows and the word is known; or a confirm was sent and its verdict is not yet read.
            when: ctx =>
                (lockOpen(ctx.state()) && wordOf(ctx) !== undefined) ||
                (ctx.memory.lock.confirmCursor !== null && !lockOpen(ctx.state())),
            *run(ctx) {
                const word = wordOf(ctx);
                if (word === undefined) return { fail: 'the lock was confirmed without a word' };
                let r: CombolockResult;
                try {
                    r = yield* solveCombolock(ctx, word, ctx.memory.lock);
                } finally {
                    // Cut off before the confirm: the lock is closed, so the door is reopened and the wheels start from A.
                    if (ctx.memory.lock.confirmCursor === null) reset(ctx);
                }
                if (r.ok) return { done: `combination lock solved: ${r.message}` };
                yield* log(`combination lock ${word} failed (${r.reason}): ${r.message}`);
                if (r.reason === 'closed' || r.reason === 'not-open') {
                    if (++ctx.memory.relocks > RELOCK_LIMIT)
                        return { fail: `the lock closed ${RELOCK_LIMIT} times while setting it: ${r.message}` };
                    reset(ctx);
                    return;
                }
                return { fail: `${r.reason}: ${r.message}` };
            },
        },
        {
            // A lock is open that this run cannot answer: left from before, or opened without reading the riddle.
            name: 'reopen',
            when: ctx => lockOpen(ctx.state()),
            *run(ctx) {
                if (++ctx.memory.relocks > RELOCK_LIMIT)
                    return {
                        fail: `a combination lock is open but no word is known for it (${RELOCK_LIMIT} reopens tried)`,
                    };
                yield* log('a combination lock is open with no known word: closing it to read the riddle again');
                reset(ctx);
                const closed = yield* closeModalUntil(ctx, 'combination lock', s => !lockOpen(s), CLOSE_WAIT_TICKS);
                if (!closed.ok) return { fail: `could not close the combination lock: ${closed.message}` };
            },
        },
        walkToSpotStep<Params, Memory>(FAIL_LIMIT),
        {
            name: 'open',
            when: () => true,
            *run(ctx) {
                const m = ctx.memory;
                const { door } = ctx.params;
                if (m.tried && !m.sent && ctx.state().dialog.isOpen) m.sent = true;
                if (!m.sent) {
                    const target = doorsInView(ctx)[0];
                    const missing = ctx.streak('missing');
                    if (!target) {
                        if (door === 'tribal' && doorStandsOpen(ctx))
                            return { done: 'the tribal door already stands open: already solved' };
                        if (missing.add() >= MISSING_LIMIT) {
                            const t = doorTile(ctx);
                            return { fail: `no reachable Door with an Open option at (${t.x},${t.z}) in sight` };
                        }
                        yield* ticks(MISSING_WAIT_TICKS);
                        return;
                    }
                    missing.reset();
                    if (!m.tried) m.cursor = messageCursor(ctx.state());
                    m.tried = true;
                    const r = yield* interact(ctx, { kind: 'loc', loc: target }, OPEN);
                    const fails = ctx.streak('interactFails');
                    if (!r.ok) {
                        yield* log(`Open Door failed (${r.reason}): ${r.message}`);
                        // Only a send that never landed is repeated: an Open sent twice can undo itself.
                        if (r.reason !== 'send-failed' && r.reason !== 'rejected')
                            return { fail: `${r.reason}: ${r.message}` };
                        m.tried = false;
                        if (fails.add() >= FAIL_LIMIT)
                            return { fail: `${FAIL_LIMIT} tries in a row failed (last ${r.reason}: ${r.message})` };
                        return;
                    }
                    fails.reset();
                    m.sent = true;
                    // Already solved (a restart): no lock shows, the door just opens.
                    if (door === 'tribal' && DOOR_OPENED.test(r.effect) && !lockOpen(ctx.state()))
                        return { done: `the tribal door opened with no lock: already solved (${r.effect})` };
                }
                if (door === 'peer') {
                    // Without a word, read the riddle (its pages follow); with one, go straight to solving.
                    const choice = ctx.params.word === undefined ? READ_THE_RIDDLE : SOLVE_THE_RIDDLE;
                    const c = yield* converse(ctx, [choice], m.progress);
                    if (!c.ok) {
                        if (ctx.state().dialog.isOpen)
                            yield* send({ type: 'closeModal', reason: 'close dialog after a failed choice' });
                        yield* closeLockIfOpen(ctx);
                        return { fail: `Peer's door dialog: ${c.message}` };
                    }
                    if (ctx.params.word === undefined) {
                        const seen = PEER_RIDDLES.find(r => dialogSince(ctx.state(), m.cursor, r.clue) !== null);
                        if (!seen) {
                            yield* closeLockIfOpen(ctx);
                            return {
                                fail: 'the riddle is not one of the six known (no clue line matched the pages read)',
                            };
                        }
                        m.riddleWord = seen.word;
                        yield* log(`riddle read: the answer is ${seen.word}`);
                    }
                }
                const opened = yield* wait('combination lock opens', lockOpen, LOCK_OPEN_TICKS);
                if (opened.kind === 'timeout') {
                    return {
                        fail: `the door opened no combination lock (${door === 'tribal' ? 'no change to the door either' : 'trial not started or riddle already solved?'})`,
                    };
                }
            },
        },
    ],
});
