// Waterfall Quest from a Kandarin account with Fishing 68+/Cooking (harpoon, coins), no gear needed:
// fish + cook swordfish at Catherby, rope (Arhein), runes (Betty), bank the runes (the tomb refuses them),
// Almera, raft, Hudon, swim off, Hadley's book, Golrie's cellar (key, pebble), Glarial's tomb (amulet, urn),
// bank runes back, raft, rope rock + dead tree, ledge door, key crate, two doors, six pillars, statue, chalice.
// Phases are chosen from the held items, the quest tab and the position (wiki/quests/waterfall-quest.md).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import bank from '@conductor/tasks/bank';
import cooking from '@conductor/tasks/cooking';
import fishing from '@conductor/tasks/fishing';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const Q = 'waterfall';
const FOODS = ['Swordfish', 'Tuna', 'Lobster', 'Salmon', 'Trout'];
const food = (v: PlanView) => FOODS.reduce((n, f) => n + v.inv(f), 0);
const KEEP_FOOD = FOODS;
const pos = (v: PlanView) => ({ x: v.state.player?.worldX ?? 0, z: v.state.player?.worldZ ?? 0 });
const within = (v: PlanView, x0: number, x1: number, z0: number, z1: number) => {
    const p = pos(v);
    return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
};
const inCellar = (v: PlanView) => within(v, 2505, 2555, 9550, 9590);
const inTomb = (v: PlanView) => within(v, 2520, 2565, 9805, 9850);
const inDungeon = (v: PlanView) => within(v, 2560, 2612, 9855, 9925);
const puzzleRoom = (v: PlanView) => within(v, 2560, 2575, 9902, 9925);
const onIsland = (v: PlanView) => within(v, 2510, 2514, 3476, 3481);
const onIslet = (v: PlanView) => within(v, 2511, 2513, 3465, 3468);
const onLedge = (v: PlanView) => within(v, 2510, 2512, 3462, 3464);
const surface = (v: PlanView) => pos(v).z < 9000;
const runesMin = (v: PlanView) => Math.min(v.inv('Air rune'), v.inv('Earth rune'), v.inv('Water rune'));
const runesAny = (v: PlanView) => v.inv('Air rune') + v.inv('Earth rune') + v.inv('Water rune') > 0;
const bankRunes = (v: PlanView) =>
    Math.min(v.bank('Air rune') ?? 0, v.bank('Earth rune') ?? 0, v.bank('Water rune') ?? 0);
const hpFrac = (v: PlanView) => v.hp.current / Math.max(1, v.hp.max);
const inFight = (v: PlanView) => !!v.state.player?.combat?.inCombat;
const has = (v: PlanView, n: string | RegExp) => v.inv(n) > 0;
const lastIs = (v: PlanView, ...names: string[]) => v.last !== null && names.includes(v.last.phase);
const lastDone = (v: PlanView, name: string) => v.last?.phase === name && v.last.status === 'done';
// Hadley's house and the wash-up bank south of the falls (where the swim lands)
const nearHadley = (v: PlanView) => within(v, 2505, 2535, 3405, 3440);
const nearCellarLadder = (v: PlanView) => within(v, 2525, 2540, 3150, 3160);
const GEAR = ['Rune scimitar', 'Adamant full helm', 'Adamant platebody', 'Adamant platelegs', 'Adamant kiteshield'];
const gearHeld = (v: PlanView) => v.inv('Rune scimitar') > 0;
const geared = (v: PlanView) => v.state.equipment.length >= 4;
const AMULET = "Glarial's amulet";
const URN = "Glarial's urn";
const KEY = 'A key';
const PEBBLE = "Glarial's pebble";
const BOOK = 'Book on baxtorian';
const catherbyBank = { x: 2809, z: 3441, radius: 5 };
const ardougneBank = { x: 2617, z: 3331, radius: 6 };
const northBank = ardougneBank;

const pillar = (k: number, px: number, pz: number, stand: { x: number; z: number }) =>
    phase(
        talk,
        {
            at: { ...stand, level: 0, tolerance: 1 },
            use: {
                items: ['^Air rune$', '^Earth rune$', '^Water rune$'],
                onLoc: '^Pillar$',
                tile: { x: px, z: pz },
            },
        },
        {
            name: `pillar-${k}`,
            when: v => puzzleRoom(v) && has(v, AMULET) && v.inv('Air rune') === 7 - k,
            onFail: 'continue',
            maxFails: 4,
        },
    );

export default definePlan({
    name: 'waterfall-quest',
    description:
        'Waterfall Quest: food, rope, runes, Almera, Hudon, Hadley book, Golrie cellar, Glarial tomb, falls, pillars, statue, chalice.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(Q),
    phases: [
        // ---- the falls, latest stage first ----
        // the reward needs 5 free slots (the chalice refuses otherwise): shed food first
        phase(
            items,
            { drop: [{ item: '^Swordfish$', count: 6 }] },
            {
                name: 'make-room',
                when: v => inDungeon(v) && has(v, URN) && !has(v, AMULET) && pos(v).x >= 2596 && v.free < 5,
                maxFails: 3,
            },
        ),
        // Under attack in the dungeon (Skeletons 45 and Skeleton Mages by the key crate, Fire giants 86 by door 1) a task will not
        // start, so wait the fight out where we stand: a flee travel to the spot eats held food at low HP while auto-retaliate
        // (scimitar + adamant) fights back, and is done once out of combat.
        // (two phases per fight so each failed wait hands the turn to the other, never to "no phase applies")
        ...[
            ['dungeon-fight', 'dungeon-wait'],
            ['giant-fight', 'giant-wait'],
        ].flatMap(([a, b], k) =>
            [a, b].map(name =>
                phase(
                    travel,
                    {
                        to: k === 0 ? { x: 2588, z: 9888, level: 0 } : { x: 2568, z: 9892, level: 0 },
                        tolerance: 3,
                        flee: true,
                    },
                    {
                        name,
                        when: v =>
                            inDungeon(v) &&
                            inFight(v) &&
                            (k === 0 ? pos(v).x >= 2580 && pos(v).z <= 9892 : pos(v).x < 2580),
                        onFail: 'continue',
                        maxFails: 40,
                    },
                ),
            ),
        ),
        phase(
            talk,
            {
                at: { x: 2603, z: 9912, level: 0, tolerance: 1 },
                use: { items: [`^Glarial's urn$`], onLoc: '^Chalice of eternity$' },
            },
            {
                name: 'chalice',
                when: v => inDungeon(v) && has(v, URN) && !has(v, AMULET) && pos(v).x >= 2596,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            talk,
            {
                at: { x: 2565, z: 9915, level: 0, tolerance: 1 },
                use: { items: [`^Glarial's amulet$`], onLoc: '^Statue of Glarial$' },
            },
            {
                name: 'statue',
                when: v => puzzleRoom(v) && has(v, AMULET) && !runesAny(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        pillar(1, 2562, 9910, { x: 2563, z: 9910 }),
        pillar(2, 2562, 9912, { x: 2563, z: 9912 }),
        pillar(3, 2562, 9914, { x: 2563, z: 9914 }),
        pillar(4, 2569, 9910, { x: 2568, z: 9910 }),
        pillar(5, 2569, 9912, { x: 2568, z: 9912 }),
        pillar(6, 2569, 9914, { x: 2568, z: 9914 }),
        phase(
            talk,
            {
                at: { x: 2566, z: 9901, level: 0, tolerance: 1 },
                use: { items: ['^A key$'], onLoc: '^Door$', tile: { x: 2566, z: 9901 } },
            },
            {
                name: 'door2',
                when: v => inDungeon(v) && has(v, KEY) && has(v, AMULET) && within(v, 2560, 2575, 9894, 9901),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        phase(
            talk,
            {
                at: { x: 2568, z: 9893, level: 0, tolerance: 1 },
                use: { items: ['^A key$'], onLoc: '^Door$', tile: { x: 2568, z: 9893 } },
            },
            {
                name: 'door1',
                when: v => inDungeon(v) && has(v, KEY) && has(v, AMULET) && within(v, 2560, 2612, 9855, 9893),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: '^Search$',
                tile: { x: 2589, z: 9888 },
                at: { x: 2588, z: 9888, tolerance: 1 },
                expect: 'large key|key',
            },
            {
                name: 'key-crate',
                // the key lands a tick after the search: the view is stale right after it
                when: v => inDungeon(v) && !inFight(v) && !has(v, KEY) && has(v, AMULET) && !lastDone(v, 'key-crate'),
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        // the key lands a tick after the search: walk a few tiles so the next phase sees it
        phase(
            travel,
            { to: { x: 2590, z: 9886, level: 0 }, tolerance: 1 },
            {
                name: 'dkey-settle',
                when: v => inDungeon(v) && !has(v, KEY) && lastDone(v, 'key-crate'),
                onFail: 'continue',
                maxFails: 2,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^(Swordfish|Tuna)$', option: '^Eat$' },
            {
                name: 'dungeon-eat',
                when: v => inDungeon(v) && !inFight(v) && hpFrac(v) < 0.6 && food(v) > 0,
                onFail: 'continue',
            },
        ),
        phase(
            travel,
            { to: { x: 2575, z: 9861, level: 0 }, tolerance: 1 },
            { name: 'ledge-door', when: v => onLedge(v) && has(v, AMULET), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Dead tree$',
                use: { item: '^Rope$' },
                tile: { x: 2512, z: 3465 },
                unreachable: true,
                at: { x: 2512, z: 3466, tolerance: 1 },
            },
            { name: 'rope-tree', when: v => onIslet(v) && has(v, 'Rope'), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rock$',
                use: { item: '^Rope$' },
                tile: { x: 2512, z: 3468 },
                unreachable: true,
                at: { x: 2512, z: 3477, tolerance: 1 },
            },
            { name: 'rope-rock', when: v => onIsland(v) && has(v, AMULET) && has(v, 'Rope'), maxFails: 4 },
        ),
        // after the tomb: runes (and food) back out of the bank
        phase(
            bank,
            {
                area: northBank,
                depositAllExcept: ['Coins', 'Rope', AMULET, URN],
                withdraw: [
                    { item: 'Air rune', count: 6 },
                    { item: 'Earth rune', count: 6 },
                    { item: 'Water rune', count: 6 },
                    ...GEAR.map(item => ({ item, count: 1 })),
                    { item: 'Swordfish', count: 14, upTo: true },
                ],
            },
            {
                name: 'bank-gear',
                // gear is allowed again once the tomb is behind us (the dungeon fights)
                when: v => has(v, AMULET) && has(v, URN) && surface(v) && !geared(v) && !gearHeld(v) && runesMin(v) < 6,
            },
        ),
        phase(
            bank,
            { area: northBank, withdraw: [{ item: 'Swordfish', count: 5, upTo: true }] },
            {
                name: 'bank-food',
                when: v =>
                    has(v, AMULET) &&
                    has(v, URN) &&
                    surface(v) &&
                    geared(v) &&
                    food(v) < 20 &&
                    runesMin(v) >= 6 &&
                    !lastIs(v, 'bank-food'),
            },
        ),
        phase(
            items,
            { equip: GEAR },
            {
                name: 'wear',
                when: v => has(v, AMULET) && has(v, URN) && gearHeld(v) && !inTomb(v),
                onFail: 'continue',
            },
        ),
        phase(
            travel,
            { to: { x: 2512, z: 3478, level: 0 }, tolerance: 1, met: [`quest:${Q}>=1`] },
            {
                name: 'to-island-2',
                when: v =>
                    has(v, AMULET) &&
                    has(v, URN) &&
                    has(v, 'Rope') &&
                    runesMin(v) >= 6 &&
                    geared(v) &&
                    surface(v) &&
                    !onIsland(v) &&
                    !onIslet(v) &&
                    !onLedge(v),
                maxFails: 4,
            },
        ),
        // ---- Glarial's tomb ----
        // Protocol: the roamers (Zombie 24, Skeleton 22, Moss giant 42) hit hard and the bot has no weapon. Under
        // attack and hurt: flee to the exit ladder (2555, 9844), climb out, eat to full, re-enter by the pebble.
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2555, z: 9844, tolerance: 1 } },
            {
                name: 'tomb-bail',
                when: v => inTomb(v) && !inFight(v) && hpFrac(v) < 0.5 && within(v, 2550, 2557, 9840, 9848),
                maxFails: 4,
            },
        ),
        phase(
            travel,
            { to: { x: 2555, z: 9844, level: 0 }, tolerance: 1, flee: true },
            {
                name: 'tomb-flee',
                when: v => inTomb(v) && inFight(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^(Swordfish|Tuna)$', option: '^Eat$' },
            {
                name: 'tomb-eat',
                when: v => inTomb(v) && !inFight(v) && hpFrac(v) < 0.6 && food(v) > 0,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                at: { x: 2555, z: 9844, tolerance: 1 },
            },
            {
                name: 'tomb-exit',
                // the position is a tick stale after the climb: do not climb a ladder that is no longer there
                when: v => inTomb(v) && has(v, AMULET) && has(v, URN) && !lastDone(v, 'tomb-exit'),
                maxFails: 4,
            },
        ),
        phase(
            travel,
            { to: { x: 2561, z: 3448, level: 0 }, tolerance: 1 },
            {
                name: 'exit-settle',
                when: v => inTomb(v) && lastDone(v, 'tomb-exit'),
                maxFails: 2,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Tomb of glarial$',
                option: '^Search$',
                at: { x: 2541, z: 9811, tolerance: 1 },
            },
            { name: 'tomb-urn', when: v => inTomb(v) && has(v, AMULET) && !has(v, URN), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^(Closed|Open) chest$',
                option: '^(Open|Search)$',
                at: { x: 2530, z: 9845, tolerance: 1 },
            },
            { name: 'tomb-chest', when: v => inTomb(v) && !has(v, AMULET), maxFails: 6 },
        ),
        phase(
            interact,
            { target: 'item', name: '^(Swordfish|Tuna)$', option: '^Eat$' },
            {
                name: 'surface-eat',
                when: v =>
                    surface(v) && has(v, PEBBLE) && !has(v, URN) && !runesAny(v) && hpFrac(v) < 0.8 && food(v) >= 9,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Tombstone of glarial$',
                use: { item: "^Glarial's pebble$" },
                at: { x: 2560, z: 3444, tolerance: 1 },
                // the pebble teleports into the tomb: interact ends on the move (talk walks back out to its tile)
            },
            {
                name: 'tombstone',
                when: v =>
                    has(v, PEBBLE) &&
                    !has(v, URN) &&
                    !runesAny(v) &&
                    surface(v) &&
                    food(v) >= 8 &&
                    hpFrac(v) >= 0.8 &&
                    v.state.equipment.length === 0,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // the tomb refuses runes: bank them (Ardougne North) before it
        phase(
            bank,
            { area: northBank, depositAllExcept: ['Coins', 'Rope', ...KEEP_FOOD] },
            { name: 'bank-runes', when: v => runesAny(v) && !has(v, AMULET) && surface(v) },
        ),
        // ---- Golrie's cellar ----
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: '^Open$', at: { x: 2515, z: 9577, tolerance: 1 } },
            { name: 'cell-door', when: v => inCellar(v) && has(v, PEBBLE) && pos(v).z >= 9576, maxFails: 4 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2533, z: 9556, tolerance: 1 } },
            { name: 'cellar-up', when: v => inCellar(v) && has(v, PEBBLE) && pos(v).z < 9576, maxFails: 4 },
        ),
        phase(
            talk,
            { npc: '^Golrie$', at: { x: 2515, z: 9579, level: 0, tolerance: 2 } },
            {
                name: 'golrie',
                when: v => inCellar(v) && !has(v, PEBBLE) && has(v, KEY) && pos(v).z >= 9576,
                maxFails: 4,
            },
        ),
        phase(
            talk,
            {
                at: { x: 2515, z: 9575, level: 0, tolerance: 1 },
                use: { items: ['^A key$'], onLoc: '^Door$', tile: { x: 2515, z: 9575 } },
            },
            {
                name: 'cell-key',
                when: v => inCellar(v) && !has(v, PEBBLE) && has(v, KEY) && pos(v).z < 9576,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: '^Search$',
                tile: { x: 2548, z: 9565 },
                at: { x: 2548, z: 9566, tolerance: 1 },
                expect: 'key',
            },
            {
                name: 'cellar-crate',
                // the key lands a tick after the search: the view is stale right after it (see key-settle)
                when: v => inCellar(v) && !has(v, PEBBLE) && !has(v, KEY) && !lastIs(v, 'cellar-crate'),
                maxFails: 4,
            },
        ),
        phase(
            travel,
            { to: { x: 2545, z: 9566, level: 0 }, tolerance: 1 },
            {
                name: 'key-settle',
                when: v => inCellar(v) && !has(v, KEY) && lastDone(v, 'cellar-crate'),
                maxFails: 2,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-down$', at: { x: 2533, z: 3156, tolerance: 1 } },
            {
                name: 'cellar-down',
                when: v =>
                    has(v, BOOK) &&
                    !has(v, PEBBLE) &&
                    !has(v, KEY) &&
                    !has(v, AMULET) &&
                    surface(v) &&
                    nearCellarLadder(v),
                maxFails: 4,
            },
        ),
        phase(
            travel,
            { to: { x: 2533, z: 3157, level: 0 }, tolerance: 1 },
            {
                name: 'to-cellar',
                when: v =>
                    has(v, BOOK) &&
                    lastIs(v, 'read-book', 'to-cellar') &&
                    !has(v, PEBBLE) &&
                    !has(v, KEY) &&
                    !has(v, AMULET) &&
                    surface(v) &&
                    !nearCellarLadder(v),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^Book on baxtorian$', option: '^Read$' },
            {
                name: 'read-book',
                // reading again is harmless; the last phase orders it ahead of the walk to the cellar
                when: v =>
                    has(v, BOOK) &&
                    !lastIs(v, 'read-book', 'to-cellar') &&
                    !has(v, PEBBLE) &&
                    !has(v, KEY) &&
                    !has(v, AMULET) &&
                    surface(v) &&
                    !nearCellarLadder(v),
            },
        ),
        // the book lands a tick after the search: wait it out (a walk down the stairs) so read-book sees it
        phase(
            travel,
            { to: { x: 2518, z: 3431, level: 0 }, tolerance: 1 },
            {
                name: 'book-settle',
                when: v => !has(v, BOOK) && lastDone(v, 'bookcase'),
                maxFails: 2,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Bookcase$',
                option: '^Search$',
                tile: { x: 2520, z: 3426 },
                at: { x: 2519, z: 3427, level: 1, tolerance: 1 },
                expect: 'Book on Baxtorian',
            },
            {
                name: 'bookcase',
                when: v =>
                    !has(v, BOOK) &&
                    !has(v, PEBBLE) &&
                    !has(v, AMULET) &&
                    surface(v) &&
                    nearHadley(v) &&
                    !lastDone(v, 'bookcase'),
                maxFails: 4,
            },
        ),
        // ---- island ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rock$',
                option: 'wim',
                tile: { x: 2512, z: 3468 },
                unreachable: true,
                at: { x: 2512, z: 3477, tolerance: 1 },
                expect: 'washed downstream',
            },
            {
                name: 'swim',
                when: v => onIsland(v) && !has(v, AMULET) && lastIs(v, 'hudon-talk', 'hudon-dialog'),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { continue: true },
            {
                name: 'hudon-dialog',
                when: v => onIsland(v) && !has(v, AMULET) && v.state.dialog.isOpen,
                onFail: 'continue',
            },
        ),
        // Hudon's tile is off the island: Talk-to is an approach op, so take it unreachable from inside the island zone
        phase(
            interact,
            {
                target: 'npc',
                name: '^Hudon$',
                option: '^Talk-?to$',
                unreachable: true,
                at: { x: 2512, z: 3478, tolerance: 1 },
            },
            {
                name: 'hudon-talk',
                when: v => onIsland(v) && !has(v, AMULET) && !lastIs(v, 'hudon-talk', 'hudon-dialog'),
                onFail: 'continue',
            },
        ),
        phase(
            travel,
            { to: { x: 2512, z: 3478, level: 0 }, tolerance: 1, met: [`quest:${Q}>=1`] },
            {
                name: 'to-island-1',
                when: v =>
                    v.quest(Q) === 'started' &&
                    !has(v, BOOK) &&
                    !has(v, PEBBLE) &&
                    !has(v, AMULET) &&
                    surface(v) &&
                    !nearHadley(v) &&
                    !onIsland(v),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { npc: '^Almera$', at: { x: 2522, z: 3496, level: 0, tolerance: 2 }, choices: ['How can I help'] },
            {
                name: 'almera',
                when: v => v.quest(Q) === 'none' && has(v, 'Rope') && food(v) >= 8 && bankRunes(v) >= 6,
                maxFails: 4,
            },
        ),
        phase(
            items,
            { unequip: ['all'] },
            {
                name: 'unequip',
                when: v => v.state.equipment.length > 0 && v.free >= 4 && !has(v, URN),
                onFail: 'continue',
            },
        ),
        // start: strip the gear (the tomb refuses it) and bank what the account has
        phase(
            bank,
            {
                area: catherbyBank,
                depositAllExcept: ['Harpoon', 'Coins'],
                withdraw: [
                    { item: 'Rope', count: 1, upTo: true },
                    { item: 'Swordfish', count: 14, upTo: true },
                    { item: 'Tuna', count: 8, upTo: true },
                ],
            },
            {
                name: 'bank-start',
                when: v =>
                    v.quest(Q) === 'none' &&
                    !has(v, 'Rope') &&
                    food(v) < 20 &&
                    v.state.equipment.length === 0 &&
                    !lastIs(v, 'bank-start'),
            },
        ),
        // ---- errands ----
        phase(
            shop,
            {
                npc: 'Betty',
                at: { x: 3012, z: 3259 },
                buy: [
                    { item: 'Air rune', count: 6 },
                    { item: 'Earth rune', count: 6 },
                    { item: 'Water rune', count: 6 },
                ],
            },
            {
                name: 'buy-runes',
                when: v =>
                    v.quest(Q) === 'none' && runesMin(v) < 6 && bankRunes(v) < 6 && has(v, 'Rope') && food(v) >= 8,
                maxFails: 4,
            },
        ),
        phase(
            shop,
            { npc: 'Arhein', at: { x: 2803, z: 3430 }, buy: [{ item: 'Rope', count: 1 }] },
            {
                name: 'buy-rope',
                when: v => v.quest(Q) === 'none' && !has(v, 'Rope') && food(v) >= 20,
                maxFails: 4,
            },
        ),
        phase(
            cooking,
            { food: 'Raw tuna', area: { x: 2817, z: 3444, radius: 6 }, dropBurnt: true },
            { name: 'cook-tuna', when: v => has(v, 'Raw tuna'), onFail: 'continue' },
        ),
        phase(
            cooking,
            { food: 'Raw swordfish', area: { x: 2817, z: 3444, radius: 6 }, dropBurnt: true },
            { name: 'cook-swordfish', when: v => has(v, 'Raw swordfish'), onFail: 'continue' },
        ),
        phase(
            fishing,
            { method: 'harpoon', onFull: 'stop', area: { x: 2841, z: 3431, radius: 8 } },
            {
                name: 'fish',
                when: v =>
                    v.quest(Q) === 'none' && food(v) < 20 && has(v, 'Harpoon') && !has(v, /^raw /i) && v.free > 0,
            },
        ),
    ],
});
