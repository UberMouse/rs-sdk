// Runs a task through executeTask on a scripted timeline, with in-memory sinks and no server.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import type { Pathfinder } from '../actions/paths';
import { TimelineDriver, type TimelineOptions } from '../core/drivers/timeline';
import type { Command } from '../core/op';
import { executeTask } from '../lib/engine';
import type { StopCondition } from '../lib/stop';
import type { Sinks, TaskResult } from '../lib/task';
import { straightPaths } from './paths';
import { consume } from './react';

/** The engine's own grace is 30s, so a task that never finishes would stall a unit test; a simulation needs milliseconds. */
export const SIMULATE_STEP_GRACE_MS = 200;

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
    /** Fakes for the legacy `bot.*` methods a step calls through `call` (anything else throws). */
    bot?: Partial<BotActions>;
    stops?: StopCondition[];
    /** Wall-clock grace for a step to wind down once ended; defaults to SIMULATE_STEP_GRACE_MS. */
    stepGraceMs?: number;
    /** A driver of your own (a TimelineDriver subclass) in place of `timeline`, `respond` and `scan`. */
    driver?: TimelineDriver;
    /** The run's events land here, so a test can interleave its own records with them. */
    events?: Record<string, unknown>[];
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
    // Legacy steps act through BotActions and the SDK. Only the SDK's tick wait is faked (hence the
    // casts); a bot.* call throws, naming the method, unless the test faked it. The engine's eat as a
    // run ends catches its throw.
    const fakes = opts.bot ?? {};
    const bot = new Proxy({} as BotActions, {
        get: (_target, name) => {
            const fake = fakes[name as keyof BotActions];
            if (fake) return fake;
            throw new Error(`simulate fakes no bot.${String(name)}`);
        },
    });
    const sdk = {
        waitForTicks: async (n: number) => {
            for (let i = 0; i < n; i++) await driver.nextTick();
            return driver.state();
        },
    } as unknown as BotSDK;
    const result = await executeTask(task, {
        driver,
        sinks,
        bot,
        sdk,
        botName: 'tester',
        runId: 'run-1',
        logFile: '/logs/run-1.ndjson',
        rawParams: opts.params ?? {},
        stops: opts.stops ?? [],
        stepGraceMs: opts.stepGraceMs ?? SIMULATE_STEP_GRACE_MS,
        pathfinder: opts.pathfinder ?? straightPaths(),
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
