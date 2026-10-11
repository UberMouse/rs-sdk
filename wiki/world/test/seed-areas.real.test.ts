import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { areaResolver } from '../area-resolve';
import { MAPS } from '../paths';
import { parseLabels, seedAreas } from '../tools/seed-areas';

describe('seed from the real map labels', () => {
    const labels = parseLabels(readFileSync(join(MAPS, 'labels.txt'), 'utf8'));

    test('every label becomes an area, and the draft passes the resolver validation', () => {
        const areas = seedAreas(labels);
        expect(areas.length).toBe(labels.length);
        expect(() => areaResolver(areas)).not.toThrow();
    });
});
