import { describe, expect, test } from 'bun:test';
import { areaResolver } from '../area-resolve';
import { kebab, parseLabels, renderAreas, seedAreas } from '../tools/seed-areas';

const LABELS = parseLabels(
    [
        '=Kingdom Of/Misthalin,3217,3321,2',
        '=Wilderness,3144,3773,2',
        '=Crandor,2839,3271,2',
        '=Lumbridge,3239,3233,1',
        '=Draynor/Village,3120,3267,1',
        '=Ruins,2966,3697,0',
        '=Ruins,3164,3735,0',
        '=Entrana,2850,3379,2',
        '=Trollheim,2892,3678,0',
    ].join('\n'),
);

describe('parseLabels', () => {
    test('a / in a name is a space', () =>
        expect(LABELS[0]).toEqual({ name: 'Kingdom Of Misthalin', x: 3217, z: 3321, type: 2 }));

    test('only = lines are labels, as the map packer reads them; a malformed one throws', () => {
        expect(parseLabels('// note\n=Zoo,2614,3273,0\n')).toEqual([{ name: 'Zoo', x: 2614, z: 3273, type: 0 }]);
        expect(() => parseLabels('=Zoo,2614,3273\n')).toThrow(/=Zoo/);
    });
});

describe('seedAreas', () => {
    const areas = seedAreas(LABELS);
    const get = (id: string) => areas.find(a => a.id === id);

    test('ids are kebab-case without apostrophes', () => expect(kebab("Cooks' Guild")).toBe('cooks-guild'));

    test('a repeated name gets a numbered id in label order', () => {
        expect(get('ruins')?.rects[0]).toMatchObject({ x1: 2954, z1: 3685 });
        expect(get('ruins-2')?.rects[0]).toMatchObject({ x1: 3152, z1: 3723 });
    });

    test('towns get 48x48 and places 24x24 around their label', () => {
        expect(get('lumbridge')?.rects).toEqual([{ x1: 3215, z1: 3209, x2: 3262, z2: 3256 }]);
        expect(get('ruins')?.rects).toEqual([{ x1: 2954, z1: 3685, x2: 2977, z2: 3708 }]);
    });

    test('a label goes to the nearest region on its own side of the Wilderness border', () => {
        expect(get('lumbridge')?.parent).toBe('kingdom-of-misthalin');
        expect(get('ruins')?.parent).toBe('wilderness');
        // The Wilderness label is the nearest to Trollheim, which is outside the Wilderness.
        expect(get('trollheim')?.parent).toBe('entrana');
    });

    test('a region with no children gets a square around its label', () =>
        expect(get('crandor')?.rects).toEqual([{ x1: 2807, z1: 3239, x2: 2870, z2: 3302 }]));

    test('the draft passes the resolver validation', () => expect(() => areaResolver(areas)).not.toThrow());

    test('parent overrides: another region, or none', () => {
        const fixed = seedAreas(LABELS, { lumbridge: 'crandor', trollheim: null });
        expect(fixed.find(a => a.id === 'lumbridge')?.parent).toBe('crandor');
        expect(fixed.find(a => a.id === 'trollheim')?.parent).toBeUndefined();
        expect(fixed.at(-1)?.id).toBe('trollheim');
        expect(() => areaResolver(fixed)).not.toThrow();
        expect(() => seedAreas(LABELS, { lumbridge: 'draynor-village' })).toThrow(/no region/);
        expect(() => seedAreas(LABELS, { lumbrige: 'crandor' })).toThrow(/lumbrige/);
    });

    test('regions come first, each followed by its children', () =>
        expect(areas.map(a => a.id)).toEqual([
            'crandor',
            'entrana',
            'trollheim',
            'kingdom-of-misthalin',
            'draynor-village',
            'lumbridge',
            'wilderness',
            'ruins',
            'ruins-2',
        ]));

    test('renders an AREAS module', () => {
        const src = renderAreas(areas.slice(0, 1));
        expect(src).toContain('export const AREAS: readonly Area[] = [');
        expect(src).toContain('{"id":"crandor","name":"Crandor","rects":[{"x1":2807,"z1":3239,"x2":2870,"z2":3302}]},');
    });
});
