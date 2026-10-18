import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// South-east of the Air ruins (2984,3291), a few tiles from runecraft.itest's start (2985,3288); a tile beside the
// air altar inside the temple (map square 44_75). In by the talisman on the ruins (a teleport), out by the portal.
const NEAR_RUINS = { x: 2990, z: 3284 };
const TEMPLE = { x: 2843, z: 4834 };

test(
    'walkTo uses a talisman on the air ruins into the temple, and leaves by the portal',
    async () => {
        await withFixtureBot(
            { position: NEAR_RUINS, inventory: [{ id: Items.AIR_TALISMAN, count: 1 }] },
            async ({ sdk }) => {
                const into = await walkLive(sdk, TEMPLE);
                expect(into.result.ok, detail(into)).toBe(true);
                expect(here(sdk).z, detail(into)).toBeGreaterThan(4000);
                expect(into.sent, detail(into)).toContain('use Air talisman on Mysterious ruins');

                const out = await walkLive(sdk, NEAR_RUINS);
                expect(out.result.ok, detail(out)).toBe(true);
                expect(here(sdk).z, detail(out)).toBeLessThan(4000);
                expect(
                    out.logs.some(l => /crossed loc-op 1 airtemple_exit_portal/.test(l)),
                    detail(out),
                ).toBe(true);
            },
        );
    },
    itestTimeout({ extraMs: 2 * WALKS_MS }),
);
