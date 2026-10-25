// Build checks for the classes of wrong data the world index audit found (conductor/docs/world-index-data-audit.md
// §2.2): each check returns findings that name their sites by SiteKey (check 1 its configs, by ConfigKey), a curated
// allowlist (allow.ts) leaves out the ones known and explained, and build.ts fails on what is left, and on an
// allowlist entry naming no site (invalid) or matching no finding (stale), as it does for EXPECTED_UNREACHED.
import type { Classification } from './classify';
import { SINKS } from './distance';
import { besideCluster, reachTiles, SITE_RADIUS, type SiteOptions, type StepCollision } from './place';
import { coord, STEPS, type Reach, type ReachGraph } from './reach';
import { dominates, joinUse } from './requirements';
import { resolveSiteKeys, siteKeyMatches, siteKeyName, type SiteKey, type SiteKeyWorld } from './site-key';
import { first, type Config } from './sources/configs';
import type { Trigger } from './sources/triggers';
import type { Area, Feature, FeatureKind, Rect, Site, Tile } from './types';
import { cmp } from './util';

/** The checks, by the id their report lines carry. */
export type CheckId = 'unclaimed' | 'near-miss' | 'split' | 'stand';

/** What one check found: the site or sites it is about, by id and by key, and what is wrong with them. */
export interface Finding {
    /** The sites' ids, in the order of `keys`. */
    ids: string[];
    keys: SiteKey[];
    detail: string;
}

/** A finding a check may make, and why it is left: `keys` names its sites, one per site the finding names. */
export interface Allowed {
    keys: SiteKey[];
    reason: string;
    /** A script line (`file:line` under server/content/scripts) or a map line (`maps/mX_Z.jm2:line`). */
    source: string;
}

/** A check's findings less its allowlist. */
export interface CheckResult {
    /** The findings no entry allows, as `<keys>: <detail>`: errors. */
    left: string[];
    /** How many findings an entry allows. */
    allowed: number;
    /** Entries with a key naming no one site: errors. */
    invalid: string[];
    /** Valid entries no finding matches (fixed now, or gone), or that duplicate an earlier one's match: errors. */
    stale: string[];
    /** Check 1's: how many findings each reason allows, by reason. */
    reasons?: [reason: string, allowed: number][];
}

/** What a check reads: the placed sites, the features they index and the curated areas. */
export interface CheckWorld extends SiteKeyWorld {
    sites: readonly Pick<Site, 'id' | 'kind' | 'features' | 'areaPath' | 'bbox'>[];
    features: readonly Pick<Feature, 'tile' | 'config'>[];
    areas: readonly Pick<Area, 'id' | 'parent' | 'rects'>[];
}

const keysName = (keys: readonly SiteKey[]): string => keys.map(siteKeyName).join(' and ');

/**
 * The Chebyshev distance between the nearest tiles of two rects (adjacent rects 1, overlapping ones 0), or Infinity
 * when they share no level: a rect with no level holds every level.
 */
export function rectGap(a: Rect, b: Rect): number {
    if (a.level !== undefined && b.level !== undefined && a.level !== b.level) return Infinity;
    return Math.max(0, a.x1 - b.x2, b.x1 - a.x2, a.z1 - b.z2, b.z1 - a.z2);
}

const rectName = (r: Rect): string => `x ${r.x1}-${r.x2}, z ${r.z1}-${r.z2}`;

/**
 * A key for each site: its first feature whose tile no other site of its kind holds, so the key resolves back to it.
 * A site with no such feature gets its first feature's, and an entry naming it with that key is invalid.
 */
function keyOf(world: SiteKeyWorld): (site: Pick<Site, 'kind' | 'features'>) => SiteKey {
    const matches = siteKeyMatches(world);
    return site => {
        const keys = site.features.map(i => ({ kind: site.kind, at: world.features[i]!.tile }));
        return keys.find(k => matches(k).length === 1) ?? keys[0]!;
    };
}

/** The sites a check looks at: covered kinds but trees, whose sites chain whole forests (audit E2, plan 2.4). */
const looked = (world: CheckWorld, covered: ReadonlySet<FeatureKind>): CheckWorld['sites'] =>
    world.sites.filter(s => covered.has(s.kind) && s.kind !== 'tree');

/** How far outside a leaf area's rects a site may lie and still be a near miss. */
export const NEAR_MISS_GAP = 3;

/**
 * Check 2, near-miss area (audit D): a site whose bbox lies outside every rect of a leaf area (one no area is the
 * parent of) but within NEAR_MISS_GAP tiles of one of them, on its level, while its own leaf area is another:
 * usually a rect not fitted to the place, with the site filed under the place's parent. One finding per site, naming each such area.
 */
export function nearMissAreas(world: CheckWorld, covered: ReadonlySet<FeatureKind>): Finding[] {
    const parents = new Set(world.areas.flatMap(a => (a.parent === undefined ? [] : [a.parent])));
    const leaves = world.areas.filter(a => !parents.has(a.id));
    const key = keyOf(world);
    return looked(world, covered).flatMap(site => {
        const near = leaves.flatMap(a => {
            if (a.id === site.areaPath.at(-1)) return [];
            const gaps = a.rects.map(r => rectGap(site.bbox, r));
            const gap = Math.min(...gaps);
            if (gap === 0 || gap > NEAR_MISS_GAP) return [];
            return [`${gap} tiles outside ${a.id} (${rectName(a.rects[gaps.indexOf(gap)]!)})`];
        });
        if (!near.length) return [];
        const where = site.areaPath.at(-1) ?? 'no area';
        return [
            {
                ids: [site.id],
                keys: [key(site)],
                detail: `${site.id} (${rectName(site.bbox)}) in ${where}, ${near.join('; ')}`,
            },
        ];
    });
}

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Check 3, split resource (audit E1): two sites of one kind holding a feature of the same config, with a feature of
 * one within the kind's SITE_RADIUS of a feature of the other on its level, and whose leaf areas differ: place.ts
 * buildSites links any two features of a kind that close (Chebyshev, feature to feature, any config) but only within
 * one leaf area, so they are one place clustered as two because an area edge runs through it. One finding per pair.
 */
export function splitResources(world: CheckWorld, covered: ReadonlySet<FeatureKind>): Finding[] {
    const key = keyOf(world);
    const sites = looked(world, covered).map(s => ({
        site: s,
        tiles: s.features.map(i => world.features[i]!.tile),
        configs: new Set(s.features.map(i => world.features[i]!.config)),
    }));
    const out: Finding[] = [];
    for (let i = 0; i < sites.length; i++)
        for (let j = i + 1; j < sites.length; j++) {
            const a = sites[i]!;
            const b = sites[j]!;
            if (a.site.kind !== b.site.kind || a.site.areaPath.at(-1) === b.site.areaPath.at(-1)) continue;
            const radius = SITE_RADIUS[a.site.kind];
            // Bboxes further apart than the radius hold no two features within it.
            if (rectGap(a.site.bbox, b.site.bbox) > radius) continue;
            let gap = Infinity;
            for (const s of a.tiles) for (const t of b.tiles) if (s.level === t.level) gap = Math.min(gap, cheb(s, t));
            if (gap > radius) continue;
            const shared = [...a.configs].filter(c => b.configs.has(c));
            if (!shared.length) continue;
            out.push({
                ids: [a.site.id, b.site.id],
                keys: [key(a.site), key(b.site)],
                detail: `${a.site.id} and ${b.site.id}, ${gap} tiles apart, both hold ${shared.join(', ')}`,
            });
        }
    return out;
}

/**
 * `findings` less those an `allow` entry matches (one whose keys resolve, in `world`, to the finding's sites in any
 * order), with the entries whose keys name no one site (invalid) and the valid ones no finding matches (stale). An
 * entry matching a finding an earlier entry matches is stale too, as a duplicate of that one.
 */
export function applyAllow(findings: readonly Finding[], allow: readonly Allowed[], world: SiteKeyWorld): CheckResult {
    return allowBy(
        findings.map(f => ({ match: [...f.ids].sort().join(' '), name: `${keysName(f.keys)}: ${f.detail}` })),
        allow.map(e => {
            const { ids, invalid: bad } = resolveSiteKeys(e.keys, world);
            const name = `${keysName(e.keys)} (${e.source})`;
            if (bad.length) return { entry: e, name, invalid: `${name}: ${bad.join('; ')}` };
            const match = e.keys
                .map(k => ids.get(k)!)
                .sort()
                .join(' ');
            return { entry: e, name, matches: [match] };
        }),
    ).result;
}

/** An allow entry resolved: what it is called in errors and the findings it matches, by their `match`, or why it is invalid. */
type Resolved<E> = { entry: E; name: string } & ({ matches: string[]; invalid?: never } | { invalid: string });

/**
 * The findings (each by the `match` an entry names it by) less those an entry matches, with the entry that allowed
 * each finding allowed (`by`, in finding order); the entries no finding matches, or only in part (`<name>: <matches>
 * match no finding`), stale; and an entry matching a finding an earlier entry matches stale too, as a duplicate of
 * that one.
 */
function allowBy<E>(
    findings: readonly { match: string; name: string }[],
    allow: readonly Resolved<E>[],
): { result: CheckResult; by: E[] } {
    const invalid = allow.flatMap(e => (e.invalid === undefined ? [] : [e.invalid]));
    const valid = allow.filter(e => e.invalid === undefined) as (Resolved<E> & { matches: string[] })[];
    const used = new Map(valid.map(e => [e, new Set<string>()]));
    const dupes = new Set<string>();
    const left: string[] = [];
    const by: E[] = [];
    for (const f of findings) {
        const [earliest, ...rest] = valid.filter(e => e.matches.includes(f.match));
        if (!earliest) {
            left.push(f.name);
            continue;
        }
        by.push(earliest.entry);
        used.get(earliest)!.add(f.match);
        for (const e of rest) {
            used.get(e)!.add(f.match);
            dupes.add(`${e.name}: a duplicate of ${earliest.name}`);
        }
    }
    const unused = valid.flatMap(e => {
        const idle = e.matches.filter(m => !used.get(e)!.has(m));
        if (!idle.length) return [];
        return [idle.length === e.matches.length ? e.name : `${e.name}: ${idle.join(', ')} match no finding`];
    });
    return { result: { left, allowed: by.length, invalid, stale: [...unused, ...dupes] }, by };
}

/** What the stand check reads: the placed sites with their stands, reach, nearest sinks and fishing movement. */
export interface StandWorld extends SiteKeyWorld {
    sites: readonly Pick<
        Site,
        'id' | 'kind' | 'features' | 'bbox' | 'stand' | 'reach' | 'nearest' | 'wander' | 'roam' | 'movement'
    >[];
    features: readonly Pick<Feature, 'source' | 'config' | 'tile' | 'shape' | 'rotation' | 'subtype'>[];
}

/** What the stand check walks: the reach graph and the collision it was built from, and the fill over it. */
export interface StandInput {
    graph: ReachGraph;
    collision: StepCollision;
    size: SiteOptions['size'];
    /** The fill over `graph` from the Lumbridge spawn. */
    reach: Pick<Reach, 'setsAny' | 'reached'>;
    /** What using a site asks, as alternatives (build.ts useSets); absent, nothing. */
    use?: (s: Pick<Site, 'features'>) => string[][];
    /** A reach set widened into the context its nearest sinks were searched under (distance.ts NearestOptions.context). */
    context?: (set: readonly string[]) => string[];
}

const tileRect = (t: Tile, grow = 0): Rect => ({ x1: t.x - grow, z1: t.z - grow, x2: t.x + grow, z2: t.z + grow });

/**
 * The tiles each of a site's features is used from: a loc's reachTiles; an npc's walkable tiles beside where it
 * walks (besideCluster, its roam the site's wander round its spawn); a fishing spot's, the tiles beside each tile its
 * subtype's spots can stand on (Site.movement), as a spot moves to any of them.
 */
function useTiles(site: StandWorld['sites'][number], world: StandWorld, input: StandInput): Tile[][] {
    const { collision, size } = input;
    const beside = (t: Tile, wander: number): Tile[] =>
        besideCluster({ bbox: tileRect(t), roam: tileRect(t, wander), centre: t }, collision).filter(u =>
            collision.walkable(u.level, u.x, u.z),
        );
    const bySubtype = new Map<string, Tile[]>();
    return site.features.map(i => {
        const f = world.features[i]!;
        if (f.source === 'loc') return reachTiles(f, collision, size);
        const spots = site.kind === 'fishing-spot' ? site.movement?.[f.subtype]?.tiles : undefined;
        if (!spots) return beside(f.tile, site.wander ?? 0);
        let tiles = bySubtype.get(f.subtype);
        if (!tiles) bySubtype.set(f.subtype, (tiles = spots.flatMap(t => beside(t, 0))));
        return tiles;
    });
}

/**
 * The tiles a walk from tile `start` gets to by steps and by crossings that need nothing (an edge or opened loc
 * whose alternatives hold set 0, the empty set, as fillReach and priceCrossings test), inside `bound` (x and z,
 * any level), as tile indexes, handing each to `done` as it is reached; the walk stops once `done` returns true.
 * An opened loc's tile asks its requirement on the start too, as fillReach's arrive does. Read inside
 * `graph.within`, as stepMask is.
 */
function freeComponent(graph: ReachGraph, start: number, bound: Rect, done: (i: number) => boolean): void {
    const { index, edgeFrom, openAlts, stepMask } = graph;
    const inside = (i: number): boolean => {
        const [x, z] = [index.x(i), index.z(i)];
        return x >= bound.x1 && x <= bound.x2 && z >= bound.z1 && z <= bound.z2;
    };
    const seen = new Set<number>();
    const queue: number[] = [];
    let stop = false;
    const visit = (i: number): void => {
        if (stop || i < 0 || seen.has(i) || !inside(i)) return;
        if (openAlts.get(i)?.includes(0) === false) return;
        seen.add(i);
        queue.push(i);
        stop = done(i);
    };
    visit(start);
    while (queue.length) {
        if (stop) return;
        const i = queue.pop()!;
        const m = stepMask(i);
        const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
        for (let bit = 0; bit < 8; bit++)
            if (m & (1 << bit)) visit(index.of(level, x + STEPS[bit]![0], z + STEPS[bit]![1]));
        for (const e of edgeFrom.get(i) ?? []) if (e.alts.includes(0)) visit(e.to);
    }
}

/**
 * The most an npc site wanders for which the stand check walks to its members. An npc's use tiles lie up to its
 * wander past its spawn (useTiles), so the walk's bound grows with it; the sites tested today wander 63 at most,
 * and a config wandering map-wide (quest_fluffs.npc:57, wanderrange=30000) would make the walk the whole map. A
 * site wandering more is a finding of its own, not walked.
 */
const MAX_WANDER = 64;

/**
 * How many of a site's members (`tiles`, each member's use tiles) the free walk from the stand gets to a use tile
 * of. The walk is bounded to the rect holding the site's roam (its bbox when it has none), every use tile and the
 * stand, grown by twice its kind's SITE_RADIUS for the way round a wall, so every use tile and the start are
 * inside it. The walk stops once half are usable, so a count under half is exact.
 */
function usableFrom(graph: ReachGraph, site: StandWorld['sites'][number], tiles: readonly Tile[][]): number {
    const stand = site.stand!;
    const grow = 2 * SITE_RADIUS[site.kind];
    const { x1, z1, x2, z2 } = site.roam ?? site.bbox;
    const held = { x1, z1, x2, z2 };
    for (const t of [stand, ...tiles.flat()]) {
        held.x1 = Math.min(held.x1, t.x);
        held.z1 = Math.min(held.z1, t.z);
        held.x2 = Math.max(held.x2, t.x);
        held.z2 = Math.max(held.z2, t.z);
    }
    const bound = { x1: held.x1 - grow, z1: held.z1 - grow, x2: held.x2 + grow, z2: held.z2 + grow };
    // The members each tile is a use tile of.
    const membersAt = new Map<number, number[]>();
    tiles.forEach((ts, m) => {
        for (const t of ts) {
            const i = graph.index.of(t.level, t.x, t.z);
            membersAt.set(i, [...(membersAt.get(i) ?? []), m]);
        }
    });
    const usable = new Set<number>();
    freeComponent(graph, graph.index.of(stand.level, stand.x, stand.z), bound, i => {
        for (const m of membersAt.get(i) ?? []) usable.add(m);
        return usable.size * 2 >= tiles.length;
    });
    return usable.size;
}

/**
 * Check 4, stand connectivity (audit E4): a site with a stand some set reaches whose stand's free walk component
 * (freeComponent, bounded round the roam, the use tiles and the stand: usableFrom) holds a use tile (useTiles) of
 * fewer than half its members, or, for a kind that takes its products to a bank (distance.ts SINKS), whose stand
 * has no nearest bank or one whose way asks more than any member's own way in does: place.ts standTile takes the
 * walkable candidate nearest the centre, which can be a pocket the members are not in. A member is a feature with
 * a use tile some walk gets to: one used from nowhere (a duck mid-pond, a banker behind the counter) is no stand's
 * to reach. A member's way in is the sets of its use tiles joined with what using the site asks, in the context its
 * nearest sinks were searched under, as the site's reach is the stand's (build.ts addReach). A site wandering past
 * MAX_WANDER is found as that, not walked. One finding per site.
 */
export function standConnectivity(world: StandWorld, input: StandInput): Finding[] {
    const { graph, collision, reach } = input;
    const key = keyOf(world);
    const sites = world.sites.filter(s => s.stand && s.reach.length > 0);
    const walled = collision.walled ?? (<T>(f: () => T): T => f());
    const uses = walled(() =>
        sites.map(s => useTiles(s, world, input).flatMap(ts => (ts.some(reach.reached) ? [ts] : []))),
    );
    /** The sets of the members' ways in. */
    const waysIn = (site: StandWorld['sites'][number], tiles: readonly Tile[][]): string[][] => {
        const gated = input.use?.(site) ?? [[]];
        const context = input.context ?? ((set: readonly string[]) => [...set]);
        return tiles.flatMap(ts => joinUse(reach.setsAny(ts), gated, graph.quests).map(context));
    };
    return graph.within(() =>
        sites.flatMap((site, n) => {
            const stand = site.stand!;
            const start = graph.index.of(stand.level, stand.x, stand.z);
            const tiles = uses[n]!;
            if (start < 0 || !tiles.length) return [];
            const wrong: string[] = [];
            const wander = site.wander ?? 0;
            if (wander > MAX_WANDER) wrong.push(`wanders ${wander} > MAX_WANDER ${MAX_WANDER}, not walked`);
            else {
                const usable = usableFrom(graph, site, tiles);
                if (usable * 2 < tiles.length) wrong.push(`${usable} of ${tiles.length} members usable from the stand`);
            }
            if (SINKS[site.kind]?.includes('bank')) {
                const bank = site.nearest?.bank;
                if (!bank) wrong.push('no bank from the stand');
                else if (!waysIn(site, tiles).some(w => dominates(bank.requires, w, graph.quests)))
                    wrong.push(
                        `its nearest bank ${bank.site} needs [${bank.requires.join(', ')}], more than any member's way in`,
                    );
            }
            if (!wrong.length) return [];
            return [
                { ids: [site.id], keys: [key(site)], detail: `${site.id} stand ${coord(stand)}: ${wrong.join('; ')}` },
            ];
        }),
    );
}

/** A placed loc or npc config, as `loc <config>` or `npc <config>`: what check 1's findings and entries name. */
export type ConfigKey = `${'loc' | 'npc'} ${string}`;

/** A check 1 finding: a placed config, and its unclaimed triggers with their shapes. */
export interface ConfigFinding {
    config: ConfigKey;
    detail: string;
}

/** Check 1 findings left for one reason: one config, or a group sharing the reason, with a trigger line of one. */
export interface ConfigAllowed {
    configs: ConfigKey[];
    reason: string;
    /** A trigger's script line, `file:line` under server/content/scripts. */
    source: string;
}

/** What check 1 reads: the placed configs, their configs (for the op labels) and classify.ts's classification. */
export interface UnclaimedInput {
    placed: { loc: ReadonlySet<string>; npc: ReadonlySet<string> };
    configs: { loc: ReadonlyMap<string, Config>; npc: ReadonlyMap<string, Config> };
    classification: Pick<Classification, 'unclaimed' | 'reach'>;
}

/** Whether one body of `bodies` matches every pattern. */
const inOne =
    (...res: RegExp[]) =>
    (bodies: readonly string[]): boolean =>
        bodies.some(b => res.every(re => re.test(b)));

const INV_ADD = /\binv_add\(/;
const INV_DEL = /\binv_del\(/;
const DELAY = /\b(p_delay|anim)\(/;
// A loc_change or loc_del depletes the loc, as a tree stump or a picked crop; an npc_changetype the npc (a sheared
// sheep, general_use/scripts/shear_sheep.rs2).
const DEPLETE = /\b(loc_change|loc_del|npc_changetype\w*)\(/;
// p_oploc and p_opnpc run the op again (skill_mining/scripts/mining.rs2 @mining_continue): a loop.
const AGAIN = /\bp_op(loc|npc)\(/;

/**
 * The shapes of a use worth a feature, over a trigger's reach (classify.ts Classification.reach): `xp`, a
 * stat_advance of a stat but agility, whose xp an obstacle gives on the way across (shortcuts, quest obstacles,
 * skill_agility/scripts/shortcuts.rs2), which is no use of the loc; `shop`, ~openshop; `gather`, an inv_add in a body
 * that depletes the loc or npc (DEPLETE) or animates or waits (p_delay, anim) while a body runs the op again (AGAIN);
 * `pickup`, ~pickup_loc_floor (the crops, general_use/scripts/pickables.rs2); `use`, an item used on it that a body
 * takes (inv_del) while it gives one (inv_add: a bucket filled at a well, general_use/scripts/water_sources.rs2) or
 * animates or waits (grain into a mill hopper, general_use/scripts/windmills.rs2 @hopper_fill). A bare inv_add is
 * no shape: dialogue handing out a quest item is one.
 */
const SHAPES: readonly (readonly [string, (bodies: readonly string[], t: Trigger) => boolean])[] = [
    ['xp', inOne(/\bstat_advance\((?!\s*agility\b)/)],
    ['shop', inOne(/~openshop(\(|_activenpc\b)/)],
    ['gather', b => inOne(INV_ADD, DEPLETE)(b) || (inOne(INV_ADD, DELAY)(b) && inOne(AGAIN)(b))],
    ['pickup', inOne(/~pickup_loc_floor\b/)],
    ['use', (b, t) => t.op === 'u' && (inOne(INV_DEL, INV_ADD)(b) || inOne(INV_DEL, DELAY)(b))],
];

/** Op labels whose triggers are dialogue or combat, not a use: a Talk-to's quest reward, a monster's Attack. */
const NOT_USES: ReadonlySet<string> = new Set(['Talk-to', 'Attack']);

const header = (t: Trigger): string => `[${t.kind}${t.on}${t.op},${t.category ? '_' : ''}${t.target}]`;

/**
 * Check 1, unclaimed triggers (audit B1, B2, C): a placed config with an op trigger (op, ap, use-item) no rule made a
 * feature through (classify.ts Classification.unclaimed) whose reach has a shape (SHAPES), on an op not labelled
 * Talk-to or Attack (NOT_USES). One finding per config, naming each such trigger by its line, header and shapes.
 */
export function unclaimedTriggers(input: UnclaimedInput): ConfigFinding[] {
    const { placed, configs, classification } = input;
    return (['loc', 'npc'] as const).flatMap(on =>
        [...placed[on]].sort().flatMap(config => {
            const cfg = configs[on].get(config) ?? {};
            const hits = classification.unclaimed(on, config).flatMap(t => {
                if (t.op !== 'u' && NOT_USES.has(first(cfg, `op${t.op}`) ?? '')) return [];
                const bodies = classification.reach(t.body);
                const shapes = SHAPES.filter(([, has]) => has(bodies, t)).map(([n]) => n);
                return shapes.length ? [`${t.file}:${t.line} ${header(t)} ${shapes.join(', ')}`] : [];
            });
            return hits.length ? [{ config: `${on} ${config}` as const, detail: hits.join('; ') }] : [];
        }),
    );
}

/** The most configs an entry's name lists before it counts the rest. */
const NAMED_AT = 3;

const configsName = (keys: readonly ConfigKey[]): string =>
    keys.length > NAMED_AT
        ? `${keys.slice(0, NAMED_AT).join(', ')} and ${keys.length - NAMED_AT} more`
        : keys.join(', ');

/**
 * `findings` less those an `allow` entry names, as applyAllow does: an entry naming nothing, or a config not in
 * `placed`, is invalid, and one naming a config no finding is about is stale. `reasons`: how many findings each
 * reason allows.
 */
export function applyConfigAllow(
    findings: readonly ConfigFinding[],
    allow: readonly ConfigAllowed[],
    placed: UnclaimedInput['placed'],
): CheckResult {
    const isPlaced = (k: ConfigKey): boolean => {
        const at = k.indexOf(' ');
        const on = k.slice(0, at);
        return (on === 'loc' || on === 'npc') && placed[on].has(k.slice(at + 1));
    };
    const { result, by } = allowBy(
        findings.map(f => ({ match: f.config, name: `${f.config}: ${f.detail}` })),
        allow.map(e => {
            const name = `${configsName(e.configs)} (${e.source})`;
            const bad = e.configs.filter(k => !isPlaced(k));
            if (!e.configs.length) return { entry: e, name, invalid: `${name}: names no config` };
            if (bad.length) return { entry: e, name, invalid: `${name}: ${bad.join(', ')} not placed` };
            return { entry: e, name, matches: [...e.configs] };
        }),
    );
    const reasons = new Map<string, number>();
    for (const e of by) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
    return { ...result, reasons: [...reasons].sort(([a], [b]) => cmp(a, b)) };
}
