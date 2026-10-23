import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Draynor Village's southern net spot (3086,3227). The area excludes the northern spot tile (3085,3230), where the
// dark wizards at (3084,3236) attack a low-combat bot. The op itest shares this spot: Al Kharid's spots are behind a
// toll gate, and a spot takes any number of anglers.
const SHORE = { x: 3086, z: 3227 };
const AREA = { x: SHORE.x, z: SHORE.z, radius: 2 };
const NET = { id: Items.SMALL_FISHING_NET, count: 1 };

test(
    'fishing task nets shrimps until the XP target',
    async () => {
        await withFixtureBot(
            { position: SHORE, skills: { Fishing: 1 }, inventory: [NET] },
            async ({ name }) => {
                const run = await runTask(name, 'fishing', { method: 'net', area: AREA, onFull: 'drop' }, [
                    'xp:Fishing:10',
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Fishing, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'fishing task with onFull stop ends done holding the fish',
    async () => {
        await withFixtureBot(
            {
                position: SHORE,
                skills: { Fishing: 1 },
                // Separate entries: one entry of count 26 would be a single stacked slot.
                inventory: [NET, ...Array.from({ length: 26 }, () => ({ id: Items.RAW_SHRIMPS, count: 1 }))],
            },
            async ({ name }) => {
                const run = await runTask(name, 'fishing', { method: 'net', area: AREA, onFull: 'stop' }, [
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('stop-full: inventory full: 27 fish');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// The Fishing Guild's Net/Harpoon (memberfish) spots near (2604,3416); the guild needs Fishing 68. The guild has no
// Net/Bait spot, so method net never has a spot there and the shark fallback has to engage; every catch is a shark.
// (Method harpoon could not prove it: the guild's Cage/Harpoon and Net/Harpoon spots share their tiles.) Spots hop
// among the guild's tiles, so the area is wide enough to follow them.
const GUILD = { x: 2604, z: 3416 };
const GUILD_AREA = { x: GUILD.x, z: GUILD.z, radius: 12 };
const HARPOON = { id: 311, count: 1 };

test(
    'fishing task falls back to sharks at the Fishing Guild',
    async () => {
        await withFixtureBot(
            { position: GUILD, skills: { Fishing: 84 }, inventory: [NET, HARPOON] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'fishing',
                    { method: 'net', fallback: 'shark', area: GUILD_AREA, onFull: 'drop' },
                    ['xp:Fishing:1100', 'minutes:4'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Fishing, detail).toBeGreaterThanOrEqual(1100);
                // Only the shark fallback can have fished here, so the XP is sharks.
                expect(run.stdout + run.stderr, detail).toContain('fishing shark');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
