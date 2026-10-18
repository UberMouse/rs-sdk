import { expect, test } from 'bun:test';
import { cameFrom } from '../../../../wiki/world/requirements';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// Rune Mysteries varp (63) at its "complete" value: the essence mine teleports are unlocked.
const RUNE_MYSTERIES = { 63: 6 };
const QUEST = 'quest:runemysteries';
// In Aubury's rune shop, two tiles from runecraft.itest's start (3253,3403); the middle of the essence mine (map square
// 45_75), which Aubury's teleport lands round at random; outside the shop door, the portal's way back.
const SHOP = { x: 3255, z: 3401 };
const MINE = { x: 2911, z: 4832 };
const OUTSIDE = { x: 3253, z: 3394 };

test(
    'walkTo takes Aubury into the essence mine, walks on from where it lands, and leaves by a portal',
    async () => {
        await withFixtureBot({ position: SHOP, varps: RUNE_MYSTERIES }, async ({ sdk }) => {
            const into = await walkLive(sdk, MINE, { tolerance: 3, met: [QUEST] });
            expect(into.result.ok, detail(into)).toBe(true);
            expect(here(sdk).z, detail(into)).toBeGreaterThan(4000);
            expect(
                into.logs.some(l => /crossed npc-op 4 aubury/.test(l)),
                detail(into),
            ).toBe(true);

            // The wizard on record: the portal edge back to Aubury.
            const out = await walkLive(sdk, OUTSIDE, { met: [QUEST, cameFrom('aubury')] });
            expect(out.result.ok, detail(out)).toBe(true);
            expect(here(sdk).z, detail(out)).toBeLessThan(4000);
            expect(
                out.logs.some(l => /crossed loc-op 1 blankrunestone_exit_portal/.test(l)),
                detail(out),
            ).toBe(true);
        });
    },
    itestTimeout({ extraMs: 2 * WALKS_MS }),
);
