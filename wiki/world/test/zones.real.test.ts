import { describe, expect, test } from 'bun:test';
import { readDbrows } from '../sources/dbrows';
import { isF2p, parseCoord, readZones, WILDERNESS_ZONES } from '../sources/zones';

describe('real zones', () => {
    test('the hardcoded wilderness boxes are the wilderness_zones dbrow', () => {
        const row = readDbrows().find(r => r.row === 'wilderness_zones');
        const boxes = (row?.data.coord_pair ?? []).map(([from, to]) => ({
            from: parseCoord(from!),
            to: parseCoord(to!),
        }));
        expect(boxes).toEqual([...WILDERNESS_ZONES]);
    });

    test('readZones reads both csvs; Lumbridge is f2p, Yanille (members land) is not', () => {
        const zones = readZones();
        expect(zones.multiway.size).toBeGreaterThan(0);
        expect(isF2p(zones, { level: 0, x: 3222, z: 3218 })).toBe(true);
        expect(isF2p(zones, { level: 0, x: 2600, z: 3100 })).toBe(false);
    });
});
