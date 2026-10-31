// Sea Slug (server scripts: quests/quest_seaslug/scripts/quest_seaslug.rs2, areas/area_ardougne_east/scripts/{caroline,holgart_ardougne}.rs2,
// areas/area_fishing_platform/scripts/{bailey,kennith,kent,holgart_platform,holgart_island}.rs2; varp seaslugquest 0..11 -> complete).
// Route: Caroline (2716,3302) starts; Holgart (2720,3306) wants swamp paste (the start save holds one), then boats to the platform
// (2782,3273); Kennith (Crates, Shout-across) -> Holgart on the platform sails to Kent's island (2800,3320); Kent; Holgart on the
// island back to the platform; Bailey gives a Torch; broken glass (2765,3278) + damp sticks (2784,3289) = dry sticks, rubbed
// (Firemaking 30, random) to light the torch; the ladder (2784,3286) needs the lit torch; Kennith, kick the Loose panel, Kennith,
// rotate the Crane, Holgart home, Caroline.
// Start save: lib:sea-slug-start.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'seaslug';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const ard = (v: PlanView) => px(v) < 2745;
const island = (v: PlanView) => pz(v) >= 3310;
const plat = (v: PlanView) => px(v) >= 2745 && px(v) < 2795 && pz(v) < 3305;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const idCount = (v: PlanView, id: number) =>
    v.state.inventory.filter(i => i.id === id).reduce((a, i) => a + i.count, 0);
const litTorch = (v: PlanView) => idCount(v, 594);
const unlitTorch = (v: PlanView) => idCount(v, 596);
const ran = (v: PlanView, name: string) => v.runs(name) > 0;

const shout = (name: string, when: (v: PlanView) => boolean) =>
    phase(
        interact,
        {
            target: 'loc',
            name: '^Crates$',
            option: '^Shout-across$',
            at: { x: 2764, z: 3286, level: 1, tolerance: 1 },
        },
        { name, when, maxFails: 4 },
    );

export default definePlan({
    name: 'sea-slug',
    description:
        'Sea Slug: Caroline, Holgart boat with swamp paste, Kennith, Kent on the island, Bailey torch, glass and sticks lit, ladder, panel, crane, home.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        phase(
            talk,
            { npc: '^Caroline$', at: { x: 2716, z: 3300, tolerance: 2 } },
            { name: 'caroline-end', when: v => ard(v) && ran(v, 'home'), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Holgart$', at: { x: 2782, z: 3277, level: 0, tolerance: 2 }, travels: true },
            { name: 'home', when: v => plat(v) && ran(v, 'crane') && !ran(v, 'home'), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Crane$', option: '^Rotate$', at: { x: 2769, z: 3290, tolerance: 1 } },
            { name: 'crane', when: v => plat(v) && ran(v, 'kennith3') && !ran(v, 'crane'), maxFails: 4 },
        ),
        shout('kennith3', v => plat(v) && ran(v, 'panel') && !ran(v, 'kennith3')),
        phase(
            interact,
            { target: 'loc', name: '^Loose panel$', option: '^Kick$', at: { x: 2765, z: 3287, tolerance: 1 } },
            { name: 'panel', when: v => plat(v) && ran(v, 'kennith2') && !ran(v, 'panel'), maxFails: 4 },
        ),
        shout('kennith2', v => plat(v) && ran(v, 'ladder') && !ran(v, 'kennith2')),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2784, z: 3285, tolerance: 1 } },
            { name: 'ladder', when: v => plat(v) && litTorch(v) > 0 && !ran(v, 'ladder'), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Dry sticks$',
                option: '^Rub-together$',
                expect: 'torch lights|smoke momentarily|die out',
            },
            {
                name: 'rub',
                when: v => plat(v) && v.inv('Dry sticks') > 0 && unlitTorch(v) > 0 && litTorch(v) === 0,
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        phase(
            items,
            { combine: { use: '^Broken glass$', on: '^Damp sticks$', product: '^Dry sticks$' } },
            { name: 'dry', when: v => v.inv('Broken glass') > 0 && v.inv('Damp sticks') > 0, maxFails: 3 },
        ),
        phase(
            pickup,
            { area: { x: 2784, z: 3289, radius: 3 }, items: [{ item: 'Damp sticks', count: 1 }], maxWaitSeconds: 20 },
            {
                name: 'sticks',
                when: v =>
                    plat(v) &&
                    ran(v, 'bailey') &&
                    v.inv('Damp sticks') === 0 &&
                    v.inv('Dry sticks') === 0 &&
                    litTorch(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2765, z: 3278, radius: 3 }, items: [{ item: 'Broken glass', count: 1 }], maxWaitSeconds: 20 },
            {
                name: 'glass',
                when: v =>
                    plat(v) &&
                    ran(v, 'bailey') &&
                    v.inv('Broken glass') === 0 &&
                    v.inv('Dry sticks') === 0 &&
                    litTorch(v) === 0 &&
                    !ran(v, 'ladder'),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Bailey$', at: { x: 2763, z: 3277, tolerance: 3 } },
            { name: 'bailey', when: v => plat(v) && ran(v, 'back') && !ran(v, 'bailey'), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Holgart$', at: { x: 2799, z: 3319, tolerance: 2 }, travels: true },
            { name: 'back', when: v => island(v) && ran(v, 'kent') && !ran(v, 'back'), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Kent$', at: { x: 2793, z: 3320, tolerance: 2 } },
            { name: 'kent', when: v => island(v) && !ran(v, 'kent'), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Holgart$', at: { x: 2782, z: 3277, level: 0, tolerance: 2 }, travels: true },
            { name: 'sail', when: v => plat(v) && ran(v, 'kennith1') && !ran(v, 'sail'), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2784, z: 3285, tolerance: 1 } },
            {
                name: 'up1',
                when: v => plat(v) && lvl(v) === 0 && ran(v, 'holgart2') && !ran(v, 'kennith1'),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: '^Open$', at: { x: 2765, z: 3284, level: 1, tolerance: 1 } },
            {
                name: 'door',
                when: v => plat(v) && lvl(v) === 1 && ran(v, 'up1') && !ran(v, 'door') && !ran(v, 'kennith1'),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        shout('kennith1', v => plat(v) && ran(v, 'holgart2') && !ran(v, 'kennith1')),
        phase(
            talk,
            {
                npc: '^Holgart$',
                at: { x: 2720, z: 3305, tolerance: 2 },
                choices: ['lets do it'],
                travels: true,
            },
            {
                name: 'holgart2',
                when: v => ard(v) && ran(v, 'holgart1') && !ran(v, 'holgart2') && v.inv('Swamp paste') > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Holgart$', at: { x: 2720, z: 3305, tolerance: 2 } },
            { name: 'holgart1', when: v => ard(v) && ran(v, 'caroline') && !ran(v, 'holgart1'), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Caroline$', at: { x: 2716, z: 3300, tolerance: 2 }, choices: ['I suppose so'] },
            { name: 'caroline', when: v => ard(v) && !ran(v, 'caroline'), maxFails: 3 },
        ),
    ],
});
