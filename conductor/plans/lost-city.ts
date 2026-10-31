// Lost City (server/content/scripts/quests/quest_zanaris, areas/area_lumbridge/scripts/warrior_zanaris.rs2, areas/area_entrana,
// quest id zanaris, varp zanaris 0-6), start to done.
// Stages: 1 started (Warrior at the Lumbridge Swamp camp); 2 Shamus (chop the leprechaun tree, 'Tree' with a 'Chop' option)
// told the way; 3 Tree Spirit dead; 4 Dramen branch cut; 5 staff carved; 6 done (the shed door at (3202,3169) with the staff WORN).
// The Entrana monk refuses any carried or worn axe, staff, weapon or armour, so the bronze axe is dropped after Shamus and a
// new one comes from the Entrana zombies (50/128) in the dungeon. The dungeon ladder is one way (and drains 95% Prayer): the
// way out is Lumbridge Teleport (3 air, 1 earth, 1 law, Magic 31) cast with the staff in the pack.
// Needs: Woodcutting 36, Crafting 31, Magic 31 with the runes, melee able to kill the Tree Spirit (Att 90 Def 80 Str 95 HP 85),
// swordfish in separate slots, a bronze axe and a knife, nothing worn.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import talk from '@conductor/tasks/talk';
import teleport from '@conductor/tasks/teleport';

const ID = 'zanaris';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const nearNpc = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.some(n => re.test(n.name));

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const hasAxe = (v: PlanView) => v.inv(AXE) > 0;
const wornStaff = (v: PlanView) => v.state.equipment.some(i => /^dramen staff$/i.test(i.name));
const hasStaff = (v: PlanView) => v.inv('Dramen staff') > 0;
const hasBranch = (v: PlanView) => v.inv('Dramen branch') > 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);

const inDungeon = (v: PlanView) => pz(v) >= 9700 && pz(v) < 9900 && px(v) >= 2800 && px(v) <= 2900;
const onEntrana = (v: PlanView) => px(v) >= 2816 && px(v) <= 2885 && pz(v) >= 3328 && pz(v) <= 3412;
const onDeck = (v: PlanView) => onEntrana(v) && lvl(v) === 1 && px(v) <= 2840 && pz(v) <= 3336;
const mainland = (v: PlanView) => !inDungeon(v) && !onEntrana(v) && px(v) < 3300 && pz(v) < 3600;

// Dialog markers.
const spoken = (v: PlanView) =>
    said(v, /Dramenwood staffs|ship from Port Sarim|magically disappears|ending up in the shed/i);
const spiritDead = (v: PlanView) => said(v, /Tree Spirit defeated|now chop the tree/i);
const spiritNear = (v: PlanView) => nearNpc(v, /^Tree spirit$/i);

const TREE = { x: 2860, z: 9738 };
const SWAMP = { x: 3148, z: 3203 };

export default definePlan({
    name: 'lost-city',
    description:
        'Lost City to done: Warrior at the swamp camp, leprechaun tree, Shamus, drop the axe, ship to Entrana, cave monk ladder, zombie axe, Dramen tree and Tree Spirit, branch, staff, Lumbridge Teleport, wear the staff, shed door.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'Woodcutting 36, Crafting 31, Magic 31': v =>
            v.level('Woodcutting') >= 36 && v.level('Crafting') >= 31 && v.level('Magic') >= 31,
    },
    until: v => done(v),
    phases: [
        // --- the end: staff on, through the shed door ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 3202, z: 3169 },
                at: { x: 3202, z: 3171, tolerance: 1 },
            },
            { name: 'enter-shed', when: v => wornStaff(v) && mainland(v), maxFails: 3 },
        ),
        phase(
            items,
            { equip: ['Dramen staff'] },
            { name: 'wear-staff', when: v => hasStaff(v) && !wornStaff(v) && mainland(v), maxFails: 2 },
        ),
        // The only way out of the dungeon. A cast sent in the tick after the carve was once dropped with nothing spent; the next try
        // is allowed while a law rune is held (the cast moves the bot out of the dungeon, so a success is never repeated).
        phase(
            teleport,
            { spell: 'lumbridge' },
            {
                name: 'tele-out',
                when: v => inDungeon(v) && hasStaff(v) && v.inv('Law rune') > 0,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            items,
            { combine: { use: '^Knife$', on: '^Dramen branch$', product: 'Dramen staff' } },
            { name: 'carve', when: v => hasBranch(v), maxFails: 2 },
        ),
        // --- the tree: fight the spirit it raises, then cut the branch ---
        phase(
            combat,
            {
                target: 'Tree spirit',
                skill: 'Strength',
                area: { x: TREE.x, z: TREE.z, radius: 8 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 60,
            },
            {
                name: 'spirit',
                when: v => inDungeon(v) && spiritNear(v) && !spiritDead(v),
                until: v => spiritDead(v),
                maxFails: 2,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Dramen tree$', option: '^Chop', at: { ...TREE, tolerance: 2 } },
            {
                name: 'chop-dramen',
                when: v => inDungeon(v) && hasAxe(v) && !hasBranch(v) && !hasStaff(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // The axe comes off the Entrana zombies.
        phase(
            combat,
            {
                target: 'Zombie',
                skill: 'Strength',
                area: { x: 2845, z: 9761, radius: 14 },
                food: ['Swordfish'],
                loot: ['Bronze axe', 'Iron axe'],
                maxLevelGap: 60,
            },
            {
                name: 'get-axe',
                when: v => inDungeon(v) && !hasAxe(v) && !hasBranch(v) && !hasStaff(v),
                until: v => hasAxe(v),
                maxFails: 3,
            },
        ),
        // --- Entrana surface: the cave monk's ladder (one way) ---
        phase(
            talk,
            { npc: '^Cave monk$', at: { x: 2822, z: 3374, tolerance: 2 }, choices: ['risk'] },
            { name: 'ladder', when: v => onEntrana(v) && lvl(v) === 0 && !hasStaff(v) && !hasBranch(v), maxFails: 2 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { x: 2834, z: 3333, level: 1 } },
            { name: 'off-deck', when: v => onDeck(v), maxFails: 3 },
        ),
        // --- the mainland: ship out once Shamus has spoken and the axe is gone ---
        phase(
            talk,
            { npc: 'Monk of Entrana', at: { x: 3047, z: 3236, tolerance: 2 }, choices: ['Yes, okay'], travels: true },
            {
                name: 'board',
                when: v => mainland(v) && started(v) && spoken(v) && !hasAxe(v) && !hasStaff(v) && !hasBranch(v),
                maxFails: 3,
            },
        ),
        phase(
            items,
            { drop: [{ item: '^Bronze axe$', count: 1 }] },
            {
                name: 'drop-axe',
                when: v => mainland(v) && started(v) && spoken(v) && v.inv('Bronze axe') > 0,
                maxFails: 2,
            },
        ),
        // --- the swamp: Warrior, the leprechaun tree, Shamus ---
        phase(
            talk,
            { npc: '^Shamus$', choices: ['How does it fit'] },
            {
                name: 'shamus',
                when: v => mainland(v) && started(v) && !spoken(v) && nearNpc(v, /^Shamus$/i),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Tree$', option: '^Chop$', at: { ...SWAMP, tolerance: 12 } },
            {
                name: 'chop-leprechaun',
                onFail: 'continue',
                when: v => mainland(v) && started(v) && !spoken(v) && hasAxe(v) && !nearNpc(v, /^Shamus$/i),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Warrior$',
                at: { ...SWAMP, tolerance: 6 },
                choices: [
                    'What are you camped here for',
                    "Who's Zanaris",
                    "If it's hidden",
                    "Looks like you don't know",
                ],
            },
            { name: 'start', when: v => mainland(v) && !started(v) && !done(v), maxFails: 3 },
        ),
    ],
});
