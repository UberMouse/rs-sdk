import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { unequip } from '../../../actions/unequip';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, east of the spawn: taking gear off changes nothing on the ground, and no
// other integration test stands on x 3225..3226, z 3212..3213.
const spot = () => ({ x: 3225 + Math.floor(Math.random() * 2), z: 3212 + Math.floor(Math.random() * 2) });
const SWORD = /^bronze sword$/i;
const BRONZE_SWORD = 1277;
const BODY_MS = 30_000;
const kit = () => ({ position: spot(), equipment: [{ id: BRONZE_SWORD, count: 1, slot: 3 }] });

/** Where the sword is once the unequip has reported. */
const worn = (sdk: BotSDK) => sdk.waitForCondition(s => s.equipment.length > 0, 10_000);
const where = (sdk: BotSDK) => ({
    held: !!sdk.findInventoryItem(SWORD),
    worn: sdk.getEquipment().some(e => SWORD.test(e.name)),
});

test(
    'unequip takes a worn item off into the inventory as bot.unequipItem does',
    async () => {
        const viaOp = await withFixtureBot(kit(), async ({ sdk }) => {
            await worn(sdk);
            const sword = sdk.getEquipment().find(e => SWORD.test(e.name))!;
            const r = await runLive(sdk, ctx => unequip(ctx, sword));
            return { ok: r.ok, ...where(sdk) };
        });
        const viaBot = await withFixtureBot(kit(), async ({ sdk, bot }) => {
            await worn(sdk);
            const r = await bot.unequipItem(sdk.getEquipment().find(e => SWORD.test(e.name))!);
            return { ok: r.success, ...where(sdk) };
        });
        expect(viaOp).toEqual({ ok: true, held: true, worn: false });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);
