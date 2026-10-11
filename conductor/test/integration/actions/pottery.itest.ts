import { expect, test } from 'bun:test';
import { shortestNameMatch } from '../../../../sdk/action-quantity';
import type { BotSDK } from '../../../../sdk/index';
import { fire, shape, soften, unfiredOf } from '../../../actions/pottery';
import { countItems, findSkill } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Barbarian Village, east of the potter's wheel (3087,3409) and its oven (3084,3407): ground floor, no gate.
const kit = {
    position: { x: 3089, z: 3410 },
    skills: { Crafting: 1 },
    inventory: [
        { id: 434, count: 1 },
        { id: 1929, count: 1 },
    ],
};
const SOFT = /^soft clay$/i;
const xp = (sdk: BotSDK) => findSkill(sdk.getState()!, 'Crafting')?.experience ?? 0;
const station = (sdk: BotSDK, name: RegExp) => shortestNameMatch(sdk.getState()!.nearbyLocs, name)!;

test(
    'soften, shape and fire take a clay and a bucket of water to a pot',
    async () => {
        await withFixtureBot(kit, async ({ sdk }) => {
            const softened = await runLive(sdk, ctx => soften(ctx));
            expect(softened, JSON.stringify(softened)).toEqual({ ok: true });
            expect(countItems(sdk.getState()!, SOFT)).toBe(1);

            const before = xp(sdk);
            const shaped = await runLive(sdk, ctx => shape(ctx, station(sdk, /potter'?s wheel/i), 'pot'));
            expect(shaped.ok, JSON.stringify(shaped)).toBe(true);
            expect(xp(sdk) - before).toBe(157);
            expect(countItems(sdk.getState()!, unfiredOf('pot'))).toBe(1);

            const fired = await runLive(sdk, ctx => fire(ctx, unfiredOf('pot'), station(sdk, /pottery oven/i)));
            expect(fired.ok, JSON.stringify(fired)).toBe(true);
            expect(countItems(sdk.getState()!, unfiredOf('pot'))).toBe(0);
        });
    },
    itestTimeout({ extraMs: 120_000 }),
);

test(
    'shape at a level too low for the product is level-too-low and leaves no menu open',
    async () => {
        await withFixtureBot({ ...kit, inventory: [{ id: 1761, count: 1 }] }, async ({ sdk }) => {
            const r = await runLive(sdk, ctx => shape(ctx, station(sdk, /potter'?s wheel/i), 'bowl'));
            expect(r, JSON.stringify(r)).toMatchObject({ ok: false, reason: 'level-too-low' });
            expect(countItems(sdk.getState()!, SOFT)).toBe(1);
        });
    },
    itestTimeout({ extraMs: 60_000 }),
);
