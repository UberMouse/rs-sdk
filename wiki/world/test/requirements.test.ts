import { describe, expect, test } from 'bun:test';
import {
    formatRequirement,
    minimalSets,
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

    test('the empty set beats every other', () =>
        expect(minimalSets([['quest:hunt>=2', 'coins:30'], ['coins:30'], ['members'], []])).toEqual([[]]));
});
