import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'ikov';
const FOOD = ['Swordfish'];
const done = (v: PlanView) => v.questDone(ID);
const started = (v: PlanView) => v.quest(ID) === 'started';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const fighting = (v: PlanView) => v.state.player?.combat.inCombat === true;
const nearNpc = (v: PlanView, re: RegExp) =>
    v.state.nearbyNpcs.some(n => re.test(n.name) && n.inCombat && n.distance <= 3);
const worn = (v: PlanView, re: RegExp) => v.state.equipment.some(i => re.test(i.name));

const underground = (v: PlanView) => pz(v) > 5000;
const startRoom = (v: PlanView) => underground(v) && pz(v) >= 9780;
const southCave = (v: PlanView) => underground(v) && pz(v) < 9780;
const bootsOn = (v: PlanView) => worn(v, /^boots of lightness$/i);
const bootsHeld = (v: PlanView) => v.inv('Boots of lightness') > 0;

const webClosed = (v: PlanView) =>
    v.state.nearbyLocs.some(
        l => /^web$/i.test(l.name) && l.x === 2654 && l.z === 9766 && l.options.some(o => /slash/i.test(o)),
    );

const nearWeb = (v: PlanView) => Math.abs(px(v) - 2654) + Math.abs(pz(v) - 9765) <= 3;

const ARROWS = 30;
const ice = (v: PlanView) =>
    v.inv('Ice arrows') + v.state.equipment.filter(i => /^ice arrows$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
const lever = (v: PlanView) => v.inv('Lever');
// Standing at the bracket with no lever and no mended lever left: it was fitted and pulled (the client keeps no trace of
// it), and the way east to the chests is open.
const atBracket = (v: PlanView) => Math.abs(px(v) - 2671) + Math.abs(pz(v) - 9805) <= 8;
const fish = (v: PlanView) => v.inv('Swordfish');
// The lava bridge before the lever room needs weight below zero (about five swordfish with the boots), so the first
// trip is made light; the ice spiders at the chests then eat a lot, so the fish are restocked once the lever is pulled.
const leverDone = (v: PlanView) =>
    underground(v) && needFish(v) && atBracket(v) && px(v) <= 2690 && lever(v) === 0 && !mendedLever(v);
const lowFoodEast = (v: PlanView) => underground(v) && bootsOn(v) && ice(v) < ARROWS && fish(v) < 2 && px(v) > 2690;
const needFish = (v: PlanView) =>
    bootsOn(v) && ice(v) < ARROWS && fish(v) < 10 && v.inv('Limpwurt root') < 20 && !hasArmadyl(v);
const needRoots = (v: PlanView) => ice(v) >= ARROWS && v.inv('Limpwurt root') < 20;
const soft = { onFail: 'continue', maxFails: 25 } as const;
// The six chests (the arrows sit in one at a time), in the order of a short loop; the stand tile is north of each.
const CHESTS = [
    { x: 2710, z: 9850 },
    { x: 2719, z: 9838 },
    { x: 2738, z: 9835 },
    { x: 2745, z: 9821 },
    { x: 2747, z: 9848 },
    { x: 2729, z: 9850 },
];
const chestOf = (k: number) => CHESTS[k] ?? { x: 0, z: 0 };
const chestAt = (v: PlanView, k: number, name: RegExp) =>
    v.state.nearbyLocs.some(l => name.test(l.name) && l.x === chestOf(k).x && l.z === chestOf(k).z);
const nearChestK = (v: PlanView, k: number) => Math.abs(px(v) - chestOf(k).x) + Math.abs(pz(v) - chestOf(k).z) <= 3;
const nearAnyChest = (v: PlanView) => CHESTS.some((_, k) => nearChestK(v, k));
// The chests stand in gaps of the cave walls; the walk to within 3 tiles lands on whichever side is reachable and the server walks the rest.
const stand = (k: number) => ({ x: chestOf(k).x, z: chestOf(k).z, tolerance: 3 });

const mendedLever = (v: PlanView) =>
    v.state.nearbyLocs.some(
        l => /^lever$/i.test(l.name) && l.x === 2671 && l.z === 9804 && l.options.some(o => /^pull$/i.test(o)),
    );
const sweeping = (v: PlanView) =>
    ice(v) < ARROWS &&
    v.inv('Limpwurt root') < 20 &&
    !inTemple(v) &&
    underground(v) &&
    bootsOn(v) &&
    lever(v) === 0 &&
    !leverDone(v) &&
    fish(v) > 0 &&
    !mendedLever(v) &&
    (px(v) > 2690 || atBracket(v) || fish(v) > 6);

const leverFetch = (v: PlanView) =>
    bootsOn(v) &&
    lever(v) === 0 &&
    underground(v) &&
    ice(v) < ARROWS &&
    px(v) < 2690 &&
    !atBracket(v) &&
    !mendedLever(v) &&
    fish(v) <= 6 &&
    v.inv('Limpwurt root') < 20 &&
    !inTemple(v);
// The lever room is entered from the start room's west side; from the far side of the fear gate it reads unreachable.
const leverCutOff = (v: PlanView) => v.state.groundItems.some(i => /^lever$/i.test(i.name) && i.reachable === false);

const anyNpc = (v: PlanView, re: RegExp, dist: number) =>
    v.state.nearbyNpcs.some(n => re.test(n.name) && n.distance <= dist);
const roots = (v: PlanView) => v.inv('Limpwurt root');
// After the chests: the roots are in the pack and the ice arrows held.
const armed = (v: PlanView) => roots(v) >= 20;
// The corridor south of the Fire Warrior's door, and the rooms north of it.
const corridor = (v: PlanView) => underground(v) && px(v) >= 2636 && px(v) <= 2656 && pz(v) >= 9857 && pz(v) <= 9869;
const northRooms = (v: PlanView) => underground(v) && px(v) >= 2620 && px(v) <= 2700 && pz(v) >= 9871;
const onLever = (v: PlanView) => Math.abs(px(v) - 2665) <= 1 && Math.abs(pz(v) - 9855) <= 1;
const nearLever = (v: PlanView) => Math.abs(px(v) - 2665) + Math.abs(pz(v) - 9853) <= 5;
const trapStage = (v: PlanView) => armed(v) && underground(v) && !corridor(v) && !northRooms(v);
const ground = (v: PlanView, re: RegExp) => v.state.groundItems.some(i => re.test(i.name));
const lowHp = (v: PlanView) => (v.state.player?.hp ?? 99) < (v.state.player?.maxHp ?? 99) * 0.45 && fish(v) === 0;
// The temple proper, past the Fire Warrior's door and Winelda's teleport.
const inTemple = (v: PlanView) => underground(v) && pz(v) >= 9857 && !(px(v) >= 2640 && px(v) <= 2660 && pz(v) <= 9869);
const hasArmadyl = (v: PlanView) => v.inv('Armadyl pendant') > 0 || worn(v, /^armadyl pendant$/i);
const guardiansNear = (v: PlanView) =>
    v.state.nearbyNpcs.some(n => /^Guardian of Armadyl$/i.test(n.name) && n.distance <= 8 && n.reachable === true);
const hasKey = (v: PlanView) => v.inv('Shiny key') > 0;
const warriorRe = /^Fire Warrior of Lesarkus$/i;

const defend = (name: string) =>
    phase(
        combat,
        {
            target: name,
            skill: 'Ranged',
            weapon: 'Yew shortbow',
            ammo: 'Rune arrow',
            area: { x: 2660, z: 9815, radius: 70 },
            food: FOOD,
            loot: ['Rune arrow'],
            prayers: name === 'Ice spider' ? [] : ['Protect from Melee'],
            maxLevelGap: 80,
        },
        {
            name: `defend-${name.toLowerCase().replace(/ /g, '-')}`,
            when: v => !done(v) && fighting(v) && nearNpc(v, new RegExp(`^${name}$`, 'i')) && v.inv('Swordfish') > 0,
            until: v => !fighting(v),
            onFail: 'continue',
            maxFails: 10,
        },
    );

const chestPhases = CHESTS.flatMap((c, k) => [
    phase(
        interact,
        { target: 'loc', name: '^Closed chest$', option: '^Open$', tile: c, at: stand(k), unreachable: true },
        {
            name: `chest-open-${k}`,
            when: v => sweeping(v) && nearChestK(v, k) && chestAt(v, k, /^closed chest$/i),
            ...soft,
        },
    ),
    phase(
        interact,
        { target: 'loc', name: '^Open chest$', option: '^Search$', tile: c, at: stand(k), expect: 'found' },
        {
            name: `chest-search-${k}`,
            when: v => sweeping(v) && nearChestK(v, k) && chestAt(v, k, /^open chest$/i),
            onFail: 'continue',
            maxFails: 300,
        },
    ),
    phase(
        travel,
        { to: stand((k + 1) % CHESTS.length), tolerance: 3 },
        {
            name: `chest-next-${k}`,
            when: v => sweeping(v) && nearChestK(v, k) && chestAt(v, k, /^open chest$/i),
            ...soft,
        },
    ),
]);

// A fight breaks the loop: walk on from the chest nearest to where the bot stands.
const nearestChest = (v: PlanView) =>
    CHESTS.map((c, k) => ({ k, d: Math.abs(px(v) - c.x) + Math.abs(pz(v) - c.z) })).sort((a, b) => a.d - b.d)[0]?.k ??
    0;
const chestApproach = CHESTS.map((_, k) =>
    phase(
        travel,
        { to: stand(k), tolerance: 3 },
        { name: `to-chest-${k}`, when: v => sweeping(v) && !nearAnyChest(v) && nearestChest(v) === k, ...soft },
    ),
);

export default definePlan({
    name: 'temple-of-ikov',
    description: 'Temple of Ikov (draft).',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => done(v),
    phases: [
        defend('Skeleton'),
        defend('Giant bat'),
        defend('Scorpion'),
        defend('Ice spider'),
        phase(
            items,
            { equip: ['^Pendant of lucien$'] },
            {
                name: 'wear-pendant',
                when: v => v.inv('Pendant of lucien') > 0 && !hasArmadyl(v) && !(inTemple(v) && roots(v) < 20),
                ...soft,
            },
        ),
        phase(items, { equip: ['^Boots of lightness$'] }, { name: 'wear-boots', when: v => bootsHeld(v), ...soft }),
        phase(
            interact,
            { target: 'loc', name: '^Stairs$', option: '^Climb-up$', at: { x: 2638, z: 9763, tolerance: 2 } },
            { name: 'stairs-up', when: v => bootsOn(v) && southCave(v), ...soft },
        ),
        phase(
            travel,
            { to: { x: 2653, z: 9764 }, tolerance: 1 },
            {
                name: 'to-web',
                when: v => !bootsOn(v) && !bootsHeld(v) && southCave(v) && webClosed(v) && !nearWeb(v),
                ...soft,
            },
        ),
        // A slash cuts the web half the time and a miss changes nothing the idle rail sees, so the knife is used three times in a row.
        phase(
            talk,
            { use: { items: ['^Knife$', '^Knife$', '^Knife$'], onLoc: '^Web$', tile: { x: 2654, z: 9766 } } },
            { name: 'web', when: v => !bootsOn(v) && !bootsHeld(v) && southCave(v) && webClosed(v), ...soft },
        ),
        phase(
            pickup,
            { area: { x: 2654, z: 9767, radius: 2 }, items: [{ item: 'Boots of lightness', count: 1 }] },
            { name: 'boots', when: v => !bootsOn(v) && !bootsHeld(v) && southCave(v) && !webClosed(v), ...soft },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stairs$', option: '^Climb-down$', at: { x: 2654, z: 9808, tolerance: 1 } },
            {
                name: 'stairs-down',
                when: v => !bootsOn(v) && !bootsHeld(v) && startRoom(v) && v.inv('Lit candle') > 0,
                ...soft,
            },
        ),
        ...chestPhases,
        ...chestApproach,
        phase(
            interact,
            {
                target: 'loc',
                name: '^Lever$',
                option: '^Pull$',
                tile: { x: 2671, z: 9804 },
                at: { x: 2671, z: 9805, tolerance: 1 },
                unreachable: true,
            },
            { name: 'pull', when: v => lever(v) === 0 && underground(v) && mendedLever(v), ...soft },
        ),
        phase(
            talk,
            {
                at: { x: 2672, z: 9805, tolerance: 1 },
                use: { items: ['^Lever$'], onLoc: '^Lever bracket$', tile: { x: 2671, z: 9804 } },
            },
            { name: 'bracket', when: v => lever(v) > 0 && underground(v), ...soft },
        ),
        phase(
            travel,
            { to: { x: 2654, z: 9809 }, tolerance: 2 },
            { name: 'to-lever', when: v => leverFetch(v) && leverCutOff(v), ...soft },
        ),
        phase(
            pickup,
            { area: { x: 2637, z: 9819, radius: 6 }, items: [{ item: 'Lever', count: 1 }] },
            { name: 'lever', when: v => leverFetch(v), ...soft },
        ),
        phase(
            bank,
            {
                area: { x: 2655, z: 3283, radius: 10 },
                depositAllExcept: ['Coins', 'Ice arrows'],
                withdraw: [
                    { item: 'Limpwurt root', count: 20, upTo: true },
                    { item: 'Swordfish', count: 5, upTo: true },
                ],
            },
            { name: 'roots', when: v => !underground(v) && needRoots(v), ...soft },
        ),
        phase(
            bank,
            {
                area: { x: 2655, z: 3283, radius: 10 },
                depositAllExcept: ['Coins', 'Swordfish', 'Ice arrows'],
                withdraw: [{ item: 'Swordfish', count: 14, upTo: true }],
            },
            { name: 'restock', when: v => needFish(v) && !underground(v), ...soft },
        ),
        // The dark stairs are done with: dropping the candle is also the change of state the idle rail wants before the climb.
        phase(
            items,
            { drop: [{ item: '^Lit candle$', count: 1 }] },
            { name: 'drop-candle', when: v => leverDone(v) && v.inv('Lit candle') > 0, ...soft },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2677, z: 9804, tolerance: 1 } },
            {
                name: 'ladder-up',
                when: v =>
                    underground(v) && (needRoots(v) || lowFoodEast(v) || (leverDone(v) && v.inv('Lit candle') === 0)),
                ...soft,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-down$', at: { x: 2677, z: 3404, tolerance: 1 } },
            {
                name: 'ladder-down',
                when: v => started(v) && !underground(v) && !hasArmadyl(v) && !needFish(v) && !needRoots(v),
                ...soft,
            },
        ),
        // Out of food and under half health near the warrior: get out of its range (6 tiles) before anything else.
        phase(
            travel,
            { to: { x: 2665, z: 9852 }, tolerance: 2, flee: true },
            { name: 'warrior-retreat', when: v => underground(v) && anyNpc(v, warriorRe, 14) && lowHp(v), ...soft },
        ),
        // --- the Fire Warrior: the door opens only after the trap lever (searched with Thieving 42, then pulled) ---
        phase(
            combat,
            {
                target: 'Fire Warrior of Lesarkus',
                skill: 'Ranged',
                weapon: 'Yew shortbow',
                ammo: 'Ice arrows',
                area: { x: 2646, z: 9866, radius: 12 },
                food: FOOD,
                eatBelow: 0.5,
                loot: ['Ice arrows'],
                // Its fire blast is a spell: Protect from Magic stops it.
                prayers: ['Protect from Magic'],
                maxLevelGap: 80,
            },
            {
                name: 'fire-warrior',
                when: v => underground(v) && anyNpc(v, warriorRe, 14) && ice(v) > 0 && !lowHp(v),
                ...soft,
            },
        ),
        phase(
            pickup,
            { area: { x: 2646, z: 9866, radius: 5 }, items: [{ item: 'Ice arrows', count: ARROWS }] },
            {
                name: 'ice-pickup',
                when: v =>
                    corridor(v) &&
                    !anyNpc(v, warriorRe, 14) &&
                    ice(v) < ARROWS &&
                    ground(v, /^ice arrows$/i) &&
                    !lowHp(v),
                ...soft,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2646, z: 9870 },
                at: { x: 2646, z: 9868, tolerance: 1 },
            },
            { name: 'fire-door', when: v => corridor(v) && !anyNpc(v, warriorRe, 14), ...soft },
        ),
        phase(
            talk,
            { npc: '^Winelda$', at: { x: 2656, z: 9873, tolerance: 2 }, choices: ['Yes I do'] },
            { name: 'winelda-1', when: v => northRooms(v) && roots(v) >= 20 && ice(v) >= 0 && px(v) < 2662, ...soft },
        ),
        phase(
            talk,
            { npc: '^Winelda$', at: { x: 2656, z: 9873, tolerance: 2 } },
            { name: 'winelda-2', when: v => northRooms(v) && roots(v) >= 20 && px(v) < 2662, ...soft },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Lever$', option: '^Pull$', tile: { x: 2665, z: 9855 }, expect: 'never' },
            { name: 'trap-pull', when: v => trapStage(v) && onLever(v), ...soft },
        ),
        phase(
            travel,
            { to: { x: 2646, z: 9868 }, tolerance: 1 },
            { name: 'to-fire-door', when: v => trapStage(v) && onLever(v), ...soft },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Lever$',
                option: '^Search for traps$',
                tile: { x: 2665, z: 9855 },
                at: { x: 2665, z: 9853, tolerance: 1 },
                unreachable: true,
                expect: 'disable the trap',
            },
            { name: 'trap-search', when: v => trapStage(v) && nearLever(v) && !onLever(v), ...soft },
        ),
        phase(
            travel,
            { to: { x: 2665, z: 9852 }, tolerance: 2 },
            { name: 'to-trap-lever', when: v => trapStage(v) && !nearLever(v), ...soft },
        ),
        // The key opens the temple's way out (the surface door); the secret wall at (2643,9892) leads to the Guardians.
        // A scuffle with a passing skeleton or demon fails a pickup once; the twin phase tries again.
        ...['key', 'key-again'].map(name =>
            phase(
                pickup,
                { area: { x: 2628, z: 9859, radius: 3 }, items: [{ item: 'Shiny key', count: 1 }] },
                { name, when: v => inTemple(v) && roots(v) < 20 && !hasKey(v) && !hasArmadyl(v), ...soft },
            ),
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Wall$',
                option: '^Push$',
                tile: { x: 2643, z: 9892 },
                at: { x: 2644, z: 9892, tolerance: 1 },
            },
            {
                name: 'wall',
                when: v => inTemple(v) && roots(v) < 20 && hasKey(v) && !hasArmadyl(v) && !guardiansNear(v),
                ...soft,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2659, z: 9891, tolerance: 1 } },
            { name: 'temple-ladder', when: v => underground(v) && hasArmadyl(v), ...soft },
        ),
        // --- the Guardians of Armadyl (the Armadyl ending): the Lucien pendant must be off or they attack ---
        phase(
            items,
            { equip: ['^Armadyl pendant$'] },
            { name: 'wear-armadyl', when: v => v.inv('Armadyl pendant') > 0, ...soft },
        ),
        phase(
            talk,
            {
                npc: '^Guardian of Armadyl$',
                at: { x: 2646, z: 9899, tolerance: 3 },
                choices: ['seek the Staff', 'Lucien will give me', 'yearly bath', "I'll help"],
            },
            {
                name: 'guardian',
                when: v =>
                    inTemple(v) &&
                    roots(v) < 20 &&
                    !worn(v, /^pendant of lucien$/i) &&
                    !hasArmadyl(v) &&
                    hasKey(v) &&
                    guardiansNear(v),
                ...soft,
            },
        ),
        phase(
            items,
            { unequip: ['^Pendant of lucien$'] },
            {
                name: 'pendant-off',
                when: v => inTemple(v) && roots(v) < 20 && worn(v, /^pendant of lucien$/i),
                ...soft,
            },
        ),
        // --- the Armadyl ending: Lucien (north of Varrock) falls to anyone wearing the Armadyl pendant ---
        phase(
            combat,
            {
                target: 'Lucien',
                skill: 'Ranged',
                weapon: 'Yew shortbow',
                ammo: 'Rune arrow',
                area: { x: 3176, z: 3476, radius: 8 },
                food: FOOD,
                maxLevelGap: 80,
            },
            {
                name: 'lucien-fight',
                when: v =>
                    !underground(v) && px(v) > 3100 && worn(v, /^armadyl pendant$/i) && anyNpc(v, /^Lucien$/i, 12),
                ...soft,
            },
        ),
        // The temple stands inside McGrubor's Wood: its gate is locked from the inside, the loose railing is the way out.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Loose Railing$',
                option: '^Squeeze-through$',
                tile: { x: 2662, z: 3500 },
                at: { x: 2661, z: 3500, tolerance: 1 },
            },
            {
                name: 'wood-railing',
                when: v => !underground(v) && hasArmadyl(v) && px(v) < 2662 && pz(v) >= 3460 && pz(v) < 3520,
                ...soft,
            },
        ),
        phase(
            travel,
            { to: { x: 3176, z: 3479 }, tolerance: 3 },
            { name: 'to-lucien', when: v => !underground(v) && hasArmadyl(v) && !anyNpc(v, /^Lucien$/i, 12), ...soft },
        ),
        phase(
            talk,
            { npc: '^Lucien$', at: { x: 2573, z: 3321, tolerance: 2 }, choices: ['mighty hero', 'laugh'] },
            { name: 'lucien', when: v => !started(v) && !done(v), ...soft },
        ),
    ],
});
