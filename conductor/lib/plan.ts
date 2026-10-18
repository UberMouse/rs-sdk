// A plan composes catalog tasks: an ordered list of phases, each a whole executeTask run, chosen
// from the world state every time one ends (design: conductor/docs/plans.md). Choosing from state
// rather than from a position in a list is what lets a plan resume on any inventory.
//
// The runner does with phases what the engine does with steps: the first phase whose `when` holds
// runs; it ends early through an external stop (the plan's stops, the plan's `until`, the phase's
// `until`); its outcome either loops back to selection or ends the plan. Every phase run gets its
// own driver, log and recording from `newPhaseRun`, so each replays like a task run.
import type { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import type { Pathfinder } from '../actions/paths';
import type { Driver } from '../core/interpret';
import { executeTask, inventoryCounts, progressSignature } from './engine';
import { guardLabel } from './interrupts';
import { checkStops, describeStop, type StopCondition, validateStops } from './stop';
import type { Sinks, TaskDef, TaskResult, TaskStatus } from './task';
import { countItems, errMessage, exactName, findSkill, INVENTORY_SLOTS, TICK_MS, xpGainedSince } from './util';

/** `TaskResult.endedBy` of a run the death guard ended. */
const DEATH_GUARD = guardLabel('death');

/** What a plan's predicates read: the world now, plus what the plan has seen and done so far. */
export interface PlanView {
    state: BotWorldState;
    /** Inventory count; a string is an exact item name (case-insensitive). */
    inv(item: string | RegExp): number;
    full: boolean;
    /** Free inventory slots. */
    free: number;
    /** Bank count as last seen open during this plan; undefined until the bank has been seen open. */
    bank(item: string | RegExp): number | undefined;
    /** Base level; throws on an unknown skill. */
    level(skill: string): number;
    /** Hit points; `{ current: 0, max: 0 }` in a state with no player (the client is not in game). */
    hp: { current: number; max: number };
    /** Finished runs of that phase in this plan; throws on a name the plan has no phase for. */
    runs(phase: string): number;
    /** The previous phase run, or null before the first has ended. */
    last: { phase: string; status: TaskStatus; reason: string } | null;
}

/** Pure: no I/O, no clock, no state of its own, so every phase choice re-derives from the states. */
export type Predicate = (v: PlanView) => boolean;
export type OnFail = 'fail' | 'continue' | ((r: TaskResult) => 'fail' | 'continue');

/** Any task, whatever its params and memory types: the runner only hands it to executeTask. */
type AnyTaskDef = TaskDef<TaskDef['params'], object>;

export interface Phase {
    /** Unique in the plan; the task's name unless given. */
    name: string;
    task: AnyTaskDef;
    /** Raw params, parsed against the task's schema before the plan acts. */
    params: unknown;
    /** Whether the phase may start; default always. */
    when?: Predicate;
    /** Ends the phase `done`, checked at every tick of it; a phase whose `until` holds is not started. */
    until?: Predicate;
    /** What a `failed` or `stuck` run means for the plan; default 'fail'. */
    onFail?: OnFail;
    /** Consecutive failures of this phase that fail the plan even under 'continue'. Default DEFAULT_MAX_FAILS. */
    maxFails?: number;
}

/** A phase's optional fields, as `phase()` takes them. */
export type PhaseOptions = Partial<Pick<Phase, 'name' | 'when' | 'until' | 'onFail' | 'maxFails'>>;

export const DEFAULT_MAX_FAILS = 3;
export const DEFAULT_MAX_IDLE_PHASES = 3;
/** Phase runs `PlanResult.recent` keeps. */
const RECENT_RUNS = 3;
const PLAN_NAME = /^[a-z0-9-]+$/;
/** A registered symbol, so the brand doesn't depend on the plan and the CLI sharing one copy of this module. */
const PLAN_BRAND = Symbol.for('conductor.plan');

const PHASE_UNTIL = 'until met';
const PLAN_UNTIL = 'plan until met';

/** A phase of `task`; `params` are type-checked against the task's schema input. */
export function phase<S extends z.ZodType, M extends object>(
    task: TaskDef<S, M>,
    params: z.input<S>,
    opts: PhaseOptions = {},
): Phase {
    return { ...opts, name: opts.name ?? task.name, task, params };
}

export interface PlanDef {
    name: string;
    description?: string;
    phases: Phase[];
    /** Ends the whole plan `done`. Without it a plan runs until a stop or a failure. */
    until?: Predicate;
    /**
     * What the plan needs throughout, each keyed by what it needs (`'combat level 5+'`): checked
     * before every phase choice, and one that does not hold ends the plan `failed` with
     * `plan requires <key>`. A `when` on every phase would refuse the same, but as `no phase applies`.
     */
    requires?: Record<string, Predicate>;
}

/** A plan result's `params`: each phase's task and params. */
export interface PlanParams {
    plan: string;
    phases: { phase: string; task: string; params: unknown }[];
}

/** A phase with its params parsed against its task's schema. */
interface ParsedPhase {
    phase: Phase;
    result: ReturnType<AnyTaskDef['params']['safeParse']>;
}

/** An idle run's record, for the idle rail. */
interface IdleRun {
    name: string;
    status: TaskStatus;
    reason: string;
}

/**
 * The idle rail's verdict, or null to carry on. The plan ends once `maxIdle` phase runs in a row were
 * idle, or when a phase just ended done at once in the state it started in (`instantRepeat`). It ends
 * `done` if every idle run ended done (the phases ran out of work), `failed` if any failed or stuck.
 */
function idleEnd(
    idle: IdleRun[],
    maxIdle: number,
    instantRepeat: boolean,
    hasUntil: boolean,
): { status: 'done' | 'failed'; reason: string } | null {
    const last = idle.at(-1);
    if (last === undefined) return null;
    const allDone = idle.every(r => r.status === 'done');
    if (idle.length < maxIdle && !(instantRepeat && allDone)) return null;
    if (allDone) {
        const names = [...new Set(idle.map(r => r.name))].join(', ');
        return {
            status: 'done',
            reason: `nothing left to do: ${names} done (${last.reason})${hasUntil ? '; plan until not met' : ''}`,
        };
    }
    return {
        status: 'failed',
        reason: `phases make no progress (no XP, and each ended where it started or in a state seen since): ${idle.map(r => r.name).join(', ')}`,
    };
}

/** Each phase's params parsed against its task's schema, in plan order: the one parse a plan run reads. */
function parsePhases(def: PlanDef): ParsedPhase[] {
    return def.phases.map(p => ({ phase: p, result: p.task.params.safeParse(p.params ?? {}) }));
}

/** A plan result's params from its parsed phases. */
function paramsOf(def: PlanDef, parsed: ParsedPhase[]): PlanParams {
    return {
        plan: def.name,
        phases: parsed.map(({ phase: p, result: r }) => ({
            phase: p.name,
            task: p.task.name,
            params: r.success ? r.data : p.params,
        })),
    };
}

/**
 * The params a plan result carries, parsed against each task's schema (raw where they don't parse),
 * so the plan keys one stats variant whether it ran, failed its params check or was never run.
 */
export function planParams(def: PlanDef): PlanParams {
    return paramsOf(def, parsePhases(def));
}

/** Checks the plan's shape and brands it, so the CLI can tell a plan module's default export. */
export function definePlan(def: PlanDef): PlanDef {
    if (!PLAN_NAME.test(def.name)) throw new Error(`plan name "${def.name}" must match ${PLAN_NAME}`);
    if (!def.phases.length) throw new Error(`plan "${def.name}" has no phases`);
    const names = def.phases.map(p => p.name);
    const dups = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dups.length)
        throw new Error(
            `plan "${def.name}": phase name(s) used twice: ${dups.join(', ')}; give a repeated task a distinct \`name\``,
        );
    return Object.defineProperty({ ...def }, PLAN_BRAND, { value: true });
}

export function isPlan(x: unknown): x is PlanDef {
    return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[PLAN_BRAND] === true;
}

/** What one phase run is given: its own driver, log and recording. */
export interface PhaseRun {
    driver: Driver;
    sinks: Sinks;
    runId: string;
    logFile: string;
    /** Called once the run has its result (closing its driver and recording). */
    close?(): void | Promise<void>;
}

export interface RunPlanOptions {
    botName: string;
    runId: string;
    /** The plan's own log, reported in the result. */
    logFile: string;
    /** The plan's own log, console and screenshots; each phase run has its own (`newPhaseRun`). */
    sinks: Sinks;
    /** The plan's `--until`: `minutes:` counts from the plan's start, `xp:` from its starting XP. */
    stops: StopCondition[];
    /** Wall-clock milliseconds for durations and `minutes:` stops, also given to each phase run. Default game ticks × TICK_MS. */
    now?: () => number;
    pathfinder?: Pathfinder;
    /** Reads the world between phases. */
    state(): BotWorldState;
    /**
     * A new phase run; `index` counts the plan's phase runs from 0. `inputs.bank` is the bank record it starts with
     * (ExecuteOptions.bank), for the run's recorded inputs.
     */
    newPhaseRun(phase: Phase, index: number, inputs?: { bank?: Record<string, number> }): PhaseRun;
    /** Phases in a row that change nothing before the plan fails. Default DEFAULT_MAX_IDLE_PHASES. */
    maxIdlePhases?: number;
    /**
     * Called once, before the plan acts, with a function that adds up the plan so far as a result
     * ending `error` with `reason`, the phase run in progress counted as one that ended so: for a
     * plan killed from outside, which never returns its own. The function emits nothing.
     */
    onKillable?(killed: (reason: string) => PlanResult): void;
}

/** One phase's runs in a plan, added up. */
export interface PhaseSummary {
    phase: string;
    task: string;
    runs: number;
    statuses: Partial<Record<TaskStatus, number>>;
    durationMs: number;
    xpGained: Record<string, number>;
    lastReason: string | null;
}

/** One phase run, pointing at its log. */
export interface PhaseRunRef {
    phase: string;
    runId: string;
    logFile: string;
    status: TaskStatus;
    reason: string;
}

/**
 * A plan's result, read like any task's: `stepRuns` and `lastStep` are by phase, the totals run from
 * the plan's first state to its last. Apart from `screenshots` (one per phase run that did not end
 * `done`), its size grows with the plan's phases, not with its runs.
 */
export interface PlanResult extends TaskResult {
    /** One entry per phase, in plan order, run or not. */
    phases: PhaseSummary[];
    /** The last RECENT_RUNS phase runs, oldest first. */
    recent: PhaseRunRef[];
}

type End = { status: TaskStatus; reason: string };

/** Adds one phase run, ended as `ref` says, to its phase's summary and to `recent`. */
function tally(
    summary: PhaseSummary,
    recent: PhaseRunRef[],
    ref: PhaseRunRef,
    durationMs: number,
    xpGained: Record<string, number>,
): void {
    summary.runs++;
    summary.statuses[ref.status] = (summary.statuses[ref.status] ?? 0) + 1;
    summary.durationMs += durationMs;
    for (const [skill, xp] of Object.entries(xpGained)) summary.xpGained[skill] = (summary.xpGained[skill] ?? 0) + xp;
    summary.lastReason = ref.reason;
    recent.push(ref);
    if (recent.length > RECENT_RUNS) recent.shift();
}

/** A plan predicate threw: the plan ends `error` with this message. */
class PredicateError extends Error {
    override name = 'PredicateError';
}

const pattern = (item: string | RegExp) => (typeof item === 'string' ? exactName(item) : item);

/**
 * What the idle rail compares: total XP, inventory and position. Not HP: a phase that only waited
 * while HP regenerated (or only lost some) has made no progress.
 */
const idleSignature = (s: BotWorldState) => progressSignature(s, { hp: false });
const totalXp = (s: BotWorldState) => s.skills.reduce((n, k) => n + k.experience, 0);

export async function runPlan(def: PlanDef, opts: RunPlanOptions): Promise<PlanResult> {
    const { botName, runId, logFile, sinks, stops } = opts;
    const maxIdlePhases = opts.maxIdlePhases ?? DEFAULT_MAX_IDLE_PHASES;
    const emit = (event: Record<string, unknown>) => sinks.event(event);
    const say = (msg: string) => sinks.print(`[plan:${def.name}] ${msg}`);

    /** The bank as last seen open in any state the plan or a phase read: item name -> count. */
    let bankCounts: Map<string, number> | null = null;
    let seen: BotWorldState | null = null;
    /**
     * The client empties the bank's item list for the tick before it reports the bank closed, so the last
     * state seen open is empty whatever the bank holds. An empty list after a listed one is therefore
     * taken only once a second open tick confirms it (a bank emptied on purpose stays open at least that
     * long under withBank's close wait; one closed straight after its last withdrawal reads as before).
     */
    let sessionListed = false;
    let emptyOpenTicks = 0;
    let lastOpenTick = -1;
    const observe = (s: BotWorldState): BotWorldState => {
        if (s === seen) return s;
        seen = s;
        if (!s.bank.isOpen) {
            sessionListed = false;
            emptyOpenTicks = 0;
            return s;
        }
        if (s.tick === lastOpenTick && s.bank.items.length === 0) return s;
        lastOpenTick = s.tick;
        if (s.bank.items.length > 0) {
            sessionListed = true;
            emptyOpenTicks = 0;
        } else if (sessionListed && ++emptyOpenTicks < 2) {
            return s;
        }
        const counts = new Map<string, number>();
        for (const i of s.bank.items) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
        bankCounts = counts;
        return s;
    };
    /** A phase's driver, with every state it hands out observed for the bank memory. */
    const watched = (d: Driver): Driver => ({
        state: () => observe(d.state()),
        nextTick: () => d.nextTick().then(observe),
        send: action => d.send(action),
        scan: radius => d.scan(radius),
        log: (msg, data) => d.log(msg, data),
        screenshot: label => d.screenshot(label),
        now: () => d.now(),
    });

    const first = observe(opts.state());
    const now = opts.now ?? (() => (seen ?? first).tick * TICK_MS);
    const startedAt = now();
    const xpBefore: Record<string, number> = {};
    const levelBefore: Record<string, number> = {};
    for (const k of first.skills) {
        xpBefore[k.name] = k.experience;
        levelBefore[k.name] = k.baseLevel;
    }
    const invBefore = inventoryCounts(first);
    const respawnsBefore = first.player?.respawnCount ?? 0;

    /** Each phase with its running summary, in plan order. */
    const entries = def.phases.map(p => ({
        phase: p,
        summary: {
            phase: p.name,
            task: p.task.name,
            runs: 0,
            statuses: {},
            durationMs: 0,
            xpGained: {},
            lastReason: null,
        } as PhaseSummary,
    }));
    const summaries = new Map(entries.map(e => [e.phase.name, e.summary]));
    const recent: PhaseRunRef[] = [];
    const screenshots: string[] = [];
    let loops = 0;
    let last: PlanView['last'] = null;
    const parsed = parsePhases(def);
    const params = paramsOf(def, parsed);
    /**
     * The phase run in progress, from its start until it is added to its summary: the one a kill
     * cuts short. `result` is its own, once it has one (a kill can come while it is closing).
     */
    let inFlight: {
        phase: string;
        run: PhaseRun;
        startedAt: number;
        xpAtStart: Record<string, number>;
        result: TaskResult | null;
    } | null = null;

    const view = (s: BotWorldState): PlanView => {
        const known = bankCounts;
        return {
            state: s,
            inv: item => countItems(s, pattern(item)),
            full: s.inventory.length >= INVENTORY_SLOTS,
            free: Math.max(0, INVENTORY_SLOTS - s.inventory.length),
            bank: item => {
                if (!known) return undefined;
                const re = pattern(item);
                let n = 0;
                for (const [name, count] of known) if (re.test(name)) n += count;
                return n;
            },
            level: skill => {
                const k = findSkill(s, skill);
                if (!k) throw new Error(`unknown skill "${skill}"; skills: ${s.skills.map(x => x.name).join(', ')}`);
                return k.baseLevel;
            },
            hp: { current: s.player?.hp ?? 0, max: s.player?.maxHp ?? 0 },
            runs: name => {
                const summary = summaries.get(name);
                if (!summary) throw new Error(`no phase "${name}" in plan "${def.name}"`);
                return summary.runs;
            },
            last,
        };
    };

    /** Evaluates a plan predicate (or onFail); a throw becomes a PredicateError naming its owner. */
    const ask = <T>(owner: Phase | null, what: string, f: () => T): T => {
        try {
            return f();
        } catch (e) {
            throw new PredicateError(`${owner ? `phase "${owner.name}"` : 'plan'} ${what} threw: ${errMessage(e)}`);
        }
    };

    const stateOrNull = (): BotWorldState | null => {
        try {
            return observe(opts.state());
        } catch {
            return null;
        }
    };

    /** The plan's result from its runs so far (by default the ones added up) and the world now. */
    const build = (
        status: TaskStatus,
        reason: string,
        runs: { phases: PhaseSummary[]; recent: PhaseRunRef[]; lastStep: string | null } = {
            phases: [...summaries.values()],
            recent,
            lastStep: last?.phase ?? null,
        },
    ): PlanResult => {
        const s = stateOrNull() ?? seen ?? first;
        const levelsGained: Record<string, { from: number; to: number }> = {};
        for (const k of s.skills) {
            const from = levelBefore[k.name] ?? k.baseLevel;
            if (k.baseLevel > from) levelsGained[k.name] = { from, to: k.baseLevel };
        }
        const inventoryDelta: Record<string, number> = {};
        const invAfter = inventoryCounts(s);
        for (const name of new Set([...Object.keys(invBefore), ...Object.keys(invAfter)])) {
            const d = (invAfter[name] ?? 0) - (invBefore[name] ?? 0);
            if (d !== 0) inventoryDelta[name] = d;
        }
        const p = s.player;
        const stepRuns: Record<string, number> = {};
        for (const sum of runs.phases) if (sum.runs) stepRuns[sum.phase] = sum.runs;
        return {
            task: `plan:${def.name}`,
            bot: botName,
            runId,
            status,
            reason,
            params,
            durationMs: now() - startedAt,
            loops,
            stepRuns,
            lastStep: runs.lastStep,
            xpGained: xpGainedSince(s, xpBefore),
            levelsGained,
            inventoryDelta,
            finalPos: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null,
            hp: p ? { current: p.hp, max: p.maxHp } : null,
            inCombat: p ? p.combat.inCombat : null,
            screenshots,
            logFile,
            phases: runs.phases,
            recent: runs.recent,
        };
    };

    const finish = (status: TaskStatus, reason: string): PlanResult => {
        const result = build(status, reason);
        emit({ type: 'result', ...result });
        say(`${status}: ${reason}`);
        return result;
    };

    // Copies, so a kill's result leaves the plan's own totals as they were.
    opts.onKillable?.(reason => {
        const phases = entries.map(({ summary }) => ({
            ...summary,
            statuses: { ...summary.statuses },
            xpGained: { ...summary.xpGained },
        }));
        const runs = [...recent];
        const f = inFlight;
        if (!f) return build('error', reason, { phases, recent: runs, lastStep: last?.phase ?? null });
        const own = f.result;
        const summary = phases.find(p => p.phase === f.phase);
        if (summary)
            tally(
                summary,
                runs,
                {
                    phase: f.phase,
                    runId: f.run.runId,
                    logFile: f.run.logFile,
                    status: own?.status ?? 'error',
                    reason: own?.reason ?? reason,
                },
                own?.durationMs ?? now() - f.startedAt,
                own?.xpGained ?? xpGainedSince(stateOrNull() ?? seen ?? first, f.xpAtStart),
            );
        return build('error', reason, { phases, recent: runs, lastStep: f.phase });
    });

    emit({
        type: 'start',
        plan: def.name,
        bot: botName,
        phases: params.phases,
        requires: Object.keys(def.requires ?? {}),
        stops,
    });
    say(
        `start: ${def.phases.map(p => p.name).join(', ')}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`,
    );

    // Rails before acting: a typo fails the plan now, not after an hour of its first phase.
    for (const { phase: p, result: r } of parsed) {
        if (!r.success)
            return finish(
                'error',
                `phase "${p.name}" has invalid params: ${r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
            );
    }
    try {
        validateStops(stops, first);
    } catch (e) {
        return finish('error', errMessage(e));
    }

    /** Consecutive failures per phase, cleared when it ends `done`. */
    const fails = new Map<string, number>();
    /** The phase that just failed with 'continue', skipped by the next selection. */
    let skip: string | null = null;
    /** The phases of the current run of idle phases, in order. */
    let idle: IdleRun[] = [];
    /** The previous phase run's name when it ended done, else null. */
    let prevDone: string | null = null;
    /**
     * End states (idleSignature) of the phase runs since XP last rose. A run that ends in one of them,
     * or where it started, is idle: that catches phases that undo each other (deposit then withdraw,
     * walk there then back), each changing the state but the plan going nowhere.
     */
    const endsSinceXp = new Set<string>();
    let xpMark = totalXp(first);
    /** The phase whose run is in progress, named when the run throws. */
    let running: Phase | null = null;
    const planUntil = def.until;

    try {
        for (;;) {
            const s = observe(opts.state());
            const selectedAt = now();
            // A respawn no phase reported (between two phase runs): the plan's inventory and position
            // assumptions died with the bot, so the runner must look, not carry on.
            const respawns = (s.player?.respawnCount ?? 0) - respawnsBefore;
            if (respawns > 0)
                return finish(
                    'failed',
                    `died between phases (${respawns} respawn${respawns === 1 ? '' : 's'} since the plan started)${last ? `; last: ${last.phase} ${last.status}: ${last.reason}` : ''}`,
                );
            const stop = checkStops(stops, s, xpBefore, selectedAt - startedAt);
            if (stop) return finish('done', stop);
            const v = view(s);
            // No fight to wait out here: no phase is running, and none is started.
            if (planUntil && ask(null, 'until', () => planUntil(v))) return finish('done', PLAN_UNTIL);
            for (const [need, holds] of Object.entries(def.requires ?? {}))
                if (!ask(null, `requires "${need}"`, () => holds(v))) return finish('failed', `plan requires ${need}`);

            /** What each phase's predicates answered, in plan order up to the one chosen. */
            const checks: Record<string, string> = {};
            const answer = (p: Phase): string => {
                const { when, until } = p;
                if (p.name === skip) return 'skipped: failed last';
                if (when && !ask(p, 'when', () => when(v))) return 'when false';
                if (until && ask(p, 'until', () => until(v))) return 'until holds';
                return 'chosen';
            };
            let entry: (typeof entries)[number] | undefined;
            for (const e of entries) {
                checks[e.phase.name] = answer(e.phase);
                if (checks[e.phase.name] === 'chosen') {
                    entry = e;
                    break;
                }
            }
            skip = null;
            emit({
                type: 'select',
                phase: entry?.phase.name ?? null,
                checks,
                last,
                inventory: inventoryCounts(s),
                free: v.free,
                bank: bankCounts ? Object.fromEntries(bankCounts) : null,
            });
            if (!entry)
                return finish(
                    'failed',
                    `no phase applies${last ? ` (last: ${last.phase} ${last.status}: ${last.reason})` : ''}`,
                );
            const { phase: chosen, summary } = entry;
            const signature = idleSignature(s);

            // Set by the external stop, which must not throw: a throw would end the phase as the
            // engine's generic error rather than the plan's, which names the predicate.
            const ext: { planEnd: End | null; error: string | null } = { planEnd: null, error: null };
            /**
             * The phase's latest clock read. The engine reads the clock at the top of each check and
             * then calls externalStop, which uses that read rather than one of its own. The CLI's clock
             * reads through the phase's driver, so its recording holds every read, and the replay's
             * externalStop reads none: an extra read here would put the replay out of step with it.
             */
            let checkedAt = startedAt;
            const phaseNow = () => (checkedAt = now());
            const externalStop = (state: BotWorldState): string | null => {
                const st = observe(state);
                const planStop = checkStops(stops, st, xpBefore, checkedAt - startedAt);
                if (planStop) {
                    ext.planEnd = { status: 'done', reason: planStop };
                    return planStop;
                }
                try {
                    const pv = view(st);
                    const phaseUntil = chosen.until;
                    const planHolds = !!planUntil && ask(null, 'until', () => planUntil(pv));
                    const phaseHolds = !planHolds && !!phaseUntil && ask(chosen, 'until', () => phaseUntil(pv));
                    // Cutting a fight short would leave the next phase refused in combat: wait it out.
                    if ((!planHolds && !phaseHolds) || st.player?.combat.inCombat) return null;
                    if (!planHolds) return PHASE_UNTIL;
                    ext.planEnd = { status: 'done', reason: PLAN_UNTIL };
                    return PLAN_UNTIL;
                } catch (e) {
                    ext.error = errMessage(e);
                    return ext.error;
                }
            };

            const index = loops++;
            say(`phase ${index + 1}: ${chosen.name}`);
            running = chosen;
            // The bank as last seen open, for the phase's walks to plan a detour on (ExecuteOptions.bank).
            const bank = bankCounts ? Object.fromEntries(bankCounts) : undefined;
            const run = opts.newPhaseRun(chosen, index, bank && { bank });
            // Names the phase's own log while it runs; phase-end alone would leave a live viewer guessing.
            emit({ type: 'phase-start', phase: chosen.name, index, runId: run.runId, logFile: run.logFile });
            const flight = {
                phase: chosen.name,
                run,
                startedAt: selectedAt,
                xpAtStart: Object.fromEntries(s.skills.map(k => [k.name, k.experience])),
                result: null as TaskResult | null,
            };
            inFlight = flight;
            /** Never throws: a failed close is logged, so it can't replace the run's outcome or its error. */
            const close = async () => {
                try {
                    await run.close?.();
                } catch (e) {
                    emit({ type: 'close-error', phase: chosen.name, runId: run.runId, message: errMessage(e) });
                    say(`phase ${chosen.name}: closing run ${run.runId} threw: ${errMessage(e)}`);
                }
            };
            let result: TaskResult;
            try {
                result = await executeTask(chosen.task, {
                    driver: watched(run.driver),
                    sinks: run.sinks,
                    botName,
                    runId: run.runId,
                    logFile: run.logFile,
                    rawParams: chosen.params,
                    stops: [],
                    partOf: runId,
                    externalStop,
                    // One clock for the plan's stops and the phase's watchdog and durations.
                    now: phaseNow,
                    ...(opts.pathfinder && { pathfinder: opts.pathfinder }),
                    ...(bank && { bank }),
                });
                flight.result = result;
            } finally {
                await close();
            }
            running = null;

            tally(
                summary,
                recent,
                {
                    phase: chosen.name,
                    runId: run.runId,
                    logFile: run.logFile,
                    status: result.status,
                    reason: result.reason,
                },
                result.durationMs,
                result.xpGained,
            );
            inFlight = null;
            screenshots.push(...result.screenshots);
            last = { phase: chosen.name, status: result.status, reason: result.reason };
            emit({
                type: 'phase-end',
                phase: chosen.name,
                runId: run.runId,
                status: result.status,
                reason: result.reason,
            });

            if (ext.error) return finish('error', ext.error);
            if (ext.planEnd) return finish(ext.planEnd.status, ext.planEnd.reason);
            if (result.status === 'error') return finish('error', `${chosen.name}: ${result.reason}`);
            // A death ends the plan whatever onFail says: the runner has to see what happened.
            if (result.endedBy === DEATH_GUARD)
                // the engine's reason is `<guard>: <why>`; the phase name already says who died
                return finish('failed', `${chosen.name}: ${result.reason.replace(`${DEATH_GUARD}: `, '')}`);
            if (result.status === 'done') {
                fails.delete(chosen.name);
            } else {
                const n = (fails.get(chosen.name) ?? 0) + 1;
                fails.set(chosen.name, n);
                const onFail = chosen.onFail ?? 'fail';
                const decision = typeof onFail === 'function' ? ask(chosen, 'onFail', () => onFail(result)) : onFail;
                if (decision !== 'continue') return finish(result.status, `${chosen.name}: ${result.reason}`);
                if (n >= (chosen.maxFails ?? DEFAULT_MAX_FAILS))
                    return finish('failed', `${chosen.name} failed ${n} times in a row: ${result.reason}`);
                skip = chosen.name;
            }

            const after = stateOrNull();
            if (after && totalXp(after) > xpMark) {
                xpMark = totalXp(after);
                endsSinceXp.clear();
            }
            const end = after && idleSignature(after);
            const isIdle = end !== null && (end === signature || endsSinceXp.has(end));
            if (end !== null) endsSinceXp.add(end);
            idle = isIdle ? [...idle, { name: chosen.name, status: result.status, reason: result.reason }] : [];
            // A phase that ended done, in the state it started in, right after it ended done: chosen again
            // and finished at once, it has nothing left to do. No need to wait out the full rail.
            const instantRepeat = result.status === 'done' && end === signature && prevDone === chosen.name;
            prevDone = result.status === 'done' ? chosen.name : null;
            const ended = idleEnd(idle, maxIdlePhases, instantRepeat, planUntil !== undefined);
            if (ended) return finish(ended.status, ended.reason);
        }
    } catch (e) {
        if (e instanceof PredicateError) return finish('error', e.message);
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        if (running) return finish('error', `phase "${running.name}" threw: ${errMessage(e)}`);
        return finish('error', `plan threw: ${errMessage(e)}`);
    }
}
