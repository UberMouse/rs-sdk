// Helpers for the action integration tests: run one op on a live bot, and step aside from a tile.
import type { BotActions } from '../../../../sdk/actions';
import type { BotSDK } from '../../../../sdk/index';
import type { ActionContext } from '../../../actions/context';
import { LiveDriver } from '../../../core/drivers/live';
import { type Guard, interpret } from '../../../core/interpret';
import type { Op } from '../../../core/op';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';

const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

/** Runs the op `make` builds against the live bot, with `guards` on, and returns its result. */
export async function runLive<T>(sdk: BotSDK, make: (ctx: ActionContext) => Op<T>, guards: Guard[] = []): Promise<T> {
    const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
    try {
        const r = await interpret(make(driver), { driver, guards });
        if (r.kind !== 'returned') throw new Error(`op did not return: ${JSON.stringify(r)}`);
        return r.value;
    } finally {
        driver.close();
    }
}

/** Walks to the first open neighbouring tile (some are blocked, and walkTo then fails); false if none. */
export async function sidestep(sdk: BotSDK, bot: BotActions): Promise<boolean> {
    const p = sdk.getState()?.player;
    if (!p) return false;
    for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, 1],
        [0, -1],
    ] as const) {
        const walked = await bot.walkTo(p.worldX + dx, p.worldZ + dz, 0);
        if (walked.success) return true;
    }
    return false;
}
