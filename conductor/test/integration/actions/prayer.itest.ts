import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { prayerActive, prayerIndex, setPrayer } from '../../../actions/prayer';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Lumbridge castle courtyard: praying changes nothing on the ground, and no other integration test
// stands on z 3213 at x 3220..3222 (use stands on z 3212).
const spot = () => ({ x: 3220 + Math.floor(Math.random() * 3), z: 3213 });
const MELEE = 'Protect from Melee';
const BODY_MS = 30_000;
/** The prayer tab arrives a little after "ready": wait for the level it shows. */
const prayerShown = (sdk: BotSDK, level: number) =>
    sdk.waitForCondition(st => st.prayers.prayerLevel === level, PRAYER_SHOWN_MS);
const PRAYER_SHOWN_MS = 15_000;

test(
    'setPrayer turns Protect from Melee on and off, and refuses it below its level',
    async () => {
        const index = prayerIndex(MELEE)!;
        const toggled = await withFixtureBot({ position: spot(), skills: { Prayer: 43 } }, async ({ sdk }) => {
            await prayerShown(sdk, 43);
            const on = await runLive(sdk, ctx => setPrayer(ctx, MELEE, true));
            const afterOn = prayerActive(sdk.getState()!, index);
            const again = await runLive(sdk, ctx => setPrayer(ctx, MELEE, true));
            const off = await runLive(sdk, ctx => setPrayer(ctx, MELEE, false));
            return { on, afterOn, again, off, afterOff: prayerActive(sdk.getState()!, index) };
        });
        expect(toggled).toEqual({
            on: { ok: true, changed: true },
            afterOn: true,
            again: { ok: true, changed: false },
            off: { ok: true, changed: true },
            afterOff: false,
        });

        const refused = await withFixtureBot({ position: spot(), skills: { Prayer: 20 } }, async ({ sdk }) => {
            await prayerShown(sdk, 20);
            const r = await runLive(sdk, ctx => setPrayer(ctx, MELEE, true));
            return { r, active: prayerActive(sdk.getState()!, index) };
        });
        expect(refused.r).toMatchObject({ ok: false, reason: 'level' });
        expect(refused.active).toBe(false);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);
