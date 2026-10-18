import { expect, test } from 'bun:test';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// Monkey Madness done and its training after it (%mm_main, varp 365, at ^mm_complete_training), and the quest's own
// varbits of %mm_gnomes (varp 372) where it leaves them: %mm_daero ^daero_complete (bits 7-10), %mm_waydar
// ^waydar_arrived_island (11-12), %mm_lumdo ^lumdo_travelled (13-15).
const MONKEY_MADNESS = { 365: 10, 372: (7 << 7) | (1 << 11) | (3 << 13) };
const MET = ['quest:mm', 'quest:mm>=10'];
// Crash Island, where Waydar's glider lands (mm_waydar.rs2:116), beside Lumdo; Ape Atoll's beach, where Lumdo's boat
// lands (mm_lumdo.rs2:24); the Gnomeball pitch, where Waydar's way back lands (mm_waydar.rs2:125).
const CRASH_ISLAND = { x: 2893, z: 2725 };
const ATOLL = { x: 2802, z: 2707 };
const GNOMEBALL = { x: 2393, z: 3466 };

test(
    'walkTo takes Lumdo to Ape Atoll, then Lumdo and Waydar, answering his choice, back to the Gnomeball pitch',
    async () => {
        await withFixtureBot({ position: CRASH_ISLAND, varps: MONKEY_MADNESS }, async ({ sdk }) => {
            const into = await walkLive(sdk, ATOLL, { tolerance: 3, met: MET });
            expect(into.result.ok, detail(into)).toBe(true);
            expect(here(sdk).x, detail(into)).toBeLessThan(2820);
            expect(
                into.logs.some(l => /crossed npc-op 1 mm_lumdo/.test(l)),
                detail(into),
            ).toBe(true);

            const out = await walkLive(sdk, GNOMEBALL, { tolerance: 3, met: MET });
            expect(out.result.ok, detail(out)).toBe(true);
            expect(here(sdk).z, detail(out)).toBeGreaterThan(3400);
            expect(
                out.logs.some(l => /crossed npc-op 1 mm_waydar/.test(l)),
                detail(out),
            ).toBe(true);
            expect(out.sent, detail(out)).toContain('I need to return to your kingdom.');
        });
    },
    itestTimeout({ extraMs: 2 * WALKS_MS }),
);
