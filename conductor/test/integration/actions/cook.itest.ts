import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { COOK_WAIT_TICKS, cook } from '../../../actions/cook';
import { countItems, findSkill, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// The Lumbridge Range south of Bob's Brilliant Axes, from its east side (the west is walled off); a Range is shared by any number of players.
const BESIDE_RANGE = { x: 3231, z: 3197 };
const SHRIMPS = /^raw shrimps$/i;
const RAW = 3;
const kit = () => ({
    position: BESIDE_RANGE,
    inventory: Array.from({ length: RAW }, () => ({ id: Items.RAW_SHRIMPS, count: 1 })),
});

test(
    'cook uses each raw shrimp on the Range and tells a cooked one (xp) from a burnt one',
    async () => {
        await withFixtureBot(kit(), async ({ sdk }) => {
            const range = sdk.findNearbyLoc(/^range$/i);
            if (!range) throw new Error('no Range beside the fixture bot');
            let cooked = 0;
            for (let i = 0; i < RAW; i++) {
                const xpBefore = findSkill(sdk.getState()!, 'Cooking')?.experience ?? 0;
                const r = await runLive(sdk, ctx => cook(ctx, SHRIMPS, range));
                expect(r.ok, JSON.stringify(r)).toBe(true);
                if (!r.ok) return;
                const xpAfter = findSkill(sdk.getState()!, 'Cooking')?.experience ?? 0;
                expect(xpAfter - xpBefore).toBe(r.xpGained);
                expect(r.burnt).toBe(r.xpGained === 0);
                if (!r.burnt) cooked++;
                expect(countItems(sdk.getState()!, SHRIMPS)).toBe(RAW - 1 - i);
            }
            expect(cooked + countItems(sdk.getState()!, /^burnt fish$/i)).toBe(RAW);
        });
    },
    itestTimeout({ extraMs: RAW * COOK_WAIT_TICKS * TICK_MS + 60_000 }),
);
