import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Karamja shipyard peninsula's only land exit is the river log "A wooden log" (loc zq_logbalance, op Cross).
// The map stores it at level 1 on bridge-flag tiles (2907,3049) and (2909,3049); the lite client lists it at the
// server's level 0 (SceneLite, see bridge-loc.itest.ts), so interact finds it and the bot crosses west. Combat
// 80s keep the peninsula's jungle spiders and jogres (huntmode aggressive) off the bot.
const PENINSULA = { x: 2915, z: 3050 };
// interact ends once the crossing animation starts, so the bot may still be on the log's east half.
const LOG_EAST_END_X = 2909;

test(
    'interact finds the Karamja river log on a bridge tile and crosses west',
    async () => {
        await withFixtureBot(
            {
                position: PENINSULA,
                skills: { Attack: 80, Strength: 80, Defence: 80, Hitpoints: 85, Agility: 30 },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^A wooden log$', option: '^Cross$' },
                    ['minutes:1'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos?.x, detail).toBeLessThanOrEqual(LOG_EAST_END_X);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 1 }),
);
