// Runs a task through executeTask on a scripted timeline, with in-memory sinks, for the engine tests.
import { z } from 'zod/v4';
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../../sdk/types';
import { TimelineDriver } from '../../core/drivers/timeline';
import { executeTask } from '../../lib/engine';
import type { GuardName } from '../../lib/interrupts';
import type { StopCondition } from '../../lib/stop';
import { defineTask, type Sinks, type Step } from '../../lib/task';

export interface RunOptions {
    stops?: StopCondition[];
    stuckAfterMs?: number;
    stepTimeoutMs?: number;
    stepGraceMs?: number;
    allow?: GuardName[];
    driver?: TimelineDriver;
    /** The run's events land here, so a test can interleave its own records with them. */
    events?: Record<string, unknown>[];
}

/** Runs `def` on a scripted timeline (or `opts.driver`), with in-memory sinks. */
export async function runDef(def: Parameters<typeof executeTask>[0], states: BotWorldState[], opts: RunOptions = {}) {
    const driver = opts.driver ?? new TimelineDriver(states);
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
    const result = await executeTask(def, {
        driver,
        sinks,
        bot,
        sdk,
        botName: 'tester',
        runId: 'run-1',
        logFile: '/logs/run-1.ndjson',
        rawParams: {},
        stops: opts.stops ?? [],
        ...(opts.stepGraceMs !== undefined && { stepGraceMs: opts.stepGraceMs }),
    });
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
    return { result, events, printed, legacy, driver, sends };
}

/** Runs `steps` as a task named `test`. */
export function runTask(steps: Step[], states: BotWorldState[], opts: RunOptions = {}) {
    const def = defineTask({
        name: 'test',
        description: 'engine test',
        params: z.object({}),
        steps,
        ...(opts.stuckAfterMs !== undefined && { stuckAfterMs: opts.stuckAfterMs }),
        ...(opts.stepTimeoutMs !== undefined && { stepTimeoutMs: opts.stepTimeoutMs }),
        ...(opts.allow && { allow: opts.allow }),
    });
    return runDef(def, states, opts);
}
