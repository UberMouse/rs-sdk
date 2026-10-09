import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState, GroundItem } from '../../../../sdk/types';
import { drop } from '../../../actions/drop';
import { pickup } from '../../../actions/pickup';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, south-east of the spawn: no other integration test stands on, drops onto
// or picks up from x 3223..3224, z 3215..3216. Each bot drops its own dagger and picks it up again, so
// no spawn timing is involved, and a dropped item is its dropper's alone at first.
const spot = () => ({ x: 3223 + Math.floor(Math.random() * 2), z: 3215 + Math.floor(Math.random() * 2) });
const DAGGER = /^bronze dagger$/i;
const BODY_MS = 30_000;
const kit = () => ({ position: spot(), inventory: [{ id: Items.BRONZE_DAGGER, count: 1 }] });

/** The dagger as it lies on the bot's own tile. */
const here = (s: BotWorldState) =>
    s.groundItems.find(g => DAGGER.test(g.name) && g.x === s.player?.worldX && g.z === s.player?.worldZ);

/** Drops the dagger and returns it as it lies on the bot's tile. */
async function dropDagger(sdk: BotSDK): Promise<GroundItem> {
    const dropped = await runLive(sdk, ctx => drop(ctx, DAGGER));
    expect(dropped.ok, JSON.stringify(dropped)).toBe(true);
    const s = await sdk.waitForCondition(st => !!here(st), 5000);
    return here(s)!;
}

/** Where the dagger is once the pickup has reported. */
const where = (sdk: BotSDK, dagger: GroundItem) => ({
    held: !!sdk.findInventoryItem(DAGGER),
    onGround: sdk.getState()!.groundItems.some(g => g.id === dagger.id && g.x === dagger.x && g.z === dagger.z),
});

test(
    'pickup takes an item off the ground as bot.pickupItem does',
    async () => {
        const viaOp = await withFixtureBot(kit(), async ({ sdk }) => {
            const dagger = await dropDagger(sdk);
            const r = await runLive(sdk, ctx => pickup(ctx, dagger));
            return { ok: r.ok, ...where(sdk, dagger) };
        });
        const viaBot = await withFixtureBot(kit(), async ({ sdk, bot }) => {
            const dagger = await dropDagger(sdk);
            const r = await bot.pickupItem(dagger);
            return { ok: r.success, ...where(sdk, dagger) };
        });
        expect(viaOp).toEqual({ ok: true, held: true, onGround: false });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);
