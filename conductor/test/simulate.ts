// Runs a task through executeTask on a scripted timeline, with in-memory sinks and no server.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { ActionResult, BotAction, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { TimelineDriver } from '../core/drivers/timeline';
import type { Command } from '../core/op';
import { executeTask } from '../lib/engine';
import type { StopCondition } from '../lib/stop';
import type { Sinks, TaskResult } from '../lib/task';

export interface SimulateOptions {
    /** Raw params, as `--params` would give them. */
    params?: unknown;
    /** The world, one state per tick; the last repeats with the tick advancing (see TimelineDriver). */
    timeline?: BotWorldState[];
    /** Answers a send; undefined answers success. */
    respond?: (action: BotAction) => ActionResult | undefined;
    /** What `scan` returns. */
    scan?: (radius?: number) => NearbyLoc[];
    stops?: StopCondition[];
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
    /** What the guards did through the bot, as "eat <food>" and "dismiss". */
    legacy: string[];
    driver: TimelineDriver;
}

/** Runs `task` on the scripted world and reports what it did. */
export async function simulate(task: Parameters<typeof executeTask>[0], opts: SimulateOptions): Promise<Simulation> {
    const { timeline, respond, scan } = opts;
    if (!opts.driver && !timeline?.length) throw new Error('simulate needs a timeline or a driver');
    const driver = opts.driver ?? new TimelineDriver(timeline ?? [], { respond, scan });
    const events = opts.events ?? [];
    const printed: string[] = [];
    const legacy: string[] = [];
    const sinks: Sinks = {
        event: e => events.push(e),
        print: line => printed.push(line),
        screenshot: async label => `/shots/${label}.png`,
    };
    // The guards still act through BotActions and the SDK. Only what they call is faked (hence
    // the casts), and each fake takes a tick, as the game would.
    const bot = {
        eatFood: async (food: InventoryItem) => {
            legacy.push(`eat ${food.name}`);
            await driver.nextTick();
            return { success: true, message: 'ate' };
        },
        dismissBlockingUI: async () => {
            legacy.push('dismiss');
            await driver.nextTick();
        },
    } as unknown as BotActions;
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
        ...(opts.stepGraceMs !== undefined && { stepGraceMs: opts.stepGraceMs }),
    });
    return {
        result,
        commands: driver.commands,
        steps: events.flatMap(e => (e.type === 'step' ? [String(e.step)] : [])),
        sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : [])),
        events,
        printed,
        legacy,
        driver,
    };
}
