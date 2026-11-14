import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { place } from '../lib/places';

type Near = { x: number; z: number };
type Row = [name: string, near: Near | undefined, stand: { x: number; z: number; level: number }];

// Every place expression the promoted plans use. A rebuilt world index can move a stand a tile or two without
// any error at plan load, which moves the plan's area; this table is where that shows up.
const TABLE: Row[] = [
    ['bank:varrock-east-bank', undefined, { x: 3254, z: 3420, level: 0 }],
    ['bank:varrock-west-bank', undefined, { x: 3185, z: 3436, level: 0 }],
    ['bank:draynor-bank', undefined, { x: 3092, z: 3243, level: 0 }],
    ['bank:falador-east-bank', undefined, { x: 3013, z: 3355, level: 0 }],
    ['bank:falador-west-bank', undefined, { x: 2947, z: 3368, level: 0 }],
    ['bank:al-kharid-bank', undefined, { x: 3269, z: 3167, level: 0 }],
    ['bank:catherby-bank', undefined, { x: 2809, z: 3441, level: 0 }],
    ['bank:gnome-stronghold-bank', undefined, { x: 2445, z: 3425, level: 1 }],
    ['bank:ardougne-south-bank', undefined, { x: 2655, z: 3283, level: 0 }],
    ['range:catherby', { x: 2817, z: 3443 }, { x: 2817, z: 3443, level: 0 }],
    ['range:asgarnia', { x: 3039, z: 3366 }, { x: 3039, z: 3366, level: 0 }],
    ['anvil:varrock', { x: 3247, z: 3404 }, { x: 3247, z: 3404, level: 0 }],
    ['pottery-wheel:barbarian-village', undefined, { x: 3086, z: 3410, level: 0 }],
];

const MOVED =
    'A rebuilt index moved a place that plans stand at. Check the plans using that name (grep conductor/plans) ' +
    'before updating this table.';

describe('places the promoted plans use', () => {
    for (const [name, near, stand] of TABLE) {
        test(`${name} stands at ${stand.x},${stand.z}`, () => {
            const got = place(name, near ? { near } : undefined).stand;
            if (got.x !== stand.x || got.z !== stand.z || got.level !== stand.level) {
                throw new Error(
                    `${name} now stands at ${JSON.stringify(got)}, table has ${JSON.stringify(stand)}. ${MOVED}`,
                );
            }
        });
    }

    test('the table names every place() the plans call', () => {
        const dir = join(import.meta.dir, '../plans');
        const used = new Set<string>();
        for (const f of readdirSync(dir).filter(name => name.endsWith('.ts'))) {
            for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\bplace\('([^']+)'/g)) used.add(m[1]!);
        }
        const known = new Set(TABLE.map(r => r[0]));
        expect([...used].filter(n => !known.has(n))).toEqual([]);
    });
});
