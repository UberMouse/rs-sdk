import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { fletch } from '../../../actions/fletch';
import type { Guard } from '../../../core/interpret';
import { dialogGuard, type GuardRun } from '../../../lib/interrupts';
import { countItems, findSkill } from '../../../lib/util';
import { itestTimeout, levelXp, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, west of the spawn: fletching changes nothing on the ground, and no other
// integration test stands on x 3218..3219, z 3215..3216.
const spot = () => ({ x: 3218 + Math.floor(Math.random() * 2), z: 3215 + Math.floor(Math.random() * 2) });
const LOGS = /^logs$/i;
const SHAFTS = /^arrow shafts?$/i;
const BODY_MS = 60_000;
const kit = (logs: number) => ({
    position: spot(),
    skills: { Fletching: 1 },
    inventory: [{ id: Items.KNIFE, count: 1 }, ...Array.from({ length: logs }, () => ({ id: Items.LOGS, count: 1 }))],
});

const fletchingXp = (sdk: BotSDK) => findSkill(sdk.getState()!, 'Fletching')?.experience ?? 0;
const shafts = (sdk: BotSDK) => countItems(sdk.getState()!, SHAFTS);

/** The shared dialog guard as the engine runs it, counting its runs. */
function dialogGuardOn(sdk: BotSDK): { guard: Guard; runs: () => number } {
    const run: GuardRun = { state: () => sdk.getState()!, startTick: sdk.getState()!.tick, previousPos: null };
    const episode = dialogGuard.episode();
    let runs = 0;
    const guard: Guard = {
        name: 'dialog',
        policy: dialogGuard.policy,
        when: s => dialogGuard.when(s, run),
        run: s => {
            runs++;
            return dialogGuard.run(s, run, episode);
        },
    };
    return { guard, runs: () => runs };
}

test(
    'fletch cuts arrow shafts for the same xp as bot.fletchLogs',
    async () => {
        const viaOp = await withFixtureBot(kit(1), async ({ sdk }) => {
            const before = fletchingXp(sdk);
            const r = await runLive(sdk, ctx => fletch(ctx, LOGS, 'arrow shaft'));
            expect(r.ok && r.product, JSON.stringify(r)).toBe('15 Arrow Shafts');
            return { ok: r.ok, xp: fletchingXp(sdk) - before, shafts: shafts(sdk) };
        });
        const viaBot = await withFixtureBot(kit(1), async ({ sdk, bot }) => {
            const before = fletchingXp(sdk);
            const r = await bot.fletchLogs('arrow shaft');
            return { ok: r.success, xp: fletchingXp(sdk) - before, shafts: shafts(sdk) };
        });
        expect(viaOp.ok).toBe(true);
        expect(viaOp.xp).toBeGreaterThan(0);
        expect(viaOp.shafts).toBe(15);
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);

test(
    'under the dialog guard, a level-up from one fletch is cleared and the next fletch still gets its menu',
    async () => {
        await withFixtureBot(
            kit(2),
            async ({ sdk }) => {
                const { guard, runs } = dialogGuardOn(sdk);
                const first = await runLive(sdk, ctx => fletch(ctx, LOGS, 'arrow shaft'), [guard]);
                expect(first.ok, JSON.stringify(first)).toBe(true);
                const second = await runLive(sdk, ctx => fletch(ctx, LOGS, 'arrow shaft'), [guard]);
                expect(second.ok, JSON.stringify(second)).toBe(true);
                expect(findSkill(sdk.getState()!, 'Fletching')?.baseLevel).toBeGreaterThan(1);
                expect(shafts(sdk)).toBe(30);
                // The level-up was the guard's to clear; the make menus never were.
                expect(runs()).toBeGreaterThan(0);
            },
            { xp: { Fletching: levelXp(2) - 1 } },
        );
    },
    itestTimeout({ extraMs: BODY_MS }),
);
