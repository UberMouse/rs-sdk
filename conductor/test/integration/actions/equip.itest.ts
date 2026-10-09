import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { equip } from '../../../actions/equip';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, east of the spawn: equipping changes nothing on the ground, and no other
// integration test stands on x 3223..3224, z 3212..3213.
const spot = () => ({ x: 3223 + Math.floor(Math.random() * 2), z: 3212 + Math.floor(Math.random() * 2) });
const SWORD = /^bronze sword$/i;
const BODY_MS = 30_000;
const kit = () => ({ position: spot(), inventory: [{ id: Items.BRONZE_SWORD, count: 1 }] });

/** Where the sword is once the equip has reported. */
const where = (sdk: BotSDK) => ({
    held: !!sdk.findInventoryItem(SWORD),
    worn: sdk.getEquipment().some(e => SWORD.test(e.name)),
});

test(
    'equip wields an item from the inventory as bot.equipItem does',
    async () => {
        const viaOp = await withFixtureBot(kit(), async ({ sdk }) => {
            const sword = sdk.findInventoryItem(SWORD)!;
            const r = await runLive(sdk, ctx => equip(ctx, sword));
            return { ok: r.ok, ...where(sdk) };
        });
        const viaBot = await withFixtureBot(kit(), async ({ sdk, bot }) => {
            const r = await bot.equipItem(sdk.findInventoryItem(SWORD)!);
            return { ok: r.success, ...where(sdk) };
        });
        expect(viaOp).toEqual({ ok: true, held: false, worn: true });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);
