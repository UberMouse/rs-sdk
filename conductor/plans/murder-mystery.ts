// Murder Mystery (server/content/scripts/quests/quest_murder, quest id murder, varps murderquest / murdersus /
// murder_evidence / murder_poisonproof_progress). The murderer is rolled at the guard's start (%murdersus 1-6:
// Anna, Bob, Carol, David, Elizabeth, Frank) and no varp is readable, so the plan reads it from the game:
//  - the thread from the smashed window (2747,3577) is red (Bob, Carol), green (Anna, David) or blue (Elizabeth,
//    Frank): its obj id (1808/1809/1810) names the pair of suspects;
//  - both of the pair's barrel items are dusted with flour and lifted with flypaper (Pot of flour / Flypaper on the
//    item, then the print on the dagger's print): the Killers' print (id 1815) appears for the match; a mismatch
//    destroys the checked print and a match keeps it (so the murderer is read from the pack: Killers' print held,
//    A's print still held -> A, else B);
//  - the poison salesman (Seers' Village) is asked who got poison, then the murderer is asked "Why'd you buy
//    poison" (only the murderer's answer moves the poison progress) and the murderer's own place is investigated
//    (compost heap Anna, beehive Bob, drain Carol, spiders' nest David upstairs, fountain Elizabeth, crest Frank);
//  - the guard is told "I know who did it" with all three proofs: the quest ends.
// Barrels: Anna (2733,3575) and Bob (2733,3578) on the ground floor, David (2733,3578), Carol (2733,3581), Frank
// (2747,3577) and Elizabeth (2747,3581) upstairs. Dagger (2746,3578) is a ground item in the study; flour barrel
// (2735,3582); flypaper in the sacks (2731,3582). The flour barrel and the sacks and barrels all need the quest started.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'murder';
const has = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);

const POT = 1931;
const POT_FLOUR = 1933;
const PAPER = 1811;
const DAGGER = 1813;
const DAGGER_DUST = 1814;
const KILLERS_PRINT = 1815;
const DAGGER_PRINT = 1822;
const THREAD = { red: 1808, green: 1809, blue: 1810 } as const;

interface Suspect {
    key: string;
    name: string;
    colour: keyof typeof THREAD;
    slot: 'A' | 'B';
    /** The barrel (Search) holding the silver item; the item's dusted form is id + 1. */
    barrel: { x: number; z: number; level: number; name: string };
    item: { id: number; name: string };
    print: number;
    /** Where the suspect stands (talk) and the place of their poison alibi (Investigate). */
    at: { x: number; z: number; level: number };
    spot: { name: string; x: number; z: number; level: number };
}

const SUSPECTS: Suspect[] = [
    {
        key: 'bob',
        name: 'Bob',
        colour: 'red',
        slot: 'A',
        barrel: { x: 2733, z: 3578, level: 0, name: "^Bobs' barrel$" },
        item: { id: 1798, name: '^Silver cup$' },
        print: 1817,
        at: { x: 2747, z: 3560, level: 0 },
        spot: { name: 'beehive', x: 2730, z: 3559, level: 0 },
    },
    {
        key: 'carol',
        name: 'Carol',
        colour: 'red',
        slot: 'B',
        barrel: { x: 2733, z: 3581, level: 1, name: "^Carols' barrel$" },
        item: { id: 1800, name: '^Silver bottle$' },
        print: 1818,
        at: { x: 2734, z: 3581, level: 1 },
        spot: { name: 'drain', x: 2736, z: 3573, level: 0 },
    },
    {
        key: 'anna',
        name: 'Anna',
        colour: 'green',
        slot: 'A',
        barrel: { x: 2733, z: 3575, level: 0, name: "^Annas' barrel$" },
        item: { id: 1796, name: '^Silver necklace$' },
        print: 1816,
        at: { x: 2734, z: 3575, level: 0 },
        spot: { name: 'compost heap', x: 2730, z: 3572, level: 0 },
    },
    {
        key: 'david',
        name: 'David',
        colour: 'green',
        slot: 'B',
        barrel: { x: 2733, z: 3578, level: 1, name: "^Davids' barrel$" },
        item: { id: 1802, name: '^Silver book$' },
        print: 1819,
        at: { x: 2739, z: 3581, level: 0 },
        spot: { name: "spiders' nest", x: 2740, z: 3574, level: 1 },
    },
    {
        key: 'elizabeth',
        name: 'Elizabeth',
        colour: 'blue',
        slot: 'A',
        barrel: { x: 2747, z: 3581, level: 1, name: "^Elizabeths' barrel$" },
        item: { id: 1804, name: '^Silver needle$' },
        print: 1820,
        at: { x: 2746, z: 3581, level: 1 },
        spot: { name: 'fountain', x: 2747, z: 3563, level: 0 },
    },
    {
        key: 'frank',
        name: 'Frank',
        colour: 'blue',
        slot: 'B',
        barrel: { x: 2747, z: 3577, level: 1, name: "^Franks' barrel$" },
        item: { id: 1806, name: '^Silver pot$' },
        print: 1821,
        at: { x: 2742, z: 3577, level: 0 },
        spot: { name: 'crest', x: 2746, z: 3573, level: 0 },
    },
];

const threadColour = (v: PlanView) => (Object.keys(THREAD) as (keyof typeof THREAD)[]).find(c => has(v, THREAD[c]));
const inPair = (v: PlanView, s: Suspect) => threadColour(v) === s.colour;
const pairOf = (v: PlanView, slot: 'A' | 'B') => SUSPECTS.find(s => s.colour === threadColour(v) && s.slot === slot);
const checkedA = (v: PlanView) => SUSPECTS.some(s => s.slot === 'A' && v.runs(`check-${s.key}`) > 0);

/** The murderer, read from the pack once the Killers' print is held (see the header); null before. */
function murderer(v: PlanView): Suspect | null {
    const a = pairOf(v, 'A');
    const b = pairOf(v, 'B');
    if (!a || !b || !has(v, KILLERS_PRINT)) return null;
    return has(v, a.print) ? a : b;
}

const dustPending = (v: PlanView, s: Suspect) =>
    inPair(v, s) && has(v, s.item.id) && !has(v, s.print) && !has(v, KILLERS_PRINT) && (s.slot === 'B' || !checkedA(v));
const daggerPending = (v: PlanView) => has(v, DAGGER) && !has(v, DAGGER_PRINT) && !has(v, KILLERS_PRINT);
const anyDust = (v: PlanView) => daggerPending(v) || SUSPECTS.some(s => dustPending(v, s));
const anyLift = (v: PlanView) => has(v, DAGGER_DUST) || SUSPECTS.some(s => inPair(v, s) && has(v, s.item.id + 1));
const barrelNeeded = (v: PlanView, s: Suspect) =>
    inPair(v, s) &&
    !has(v, s.item.id) &&
    !has(v, s.item.id + 1) &&
    !has(v, s.print) &&
    !has(v, KILLERS_PRINT) &&
    (s.slot === 'B' || !checkedA(v));
const started = (v: PlanView) => v.quest(ID) === 'started';
const searched = (v: PlanView) => SUSPECTS.some(s => v.runs(`loc-${s.key}`) > 0);

const R = { onFail: 'continue', maxFails: 6 } as const;
const guard = { npc: '^Guard$', at: { x: 2741, z: 3562, tolerance: 3 } };

const perSuspect = SUSPECTS.flatMap(s => [
    // 5: the murderer's own place, after they were asked about the poison
    phase(
        interact,
        {
            target: 'loc',
            name: s.spot.name === 'crest' ? 'family crest' : s.spot.name,
            option: '^Investigate$',
            tile: { x: s.spot.x, z: s.spot.z, level: s.spot.level },
            at: { x: s.spot.x, z: s.spot.z, level: s.spot.level, tolerance: 3 },
        },
        {
            name: `loc-${s.key}`,
            when: v => murderer(v) === s && v.runs(`ask-${s.key}`) > 0 && v.runs(`loc-${s.key}`) === 0,
            maxFails: 4,
        },
    ),
    phase(
        talk,
        { npc: `^${s.name}$`, at: { ...s.at, tolerance: 3 }, choices: ["Why'd you buy poison"] },
        {
            name: `ask-${s.key}`,
            when: v => murderer(v) === s && v.runs('salesman') > 0 && v.runs(`ask-${s.key}`) === 0,
            maxFails: 4,
        },
    ),
]);

const checks = SUSPECTS.map(s =>
    phase(
        items,
        { combine: { use: { name: 'print$', id: s.print }, on: { name: 'print$', id: DAGGER_PRINT } } },
        {
            name: `check-${s.key}`,
            when: v => {
                if (!inPair(v, s) || !has(v, s.print) || !has(v, DAGGER_PRINT)) return false;
                if (s.slot === 'A') return !checkedA(v) && has(v, pairOf(v, 'B')?.print ?? -1);
                return checkedA(v) && v.runs(`check-${s.key}`) === 0;
            },
            maxFails: 4,
        },
    ),
);

const lifts = [
    phase(
        items,
        {
            combine: {
                use: { name: '^Flypaper$', id: PAPER },
                on: { name: '^Criminals. dagger$', id: DAGGER_DUST },
            },
        },
        { name: 'lift-dagger', when: v => has(v, DAGGER_DUST) && has(v, PAPER), ...R },
    ),
    ...SUSPECTS.map(s =>
        phase(
            items,
            { combine: { use: { name: '^Flypaper$', id: PAPER }, on: { name: s.item.name, id: s.item.id + 1 } } },
            { name: `lift-${s.key}`, when: v => inPair(v, s) && has(v, s.item.id + 1) && has(v, PAPER), ...R },
        ),
    ),
];

const dusts = [
    phase(
        items,
        {
            combine: {
                use: { name: '^Pot of flour$', id: POT_FLOUR },
                on: { name: '^Criminals. dagger$', id: DAGGER },
            },
        },
        { name: 'dust-dagger', when: v => has(v, POT_FLOUR) && daggerPending(v), ...R },
    ),
    ...SUSPECTS.map(s =>
        phase(
            items,
            { combine: { use: { name: '^Pot of flour$', id: POT_FLOUR }, on: { name: s.item.name, id: s.item.id } } },
            { name: `dust-${s.key}`, when: v => has(v, POT_FLOUR) && dustPending(v, s), ...R },
        ),
    ),
];

const barrels = SUSPECTS.map(s =>
    phase(
        interact,
        {
            target: 'loc',
            name: s.barrel.name,
            option: '^Search$',
            tile: { x: s.barrel.x, z: s.barrel.z, level: s.barrel.level },
            at: { x: s.barrel.x, z: s.barrel.z, level: s.barrel.level, tolerance: 2 },
        },
        { name: `barrel-${s.key}`, when: v => barrelNeeded(v, s), ...R },
    ),
);

export default definePlan({
    name: 'murder-mystery',
    description:
        'Murder Mystery: guard, thread (colour names the suspect pair), dagger and two suspects dusted for prints to find the murderer, poison salesman, ask the murderer, investigate their poison place, guard.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            talk,
            { ...guard, choices: ['I know who did it'] },
            {
                name: 'accuse',
                when: v => started(v) && has(v, KILLERS_PRINT) && searched(v),
                maxFails: 4,
            },
        ),
        ...perSuspect,
        ...checks,
        ...lifts,
        ...dusts,
        phase(
            interact,
            {
                target: 'loc',
                name: '^Barrel of flour$',
                option: '^Take From$',
                tile: { x: 2735, z: 3582, level: 0 },
                at: { x: 2735, z: 3581, level: 0, tolerance: 2 },
            },
            { name: 'take-flour', when: v => has(v, POT) && !has(v, POT_FLOUR) && anyDust(v), ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Sacks$',
                option: '^Investigate$',
                choices: ['Yes, it might be useful'],
                at: { x: 2732, z: 3581, level: 0, tolerance: 2 },
            },
            { name: 'take-paper', when: v => !has(v, PAPER) && (anyDust(v) || anyLift(v)), ...R },
        ),
        ...barrels,
        phase(
            pickup,
            { area: { x: 2746, z: 3578, radius: 4, level: 0 }, items: [{ item: "Criminals' dagger", count: 1 }] },
            {
                name: 'dagger',
                when: v =>
                    started(v) &&
                    !has(v, DAGGER) &&
                    !has(v, DAGGER_DUST) &&
                    !has(v, DAGGER_PRINT) &&
                    !has(v, KILLERS_PRINT),
                ...R,
            },
        ),
        phase(
            talk,
            {
                npc: '^Poison Salesman$',
                at: { x: 2737, z: 3491, tolerance: 4 },
                choices: ['Who did you sell Poison to'],
            },
            {
                name: 'salesman',
                when: v => started(v) && v.runs('salesman') === 0 && threadColour(v) !== undefined,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: 'Smashed window',
                option: '^Investigate$',
                at: { x: 2747, z: 3576, level: 0, tolerance: 2 },
            },
            { name: 'thread', when: v => started(v) && threadColour(v) === undefined, ...R },
        ),
        phase(
            talk,
            { ...guard, choices: ["Sure, I'll help"] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});
