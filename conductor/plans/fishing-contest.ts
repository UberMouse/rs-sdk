// Fishing Contest (server scripts: quests/quest_fishingcompo/scripts/, areas/area_white_wolf_mountain/scripts/mountain_dwarf.rs2,
// areas/area_seers/scripts/{mcgrubors_wood,hemenster/bonzo}.rs2; varp fishingcompo 0 -> 1 started -> 2 in_comp -> 3 garlic_comp ->
// 4 won_comp -> complete). The Mountain dwarf (2821,3487) gives the Fishing pass after the "friend" chain; red vine worms come from
// the Vines in McGrubor's Wood (~2627-2633, 3492-3499, Check with a spade held, one worm each); Morris at the Hemenster gate
// (2642,3441) checks the pass; Bonzo (2641,3439) takes 5 gp; garlic used on a Wall Pipe (2636-2638,3446) moves the Sinister
// Stranger off the pipes spot; the Fishing spot by the pipes (2637,3444) with a worm gives a giant carp (each cast eats a worm,
// the 3rd catch makes Bonzo hand over the trophy); the trophy to the dwarf completes it.
// Start save: lib:fishing-contest-start (Fishing 15, Fishing rod, Spade, Garlic, 100 coins, at 2810,3480).
// Restart-safe: gates read held items and position, never run counts (except the one-shot Bonzo entry).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import travel from '@conductor/tasks/travel';
import talk from '@conductor/tasks/talk';

const ID = 'fishingcompo';
const WORMS = 6;
const n = (v: PlanView, name: string) => v.inv(name);
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const inside = (v: PlanView) => px(v) >= 2625 && px(v) <= 2642 && pz(v) >= 3430 && pz(v) <= 3450;
const inWood = (v: PlanView) => px(v) >= 2620 && px(v) <= 2661 && pz(v) >= 3485 && pz(v) <= 3503;
const nearRail = (v: PlanView) => Math.abs(px(v) - 2664) <= 4 && Math.abs(pz(v) - 3500) <= 4;
const out = (v: PlanView) => px(v) >= 2663 && pz(v) >= 3475;
const fighting = (v: PlanView) => v.state.player?.combat.inCombat === true;
const pass = (v: PlanView) => n(v, 'Fishing pass');
const worms = (v: PlanView) => n(v, 'Red vine worm');
const trophy = (v: PlanView) => n(v, 'Fishing trophy');

const dwarf = { npc: '^Mountain Dwarf$', at: { x: 2821, z: 3487, tolerance: 2 } };

export default definePlan({
    name: 'fishing-contest',
    description:
        'Fishing Contest: dwarf start, red vine worms from McGrubor Wood, Morris gate, Bonzo entry, garlic in the pipe, fish giant carp at the pipes, trophy to the dwarf.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        phase(
            combat,
            {
                target: 'Forester',
                skill: 'Strength',
                allowMaxed: true,
                targetRange: 'visible',
                area: { x: 2655, z: 3485, radius: 40 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 20,
            },
            {
                name: 'defend-forester',
                when: v => fighting(v),
                until: v => !fighting(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Guard dog',
                skill: 'Strength',
                allowMaxed: true,
                targetRange: 'visible',
                area: { x: 2655, z: 3485, radius: 40 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 20,
            },
            { name: 'defend-guard', when: v => fighting(v), until: v => !fighting(v), onFail: 'continue', maxFails: 4 },
        ),
        phase(talk, { ...dwarf }, { name: 'turn-in', when: v => trophy(v) > 0, maxFails: 3 }),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Fishing spot$',
                option: '^Fish$',
                expect: 'You catch',
                tile: { x: 2637, z: 3444 },
                at: { x: 2637, z: 3443, tolerance: 1 },
            },
            {
                name: 'fish',
                onFail: 'continue',
                when: v =>
                    inside(v) && (v.runs('garlic') > 0 || n(v, 'Garlic') === 0) && worms(v) > 0 && trophy(v) === 0,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Wall Pipe$',
                use: { item: '^Garlic$' },
                at: { x: 2637, z: 3444, tolerance: 1 },
            },
            {
                name: 'garlic',
                when: v => inside(v) && n(v, 'Garlic') > 0 && v.runs('bonzo') > 0 && v.runs('garlic') === 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Bonzo$',
                at: { x: 2640, z: 3439, tolerance: 1 },
                choices: ["I'll enter the competition"],
            },
            { name: 'bonzo', when: v => inside(v) && n(v, 'Garlic') > 0 && v.runs('bonzo') === 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Open$',
                tile: { x: 2642, z: 3441 },
                at: { x: 2644, z: 3441, tolerance: 1 },
            },
            {
                name: 'gate',
                when: v => !inside(v) && !inWood(v) && !out(v) && pass(v) > 0 && worms(v) >= WORMS && trophy(v) === 0,
                maxFails: 3,
            },
        ),
        // The view lags a step after a squeeze: walk on from the railing before the next choice.
        phase(
            travel,
            { to: { x: 2658, z: 3500 }, tolerance: 1 },
            { name: 'settle-in', when: v => v.last?.phase === 'squeeze-in' },
        ),
        phase(
            travel,
            { to: { x: 2664, z: 3500 }, tolerance: 1 },
            { name: 'settle-out', when: v => v.last?.phase === 'squeeze-out' },
        ),
        // Out of the wood the way in, in reverse, so the walker never plans through the locked gate (2649-2650,3469).
        phase(
            travel,
            { to: { x: 2675, z: 3465 }, tolerance: 2, waypoints: [{ x: 2680, z: 3485 }] },
            { name: 'exit', when: v => out(v) && !inside(v) && worms(v) >= WORMS && pass(v) > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Vine$',
                option: '^Check$',
                expect: 'You find a red vine worm',
                at: { x: 2630, z: 3495, tolerance: 6 },
            },
            { name: 'dig', when: v => pass(v) > 0 && worms(v) < WORMS && inWood(v), maxFails: 6 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Loose Railing$',
                option: '^Squeeze-through$',
                at: { x: 2660, z: 3500, tolerance: 1 },
            },
            {
                name: 'squeeze-out',
                when: v => inWood(v) && worms(v) >= WORMS && v.last?.phase !== 'squeeze-out',
                maxFails: 3,
            },
        ),
        // The Forester's gate (2649,3469) is locked, so the walker must come to the railing around the east side.
        phase(
            travel,
            {
                to: { x: 2664, z: 3500 },
                tolerance: 1,
                waypoints: [
                    { x: 2675, z: 3465 },
                    { x: 2680, z: 3485 },
                ],
            },
            {
                name: 'approach',
                when: v => pass(v) > 0 && worms(v) < WORMS && !inWood(v) && !inside(v) && !nearRail(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Loose Railing$',
                option: '^Squeeze-through$',
                at: { x: 2664, z: 3500, tolerance: 1 },
            },
            {
                name: 'squeeze-in',
                when: v =>
                    pass(v) > 0 && worms(v) < WORMS && !inWood(v) && !inside(v) && v.last?.phase !== 'squeeze-in',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                ...dwarf,
                choices: [
                    'wondering what was down',
                    'Why not',
                    'If you were my friend',
                    "let's be friends",
                    'how am I meant',
                    'Fortunately',
                ],
            },
            { name: 'start', when: v => pass(v) === 0 && v.quest(ID) !== 'done' && trophy(v) === 0 },
        ),
    ],
});
