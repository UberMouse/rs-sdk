// Big Chompy Bird Hunting (server scripts: quests/quest_chompybird/scripts/*.rs2, skill_fletching/scripts/ogre_arrows.rs2),
// start to done. Stages read from held items, position, nearby npcs/locs and the dialog and message history:
//   Rantz (2630,2981) starts it (5). Bugs in the cave sells a knife and a chisel (10 gp). Achey logs + knife -> ogre arrow
//   shafts, feathers -> flighted arrows, wolf bones + chisel -> arrow tips, flighted + tips -> ogre arrows. Rantz takes six
//   (10) and "How do we make the chompys come" (15) lets the Locked Ogre chest in the cave be unlocked (strength roll),
//   then searched for the Ogre bellows. Bellows on the Swamp bubbles (3 loads), then on Swamp toads -> Bloated toads (max
//   3). A toad shown to Rantz (25) is placed (op1 "Drop") inside x2631-2639 z2962-2971; a chompy may spawn (about 59% a
//   toad) and Rantz misses (40); he lends the Ogre bow (45). A later chompy is shot with the bow and ogre arrows, plucked
//   (Raw chompy), shown to Rantz (55), Fycie and Bugs name their seasoning (Rantz: potato or onion), the three seasonings
//   are gathered, the Raw chompy goes on the Ogre spit-roast (Cooking roll) and the Seasoned chompy goes to Rantz.
// Start save: lib:big-chompy-start (60 feathers, bronze axe, 10 swordfish, 300 gp; knife and chisel are bought).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pick from '@conductor/tasks/pick';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'chompybird';
const n = (v: PlanView, name: string) => v.inv(name);
const equipped = (v: PlanView, re: RegExp) =>
    v.state.equipment.filter(e => re.test(e.name)).reduce((s, e) => s + (e.count ?? 1), 0);
const pageText = (v: PlanView) => v.state.recentDialogs.map(d => d.text.join(' '));
const said = (v: PlanView, re: RegExp) => pageText(v).some(t => re.test(t));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const started = (v: PlanView) => v.quest(ID) === 'started';
const npcsNamed = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.filter(x => re.test(x.name));

const feathers = (v: PlanView) => n(v, 'Feather');
const logs = (v: PlanView) => n(v, 'Achey tree logs');
const shafts = (v: PlanView) => n(v, 'Ogre arrow shaft');
const flights = (v: PlanView) => n(v, 'Flighted ogre arrow');
const bones = (v: PlanView) => n(v, 'Wolf bones');
const tips = (v: PlanView) => n(v, 'Wolfbone arrowtips');
const arrows = (v: PlanView) => n(v, 'Ogre arrow') + equipped(v, /^Ogre arrow$/i);
const bellows = (v: PlanView) => v.state.inventory.filter(i => /^Ogre bellows/i.test(i.name)).length;
const emptyBellows = (v: PlanView) => n(v, 'Ogre bellows');
const loaded = (v: PlanView) => v.state.inventory.filter(i => /^Ogre bellows \(\d\)$/i.test(i.name)).length;
const toads = (v: PlanView) => n(v, 'Bloated toad');
const bow = (v: PlanView) => n(v, 'Ogre bow') + equipped(v, /^Ogre bow$/i);
const raw = (v: PlanView) => n(v, 'Raw chompy');
const seasoned = (v: PlanView) => n(v, 'Seasoned chompy');

// Rantz has taken the six arrows ("goodly, goodly" ends that talk).
const gave = (v: PlanView) => said(v, /goodly, goodly/i);
const early = (v: PlanView) => started(v) && bellows(v) === 0 && bow(v) === 0 && !gave(v);
const mayMake = (v: PlanView) => early(v) || (started(v) && bow(v) > 0 && raw(v) === 0 && arrows(v) + flights(v) < 10);
const shaftSide = (v: PlanView) => shafts(v) + flights(v) + arrows(v);
const shown = (v: PlanView) => said(v, /good fatsy toady|put da toadies over/i);
const missed = (v: PlanView) => heard(v, /keeps missing the chompy/i);
const toldCook = (v: PlanView) => said(v, /needs to cook da chompy/i);
const bait = (v: PlanView) => npcsNamed(v, /^bloated toad$/i).filter(x => x.distance <= 14);
const aliveChompy = (v: PlanView) =>
    npcsNamed(v, /^chompy bird$/i).filter(x => x.options.some(o => /^attack$/i.test(o)));
const deadChompy = (v: PlanView) => npcsNamed(v, /^chompy bird$/i).filter(x => x.options.some(o => /^pluck$/i.test(o)));
const placedNow = (v: PlanView) => v.last?.phase === 'place-toad' && v.last.status === 'done';
const hunting = (v: PlanView) =>
    started(v) && bellows(v) > 0 && raw(v) === 0 && seasoned(v) === 0 && v.last?.phase !== 'cook';

// Seasonings the family wants, from the dialog pages that name them.
const wantRantz = (v: PlanView): 'Potato' | 'Onion' | null => {
    const t = pageText(v).find(p => /particular about our chompy/i.test(p));
    return t === undefined ? null : /onion/i.test(t) ? 'Onion' : 'Potato';
};
const wantBugs = (v: PlanView): 'Equa leaves' | 'Cabbage' | null => {
    const t = pageText(v).find(p => /making da chompy for us/i.test(p));
    return t === undefined ? null : /equa/i.test(t) ? 'Equa leaves' : 'Cabbage';
};
const wantFycie = (v: PlanView): 'Tomato' | 'Doogle leaves' | null => {
    const t = pageText(v).find(p => /roastling da chompy/i.test(p));
    return t === undefined ? null : /doogle/i.test(t) ? 'Doogle leaves' : 'Tomato';
};
const flavoursKnown = (v: PlanView) => wantRantz(v) !== null && wantBugs(v) !== null && wantFycie(v) !== null;
const needVeg = (v: PlanView, name: string | null) => name !== null && n(v, name) === 0;
const sixVeg = (v: PlanView) =>
    ['Potato', 'Onion', 'Cabbage', 'Equa leaves', 'Tomato', 'Doogle leaves'].every(w => n(v, w) > 0);
const haveAllVeg = (v: PlanView) =>
    flavoursKnown(v) && [wantRantz(v), wantBugs(v), wantFycie(v)].every(w => w !== null && n(v, w) > 0);

const chestStage = (v: PlanView) => started(v) && gave(v) && bellows(v) === 0;
const lockedNear = (v: PlanView) => v.state.nearbyLocs.some(l => /^Locked Ogre chest$/i.test(l.name));
const searchReady = (v: PlanView) =>
    v.state.nearbyLocs.some(l => /^Unlocked Ogre chest$/i.test(l.name) && l.options.some(o => /^search$/i.test(o)));
const lastLift = (v: PlanView) =>
    v.state.gameMessages.filter(m => /manage to lift|strain to lift/i.test(m.text)).at(-1)?.text ?? '';
const strained = (v: PlanView) => /strain to lift/i.test(lastLift(v));
const liftedLast = (v: PlanView) => /manage to lift/i.test(lastLift(v));
const RANTZ = { x: 2630, z: 2979, tolerance: 3 };
const rantz = { npc: '^Rantz$', at: RANTZ, option: '^talk' };
const BUGS = { x: 2640, z: 9390, tolerance: 3 };
const FYCIE = { x: 2649, z: 9392, tolerance: 3 };
const CHEST = { x: 2637, z: 9396, tolerance: 3 };
export default definePlan({
    name: 'big-chompy-bird-hunting',
    description:
        'Big Chompy Bird Hunting: Rantz, knife and chisel from Bugs, ogre arrows (achey logs, wolf bones, feathers), the chest bellows, bloated toads as bait, the ogre bow, a chompy shot and cooked with the family seasonings.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        // wolves and ogres around the swamp attack: walk out of the fight to the bait zone
        phase(
            travel,
            { to: { x: 2634, z: 2967 }, tolerance: 2, flee: true },
            {
                name: 'retreat',
                when: v => (v.state.player?.combat.inCombat ?? false) && aliveChompy(v).length === 0,
                maxFails: 3,
                onFail: 'continue',
            },
        ),
        // the bow shoots whatever attacks: back to the sword away from the bait so the arrows are kept
        phase(
            items,
            { equip: ['Mithril scimitar'] },
            {
                name: 'wield-sword',
                when: v =>
                    equipped(v, /^Ogre bow$/i) > 0 &&
                    n(v, 'Mithril scimitar') > 0 &&
                    bait(v).length === 0 &&
                    aliveChompy(v).length === 0 &&
                    deadChompy(v).length === 0 &&
                    v.last?.phase !== 'shoot' &&
                    v.last?.phase !== 'pluck',
                maxFails: 2,
                onFail: 'continue',
            },
        ),
        // --- the finish ---
        phase(talk, { ...rantz }, { name: 'deliver', when: v => started(v) && seasoned(v) > 0, maxFails: 3 }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ogre spit-roast$',
                use: { item: '^Raw chompy$' },
                at: { x: 2630, z: 2988, tolerance: 2 },
            },
            {
                name: 'cook',
                when: v =>
                    started(v) &&
                    raw(v) > 0 &&
                    toldCook(v) &&
                    wantRantz(v) !== null &&
                    wantFycie(v) !== null &&
                    (wantBugs(v) !== null || v.last?.phase === 'bugs-flavour') &&
                    (haveAllVeg(v) || sixVeg(v)),
                maxFails: 4,
            },
        ),
        // seasonings, only the three named
        phase(
            pick,
            { loc: 'Potato', item: 'Potato', count: 1, area: { x: 2641, z: 2958, radius: 6 } },
            {
                name: 'veg-potato',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantRantz(v)) && wantRantz(v) === 'Potato',
                maxFails: 3,
            },
        ),
        phase(
            pick,
            { loc: 'Onion', item: 'Onion', count: 1, area: { x: 2583, z: 2966, radius: 8 } },
            {
                name: 'veg-onion',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantRantz(v)) && wantRantz(v) === 'Onion',
                maxFails: 3,
            },
        ),
        phase(
            pick,
            { loc: 'Cabbage', item: 'Cabbage', count: 1, area: { x: 2645, z: 2958, radius: 5 } },
            {
                name: 'veg-cabbage',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantBugs(v)) && wantBugs(v) === 'Cabbage',
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2646, z: 2959, radius: 14 }, items: [{ item: 'Equa leaves', count: 1 }], maxWaitSeconds: 40 },
            {
                name: 'veg-equa',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantBugs(v)) && wantBugs(v) === 'Equa leaves',
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2584, z: 2966, radius: 6 }, items: [{ item: 'Tomato', count: 1 }], maxWaitSeconds: 40 },
            {
                name: 'veg-tomato',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantFycie(v)) && wantFycie(v) === 'Tomato',
                maxFails: 3,
            },
        ),
        phase(
            pickup,
            { area: { x: 2562, z: 2972, radius: 6 }, items: [{ item: 'Doogle leaves', count: 1 }], maxWaitSeconds: 40 },
            {
                name: 'veg-doogle',
                when: v => raw(v) > 0 && toldCook(v) && needVeg(v, wantFycie(v)) && wantFycie(v) === 'Doogle leaves',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Fycie$', option: '^talk', at: FYCIE },
            {
                name: 'fycie-flavour',
                when: v => raw(v) > 0 && toldCook(v) && wantFycie(v) === null && v.last?.phase !== 'fycie-flavour',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Bugs$', option: '^talk', at: BUGS },
            {
                name: 'bugs-flavour',
                when: v =>
                    raw(v) > 0 &&
                    toldCook(v) &&
                    wantBugs(v) === null &&
                    wantFycie(v) !== null &&
                    v.last?.phase !== 'bugs-flavour',
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { ...rantz },
            { name: 'show-chompy', when: v => started(v) && raw(v) > 0 && !toldCook(v), maxFails: 3 },
        ),
        // --- the hunt ---
        // plucking leaves the Raw chompy on the ground
        phase(
            pickup,
            { area: { x: 2630, z: 2964, radius: 16 }, items: [{ item: 'Raw chompy', count: 1 }], maxWaitSeconds: 20 },
            {
                name: 'take-chompy',
                when: v => started(v) && raw(v) === 0 && v.state.groundItems.some(g => /^raw chompy$/i.test(g.name)),
                maxFails: 3,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Chompy bird$', option: '^Pluck$' },
            {
                name: 'pluck',
                when: v => started(v) && raw(v) === 0 && deadChompy(v).length > 0,
                maxFails: 3,
                onFail: 'continue',
            },
        ),
        // the view lags a few seconds behind the kill: let the corpse show before leaving
        phase(
            pickup,
            { area: { x: 2630, z: 2966, radius: 8 }, items: [{ item: 'Cannonball', count: 1 }], maxWaitSeconds: 5 },
            {
                name: 'settle-shoot',
                when: v => v.last?.phase === 'shoot' && aliveChompy(v).length === 0 && deadChompy(v).length === 0,
                maxFails: 60,
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Chompy bird',
                skill: 'Ranged',
                weapon: 'Ogre bow',
                ammo: 'Ogre arrow',
                loot: ['Ogre arrow'],
                area: { x: 2635, z: 2966, radius: 10 },
                food: ['Swordfish'],
                respawnWaitTicks: 120,
            },
            {
                name: 'shoot',
                when: v =>
                    hunting(v) &&
                    bow(v) > 0 &&
                    arrows(v) > 0 &&
                    (aliveChompy(v).length > 0 || bait(v).length > 0 || placedNow(v)),
                until: v => deadChompy(v).length > 0,
                maxFails: 8,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...rantz, choices: ['^Come on, let me have a go', '^I.m actually quite strong'] },
            { name: 'get-bow', when: v => hunting(v) && bow(v) === 0 && missed(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Bloated toad$',
                option: '^Drop$',
                opIndex: 1,
                allowDestructiveOption: true,
                expect: 'carefully place the bloated toad',
                at: { x: 2634, z: 2967, tolerance: 2 },
            },
            {
                name: 'place-toad',
                when: v =>
                    hunting(v) &&
                    toads(v) > 0 &&
                    bait(v).length === 0 &&
                    v.last?.phase !== 'place-toad' &&
                    ((bow(v) > 0 && arrows(v) > 0) || (shown(v) && !missed(v))),
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        // before the bow: the placed bait needs time for a chompy, and for Rantz to miss it
        phase(
            pickup,
            { area: { x: 2635, z: 2966, radius: 6 }, items: [{ item: 'Cannonball', count: 1 }], maxWaitSeconds: 40 },
            {
                name: 'wait-bait',
                when: v => hunting(v) && bow(v) === 0 && !missed(v) && (bait(v).length > 0 || placedNow(v)),
                maxFails: 60,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...rantz },
            { name: 'show-toad', when: v => hunting(v) && toads(v) > 0 && !shown(v) && bow(v) === 0, maxFails: 3 },
        ),
        // toads and bellows
        phase(
            interact,
            {
                target: 'npc',
                name: '^Swamp toad$',
                use: { item: '^Ogre bellows \\(\\d\\)$' },
                at: { x: 2596, z: 2966, tolerance: 2 },
            },
            {
                name: 'catch-toad',
                when: v => hunting(v) && loaded(v) > 0 && toads(v) < 3 && bait(v).length === 0,
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Swamp bubbles$',
                use: { item: '^Ogre bellows$' },
                expect: 'collect some gas',
                at: { x: 2597, z: 2965, tolerance: 2 },
            },
            {
                name: 'fill-bellows',
                when: v =>
                    hunting(v) && emptyBellows(v) > 0 && loaded(v) === 0 && toads(v) === 0 && bait(v).length === 0,
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        // --- the chest in the cave ---
        phase(
            talk,
            { ...rantz, choices: ['^How do we make the chompys come', '^Ok, thanks'] },
            {
                name: 'ask-kids',
                when: v => started(v) && gave(v) && bellows(v) === 0 && heard(v, /ask permission before opening/i),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Unlocked Ogre chest$', option: '^Search$', at: CHEST },
            {
                name: 'search-chest',
                when: v => chestStage(v) && searchReady(v) && v.last?.phase !== 'search-chest',
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        // the opened chest lists Search a few seconds late
        phase(
            pickup,
            { area: { x: 2637, z: 9396, radius: 3 }, items: [{ item: 'Cannonball', count: 1 }], maxWaitSeconds: 8 },
            {
                name: 'wait-chest',
                when: v =>
                    chestStage(v) &&
                    (!searchReady(v) || v.last?.phase === 'search-chest') &&
                    !strained(v) &&
                    ((liftedLast(v) && !lockedNear(v)) ||
                        v.last?.phase === 'unlock-chest' ||
                        v.last?.phase === 'search-chest'),
                maxFails: 60,
                onFail: 'continue',
            },
        ),
        // a failed lift changes nothing the idle rail sees: step aside before the next try
        phase(
            travel,
            { to: { x: 2640, z: 9395 }, tolerance: 1 },
            {
                name: 'nudge-chest',
                when: v =>
                    chestStage(v) &&
                    lockedNear(v) &&
                    strained(v) &&
                    v.last?.phase !== 'nudge-chest' &&
                    v.last?.phase !== 'nudge-chest-b' &&
                    px(v) <= 2638,
                maxFails: 3,
                onFail: 'continue',
            },
        ),
        phase(
            travel,
            { to: { x: 2635, z: 9396 }, tolerance: 1 },
            {
                name: 'nudge-chest-b',
                when: v =>
                    chestStage(v) &&
                    lockedNear(v) &&
                    strained(v) &&
                    v.last?.phase !== 'nudge-chest' &&
                    v.last?.phase !== 'nudge-chest-b' &&
                    px(v) > 2638,
                maxFails: 3,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Locked Ogre chest$', option: '^Unlock$', at: CHEST },
            {
                name: 'unlock-chest',
                when: v =>
                    chestStage(v) &&
                    (lockedNear(v) || pz(v) < 9000) &&
                    !heard(v, /ask permission before opening/i) &&
                    v.last?.phase !== 'unlock-chest' &&
                    (!strained(v) || v.last?.phase === 'nudge-chest' || v.last?.phase === 'nudge-chest-b'),
                maxFails: 8,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...rantz, choices: ['^How do we make the chompys come', '^Ok, thanks'] },
            { name: 'give-arrows', when: v => early(v) && arrows(v) >= 12, maxFails: 3 },
        ),
        // --- the arrows ---
        phase(
            items,
            { combine: { use: '^Wolfbone arrowtips$', on: '^Flighted ogre arrow$', product: '^Ogre arrow$' } },
            { name: 'make-arrows', when: v => mayMake(v) && flights(v) > 0 && tips(v) > 0, maxFails: 3 },
        ),
        phase(
            items,
            { combine: { use: '^Feather$', on: '^Ogre arrow shaft$', product: '^Flighted ogre arrow$' } },
            { name: 'feather-shafts', when: v => mayMake(v) && shafts(v) > 0 && feathers(v) >= 4, maxFails: 3 },
        ),
        phase(
            items,
            { combine: { use: '^Chisel$', on: '^Wolf bones$', product: '^Wolfbone arrowtips$' } },
            { name: 'chisel-bones', when: v => early(v) && bones(v) > 0 && n(v, 'Chisel') > 0, maxFails: 3 },
        ),
        phase(
            items,
            { combine: { use: '^Knife$', on: '^Achey tree logs$', product: '^Ogre arrow shaft$' } },
            { name: 'cut-logs', when: v => mayMake(v) && logs(v) > 0 && n(v, 'Knife') > 0, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Achey Tree$',
                option: '^Chop',
                expect: 'you get some',
                at: { x: 2626, z: 2974, tolerance: 4 },
            },
            {
                name: 'chop-achey',
                when: v =>
                    (early(v) || (bow(v) > 0 && raw(v) === 0 && arrows(v) < 6)) &&
                    logs(v) === 0 &&
                    shaftSide(v) < (early(v) ? 12 : 8) &&
                    n(v, 'Knife') > 0,
                maxFails: 4,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { npc: '^Bugs$', option: '^talk', at: BUGS, choices: ['^Ok, I.ll give you 10'] },
            { name: 'bugs-tools', when: v => early(v) && (n(v, 'Knife') === 0 || n(v, 'Chisel') === 0), maxFails: 3 },
        ),
        phase(
            talk,
            { ...rantz, choices: ['^Ok, I.ll make you some'] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});
