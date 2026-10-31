// Proven on questw5: a fresh load of lib:shilo-village-start to quest done in one run (about 20 min, 2026-11-01). Random failures
// (temple undead, bridge/rock falls, stale views) are covered by onFail continue and fallback phases; resume from a failed phase.
// Shilo Village (quest id zombiequeen; server/content/scripts/quests/quest_zombiequeen, areas/area_karamja/scripts/trufitus.rs2),
// start to done. Jungle Potion must be done (varp 175 = 12 in the start save).
// Stages: 1 Trufitus (Wampum belt on him); 4 dig the Mound of earth at (2921,2999) with a spade; 5 lit candle on the fissure; 6 rope on
// it; 7 crawl in (Agility 32); 8 leave the temple (waterfall path, either outcome puts the bot outside); 9 Cairn island rocks
// (2762,2990) after the tattered scroll was READ (Agility 32); 10 bone key on the hidden doors (2917,3090); 11 gate with the Beads of the
// Dead worn; 12 three Bones on the tomb doors; Nazastarool in three forms at the dolmen (2892,9487); 14 corpse; 15 corpse on the dolmen
// in Bervirius' tomb (2766,9364).
// Temple (underground x 2880-2950): the 146 half (z>=9344) holds the rubble to the 145 half (z<9344) with the gallows (Zadimus corpse),
// the sacks (crumpled scroll) and the loose rocks (tattered scroll). The raft table is never touched (one failed roll kills it).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import talk from '@conductor/tasks/talk';
import prayer from '@conductor/tasks/prayer';
import travel from '@conductor/tasks/travel';

const ID = 'zombiequeen';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const surface = (v: PlanView) => pz(v) < 6000;
const temple = (v: PlanView) => px(v) > 2870 && px(v) < 2960 && pz(v) >= 9270 && pz(v) < 9420;
const temple146 = (v: PlanView) => temple(v) && pz(v) >= 9344;
const temple145 = (v: PlanView) => temple(v) && pz(v) < 9344;
const berv = (v: PlanView) => px(v) < 2830 && pz(v) >= 9340 && pz(v) < 9420;
const rash = (v: PlanView) => px(v) > 2870 && px(v) < 2960 && pz(v) >= 9440 && pz(v) < 9560;
const nearLoc = (v: PlanView, re: RegExp) => v.state.nearbyLocs.some(l => re.test(l.name));
const nearNpc = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.some(n => re.test(n.name));
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const wornBeads = (v: PlanView) => v.state.equipment.some(i => /^beads of the dead$/i.test(i.name));
const undeadClose = (v: PlanView) =>
    v.state.nearbyNpcs.some(
        n => /^Undead One$/i.test(n.name) && Math.max(Math.abs(n.x - px(v)), Math.abs(n.z - pz(v))) <= 7,
    );
const dist = (v: PlanView, x: number, z: number) => Math.max(Math.abs(px(v) - x), Math.abs(pz(v) - z));

const corpse = (v: PlanView) => v.inv('Rashiliya corpse');
const key = (v: PlanView) => v.inv('Bone key');
const shard = (v: PlanView) => v.inv('Bone shard');
const zbones = (v: PlanView) => v.inv('Zadimus corpse');
const tatt = (v: PlanView) => v.inv('Tattered scroll');
const crum = (v: PlanView) => v.inv('Crumpled scroll');
const pommel = (v: PlanView) => v.inv('Sword pommel');
const bbeads = (v: PlanView) => v.inv('Bone beads');
const beadsHeld = (v: PlanView) => v.inv('Beads of the dead') + (wornBeads(v) ? 1 : 0);
// the Bervirius tomb was visited once the pommel (or what it became) is held
const bervDone = (v: PlanView) => pommel(v) + bbeads(v) + beadsHeld(v) > 0;
const keyOrShard = (v: PlanView) => key(v) + shard(v) + zbones(v);
const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);

// On the mainland with the crawl into Bervirius' tomb still to do: the rocks at (2794,2979) are climbed west (Agility 15, a fall
// puts the bot back east), then the log bridge (2776-2781,2979) leads to Cairn Isle; the crawl rocks stand at (2762,2990) on its north edge.
const needCrawl = (v: PlanView) =>
    surface(v) &&
    tatt(v) > 0 &&
    crum(v) > 0 &&
    ((!bervDone(v) && keyOrShard(v) > 0 && corpse(v) === 0) || corpse(v) > 0);
const onIsle = (v: PlanView) => px(v) <= 2776 && pz(v) <= 2992 && pz(v) >= 2960;
const MOUND = { x: 2921, z: 2999 };
const STONE = { x: 2905, z: 3092 };
const readOnce = (name: string, re: string, has: (v: PlanView) => number) =>
    phase(
        interact,
        { target: 'item', name: re, option: '^Read$', choices: ['Yes please'] },
        {
            name,
            when: v => has(v) > 0 && !temple(v) && v.runs(name) === 0 && v.runs('leave-bank') > 0,
            onFail: 'continue',
            maxFails: 3,
        },
    );

export default definePlan({
    name: 'shilo-village',
    description:
        'Shilo Village to done: Trufitus, mound and fissure, Ah Za Rhoon (gallows, sacks, loose rocks), Bervirius tomb, beads and bone key, hidden tomb doors, three Nazastarool forms, corpse to Bervirius dolmen.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'Agility 32, Crafting 20': v => v.level('Agility') >= 32 && v.level('Crafting') >= 20,
    },
    until: v => done(v),
    phases: [
        // Rashiliyia's undead roam the temple and attack on sight: finish them before any dialog is needed.
        phase(
            combat,
            {
                target: 'Undead One',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2915, z: 9330, radius: 45 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 80,
                respawnWaitTicks: 3,
            },
            {
                name: 'undead',
                when: v => temple(v) && undeadClose(v) && v.runs('undead') < 8,
                until: v => !undeadClose(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        readOnce('read-crumpled', '^Crumpled scroll$', crum),
        readOnce('read-tattered', '^Tattered scroll$', tatt),
        // The waterfall puts the bot on a stepping-stone bank at (2928,2947) the walker cannot route from; the mound side it can.
        phase(
            travel,
            { to: { x: 2921, z: 2997 }, tolerance: 3 },
            {
                name: 'leave-bank',
                when: v =>
                    (surface(v) && px(v) > 2900 && pz(v) < 2960) ||
                    (v.last?.phase === 'waterfall' && v.last.status === 'done'),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2794, z: 2979 },
                at: { x: 2796, z: 2979, tolerance: 1 },
            },
            { name: 'rocks-cross', when: v => needCrawl(v) && px(v) >= 2795, onFail: 'continue', maxFails: 10 },
        ),
        phase(
            travel,
            { to: { x: 2797, z: 2979 }, tolerance: 2 },
            { name: 'rocks-wait', when: v => needCrawl(v) && px(v) >= 2795, maxFails: 4 },
        ),
        phase(
            travel,
            { to: { x: 2774, z: 2979 }, tolerance: 1 },
            { name: 'to-isle', when: v => needCrawl(v) && !onIsle(v) && px(v) < 2795, onFail: 'continue', maxFails: 8 },
        ),
        // a fall from the bridge lands on a river bank with no route to the isle: back east to the rocks
        phase(
            travel,
            { to: { x: 2797, z: 2979 }, tolerance: 2 },
            { name: 'bank-back', when: v => needCrawl(v) && !onIsle(v) && px(v) < 2795, maxFails: 6 },
        ),
        // --- the end: the corpse on the Bervirius dolmen ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Tomb dolmen$',
                use: { item: '^Rashiliya corpse$' },
                at: { x: 2766, z: 9364, tolerance: 2 },
            },
            { name: 'lay-to-rest', when: v => corpse(v) > 0 && berv(v), onFail: 'continue', maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Well stacked rocks$',
                option: '^Search$',
                at: { x: 2762, z: 2988, tolerance: 2 },
                choices: ['Yes Please'],
            },
            { name: 'corpse-crawl', when: v => corpse(v) > 0 && surface(v), onFail: 'continue', maxFails: 8 },
        ),
        // --- the Rashiliyia tomb, out with the corpse ---
        phase(
            interact,
            { target: 'loc', name: '^Tomb exit$', use: { item: '^Bone key$' }, at: { x: 2928, z: 9525, tolerance: 2 } },
            { name: 'tomb-exit', when: v => corpse(v) > 0 && rash(v) && pz(v) > 9516, onFail: 'continue', maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ancient metal gate$', option: '^Open$', at: { x: 2929, z: 9514, tolerance: 1 } },
            {
                name: 'gate-out',
                when: v => corpse(v) > 0 && rash(v) && pz(v) <= 9516 && pz(v) > 9512,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Rocks$', option: '^Climb$', at: { x: 2928, z: 9510, tolerance: 1 } },
            { name: 'rocks-up', when: v => corpse(v) > 0 && rash(v) && pz(v) <= 9512, onFail: 'continue', maxFails: 4 },
        ),
        // --- the Nazastarool fights (the dolmen raises the next undefeated form; after the third it gives the corpse) ---
        phase(
            combat,
            {
                target: 'Nazastarool',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2892, z: 9487, radius: 10 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 80,
                prayers: ['Protect from Melee'],
                keepPrayersOn: true,
                respawnWaitTicks: 20,
            },
            {
                name: 'nazastarool',
                when: v => rash(v) && nearNpc(v, /^Nazastarool$/i),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            prayer,
            { off: ['Protect from Melee'] },
            {
                name: 'prayer-off',
                when: v => rash(v) && corpse(v) > 0 && v.runs('nazastarool') > 0 && v.runs('prayer-off') === 0,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Tomb dolmen$', option: '^Search$', at: { x: 2892, z: 9485, tolerance: 2 } },
            {
                name: 'dolmen',
                when: v =>
                    rash(v) &&
                    v.inv(/^Bones$/) === 0 &&
                    corpse(v) === 0 &&
                    !nearNpc(v, /^Nazastarool$/i) &&
                    pz(v) > 9480 &&
                    pz(v) <= 9512,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Tomb doors$',
                use: { item: '^Bones$' },
                tile: { x: 2892, z: 9480 },
                at: { x: 2892, z: 9478, tolerance: 2 },
            },
            {
                name: 'bones-door',
                when: v => rash(v) && v.inv(/^Bones$/) > 0 && corpse(v) === 0 && pz(v) <= 9512,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2928, z: 9515 },
                at: { x: 2928, z: 9516, tolerance: 1 },
            },
            {
                name: 'rocks-down',
                when: v => rash(v) && corpse(v) === 0 && px(v) > 2920 && pz(v) > 9512 && pz(v) <= 9516,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ancient metal gate$', option: '^Open$', at: { x: 2929, z: 9518, tolerance: 1 } },
            {
                name: 'gate-in',
                when: v => rash(v) && corpse(v) === 0 && pz(v) > 9516 && wornBeads(v),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // fallback after a stale-position failure in the tomb: stand at the foot of the rocks
        phase(
            travel,
            { to: { x: 2928, z: 9511 }, tolerance: 3 },
            { name: 'rash-wait', when: v => rash(v) && px(v) > 2920 && pz(v) <= 9516, maxFails: 4 },
        ),
        // --- the hidden doors on the surface ---
        phase(
            interact,
            { target: 'loc', name: '^Hillside entrance$', option: '^Enter$', at: { x: 2916, z: 3094, tolerance: 2 } },
            {
                name: 'enter-tomb',
                when: v => surface(v) && nearLoc(v, /^Hillside entrance$/) && key(v) > 0 && wornBeads(v),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Carved doors$',
                use: { item: '^Bone key$' },
                at: { x: 2916, z: 3094, tolerance: 2 },
            },
            {
                name: 'unlock',
                when: v => surface(v) && nearLoc(v, /^Carved doors$/) && key(v) > 0 && wornBeads(v),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Palm tree$',
                option: '^Search$',
                tile: { x: 2915, z: 3092 },
                at: { x: 2915, z: 3095, tolerance: 1 },
            },
            {
                name: 'reveal-key',
                when: v =>
                    surface(v) && key(v) > 0 && wornBeads(v) && !nearLoc(v, /^(Carved doors|Hillside entrance)$/),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // --- crafting on the surface ---
        phase(
            items,
            { equip: ['Beads of the dead'] },
            { name: 'wear-beads', when: v => v.inv('Beads of the dead') > 0, onFail: 'continue', maxFails: 2 },
        ),
        phase(
            items,
            { combine: { use: '^Chisel$', on: '^Bone shard$', product: 'Bone key' } },
            {
                name: 'craft-key',
                when: v => shard(v) > 0 && key(v) === 0 && said(v, /made out of bone/i),
                onFail: 'continue',
                maxFails: 2,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Carved doors$', option: '^Search$', at: { x: 2916, z: 3094, tolerance: 2 } },
            {
                name: 'search-door',
                when: v =>
                    surface(v) &&
                    shard(v) > 0 &&
                    key(v) === 0 &&
                    bervDone(v) &&
                    nearLoc(v, /^Carved doors$/) &&
                    !said(v, /made out of bone/i),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Palm tree$',
                option: '^Search$',
                tile: { x: 2915, z: 3092 },
                at: { x: 2915, z: 3095, tolerance: 1 },
            },
            {
                name: 'reveal-look',
                when: v =>
                    surface(v) &&
                    shard(v) > 0 &&
                    key(v) === 0 &&
                    bervDone(v) &&
                    !nearLoc(v, /^Carved doors$/) &&
                    !said(v, /made out of bone/i),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            items,
            { combine: { use: '^Bronze wire$', on: '^Bone beads$', product: 'Beads of the dead' } },
            {
                name: 'craft-beads',
                when: v => bbeads(v) > 0 && v.inv('Bronze wire') > 0,
                onFail: 'continue',
                maxFails: 2,
            },
        ),
        phase(
            items,
            { combine: { use: '^Chisel$', on: '^Sword pommel$', product: 'Bone beads' } },
            { name: 'craft-pommel', when: v => pommel(v) > 0, onFail: 'continue', maxFails: 2 },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Zadimus corpse$',
                option: '^Bury$',
                at: { x: 2796, z: 3088, tolerance: 1 },
                expect: 'released me|torture|apparition',
            },
            {
                name: 'bury',
                when: v =>
                    zbones(v) > 0 &&
                    surface(v) &&
                    bervDone(v) &&
                    !v.state.dialog.isOpen &&
                    v.last?.phase !== 'bury' &&
                    v.last?.phase !== 'bury-continue',
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // Zadimus' ghost speaks a few pages after the bury; the dialog is cleared before anything else is chosen.
        phase(
            talk,
            { continue: true },
            { name: 'bury-continue', when: v => v.last?.phase === 'bury', onFail: 'continue', maxFails: 4 },
        ),
        // --- Bervirius' tomb ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Climbing rocks$',
                option: '^Climb$',
                at: { x: 2765, z: 9375, tolerance: 2 },
                expect: 'manage to climb back out|You fall',
            },
            { name: 'berv-out', when: v => berv(v) && bervDone(v) && pz(v) > 9000, onFail: 'continue', maxFails: 10 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Tomb dolmen$', option: '^Search$', at: { x: 2766, z: 9362, tolerance: 2 } },
            { name: 'berv-dolmen', when: v => berv(v) && !bervDone(v), onFail: 'continue', maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Well stacked rocks$',
                option: '^Search$',
                at: { x: 2762, z: 2988, tolerance: 2 },
                choices: ['Yes Please'],
            },
            {
                name: 'berv-crawl',
                when: v =>
                    surface(v) && tatt(v) > 0 && crum(v) > 0 && !bervDone(v) && corpse(v) === 0 && keyOrShard(v) > 0,
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        // --- the temple ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Waterfall rocks$',
                option: '^Search$',
                at: { x: 2938, z: 9349, tolerance: 2 },
                choices: ['follow the path'],
            },
            {
                name: 'waterfall',
                when: v =>
                    temple146(v) && keyOrShard(v) > 0 && crum(v) > 0 && tatt(v) > 0 && v.last?.phase !== 'waterfall',
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cave in$',
                option: '^Search$',
                at: { x: 2886, z: 9285, tolerance: 2 },
                choices: ['wriggle'],
            },
            {
                name: 'rubble-back',
                when: v => temple145(v) && keyOrShard(v) > 0 && crum(v) > 0 && tatt(v) > 0,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Loose rocks$',
                option: '^Search$',
                at: { x: 2885, z: 9319, tolerance: 2 },
                choices: ['quite sure'],
            },
            { name: 'loose-rocks', when: v => temple145(v) && tatt(v) === 0, onFail: 'continue', maxFails: 8 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Old sacks$', option: '^Search$', at: { x: 2939, z: 9287, tolerance: 2 } },
            { name: 'sacks', when: v => temple145(v) && crum(v) === 0, onFail: 'continue', maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ancient gallows$',
                option: '^Search$',
                at: { x: 2934, z: 9327, tolerance: 2 },
                choices: ['may find something'],
            },
            { name: 'gallows', when: v => temple145(v) && keyOrShard(v) === 0, onFail: 'continue', maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cave in$',
                option: '^Search$',
                at: { x: 2887, z: 9371, tolerance: 2 },
                choices: ['wriggle'],
            },
            {
                name: 'rubble-in',
                when: v => temple146(v) && (keyOrShard(v) === 0 || crum(v) === 0 || tatt(v) === 0),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // --- the mound and the fissure ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fissure$',
                option: '^Search$',
                at: { ...MOUND, tolerance: 2 },
                choices: ['give it a go'],
            },
            {
                name: 'enter-fissure',
                when: v =>
                    surface(v) &&
                    started(v) &&
                    v.inv('Lit candle') === 0 &&
                    v.inv('Rope') === 0 &&
                    dist(v, MOUND.x, MOUND.z) < 20 &&
                    keyOrShard(v) === 0,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Fissure$', use: { item: '^Rope$' }, at: { ...MOUND, tolerance: 2 } },
            {
                name: 'rope',
                when: v => surface(v) && started(v) && v.inv('Lit candle') === 0 && v.inv('Rope') > 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Fissure$', use: { item: '^Lit candle$' }, at: { ...MOUND, tolerance: 2 } },
            {
                name: 'light',
                when: v =>
                    surface(v) &&
                    started(v) &&
                    v.inv('Lit candle') > 0 &&
                    (nearLoc(v, /^Fissure$/) || v.last?.phase === 'dig'),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // the fissure appears a few ticks after the dig starts: wait at the mound, then the light is tried again
        phase(
            travel,
            { to: { x: 2921, z: 2997 }, tolerance: 3 },
            {
                name: 'dig-wait',
                when: v => v.inv('Lit candle') > 0 && (v.last?.phase === 'light' || v.last?.phase === 'dig-wait'),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Mound of earth$', use: { item: '^Spade$' }, at: { ...MOUND, tolerance: 2 } },
            {
                name: 'dig',
                when: v =>
                    surface(v) &&
                    started(v) &&
                    v.inv('Lit candle') > 0 &&
                    !nearLoc(v, /^Fissure$/) &&
                    v.last?.phase !== 'dig',
                maxFails: 3,
            },
        ),
        // fallbacks so a `continue` failure of a retried crawl or climb is followed by a retry, not by "no phase applies"
        phase(
            travel,
            { to: { x: 2763, z: 2988 }, tolerance: 2 },
            { name: 'isle-wait', when: v => surface(v) && onIsle(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 2765, z: 9374 }, tolerance: 1 },
            { name: 'berv-wait', when: v => berv(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Trufitus$',
                use: { item: '^Wampum belt$' },
                at: { x: 2809, z: 3086, tolerance: 3 },
                choices: ['legend', 'Why was it called', 'going to search', 'seriously'],
            },
            { name: 'start', when: v => v.quest(ID) === 'none' && v.inv('Wampum belt') > 0, maxFails: 3 },
        ),
    ],
});
void STONE;
