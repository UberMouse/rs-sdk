import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// From Varrock East bank to the moss giant room in the Varrock Sewers: down the Varrock manhole (opened first),
// along the sewers and through the slashable web at (3210, 9898), the room's only opening. Combat 99 so nothing
// in the sewers hunts the bot; a scimitar wielded to slash the web.
const VARROCK_EAST_BANK = { x: 3254, z: 3420 };
const MOSS_GIANTS = { x: 3158, z: 9895 };
const WEAPON_SLOT = 3;
const MITHRIL_SCIMITAR = 1329;
const FIGHTER = { Attack: 99, Strength: 99, Defence: 99, Hitpoints: 99 };

test(
    'travel from Varrock East bank climbs down the manhole and slashes the web to the moss giants',
    async () => {
        await withFixtureBot(
            {
                position: VARROCK_EAST_BANK,
                skills: FIGHTER,
                equipment: [{ id: MITHRIL_SCIMITAR, count: 1, slot: WEAPON_SLOT }],
            },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: MOSS_GIANTS, tolerance: 6 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const p = run.result.finalPos!;
                expect(
                    Math.max(Math.abs(p.x - MOSS_GIANTS.x), Math.abs(p.z - MOSS_GIANTS.z)),
                    detail,
                ).toBeLessThanOrEqual(6);
                const log = `${run.stdout}\n${run.stderr}`;
                expect(log, detail).toContain('climbed down the Varrock Sewers manhole');
                expect(log, detail).toMatch(/slashed the Web at \(3210, 9898\)/);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
