// Dragon Slayer (quest id dragon; server/content/scripts/quests/quest_dragon, areas/*: guild_master, oziach, oracle,
// klarense, ned, duke_horacio, wormbrain), start to done. The stage varp never reaches the client, so the stage rides on
// items (Maze key = Oziach done; coins = Wormbrain / Klarense paid; Plank = ship unpatched; Map part x3 / Crandor map;
// the Dragonfire shield = the map is built), position, and the dialog history for the Oracle's riddle.
// Route (every map piece in one trip, the Duke after the map is whole):
//   Guild master (Champions' Guild) -> Oziach (Edgeville: shield, Maze key, oracle and goblin hints) -> Oracle
//   (Ice Mountain) -> Dwarven mine magic Door (3051,9840) takes silk, unfired bowl, lobster pot and mind bomb ->
//   Chest (3057,9841): Map part -> Wormbrain (jail, 10,000 coins): Map part -> Klarense (2,000 coins: ship) -> the
//   hold's Hole (3047,9639): 3 planks, 12 nails, hammer -> Melzar's Maze -> Duke Horacio (Dragonfire shield) ->
//   Ned (Draynor): hire, then the Crandor map -> Ned on the ship (level 3 hold): sail -> Crandor -> Rock opening
//   (2833,3255) -> Elvarg's lair, gates (2847,9636/7), Elvarg.
// Melzar's Maze (the real route, proven live): the front Door (2941,3248) takes the Maze key; every coloured Key opens
// one Door and is used up: Giant rat -> red, level 1 Ghost -> orange, level 2 Skeleton -> yellow, then the ladders down
// to the south-east room and the funnel Ladder (2932,3240) into the dungeon: Zombie -> blue, Melzar the mad -> magenta,
// Lesser demon -> green, Chest (2935,9657). The ladder (2939,3257) only leads up out of the dungeon.
// KNOWN GAP (DECISION NEEDED): the Port Sarim quay Gangplank (2593 at (3047,3205)) is a raw level 1 loc on bridge
// (LinkBelow) tiles: the server serves it on level 0, the client scene lists it on level 1, so no task sees it from the
// quay; the ship repair and the sail cannot start. Everything else is proven (see the report).
// Start: lib:dragon-slayer-start. Needs: 32 QP (varp 101), melee ~70, 12000 coins, the four oracle items, 3 planks,
// 12 nails, a hammer, food.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'dragon';
const MAP1 = 1535;
const MAP2 = 1536;
const MAP3 = 1537;
const SHIELD = 'Dragonfire shield';

const pos = (v: PlanView) => v.state.player;
const lvl = (v: PlanView) => pos(v)?.level ?? 0;
const px = (v: PlanView) => pos(v)?.worldX ?? 0;
const pz = (v: PlanView) => pos(v)?.worldZ ?? 0;
const idCount = (v: PlanView, n: number) => v.state.inventory.filter(i => i.id === n).reduce((a, i) => a + i.count, 0);
const dialogSeen = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));

const hired = (v: PlanView) => dialogSeen(v, /get me a ship|take you anywhere/i);
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);
const key = (v: PlanView) => v.inv('Maze key') > 0;
const coins = (v: PlanView) => v.inv('Coins');
const p1 = (v: PlanView) => idCount(v, MAP1);
const p2 = (v: PlanView) => idCount(v, MAP2);
const p3 = (v: PlanView) => idCount(v, MAP3);
const map = (v: PlanView) => v.inv('Crandor map') > 0;
const shieldWorn = (v: PlanView) => v.state.equipment.some(i => i.name === SHIELD);
const shieldHeld = (v: PlanView) => shieldWorn(v) || v.inv(SHIELD) > 0;
const planks = (v: PlanView) => v.inv('Plank');
const four = (v: PlanView) =>
    v.inv('Silk') > 0 && v.inv('Unfired bowl') > 0 && v.inv('Lobster pot') > 0 && v.inv("Wizard's mind bomb") > 0;
// The map is built, the Duke's shield taken, and the map handed to Ned: nothing else leaves the pack empty of pieces.
const given = (v: PlanView) => started(v) && shieldHeld(v) && !map(v) && p1(v) + p2(v) + p3(v) === 0 && planks(v) === 0;

// Places.
const inDungeon = (v: PlanView) => lvl(v) === 0 && pz(v) >= 9636 && pz(v) <= 9664 && px(v) >= 2915 && px(v) <= 2945;
// Inside the building (walls x 2923-2940, z 3240-3257): the corridor z=3258 north of it and the yard are outside.
const inMazeSurface = (v: PlanView) =>
    pz(v) >= 3240 && pz(v) <= 3257 && px(v) >= 2923 && px(v) <= 2940 && lvl(v) <= 2 && !inDungeon(v);
// The dungeon zones (collision flood fills, keys opening one door at a time): the strip below the blue Door, Melzar's
// room beyond it, the north side (corridor z 9653-9655 and the demon's room) beyond the magenta Door, the Chest side.
const dStrip = (v: PlanView) => px(v) >= 2931 && px(v) <= 2933 && pz(v) <= 9644;
const dRoom = (v: PlanView) => px(v) >= 2925 && px(v) <= 2930 && pz(v) >= 9643 && pz(v) <= 9651;
const dNorth = (v: PlanView) =>
    (pz(v) >= 9652 && pz(v) <= 9655 && px(v) >= 2924 && px(v) <= 2939) ||
    (px(v) >= 2934 && px(v) <= 2939 && pz(v) >= 9646 && pz(v) <= 9655);
const dChest = (v: PlanView) => pz(v) >= 9656;
// West of the red doors: only reached through one (x <= 2925 strip, and the pocket by the Ladder (2928,3256)).
const westPocket = (v: PlanView) =>
    lvl(v) === 0 &&
    ((px(v) <= 2925 && pz(v) >= 3253 && pz(v) <= 3257) ||
        (px(v) >= 2926 && px(v) <= 2929 && pz(v) >= 3255 && pz(v) <= 3257));
// The south-east room (x 2932-2940, z 3238-3242), reached only by the level 1 Ladder (2937,3240): the funnel Ladder is there.
const inH = (v: PlanView) => lvl(v) === 0 && pz(v) <= 3242 && px(v) >= 2932 && px(v) <= 2940;
const inOracleRoom = (v: PlanView) => lvl(v) === 0 && px(v) >= 3052 && px(v) <= 3075 && pz(v) >= 9830 && pz(v) <= 9855;
const inShip = (v: PlanView) => pz(v) >= 9630 && pz(v) <= 9650 && px(v) >= 3040 && px(v) <= 3055;
const onDeck = (v: PlanView) =>
    lvl(v) === 1 && px(v) >= 3040 && px(v) <= 3056 && pz(v) >= 3200 && pz(v) <= 3215 && !inShip(v);
const onCrandor = (v: PlanView) => lvl(v) === 0 && px(v) >= 2810 && px(v) <= 2870 && pz(v) >= 3225 && pz(v) <= 3300;
const elvargNear = (v: PlanView) => v.state.nearbyNpcs.some(n => n.name === 'Elvarg' && n.distance <= 5);
const inLair = (v: PlanView) => pz(v) >= 9590 && pz(v) <= 9680 && px(v) >= 2800 && px(v) <= 2880;

// The maze leg: three pieces to get, the ship sound, the map not yet built.
const maze = (v: PlanView) =>
    started(v) && key(v) && p2(v) > 0 && p3(v) > 0 && p1(v) === 0 && !map(v) && planks(v) === 0;

const talkTo = (npc: string, x: number, z: number, choices: string[], level = 0, tolerance = 3) => ({
    npc,
    at: { x, z, level, tolerance },
    choices,
});
const loc = (
    name: string,
    option: string,
    x: number,
    z: number,
    level: number,
    stand: [number, number, number?],
    extra: object = {},
) => ({
    target: 'loc' as const,
    name,
    option,
    tile: { x, z, level },
    at: { x: stand[0], z: stand[1], level: stand[2] ?? level, tolerance: 1 },
    ...extra,
});

export default definePlan({
    name: 'dragon-slayer',
    description:
        "Dragon Slayer: Guild master, Oziach, Oracle + Dwarven mine door + chest, Wormbrain, Klarense, ship repair, Melzar's Maze chest, Duke's shield, Ned, Crandor, Elvarg.",
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // --- Crandor: the lair, then the island ---
        // The lair: the armed Skeletons and Giant skeletons stand between the rope (2833,9657) and the double Gate
        // (2847,9636/7); Elvarg is out of sight until inside it, so walk first (a travel is not stopped by attacks).
        phase(
            travel,
            { to: { x: 2852, z: 9637 }, tolerance: 1 },
            {
                name: 'lair-walk',
                when: v => inLair(v) && px(v) < 2850 && !done(v),
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Elvarg',
                skill: 'Strength',
                area: { x: 2852, z: 9637, radius: 30 },
                weapon: 'Rune scimitar',
                shield: SHIELD,
                food: ['Swordfish'],
                eatBelow: 0.5,
                prayers: ['Protect from Melee'],
                maxLevelGap: 20,
            },
            { name: 'elvarg', when: v => inLair(v) && !done(v) && elvargNear(v), onFail: 'continue', maxFails: 8 },
        ),
        // The Skeletons around the Gate attack on the way in: what is on the bot is fought first, unless Elvarg herself is
        // close (the server refuses a second target while one is on the bot).
        phase(
            combat,
            {
                target: 'Skeleton',
                skill: 'Strength',
                area: { x: 2843, z: 9640, radius: 14 },
                food: ['Swordfish'],
                prayers: ['Protect from Melee'],
                maxLevelGap: 40,
            },
            {
                name: 'lair-defend',
                when: v => inLair(v) && !done(v) && v.state.player?.combat.inCombat === true && !elvargNear(v),
                until: v => v.state.player?.combat.inCombat !== true,
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(interact, loc('^Rock opening$', '^Climb-down$', 2833, 3255, 0, [2833, 3253]), {
            name: 'crandor-descend',
            when: v => onCrandor(v) && !done(v),
            maxFails: 4,
        }),
        // --- the sail ---
        phase(
            talk,
            { npc: '^Ned$', at: { x: 3046, z: 9640, level: 3, tolerance: 2 }, choices: ['Yep lets go'], travels: true },
            { name: 'sail', when: v => given(v) && inShip(v) && lvl(v) === 3, maxFails: 4 },
        ),
        phase(interact, loc('^Ladder$', '^Climb-down$', 3049, 3208, 1, [3049, 3207]), {
            name: 'ship-descend',
            when: v => given(v) && onDeck(v),
            maxFails: 4,
        }),
        phase(interact, loc('^Gangplank$', '^Cross$', 3047, 3205, 0, [3047, 3204, 0]), {
            name: 'board',
            when: v => given(v) && !onDeck(v) && !inShip(v) && !onCrandor(v) && !inLair(v) && !done(v),
            maxFails: 4,
        }),
        phase(items, { equip: [SHIELD] }, { name: 'wear-shield', when: v => v.inv(SHIELD) > 0, maxFails: 3 }),
        // --- Ned: hire, then the map (hired = his "get me a ship" line is in the dialog history) ---
        phase(talk, talkTo('^Ned$', 3100, 3258, ['going to take me to Crandor']), {
            name: 'ned-give',
            when: v => map(v) && shieldHeld(v) && !given(v) && hired(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, talkTo('^Ned$', 3100, 3258, ['sailor']), {
            name: 'ned-hire',
            when: v => map(v) && shieldHeld(v) && !given(v) && !hired(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, talkTo('^Ned$', 3100, 3258, ['going to take me to Crandor']), {
            name: 'ned-give-again',
            when: v => map(v) && shieldHeld(v) && !given(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, talkTo('^Duke Horacio$', 3210, 3220, ['shield that will protect'], 1), {
            name: 'duke',
            when: v => started(v) && map(v) && !shieldHeld(v) && !inDungeon(v) && !inMazeSurface(v),
            maxFails: 4,
        }),
        // --- leave the maze with the map: ladder up, then the front Door with the Maze key ---
        phase(
            items,
            {
                combine: {
                    use: { name: '^Map part$', id: MAP1 },
                    on: { name: '^Map part$', id: MAP2 },
                    product: '^Crandor map$',
                },
            },
            {
                name: 'combine-a',
                when: v => started(v) && p1(v) > 0 && p2(v) > 0 && p3(v) > 0,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(interact, loc('^Ladder$', '^Climb-up$', 2939, 9657, 0, [2938, 9657]), {
            name: 'maze-exit-ladder',
            when: v => started(v) && inDungeon(v) && map(v),
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Maze key$' },
                tile: { x: 2941, z: 3248, level: 0 },
                at: { x: 2940, z: 3248, level: 0, tolerance: 1 },
            },
            { name: 'maze-leave', when: v => started(v) && inMazeSurface(v) && map(v), maxFails: 4 },
        ),
        // --- Melzar's Maze (map of the walk, collision flood fill with the coloured Doors as walls): the front Door ->
        // giant Rat (red Key) -> red Door (2926,3253) -> west pocket -> Ladder (2928,3256) up -> level 1: the quest Ghost
        // (orange Key) -> orange Door (2931,3253) -> Ladder (2934,3254) up -> level 2: the quest Skeleton (yellow Key) ->
        // yellow Door (2924,3249) -> Ladder (2940,3240) down -> level 1 Ladder (2937,3240) down -> the south-east room ->
        // the funnel Ladder (2932,3240) down -> dungeon: the Zombies (blue Key) -> blue Door (2931,9643) -> Melzar the
        // mad (magenta Key) -> magenta Door (2929,9652) -> the Lesser demon (green Key) -> green Door (2936,9655) -> Chest
        // (2935,9657), approached from the south (the loc's forceapproach turns with its angle). Each Key opens one Door
        // and is used up, so the pack holds at most one coloured Key. ---
        phase(interact, loc('^Chest$', '^Search$', 2935, 9657, 0, [2935, 9656]), {
            name: 'maze-chest-search',
            when: v => maze(v) && inDungeon(v) && dChest(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(interact, loc('^Chest$', '^Open$', 2935, 9657, 0, [2935, 9656]), {
            name: 'maze-chest-open',
            when: v => maze(v) && inDungeon(v) && dChest(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2936, z: 9655, level: 0 },
                at: { x: 2936, z: 9655, level: 0, tolerance: 1 },
            },
            {
                name: 'maze-green-door',
                when: v => maze(v) && inDungeon(v) && dNorth(v) && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Lesser demon',
                skill: 'Strength',
                area: { x: 2936, z: 9650, radius: 7 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-demon',
                when: v => maze(v) && inDungeon(v) && dNorth(v) && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2929, z: 9652, level: 0 },
                at: { x: 2929, z: 9651, level: 0, tolerance: 1 },
            },
            {
                name: 'maze-magenta-door',
                when: v => maze(v) && inDungeon(v) && dRoom(v) && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Melzar the mad',
                skill: 'Strength',
                area: { x: 2929, z: 9649, radius: 6 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-melzar',
                when: v => maze(v) && inDungeon(v) && dRoom(v) && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2931, z: 9643, level: 0 },
                at: { x: 2932, z: 9643, level: 0, tolerance: 1 },
            },
            {
                name: 'maze-blue-door',
                when: v => maze(v) && inDungeon(v) && dStrip(v) && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Zombie',
                skill: 'Strength',
                area: { x: 2932, z: 9642, radius: 4 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-zombie',
                when: v => maze(v) && inDungeon(v) && dStrip(v) && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(interact, loc('^Ladder$', '^Climb-down$', 2932, 3240, 0, [2933, 3240]), {
            name: 'maze-funnel',
            when: v => maze(v) && inMazeSurface(v) && inH(v),
            maxFails: 4,
        }),
        phase(interact, loc('^Ladder$', '^Climb-down$', 2937, 3240, 1, [2938, 3240]), {
            name: 'maze-l1-down',
            when: v => maze(v) && inMazeSurface(v) && lvl(v) === 1 && pz(v) <= 3243,
            maxFails: 4,
        }),
        phase(interact, loc('^Ladder$', '^Climb-down$', 2940, 3240, 2, [2940, 3241]), {
            name: 'maze-l2-down',
            when: v => maze(v) && inMazeSurface(v) && lvl(v) === 2 && pz(v) <= 3249 && v.inv('Key') === 0,
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2924, z: 3249, level: 2 },
                at: { x: 2924, z: 3250, level: 2, tolerance: 1 },
            },
            {
                name: 'maze-yellow-door',
                when: v => maze(v) && inMazeSurface(v) && lvl(v) === 2 && pz(v) >= 3250 && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Skeleton',
                skill: 'Strength',
                area: { x: 2925, z: 3253, radius: 8 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-skeleton',
                when: v => maze(v) && inMazeSurface(v) && lvl(v) === 2 && pz(v) >= 3250 && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(interact, loc('^Ladder$', '^Climb-up$', 2934, 3254, 1, [2934, 3253]), {
            name: 'maze-l1-up',
            when: v =>
                maze(v) && inMazeSurface(v) && lvl(v) === 1 && px(v) >= 2931 && pz(v) >= 3246 && v.inv('Key') === 0,
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2931, z: 3253, level: 1 },
                at: { x: 2930, z: 3253, level: 1, tolerance: 1 },
            },
            {
                name: 'maze-orange-door',
                when: v =>
                    maze(v) && inMazeSurface(v) && lvl(v) === 1 && px(v) <= 2930 && pz(v) >= 3244 && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Ghost',
                skill: 'Strength',
                area: { x: 2928, z: 3251, radius: 7 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-ghost',
                when: v =>
                    maze(v) && inMazeSurface(v) && lvl(v) === 1 && px(v) <= 2930 && pz(v) >= 3244 && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(interact, loc('^Ladder$', '^Climb-up$', 2928, 3256, 0, [2927, 3256]), {
            name: 'maze-pocket-ladder',
            when: v => maze(v) && inMazeSurface(v) && westPocket(v),
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Key$' },
                tile: { x: 2926, z: 3253, level: 0 },
                at: { x: 2927, z: 3253, level: 0, tolerance: 1 },
            },
            {
                name: 'maze-red-door',
                when: v => maze(v) && inMazeSurface(v) && lvl(v) === 0 && !westPocket(v) && !inH(v) && v.inv('Key') > 0,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Giant rat',
                skill: 'Strength',
                area: { x: 2930, z: 3252, radius: 8 },
                food: ['Swordfish'],
                loot: ['Key'],
                maxLevelGap: 20,
                respawnWaitTicks: 40,
            },
            {
                name: 'maze-rat',
                when: v =>
                    maze(v) && inMazeSurface(v) && lvl(v) === 0 && !westPocket(v) && !inH(v) && v.inv('Key') === 0,
                until: v => v.inv('Key') > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                use: { item: '^Maze key$' },
                tile: { x: 2941, z: 3248, level: 0 },
                at: { x: 2942, z: 3248, level: 0, tolerance: 1 },
            },
            {
                name: 'maze-enter',
                when: v => maze(v) && !inMazeSurface(v) && !inDungeon(v) && !inShip(v) && !onDeck(v),
                maxFails: 4,
            },
        ),
        // --- ship: patch the hole, then step out ---
        phase(interact, loc('^Ladder$', '^Climb-up$', 3048, 9640, 2, [3047, 9640]), {
            name: 'hold-exit',
            when: v => started(v) && inShip(v) && lvl(v) === 2 && planks(v) === 0 && !given(v),
            maxFails: 4,
        }),
        phase(interact, loc('^Gangplank$', '^Cross$', 3047, 3206, 1, [3047, 3207]), {
            name: 'disembark',
            when: v => started(v) && onDeck(v) && planks(v) === 0 && !given(v),
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Hole$',
                use: { item: '^Plank$' },
                tile: { x: 3047, z: 9639, level: 1 },
                at: { x: 3047, z: 9640, level: 1, tolerance: 1 },
            },
            { name: 'patch', when: v => started(v) && planks(v) > 0 && inShip(v) && lvl(v) === 1, maxFails: 4 },
        ),
        phase(interact, loc('^Ladder$', '^Climb-down$', 3049, 3208, 1, [3049, 3207]), {
            name: 'hold-enter',
            when: v => started(v) && planks(v) > 0 && coins(v) < 2000 && onDeck(v),
            maxFails: 4,
        }),
        phase(interact, loc('^Gangplank$', '^Cross$', 3047, 3205, 0, [3047, 3204, 0]), {
            name: 'board-repair',
            when: v => started(v) && planks(v) > 0 && coins(v) < 2000 && !onDeck(v) && !inShip(v),
            maxFails: 4,
        }),
        // --- the Oracle's chest (Map part 3): the room behind the magic Door has no walk out, the Door opens from inside ---
        phase(interact, loc('^Door$', '^Open$', 3051, 9840, 0, [3052, 9840]), {
            name: 'oracle-room-exit',
            when: v => started(v) && p3(v) > 0 && inOracleRoom(v),
            maxFails: 4,
        }),
        // --- Port Sarim: Klarense (the ship), Wormbrain (Map part 2) ---
        phase(talk, talkTo('^Klarense$', 3047, 3204, ['could buy it', 'sounds good'], 0, 2), {
            name: 'klarense',
            when: v => started(v) && p2(v) > 0 && coins(v) >= 2000 && coins(v) < 10000 && planks(v) > 0,
            maxFails: 4,
        }),
        // Wormbrain sits behind the cell bars: `talk` finds him unreachable, the server takes the op from within 3 tiles in sight.
        phase(
            interact,
            {
                target: 'npc',
                name: '^Wormbrain$',
                option: '^Talk-to$',
                at: { x: 3011, z: 3188, level: 0, tolerance: 1 },
                unreachable: true,
                choices: ['piece of map', 'could pay', '10,000 it is'],
            },
            {
                name: 'wormbrain',
                when: v => started(v) && key(v) && p3(v) > 0 && p2(v) === 0 && coins(v) >= 10000 && !map(v),
                maxFails: 4,
            },
        ),

        phase(interact, loc('^Chest$', '^Search$', 3057, 9841, 0, [3057, 9842]), {
            name: 'oracle-chest-search',
            when: v =>
                started(v) && key(v) && v.inv('Silk') === 0 && p3(v) === 0 && p1(v) === 0 && !map(v) && !shieldHeld(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(interact, loc('^Chest$', '^Open$', 3057, 9841, 0, [3057, 9842]), {
            name: 'oracle-chest-open',
            when: v =>
                started(v) && key(v) && v.inv('Silk') === 0 && p3(v) === 0 && p1(v) === 0 && !map(v) && !shieldHeld(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(interact, loc('^Door$', '^Open$', 3051, 9840, 0, [3050, 9840]), {
            name: 'oracle-door',
            when: v => started(v) && key(v) && four(v) && dialogSeen(v, /behind a door below|worm string/i),
            maxFails: 4,
        }),
        phase(talk, talkTo('^Oracle$', 3015, 3503, ['piece of the map'], 0, 2), {
            name: 'oracle',
            when: v => started(v) && key(v) && four(v) && !dialogSeen(v, /behind a door below|worm string/i),
            maxFails: 4,
        }),
        // --- Oziach: the shield hint, the Maze key and the map hints ---
        phase(
            talk,
            talkTo(
                '^Oziach$',
                3069,
                3516,
                [
                    'sell me some Rune plate',
                    'guildmaster of the Champions',
                    'how am I meant to prove',
                    'dragon, that sounds',
                    'antidragon shield',
                    'where can I find this dragon',
                    'first piece',
                    'second piece',
                    'third piece',
                    'get everything together',
                ],
                0,
                2,
            ),
            { name: 'oziach-a', when: v => started(v) && !key(v), onFail: 'continue', maxFails: 3 },
        ),
        phase(
            talk,
            talkTo(
                '^Oziach$',
                3069,
                3516,
                [
                    'antidragon shield',
                    'where can I find this dragon',
                    'first piece',
                    'second piece',
                    'third piece',
                    'get everything together',
                ],
                0,
                2,
            ),
            { name: 'oziach-b', when: v => started(v) && !key(v), onFail: 'continue', maxFails: 3 },
        ),
        // Walking in through the north Door (3191,3363) makes the Guild master greet the bot (a continue page), which can
        // cost the first talk; the second talk starts inside the guild.
        phase(talk, talkTo('^Guild master$', 3191, 3360, ['Rune Plate mail']), {
            name: 'guild-master-retry',
            when: v => v.quest(ID) === 'none',
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(talk, talkTo('^Guild master$', 3191, 3360, ['Rune Plate mail']), {
            name: 'guild-master',
            when: v => v.quest(ID) === 'none',
            onFail: 'continue',
            maxFails: 4,
        }),
    ],
    until: v => v.questDone(ID),
});
