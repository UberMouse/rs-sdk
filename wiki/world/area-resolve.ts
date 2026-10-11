// Resolves a tile to the areas holding it. An area's rects are inclusive tile boxes; one without a level
// holds every level (0-3). Underground areas need nothing special: underground map squares sit at
// z + 6400 in world coordinates, so they are ordinary rects there.
import type { Area, Rect, Tile } from './types';

const LEVELS = [0, 1, 2, 3];

const holds = (r: Rect, t: Tile): boolean =>
    (r.level === undefined || r.level === t.level) && t.x >= r.x1 && t.x <= r.x2 && t.z >= r.z1 && t.z <= r.z2;

const size = (r: Rect): number => (r.x2 - r.x1 + 1) * (r.z2 - r.z1 + 1);

// Sums rect sizes, so overlapping rects of one area count twice. That only skews the smaller-wins
// tie-break between same-depth areas that both hold a tile, where a rough size is enough; a true union
// area would cost the rect-splitting for no better answer.
const total = (a: Area): number => a.rects.reduce((sum, r) => sum + size(r), 0);

/** The parts of `a` outside `b`, both on one level: at most four rects. */
function subtract(a: Rect, b: Rect): Rect[] {
    if (b.x2 < a.x1 || b.x1 > a.x2 || b.z2 < a.z1 || b.z1 > a.z2) return [a];
    const out: Rect[] = [];
    if (a.x1 < b.x1) out.push({ ...a, x2: b.x1 - 1 });
    if (a.x2 > b.x2) out.push({ ...a, x1: b.x2 + 1 });
    const x1 = Math.max(a.x1, b.x1);
    const x2 = Math.min(a.x2, b.x2);
    if (a.z1 < b.z1) out.push({ ...a, x1, x2, z2: b.z1 - 1 });
    if (a.z2 > b.z2) out.push({ ...a, x1, x2, z1: b.z2 + 1 });
    return out;
}

/** `r` lies inside the union of `cover`, on every level `r` holds. */
function covered(r: Rect, cover: Rect[]): boolean {
    return (r.level === undefined ? LEVELS : [r.level]).every(level => {
        const onLevel = cover.filter(c => c.level === undefined || c.level === level);
        return onLevel.reduce((left, c) => left.flatMap(piece => subtract(piece, c)), [r]).length === 0;
    });
}

/** Each area's ids from the root down to itself; throws on a missing parent or a cycle. */
function pathsOf(byId: Map<string, Area>): Map<string, string[]> {
    const paths = new Map<string, string[]>();
    const walk = (a: Area, seen: string[]): string[] => {
        const known = paths.get(a.id);
        if (known) return known;
        if (seen.includes(a.id)) throw new Error(`area parent cycle: ${[...seen, a.id].join(' -> ')}`);
        let path = [a.id];
        if (a.parent !== undefined) {
            const parent = byId.get(a.parent);
            if (!parent) throw new Error(`area '${a.id}' has a parent '${a.parent}' that is not an area`);
            path = [...walk(parent, [...seen, a.id]), a.id];
        }
        paths.set(a.id, path);
        return path;
    };
    for (const a of byId.values()) walk(a, []);
    return paths;
}

/**
 * Validates `areas` and returns a function giving the path (root first) of the deepest area holding a
 * tile, or `[]`. Between areas of one depth the smaller (total rect size) wins, then the lower id, so
 * a small place drawn over its sibling town resolves to the place. Throws on a duplicate id, a missing
 * parent, a parent cycle, an inverted rect, or a child rect not inside the union of its parent's rects,
 * which keeps every ancestor on the path holding the tile too.
 */
export function areaResolver(areas: readonly Area[]): (t: Tile) => string[] {
    const byId = new Map<string, Area>();
    for (const a of areas) {
        if (byId.has(a.id)) throw new Error(`duplicate area id '${a.id}'`);
        byId.set(a.id, a);
        for (const r of a.rects)
            if (r.x1 > r.x2 || r.z1 > r.z2) throw new Error(`area '${a.id}' has an inverted rect ${JSON.stringify(r)}`);
    }
    const paths = pathsOf(byId);
    for (const a of areas) {
        if (a.parent === undefined) continue;
        const parentRects = byId.get(a.parent)!.rects;
        const outside = a.rects.find(r => !covered(r, parentRects));
        if (outside)
            throw new Error(`area '${a.id}' rect ${JSON.stringify(outside)} is outside its parent '${a.parent}'`);
    }
    const order = [...areas].sort(
        (a, b) =>
            paths.get(b.id)!.length - paths.get(a.id)!.length ||
            total(a) - total(b) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return t => {
        const hit = order.find(a => a.rects.some(r => holds(r, t)));
        return hit ? paths.get(hit.id)! : [];
    };
}
