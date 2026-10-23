// Digsite Quest (server/content/scripts/quests/quest_itexam/*.rs2, id itexam; the quest tab shows only red/yellow/green,
// so every stage is read from held items, the floor and the position).
//   Shop: tinderbox + chisel (Falador general store), vial + pestle and mortar (Jatix, Taverley), cup of tea (Varrock).
//   Examiner (start, Unstamped letter) -> Curator in the Varrock museum (Stamped letter) -> Examiner (exam 1 starts
//   and is failed on purpose: no errands yet).
//   Exam 1: the three Students (identical names, told apart by where they stand) each want a rock sample: 1 from a
//   Digsite workman's pocket (Steal-from), 3 from a bush, 2 from the panning points (tea for the Panning guide, a
//   panning tray from the ground); the samples are handed in only when all three are held.
//   Exams 2 and 3: talk to the three Students (their tips), the third exam also wants an Opal for Student 2 (panned
//   uncut opal cut with the chisel); the answers are in the exam choices below.
//   Then dig at a level 3 site (trowel, specimen jar, specimen brush) for the Talisman of Zaros -> Terry (Invitation
//   letter) -> a workman (permit; the Book on chemicals is taken first and marks "permit given").
//   Cave: rope on the winch, Arcenia root (ground), chest key from the cave workman; chest -> powder, barrel + vial ->
//   liquid, Terry names them; mix with ground charcoal and the root; compound on the Brick, tinderbox from the exact
//   tile (3379,9826) -> blast; Stone tablet (ground, skeleton cave) -> Terry.
// Restart-safe: phases come from held items, the quest tab, the floor and the position.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'itexam';
// obj ids of items that share a name
const TRAY_EMPTY = 677;
const TRAY_MUD = 679;
const MIX_PRE = 705;
const MIX_POST = 706;

const n = (v: PlanView, name: string) => v.inv(name);
const hasId = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const surface = (v: PlanView) => pz(v) < 6000 && (v.state.player?.level ?? 0) === 0;
const near = (v: PlanView, x: number, z: number, r: number) =>
    surface(v) && Math.max(Math.abs(px(v) - x), Math.abs(pz(v) - z)) <= r;
const inCave153 = (v: PlanView) => pz(v) >= 9790 && pz(v) <= 9860 && px(v) >= 3330;
const inCave152 = (v: PlanView) => pz(v) >= 9725 && pz(v) < 9790 && px(v) >= 3330;

// Where the three Student kinds stand (spawn tiles; each wanders 2): a spot with only that kind near it.
const S1 = { x: 3363, z: 3397 };
const S3 = { x: 3349, z: 3410 };
const S2 = { x: 3348, z: 3424 };
const nearS1 = (v: PlanView) => near(v, S1.x, S1.z, 5);
const nearS3 = (v: PlanView) => near(v, S3.x, S3.z, 5);
const nearS2 = (v: PlanView) => near(v, S2.x, S2.z, 5);
const nearAnyStudent = (v: PlanView) => nearS1(v) || nearS3(v) || nearS2(v);
const spot = (s: { x: number; z: number }) => ({ x: s.x, z: s.z, level: 0, tolerance: 1 });
const EXAMINER = { npc: 'Examiner', at: { x: 3361, z: 3343, level: 0, tolerance: 3 } };
const TERRY = { npc: 'Archaeological expert', at: { x: 3355, z: 3334, level: 0, tolerance: 3 } };

// stage by items
const started = (v: PlanView) => v.quest(ID) === 'started';
const cert1 = (v: PlanView) => n(v, 'Level 1 certificate') > 0;
const cert2 = (v: PlanView) => n(v, 'Level 2 certificate') > 0;
const cert3 = (v: PlanView) => n(v, 'Level 3 certificate') > 0;
const letters = (v: PlanView) => n(v, 'Unstamped letter') + n(v, 'Stamped letter');
const samples = (v: PlanView) => n(v, 'Rock sample 1') + n(v, 'Rock sample 2') + n(v, 'Rock sample 3');
const stage2 = (v: PlanView) => started(v) && letters(v) === 0 && !cert1(v) && !(nearS2(v) && samples(v) === 0);
const opalReady = (v: PlanView) => n(v, 'Opal') + n(v, 'Uncut opal') > 0;
const permit = (v: PlanView) => n(v, 'Book on chemicals') > 0 && n(v, 'Invitation letter') === 0;
const root = (v: PlanView) => n(v, 'Arcenia root');
const compound = (v: PlanView) => n(v, 'Chemical compound');
const pre = (v: PlanView) => (hasId(v, MIX_PRE) ? 1 : 0);
const post = (v: PlanView) => (hasId(v, MIX_POST) ? 1 : 0);
// the powder side of the chain (the liquid side is made at the barrel before the first cave visit)
const powderChain = (v: PlanView) =>
    n(v, 'Chemical powder') + n(v, 'Ammonium nitrate') + pre(v) + post(v) + compound(v);
// Visit 1 (private winch at (3370,3428), lands in the west part: workman, key, root) and visit 2 (winch at
// (3352,3417), lands in the east part: the bricks); the two parts of the cave are not connected before the blast.
const WINCH1 = { x: 3352, z: 3417 };
const WINCH2 = { x: 3370, z: 3428 };
const wantDown1 = (v: PlanView) =>
    permit(v) && surface(v) && compound(v) === 0 && root(v) === 0 && n(v, 'Chest key') === 0 && powderChain(v) === 0;
const wantDown2 = (v: PlanView) => permit(v) && surface(v) && compound(v) > 0;
const nearW = (v: PlanView, w: { x: number; z: number }) => near(v, w.x, w.z, 2);
const west = (v: PlanView) => inCave153(v) && px(v) < 3362;
const east = (v: PlanView) => inCave153(v) && px(v) >= 3362;
const trayMud = (v: PlanView) => hasId(v, TRAY_MUD);
const trayEmpty = (v: PlanView) => hasId(v, TRAY_EMPTY);

const BRICK = { x: 3379, z: 9826 };
const nearBrick = (v: PlanView) => inCave153(v) && Math.max(Math.abs(px(v) - BRICK.x), Math.abs(pz(v) - BRICK.z)) <= 2;

const JUNK = [
    'Buttons',
    'Belt buckle',
    'Broken armour',
    'Damaged armour',
    'Broken arrow',
    'Broken staff',
    'Old tooth',
    'Broken glass',
    'Bones',
    'Nuggets',
    'Uncut jade',
    'Spade',
    'Leather gloves',
    'Bucket',
    'Iron dagger',
    'Rock sample',
    'Crushed gemstone',
    'Black med helm',
    'Bronze spear',
    'Throwing knife',
    'Old boots',
    'Leather boots',
    'Needle',
    'Pie dish',
    'Clay',
    'Oyster',
    'Vase',
    'Rusty sword',
    'Copper ore',
    'Rotten apple',
    'Ceramic remains',
];

// A steal that fails changes nothing, and the plan's idle rail ends the plan on it: two phases that walk the bot
// between the west and east side of the dig site make every run move.
const stealPhases = (name: string, wanted: (v: PlanView) => boolean) =>
    [
        { suffix: 'east', x: 3357, z: 3415, side: (v: PlanView) => px(v) < 3352 },
        { suffix: 'west', x: 3347, z: 3411, side: (v: PlanView) => px(v) >= 3352 },
    ].map(a =>
        phase(
            interact,
            {
                target: 'npc',
                name: '^Digsite workman$',
                option: '^Steal-from$',
                at: { x: a.x, z: a.z, level: 0, tolerance: 1 },
            },
            {
                name: `${name}-${a.suffix}`,
                when: v => wanted(v) && a.side(v),
                onFail: 'continue',
                maxFails: 40,
            },
        ),
    );

export default definePlan({
    name: 'digsite',
    description:
        'Digsite Quest: shop, examiner + curator, three exams (student rock samples, tips, opal), talisman dig, mine shaft permit, chemicals and compound, blast the bricks, stone tablet to Terry.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),

        // ---- junk dropped when the pack runs low ----
        ...JUNK.map(name =>
            phase(
                items,
                { drop: [{ item: `^${name}$` }] },
                { name: `drop-${name.toLowerCase().replace(/ /g, '-')}`, when: v => n(v, name) > 0 && v.free < 5 },
            ),
        ),

        // stage 5 onward: the panning tray is spent, and the workman steals leave spare brushes
        phase(
            items,
            { drop: [{ item: '^Panning tray$' }] },
            { name: 'drop-tray', when: v => cert3(v) && n(v, 'Panning tray') > 0 && v.free < 5 },
        ),
        phase(
            items,
            { drop: [{ item: '^Specimen brush$', count: 1 }] },
            { name: 'drop-brush', when: v => n(v, 'Specimen brush') > 1 && v.free < 5 },
        ),

        // ---- the end: tablet ----
        phase(
            interact,
            { target: 'npc', name: '^Archaeological expert$', use: { item: '^Stone tablet$' }, at: TERRY.at },
            { name: 'tablet-hand', when: v => n(v, 'Stone tablet') > 0 && surface(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Rope$', option: '^Climb-up$', at: { x: 3370, z: 9763, level: 0, tolerance: 1 } },
            { name: 'ladder-out', when: v => n(v, 'Stone tablet') > 0 && inCave152(v) },
        ),
        phase(
            pickup,
            { area: { x: 3374, z: 9747, radius: 4 }, items: [{ item: 'Stone tablet', count: 1 }] },
            { name: 'tablet', when: v => inCave152(v) && n(v, 'Stone tablet') === 0 },
        ),

        // ---- the cave before the blast ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Brick$',
                tile: { x: 3379, z: 9825 },
                use: { item: '^Tinderbox$' },
                at: { x: BRICK.x, z: BRICK.z, level: 0, tolerance: 1 },
                expect: 'explosion|noise|bones',
            },
            {
                name: 'ignite',
                when: v => nearBrick(v) && compound(v) === 0 && n(v, 'Tinderbox') > 0,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Brick$',
                tile: { x: 3379, z: 9825 },
                use: { item: '^Chemical compound$' },
                at: { x: BRICK.x, z: BRICK.z, level: 0, tolerance: 1 },
            },
            { name: 'pour', when: v => inCave153(v) && compound(v) > 0 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Rope$', option: '^Climb-up$', at: { x: 3353, z: 9817, level: 0, tolerance: 1 } },
            { name: 'ladder-up-west', when: v => west(v) && root(v) > 0 && n(v, 'Chest key') > 0 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Rope$', option: '^Climb-up$', at: { x: 3370, z: 9827, level: 0, tolerance: 1 } },
            { name: 'ladder-up-east', when: v => east(v) && compound(v) === 0 && !nearBrick(v) },
        ),
        phase(
            talk,
            {
                npc: 'Digsite workman',
                at: { x: 3352, z: 9821, level: 0, tolerance: 2 },
                choices: [
                    'invited to research',
                    'chest key',
                    'suppose I could use',
                    '^Please\\?',
                    'go on',
                    '^Pretty please!$',
                    'sugar on top',
                ],
            },
            {
                name: 'workman-key',
                when: v => west(v) && root(v) > 0 && n(v, 'Chest key') === 0 && powderChain(v) === 0,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            pickup,
            { area: { x: 3351, z: 9822, radius: 5 }, items: [{ item: 'Arcenia root', count: 1 }] },
            { name: 'root', when: v => west(v) && root(v) === 0 && post(v) === 0 && compound(v) === 0 },
        ),

        // ---- surface chemistry (permit given) ----
        phase(
            items,
            { combine: { use: '^Arcenia root$', on: { name: '^Mixed chemicals$', id: MIX_POST } } },
            { name: 'mix-compound', when: v => root(v) > 0 && post(v) > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Ground charcoal$', on: { name: '^Mixed chemicals$', id: MIX_PRE } } },
            { name: 'mix-charcoal', when: v => n(v, 'Ground charcoal') > 0 && pre(v) > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Nitroglycerin$', on: '^Ammonium nitrate$' } },
            { name: 'mix-nitro', when: v => n(v, 'Nitroglycerin') > 0 && n(v, 'Ammonium nitrate') > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Pestle and mortar$', on: '^Charcoal$' } },
            { name: 'grind', when: v => n(v, 'Charcoal') > 0 && n(v, 'Pestle and mortar') > 0 },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Archaeological expert$', use: { item: '^Chemical powder$' }, at: TERRY.at },
            { name: 'terry-powder', when: v => n(v, 'Chemical powder') > 0 && surface(v) },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Archaeological expert$', use: { item: '^Unidentified liquid$' }, at: TERRY.at },
            { name: 'terry-liquid', when: v => n(v, 'Unidentified liquid') > 0 && surface(v) },
        ),
        phase(
            talk,
            {
                use: { items: ['^Trowel$', '^Vial$'], onLoc: '^Barrel$' },
                at: { x: 3364, z: 3377, level: 0, tolerance: 2 },
            },
            { name: 'barrel', when: v => permit(v) && surface(v) && n(v, 'Vial') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                use: { item: '^Chest key$' },
                at: { x: 3374, z: 3378, level: 0, tolerance: 2 },
            },
            { name: 'chest-open', when: v => permit(v) && surface(v) && n(v, 'Chest key') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                option: '^Search$',
                at: { x: 3374, z: 3378, level: 0, tolerance: 2 },
            },
            {
                name: 'chest-search',
                when: v => permit(v) && surface(v) && root(v) > 0 && n(v, 'Chest key') === 0 && powderChain(v) === 0,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Specimen tray$',
                option: '^Search$',
                expect: '^\\s*You find',
                at: { x: 3367, z: 3386, level: 0, tolerance: 2 },
            },
            {
                name: 'charcoal',
                when: v =>
                    permit(v) &&
                    surface(v) &&
                    n(v, 'Specimen jar') > 0 &&
                    n(v, 'Charcoal') + n(v, 'Ground charcoal') + post(v) + compound(v) === 0,
            },
        ),
        ...stealPhases(
            'steal-tools',
            v =>
                cert3(v) &&
                surface(v) &&
                v.free >= 4 &&
                (n(v, 'Specimen brush') === 0 ||
                    (n(v, 'Rope') < 2 && n(v, 'Book on chemicals') === 0) ||
                    (wantDown1(v) && n(v, 'Rope') === 0)),
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch$',
                use: { item: '^Rope$' },
                tile: WINCH2,
                at: { x: WINCH2.x, z: WINCH2.z, level: 0, tolerance: 2 },
            },
            { name: 'tie-1', when: v => wantDown1(v) && n(v, 'Rope') === 2 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch$',
                option: '^Operate$',
                tile: WINCH2,
                at: { x: WINCH2.x, z: WINCH2.z, level: 0, tolerance: 2 },
            },
            { name: 'descend-1', when: v => wantDown1(v) && n(v, 'Rope') === 1 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch$',
                use: { item: '^Rope$' },
                tile: WINCH1,
                at: { x: WINCH1.x, z: WINCH1.z, level: 0, tolerance: 2 },
            },
            { name: 'tie-2', when: v => wantDown2(v) && n(v, 'Rope') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Winch$',
                option: '^Operate$',
                tile: WINCH1,
                at: { x: WINCH1.x, z: WINCH1.z, level: 0, tolerance: 2 },
            },
            { name: 'descend-2', when: v => wantDown2(v) && nearW(v, WINCH1) && n(v, 'Rope') === 0 },
        ),

        // ---- permit: Terry's letter, the marker book, the workman ----
        phase(
            interact,
            {
                target: 'npc',
                name: '^Digsite workman$',
                use: { item: '^Invitation letter$' },
                at: { x: 3354, z: 3408, level: 0, tolerance: 3 },
            },
            { name: 'workman-letter', when: v => n(v, 'Invitation letter') > 0 && n(v, 'Book on chemicals') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Bookcase$',
                option: '^Search$',
                tile: { x: 3366, z: 3334 },
                at: { x: 3366, z: 3335, level: 0, tolerance: 1 },
            },
            { name: 'book', when: v => n(v, 'Invitation letter') > 0 && n(v, 'Book on chemicals') === 0 },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Archaeological expert$', use: { item: '^Talisman of zaros$' }, at: TERRY.at },
            { name: 'terry-talisman', when: v => n(v, 'Talisman of zaros') > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Soil$',
                use: { item: '^Trowel$' },
                at: { x: 3353, z: 3408, level: 0, tolerance: 2 },
                expect: 'find|clean',
            },
            {
                name: 'dig',
                when: v =>
                    surface(v) &&
                    cert3(v) &&
                    n(v, 'Book on chemicals') === 0 &&
                    n(v, 'Invitation letter') === 0 &&
                    n(v, 'Talisman of zaros') === 0 &&
                    n(v, 'Specimen jar') > 0 &&
                    n(v, 'Specimen brush') > 0 &&
                    n(v, 'Trowel') > 0 &&
                    v.free >= 3,
                onFail: 'continue',
                maxFails: 30,
            },
        ),

        // ---- exam 3 ----
        phase(
            talk,
            {
                ...EXAMINER,
                choices: ['ready for the last exam', 'specimen jars', 'short strokes', 'keep them away'],
            },
            { name: 'exam3', when: v => cert2(v) && !cert3(v) && nearS2(v) && n(v, 'Opal') === 0 },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S2) },
            { name: 'student2-opal', when: v => cert2(v) && !cert3(v) && nearS2(v) && n(v, 'Opal') > 0 },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S2) },
            { name: 'student2-ask', when: v => cert2(v) && !cert3(v) && nearS3(v) && n(v, 'Opal') > 0 },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S3) },
            { name: 'student3-tip3', when: v => cert2(v) && !cert3(v) && nearS1(v) && n(v, 'Opal') > 0 },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S1) },
            { name: 'student1-tip3', when: v => cert2(v) && !cert3(v) && !nearAnyStudent(v) && n(v, 'Opal') > 0 },
        ),

        // ---- exam 2 ----
        phase(
            talk,
            {
                ...EXAMINER,
                choices: ['ready for the next exam', 'rough form', 'carefully handled', 'cleaving point'],
            },
            { name: 'exam2', when: v => cert1(v) && !cert2(v) && nearS2(v) },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S2) },
            { name: 'student2-tip2', when: v => cert1(v) && !cert2(v) && nearS3(v) },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S3) },
            { name: 'student3-tip2', when: v => cert1(v) && !cert2(v) && nearS1(v) },
        ),
        phase(
            talk,
            { npc: 'Student', at: spot(S1) },
            { name: 'student1-tip2', when: v => cert1(v) && !cert2(v) && !nearAnyStudent(v) },
        ),

        // ---- opal (any stage after the quest starts, while none is held) ----
        phase(
            items,
            { combine: { use: '^Chisel$', on: '^Uncut opal$' } },
            {
                name: 'cut-opal',
                when: v => n(v, 'Uncut opal') > 0 && n(v, 'Opal') === 0 && n(v, 'Chisel') > 0,
                // a low Crafting level smashes some opals ("Nothing interesting happens", a Crushed gemstone): pan another
                onFail: 'continue',
                maxFails: 15,
            },
        ),

        // ---- exam 1 ----
        phase(
            talk,
            {
                ...EXAMINER,
                choices: [
                    'certainly',
                    'study of the earth',
                    'All that have passed the appropriate',
                    'Gloves and boots',
                ],
            },
            {
                name: 'exam1',
                when: v => started(v) && !cert1(v) && letters(v) === 0 && nearS2(v) && samples(v) === 0,
            },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Student$', use: { item: '^Rock sample 3$' }, at: spot(S2) },
            { name: 'deliver-2', when: v => stage2(v) && n(v, 'Rock sample 3') > 0 && samples(v) === 1 },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Student$', use: { item: '^Rock sample 2$' }, at: spot(S3) },
            {
                name: 'deliver-3',
                when: v => stage2(v) && n(v, 'Rock sample 3') > 0 && n(v, 'Rock sample 2') > 0 && samples(v) === 2,
            },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Student$', use: { item: '^Rock sample 1$' }, at: spot(S1) },
            { name: 'deliver-1', when: v => stage2(v) && samples(v) === 3 && opalReady(v) },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Panning tray$',
                option: '^Search$',
            },
            { name: 'pan-search', when: v => stage2(v) && trayMud(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Panning point$',
                option: '^Look$',
                expect: 'lift the full tray',
                at: { x: 3378, z: 3374, level: 0, tolerance: 2 },
            },
            {
                name: 'pan',
                when: v =>
                    stage2(v) &&
                    trayEmpty(v) &&
                    n(v, 'Cup of tea') === 0 &&
                    n(v, 'Rock sample 1') > 0 &&
                    n(v, 'Rock sample 3') > 0 &&
                    (n(v, 'Rock sample 2') === 0 || !opalReady(v)),
            },
        ),
        phase(
            pickup,
            { area: { x: 3369, z: 3379, radius: 4 }, items: [{ item: 'Panning tray', count: 1 }] },
            {
                name: 'tray',
                when: v =>
                    stage2(v) &&
                    n(v, 'Panning tray') === 0 &&
                    n(v, 'Cup of tea') === 0 &&
                    n(v, 'Rock sample 1') > 0 &&
                    n(v, 'Rock sample 3') > 0,
            },
        ),
        phase(
            talk,
            { npc: 'Panning guide', at: { x: 3376, z: 3377, level: 0, tolerance: 2 } },
            {
                name: 'guide-tea',
                when: v =>
                    stage2(v) && n(v, 'Cup of tea') > 0 && n(v, 'Rock sample 1') > 0 && n(v, 'Rock sample 3') > 0,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Bush$',
                option: '^Search$',
                tile: { x: 3357, z: 3372 },
                at: { x: 3357, z: 3373, level: 0, tolerance: 1 },
            },
            {
                name: 'bush',
                when: v =>
                    stage2(v) &&
                    n(v, 'Rock sample 1') > 0 &&
                    n(v, 'Rock sample 3') === 0 &&
                    n(v, 'Rock sample 2') === 0,
            },
        ),
        ...stealPhases('steal', v => stage2(v) && samples(v) === 0 && v.free >= 4),

        // ---- stage 5: the dig needs a jar and a brush; the winch needs a rope ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Sacks$',
                option: '^Search$',
                tile: { x: 3359, z: 3398 },
                at: { x: 3359, z: 3399, level: 0, tolerance: 1 },
            },
            { name: 'jar', when: v => cert3(v) && n(v, 'Specimen jar') === 0 && n(v, 'Stone tablet') === 0 },
        ),

        // ---- the start: the stamp, the letter, the shopping ----
        phase(
            talk,
            {
                ...EXAMINER,
                choices: ['.', '.', '.'],
            },
            { name: 'letter-in', when: v => started(v) && n(v, 'Stamped letter') > 0 },
        ),
        phase(
            talk,
            { npc: 'Curator', at: { x: 3255, z: 3445, level: 0, tolerance: 3 } },
            { name: 'curator', when: v => started(v) && n(v, 'Unstamped letter') > 0 },
        ),
        phase(
            talk,
            { ...EXAMINER, choices: ['take an exam'] },
            {
                name: 'start',
                when: v =>
                    v.quest(ID) === 'none' &&
                    n(v, 'Tinderbox') > 0 &&
                    n(v, 'Chisel') > 0 &&
                    n(v, 'Vial') > 0 &&
                    n(v, 'Pestle and mortar') > 0 &&
                    n(v, 'Cup of tea') > 0,
            },
        ),
        phase(
            travel,
            {
                to: { x: 3253, z: 3420, level: 0 },
                tolerance: 4,
                waypoints: [
                    { x: 3080, z: 3420 },
                    { x: 3185, z: 3436 },
                ],
            },
            {
                name: 'to-varrock',
                when: v =>
                    v.quest(ID) === 'none' &&
                    n(v, 'Cup of tea') === 0 &&
                    n(v, 'Vial') > 0 &&
                    n(v, 'Pestle and mortar') > 0 &&
                    px(v) < 3150,
            },
        ),
        phase(
            shop,
            { npc: 'Tea seller', at: { x: 3271, z: 3411 }, buy: [{ item: 'Cup of tea', count: 1 }] },
            {
                name: 'shop-tea',
                when: v =>
                    v.quest(ID) === 'none' &&
                    n(v, 'Cup of tea') === 0 &&
                    n(v, 'Tinderbox') > 0 &&
                    n(v, 'Chisel') > 0 &&
                    n(v, 'Vial') > 0 &&
                    n(v, 'Pestle and mortar') > 0,
            },
        ),
        phase(
            shop,
            {
                npc: 'Jatix',
                at: { x: 2899, z: 3427 },
                buy: [
                    { item: 'Vial', count: 1 },
                    { item: 'Pestle and mortar', count: 1 },
                ],
            },
            {
                name: 'shop-jatix',
                when: v =>
                    v.quest(ID) === 'none' &&
                    n(v, 'Tinderbox') > 0 &&
                    n(v, 'Chisel') > 0 &&
                    (n(v, 'Vial') === 0 || n(v, 'Pestle and mortar') === 0),
            },
        ),
        phase(
            shop,
            {
                npc: 'Shop keeper',
                at: { x: 2956, z: 3388 },
                buy: [
                    { item: 'Tinderbox', count: 1 },
                    { item: 'Chisel', count: 1 },
                ],
            },
            {
                name: 'shop-falador',
                when: v => v.quest(ID) === 'none' && (n(v, 'Tinderbox') === 0 || n(v, 'Chisel') === 0),
            },
        ),
    ],
    until: v => v.questDone(ID),
});
