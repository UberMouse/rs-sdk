// Prints a draft of wiki/world/areas.ts from the world map's labels, server/content/maps/labels.txt
// (`=Name,x,z,type`; the map packer, server/engine/tools/pack/map/Worldmap.ts:650, keeps only the `=`
// lines). Type 2 labels name regions, type 1 towns and type 0 smaller places; a `/` in a name is the
// map's line break. The draft is a starting point: areas.ts is curated from it by hand, so print it
// somewhere else and compare:  bun wiki/world/tools/seed-areas.ts > draft.ts && bunx oxfmt draft.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { MAPS } from '../paths';
import { wildernessLevel } from '../sources/zones';
import type { Area, Rect } from '../types';

export interface Label {
    name: string;
    x: number;
    z: number;
    type: number;
}

export function parseLabels(text: string): Label[] {
    return text
        .split(/\r?\n/)
        .filter(line => line.startsWith('='))
        .map(line => {
            const m = line.match(/^=(.+),(\d+),(\d+),([0-2])$/);
            if (!m) throw new Error(`not a =name,x,z,type label: '${line}'`);
            const name = m[1]!.replaceAll('/', ' ').replace(/ +/g, ' ').trim();
            return { name, x: Number(m[2]), z: Number(m[3]), type: Number(m[4]) };
        });
}

/** Half the side of the square drawn around a town (type 1) or place (type 0) label. */
const HALF: Record<number, number> = { 1: 24, 0: 12 };
/** How far a region's rect reaches past the rects of its children. */
const MARGIN = 16;
/** Half the side of a region's rect when no label is nearest to it. */
const LONE_REGION_HALF = 32;

export const kebab = (name: string): string =>
    name
        .toLowerCase()
        .replaceAll("'", '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

const around = (l: Label, half: number): Rect => ({
    x1: l.x - half,
    z1: l.z - half,
    x2: l.x + half - 1,
    z2: l.z + half - 1,
});

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const inWilderness = (l: Label): boolean => wildernessLevel({ level: 0, x: l.x, z: l.z }) > 0;

/**
 * Regions from type 2 labels, towns and places from the rest, each parented to the nearest region
 * label on its own side of the Wilderness border (the border is a game fact; the nearest label alone
 * puts Trollheim in the Wilderness), unless `parents` names its parent by id (`null`: none). A
 * region's rect is its children's bounding box plus a margin, so the draft passes areaResolver's
 * containment check. A repeated id gets `-2`, `-3` in label order. Output: each region followed by
 * its children, then the areas with no parent that are not regions, each group sorted by id.
 */
export function seedAreas(labels: Label[], parents: Record<string, string | null> = {}): Area[] {
    const seen = new Map<string, number>();
    const ided = labels.map(l => {
        const base = kebab(l.name);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return { ...l, id: n === 1 ? base : `${base}-${n}` };
    });
    const unknown = Object.keys(parents).find(id => !ided.some(l => l.id === id && l.type !== 2));
    if (unknown !== undefined) throw new Error(`parent override for '${unknown}', which is no town or place`);
    const regions = ided.filter(l => l.type === 2);
    const nearest = (l: Label): string => {
        const side = regions.filter(r => inWilderness(r) === inWilderness(l));
        const pool = side.length ? side : regions;
        return pool.reduce((best, r) =>
            Math.hypot(r.x - l.x, r.z - l.z) < Math.hypot(best.x - l.x, best.z - l.z) ? r : best,
        ).id;
    };
    const children = ided
        .filter(l => l.type !== 2)
        .map(l => {
            const parent = l.id in parents ? parents[l.id] : nearest(l);
            if (parent && !regions.some(r => r.id === parent)) throw new Error(`'${l.id}': '${parent}' is no region`);
            const rects = [around(l, HALF[l.type]!)];
            return parent === null ? { id: l.id, name: l.name, rects } : { id: l.id, name: l.name, parent, rects };
        });
    const roots = children.filter(c => c.parent === undefined).sort(byId);
    const tree = [...regions].sort(byId).flatMap(r => {
        const mine = children.filter(c => c.parent === r.id).sort(byId);
        const rects = mine.flatMap(c => c.rects);
        const rect: Rect = rects.length
            ? {
                  x1: Math.min(r.x, ...rects.map(c => c.x1)) - MARGIN,
                  z1: Math.min(r.z, ...rects.map(c => c.z1)) - MARGIN,
                  x2: Math.max(r.x, ...rects.map(c => c.x2)) + MARGIN,
                  z2: Math.max(r.z, ...rects.map(c => c.z2)) + MARGIN,
              }
            : around(r, LONE_REGION_HALF);
        return [{ id: r.id, name: r.name, rects: [rect] }, ...mine];
    });
    return [...tree, ...roots];
}

const HEADER = `// The world's named areas, keyed by id; wiki/world/area-resolve.ts resolves a tile to them.
// Seeded by wiki/world/tools/seed-areas.ts from the world map labels, then curated by hand.
import type { Area } from './types';
`;

/** areas.ts source for `areas`, one area per line; oxfmt wraps it. */
export const renderAreas = (areas: Area[]): string =>
    `${HEADER}\nexport const AREAS: readonly Area[] = [\n${areas.map(a => `    ${JSON.stringify(a)},\n`).join('')}];\n`;

if (import.meta.main) {
    process.stdout.write(renderAreas(seedAreas(parseLabels(readFileSync(join(MAPS, 'labels.txt'), 'utf8')))));
}
