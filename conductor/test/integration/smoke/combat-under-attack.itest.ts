import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Falador Dwarven Mine stairs landing (3058,9776) is 2-3 tiles from scorpions, which hunt (cowardly)
// any player at combat 28 or below (learnings/hazards.md). A combat-17 bot standing there is attacked
// within a few ticks, so the run starts under attack unless the task allows it (`startInCombat`).
const LANDING = { x: 3056, z: 9774 };
const LOBSTER = 379;

test(
    'combat task starts under attack by a scorpion and fights it (not refused "in combat")',
    async () => {
        await withFixtureBot(
            {
                position: LANDING,
                skills: { Attack: 15, Strength: 15, Defence: 15, Hitpoints: 22 },
                inventory: [
                    { id: Items.BRONZE_SWORD, count: 1 },
                    ...Array.from({ length: 6 }, () => ({ id: LOBSTER, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Scorpion',
                        skill: 'Strength',
                        area: { x: 3052, z: 9775, radius: 10 },
                        food: ['Lobster'],
                    },
                    ['xp:Strength:100', 'minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.reason ?? '', detail).not.toStartWith('in combat at');
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Strength, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
