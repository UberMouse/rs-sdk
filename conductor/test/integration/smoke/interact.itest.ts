import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge chapel graveyard (The Restless Ghost): the closed coffin at (3249,3192) has an Open option
// whose script answers "You open the coffin." (quests/quest_priest/scripts/quest_priest.rs2). The only
// integration test that touches the coffin, as opening it spawns a ghost for 100 ticks.
const COURTYARD = { x: 3222, z: 3218 };

test(
    'interact task walks to the graveyard and opens the coffin',
    async () => {
        await withFixtureBot(
            { position: COURTYARD },
            async ({ name }) => {
                // The coffin is one loc on the shared server: an earlier run leaves it open (Close | Search). Closing
                // a closed one fails harmlessly with no result read.
                await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^coffin$', option: '^close$', at: { x: 3248, z: 3195, tolerance: 2 } },
                    ['minutes:3'],
                );
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^coffin$', option: '^open$', at: { x: 3248, z: 3195, tolerance: 2 } },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                // The first state change seen: the opening animation, the loc turning open, or the message.
                expect(run.result.reason, detail).toMatch(
                    /^interact: \^open\$ on \^coffin\$: (an animation started|the loc changed|game message "You open the coffin\.")$/,
                );
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// The Waterfall Quest (server/content/scripts/quests/quest_waterfall/scripts/quest_waterfall.rs2): Hudon's island,
// whose Rock and Dead trees the client cannot route to (the ops go out from the stand tile), and the dungeon's
// pillars (waterfall_pillars.rs2). Varp 65 is the quest stage. The island tests share the Rock and its loc change,
// so they run one after the other in this file.
const ISLAND = { x: 2512, z: 3477 };
const RAFT_SHORE = { x: 2512, z: 3476, tolerance: 1 };
// The server accepts the rope on the Rock only from x 2510-2514, z 3476-3481: stand well inside it.
const ROPE_STAND = { x: 2512, z: 3478, tolerance: 1 };
const ROCK = { x: 2512, z: 3468 };
const SKILLS = { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 70 };
const ROPE = 954;
const LOBSTER = 379;
const island = {
    position: ISLAND,
    skills: SKILLS,
    inventory: [{ id: ROPE, count: 1 }, ...Array.from({ length: 5 }, () => ({ id: LOBSTER, count: 1 }))],
    varps: { 65: 2 },
};

test(
    'interact swims from the island: an op on the unreachable Rock, the wash-up lands downstream',
    async () => {
        await withFixtureBot(
            island,
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    {
                        target: 'loc',
                        name: '^Rock$',
                        option: '^Swim',
                        tile: ROCK,
                        unreachable: true,
                        at: RAFT_SHORE,
                        expect: 'washed downstream',
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const { x, z } = run.result.finalPos;
                expect(Math.max(Math.abs(x - 2527), Math.abs(z - 3413)), detail).toBeLessThanOrEqual(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

test(
    'interact throws the rope on the Rock and then on the Dead tree, each picked by tile',
    async () => {
        await withFixtureBot(
            island,
            async ({ name }) => {
                const rock = await runTask(
                    name,
                    'interact',
                    {
                        target: 'loc',
                        name: '^Rock$',
                        use: { item: { id: ROPE } },
                        tile: ROCK,
                        unreachable: true,
                        at: ROPE_STAND,
                    },
                    ['minutes:2'],
                );
                const rockDetail = `${JSON.stringify(rock.result)}\n${rock.stderr}`;
                expect(rock.result.status, rockDetail).toBe('done');
                expect(rock.result.reason, rockDetail).toMatch(/^interact: use #954 on \^Rock\$: /);
                expect(rock.result.reason, rockDetail).not.toContain('still moving');
                expect(rock.result.finalPos, rockDetail).toMatchObject({ x: 2513, z: 3468 });
                // The run settles after the throw, so the next one starts once the bot has been pulled across.
                const tree = await runTask(
                    name,
                    'interact',
                    {
                        target: 'loc',
                        name: '^Dead tree$',
                        use: { item: '^Rope$' },
                        tile: { x: 2512, z: 3465 },
                        unreachable: true,
                        at: { x: 2512, z: 3466, tolerance: 1 },
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(tree.result)}\n${tree.stderr}`;
                expect(tree.result.status, detail).toBe('done');
                expect(tree.result.reason, detail).toBe(
                    'interact: use /^Rope$/ on ^Dead tree$: the player moved to (2511,3463)',
                );
                expect(tree.result.finalPos, detail).toMatchObject({ x: 2511, z: 3463 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

test(
    'interact puts a rune on the pillar chosen by tile',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2563, z: 9912 },
                skills: SKILLS,
                inventory: [
                    { id: 295, count: 1 },
                    { id: 296, count: 1 },
                    { id: 556, count: 6 },
                    { id: 557, count: 6 },
                    { id: 555, count: 6 },
                ],
                varps: { 65: 6 },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    {
                        target: 'loc',
                        name: '^Pillar$',
                        use: { item: { id: 556 } },
                        tile: { x: 2562, z: 9912 },
                        at: { x: 2563, z: 9912, tolerance: 1 },
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta['Air rune'], detail).toBe(-1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

// Cook's Assistant milking (server/content/scripts/npc/scripts/cow_milking.rs2): an empty bucket used on a Cow
// becomes a bucket of milk, with no level check. The Lumbridge cow pasture.
const COW_PASTURE = { x: 3253, z: 3268 };
const EMPTY_BUCKET = 1925;

test(
    'interact uses an empty bucket on a cow and gets milk',
    async () => {
        await withFixtureBot(
            { position: COW_PASTURE, inventory: [{ id: EMPTY_BUCKET, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'npc', name: '^cow$', use: { item: '^bucket$' }, expect: 'you milk the cow' },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta?.['Bucket of milk'], detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

// Sheep shearing (server/content/scripts/general_use/scripts/shear_sheep.rs2): Shears used on the woolly Sheep
// (npc 43) give wool; a sheared one (42) answers "This sheep has already been shorn.". Inside the fenced field north
// of Ardougne.
const SHEEP_FIELD = { x: 2654, z: 3365 };
const SHEARS = 1735;
const WOOLLY_SHEEP = 43;

test(
    'interact shears a woolly sheep picked by npcId',
    async () => {
        await withFixtureBot(
            { position: SHEEP_FIELD, inventory: [{ id: SHEARS, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    {
                        target: 'npc',
                        name: '^Sheep$',
                        npcId: WOOLLY_SHEEP,
                        use: { item: '^Shears$' },
                        expect: 'you get some wool',
                    },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta?.Wool, detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

// Port Sarim jeweller's Door (quests/quest_arthur/scripts/quest_arthur.rs2 oploc1,jewellersdoor): with the Lady's
// test started (bit 2 of varp 15) opening it starts the Beggar's choice dialog, which `choices` answers. The Beggar gives Excalibur for one Bread (beggar.rs2).
const JEWELLER_DOOR = { x: 3015, z: 3246 };
const ARTHUR_VARP = 14;
const EXCALIBUR_COMPONENTS_VARP = 15;
const EXCALIBUR_STARTED_MASK = 4;
const BREAD = 2309;

test(
    'interact opens the jeweller door and answers the beggar it starts',
    async () => {
        await withFixtureBot(
            {
                position: JEWELLER_DOOR,
                inventory: [{ id: BREAD, count: 1 }],
                varps: { [ARTHUR_VARP]: 4, [EXCALIBUR_COMPONENTS_VARP]: EXCALIBUR_STARTED_MASK },
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    {
                        target: 'loc',
                        name: '^Door$',
                        option: '^Open$',
                        tile: { x: 3016, z: 3246 },
                        choices: ['Yes certainly'],
                    },
                    ['minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toMatch(/1 choice made/);
                // Bread given, Excalibur received.
                expect(run.result.inventoryDelta.Excalibur, detail).toBe(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

// The Grail bell (quest_grail.rs2 opheld1): within 4 tiles of a Grail Maiden at the Fisher King's castle it shows
// a message box, a chat line and teleports the bot to (2761, 4692) (the maidens stand at (2763, 4690) and (2760, 4688)). With no `expect` the first box (the dialog
// guard clicks it away) is the effect; with `expect` naming the later one the run waits through the guard
// and ends once the castle line has been shown, the bot teleported.
test(
    'interact counts the bell teleport as the effect although the dialog guard handled the message box',
    async () => {
        await withFixtureBot(
            { position: { x: 2764, z: 4689 }, inventory: [{ id: 17, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'item', name: '^Grail bell$', option: '^Ring$', expect: 'inside the castle' },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos, detail).toMatchObject({ x: 2761, z: 4692 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);
