// Runs a task through executeTask on a scripted timeline, with in-memory sinks and no server.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import type { Pathfinder } from '../actions/paths';
import type { WalkWorld } from '../lib/walk-graph';
import { TimelineDriver, type TimelineOptions } from '../core/drivers/timeline';
import type { Command } from '../core/op';
import { executeTask, type ExecuteOptions } from '../lib/engine';
import { type PhaseRun, type PlanDef, type PlanResult, runPlan, type RunPlanOptions } from '../lib/plan';
import type { StopCondition } from '../lib/stop';
import type { Sinks, TaskResult } from '../lib/task';
import { straightPaths } from './paths';
import { consume } from './react';

export interface SimulateOptions {
    /** Raw params, as `--params` would give them. */
    params?: unknown;
    /** The world, one state per tick; the last repeats with the tick advancing (see TimelineDriver). */
    timeline?: BotWorldState[];
    /** Answers a send; undefined answers success. */
    respond?: (action: BotAction) => ActionResult | undefined;
    /** What a send changes in the world (see TimelineOptions.react); default `consume`. */
    react?: TimelineOptions['react'];
    /** What `scan` returns. */
    scan?: (radius?: number) => NearbyLoc[];
    /** Routes for the walkTo op; default `straightPaths()`, open ground. */
    pathfinder?: Pathfinder;
    /** Where the walkTo op plans its way; default the world index's. */
    walkWorld?: WalkWorld;
    /** The plan's bank record the run starts with (ExecuteOptions.bank). */
    bank?: Record<string, number>;
    stops?: StopCondition[];
    /** A driver of your own (a TimelineDriver subclass) in place of `timeline`, `respond` and `scan`. */
    driver?: TimelineDriver;
    /** The run's events land here, so a test can interleave its own records with them. */
    events?: Record<string, unknown>[];
    /** Passed to executeTask as they are (ExecuteOptions). */
    externalStop?: ExecuteOptions['externalStop'];
    partOf?: string;
}

export interface Simulation {
    result: TaskResult;
    /** Every command the task yielded and the interpreter forwarded, in order. */
    commands: Command[];
    /** Names of the steps that ran, in order, a repeated step once per streak. */
    steps: string[];
    /** The `reason` of each send, in order. */
    sends: string[];
    events: Record<string, unknown>[];
    printed: string[];
    driver: TimelineDriver;
}

/** Runs `task` on the scripted world and reports what it did. */
export async function simulate(task: Parameters<typeof executeTask>[0], opts: SimulateOptions): Promise<Simulation> {
    const { timeline, respond, scan, react = consume } = opts;
    if (!opts.driver && !timeline?.length) throw new Error('simulate needs a timeline or a driver');
    const driver = opts.driver ?? new TimelineDriver(timeline ?? [], { respond, scan, react });
    const events = opts.events ?? [];
    const printed: string[] = [];
    const sinks: Sinks = {
        event: e => events.push(e),
        print: line => printed.push(line),
        screenshot: async label => `/shots/${label}.png`,
    };
    const result = await executeTask(task, {
        driver,
        sinks,
        botName: 'tester',
        runId: 'run-1',
        logFile: '/logs/run-1.ndjson',
        rawParams: opts.params ?? {},
        stops: opts.stops ?? [],
        pathfinder: opts.pathfinder ?? straightPaths(),
        ...(opts.walkWorld && { walkWorld: opts.walkWorld }),
        ...(opts.bank && { bank: opts.bank }),
        ...(opts.externalStop && { externalStop: opts.externalStop }),
        ...(opts.partOf !== undefined && { partOf: opts.partOf }),
    });
    return {
        result,
        commands: driver.commands,
        steps: events.flatMap(e => (e.type === 'step' ? [String(e.step)] : [])),
        sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : [])),
        events,
        printed,
        driver,
    };
}

export interface SimulatePlanOptions {
    /** The world, one state per tick, carried on across the phase runs (see TimelineDriver). */
    timeline?: BotWorldState[];
    respond?: SimulateOptions['respond'];
    /** What a send changes in the world; default `consume`. */
    react?: TimelineOptions['react'];
    /** A driver of your own in place of `timeline`, `respond` and `react`. */
    driver?: TimelineDriver;
    /** The plan's `--until`. */
    stops?: StopCondition[];
    maxIdlePhases?: number;
    /** The plan's clock (RunPlanOptions.now); default the runner's own. */
    now?: () => number;
    /** Changes each phase run before the runner gets it (a close of its own, sinks that fail). */
    phaseRun?: (run: PhaseRun) => PhaseRun;
    /** RunPlanOptions.onKillable. */
    onKillable?: RunPlanOptions['onKillable'];
}

/** One phase run of a simulated plan: its own log, and the result it ended with. */
export interface SimulatedPhaseRun {
    phase: string;
    runId: string;
    events: Record<string, unknown>[];
    /** Throws for a run that wrote no result (it threw). */
    readonly result: TaskResult;
}

export interface PlanSimulation {
    result: PlanResult;
    /** The plan's own log. */
    events: Record<string, unknown>[];
    runs: SimulatedPhaseRun[];
    printed: string[];
    driver: TimelineDriver;
}

/** Runs `plan` on one scripted world: each phase run picks up the timeline where the last left it. */
export async function simulatePlan(plan: PlanDef, opts: SimulatePlanOptions): Promise<PlanSimulation> {
    const { timeline, respond, react = consume } = opts;
    if (!opts.driver && !timeline?.length) throw new Error('simulatePlan needs a timeline or a driver');
    const driver = opts.driver ?? new TimelineDriver(timeline ?? [], { respond, react });
    const events: Record<string, unknown>[] = [];
    const printed: string[] = [];
    const logs: { phase: string; runId: string; events: Record<string, unknown>[] }[] = [];
    const sinksInto = (log: Record<string, unknown>[]): Sinks => ({
        event: e => log.push(e),
        print: line => printed.push(line),
        screenshot: async label => `/shots/${label}.png`,
    });
    const result = await runPlan(plan, {
        botName: 'tester',
        runId: 'plan-1',
        logFile: '/logs/plan-1.ndjson',
        sinks: sinksInto(events),
        stops: opts.stops ?? [],
        pathfinder: straightPaths(),
        state: () => driver.state(),
        nextTick: () => driver.nextTick(),
        newPhaseRun: (phase, index) => {
            const runId = `phase-${index}-${phase.name}`;
            const log: Record<string, unknown>[] = [];
            logs.push({ phase: phase.name, runId, events: log });
            const run: PhaseRun = { driver, sinks: sinksInto(log), runId, logFile: `/logs/${runId}.ndjson` };
            return opts.phaseRun ? opts.phaseRun(run) : run;
        },
        ...(opts.maxIdlePhases !== undefined && { maxIdlePhases: opts.maxIdlePhases }),
        ...(opts.now && { now: opts.now }),
        ...(opts.onKillable && { onKillable: opts.onKillable }),
    });
    const runs = logs.map(r => ({
        ...r,
        get result(): TaskResult {
            const end = r.events.find(e => e.type === 'result');
            if (!end) throw new Error(`phase run ${r.runId} wrote no result`);
            const { type: _type, ...fields } = end;
            return fields as unknown as TaskResult;
        },
    }));
    return { result, events, runs, printed, driver };
}
