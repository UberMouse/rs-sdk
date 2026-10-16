import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { spin, SPIN_MENU_TICKS, SPIN_START_TICKS } from '../../../actions/spin';
import { countItems, findSkill, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// The Seers' Village spinning wheel (2711,3471) on the first floor of the house; no other integration
// test stands there. Crafting 70 so the five strings (375 xp each) cause no level-up to cut the batch.
const SPAWN = { x: 2713, z: 3471, level: 1 };
const WHEEL = /^spinning wheel$/i;
const kit = (flax: number) => ({
    position: SPAWN,
    skills: { Crafting: 70 },
    inventory: Array.from({ length: flax }, () => ({ id: Items.FLAX, count: 1 })),
});
const BODY_MS = (SPIN_MENU_TICKS + SPIN_START_TICKS + 40) * TICK_MS;

test(
    'spin turns five flax into bow strings with one Make X',
    async () => {
        await withFixtureBot(kit(5), async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => s.nearbyLocs.some(l => WHEEL.test(l.name)), 30_000);
            const wheel = ready.nearbyLocs.find(l => WHEEL.test(l.name))!;
            const before = findSkill(ready, 'Crafting')!.experience;
            const r = await runLive(sdk, ctx => spin(ctx, wheel, 'flax'));
            expect(r.ok, JSON.stringify(r)).toBe(true);
            const s = sdk.getState()!;
            expect(countItems(s, /^flax$/i)).toBe(0);
            expect(countItems(s, /^bow string$/i)).toBe(5);
            expect(findSkill(s, 'Crafting')!.experience - before).toBe(5 * 375);
            expect(s.dialog.isOpen).toBe(false);
        });
    },
    itestTimeout({ extraMs: BODY_MS + 30_000 }),
);

test(
    'spin with no flax held fails without touching the wheel',
    async () => {
        await withFixtureBot(kit(0), async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => s.nearbyLocs.some(l => WHEEL.test(l.name)), 30_000);
            const wheel = ready.nearbyLocs.find(l => WHEEL.test(l.name))!;
            const r = await runLive(sdk, ctx => spin(ctx, wheel, 'flax'));
            expect(r).toMatchObject({ ok: false, reason: 'no-material' });
        });
    },
    itestTimeout({ extraMs: 30_000 }),
);
