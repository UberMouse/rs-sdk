// Crafting 1 -> 80: Khazard shears -> shear sheep north of Ardougne -> spin wool at the Gnome Stronghold wheel
// (to Crafting 10), then pick Stronghold flax -> spin bow strings -> bank them at the Stronghold bank, looping.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import interact from '@conductor/tasks/interact';
import pick from '@conductor/tasks/pick';
import shop from '@conductor/tasks/shop';
import spinning from '@conductor/tasks/spinning';
import travel from '@conductor/tasks/travel';

type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const far = (v: V) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - 2465) > 60 || Math.abs(p.worldZ - 3410) > 60;
};
const WHEEL = { x: 2475, z: 3398, level: 1 };

export default definePlan({
    name: 'crafting80',
    description: 'Wool to Crafting 10, then Gnome Stronghold flax -> bow string -> bank loop',
    phases: [
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 3104, z: 3160, level: 1, tolerance: 3 },
            },
            {
                name: 'tower-down',
                maxFails: 4,
                when: v =>
                    (v.state.player?.level ?? 0) > 0 &&
                    (v.state.player?.worldX ?? 0) > 3050 &&
                    (v.state.player?.worldX ?? 0) < 3150,
            },
        ),
        phase(
            travel,
            { to: { x: 2478, z: 3402 }, tolerance: 6 },
            { name: 'to-stronghold', when: v => far(v) && (v.level('Crafting') >= 10 || v.inv('Wool') >= 18) },
        ),
        phase(
            spinning,
            { material: 'wool', wheel: WHEEL },
            { name: 'spin-wool', when: v => v.inv('Wool') >= 18 && v.level('Crafting') < 10 },
        ),
        phase(
            spinning,
            { material: 'flax', wheel: WHEEL },
            { name: 'spin-flax', when: v => v.inv('Flax') > 0 && v.full && v.level('Crafting') >= 10 },
        ),
        phase(
            bank,
            { area: { x: 2445, z: 3425, radius: 4, level: 1 }, depositAllExcept: [] },
            { name: 'bank-strings', when: v => v.inv('Bow string') > 0 && v.inv('Flax') === 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 2475, z: 3401, level: 1, tolerance: 2 },
            },
            {
                name: 'descend',
                when: v =>
                    v.state.player?.level === 1 &&
                    ((v.inv('Shears') > 0 && v.inv('Wool') < 18 && v.level('Crafting') < 10) ||
                        (v.level('Crafting') >= 10 && !v.full && v.inv('Flax') < 28)),
            },
        ),
        phase(
            bank,
            {
                area: { x: 2655, z: 3283, radius: 5 },
                depositAllExcept: [],
                withdraw: [
                    { item: 'Shears', count: 1 },
                    { item: 'Wool', count: 5 },
                ],
            },
            {
                name: 'get-shears',
                when: v =>
                    v.inv('Shears') === 0 &&
                    v.runs('get-shears') === 0 &&
                    v.inv('Wool') < 18 &&
                    v.level('Crafting') < 10,
            },
        ),
        phase(
            travel,
            { to: { x: 2653, z: 3368 }, tolerance: 2 },
            {
                name: 'to-sheep',
                when: v => {
                    const p = v.state.player;
                    const away = !p || Math.abs(p.worldX - 2650) > 30 || Math.abs(p.worldZ - 3372) > 30;
                    return away && v.inv('Shears') > 0 && v.inv('Wool') < 18 && v.level('Crafting') < 10;
                },
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Sheep$',
                use: { item: '^Shears$' },
                npcId: 43,
                expect: 'you get some wool',
                at: { x: 2653, z: 3367, tolerance: 2 },
            },
            {
                name: 'shear1',
                maxFails: 15,
                onFail: 'continue',
                when: v => v.inv('Shears') > 0 && v.inv('Wool') < 18 && v.level('Crafting') < 10,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Sheep$',
                use: { item: '^Shears$' },
                npcId: 43,
                expect: 'you get some wool',
                at: { x: 2653, z: 3367, tolerance: 2 },
            },
            {
                name: 'shear2',
                maxFails: 15,
                onFail: 'continue',
                when: v => v.inv('Shears') > 0 && v.inv('Wool') < 18 && v.level('Crafting') < 10,
            },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 2641, z: 3171 }, buy: [{ item: 'Shears', count: 1 }] },
            { name: 'buy-shears', when: v => v.inv('Shears') === 0 && v.inv('Wool') < 18 && v.level('Crafting') < 10 },
        ),
        phase(
            pick,
            { loc: 'Flax', item: 'Flax', area: { x: 2478, z: 3402, radius: 20 } },
            { when: v => v.level('Crafting') >= 10 },
        ),
    ],
});
