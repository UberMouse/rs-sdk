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
