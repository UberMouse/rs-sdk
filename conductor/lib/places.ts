// Named places: a plan writes `place('bank:varrock-east-bank').area(6)` where it would type coordinates, resolved
// against the world index when the plan module is imported, so a wrong name fails at plan load. A name is a site id
// without its ordinal: the ordinal is renumbered by a change to the clustering (wiki/world/site-key.ts), the area
// slug is not. Design: conductor/docs/named-places.md.
import { areaName, BANKS } from './bank-sites';
import { WORLD } from './world-index';

/** The site kinds a place may name: the services a plan walks to, not resource clusters. */
export const PLACE_KINDS = [
    'bank',
    'furnace',
    'anvil',
    'range',
    'altar',
    'rc-altar',
    'rc-ruins',
    'spinning-wheel',
    'pottery-oven',
    'pottery-wheel',
    'tanner',
    'water-source',
    'sand-pit',
    'agility-course',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface Place {
    /** The name `place()` takes: `<kind>:<area-slug>`. Shared by every site of an ambiguous name. */
    id: string;
    kind: string;
    /** The area's display name, with the kind after it unless a bank. */
    name: string;
    stand: { x: number; z: number; level: number };
    at(opts?: { tolerance?: number; level?: number }): { x: number; z: number; level?: number; tolerance?: number };
    area(radius: number): { x: number; z: number; radius: number; level?: number };
}

/** How far from `near` the nearest site of an ambiguous name may stand before `near` is taken to be a mistake. */
export const NEAR_MAX_TILES = 10;
const SUGGESTIONS = 5;
const ORDINAL = /:\d+$/;

interface Entry {
    id: string;
    kind: PlaceKind;
    name: string;
    stand: { x: number; z: number; level: number };
}

const isPlaceKind = (kind: string): kind is PlaceKind => (PLACE_KINDS as readonly string[]).includes(kind);
const BANK_BY_ID = new Map(BANKS.map(b => [b.id, b]));

const ENTRIES: readonly Entry[] = WORLD.sites.flatMap(s => {
    if (!isPlaceKind(s.kind) || !s.stand) return [];
    const id = s.id.replace(ORDINAL, '');
    const bank = s.kind === 'bank' ? BANK_BY_ID.get(s.id) : undefined;
    const area = areaName(s.areaPath.at(-1)) ?? id.slice(s.kind.length + 1);
    const stand = bank?.stand ?? s.stand;
    return [
        {
            id,
            kind: s.kind,
            name: bank ? bank.name : `${area} ${s.kind.replace(/-/g, ' ')}`,
            stand: { level: stand.level, x: stand.x, z: stand.z },
        },
    ];
});

function toPlace(e: Entry): Place {
    const { x, z, level } = e.stand;
    return {
        id: e.id,
        kind: e.kind,
        name: e.name,
        stand: { ...e.stand },
        at: (opts = {}) => {
            const lvl = opts.level ?? (level !== 0 ? level : undefined);
            return {
                x,
                z,
                ...(lvl !== undefined ? { level: lvl } : {}),
                ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}),
            };
        },
        area: radius => ({ x, z, radius, ...(level !== 0 ? { level } : {}) }),
    };
}

const refuseKind = (what: string, kind: string): Error =>
    new Error(`${what}: "${kind}" is not a place kind; one of ${PLACE_KINDS.join(', ')}`);

const commonPrefix = (a: string, b: string): number => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
};

/**
 * Up to SUGGESTIONS names of `kind` closest to `slug`: first those whose slug contains it or is contained in it,
 * then by the longest common prefix; ties by name.
 */
export function nearestNames(kind: PlaceKind, slug: string): string[] {
    const names = [...new Set(ENTRIES.filter(e => e.kind === kind).map(e => e.id))];
    const score = (n: string) => {
        const s = n.slice(kind.length + 1);
        return { contains: s.includes(slug) || slug.includes(s), prefix: commonPrefix(s, slug) };
    };
    return names
        .map(n => ({ n, ...score(n) }))
        .sort(
            (a, b) =>
                Number(b.contains) - Number(a.contains) || b.prefix - a.prefix || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0),
        )
        .slice(0, SUGGESTIONS)
        .map(s => s.n);
}

const tile = (t: { x: number; z: number }) => `(${t.x},${t.z})`;

/**
 * The place `name` (`<kind>:<area-slug>`) names. A name several sites share needs `near`: the site whose stand is
 * nearest it (Chebyshev; a stand on near's level, 0 when it gives none, wins a tie), within NEAR_MAX_TILES.
 */
export function place(name: string, opts: { near?: { x: number; z: number; level?: number } } = {}): Place {
    const colon = name.indexOf(':');
    const kind = colon < 0 ? name : name.slice(0, colon);
    if (!isPlaceKind(kind)) throw refuseKind(`place "${name}"`, kind);
    const slug = name.slice(colon + 1);
    if (ORDINAL.test(slug))
        throw new Error(
            `place "${name}": drop the ordinal, "${name.replace(ORDINAL, '')}"; it is renumbered when the world index is rebuilt`,
        );
    const sites = ENTRIES.filter(e => e.id === name);
    if (!sites.length)
        throw new Error(
            `unknown place "${name}"; nearest names of kind ${kind}: ${nearestNames(kind, slug).join(', ')}`,
        );
    if (sites.length === 1) return toPlace(sites[0]!);
    const stands = sites.map(e => tile(e.stand)).join(', ');
    const { near } = opts;
    if (!near) throw new Error(`place "${name}" names ${sites.length} sites, stands ${stands}: pass near to pick one`);
    const level = near.level ?? 0;
    const dist = (e: Entry) => Math.max(Math.abs(e.stand.x - near.x), Math.abs(e.stand.z - near.z));
    const best = [...sites].sort(
        (a, b) => dist(a) - dist(b) || Number(a.stand.level !== level) - Number(b.stand.level !== level),
    )[0]!;
    if (dist(best) > NEAR_MAX_TILES)
        throw new Error(
            `place "${name}": the nearest of its stands ${stands} to near ${tile(near)} is ${dist(best)} tiles away, more than ${NEAR_MAX_TILES}`,
        );
    return toPlace(best);
}

/** Every place, one per site (an ambiguous name once per site), of `kind` when given; by name, then stand. */
export function places(kind?: string): Place[] {
    if (kind !== undefined && !isPlaceKind(kind)) throw refuseKind('places', kind);
    return ENTRIES.filter(e => kind === undefined || e.kind === kind)
        .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.stand.x - b.stand.x || a.stand.z - b.stand.z)
        .map(toPlace);
}
