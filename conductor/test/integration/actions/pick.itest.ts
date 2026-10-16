import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { PICK_OPTION, PICK_WAIT_TICKS, pick } from '../../../actions/pick';
import { countItems, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// The Seers' Village flax field (x 2732-2755, z 3433-3456); no other integration test stands in it.
const SPAWN = { x: 2740, z: 3440 };
const FLAX = /^flax$/i;
const RESPAWN_WAIT_MS = 30_000;

const standing = (s: BotWorldState) =>
    s.nearbyLocs
        .filter(l => FLAX.test(l.name) && l.reachable === true && l.options.some(o => PICK_OPTION.test(o)))
        .sort((a, b) => a.distance - b.distance);

test(
    'pick takes flax from a plant and gains it',
    async () => {
        await withFixtureBot({ position: SPAWN }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => standing(s).length > 0, RESPAWN_WAIT_MS);
            const plant = standing(ready)[0]!;
            expect(countItems(ready, FLAX)).toBe(0);
            const r = await runLive(sdk, ctx => pick(ctx, plant, FLAX));
            expect(r, `pick at (${plant.x},${plant.z})`).toEqual({ ok: true });
            expect(countItems(sdk.getState()!, FLAX)).toBe(1);
        });
    },
    itestTimeout({ extraMs: RESPAWN_WAIT_MS + PICK_WAIT_TICKS * TICK_MS }),
);
