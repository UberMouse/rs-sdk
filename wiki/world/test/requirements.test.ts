import { describe, expect, test } from 'bun:test';
import {
    formatRequirement,
    canonicalSet,
    dominates,
    joinUse,
    minimalSets,
    questFacts,
    parseRequirement,
    requirementSet,
    subsetOf,
    type Requirement,
} from '../requirements';

// One of each form, with its canonical string.
const FORMS: [Requirement, string][] = [
    [{ kind: 'quest', quest: 'zanaris' }, 'quest:zanaris'],
    [{ kind: 'quest', quest: 'dragon', stage: 2 }, 'quest:dragon>=2'],
    [{ kind: 'skill', skill: 'ranged', level: 40 }, 'skill:ranged:40'],
    [{ kind: 'item', obj: 'dramen_staff', how: 'worn' }, 'item:dramen_staff:worn'],
    [{ kind: 'item', obj: 'shiloshipticket', how: 'held' }, 'item:shiloshipticket:held'],
    [{ kind: 'category', category: 'weapon_axe', how: 'held' }, 'category:weapon_axe:held'],
    [{ kind: 'category', category: 'mm_greegree', how: 'worn' }, 'category:mm_greegree:worn'],
    [{ kind: 'questpoints', n: 32 }, 'questpoints:32'],
    [{ kind: 'coins', n: 10 }, 'coins:10'],
    [{ kind: 'consume', obj: 'shantay_pass', n: 1 }, 'consume:shantay_pass:1'],
    [{ kind: 'members' }, 'members'],
    [{ kind: 'loadout', rule: 'entrana' }, 'loadout:entrana'],
    [{ kind: 'other', text: '`coordy(coord) = 3` (ned.rs2:4)' }, 'other:`coordy(coord) = 3` (ned.rs2:4)'],
];

describe('requirement strings', () => {
    test.each(FORMS)('%o is %s, and parses back', (r, s) => {
        expect(formatRequirement(r)).toBe(s);
        expect(parseRequirement(s)).toEqual(r);
    });

    test.each([
        'quest:',
        'quest:Zanaris',
        'quest:dragon>=',
        'quest:dragon>2',
        'skill:ranged',
        'item:dramen_staff:wielded',
        'category:weapon_axe',
        'category:Weapon_axe:held',
        'questpoints:',
        'questpoints:032',
        'coins:-1',
        'coins:010',
        'coins:ten',
        'consume:shantay_pass',
        'members:yes',
        'loadout:',
        'other:',
        'other:   ',
        'toll:10',
    ])('`%s` is refused', s => expect(() => parseRequirement(s)).toThrow(/is not a requirement/));

    test('a malformed requirement is refused when formatted', () => {
        expect(() => formatRequirement({ kind: 'item', obj: 'Dramen staff', how: 'worn' })).toThrow(/is not an id/);
        expect(() => formatRequirement({ kind: 'coins', n: 1.5 })).toThrow(/not a whole number/);
        expect(() => formatRequirement({ kind: 'other', text: ' ' })).toThrow(/empty/);
    });
});

describe('requirement sets', () => {
    test('a set is canonical strings, each once, in code-unit order', () => {
        const set = requirementSet(['members', { kind: 'coins', n: 9 }, 'coins:10', 'loadout:entrana', 'members']);
        expect(set).toEqual(['coins:10', 'coins:9', 'loadout:entrana', 'members']);
        // The same set however it was written.
        expect(requirementSet(['loadout:entrana', 'coins:9', 'members', 'coins:10'])).toEqual(set);
        expect(requirementSet(['questpoints:32', 'skill:mining:52', 'category:weapon_pickaxe:held'])).toEqual([
            'category:weapon_pickaxe:held',
            'questpoints:32',
            'skill:mining:52',
        ]);
    });

    test('a set with a string in no form is refused', () =>
        expect(() => requirementSet(['members', 'toll:10'])).toThrow(/toll:10/));

    test('subsetOf compares canonical sets', () => {
        expect(subsetOf([], ['members'])).toBe(true);
        expect(subsetOf(['members'], ['coins:30', 'members'])).toBe(true);
        expect(subsetOf(['coins:30', 'members'], ['members'])).toBe(false);
    });

    test('joinUse joins each walk set with each use set, the minimal ones; a use asking nothing keeps the walk', () => {
        const walk = [['coins:30'], ['quest:zanaris']];
        expect(joinUse(walk, [[]])).toEqual(walk);
        expect(joinUse(walk, [['skill:ranged:40'], ['coins:20']])).toEqual([
            ['coins:50'],
            ['coins:20', 'quest:zanaris'],
            ['coins:30', 'skill:ranged:40'],
            ['quest:zanaris', 'skill:ranged:40'],
        ]);
    });

    test('minimalSets drops a set that asks more than another, and duplicates, smallest first', () =>
        expect(
            minimalSets([
                ['quest:zombiequeen', 'coins:45'],
                ['consume:shiloshipticket:1', 'quest:zombiequeen'],
                ['quest:zombiequeen', 'consume:shiloshipticket:1'],
                ['quest:zombiequeen', 'coins:45', 'item:karamja_rum:held'],
            ]),
        ).toEqual([
            ['coins:45', 'quest:zombiequeen'],
            ['consume:shiloshipticket:1', 'quest:zombiequeen'],
        ]));

    const facts = questFacts([
        { id: 'pp', complete: 60 },
        { id: 'arrav', complete: 4, or: [{}] },
    ]);

    test("canonicalSet: a quest's highest stage, a skill's highest level, the most quest points, coins and consume summed", () => {
        expect(
            canonicalSet([
                'quest:pp>=5',
                'quest:pp>=61',
                'quest:pp>=8',
                'skill:agility:5',
                'skill:agility:15',
                'skill:mining:1',
                'questpoints:3',
                'questpoints:32',
                'consume:rope:1',
                'consume:rope:2',
                'consume:plank:1',
                'coins:10',
                'coins:30',
                'members',
            ]),
        ).toEqual([
            'coins:40',
            'consume:plank:1',
            'consume:rope:3',
            'members',
            'quest:pp>=61',
            'questpoints:32',
            'skill:agility:15',
            'skill:mining:1',
        ]);
    });

    test('canonicalSet with the quest table: completion and the stages it meets or that meet it', () => {
        expect(canonicalSet(['quest:pp', 'quest:pp>=5'], facts)).toEqual(['quest:pp']);
        expect(canonicalSet(['quest:pp>=60'], facts)).toEqual(['quest:pp']);
        expect(canonicalSet(['quest:pp', 'quest:pp>=61'], facts)).toEqual(['quest:pp>=61']);
        // Without the table, nothing is known of completion.
        expect(canonicalSet(['quest:pp', 'quest:pp>=5'])).toEqual(['quest:pp', 'quest:pp>=5']);
        // A quest another varp shows done: completion does not meet a stage of the first varp.
        expect(canonicalSet(['quest:arrav', 'quest:arrav>=3'], facts)).toEqual(['quest:arrav', 'quest:arrav>=3']);
        expect(canonicalSet(['quest:arrav>=4'], facts)).toEqual(['quest:arrav>=4']);
    });

    test('dominates: each requirement of the one implied by one of the other', () => {
        expect(dominates(['quest:pp>=5'], ['quest:pp>=8'])).toBe(true);
        expect(dominates(['quest:pp>=8'], ['quest:pp>=5'])).toBe(false);
        expect(dominates(['skill:agility:5', 'coins:10'], ['coins:30', 'skill:agility:15', 'quest:x'])).toBe(true);
        expect(dominates(['coins:30'], ['coins:10', 'quest:x'])).toBe(false);
        expect(dominates(['consume:rope:1'], ['consume:rope:2'])).toBe(true);
        expect(dominates(['consume:rope:1'], ['consume:plank:2'])).toBe(false);
        expect(dominates(['item:x:worn'], ['item:x:worn', 'members'])).toBe(true);
        expect(dominates(['quest:pp>=5'], ['quest:pp'])).toBe(false);
        expect(dominates(['quest:pp>=5'], ['quest:pp'], facts)).toBe(true);
        expect(dominates(['quest:pp'], ['quest:pp>=61'], facts)).toBe(true);
        expect(dominates(['quest:arrav>=3'], ['quest:arrav'], facts)).toBe(false);
    });

    test('minimalSets keeps the sets no other dominates, merged', () =>
        expect(
            minimalSets([
                ['quest:pp>=5', 'quest:pp>=8', 'quest:routequest>=97'],
                ['quest:pp>=8', 'quest:routequest>=55'],
                ['coins:10', 'coins:30'],
                ['coins:50'],
                ['skill:agility:10', 'quest:x'],
            ]),
        ).toEqual([['coins:40'], ['quest:pp>=8', 'quest:routequest>=55'], ['quest:x', 'skill:agility:10']]));

    test('the empty set beats every other', () =>
        expect(minimalSets([['quest:hunt>=2', 'coins:30'], ['coins:30'], ['members'], []])).toEqual([[]]));
});
