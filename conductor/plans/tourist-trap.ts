// The Tourist Trap (server scripts: quests/quest_desertrescue/scripts/, varp desertrescue 0-29, 30 = done), start to done.
// The quest tab shows only none/started/done, so the stages ride on held items, worn items, position and the dialog
// and message history. Stages (varp): 0 Irena (south of the Shantay pass) -> 1; the Mercenary Captain (3270,3029,
// outside the camp gate): the "funny captain who can't fight his own battles" chain makes him fight alone, the kill
// gives a Metal key (-> 4); the Gate (3273,3029) with the key (-> 5; no weapon or armour worn in the camp); a male
// slave: lock-picking (Thieving roll, 3 fails in a row near a guard = a cell) and the trade of three desert clothes
// for slave clothes (-> 8); the Mine door (3301,3036) in slave clothes (-> 9, below at 3278,9426); the cave guard
// (3279,9415) wants a pineapple (-> 10); Al Shabim (Bedabin camp 3171,3025) gives a Bedobin key (-> 11); Captain Siad's
// office (ladder 3290,3036, level 1): bookcase search + sailing talk distract him, the chest opens with the key: Technical
// plans (-> 12); Al Shabim (needs a bronze bar and 10 feathers held) (-> 13); the tent guard (3170,3045) lets the plans in;
// the experimental anvil (3171,3048) makes a Prototype dart tip (Smithing 20), feathers on it a Prototype dart (Fletching
// 10, a fail wastes the 10 feathers); Al Shabim takes it (-> 16) and gives a Tenti pineapple + 6 bronze darts; the cave
// guard takes the pineapple (-> 17); the cave (3281,9415) -> the cart (3303,9417) to Ana's room (agility roll) -> an empty
// Barrel from the loading room used on Ana (-> 19) -> the barrel on the room's cart (3318,9430) (-> 20) -> that cart back
// (3302,9417) -> search a barrel there (-> 21) -> the winch bucket (3292,9423) with the guard (-> 22) -> out by the
// cave + the Mine door -> the winch (3279,3017) (-> 23) -> the barrel (3278,3017) (-> 24) -> the Mine Cart (3287,3023)
// (-> 25) -> the driver (100 gp bribe) -> the cart again (-> 26, lands at 3258,3029 with Ana in a barrel) -> the Shantay
// pass from the south (-> 27, Ana, Irena, two XP picks: -> 30).
// Heat: every ~150 ticks in the desert a waterskin charge is drunk (none left: 1-10 damage); the camp is exempt.
// Start save: lib:tourist-trap-start (Thieving 80, Fletching 10, 1000 coins, a Hammer, 3 Bronze bars and 100 Feathers; the plan buys the pass, desert clothes and waterskins at the Shantay shop).
// Restart-safe: gates read held items, worn items, position and the dialog and message history, never run counts.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'desertrescue';
// The two XP picks (116,250 XP each): any of Fletching, Agility, Smithing, Thieving.
const PICKS = ['Agility', 'Thieving'];

const n = (v: PlanView, name: string) => v.inv(name);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const under = (v: PlanView) => pz(v) > 9000;
const surface = (v: PlanView) => pz(v) < 6000;
const worn = (v: PlanView, re: RegExp) => v.state.equipment.some(i => re.test(i.name));
const inCamp = (v: PlanView) => surface(v) && px(v) >= 3274 && px(v) <= 3312 && pz(v) >= 3010 && pz(v) <= 3046;
const inTent = (v: PlanView) => surface(v) && px(v) >= 3166 && px(v) <= 3174 && pz(v) >= 3046 && pz(v) <= 3050;
const slaveWorn = (v: PlanView) => worn(v, /^Slaves' shirt$/i) && worn(v, /^Slave robe$/i) && worn(v, /^Slave boots$/i);
const slaveHeld = (v: PlanView) => n(v, "Slaves' shirt") > 0 && n(v, 'Slave robe') > 0 && n(v, 'Slave boots') > 0;

const slaveTried = (v: PlanView) => v.last?.phase === 'slave' || v.last?.phase === 'slave-retry';
const key = (v: PlanView) => n(v, 'Metal key');
const bkey = (v: PlanView) => n(v, 'Bedobin key');
const plans = (v: PlanView) => n(v, 'Technical plans');
const tip = (v: PlanView) => n(v, 'Prototype dart tip');
const dart = (v: PlanView) => n(v, 'Prototype dart');
const bd = (v: PlanView) => n(v, 'Bronze dart') > 0; // the 6 darts Al Shabim gives: stage 16 or later
const pine = (v: PlanView) => n(v, 'Tenti pineapple');
const barrel = (v: PlanView) => n(v, 'Barrel');
const ana = (v: PlanView) => n(v, 'Ana in a barrel');

const challenged = (v: PlanView) => heard(v, /challenging me/i);
// The guard's hint is gone from the 20-page history after the long talks that follow: later items stand for it.
const hintDone = (v: PlanView) =>
    heard(v, /I'm sure you get my meaning/i) || bkey(v) > 0 || plans(v) > 0 || tip(v) > 0 || dart(v) > 0 || bd(v);
const sailing = (v: PlanView) => heard(v, /books on the subject of sailing/i);
const distracted = (v: PlanView) => heard(v, /quite a catch in my day/i);
const curious = (v: PlanView) => heard(v, /all the items needed/i);
const sentOut = (v: PlanView) => heard(v, /cart moves out of sight/i);
const liftDone = (v: PlanView) => heard(v, /no one operating the lift/i);
const pulled = (v: PlanView) => heard(v, /OUT OF HERE/);
const pickedUp = (v: PlanView) => heard(v, /feel sick/i);
const ready = (v: PlanView) => heard(v, /get in the back of the cart|jump in the cart/i);

// Where the plan is working: inside the camp, or outside it.
const wantInside = (v: PlanView) =>
    !hintDone(v) || (bkey(v) > 0 && plans(v) === 0 && tip(v) === 0 && dart(v) === 0) || bd(v);
const loading = (v: PlanView) => under(v) && pz(v) <= 9425 && px(v) >= 3284;
const anaZone = (v: PlanView) => under(v) && pz(v) >= 9427;

const slaveChoices = [
    "I've just arrived",
    'that sounds interesting',
    "What's that then",
    'I can try to undo them',
    'funny you should say',
    "let's give it a go",
    "Yes, I'll trade|different instead",
];

export default definePlan({
    name: 'tourist-trap',
    description:
        'Tourist Trap: Shantay shop, pass, Irena, the Mercenary Captain, slave clothes, Al Shabim, Captain Siad plans, dart, Ana in a barrel by cart, winch and cart out, Irena.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            combat,
            {
                target: 'Mercenary Captain',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 3270, z: 3029, radius: 8 },
                food: ['Swordfish'],
                eatBelow: 0.5,
            },
            {
                name: 'fight',
                when: v => started(v) && key(v) === 0 && (challenged(v) || v.state.player?.combat.inCombat === true),
                until: v => key(v) > 0,
                maxFails: 4,
            },
        ),
        phase(
            items,
            { unequip: ['weapon'] },
            {
                name: 'unwield',
                when: v =>
                    key(v) > 0 &&
                    surface(v) &&
                    worn(v, /scimitar/i) &&
                    !(inCamp(v) && v.state.player?.combat.inCombat === true),
                maxFails: 2,
            },
        ),
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        phase(
            combat,
            {
                target: 'Rowdy Guard',
                skill: 'Strength',
                allowMaxed: true,
                targetRange: 'visible',
                area: { x: 3290, z: 3025, radius: 20 },
                weapon: 'Mithril scimitar',
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 20,
            },
            {
                name: 'defend',
                when: v => v.state.player?.combat.inCombat === true && inCamp(v),
                until: v => v.state.player?.combat.inCombat !== true,
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Rowdy Guard',
                skill: 'Strength',
                allowMaxed: true,
                targetRange: 'visible',
                area: { x: 3295, z: 9440, radius: 40 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 20,
            },
            {
                name: 'defend-mine',
                when: v =>
                    v.state.player?.combat.inCombat === true && under(v) && !/settle|mine$/.test(v.last?.phase ?? ''),
                until: v => v.state.player?.combat.inCombat !== true,
                maxFails: 4,
            },
        ),
        // --- the finish: Ana in a barrel to the Shantay pass from the south ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Shantay pass$',
                option: '^Go-through$',
                at: { x: 3302, z: 3113, tolerance: 2 },
                choices: PICKS,
            },
            { name: 'rescue', when: v => ana(v) > 0 && surface(v) && !inCamp(v), maxFails: 3 },
        ),
        // --- on the surface with Ana ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine Cart$',
                option: '^Search$',
                tile: { x: 3287, z: 3023 },
                at: { x: 3286, z: 3023, tolerance: 2 },
                choices: ["Yes, I'll get on"],
            },
            {
                name: 'ride-out',
                when: v => inCamp(v) && ana(v) === 0 && (ready(v) || v.last?.phase === 'driver'),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Mine cart driver$',
                at: { x: 3287, z: 3021, tolerance: 2 },
                choices: [
                    'Nice cart',
                    'wagon wheel',
                    'good turn deserves',
                    'shot perhaps',
                    'penny in for a pound',
                    "it's like this",
                    'ten gold',
                    'hundred it is',
                ],
            },
            {
                name: 'driver',
                when: v =>
                    inCamp(v) &&
                    ana(v) === 0 &&
                    pickedUp(v) &&
                    !ready(v) &&
                    n(v, 'Coins') >= 100 &&
                    v.last?.phase !== 'driver',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine Cart$',
                use: { item: '^Ana in a barrel$' },
                tile: { x: 3287, z: 3023 },
                at: { x: 3286, z: 3023, tolerance: 2 },
            },
            { name: 'cart-place', when: v => inCamp(v) && ana(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Barrel$',
                option: '^Search$',
                tile: { x: 3278, z: 3017 },
                at: { x: 3278, z: 3019, tolerance: 2 },
            },
            {
                name: 'take-upper',
                when: v => inCamp(v) && ana(v) === 0 && liftDone(v) && pulled(v) && !pickedUp(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch$',
                option: '^Use$',
                expect: 'OUT OF HERE',
                tile: { x: 3279, z: 3017 },
                at: { x: 3279, z: 3019, tolerance: 2 },
            },
            {
                name: 'winch',
                when: v => inCamp(v) && ana(v) === 0 && liftDone(v) && !pulled(v) && !pickedUp(v),
                maxFails: 3,
            },
        ),
        // --- underground with Ana ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine door entrance$',
                option: '^Open$',
                tile: { x: 3278, z: 9426 },
                at: { x: 3278, z: 9424, tolerance: 2 },
            },
            {
                name: 'exit-mine',
                when: v => under(v) && ana(v) === 0 && liftDone(v) && px(v) <= 3283,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Mine cave$', option: '^Walk.through$', at: { x: 3285, z: 9415, tolerance: 1 } },
            { name: 'cave-out', when: v => under(v) && ana(v) === 0 && liftDone(v) && px(v) >= 3284, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch bucket$',
                use: { item: '^Ana in a barrel$' },
                at: { x: 3292, z: 9421, tolerance: 2 },
                choices: ['Yes please', 'gregarious'],
            },
            { name: 'winch-help', when: v => loading(v) && ana(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Barrel$',
                option: '^Search$',
                tile: { x: 3303, z: 9418 },
                at: { x: 3302, z: 9418, tolerance: 2 },
            },
            {
                name: 'find-ana',
                when: v => loading(v) && barrel(v) === 0 && ana(v) === 0 && sentOut(v) && !liftDone(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine Cart$',
                option: '^Search$',
                tile: { x: 3318, z: 9430 },
                at: { x: 3318, z: 9429, tolerance: 1 },
                choices: ['Yes, of course'],
            },
            {
                name: 'ride-2',
                when: v => anaZone(v) && barrel(v) === 0 && ana(v) === 0 && sentOut(v),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine Cart$',
                use: { item: '^Ana in a barrel$' },
                tile: { x: 3318, z: 9430 },
                at: { x: 3318, z: 9429, tolerance: 1 },
            },
            { name: 'ana-cart', when: v => anaZone(v) && ana(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Ana$', use: { item: '^Barrel$' }, at: { x: 3302, z: 9464, tolerance: 3 } },
            { name: 'ana-barrel', when: v => anaZone(v) && barrel(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine Cart$',
                option: '^Search$',
                tile: { x: 3303, z: 9417 },
                at: { x: 3302, z: 9418, tolerance: 1 },
                choices: ['Yes, of course'],
            },
            { name: 'ride-1', when: v => loading(v) && barrel(v) > 0, onFail: 'continue', maxFails: 10 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Barrel$',
                option: '^Search$',
                tile: { x: 3303, z: 9418 },
                at: { x: 3302, z: 9418, tolerance: 2 },
                choices: ['Yeah, cool'],
            },
            {
                name: 'take-barrel',
                when: v =>
                    loading(v) &&
                    barrel(v) === 0 &&
                    ana(v) === 0 &&
                    !sentOut(v) &&
                    !liftDone(v) &&
                    bd(v) &&
                    pine(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Mine cave$', option: '^Walk.through$', at: { x: 3279, z: 9415, tolerance: 1 } },
            {
                name: 'cave-in',
                when: v => under(v) && px(v) <= 3280 && bd(v) && pine(v) === 0 && !liftDone(v) && ana(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Mercenary$',
                use: { item: '^Tenti pineapple$' },
                at: { x: 3278, z: 9417, tolerance: 2 },
            },
            { name: 'give-pineapple', when: v => under(v) && pine(v) > 0 && slaveWorn(v), maxFails: 3 },
        ),
        // --- the tent: darts ---
        phase(
            talk,
            { npc: '^Al Shabim$', at: { x: 3171, z: 3027, tolerance: 2 } },
            { name: 'show-dart', when: v => surface(v) && !inTent(v) && dart(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Tent door$', option: '^Walk-through$', at: { x: 3169, z: 3047, tolerance: 1 } },
            { name: 'tent-out', when: v => inTent(v) && dart(v) > 0, maxFails: 3 },
        ),
        phase(
            items,
            { combine: { use: '^Feather$', on: '^Prototype dart tip$', product: 'Prototype dart' } },
            { name: 'feathers', when: v => tip(v) > 0 && n(v, 'Feather') >= 10, onFail: 'continue', maxFails: 12 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: 'experimental anvil',
                use: { item: '^Bronze bar$' },
                at: { x: 3171, z: 3047, tolerance: 1 },
                choices: ["Yes, I'd like to try"],
            },
            {
                name: 'anvil',
                when: v => inTent(v) && plans(v) > 0 && n(v, 'Bronze bar') > 0 && tip(v) === 0 && dart(v) === 0,
                onFail: 'continue',
                maxFails: 5,
            },
        ),
        // The anvil's result lands a few seconds after the task ends: walk between two tiles until it shows.
        ...[
            { x: 3168, z: 3048 },
            { x: 3172, z: 3047 },
        ].map((t, i) =>
            phase(
                travel,
                { to: t, tolerance: 1 },
                {
                    name: `settle-${i}`,
                    when: v =>
                        inTent(v) &&
                        plans(v) > 0 &&
                        tip(v) === 0 &&
                        dart(v) === 0 &&
                        n(v, 'Bronze bar') === 0 &&
                        v.state.tick % 2 === i,
                    maxFails: 3,
                },
            ),
        ),
        phase(
            talk,
            { npc: '^Bedabin Nomad Guard$', at: { x: 3170, z: 3043, tolerance: 2 } },
            {
                name: 'tent-guard',
                when: v => surface(v) && !inTent(v) && plans(v) > 0 && curious(v) && tip(v) === 0 && dart(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Al Shabim$',
                at: { x: 3171, z: 3027, tolerance: 2 },
                choices: ['very interested', 'kind of curious'],
            },
            {
                name: 'shabim-plans',
                when: v =>
                    surface(v) &&
                    !inCamp(v) &&
                    plans(v) > 0 &&
                    !curious(v) &&
                    n(v, 'Bronze bar') > 0 &&
                    n(v, 'Feather') >= 10,
                maxFails: 3,
            },
        ),
        // --- Captain Siad's office (level 1) ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 3290, z: 3036 },
                at: { x: 3289, z: 3036, level: 1, tolerance: 1 },
            },
            { name: 'office-down', when: v => lvl(v) === 1 && plans(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                option: '^Open$',
                tile: { x: 3292, z: 3033 },
                at: { x: 3291, z: 3034, level: 1, tolerance: 1 },
            },
            {
                name: 'chest',
                when: v => lvl(v) === 1 && bkey(v) > 0 && plans(v) === 0 && distracted(v),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            {
                npc: '^Captain Siad$',
                at: { x: 3290, z: 3034, level: 1, tolerance: 2 },
                choices: ['I wanted to have a chat', 'lot of books', 'interested in sailing', 'cut of your jib'],
            },
            {
                name: 'siad',
                when: v => lvl(v) === 1 && bkey(v) > 0 && plans(v) === 0 && sailing(v) && !distracted(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Bookcase$',
                option: '^Search$',
                tile: { x: 3284, z: 3032 },
                at: { x: 3285, z: 3033, level: 1, tolerance: 1 },
                expect: 'sailing',
            },
            {
                name: 'bookcase',
                when: v => lvl(v) === 1 && bkey(v) > 0 && plans(v) === 0 && !sailing(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 3290, z: 3036 },
                at: { x: 3290, z: 3035, tolerance: 1 },
            },
            {
                name: 'office-up',
                when: v => inCamp(v) && lvl(v) === 0 && bkey(v) > 0 && plans(v) === 0 && tip(v) === 0 && dart(v) === 0,
                maxFails: 3,
            },
        ),
        // --- Al Shabim for the key ---
        phase(
            talk,
            {
                npc: '^Al Shabim$',
                at: { x: 3171, z: 3027, tolerance: 2 },
                choices: ['looking for a pineapple', "Yes, I'm interested"],
            },
            {
                name: 'shabim-key',
                when: v =>
                    surface(v) &&
                    !inCamp(v) &&
                    hintDone(v) &&
                    !bd(v) &&
                    bkey(v) === 0 &&
                    plans(v) === 0 &&
                    tip(v) === 0 &&
                    dart(v) === 0,
                maxFails: 3,
            },
        ),
        // --- the camp gate, both ways ---
        phase(
            items,
            { unequip: ['all'] },
            {
                name: 'strip',
                when: v => inCamp(v) && slaveWorn(v) && !wantInside(v) && under(v) === false,
                maxFails: 2,
            },
        ),
        phase(
            travel,
            { to: { x: 3277, z: 3029 }, tolerance: 1 },
            {
                name: 'step-in',
                when: v => surface(v) && px(v) === 3273 && wantInside(v) && ana(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 3268, z: 3029 }, tolerance: 1 },
            { name: 'step-out', when: v => surface(v) && px(v) === 3273 && !wantInside(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Open$',
                tile: { x: 3273, z: 3029 },
                at: { x: 3275, z: 3029, tolerance: 1 },
            },
            { name: 'gate-out', when: v => inCamp(v) && !wantInside(v) && !slaveWorn(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Open$',
                tile: { x: 3273, z: 3029 },
                at: { x: 3271, z: 3029, tolerance: 1 },
            },
            {
                name: 'gate-in',
                when: v =>
                    started(v) &&
                    key(v) > 0 &&
                    surface(v) &&
                    !inCamp(v) &&
                    !inTent(v) &&
                    px(v) <= 3272 &&
                    px(v) > 3240 &&
                    wantInside(v) &&
                    ana(v) === 0 &&
                    !worn(v, /scimitar/i),
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 3268, z: 3029 }, tolerance: 4 },
            {
                name: 'to-camp',
                when: v =>
                    started(v) &&
                    key(v) > 0 &&
                    surface(v) &&
                    !inCamp(v) &&
                    !inTent(v) &&
                    wantInside(v) &&
                    ana(v) === 0 &&
                    (px(v) <= 3240 || px(v) > 3312 || pz(v) < 3015 || pz(v) > 3046),
                maxFails: 3,
            },
        ),
        // The Rowdy Guards (3280,3026) (3287,3030) (3296,3026) attack anyone who passes within a tile: go round them.
        phase(
            travel,
            { to: { x: 3284, z: 3014 }, tolerance: 2, waypoints: [{ x: 3275, z: 3021 }] },
            {
                name: 'camp-route',
                when: v =>
                    inCamp(v) &&
                    lvl(v) === 0 &&
                    px(v) < 3282 &&
                    pz(v) > 3014 &&
                    ana(v) === 0 &&
                    ((!hintDone(v) && !slaveHeld(v)) || bd(v)),
                maxFails: 3,
            },
        ),
        // --- inside the camp, going into the mine ---
        phase(
            talk,
            {
                npc: '^Mercenary$',
                at: { x: 3278, z: 9418, tolerance: 2 },
                choices: ['different area', 'quite right', 'understand each other'],
            },
            { name: 'cave-guard', when: v => under(v) && slaveWorn(v) && !hintDone(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine door entrance$',
                option: '^Open$',
                tile: { x: 3278, z: 9426 },
                at: { x: 3278, z: 9424, tolerance: 2 },
            },
            {
                name: 'leave-mine',
                when: v => under(v) && hintDone(v) && !bd(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mine door entrance$',
                option: '^Open$',
                tile: { x: 3301, z: 3036 },
                at: { x: 3301, z: 3034, tolerance: 2 },
            },
            {
                name: 'mine-door',
                when: v => inCamp(v) && lvl(v) === 0 && slaveWorn(v) && wantInside(v) && ana(v) === 0 && !liftDone(v),
                maxFails: 3,
            },
        ),
        phase(
            items,
            { equip: ["Slaves' shirt", 'Slave robe', 'Slave boots'] },
            {
                name: 'dress',
                when: v => inCamp(v) && slaveHeld(v) && !slaveWorn(v) && wantInside(v) && (!hintDone(v) || bd(v)),
                maxFails: 2,
            },
        ),
        phase(
            talk,
            { npc: '^Male slave$', at: { x: 3301, z: 3017, tolerance: 1 }, choices: slaveChoices.slice(5) },
            {
                name: 'slave-retry',
                when: v =>
                    inCamp(v) &&
                    !slaveHeld(v) &&
                    n(v, 'Desert robe') > 0 &&
                    (heard(v, /suppose you want something/i) || slaveTried(v)),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { npc: '^Male slave$', at: { x: 3301, z: 3017, tolerance: 1 }, choices: slaveChoices },
            {
                name: 'slave',
                when: v => inCamp(v) && !slaveHeld(v) && !slaveWorn(v) && n(v, 'Desert robe') > 0 && !slaveTried(v),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // --- the Captain ---
        phase(
            talk,
            {
                npc: '^Mercenary Captain$',
                at: { x: 3267, z: 3029, tolerance: 3 },
                choices: ['Wow! A real captain', 'tough guy', "Can't I do something", 'Sorry Sir', 'funny captain'],
            },
            {
                name: 'captain',
                when: v => started(v) && key(v) === 0 && surface(v) && !challenged(v) && !inCamp(v),
                maxFails: 3,
            },
        ),
        // --- the start ---
        phase(
            talk,
            {
                npc: '^Irena$',
                at: { x: 3303, z: 3112, tolerance: 2 },
                choices: ["What's the matter", 'Is there a reward', 'calm down'],
            },
            { name: 'irena', when: v => v.quest(ID) === 'none' && pz(v) < 3116, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Shantay pass$',
                option: '^Go-through$',
                at: { x: 3302, z: 3119, tolerance: 2 },
                choices: ["poster doesn't scare"],
            },
            {
                name: 'cross',
                when: v => v.quest(ID) === 'none' && pz(v) >= 3116 && n(v, 'Desert robe') > 0,
                maxFails: 3,
            },
        ),
        phase(
            shop,
            {
                npc: 'Shantay',
                at: { x: 3304, z: 3121 },
                buy: [
                    { item: 'Shantay pass', count: 1 },
                    { item: 'Desert shirt', count: 1 },
                    { item: 'Desert robe', count: 1 },
                    { item: 'Desert boots', count: 1 },
                    { item: 'Waterskin(4)', count: 2 },
                ],
            },
            {
                name: 'shop',
                when: v => v.quest(ID) === 'none' && pz(v) >= 3116 && n(v, 'Desert robe') === 0,
                maxFails: 2,
            },
        ),
    ],
});
