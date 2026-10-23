import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Quest dungeons the walk planner reaches through lib/connectors.ts (UNDERGROUND_AREAS): the Paterdomus mausoleum
// under Priest in Peril's temple, and the Tree Gnome Village cellar under Golrie's ladder (Waterfall Quest). The
// saves are conductor/saves/pip-temple-stage5 and waterfall-gnome-cellar; fixtures are built here with the same
// state. Steel melee gear and combat ~60 keep the hobgoblins, zombies and bats of the cellar off the bot.
const WEAPON = 3;
const SHIELD = 5;
const HELM = 0;
const BODY = 4;
const LEGS = 7;
const GEAR = [
    { id: 1325, count: 1, slot: WEAPON },
    { id: 1193, count: 1, slot: SHIELD },
    { id: 1157, count: 1, slot: HELM },
    { id: 1119, count: 1, slot: BODY },
    { id: 1069, count: 1, slot: LEGS },
];
const PRIEST_IN_PERIL_VARP = 302;
const WATERFALL_VARP = 65;

// Inside the temple's Large door; the mausoleum ladder's landing; the temple's east trapdoor (Morytania side) and its
// landing by Drezel.
const TEMPLE = { x: 3410, z: 3489 };
const LADDER_LANDING = { x: 3405, z: 9906 };
const EAST_TRAPDOOR_STAND = { x: 3426, z: 3485 };
const DREZEL = { x: 3440, z: 9890 };
// South of the Tree Gnome Village cellar ladder (2533, 3155); the cellar's landing and Golrie's crate stand.
const CELLAR_TOP = { x: 2533, z: 3157 };
const CELLAR_LANDING = { x: 2533, z: 9556 };
const CRATE_STAND = { x: 2548, z: 9566 };

const near = (p: { x: number; z: number } | undefined | null, to: { x: number; z: number }, tol: number) =>
    !!p && Math.max(Math.abs(p.x - to.x), Math.abs(p.z - to.z)) <= tol;

test(
    'travel goes down the Paterdomus trapdoor into the mausoleum dungeon and back up to the temple floor',
    async () => {
        await withFixtureBot(
            {
                position: TEMPLE,
                skills: { Attack: 36, Strength: 36, Defence: 36, Hitpoints: 38 },
                equipment: GEAR,
                varps: { [PRIEST_IN_PERIL_VARP]: 5 },
            },
            async ({ name }) => {
                const down = await runTask(name, 'travel', { to: LADDER_LANDING, tolerance: 2 }, ['minutes:3']);
                const detailDown = `${JSON.stringify(down.result)}\n${down.stderr}`;
                expect(down.result.status, detailDown).toBe('done');
                expect(down.result.finalPos?.z, detailDown).toBeGreaterThan(9000);
                expect(near(down.result.finalPos, LADDER_LANDING, 2), detailDown).toBe(true);

                // The Large door opens from outside from stage 4, which the bot cannot read: the plan says so.
                const up = await runTask(name, 'travel', { to: TEMPLE, tolerance: 1, met: ['quest:priestperil>=4'] }, [
                    'minutes:3',
                ]);
                const detailUp = `${JSON.stringify(up.result)}\n${up.stderr}`;
                expect(up.result.status, detailUp).toBe('done');
                expect(near(up.result.finalPos, TEMPLE, 1), detailUp).toBe(true);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);

test(
    'travel does not plan through the stage-gated temple door without met',
    async () => {
        await withFixtureBot(
            { position: { x: 3400, z: 3489 }, skills: { Hitpoints: 38 } },
            async ({ name }) => {
                // The ground floor beside the door is the same plane, so the walk falls back to the SDK pathfinder
                // and opens the door itself; the gate matters across planes: the floor above needs the stairs inside.
                const above = await runTask(name, 'travel', { to: { ...TEMPLE, level: 1 }, tolerance: 3 }, [
                    'minutes:1',
                ]);
                expect(above.result.status, JSON.stringify(above.result)).toBe('failed');
                expect(above.result.reason ?? '', above.stderr).toContain('No connector');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    "travel goes down the temple's east trapdoor to Drezel's side of the dungeon",
    async () => {
        await withFixtureBot(
            {
                position: EAST_TRAPDOOR_STAND,
                skills: { Attack: 36, Strength: 36, Defence: 36, Hitpoints: 38 },
                equipment: GEAR,
                varps: { [PRIEST_IN_PERIL_VARP]: 5 },
            },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: DREZEL, tolerance: 5 }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(near(run.result.finalPos, DREZEL, 5), detail).toBe(true);
                expect(run.result.finalPos?.z, detail).toBeGreaterThan(9000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

test(
    'travel goes down the Tree Gnome Village cellar ladder and across the cellar',
    async () => {
        await withFixtureBot(
            {
                position: CELLAR_TOP,
                skills: { Attack: 52, Strength: 52, Defence: 52, Hitpoints: 55 },
                equipment: GEAR,
                varps: { [WATERFALL_VARP]: 3 },
            },
            async ({ name }) => {
                const down = await runTask(name, 'travel', { to: CELLAR_LANDING, tolerance: 2 }, ['minutes:3']);
                const detailDown = `${JSON.stringify(down.result)}\n${down.stderr}`;
                expect(down.result.status, detailDown).toBe('done');
                expect(near(down.result.finalPos, CELLAR_LANDING, 2), detailDown).toBe(true);
                expect(down.result.finalPos?.z, detailDown).toBeGreaterThan(9000);

                // Within the cellar the walk is on one named plane: no climb, just the walk to Golrie's crate.
                const crate = await runTask(name, 'travel', { to: CRATE_STAND, tolerance: 2 }, ['minutes:3']);
                const detailCrate = `${JSON.stringify(crate.result)}\n${crate.stderr}`;
                expect(crate.result.status, detailCrate).toBe('done');
                expect(near(crate.result.finalPos, CRATE_STAND, 2), detailCrate).toBe(true);

                const up = await runTask(name, 'travel', { to: CELLAR_TOP, tolerance: 2 }, ['minutes:3']);
                const detailUp = `${JSON.stringify(up.result)}\n${up.stderr}`;
                expect(up.result.status, detailUp).toBe('done');
                expect(near(up.result.finalPos, CELLAR_TOP, 2), detailUp).toBe(true);
                expect(up.result.finalPos?.z, detailUp).toBeLessThan(9000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 9 }),
);
