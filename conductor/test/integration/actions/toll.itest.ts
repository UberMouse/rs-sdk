import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { TOLL_FEE } from '../../../actions/toll';
import { walkTo } from '../../../actions/walk';
import type { Guard } from '../../../core/interpret';
import { dialogGuard, type GuardRun } from '../../../lib/interrupts';
import { countItems } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Either side of the Al Kharid toll gate (3268,3227..3228), on the road; no other integration test is near.
const WEST = { x: 3262, z: 3228 };
const EAST = { x: 3275, z: 3228 };
const BODY_MS = 5 * 60_000;

/** The task engine's dialog guard (clears the guard's "continue" pages, leaves the choice), as an interpreter guard. */
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

const coins = (sdk: BotSDK) => countItems(sdk.getState()!, /^coins$/i);
const at = (sdk: BotSDK) => {
    const p = sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ };
};
const walk = (sdk: BotSDK, to: { x: number; z: number }) =>
    runLive(sdk, ctx => walkTo(ctx, to.x, to.z, 1), [dialogGuardOn(sdk)]);

test(
    'walkTo pays the toll through the Al Kharid gate, both ways',
    async () => {
        await withFixtureBot({ position: WEST, coins: 100 }, async ({ sdk }) => {
            const r = await walk(sdk, EAST);
            expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
            expect(at(sdk).x).toBeGreaterThanOrEqual(EAST.x - 1);
            expect(coins(sdk)).toBe(100 - TOLL_FEE);
            const back = await walk(sdk, WEST);
            expect(back, JSON.stringify(back)).toMatchObject({ ok: true });
            expect(at(sdk).x).toBeLessThanOrEqual(WEST.x + 1);
            expect(coins(sdk)).toBe(100 - 2 * TOLL_FEE);
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);

test(
    'without the toll walkTo goes round the gate and keeps its coins',
    async () => {
        await withFixtureBot({ position: WEST, coins: TOLL_FEE - 1 }, async ({ sdk }) => {
            const r = await walk(sdk, EAST);
            expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
            expect(at(sdk).x).toBeGreaterThanOrEqual(EAST.x - 1);
            expect(coins(sdk)).toBe(TOLL_FEE - 1);
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);
