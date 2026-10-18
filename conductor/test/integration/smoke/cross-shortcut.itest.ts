import { expect, test } from 'bun:test';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// The Brimhaven Dungeon's stepping stones (karam_dungeon_stone2, 2647,9558): a rolled move (a failure costs 11 ticks
// and no hitpoints), 80 run ticks shorter than the way round. No other integration test is in the
// dungeon; the fixture starts beside the first stone, with the levels to survive its monsters for a minute.
const BEFORE = { x: 2645, z: 9555 };
const AFTER = { x: 2650, z: 9566 };
const STATS = { Agility: 70, Hitpoints: 70, Defence: 70 };

test(
    'walkTo takes a rolled shortcut at a level where it pays: the Brimhaven Dungeon stepping stones',
    async () => {
        await withFixtureBot({ position: BEFORE, skills: STATS }, async ({ sdk }) => {
            const w = await walkLive(sdk, AFTER, { tolerance: 1 });
            expect(w.result.ok, detail(w)).toBe(true);
            expect(here(sdk).z, detail(w)).toBeGreaterThanOrEqual(AFTER.z - 1);
            expect(
                w.logs.some(l => /crossed loc-op 1 karam_dungeon_stone2/.test(l)),
                detail(w),
            ).toBe(true);
        });
    },
    itestTimeout({ extraMs: WALKS_MS }),
);
