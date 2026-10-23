// Banks, for tasks that bank "at the nearest bank" when given no area: a view of the world index's bank sites
// (lib/world-index.ts, World.sites of kind `bank`: the booths, bankers and bank chests whose op opens the bank),
// on any level and members-only ones included (bots always play on members worlds). The curated facts the game data
// does not give are laid over them by a tile of the site (OVERRIDES): a bank a task must never pick on its own, and
// why.
import { resolveSiteKeys, type SiteKey } from '../../wiki/world/site-key';
import type { Area } from './area';
import { type Account, meetsOneOf, NO_ACCOUNT } from './account';
import { CONNECTORS, MAX_HOPS, type Tile } from './connectors';
import { nearestWay } from './walk-graph';
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

/** Radius of the area a bank walk aims for; `walkToArea` walks to within radius - 1 tiles of `stand`. */
export const BANK_STAND_RADIUS = 3;

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

/** OVERRIDES by the id of the site each key resolves to; a key naming no bank site, or several, throws at import. */
const OVERRIDE_BY_ID: ReadonlyMap<string, Override> = (() => {
    const { ids, invalid } = resolveSiteKeys(
        OVERRIDES.map(([key]) => key),
        WORLD,
    );
    if (invalid.length) throw new Error(`banks.ts OVERRIDES names no one bank site: ${invalid.join('; ')}`);
    return new Map(OVERRIDES.map(([key, o]) => [ids.get(key)!, o]));
})();

/** A bank site's name: its area's (`Varrock West bank` is Varrock West). */
const nameOf = (areaId: string | undefined): string | undefined =>
    WORLD.areas.find(a => a.id === areaId)?.name.replace(/ bank$/, '');

/** Every bank site with a stand tile, in world.json's order. */
export const BANKS: readonly BankSite[] = WORLD.sites.flatMap(s => {
    if (s.kind !== 'bank' || !s.stand) return [];
    const o = OVERRIDE_BY_ID.get(s.id) ?? {};
    return [
        {
            id: s.id,
            name: nameOf(s.areaPath.at(-1)) ?? s.id,
            stand: { ...(o.stand ?? s.stand) },
            reach: s.reach,
            auto: !o.skip,
            ...(o.skip ? { skip: o.skip } : {}),
        },
    ];
});

/**
 * The bank a task may pick on its own nearest to the point: of the banks not curated out whose `reach` the account
 * meets, the one the fewest run ticks away over the world index's graph, walking as the walker does
 * (lib/walk-graph.ts: through the doors and tolls the account opens and pays and the moves it makes, climbing at
 * most MAX_HOPS of the connectors lib/connectors.ts lists). Undefined when none is reached.
 */
export function nearestBank(
    from: { level?: number; x: number; z: number },
    account: Account = NO_ACCOUNT,
): BankSite | undefined {
    const candidates = BANKS.filter(b => b.auto && meetsOneOf(account, b.reach));
    const way = nearestWay(
        { level: from.level ?? 0, x: from.x, z: from.z },
        candidates.map(b => b.stand),
        { account, connectors: CONNECTORS, maxHops: MAX_HOPS },
    );
    return way && candidates[way.target];
}

export const bankArea = (b: BankSite): Area => ({
    x: b.stand.x,
    z: b.stand.z,
    radius: BANK_STAND_RADIUS,
    level: b.stand.level,
});
