// The bank sites of the world index (lib/world-index.ts, World.sites of kind `bank`: the booths, bankers and bank
// chests whose op opens the bank), on any level and members-only ones included (bots always play on members worlds),
// with the curated facts the game data does not give laid over them by a tile of the site (OVERRIDES): a bank a task
// must never pick on its own, and why. Kept apart from lib/banks.ts, whose nearest-bank walk loads the collision
// data, so lib/places.ts (which plans import) loads nothing beyond the index.
import { resolveSiteKeys, type SiteKey, type SiteKeyWorld, siteKeyName } from '../../wiki/world/site-key';
import type { Tile } from '../../wiki/world/types';
import { WORLD } from './world-index';

export interface BankSite {
    /** The world index's site id, as world.json and the pages name it. */
    id: string;
    name: string;
    /** The public side of the booths (the tile a player stands on), not the banker's side. */
    stand: Tile;
    /** The minimal requirement sets a walk from the Lumbridge spawn needs to get there (Site.reach); `[]` is none. */
    reach: string[][];
    /** False: never picked as "nearest"; the reason is in `skip`. A caller can still pass it as an area. */
    auto: boolean;
    skip?: string;
}

/** What the table lays over a bank site: a stand kept from the curated table, or a reason never to pick it. */
interface Override {
    stand?: Tile;
    skip?: string;
}

/** The bank site with a booth, banker or chest on (x, z) of `level`. */
const bankAt = (x: number, z: number, level = 0): SiteKey => ({ kind: 'bank', at: { level, x, z } });

/**
 * The curated facts, by SiteKey (wiki/world/site-key.ts): a site id is an ordinal a change to the clustering
 * renumbers, which would lay a fact over another bank.
 */
export const OVERRIDES: readonly (readonly [SiteKey, Override])[] = [
    // Draynor's banker.
    [bankAt(3088, 3242), { skip: 'dark wizards spawn around (3084,3236), 8 tiles away (learnings/hazards.md)' }],
    // The booths stand in a row at x 3186, z 3436..3446. The curated stand is the south booth's side, where every
    // walk to this bank has ended; the generated one, (3185, 3440), fronts the middle booth.
    [bankAt(3186, 3436), { stand: { level: 0, x: 3185, z: 3436 } }],
];

/**
 * `overrides` by the id of the site each key resolves to; a key naming no one site, or two overrides naming
 * the same site, throws.
 */
export function overridesById(
    overrides: readonly (readonly [SiteKey, Override])[],
    world: SiteKeyWorld,
): Map<string, Override> {
    const { ids, invalid } = resolveSiteKeys(
        overrides.map(([key]) => key),
        world,
    );
    if (invalid.length) throw new Error(`bank-sites.ts OVERRIDES names no one bank site: ${invalid.join('; ')}`);
    const byId = new Map<string, Override>();
    const keyOf = new Map<string, SiteKey>();
    for (const [key, o] of overrides) {
        const id = ids.get(key)!;
        const first = keyOf.get(id);
        if (first)
            throw new Error(`bank-sites.ts OVERRIDES: ${siteKeyName(first)} and ${siteKeyName(key)} both name ${id}`);
        keyOf.set(id, key);
        byId.set(id, o);
    }
    return byId;
}

const OVERRIDE_BY_ID = overridesById(OVERRIDES, WORLD);

/** An area's display name, as a bank site is named (`Varrock West bank` is Varrock West). */
export const areaName = (areaId: string | undefined): string | undefined =>
    WORLD.areas.find(a => a.id === areaId)?.name.replace(/ bank$/, '');

/** Every bank site with a stand tile, in world.json's order. */
export const BANKS: readonly BankSite[] = WORLD.sites.flatMap(s => {
    if (s.kind !== 'bank' || !s.stand) return [];
    const o = OVERRIDE_BY_ID.get(s.id) ?? {};
    return [
        {
            id: s.id,
            name: areaName(s.areaPath.at(-1)) ?? s.id,
            stand: { ...(o.stand ?? s.stand) },
            reach: s.reach,
            auto: !o.skip,
            ...(o.skip ? { skip: o.skip } : {}),
        },
    ];
});
