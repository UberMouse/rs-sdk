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
import { executeTask, inventoryCounts } from './engine';
import { checkStops, describeStop, type StopCondition, validateStops } from './stop';
import type { Sinks, TaskDef, TaskResult, TaskStatus } from './task';
import { countItems, errMessage, exactName, findSkill, INVENTORY_SLOTS, TICK_MS, xpGainedSince } from './util';

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
    /** Consecutive failures of this phase tolerated under 'continue'; one more fails the plan. Default 3. */
    maxFails?: number;
}

export interface PhaseOptions {
    name?: string;
    when?: Predicate;
    until?: Predicate;
    onFail?: OnFail;
    maxFails?: number;
}

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
    return { ...opts, name: opts.name ?? task.name, task, params, maxFails: opts.maxFails ?? DEFAULT_MAX_FAILS };
}

export interface PlanDef {
    name: string;
    description?: string;
    phases: Phase[];
    /** Ends the whole plan `done`. Without it a plan runs until a stop or a failure. */
    until?: Predicate;
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
    /** A new phase run; `index` counts the plan's phase runs from 0. */
    newPhaseRun(phase: Phase, index: number): PhaseRun;
    /** Phases in a row that change nothing before the plan fails. Default DEFAULT_MAX_IDLE_PHASES. */
    maxIdlePhases?: number;
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

/** A plan predicate threw: the plan ends `error` with this message. */
class PredicateError extends Error {
    override name = 'PredicateError';
}

const pattern = (item: string | RegExp) => (typeof item === 'string' ? exactName(item) : item);

/** What the idle rail compares: total XP, inventory and position. */
function progressSignature(s: BotWorldState): string {
    const xp = s.skills.reduce((n, k) => n + k.experience, 0);
    const p = s.player;
    const inv = s.inventory.map(i => `${i.id}x${i.count}`).join(',');
    return `${xp}|${p?.worldX},${p?.worldZ},${p?.level}|${inv}`;
}

export async function runPlan(def: PlanDef, opts: RunPlanOptions): Promise<PlanResult> {
    const { botName, runId, logFile, sinks, stops } = opts;
    const maxIdlePhases = opts.maxIdlePhases ?? DEFAULT_MAX_IDLE_PHASES;
    const emit = (event: Record<string, unknown>) => sinks.event(event);
    const say = (msg: string) => sinks.print(`[plan:${def.name}] ${msg}`);

    /** The bank as last seen open in any state the plan or a phase read: item name -> count. */
    let bankCounts: Map<string, number> | null = null;
    let seen: BotWorldState | null = null;
    const observe = (s: BotWorldState): BotWorldState => {
        if (s === seen) return s;
        seen = s;
        if (s.bank.isOpen) {
            const counts = new Map<string, number>();
            for (const i of s.bank.items) counts.set(i.name, (counts.get(i.name) ?? 0) + i.count);
            bankCounts = counts;
        }
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

    const summaries = new Map<string, PhaseSummary>(
        def.phases.map(p => [
            p.name,
            { phase: p.name, task: p.task.name, runs: 0, statuses: {}, durationMs: 0, xpGained: {}, lastReason: null },
        ]),
    );
    const recent: PhaseRunRef[] = [];
    const screenshots: string[] = [];
    let loops = 0;
    let last: PlanView['last'] = null;
    const parsed = new Map<Phase, unknown>();
    const planParams = () => ({
        plan: def.name,
        phases: def.phases.map(p => ({
            phase: p.name,
            task: p.task.name,
            params: parsed.has(p) ? parsed.get(p) : p.params,
        })),
    });

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

    const finish = (status: TaskStatus, reason: string): PlanResult => {
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
        for (const sum of summaries.values()) if (sum.runs) stepRuns[sum.phase] = sum.runs;
        const result: PlanResult = {
            task: `plan:${def.name}`,
            bot: botName,
            runId,
            status,
            reason,
            params: planParams(),
            durationMs: now() - startedAt,
            loops,
            stepRuns,
            lastStep: last?.phase ?? null,
            xpGained: xpGainedSince(s, xpBefore),
            levelsGained,
            inventoryDelta,
            finalPos: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null,
            hp: p ? { current: p.hp, max: p.maxHp } : null,
            inCombat: p ? p.combat.inCombat : null,
            screenshots,
            logFile,
            phases: [...summaries.values()],
            recent,
        };
        emit({ type: 'result', ...result });
        say(`${status}: ${reason}`);
        return result;
    };

    emit({ type: 'start', plan: def.name, bot: botName, phases: planParams().phases, stops });
    say(
        `start: ${def.phases.map(p => p.name).join(', ')}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`,
    );

    // Rails before acting: a typo fails the plan now, not after an hour of its first phase.
    for (const p of def.phases) {
        const r = p.task.params.safeParse(p.params ?? {});
        if (!r.success)
            return finish(
                'error',
                `phase "${p.name}" has invalid params: ${r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
            );
        parsed.set(p, r.data);
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
    let idle: string[] = [];

    try {
        for (;;) {
            const s = observe(opts.state());
            const stop = checkStops(stops, s, xpBefore, now() - startedAt);
            if (stop) return finish('done', stop);
            const v = view(s);
            // No fight to wait out here: no phase is running, and none is started.
            if (def.until && ask(null, 'until', () => def.until!(v))) return finish('done', PLAN_UNTIL);

            const chosen = def.phases.find(
                p =>
                    p.name !== skip &&
                    (!p.when || ask(p, 'when', () => p.when!(v))) &&
                    !(p.until && ask(p, 'until', () => p.until!(v))),
            );
            skip = null;
            emit({
                type: 'select',
                phase: chosen?.name ?? null,
                inventory: inventoryCounts(s),
                free: v.free,
                bank: bankCounts ? Object.fromEntries(bankCounts) : null,
            });
            if (!chosen) return finish('failed', 'no phase applies');
            const signature = progressSignature(s);

            // Set by the external stop, which must not throw: a throw would end the phase as the
            // engine's generic error rather than the plan's, which names the predicate.
            const ext: { planEnd: End | null; error: string | null } = { planEnd: null, error: null };
            const externalStop = (state: BotWorldState): string | null => {
                // First, so the default `now` reads this state's tick.
                const st = observe(state);
                const planStop = checkStops(stops, st, xpBefore, now() - startedAt);
                if (planStop) {
                    ext.planEnd = { status: 'done', reason: planStop };
                    return planStop;
                }
                try {
                    const pv = view(st);
                    const planUntil = !!def.until && ask(null, 'until', () => def.until!(pv));
                    const phaseUntil = !planUntil && !!chosen.until && ask(chosen, 'until', () => chosen.until!(pv));
                    // Cutting a fight short would leave the next phase refused in combat: wait it out.
                    if ((!planUntil && !phaseUntil) || st.player?.combat.inCombat) return null;
                    if (!planUntil) return PHASE_UNTIL;
                    ext.planEnd = { status: 'done', reason: PLAN_UNTIL };
                    return PLAN_UNTIL;
                } catch (e) {
                    ext.error = errMessage(e);
                    return ext.error;
                }
            };

            const index = loops++;
            say(`phase ${index + 1}: ${chosen.name}`);
            const run = opts.newPhaseRun(chosen, index);
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
                    ...(opts.now && { now: opts.now }),
                    ...(opts.pathfinder && { pathfinder: opts.pathfinder }),
                });
            } finally {
                await run.close?.();
            }

            const summary = summaries.get(chosen.name)!;
            summary.runs++;
            summary.statuses[result.status] = (summary.statuses[result.status] ?? 0) + 1;
            summary.durationMs += result.durationMs;
            for (const [skill, xp] of Object.entries(result.xpGained))
                summary.xpGained[skill] = (summary.xpGained[skill] ?? 0) + xp;
            summary.lastReason = result.reason;
            recent.push({
                phase: chosen.name,
                runId: run.runId,
                logFile: run.logFile,
                status: result.status,
                reason: result.reason,
            });
            if (recent.length > RECENT_RUNS) recent.shift();
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
            if (result.status === 'done') {
                fails.delete(chosen.name);
            } else {
                const n = (fails.get(chosen.name) ?? 0) + 1;
                fails.set(chosen.name, n);
                const onFail = chosen.onFail ?? 'fail';
                const decision = typeof onFail === 'function' ? ask(chosen, 'onFail', () => onFail(result)) : onFail;
                if (decision !== 'continue') return finish(result.status, `${chosen.name}: ${result.reason}`);
                if (n > (chosen.maxFails ?? DEFAULT_MAX_FAILS))
                    return finish('failed', `${chosen.name} failed ${n} times in a row: ${result.reason}`);
                skip = chosen.name;
            }

            const after = stateOrNull();
            idle = after && progressSignature(after) === signature ? [...idle, chosen.name] : [];
            if (idle.length >= maxIdlePhases) return finish('failed', `phases make no progress: ${idle.join(', ')}`);
        }
    } catch (e) {
        if (e instanceof PredicateError) return finish('error', e.message);
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `plan threw: ${errMessage(e)}`);
    }
}
