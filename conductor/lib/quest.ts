// A quest written in story order (design: conductor/docs/quest-layer.md). `defineQuest` compiles its steps to a plan
// whose phases are chosen by one cursor: the step the story is at, re-derived from the view at every selection, so
// a quest resumes on any save and needs no record of its own on disk.
import type { z } from 'zod/v4';
import journalTask, { JOURNAL_WITHIN_TICKS } from '../tasks/journal';
import waitTask from '../tasks/wait';
import { journalReadBlocker } from './journal-memory';
import {
    definePlan,
    type Phase,
    type PhaseOptions,
    phase,
    type PlanDef,
    type PlanNeed,
    type PlanView,
    type Predicate,
} from './plan';
import { QUEST_TAB_REQUIRED, QUESTS } from './quests';
import type { TaskDef } from './task';

/** Evidence the story is past a step: the quest's journal, as last read, matches `pattern`. */
export interface JournalMark {
    readonly journal: RegExp;
    /**
     * Ticks the read after the step's run keeps reading for the pattern, for a stage the game moves some ticks after
     * the step's task has ended; default JOURNAL_WITHIN_TICKS (tasks/journal.ts).
     */
    readonly within?: number;
}

/**
 * A `reached` that reads the quest's journal. The match is always case-insensitive: the pattern gets the `i` flag, so
 * the cursor and the step read (which matches its source case-insensitively) agree. A flag other than `i` is refused
 * by defineQuest.
 */
export const journal = (pattern: RegExp, opts: { within?: number } = {}): JournalMark => ({
    journal: pattern.flags.includes('i') ? pattern : new RegExp(pattern.source, `${pattern.flags}i`),
    ...(opts.within !== undefined && { within: opts.within }),
});

const isMark = (r: Predicate | JournalMark): r is JournalMark => typeof r !== 'function';

export interface QuestStep {
    name: string;
    task: Phase['task'];
    params: unknown;
    /** The story is past this step: the last step whose `reached` holds sets the cursor's base. */
    reached?: Predicate | JournalMark;
    /** This step needs no run now (its item is held); checked for the steps from the base on. */
    done?: Predicate;
    /** This step does not apply now; it is passed. */
    skip?: Predicate;
    /** Ends the step's run done; a step whose `until` holds on the view is passed, as by a `done` that holds. */
    until?: Phase['until'];
    /**
     * As a phase's. The string 'continue' also moves the story on: run order passes the step once its run ended,
     * failed or done ("try this, carry on if it fails"), even when it has a `done` that does not hold; its `done`,
     * `skip` and `until` still pass it early when they hold. With a `reached` it is refused by defineQuest. A function
     * that returns 'continue' does not move the story on.
     */
    onFail?: Phase['onFail'];
    maxFails?: Phase['maxFails'];
    settle?: Phase['settle'];
}

export type StepOptions = Partial<Pick<QuestStep, 'reached' | 'done' | 'skip'>> & Omit<PhaseOptions, 'name' | 'when'>;

/** A step of `task`; `params` are type-checked against the task's schema input, as `phase` checks them. */
export function step<S extends z.ZodType, M extends object>(
    name: string,
    task: TaskDef<S, M>,
    params: z.input<S>,
    opts: StepOptions = {},
): QuestStep {
    // The phase's task type, as `phase` widens it.
    return { ...opts, name, task: phase(task, params).task, params };
}

export interface QuestDef {
    /** A QUESTS id of lib/quests.ts. */
    id: string;
    /** The plan's name. */
    name: string;
    description?: string;
    /** Merged over QUEST_TAB_REQUIRED. */
    requires?: PlanDef['requires'];
    needs?: PlanNeed[];
    needsUnless?: Predicate;
    /**
     * Merged over QUEST_DEFAULTS. A function `onFail` is allowed (as on a plan); the string 'continue' is refused:
     * it is a step's own option, and as a default it would also apply to the journal reads and the wait for completion.
     */
    defaults?: PlanDef['defaults'];
    settle?: boolean;
    /** In story order. */
    steps: QuestStep[];
}

/**
 * The compiled plan's `defaults`, so the failure policy of every phase that sets none, the journal read's included:
 * a failed run is tried again, up to 3 times in a row.
 */
export const QUEST_DEFAULTS = { onFail: 'retry', maxFails: 3 } as const satisfies PlanDef['defaults'];

/** The name of a quest's journal-read phase, which no step may take. */
const JOURNAL_PHASE = 'journal';
/** The prefix of the read after a journal-mark step, `journal:<step>`; no step's name may start with it. */
const STEP_READ_PREFIX = 'journal:';
/** The name of the wait for the quest tab once every step is passed, which no step may take. */
const COMPLETE_PHASE = 'complete';
/** Ticks of each `complete` wait. */
export const COMPLETE_WAIT_TICKS = 20;

/** A journal read now would destroy the open dialog or modal. */
const blocked = (v: PlanView) => journalReadBlocker(v.state) !== null;

/** The step index of the last acting run, or undefined when it was none of the quest's steps (or there was none). */
const lastStep = (q: QuestDef, v: PlanView): number | undefined => {
    const name = v.last?.phase;
    if (name === undefined) return undefined;
    const i = q.steps.findIndex(s => s.name === name);
    return i < 0 ? undefined : i;
};

/**
 * The cursor (the first step from the base not passed, or null), and whether any journal-mark step from the base,
 * with no `done`, is passed only provisionally: by run order, with a journal not read since. With `toCursor` it
 * stops at the cursor, so `provisional` covers only the steps before it.
 */
function walk(q: QuestDef, v: PlanView, toCursor: boolean): { at: number | null; provisional: boolean } {
    const { steps, id } = q;
    // A throw names its step and predicate: the plan runner would blame whichever phase's `when` ran the walk.
    const call = (s: QuestStep, which: string, p: Predicate): boolean => {
        try {
            return p(v);
        } catch (e) {
            throw new Error(`step "${s.name}" ${which} threw: ${e instanceof Error ? e.message : String(e)}`, {
                cause: e,
            });
        }
    };
    const holds = (s: QuestStep) => {
        const r = s.reached;
        return r !== undefined && (isMark(r) ? v.journalSays(id, r.journal) === true : call(s, 'reached', r));
    };
    let base = 0;
    for (let i = steps.length - 1; i >= 0; i--)
        if (holds(steps[i]!)) {
            base = i + 1;
            break;
        }
    // A `complete` run comes after every step: its retry is not preceded by the steps with no evidence again.
    const j = v.last?.phase === COMPLETE_PHASE ? steps.length : lastStep(q, v);
    const ranPast = (i: number) =>
        j !== undefined && (j > i || (j === i && (v.last?.status === 'done' || steps[i]!.onFail === 'continue')));
    const passed = (s: QuestStep, i: number): boolean | 'provisional' => {
        if (s.skip && call(s, 'skip', s.skip)) return true;
        if (s.until && call(s, 'until', s.until)) return true;
        // A 'continue' step is also passed by its own ended run, though its `done` does not hold.
        if (s.done) return call(s, 'done', s.done) || (s.onFail === 'continue' && ranPast(i));
        if (s.reached === undefined) return ranPast(i);
        // A predicate `reached` is passed only by the base; a journal mark also by run order until a fresh journal
        // (read since the last acting run) can confirm it.
        return isMark(s.reached) && ranPast(i) && (blocked(v) || v.journalAge(id) !== 0) && 'provisional';
    };
    let at: number | null = null;
    let provisional = false;
    for (let i = base; i < steps.length; i++) {
        const p = passed(steps[i]!, i);
        if (p === 'provisional') provisional = true;
        else if (!p) {
            at ??= i;
            if (toCursor) break;
        }
    }
    return { at, provisional };
}

/**
 * Whether the plan reads the journal before any step: the quest has a journal mark, the tab shows it started, the
 * read would close nothing, and the journal is unread, or stale after a journal-mark step, a failed run, or while a
 * journal-mark step is passed only provisionally.
 */
export function needsRead(q: QuestDef, v: PlanView): boolean {
    if (!q.steps.some(s => s.reached !== undefined && isMark(s.reached))) return false;
    if (!v.questStarted(q.id) || blocked(v)) return false;
    const age = v.journalAge(q.id);
    if (age === undefined) return true;
    if (age === 0) return false;
    const j = lastStep(q, v);
    const reached = j === undefined ? undefined : q.steps[j]!.reached;
    return (reached !== undefined && isMark(reached)) || v.lastFailed() || walk(q, v, false).provisional;
}

/**
 * The index of the step the story is at, or null when every step is passed. The base is one past the last step whose
 * `reached` holds; from it, the first step not passed (by `skip`, by `done`, by its `until` holding, or by having run:
 * see quest-layer.md).
 */
export const cursor = (q: QuestDef, v: PlanView): number | null => walk(q, v, true).at;

const fail = (q: QuestDef, msg: string): never => {
    throw new Error(`quest "${q.name}": ${msg}`);
};

/**
 * Checks the quest and compiles it to a plan that ends done when the quest tab shows the quest complete. Its phases:
 * `journal` (any read `needsRead` asks for but the next), `journal:<step>` for each journal-mark step (the read after
 * that step ended done, reading again until its pattern shows or `within` ticks pass), the steps, and `complete` (a
 * wait for the quest tab once every step is passed). One of them at most holds at a time.
 */
export function defineQuest(q: QuestDef): PlanDef {
    if (!QUESTS[q.id]) fail(q, `unknown quest id "${q.id}"; see QUESTS in lib/quests.ts`);
    if (!q.steps.length) fail(q, 'has no steps');
    if (q.defaults?.onFail === 'continue')
        fail(
            q,
            `defaults.onFail 'continue' is a step's choice ("try this, carry on if it fails"), not a quest's: as a default it would also apply to the journal reads and the wait for completion`,
        );
    const seen = new Set<string>();
    for (const s of q.steps) {
        if (s.name === JOURNAL_PHASE) fail(q, `step "${s.name}": the name is the journal read's`);
        if (s.name === COMPLETE_PHASE) fail(q, `step "${s.name}": the name is the wait for completion's`);
        if (s.name.startsWith(STEP_READ_PREFIX))
            fail(q, `step "${s.name}": a name starting "${STEP_READ_PREFIX}" is a step read's`);
        if (seen.has(s.name)) fail(q, `step "${s.name}": name used twice`);
        seen.add(s.name);
        // The step read hands the task the pattern's source alone: any flag but `i` would be lost there.
        if (s.reached !== undefined && isMark(s.reached) && s.reached.journal.flags.replace('i', '') !== '')
            fail(q, `step "${s.name}": journal pattern ${s.reached.journal} has a flag other than i`);
        if (s.onFail === 'continue' && s.reached !== undefined)
            fail(
                q,
                `step "${s.name}": onFail 'continue' with a reached: the story cannot carry on past a step it depends ` +
                    `on reaching; use the default retry, or drop reached for done`,
            );
    }
    const read = (v: PlanView) => needsRead(q, v);
    // The journal-mark step the last acting run was, when it ended done: the read then waits for its pattern.
    const markDone = (v: PlanView): number | undefined => {
        const j = lastStep(q, v);
        const r = j === undefined ? undefined : q.steps[j]!.reached;
        return v.last?.status === 'done' && r !== undefined && isMark(r) ? j : undefined;
    };
    const phases: Phase[] = [];
    if (q.steps.some(s => s.reached !== undefined && isMark(s.reached)))
        phases.push(
            phase(
                journalTask,
                { quest: q.id },
                { name: JOURNAL_PHASE, when: v => read(v) && markDone(v) === undefined },
            ),
        );
    q.steps.forEach((s, i) => {
        const r = s.reached;
        if (r === undefined || !isMark(r)) return;
        const params = { quest: q.id, expect: r.journal.source, withinTicks: r.within ?? JOURNAL_WITHIN_TICKS };
        phases.push(
            phase(journalTask, params, {
                name: `${STEP_READ_PREFIX}${s.name}`,
                when: v => read(v) && markDone(v) === i,
            }),
        );
    });
    q.steps.forEach((s, i) =>
        phases.push({
            name: s.name,
            task: s.task,
            params: s.params,
            when: v => !read(v) && cursor(q, v) === i,
            ...(s.until && { until: s.until }),
            ...(s.onFail !== undefined && { onFail: s.onFail }),
            ...(s.maxFails !== undefined && { maxFails: s.maxFails }),
            ...(s.settle !== undefined && { settle: s.settle }),
        }),
    );
    // A stage the game moves some ticks after the last step (a reward script) would otherwise leave no phase to run.
    phases.push(
        phase(
            waitTask,
            { ticks: COMPLETE_WAIT_TICKS, orFail: true },
            { name: COMPLETE_PHASE, when: v => !read(v) && cursor(q, v) === null, until: v => v.questDone(q.id) },
        ),
    );
    return definePlan({
        name: q.name,
        ...(q.description !== undefined && { description: q.description }),
        phases,
        until: v => v.questDone(q.id),
        requires: { ...QUEST_TAB_REQUIRED, ...q.requires },
        defaults: { ...QUEST_DEFAULTS, ...q.defaults },
        ...(q.needs && { needs: q.needs }),
        ...(q.needsUnless && { needsUnless: q.needsUnless }),
        ...(q.settle !== undefined && { settle: q.settle }),
    });
}
