// Biohazard (server/content/scripts/quests/quest_biohazard, id biohazard, varp 0-16, 16 = done), start to done.
// Needs Plague City done (Elena's house door). The quest tab shows only none/started/done, so the stages ride on held
// items, position and the dialog and message history:
//   0 -> 1 Elena (house 2592,3336); 1 -> 2 Jerico (2612,3324); his cupboard (2611,3326) gives Bird feed; a Pigeon cage
//   lies behind his house (2618,3324); Bird feed used on the Watchtower (2559-2563,3301-3306) -> 3; the cage opened
//   inside that zone -> 4; Omart (2559,3266) puts you over the wall on a rope ladder -> 5 (West Ardougne, 2556,3267).
//   Rotten apples on the ground (2535,3333) used on the HQ cauldron -> 6; Nurse Sarah's cupboard (2517,3276) gives a
//   Doctors' gown; worn, the HQ door lets you in; the sick Mourner upstairs is made to attack and drops a Key; the Key
//   opens the gate, the crate has the Distillator -> 7; Kilron (2556,3266) takes you back; Elena -> 10 (three vials,
//   a plague sample); the Chemist (Rimmington, 2934,3210) -> 12 and Touch paper; Chancy gets the honey, Hops the
//   broline, DeVinci the ethenea; they wait in Varrock (Dancing Donkey, ~3270,3390) and hand them back; priest gown and
//   robe worn, Guidor (3285,3381) -> 14; Elena -> 15; King Lathas (castle, 2578,3293 level 1) -> 16.
// Start save: lib:biohazard-start (Plague City done, East Ardougne market, a Priest gown and a Priest robe in the pack:
// the Fancy clothes store sells both under one name, which the shop task cannot tell apart).
// Restart-safe: gates read held items, the position and the dialog and message history, never run counts.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'biohazard';
const n = (v: PlanView, name: string) => v.inv(name);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const none = (v: PlanView) => v.quest(ID) === 'none';
const done = (v: PlanView) => v.questDone(ID);
const surface = (v: PlanView) => pz(v) < 6000;
const east = (v: PlanView) => surface(v) && px(v) >= 2557;
const west = (v: PlanView) => surface(v) && px(v) < 2557;

const spokeJerico = (v: PlanView) => heard(v, /Omart is waiting for you/i);
const hasFeed = (v: PlanView) => n(v, 'Bird feed') > 0;
const fed = (v: PlanView) => heard(v, /do not seem to notice|hand full of seeds/i);
const poisoned = (v: PlanView) => heard(v, /dissolves into the stew/i);
// The HQ dining room with the cauldron: its door is locked until the stew is poisoned; the fence (2541,3331) is climbed.
const inDining = (v: PlanView) => west(v) && px(v) >= 2542 && px(v) <= 2550 && pz(v) >= 3329 && pz(v) <= 3333;
const gownWorn = (v: PlanView) => v.state.equipment.some(i => /^Doctors' gown$/i.test(i.name));
const hasGown = (v: PlanView) => gownWorn(v) || n(v, "Doctors' gown") > 0;
const inHut = (v: PlanView) => west(v) && px(v) >= 2515 && px(v) <= 2519 && pz(v) >= 3272 && pz(v) <= 3276;
const level = (v: PlanView) => v.state.player?.level ?? 0;
const hasKey = (v: PlanView) => n(v, 'Key') > 0;
// The inventory view lags the crate search, so the finds message counts too until Elena has been handed it.
const hasDistillator = (v: PlanView) =>
    n(v, 'Distillator') > 0 || (heard(v, /find Elena.s distillator/i) && !heard(v, /hand Elena the distillator/i));
const inHQ = (v: PlanView) => west(v) && px(v) >= 2543 && px(v) <= 2556 && pz(v) >= 3321 && pz(v) <= 3334;
const honey = (v: PlanView) => n(v, 'Liquid honey');
const broline = (v: PlanView) => n(v, 'Sulphuric broline');
const ethanea = (v: PlanView) => n(v, 'Ethanea');
const sample = (v: PlanView) => n(v, 'Plague sample');
const paper = (v: PlanView) => n(v, 'Touch paper');
const anyVial = (v: PlanView) => honey(v) + broline(v) + ethanea(v) > 0;
const allVials = (v: PlanView) => honey(v) > 0 && broline(v) > 0 && ethanea(v) > 0;
const nearChem = (v: PlanView) => surface(v) && px(v) >= 2915 && px(v) <= 2950 && pz(v) >= 3200 && pz(v) <= 3230;
const nearDonkey = (v: PlanView) => surface(v) && px(v) >= 3255 && px(v) <= 3295 && pz(v) >= 3375 && pz(v) <= 3400;
const priestWorn = (v: PlanView) => v.state.equipment.filter(i => /^Priest gown$/i.test(i.name)).length >= 2;
// Guidor takes the sample, the touch paper and the three vials: with the Key still held, none of them left is "after Guidor".
const guidorDone = (v: PlanView) =>
    heard(v, /there is no plague/i) ||
    (hasKey(v) &&
        heard(v, /three vials and a sample/i) &&
        sample(v) === 0 &&
        paper(v) === 0 &&
        !anyVial(v) &&
        !hasDistillator(v));
const reported = (v: PlanView) => heard(v, /King of East Ardougne/i);
// A step of the way out of the HQ has just ended: the position view lags, so a no-op walk settles it before the next pick.
const exitStep = (v: PlanView) => ['gate-out', 'hq-door-up', 'hq-stairs-down'].includes(v.last?.phase ?? '');
const released = (v: PlanView) => heard(v, /pigeons fly towards|mourners frantically/i);

export default definePlan({
    name: 'biohazard',
    description:
        'Biohazard: Elena, Jerico (bird feed, pigeons), the wall, the HQ stew and gown, the distillator, the vials via Rimmington to Varrock and Guidor, Elena, King Lathas.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => done(v),
    phases: [
        // --- the finish: Elena, then King Lathas ---
        phase(
            talk,
            { npc: '^King Lathas$', at: { x: 2578, z: 3293, level: 1, tolerance: 2 }, choices: ['understand'] },
            { name: 'lathas', when: v => started(v) && guidorDone(v) && reported(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Elena$', at: { x: 2592, z: 3337, tolerance: 2 } },
            { name: 'elena-report', when: v => started(v) && guidorDone(v) && !reported(v), maxFails: 3 },
        ),
        // --- Guidor in Varrock: priest gown and robe worn, the vials back from the errand boys ---
        phase(
            talk,
            {
                npc: '^Guidor$',
                at: { x: 3285, z: 3381, tolerance: 2 },
                choices: ['assistance', 'pupil Elena', 'Elena wanted'],
            },
            {
                name: 'guidor',
                when: v => started(v) && !guidorDone(v) && allVials(v) && paper(v) > 0 && priestWorn(v) && !nearChem(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 3282, z: 3382 },
                at: { x: 3284, z: 3382, tolerance: 1 },
            },
            {
                name: 'guidor-door',
                when: v =>
                    started(v) &&
                    !guidorDone(v) &&
                    allVials(v) &&
                    priestWorn(v) &&
                    px(v) >= 3283 &&
                    px(v) <= 3300 &&
                    v.last?.phase !== 'guidor-door' &&
                    v.last?.phase !== 'guidor',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            items,
            {
                equip: [
                    { name: 'Priest gown', id: 426 },
                    { name: 'Priest gown', id: 428 },
                ],
            },
            { name: 'wear-priest', when: v => started(v) && allVials(v) && !priestWorn(v) && paper(v) > 0 },
        ),
        phase(
            talk,
            { npc: '^DeVinci$', at: { x: 3274, z: 3390, tolerance: 2 } },
            {
                name: 'get-devinci',
                when: v => started(v) && nearDonkey(v) && ethanea(v) === 0 && paper(v) > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Hops$', at: { x: 3268, z: 3389, tolerance: 2 } },
            {
                name: 'get-hops',
                when: v => started(v) && nearDonkey(v) && broline(v) === 0 && paper(v) > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Chancy$', at: { x: 3270, z: 3391, tolerance: 2 } },
            {
                name: 'get-chancy',
                when: v => started(v) && nearDonkey(v) && honey(v) === 0 && paper(v) > 0,
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 3271, z: 3390 }, tolerance: 4 },
            {
                name: 'to-varrock',
                when: v => started(v) && paper(v) > 0 && sample(v) > 0 && !anyVial(v) && !nearDonkey(v),
                maxFails: 3,
            },
        ),
        // --- the errand boys outside the Chemist's house (Rimmington) ---
        phase(
            talk,
            { npc: '^DeVinci$', at: { x: 2933, z: 3219, tolerance: 2 }, choices: ['ethanea|ethenea'] },
            {
                name: 'give-devinci',
                when: v => started(v) && paper(v) > 0 && ethanea(v) > 0 && !nearDonkey(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Hops$', at: { x: 2931, z: 3219, tolerance: 2 }, choices: ['sulphuric'] },
            {
                name: 'give-hops',
                when: v => started(v) && paper(v) > 0 && broline(v) > 0 && !nearDonkey(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Chancy$', at: { x: 2935, z: 3219, tolerance: 2 }, choices: ['liquid honey'] },
            {
                name: 'give-chancy',
                when: v => started(v) && paper(v) > 0 && honey(v) > 0 && !nearDonkey(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Chemist$', at: { x: 2934, z: 3211, tolerance: 2 }, choices: ['Elena.s friend', 'Guidor'] },
            { name: 'chemist', when: v => started(v) && sample(v) > 0 && paper(v) === 0 && anyVial(v), maxFails: 3 },
        ),
        // The inventory view lags the crate search by a tick: a no-op walk lets it catch up before the next pick.
        phase(
            travel,
            { to: { x: 2554, z: 3326, level: 1 }, tolerance: 3 },
            {
                name: 'settle-crate',
                when: v => started(v) && west(v) && hasKey(v) && v.last?.phase === 'crate',
                maxFails: 3,
            },
        ),
        // --- the finish of the West trip: the distillator back to Elena (Kilron takes you over the wall) ---
        phase(
            talk,
            { npc: '^Elena$', at: { x: 2592, z: 3337, tolerance: 2 } },
            { name: 'elena-distillator', when: v => started(v) && east(v) && hasDistillator(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 2549, z: 3326, level: 1 }, tolerance: 8 },
            {
                name: 'settle-exit-up',
                when: v => started(v) && west(v) && hasDistillator(v) && level(v) === 1 && exitStep(v),
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2545, z: 3325 }, tolerance: 6 },
            {
                name: 'settle-exit-stairs',
                when: v =>
                    started(v) && west(v) && hasDistillator(v) && level(v) === 0 && v.last?.phase === 'hq-stairs-down',
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2551, z: 3316 }, tolerance: 8 },
            {
                name: 'settle-exit-door',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasDistillator(v) &&
                    level(v) === 0 &&
                    v.last?.phase?.startsWith('hq-door-out') === true &&
                    v.last?.status === 'done',
                maxFails: 3,
            },
        ),
        // The stairs room (2542-2546) is walled off from the kitchen by a door the long walk to the front door gets stuck in.
        phase(
            travel,
            { to: { x: 2547, z: 3325 }, tolerance: 1 },
            {
                name: 'hq-kitchen',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasDistillator(v) &&
                    level(v) === 0 &&
                    px(v) >= 2541 &&
                    px(v) <= 2546 &&
                    pz(v) >= 3320 &&
                    pz(v) <= 3334 &&
                    v.last?.phase !== 'hq-stairs-down' &&
                    v.last?.phase !== 'hq-kitchen',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2551, z: 3320 },
                at: { x: 2551, z: 3322, tolerance: 1 },
            },
            {
                name: 'hq-door-out-a',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasDistillator(v) &&
                    v.last?.phase !== 'hq-door-out-a' &&
                    level(v) === 0 &&
                    inHQ(v) &&
                    (px(v) >= 2547 || v.last?.phase === 'hq-kitchen'),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2551, z: 3320 },
                at: { x: 2551, z: 3322, tolerance: 1 },
            },
            {
                name: 'hq-door-out-b',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasDistillator(v) &&
                    v.last?.phase === 'hq-door-out-a' &&
                    v.last?.status === 'failed' &&
                    level(v) === 0 &&
                    inHQ(v) &&
                    px(v) >= 2547,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 2544, z: 3325, level: 1, tolerance: 1 },
            },
            {
                name: 'hq-stairs-down',
                when: v => started(v) && west(v) && hasDistillator(v) && level(v) === 1 && px(v) <= 2546,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2547, z: 3325, level: 1 },
                at: { x: 2548, z: 3325, level: 1, tolerance: 1 },
            },
            {
                name: 'hq-door-up',
                when: v =>
                    started(v) && west(v) && hasDistillator(v) && level(v) === 1 && px(v) >= 2547 && px(v) <= 2551,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gate$',
                option: '^Open$',
                tile: { x: 2551, z: 3326, level: 1 },
                at: { x: 2552, z: 3326, level: 1, tolerance: 1 },
            },
            {
                name: 'gate-out',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasDistillator(v) &&
                    level(v) === 1 &&
                    px(v) >= 2552 &&
                    v.last?.phase !== 'gate-out',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Kilron$', at: { x: 2556, z: 3266, tolerance: 2 }, choices: ['Yes I do'] },
            { name: 'kilron', when: v => started(v) && west(v) && hasDistillator(v) && !exitStep(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: '^Search$',
                tile: { x: 2554, z: 3327, level: 1 },
                at: { x: 2554, z: 3326, level: 1, tolerance: 1 },
                expect: 'distillator',
            },
            {
                name: 'crate',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasKey(v) &&
                    !hasDistillator(v) &&
                    level(v) === 1 &&
                    (px(v) >= 2551 || v.last?.phase === 'gate') &&
                    v.last?.phase !== 'crate' &&
                    v.last?.phase !== 'settle-crate',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gate$', option: '^Open$', at: { x: 2550, z: 3326, level: 1, tolerance: 1 } },
            {
                name: 'gate',
                when: v =>
                    started(v) &&
                    west(v) &&
                    hasKey(v) &&
                    !hasDistillator(v) &&
                    level(v) === 1 &&
                    px(v) <= 2550 &&
                    v.last?.phase !== 'gate',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Mourner$', at: { x: 2549, z: 3326, level: 1, tolerance: 2 }, choices: ['hold your breath'] },
            {
                name: 'sick-mourner',
                when: v =>
                    started(v) &&
                    gownWorn(v) &&
                    west(v) &&
                    !hasKey(v) &&
                    !hasDistillator(v) &&
                    (inHQ(v) || level(v) === 1),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2551, z: 3320 },
                at: { x: 2551, z: 3318, tolerance: 1 },
            },
            {
                name: 'hq-door',
                when: v =>
                    started(v) &&
                    gownWorn(v) &&
                    west(v) &&
                    !hasKey(v) &&
                    !hasDistillator(v) &&
                    !inHQ(v) &&
                    level(v) === 0 &&
                    v.last?.phase !== 'hq-door',
                maxFails: 3,
            },
        ),
        phase(
            items,
            { equip: ["Doctors' gown"] },
            { name: 'wear-gown', when: v => started(v) && west(v) && n(v, "Doctors' gown") > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2519, z: 3275 },
                at: { x: 2520, z: 3275, tolerance: 1 },
            },
            {
                name: 'nurse-door',
                when: v =>
                    started(v) && west(v) && poisoned(v) && !hasGown(v) && !inHut(v) && v.last?.phase !== 'nurse-door',
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Search$',
                tile: { x: 2517, z: 3276 },
                at: { x: 2518, z: 3276, tolerance: 1 },
                expect: 'find a',
            },
            {
                name: 'nurse-search',
                when: v => started(v) && west(v) && poisoned(v) && !hasGown(v) && v.last?.phase !== 'nurse-open',
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // The opened cupboard shows its Search option some 15 s late: Nurse Sarah's chat fills the time.
        phase(
            talk,
            { npc: '^Nurse Sarah$', at: { x: 2517, z: 3274, tolerance: 1 } },
            {
                name: 'nurse-talk',
                when: v => started(v) && west(v) && poisoned(v) && !hasGown(v) && v.last?.phase === 'nurse-open',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Open$',
                tile: { x: 2517, z: 3276 },
                at: { x: 2518, z: 3276, tolerance: 1 },
            },
            {
                name: 'nurse-open',
                when: v => started(v) && west(v) && poisoned(v) && !hasGown(v) && v.last?.phase !== 'nurse-open',
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fence$',
                option: '^Climb-over$',
                tile: { x: 2541, z: 3331 },
                at: { x: 2541, z: 3333, tolerance: 1 },
            },
            {
                name: 'fence',
                when: v =>
                    started(v) && west(v) && n(v, 'Rotten apples') > 0 && !inDining(v) && v.last?.phase !== 'fence',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cauldron$',
                use: { item: '^Rotten apples$' },
                at: { x: 2543, z: 3331, tolerance: 1 },
                expect: 'dissolves into the stew',
            },
            {
                name: 'poison',
                when: v =>
                    started(v) && west(v) && n(v, 'Rotten apples') > 0 && (inDining(v) || v.last?.phase === 'fence'),
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2535, z: 3333, radius: 4 }, items: [{ item: 'Rotten apples', count: 1 }] },
            {
                name: 'apple',
                when: v => started(v) && west(v) && n(v, 'Rotten apples') === 0 && !poisoned(v),
                maxFails: 3,
            },
        ),
        // Omart's chat closes (if_close, a rope throw) before the crossing question, which opens as a new dialog.
        phase(
            talk,
            { continue: true, choices: ['lets do it|let.s do it'] },
            {
                name: 'omart-cross',
                when: v => started(v) && east(v) && released(v) && (v.last?.phase === 'omart' || v.state.dialog.isOpen),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Omart$', at: { x: 2559, z: 3267, tolerance: 2 } },
            { name: 'omart', when: v => started(v) && east(v) && released(v), onFail: 'continue', maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Pigeon cage$',
                option: '^Open$',
                at: { x: 2565, z: 3304, tolerance: 1 },
                expect: 'fly towards',
            },
            {
                name: 'release',
                when: v => started(v) && east(v) && fed(v) && !released(v) && n(v, 'Pigeon cage') > 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Watchtower$',
                use: { item: '^Bird feed$' },
                at: { x: 2565, z: 3304, tolerance: 1 },
                expect: 'do not seem to notice',
            },
            { name: 'feed', when: v => started(v) && east(v) && hasFeed(v) && n(v, 'Pigeon cage') > 0, maxFails: 3 },
        ),
        phase(
            pickup,
            { area: { x: 2618, z: 3324, radius: 4 }, items: [{ item: 'Pigeon cage', count: 1 }] },
            {
                name: 'cage',
                when: v => started(v) && east(v) && hasFeed(v) && n(v, 'Pigeon cage') === 0 && !released(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Search$',
                tile: { x: 2611, z: 3326 },
                at: { x: 2612, z: 3326, tolerance: 1 },
            },
            {
                name: 'cupboard-search',
                when: v =>
                    started(v) && east(v) && spokeJerico(v) && !hasFeed(v) && !fed(v) && !released(v) && !hasKey(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cupboard$',
                option: '^Open$',
                tile: { x: 2611, z: 3326 },
                at: { x: 2612, z: 3326, tolerance: 1 },
            },
            {
                name: 'cupboard-open',
                when: v =>
                    started(v) && east(v) && spokeJerico(v) && !hasFeed(v) && !fed(v) && !released(v) && !hasKey(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            talk,
            { npc: '^Jerico$', at: { x: 2612, z: 3324, tolerance: 2 } },
            {
                name: 'jerico',
                when: v =>
                    started(v) && east(v) && !spokeJerico(v) && !hasFeed(v) && !fed(v) && !released(v) && !hasKey(v),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Elena$', at: { x: 2592, z: 3337, tolerance: 2 }, choices: ['retrieve it'] },
            { name: 'elena-start', when: v => none(v) && east(v), maxFails: 3 },
        ),
    ],
});
