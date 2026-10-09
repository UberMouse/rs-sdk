import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { eat } from '../../../actions/eat';
import { countItems } from '../../../lib/util';
import { itestTimeout, levelXp, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, west of the spawn: eating changes nothing on the ground, and no other
// integration test stands on x 3218..3219, z 3212..3213.
const spot = () => ({ x: 3218 + Math.floor(Math.random() * 2), z: 3212 + Math.floor(Math.random() * 2) });
const SHRIMPS = /^shrimps$/i;
const BODY_MS = 30_000;
/** Hitpoints 20 from its xp, while the save's current level stays 10: hurt by 10. */
const HURT = { xp: { Hitpoints: levelXp(20) } };
const kit = () => ({
    position: spot(),
    inventory: [
        { id: Items.SHRIMPS, count: 1 },
        { id: Items.SHRIMPS, count: 1 },
    ],
});

test(
    'eat heals and uses up the food as bot.eatFood does',
    async () => {
        const viaOp = await withFixtureBot(
            kit(),
            async ({ sdk }) => {
                expect(sdk.getState()?.player).toMatchObject({ hp: 10, maxHp: 20 });
                const food = sdk.findInventoryItem(SHRIMPS)!;
                const r = await runLive(sdk, ctx => eat(ctx, food));
                return { ok: r.ok, hpGained: r.ok ? r.hpGained : 0, left: countItems(sdk.getState()!, SHRIMPS) };
            },
            HURT,
        );
        const viaBot = await withFixtureBot(
            kit(),
            async ({ sdk, bot }) => {
                const r = await bot.eatFood(sdk.findInventoryItem(SHRIMPS)!);
                return { ok: r.success, hpGained: r.hpGained, left: countItems(sdk.getState()!, SHRIMPS) };
            },
            HURT,
        );
        // Shrimps heal 3.
        expect(viaOp).toEqual({ ok: true, hpGained: 3, left: 1 });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);
