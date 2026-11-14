// tools/places.ts: the listing line format, on a hand-built fixture, plus one smoke test on the real index.
import { describe, expect, test } from 'bun:test';
import { type Place, places } from '../../lib/places';
import { formatPlaces } from '../../tools/places';

const site = (id: string, kind: string, name: string, x: number, z: number, level = 0): Place => ({
    id,
    kind,
    name,
    stand: { x, z, level },
    at: () => ({ x, z }),
    area: radius => ({ x, z, radius }),
});

const FIXTURE = [
    site('bank:foo-bank', 'bank', 'Foo', 10, 20),
    site('anvil:bar', 'anvil', 'Bar anvil', 30, 40),
    site('anvil:bar', 'anvil', 'Bar anvil', 50, 60),
    site('range:up', 'range', 'Up range', 7, 8, 2),
];

describe('formatPlaces', () => {
    test('a unique name is its id, stand and display name; the level is the third stand number', () => {
        expect(formatPlaces(FIXTURE, 'bank')).toEqual(['bank:foo-bank  (10,20,0)  Foo']);
        expect(formatPlaces(FIXTURE, 'range')).toEqual(['range:up  (7,8,2)  Up range']);
    });

    test('a name several sites share carries the near text that picks each site', () => {
        expect(formatPlaces(FIXTURE, 'anvil')).toEqual([
            'anvil:bar  near { x: 30, z: 40 }  (30,40,0)  Bar anvil',
            'anvil:bar  near { x: 50, z: 60 }  (50,60,0)  Bar anvil',
        ]);
    });

    test('the text filter matches id or display name, ignoring case', () => {
        expect(formatPlaces(FIXTURE, undefined, 'FOO')).toHaveLength(1);
        expect(formatPlaces(FIXTURE, undefined, 'up range')).toHaveLength(1);
    });

    test('the near hint does not depend on the text filter hiding sibling sites', () => {
        const byName = formatPlaces(FIXTURE, undefined, 'bar anvil');
        expect(byName.length).toBeGreaterThan(1);
        expect(byName.every(l => l.includes('near'))).toBe(true);
        // a filter that keeps only one of the two sites still hints
        const one = [FIXTURE[1]!, FIXTURE[2]!].map(p => ({
            ...p,
            name: p === FIXTURE[1] ? 'Bar anvil north' : 'Bar anvil south',
        }));
        const filtered = formatPlaces(one, undefined, 'north');
        expect(filtered).toHaveLength(1);
        expect(filtered[0]).toContain('near');
    });

    test('real index: kind lists every place of that kind, none of them ambiguous', () => {
        const lines = formatPlaces(places(), 'bank');
        expect(lines).toHaveLength(places('bank').length);
        expect(lines.some(l => l.includes('near'))).toBe(false);
    });
});
