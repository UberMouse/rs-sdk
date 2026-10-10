// Runs a task through executeTask on a scripted timeline, with in-memory sinks and no server.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import type { Pathfinder } from '../actions/paths';
import { TimelineDriver, type TimelineOptions } from '../core/drivers/timeline';
import type { Command } from '../core/op';
import { executeTask, type ExecuteOptions } from '../lib/engine';
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
