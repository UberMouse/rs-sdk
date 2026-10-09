// Engine-test helpers over `simulate`: a task from bare steps, and the options the defs carry.
import { z } from 'zod/v4';
import type { BotWorldState } from '../../../sdk/types';
import type { AllowableGuard, TaskGuard } from '../../lib/interrupts';
import { defineTask, type Step } from '../../lib/task';
import { simulate, type SimulateOptions } from '../simulate';

export interface RunOptions extends Omit<SimulateOptions, 'timeline'> {
    stuckAfterMs?: number;
    stepTimeoutMs?: number;
    allow?: AllowableGuard[];
    guards?: TaskGuard[];
}

/** Runs `def` on a scripted timeline (or `opts.driver`), with in-memory sinks. */
export function runDef(def: Parameters<typeof simulate>[0], states: BotWorldState[], opts: RunOptions = {}) {
    return simulate(def, { ...opts, timeline: states });
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
        ...(opts.guards && { guards: opts.guards }),
    });
    return runDef(def, states, opts);
}
