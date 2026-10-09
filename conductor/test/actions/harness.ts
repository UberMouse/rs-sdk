// Runs one op to completion on a scripted timeline, for the op unit tests.
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { ActionContext } from '../../actions/context';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { type Guard, interpret } from '../../core/interpret';
import type { Op } from '../../core/op';

export interface OpRun<T> {
    result: T;
    driver: TimelineDriver;
    /** Every action sent, in order. */
    sends: BotAction[];
}

/** Runs the op `make` builds on `states`, with `guards` on; fails the test if it does not return. */
export async function runOp<T>(
    states: BotWorldState[],
    make: (ctx: ActionContext) => Op<T>,
    opts: TimelineOptions & { guards?: Guard[] } = {},
): Promise<OpRun<T>> {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(make(driver), { driver, guards: opts.guards });
    if (r.kind !== 'returned') throw new Error(`op did not return: ${JSON.stringify(r)}`);
    return {
        result: r.value,
        driver,
        sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : [])),
    };
}

/** A send the client refuses. */
export const refuse = () => ({ success: false, message: 'not connected' });
