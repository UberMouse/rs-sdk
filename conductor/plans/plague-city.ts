// Plague City (server/content/scripts/quests/quest_elena, id elena, varp elenaquest 0-30), start to done.
// The quest tab shows only none/started/done, so the stages ride on held items, position and the dialog history:
//   0 -> 1 Edmond (East Ardougne, 2568,3334); 1 Dwellberries (ground, McGrubor's Wood) to Alrena -> 2 Gas mask;
//   2 -> 3 Edmond; 3..7 four Buckets of water poured on the Mud patch (2566,3331); spade on it -> 8 and a fall into the
//   sewers (2561,9738); 8 -> 9 Rope on the Sewer pipe grill (2530,9701); 9 -> 10 Edmond (he stands in the sewer) pulls it;
//   10 Search the pipe (Gas mask worn) -> West Ardougne (2529,3304); 20 Jethick (2540,3305) shown the Picture (ground, Edmond's
//   house) gives a Book; 21 the book to Ted (door 2531,3328); 22 Ted; 23 Milli upstairs; 24 the plague house door
//   (2533,3272) "check anyway"; 25 the Clerk (urgent); 26 Bravek (note); the Hangover cure (Bucket of milk + Chocolate dust,
//   then Snape grass) to Bravek -> 27 Warrant; door, A small key from the Barrel (2534,3268), stairs down, door (2539,9672),
//   Elena -> 28; up, manhole, the sewer, Mud pile (2561,9738) to the garden, Edmond -> 30.
// Start save: lib:plague-city-start (Ardougne market, rope, 4 buckets, milk, chocolate dust, snape grass in the pack).
// Restart-safe: gates read held items, the position and the dialog and message history, never run counts.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import fill from '@conductor/tasks/fill';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'elena';
const n = (v: PlanView, name: string) => v.inv(name);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const level = (v: PlanView) => v.state.player?.level ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);
const surface = (v: PlanView) => pz(v) < 6000;
const east = (v: PlanView) => surface(v) && px(v) >= 2557;
const west = (v: PlanView) => surface(v) && px(v) < 2557;
const sewer = (v: PlanView) => pz(v) >= 9695;
const basement = (v: PlanView) => pz(v) > 9600 && pz(v) < 9695;
const insideHouse = (v: PlanView) => west(v) && px(v) >= 2531 && px(v) <= 2541 && pz(v) >= 3262 && pz(v) <= 3271;
const nearBerries = (v: PlanView) => surface(v) && px(v) >= 2655 && px(v) <= 2680 && pz(v) >= 3470 && pz(v) <= 3510;
const inWood = (v: PlanView) => surface(v) && px(v) >= 2620 && px(v) <= 2700 && pz(v) >= 3440 && pz(v) <= 3515;
const wearing = (v: PlanView) => n(v, 'Gas mask') === 0;

// stage markers
const hasMask = (v: PlanView) => n(v, 'Gas mask') > 0 || v.state.equipment.some(i => /^gas mask$/i.test(i.name));
const softenTalk = (v: PlanView) => heard(v, /now for the digging/i);
const softened = (v: PlanView) => heard(v, /soft enough (to dig|already)/i);
const filled = (v: PlanView) => heard(v, /fill the bucket from the/i);
const ropeTied = (v: PlanView) => heard(v, /tie the end of the rope/i);
const pipeOpen = (v: PlanView) => heard(v, /done the job/i);
const shown = (v: PlanView) => heard(v, /timbered building|far north side/i);
const bookReturned = (v: PlanView) => heard(v, /missing that/i);
const tedTalked = (v: PlanView) => heard(v, /slightly over a week ago/i);
const milliTalked = (v: PlanView) => heard(v, /mossy windowless/i);
const houseAsked = (v: PlanView) => heard(v, /hopes up/i);
const clerkAsked = (v: PlanView) => heard(v, /keep it short|suppose they can come in/i);
const freed = (v: PlanView) => heard(v, /go and see my father/i);

const LOBBY = [
    { x: 2529, z: 3315 },
    { x: 2529, z: 3313 },
    { x: 2529, z: 3317 },
    { x: 2529, z: 3314 },
    { x: 2529, z: 3316 },
];
const EDMOND = { npc: '^Edmond$', at: { x: 2568, z: 3334, tolerance: 2 } };
const ALRENA = { npc: '^Alrena$', at: { x: 2573, z: 3333, tolerance: 2 } };
const BRAVEK = { npc: '^Bravek$', at: { x: 2536, z: 3314, tolerance: 2 } };
const PATCH = { x: 2566, z: 3331 };

export default definePlan({
    name: 'plague-city',
    description:
        'Plague City: Edmond, dwellberries, Alrena (gas mask), buckets and spade on the mud patch, rope on the grill, the pipe to West Ardougne, Jethick, Rehnisons, the Clerk, Bravek (hangover cure), the plague house, Elena, Edmond.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // --- the finish: Elena freed, back through the manhole and the sewer to the garden ---
        phase(talk, { ...EDMOND }, { name: 'finish', when: v => !done(v) && freed(v) && east(v), maxFails: 3 }),
        phase(
            interact,
            { target: 'loc', name: '^Mud pile$', option: '^Climb$', at: { x: 2561, z: 9738, tolerance: 2 } },
            { name: 'mud-pile', until: v => east(v), when: v => !done(v) && freed(v) && sewer(v), maxFails: 3 },
        ),
        // Two phases (not one repeated): a phase that ends done at once in its start state, twice in a row, ends the plan.
        // The manhole is open after the pipe's climb out and closes again later; a missing option fails that phase.
        phase(
            interact,
            { target: 'loc', name: '^Manhole$', option: '^Open$', at: { x: 2529, z: 3302, tolerance: 2 } },
            {
                name: 'manhole-open',
                when: v => !done(v) && freed(v) && west(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Manhole$', option: '^Climb-down$', at: { x: 2529, z: 3302, tolerance: 2 } },
            {
                name: 'manhole-down',
                until: v => sewer(v),
                when: v => !done(v) && freed(v) && west(v),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Spooky stairs$', option: '^Walk-Up$', at: { x: 2537, z: 9671, tolerance: 1 } },
            { name: 'stairs-up', when: v => !done(v) && freed(v) && basement(v), maxFails: 3 },
        ),
        // --- Elena in the basement cell ---
        // The cell door (2539,9672) opens with the key but closes behind the first try: two phases, so the plan's idle
        // rail does not end it on a repeat; the walk alone gets stuck at the door.
        ...['a', 'b'].map(k =>
            phase(
                interact,
                {
                    target: 'loc',
                    name: '^Door$',
                    option: '^Open$',
                    tile: { x: 2539, z: 9672 },
                    at: { x: 2539, z: 9672, tolerance: 1 },
                },
                {
                    name: `cell-door-${k}`,
                    when: v =>
                        started(v) &&
                        !freed(v) &&
                        basement(v) &&
                        n(v, 'A small key') > 0 &&
                        px(v) <= 2539 &&
                        (k === 'a') === (v.last?.phase !== 'cell-door-a'),
                    onFail: 'continue',
                    maxFails: 6,
                },
            ),
        ),
        phase(
            talk,
            { npc: '^Elena$', at: { x: 2541, z: 9672, tolerance: 1 } },
            {
                name: 'elena',
                when: v => started(v) && !freed(v) && basement(v) && n(v, 'A small key') > 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Spooky stairs$', option: '^Walk-Down$', at: { x: 2536, z: 3267, tolerance: 1 } },
            {
                name: 'stairs-down',
                when: v => started(v) && !freed(v) && n(v, 'A small key') > 0 && west(v),
                maxFails: 3,
            },
        ),
        // --- the warrant: the plague house door, the barrel key ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Barrel$',
                option: '^Search$',
                at: { x: 2535, z: 3268, tolerance: 1 },
                expect: 'small key',
            },
            {
                name: 'barrel',
                when: v => started(v) && n(v, 'Warrant') > 0 && n(v, 'A small key') === 0 && insideHouse(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2533, z: 3272 },
                at: { x: 2533, z: 3274, tolerance: 1 },
            },
            {
                name: 'enter-house',
                when: v => started(v) && n(v, 'Warrant') > 0 && n(v, 'A small key') === 0 && west(v) && !insideHouse(v),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { ...BRAVEK, choices: ["won't listen"] },
            { name: 'bravek-cure', when: v => started(v) && n(v, 'Hangover cure') > 0 && west(v), maxFails: 3 },
        ),
        phase(
            items,
            { combine: { use: '^Snape grass$', on: '^Chocolaty milk$', product: '^Hangover cure$' } },
            { name: 'cure-grass', when: v => started(v) && n(v, 'Chocolaty milk') > 0 && n(v, 'Snape grass') > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Chocolate dust$', on: '^Bucket of milk$', product: '^Chocolaty milk$' } },
            {
                name: 'cure-milk',
                when: v =>
                    started(v) &&
                    n(v, 'A scruffy note') > 0 &&
                    n(v, 'Chocolate dust') > 0 &&
                    n(v, 'Bucket of milk') > 0,
            },
        ),
        phase(
            talk,
            { ...BRAVEK, choices: ['really important', 'what is in the cure'] },
            {
                name: 'bravek-note',
                when: v =>
                    started(v) &&
                    clerkAsked(v) &&
                    n(v, 'A scruffy note') === 0 &&
                    n(v, 'Hangover cure') === 0 &&
                    n(v, 'Warrant') === 0 &&
                    west(v),
                maxFails: 3,
            },
        ),
        // Bravek answers the Clerk only within 7 tiles of the player and wanders about (2536-2540,3312-3316), behind a wall
        // the lobby side (x <= 2529) cannot pass: after each try the bot stands on another lobby tile (chosen by the tick),
        // which also keeps the idle rail from ending the plan on repeated tries.
        ...LOBBY.map((t, i) =>
            phase(
                travel,
                { to: t, tolerance: 1 },
                {
                    name: `clerk-pos-${i}`,
                    when: v =>
                        started(v) &&
                        houseAsked(v) &&
                        !clerkAsked(v) &&
                        west(v) &&
                        (v.last?.phase === 'clerk' || Math.abs(px(v) - 2529) > 3 || Math.abs(pz(v) - 3315) > 6) &&
                        Math.floor((v.state.tick ?? 0) / 3) % LOBBY.length === i &&
                        (Math.abs(px(v) - t.x) > 0 || Math.abs(pz(v) - t.z) > 0),
                    maxFails: 3,
                },
            ),
        ),
        phase(
            talk,
            { npc: '^Clerk$', at: { x: 2529, z: 3315, tolerance: 3 }, choices: ['permission to enter', 'urgent'] },
            { name: 'clerk', when: v => started(v) && houseAsked(v) && !clerkAsked(v) && west(v), maxFails: 3 },
        ),
        // Milli is upstairs in the Rehnison house; the walk does not plan down from level 1.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stairs$',
                option: '^Walk-down$',
                at: { x: 2528, z: 3332, level: 1, tolerance: 1 },
            },
            { name: 'rehnison-down', when: v => started(v) && west(v) && level(v) === 1, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2533, z: 3272 },
                at: { x: 2533, z: 3274, tolerance: 1 },
                choices: ['kidnap victim', 'check anyway'],
            },
            { name: 'house-ask', when: v => started(v) && milliTalked(v) && !houseAsked(v) && west(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Milli Rehnison$', at: { x: 2531, z: 3330, level: 1, tolerance: 2 } },
            { name: 'milli', when: v => started(v) && tedTalked(v) && !milliTalked(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Ted Rehnison$', at: { x: 2531, z: 3331, tolerance: 2 } },
            { name: 'ted', when: v => started(v) && bookReturned(v) && !tedTalked(v) && west(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2531, z: 3328 },
                at: { x: 2531, z: 3326, tolerance: 1 },
                expect: 'missing that',
            },
            { name: 'rehnisons', when: v => started(v) && n(v, 'Book') > 0 && west(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Jethick$', at: { x: 2540, z: 3305, tolerance: 2 }, choices: ['looking for a woman'] },
            {
                name: 'jethick',
                when: v => started(v) && n(v, 'Picture') > 0 && n(v, 'Book') === 0 && !shown(v) && west(v),
                maxFails: 3,
            },
        ),
        // --- the pipe to West Ardougne (gas mask worn) ---
        phase(
            interact,
            { target: 'loc', name: '^Sewer pipe$', option: '^Search$', at: { x: 2530, z: 9704, tolerance: 2 } },
            {
                name: 'pipe',
                until: v => west(v),
                when: v => started(v) && sewer(v) && pipeOpen(v) && !freed(v) && wearing(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            talk,
            { npc: '^Edmond$', at: { x: 2535, z: 9719, tolerance: 2 } },
            { name: 'edmond-sewer', when: v => started(v) && sewer(v) && ropeTied(v) && !pipeOpen(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Sewer pipe$',
                use: { item: '^Rope$' },
                at: { x: 2530, z: 9704, tolerance: 2 },
                expect: 'tie the end of the rope',
            },
            { name: 'rope', when: v => started(v) && sewer(v) && n(v, 'Rope') > 0, maxFails: 3 },
        ),
        // --- the garden: buckets, then the spade ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mud patch$',
                use: { item: '^Spade$' },
                tile: PATCH,
                at: { x: 2566, z: 3330, tolerance: 1 },
                expect: 'sewer',
            },
            {
                name: 'dig',
                when: v =>
                    started(v) &&
                    east(v) &&
                    filled(v) &&
                    (n(v, 'Bucket of water') === 0 || softened(v)) &&
                    n(v, 'Spade') > 0 &&
                    !sewer(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Mud patch$',
                use: { item: '^Bucket of water$' },
                tile: PATCH,
                at: { x: 2566, z: 3330, tolerance: 1 },
            },
            {
                name: 'pour',
                when: v => started(v) && east(v) && filled(v) && n(v, 'Bucket of water') > 0 && !softened(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            fill,
            { container: 'Bucket', area: { x: 2629, z: 3311, radius: 5 } },
            {
                name: 'fill',
                when: v => started(v) && east(v) && softenTalk(v) && !filled(v) && n(v, 'Bucket') > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...EDMOND },
            {
                name: 'edmond-dig',
                when: v => started(v) && east(v) && hasMask(v) && !softenTalk(v) && !filled(v),
                maxFails: 3,
            },
        ),
        phase(items, { equip: ['Gas mask'] }, { name: 'wear-mask', when: v => started(v) && n(v, 'Gas mask') > 0 }),
        // The berries lie inside the wood (the Loose Railing is the only way): the walk out squeezes back through it.
        phase(
            travel,
            { to: { x: 2650, z: 3310 }, tolerance: 4, waypoints: [{ x: 2725, z: 3485 }] },
            {
                name: 'leave-wood',
                when: v => started(v) && n(v, 'Dwellberries') > 0 && !hasMask(v) && inWood(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...ALRENA },
            {
                name: 'alrena',
                when: v => started(v) && east(v) && !inWood(v) && n(v, 'Dwellberries') > 0 && !hasMask(v),
                maxFails: 3,
            },
        ),
        // The Forester gate (2650,3469) is locked and its dialog traps the walk: reach the berry (2667,3494) from the east
        // (the walk squeezes through the Loose Railing at 2662,3500).
        phase(
            travel,
            {
                to: { x: 2668, z: 3492 },
                tolerance: 2,
                waypoints: [
                    { x: 2650, z: 3300 },
                    { x: 2725, z: 3485 },
                ],
            },
            {
                name: 'to-berries',
                when: v => started(v) && east(v) && n(v, 'Dwellberries') === 0 && !hasMask(v) && !nearBerries(v),
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            {
                area: { x: 2666, z: 3488, radius: 9 },
                items: [{ item: 'Dwellberries', count: 1 }],
                maxWaitSeconds: 120,
            },
            {
                name: 'berries',
                when: v => started(v) && (east(v) || inWood(v)) && n(v, 'Dwellberries') === 0 && !hasMask(v),
                maxFails: 3,
            },
        ),
        // --- the start: spade and picture from Edmond's house, then Edmond ---
        phase(
            pickup,
            {
                area: { x: 2575, z: 3333, radius: 6 },
                items: [
                    { item: 'Spade', count: 1 },
                    { item: 'Picture', count: 1 },
                ],
            },
            {
                name: 'collect',
                when: v => !done(v) && east(v) && (n(v, 'Spade') === 0 || n(v, 'Picture') === 0),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...EDMOND, choices: ["What's happened", 'Can I help find her'] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
    until: done,
});
