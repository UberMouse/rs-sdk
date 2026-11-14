import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { AreaSchema } from '../../lib/area';
import { BANKS } from '../../lib/banks';
import { nearestNames, PLACE_KINDS, place, places } from '../../lib/places';
import { AtSchema } from '../../lib/spot';
import { WORLD } from '../../lib/world-index';

const bank = (name: string) => BANKS.find(b => b.name === name)!;

describe('place: a unique name', () => {
    test('a bank stands where banks.ts puts it, its curated stand over the index one', () => {
        const p = place('bank:varrock-west-bank');
        expect(p).toMatchObject({ id: 'bank:varrock-west-bank', kind: 'bank', name: 'Varrock West' });
        expect(p.stand).toEqual(bank('Varrock West').stand);
        const site = WORLD.sites.find(s => s.id.startsWith('bank:varrock-west-bank:'))!;
        expect(p.stand).not.toEqual(site.stand);
        expect(place('bank:varrock-east-bank').stand).toEqual(bank('Varrock East').stand);
    });

    test('a bank banks.ts never picks on its own still resolves', () => {
        expect(bank('Draynor').auto).toBe(false);
        expect(place('bank:draynor-bank').stand).toEqual(bank('Draynor').stand);
    });

    test('a service other than a bank stands on its index stand, named by its area and kind', () => {
        const p = place('furnace:al-kharid');
        const site = WORLD.sites.find(s => s.id === 'furnace:al-kharid:0')!;
        expect(p).toMatchObject({ kind: 'furnace', name: 'Al Kharid furnace', stand: site.stand! });
    });

    test('every bank site has its own name', () => {
        const names = BANKS.map(b => b.id.replace(/:\d+$/, ''));
        const collide = names.filter((n, i) => names.indexOf(n) !== i);
        expect(collide).toEqual([]);
        for (const n of names) expect(() => place(n)).not.toThrow();
    });
});

describe('place: a name several sites share', () => {
    const varrock = WORLD.sites.filter(s => s.id.startsWith('range:varrock:')).map(s => s.stand!);

    test('without near it throws, listing each stand and asking for near', () => {
        expect(varrock.length).toBeGreaterThan(1);
        const msg = (() => {
            try {
                place('range:varrock');
            } catch (e) {
                return (e as Error).message;
            }
        })();
        expect(msg).toMatch(/pass near/);
        for (const s of varrock) expect(msg).toContain(`(${s.x},${s.z})`);
    });

    test('near picks the site whose stand is nearest, within 10 tiles', () => {
        expect(place('range:varrock', { near: { x: 3238, z: 3412 } }).stand).toEqual({ level: 0, x: 3237, z: 3410 });
        expect(place('range:varrock', { near: { x: 3221, z: 3389 } }).stand).toEqual({ level: 0, x: 3219, z: 3387 });
    });

    test('near more than 10 tiles from every stand throws', () => {
        expect(() => place('range:varrock', { near: { x: 3150, z: 3450 } })).toThrow(/more than 10/);
    });
});

describe('place: names it refuses', () => {
    test('an unknown name lists the nearest names of its kind', () => {
        expect(() => place('bank:varrock-bank')).toThrow(
            /^unknown place "bank:varrock-bank"; nearest names of kind bank: .*bank:varrock-east-bank/,
        );
    });

    test('nearest names: containing slugs first, then the longest shared prefix, ties by name, at most 5', () => {
        expect(nearestNames('bank', 'varrock')).toEqual([
            'bank:varrock-east-bank',
            'bank:varrock-west-bank',
            'bank:al-kharid-bank',
            'bank:ardougne-north-bank',
            'bank:ardougne-south-bank',
        ]);
        expect(nearestNames('bank', 'fala').slice(0, 2)).toEqual(['bank:falador-east-bank', 'bank:falador-west-bank']);
        expect(nearestNames('bank', 'fishing-guildd')[0]).toBe('bank:fishing-guild-bank');
    });

    test('a name with the ordinal is refused, saying to drop it', () => {
        expect(() => place('bank:varrock-east-bank:0')).toThrow(/drop the ordinal, "bank:varrock-east-bank"/);
    });

    test('a kind that is not a place kind is refused, naming the allowed ones', () => {
        expect(() => place('tree:lumbridge')).toThrow(
            /"tree" is not a place kind; one of bank, furnace, .*agility-course/,
        );
        expect(() => place('lumbridge')).toThrow(/not a place kind/);
    });
});

describe('Place.at and Place.area', () => {
    test('level only off the surface or when asked, tolerance only when given; both parse with the shared schemas', () => {
        const ground = place('furnace:al-kharid');
        const { x, z } = ground.stand;
        expect(ground.at()).toEqual({ x, z });
        expect(ground.at({ tolerance: 1, level: 0 })).toEqual({ x, z, level: 0, tolerance: 1 });
        expect(ground.area(6)).toEqual({ x, z, radius: 6 });
        const up = place('bank:legends-guild-bank');
        expect(up.at()).toEqual({ ...up.stand });
        expect(up.area(4)).toEqual({ ...up.stand, radius: 4 });
        for (const v of [ground.at(), ground.at({ tolerance: 1 }), up.at()])
            expect(() => AtSchema.parse(v)).not.toThrow();
        for (const v of [ground.area(6), up.area(4)]) expect(() => AreaSchema.parse(v)).not.toThrow();
    });

    test('each call returns a fresh object', () => {
        const p = place('furnace:al-kharid');
        const a = p.at();
        a.x = 0;
        expect(p.at().x).toBe(p.stand.x);
        expect(p.area(3)).not.toBe(p.area(3));
    });
});

describe('places', () => {
    test('one entry per site with a stand, sorted by name; an ambiguous name once per site', () => {
        const all = places();
        const sites = WORLD.sites.filter(s => (PLACE_KINDS as readonly string[]).includes(s.kind) && s.stand);
        expect(all.length).toBe(sites.length);
        const ids = all.map(p => p.id);
        expect(ids).toEqual(ids.toSorted());
        expect(places('range').filter(p => p.id === 'range:varrock').length).toBe(
            WORLD.sites.filter(s => s.id.startsWith('range:varrock:')).length,
        );
        expect(places('furnace').every(p => p.kind === 'furnace')).toBe(true);
    });

    test('a kind that is not a place kind is refused', () => {
        expect(() => places('tree')).toThrow(/not a place kind/);
    });
});

const ROOT = resolve(import.meta.dir, '../../..');
/** The modules a file's value imports load (type-only imports are erased). */
const graph = (file: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(file)) return seen;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gm))
        graph(resolve(dirname(file), `${m[1]}.ts`), seen);
    return seen;
};
const lib = (f: string) => join(ROOT, 'conductor/lib', f);

describe('importing places.ts', () => {
    test('loads no module beyond what the world index loads, and reads no file itself', () => {
        const world = graph(lib('world-index.ts'));
        const extra = [...graph(lib('places.ts'))].filter(f => !world.has(f)).map(f => relative(ROOT, f));
        expect(extra.toSorted()).toEqual([
            'conductor/lib/bank-sites.ts',
            'conductor/lib/places.ts',
            'wiki/world/site-key.ts',
        ]);
        for (const f of extra) expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/from '(node:)?fs'/);
    });
});
