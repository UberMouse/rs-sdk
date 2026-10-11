import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { GNOME_GATE, passGate } from '../../../actions/gate';
import type { Guard } from '../../../core/interpret';
import { dialogGuard, type GuardRun } from '../../../lib/interrupts';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Just south of the Gnome Stronghold gate; only the travel smoke (east of it, x 2506) is near.
const STAND = GNOME_GATE.stand;
const BODY_MS = 60_000;

/** The task engine's dialog guard (clears Femi's "continue" pages, leaves his choice), as an interpreter guard. */
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

test(
    'passGate opens the Gnome gate (declining Femi if he asks) and ends through it',
    async () => {
        await withFixtureBot({ position: STAND }, async ({ sdk }) => {
            const guard = dialogGuardOn(sdk);
            const r = await runLive(sdk, ctx => passGate(ctx, GNOME_GATE), [guard]);
            expect(r, JSON.stringify(r)).toEqual({ ok: true });
            const p = sdk.getState()!.player!;
            expect(p.worldZ).toBeGreaterThanOrEqual(GNOME_GATE.throughZ);
            // Already through: nothing to do.
            const again = await runLive(sdk, ctx => passGate(ctx, GNOME_GATE), [guard]);
            expect(again).toEqual({ ok: true });
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);
