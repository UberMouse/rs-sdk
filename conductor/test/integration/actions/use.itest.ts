import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { useItemOnItem, useItemOnLoc } from '../../../actions/use';
import { type FixtureBot, itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard, beside the south fountain at (3221,3210): no other integration test
// stands on x 3220..3222, z 3212 (equip uses x 3223..3224), and neither use changes anything on the ground.
const spot = () => ({ x: 3220 + Math.floor(Math.random() * 3), z: 3212 });
const FOUNTAIN = { x: 3221, z: 3210 };
const FEATHER = 314;
const ARROW_SHAFT = 52;
const BODY_MS = 30_000;
const BUCKET = /^bucket$/i;
const WATER = /^bucket of water$/i;

const fountainNear = (sdk: BotSDK) =>
    sdk.getState()!.nearbyLocs.find(l => /^fountain$/i.test(l.name) && l.x === FOUNTAIN.x && l.z === FOUNTAIN.z);

/** Fills a fresh bot's bucket at the fountain with `use`, and reports what it said and what it holds. */
const fillBucket = (use: (bot: FixtureBot) => Promise<boolean>) =>
    withFixtureBot({ position: spot(), inventory: [{ id: Items.BUCKET, count: 1 }] }, async fixture => {
        const { sdk } = fixture;
        expect(fountainNear(sdk), 'fountain not in view').toBeDefined();
        const ok = await use(fixture);
        await sdk.waitForCondition(s => s.inventory.some(i => WATER.test(i.name)), 5000);
        return { ok, empty: !!sdk.findInventoryItem(BUCKET), full: !!sdk.findInventoryItem(WATER) };
    });

test(
    'useItemOnLoc fills a bucket at a fountain as bot.useItemOnLoc does',
    async () => {
        const viaOp = await fillBucket(async ({ sdk }) => {
            const r = await runLive(sdk, ctx => useItemOnLoc(ctx, sdk.findInventoryItem(BUCKET)!, fountainNear(sdk)!));
            return r.ok;
        });
        const viaBot = await fillBucket(async ({ sdk, bot }) => {
            const r = await bot.useItemOnLoc(sdk.findInventoryItem(BUCKET)!, fountainNear(sdk)!);
            return r.success;
        });
        expect(viaOp).toEqual({ ok: true, empty: false, full: true });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);

test(
    'useItemOnItem attaches feathers to arrow shafts (no bot.* method to compare with)',
    async () => {
        await withFixtureBot(
            {
                position: spot(),
                skills: { Fletching: 1 },
                inventory: [
                    { id: FEATHER, count: 5 },
                    { id: ARROW_SHAFT, count: 5 },
                ],
            },
            async ({ sdk }) => {
                const feathers = sdk.findInventoryItem(/^feathers?$/i)!;
                const shafts = sdk.findInventoryItem(/^arrow shafts?$/i)!;
                const r = await runLive(sdk, ctx => useItemOnItem(ctx, feathers, shafts));
                expect(r).toEqual({ ok: true });
                await sdk.waitForCondition(s => s.inventory.some(i => /^headless arrows?$/i.test(i.name)), 5000);
            },
        );
    },
    itestTimeout({ extraMs: BODY_MS }),
);
