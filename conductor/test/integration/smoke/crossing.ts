// The crossing smoke tests' walk: walkTo on a live fixture bot with the task engine's dialog guard (it clears the
// "continue" pages a move's dialogue shows and leaves the choices to cross), walked again while a walk runs out of
// ticks still on its way, as a task's step would, keeping every send and log line.
import type { BotSDK } from '../../../../sdk/index';
import type { ActionResult, BotAction } from '../../../../sdk/types';
import { WALK_MAX_TICKS, type WalkOptions, type WalkResult, walkTo } from '../../../actions/walk';
import { LiveDriver } from '../../../core/drivers/live';
import { type Guard, interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import { dialogGuard, type GuardRun } from '../../../lib/interrupts';
import type { Sinks } from '../../../lib/task';
import { TICK_MS } from '../../../lib/util';

const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };
/** Walks of one destination a test makes before it gives up: a far one runs out of ticks and goes on. */
export const MAX_WALKS = 4;
/** A test body's worst case for one destination. */
export const WALKS_MS = MAX_WALKS * WALK_MAX_TICKS * TICK_MS;

/** A live driver that keeps the reason of every send and every log line. */
class Recording extends LiveDriver {
    readonly sent: string[] = [];
    readonly logs: string[] = [];
    override async send(a: BotAction): Promise<ActionResult> {
        this.sent.push(a.reason);
        return super.send(a);
    }
    override log(msg: string, data?: Record<string, unknown>): void {
        this.logs.push(msg);
        super.log(msg, data);
    }
}

/** The task engine's dialog guard, as an interpreter guard. */
function dialogGuardOn(sdk: BotSDK): Guard {
    const run: GuardRun = { state: () => sdk.getState()!, startTick: sdk.getState()!.tick, previousPos: null };
    const episode = dialogGuard.episode();
    return {
        name: 'dialog',
        policy: dialogGuard.policy,
        when: s => dialogGuard.when(s, run),
        run: s => dialogGuard.run(s, run, episode),
    };
}

export interface LiveWalk {
    result: WalkResult;
    sent: string[];
    logs: string[];
}

/**
 * Walks the bot to `to` (on `to.level`, default 0) within `tolerance`, with `opts` and `bank` (ActionContext.bank:
 * the plan's bank record), up to `walks` walks (default MAX_WALKS) while each times out still advancing.
 */
export async function walkLive(
    sdk: BotSDK,
    to: { x: number; z: number; level?: number },
    {
        tolerance = 2,
        bank,
        walks = MAX_WALKS,
        ...opts
    }: WalkOptions & { tolerance?: number; bank?: (item: string) => number; walks?: number } = {},
): Promise<LiveWalk> {
    const sent: string[] = [];
    const logs: string[] = [];
    let result: WalkResult | undefined;
    for (let i = 0; i < walks; i++) {
        const driver = new Recording(sdk, SINKS, TICK_STALL_MS);
        try {
            const ctx = { state: () => driver.state(), ...(bank && { bank }) };
            const walk = walkTo(ctx, to.x, to.z, tolerance, { level: to.level ?? 0, ...opts });
            const r = await interpret(walk, { driver, guards: [dialogGuardOn(sdk)] });
            if (r.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(r)}`);
            result = r.value as WalkResult;
        } finally {
            driver.close();
        }
        sent.push(...driver.sent);
        logs.push(...driver.logs);
        if (result.ok || result.reason !== 'timeout') break;
    }
    return { result: result!, sent, logs };
}

/** Where the bot stands. */
export const here = (sdk: BotSDK) => {
    const p = sdk.getState()!.player!;
    return { level: p.level, x: p.worldX, z: p.worldZ };
};

/** A walk's sends, results and log, for an assertion's message. */
export const detail = (w: LiveWalk) => JSON.stringify({ result: w.result, sent: w.sent, logs: w.logs });
