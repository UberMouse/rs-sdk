// tools/places.ts: the listing line format, pinned on a bank and on a name several sites share.
import { describe, expect, test } from 'bun:test';
import { places } from '../../lib/places';
import { formatPlaces } from '../../tools/places';

describe('formatPlaces', () => {
    test('a bank is its name, stand and display name', () => {
        expect(formatPlaces(places(), 'bank', 'al-kharid')).toEqual(['bank:al-kharid-bank  (3269,3167,0)  Al Kharid']);
    });

    test('an ambiguous name carries the near text that picks each site', () => {
        expect(formatPlaces(places(), 'anvil', 'asgarnia').slice(0, 2)).toEqual([
            'anvil:asgarnia  near { x: 2918, z: 3572 }  (2918,3572,0)  Asgarnia anvil',
            'anvil:asgarnia  near { x: 2951, z: 3452 }  (2951,3452,0)  Asgarnia anvil',
        ]);
    });

    test('the near hint does not depend on the text filter hiding sibling sites', () => {
        expect(formatPlaces(places(), undefined, 'asgarnia anvil').every(l => l.includes('near'))).toBe(true);
    });

    test('kind lists all 25 banks', () => {
        expect(formatPlaces(places(), 'bank')).toHaveLength(25);
    });
});
