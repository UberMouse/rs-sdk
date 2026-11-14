// A quest written in story order (design: conductor/docs/quest-layer.md). `defineQuest` compiles its steps to a plan
// whose phases are chosen by one cursor: the step the story is at, re-derived from the view at every selection, so
// a quest resumes on any save and needs no record of its own on disk.
import type { z } from 'zod/v4';
import journalTask from '../tasks/journal';
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
}

/** A `reached` that reads the quest's journal. */
export const journal = (pattern: RegExp): JournalMark => ({ journal: pattern });

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
    /** Merged over QUEST_DEFAULTS. */
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

/** A journal read now would destroy the open dialog or modal (tasks/journal.ts). */
const blocked = (v: PlanView) => v.state.dialog.isOpen || v.state.modalOpen;

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
    const j = lastStep(q, v);
    const ranPast = (i: number) => j !== undefined && (j > i || (j === i && v.last?.status === 'done'));
    const passed = (s: QuestStep, i: number): boolean | 'provisional' => {
        if (s.skip && call(s, 'skip', s.skip)) return true;
        if (s.until && call(s, 'until', s.until)) return true;
        if (s.done) return call(s, 'done', s.done);
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

/** Checks the quest and compiles it to a plan that ends done when the quest tab shows the quest complete. */
export function defineQuest(q: QuestDef): PlanDef {
    if (!QUESTS[q.id]) fail(q, `unknown quest id "${q.id}"; see QUESTS in lib/quests.ts`);
    if (!q.steps.length) fail(q, 'has no steps');
    const seen = new Set<string>();
    for (const s of q.steps) {
        if (s.name === JOURNAL_PHASE) fail(q, `step "${s.name}": the name is the journal read's`);
        if (seen.has(s.name)) fail(q, `step "${s.name}": name used twice`);
        seen.add(s.name);
        if (s.reached !== undefined && isMark(s.reached) && (s.reached.journal.global || s.reached.journal.sticky))
            fail(q, `step "${s.name}": journal pattern ${s.reached.journal} has the g or y flag`);
    }
    const marked = q.steps.some(s => s.reached !== undefined && isMark(s.reached));
    const read = (v: PlanView) => needsRead(q, v);
    const phases: Phase[] = q.steps.map((s, i) => ({
        name: s.name,
        task: s.task,
        params: s.params,
        when: v => !read(v) && cursor(q, v) === i,
        ...(s.until && { until: s.until }),
        ...(s.onFail !== undefined && { onFail: s.onFail }),
        ...(s.maxFails !== undefined && { maxFails: s.maxFails }),
        ...(s.settle !== undefined && { settle: s.settle }),
    }));
    if (marked) phases.unshift(phase(journalTask, { quest: q.id }, { name: JOURNAL_PHASE, when: read }));
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
