// Builds wiki/world.json from the game data: every classified placement as a feature, clustered into
// sites named by the curated areas, every npc spawn clustered per config (npcSpawns, which the npc
// pages read), every connector's landings (sources/connectors.ts), the quest table (sources/quests.ts),
// the loadout rules (sources/loadout.ts), the transports (sources/transports.ts, gates.ts) and the gates
// (sources/gate-scan.ts, gates.ts), the crossings (sources/gate-landings.ts, sources/dbrow-teleports.ts,
// sources/npc-teleports.ts, sources/curated-crossings.ts), and each site's and npc spawn cluster's reach (reach.ts: what a walk from the
// Lumbridge spawn needs to get there), and each resource and processor site's nearest bank and processors in run ticks
// (distance.ts), and resolves every curated method (methods.ts, model/method.ts); then prints a report and renders
// the pages (render.ts) and, from the world in memory, the npc, shop and item pages (wiki/generate-*.ts). `bun run
// world` writes them, prints the report with the reach fill's section and the covered sites no walk reaches, by pocket
// (the curation to-do list, a warning), and exits 1 when the report has an error (failed): a site that breaks the COVERED
// rule, a quest or journal call the scan can't read with no override, a gates.ts quest entry no longer
// needed, a sail site no npc op reaches that gates.ts does not list as out of scope, or one it lists that
// is gone or now reached, a gate candidate gates.ts does not review, or a gates.ts gate entry that is
// stale, malformed, at odds with the scan without saying why, or names a quest stage no constant does, an
// areas.ts EXPECTED_UNREACHED entry no unreached site matches, a method record that does not resolve, or a build
// check's finding (checks.ts) allow.ts does not allow, or an allow.ts entry naming no one site or matching nothing. `--check`
// writes nothing: it exits 1 when world.json or a page differs from what the game data and this code
// generate now, so a hand edit or a stale page fails verify:conductor, and on a report error as the
// build does.
import { relative } from 'path';
import { itemPages } from '../generate-items';
import { npcPages } from '../generate-npcs';
import { shopPages } from '../generate-shops';
import { areaResolver } from './area-resolve';
import { NEAR_MISS_ALLOW, SPLIT_ALLOW, STAND_ALLOW } from './allow';
import { AREAS, EXPECTED_UNREACHED, type ExpectedUnreached } from './areas';
import {
    applyAllow,
    NEAR_MISS_GAP,
    nearMissAreas,
    splitResources,
    standConnectivity,
    type CheckId,
    type CheckResult,
} from './checks';
import { classifier } from './classify';
import { contentHash } from './content-hash';
import { minimalSets, questFacts, type QuestFacts } from './requirements';
import { formatDistance, nearestSinks, priceCrossings, SINKS, type DistanceReport } from './distance';
import { METHODS } from './methods';
import { methodModel, resolveMethods, toWorldMethod, type MethodModel } from './model/method';
import { legFinder } from './model/legs';
import { ROOT, WORLD_JSON } from './paths';
import { drift, readRenderData, renderWorld, writeFiles } from './render';
import { bySiteId, coord } from './render/common';
import {
    besideCluster,
    buildSites,
    footprint,
    locSizes,
    spawnClusters,
    type Placed,
    type PlacedLoc,
    type SiteOptions,
    type StepCollision,
} from './place';
import {
    actName,
    fillReach,
    formatReach,
    noLandingLine,
    reachGraph,
    STEPS,
    type LocEdit,
    type Reach,
    type ReachCollision,
    type ReachGraph,
    type ReachReport,
} from './reach';
import { first, readConfigs, type Config } from './sources/configs';
import { movementEnum, siteMovement } from './sources/fishing-movement';
import { deriveConnectors, WAY_BACK, type Underived } from './sources/connectors';
import { readCourses, stepAt } from './sources/courses';
import { deriveCuratedCrossings, refuseDerivedTwins, type CuratedCrossings } from './sources/curated-crossings';
import { deriveDbrowTeleports, type DbrowTeleports, type TeleportCollision } from './sources/dbrow-teleports';
import { readDbrows } from './sources/dbrows';
import { readAllMapSquares } from './sources/maps';
import { cameFromContext, deriveNpcTeleports, joinWaysIn, returnsTo, type NpcTeleports } from './sources/npc-teleports';
import { readPack } from './sources/packs';
import {
    CURATED_CROSSINGS,
    CURATED_TRANSPORTS,
    DBROW_TELEPORTS,
    GATES,
    LOADOUT_PROCS,
    NPC_TELEPORTS,
    QUEST_OVERRIDES,
    QUEST_VARP_EXCEPTIONS,
    TRANSPORTS_OUT_OF_SCOPE,
    USE_GATES,
    type UseGate,
} from './gates';
import { readConstants } from './sources/constants';
import { npcMovements, readMovementDefaults } from './sources/npc-movement';
import {
    deriveGateLandings,
    deriveScriptedMoves,
    type GateLandings,
    type ScriptedMoves,
} from './sources/gate-landings';
import {
    CROSS,
    placeGates,
    reviewGates,
    scanGates,
    scanTrigger,
    triggerKey,
    untimedQueues,
    type GateScanInput,
} from './sources/gate-scan';
import { toolCheckers } from './sources/conditions';
import { deriveLoadoutRules } from './sources/loadout';
import { deriveQuests, scanQuestCalls } from './sources/quests';
import { byTransport, curatedTransports, deriveSails, outOfScopeSites } from './sources/transports';
import {
    approachRange,
    parseCallables,
    parseQueues,
    parseTriggers,
    readScripts,
    type Trigger,
} from './sources/triggers';
import { coordTile } from './sources/runescript';
import { siteKeyMatches, siteKeyName, unresolved, type SiteKeyWorld } from './site-key';
import { readZones } from './sources/zones';
import {
    WORLD_FORMAT,
    type Area,
    type Crossing,
    type Feature,
    type FeatureKind,
    type NpcSpawn,
    type Site,
    type Tile,
    type World,
} from './types';
import { cmp, push } from './util';

/**
 * The kinds whose every site must lie in an area: what an agent picks a place by (banks, shops,
 * resources, services, thieving). `bun run world` and `--check` exit 1 on a site of these kinds
 * outside every area, so a new bank or mine can't go unnamed. `npc` and `connector` sites may be
 * anywhere; `npc` ones outside every area are only warned about.
 */
export const COVERED: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
    'bank',
    'shop',
    'tree',
    'rock',
    'fishing-spot',
    'tanner',
    'furnace',
    'anvil',
    'range',
    'fire',
    'spinning-wheel',
    'pottery-wheel',
    'pottery-oven',
    'sand-pit',
    'water-source',
    'altar',
    'rc-altar',
    'rc-ruins',
    'stall',
    'thieving-chest',
    'pickpocket',
    'flax',
    'agility-course',
]);

/** A site of a COVERED kind no walk from the Lumbridge spawn reaches (Site.reach `[]`): a curation to-do. */
export interface Unreached {
    id: string;
    kind: FeatureKind;
    /** The site's area path, as Site.areaPath. */
    areaPath: string[];
    /** Its stand tile, or its centre when it has none (`stand` false). */
    at: Tile;
    stand: boolean;
    /** The reached tile nearest `at` on its level and plane, within NEAREST_RADIUS; null when none is. */
    nearest: Tile | null;
}

/** How far (Chebyshev, in tiles) the unreached report looks for the nearest reached tile. */
export const NEAREST_RADIUS = 64;

/** The most tiles one pocket's flood takes before it stops and calls the pocket open. */
export const POCKET_CAP = 1 << 15;

/** A placed loc or npc spawn with triggers on its ops: a hint of the pockets it stands in or beside. */
export interface OpUser {
    config: string;
    tile: Tile;
    /** Its footprint as placed (place.ts footprint), 1 by 1 for an npc spawn. */
    w: number;
    l: number;
    /** The triggers on it (by config or category) of an op its config has, or of use-item. */
    triggers: readonly Trigger[];
}

/**
 * What the scan made of a hint's trigger: a gate candidate, of the kind gates.ts gives it (`reviewed`) or
 * else the scan proposes; a move with no condition read before it, to each GateMove.to; or no move found.
 */
export type HintScan =
    | { k: 'candidate'; kind: string; reviewed: boolean }
    | { k: 'move'; to: string[] }
    | { k: 'none' };

/** A trigger on a pocket's edge or inside it: the way out (or in) to look at first. */
export interface Hint {
    /** As the trigger's header names it (sources/gate-scan.ts triggerKey). */
    trigger: string;
    /** The trigger's header line, `file:line`. */
    source: string;
    scan: HintScan;
    /** Its placed locs or spawns in or beside the pocket, by tile. */
    at: { config: string; tile: Tile }[];
}

/**
 * The unreached sites a flood from one of them gets to: the walkable tiles neighbour steps and the graph's
 * edges lead to, never entering a reached tile (unreachedPockets).
 */
export interface Pocket {
    sites: Unreached[];
    /** Tiles the flood took. */
    size: number;
    /** The flood stopped at POCKET_CAP tiles: the sites are on a large unreached landmass, and the hints are only those of the tiles taken. */
    open: boolean;
    /** The nearest of its sites' nearest reached tiles (Unreached.nearest), `off` Chebyshev from `site`'s tile. */
    nearest: { tile: Tile; site: string; off: number } | null;
    /** Those the scan found a move in (a candidate, or a move with no condition) first, then by trigger and source. */
    hints: Hint[];
}

export interface BuildReport {
    features: Partial<Record<FeatureKind, number>>;
    sites: Partial<Record<FeatureKind, number>>;
    /** Ids of COVERED sites outside every area: the build fails on any. */
    uncovered: string[];
    /** Ids of `npc` sites outside every area. */
    npcUncovered: string[];
    /** Map placements whose id has no config in the pack, as `loc 1234` / `npc 56`, with a count. */
    unpacked: Record<string, number>;
    /** Lines buildSites logged (sites with no stand tile). */
    log: string[];
    connectors: {
        /** Connector rows written (World.connectors), and the locs they come from. */
        derived: number;
        locs: number;
        /** Rows with no connector back, as `config (x, z) op<n> <op name> -> (x, z) (script:line)`. */
        oneWay: string[];
        /** Connector ops with no landing, grouped by the construct that stopped them: `reason` -> locs. */
        underived: Record<string, string[]>;
        /** Rows whose landing is not walkable land, as oneWay lists them. */
        offLand: string[];
    };
    quests: {
        count: number;
        /** Ids of the quests read from gates.ts QUEST_OVERRIDES. */
        overrides: string[];
        /**
         * Quests with neither a readable journal call nor an override, as `<id>: <why>`, and journal
         * calls that can't be read: an error.
         */
        unread: string[];
        /** Overrides the scan no longer needs, and varp exceptions for quests not in the table: an error. */
        stale: string[];
    };
    transports: {
        /** Rows from the sail scripts, and the routes they sail. */
        ships: number;
        routes: number;
        /** Rows from gates.ts CURATED_TRANSPORTS. */
        curated: number;
        /** Sail paths left out as quest windows. */
        windows: string[];
        /** Sail triggers the walker could not finish, with what stopped it. */
        underived: string[];
        /** Sail sites no npc op reaches and gates.ts does not list as out of scope: an error. */
        unreached: string[];
        /** Sail sites gates.ts lists out of scope that are gone or now reached: an error. */
        staleOutOfScope: string[];
        /** sail.constant routes no npc sails. */
        unusedRoutes: string[];
        /** Transport rows with an other:<text> requirement, as `<npc> -> <route or kind>: <requirement>`. */
        other: string[];
        /** gates.ts TRANSPORTS_OUT_OF_SCOPE, as `<what> (<script>): <reason>`. */
        outOfScope: string[];
    };
    gates: {
        /** Loc op triggers the scan finds (sources/gate-scan.ts). */
        candidates: number;
        /** gates.ts entries by kind. */
        kinds: Record<string, number>;
        /** World.gates rows: placed locs of gates and quest windows. */
        placed: number;
        /** Requirement forms the confirmed gates use (`quest`, `skill`, ...), counted over their sets. */
        forms: Record<string, number>;
        /** Candidates gates.ts does not review: an error. */
        unreviewed: string[];
        /** gates.ts entries no candidate has: an error. */
        stale: string[];
        /** gates.ts overrides whose scan digest no longer matches the scan's proposal: an error. */
        drifted: string[];
        /** gates.ts entries malformed or at odds with the scan without a why: an error. */
        invalid: string[];
        /** Gate requirements `quest:<id>>=<n>` no stage constant names: an error. */
        unnamed: string[];
        /** Gates and quest windows with no placed loc. */
        unplaced: string[];
        /** Entries of kind unclear, as `<trigger> (<source>): <why>`. */
        unclear: string[];
        /** Quest windows, kept out of the fill, as `<trigger> (<source>): <why>`. */
        windows: string[];
        /** Gate requirements in no other form, as `<trigger>: <requirement>`. */
        other: string[];
        /** `*_checker` procs not read as tool checkers (sources/conditions.ts toolCheckers), with why. */
        skippedCheckers: string[];
        /**
         * Moving scripts queued with a delay other than 0 or on the weak queue, which the scan runs in the order
         * queued and as if they ran (sources/gate-scan.ts untimedQueues).
         */
        untimedQueues: string[];
        /**
         * Gate rows on objects whose move is not a coord literal (sources/gate-landings.ts): counted by
         * outcome, the rows no path derives (Task 3's unreached list), stands whose landing is off land,
         * stands of rows with landings that give none, free landings reached past a wait only, and moves onto the
         * loc's own tiles landed on the tiles stepped out to.
         */
        landings: Pick<
            GateLandings,
            'counts' | 'underived' | 'offLand' | 'unlanded' | 'rolled' | 'unrolled' | 'waited' | 'stepped'
        >;
    };
    /**
     * The loc op moves no gate row makes (sources/gate-landings.ts deriveScriptedMoves): the World.crossings rows
     * written, what came of each trigger and placed loc, the moves whose landing no run settles (warnings), and the
     * duplicates of a connector row (an error).
     */
    scripted: Pick<ScriptedMoves, 'counts' | 'unsettled' | 'duplicates'> & { rows: number };
    /**
     * The loc teleports to a dbrow's coords (sources/dbrow-teleports.ts): the World.crossings rows written, the placed
     * locs no tile on land is used from, and the landings off walkable land (warnings).
     */
    teleports: Pick<DbrowTeleports, 'unstood' | 'offLand'> & { rows: number };
    /**
     * The npc teleports to an enum's coords and their locs back (sources/npc-teleports.ts): the World.crossings rows
     * written, the spawn clusters and placed locs no tile on land is used from, the landings off walkable land, and
     * the rows' requirements in no other form, as `<act>: <requirement>` (warnings).
     */
    /** `unjoined`: the ways back to an npc no walk gets to the teleport of, left out (npc-teleports.ts joinWaysIn). */
    npcTeleports: Pick<NpcTeleports, 'unstood' | 'offLand'> & { rows: number; unjoined: string[]; other: string[] };
    /**
     * The curated crossings (sources/curated-crossings.ts): the World.crossings rows written, the placements no tile
     * on land is used from, the landings off walkable land, and those on a blocked tile landed beside (warnings).
     */
    curated: Pick<CuratedCrossings, 'unstood' | 'offLand' | 'stepped'> & { rows: number };
    /** The reach fill's own report (reach.ts). */
    reach: ReachReport;
    /** The searches for each resource and processor site's nearest sinks (distance.ts). */
    distance: DistanceReport;
    /** Crossing and rolled gate rows the distances could not price (distance.ts priceCrossings), as `<row>: <why>`. */
    unpriced: string[];
    /**
     * Landings no walk leaves for the rest of their row's (distance.ts strandedLandings), as `<row> (<source>):
     * <landing>`: given no spread, so no distance goes by them.
     */
    stranded: string[];
    /** Sites of COVERED kinds no walk reaches, grouped by pocket: warnings, the curation to-do list. */
    unreached: {
        pockets: Pocket[];
        /** Unreached sites areas.ts EXPECTED_UNREACHED leaves out. */
        expected: number;
        /** EXPECTED_UNREACHED entries naming no such area or site, as `area <id> (<source>)`: an error. */
        invalid: string[];
        /** EXPECTED_UNREACHED entries of an existing area or site no unreached site matches, named the same: an error. */
        stale: string[];
    };
    /** The methods.ts records resolved, and the ones that do not, as `methods.ts <id>: <reason>`: an error. */
    methods: { resolved: number; errors: string[] };
    /** Each build check's findings less its allowlist (checks.ts, allow.ts): what is left, invalid or stale is an error. */
    checks: Record<CheckId, CheckResult>;
}

/** Whether the report has an error, which fails `bun run world` and `--check`. */
export const failed = (r: BuildReport): boolean =>
    r.uncovered.length > 0 ||
    r.quests.unread.length > 0 ||
    r.quests.stale.length > 0 ||
    r.transports.unreached.length > 0 ||
    r.transports.staleOutOfScope.length > 0 ||
    r.gates.unreviewed.length > 0 ||
    r.gates.stale.length > 0 ||
    r.gates.drifted.length > 0 ||
    r.gates.invalid.length > 0 ||
    r.gates.unnamed.length > 0 ||
    r.scripted.duplicates.length > 0 ||
    r.unreached.invalid.length > 0 ||
    r.unreached.stale.length > 0 ||
    r.methods.errors.length > 0 ||
    Object.values(r.checks).some(c => c.left.length > 0 || c.invalid.length > 0 || c.stale.length > 0);

export interface BuildInput {
    generatedFrom: string;
    areas: readonly Area[];
    collision: ReachCollision & TeleportCollision & Pick<StepCollision, 'walled'>;
}

/** The written order: kind, x, z, level, config, then the rest of a feature's identity. */
export const byWritten = (a: Feature, b: Feature): number =>
    cmp(a.kind, b.kind) ||
    a.tile.x - b.tile.x ||
    a.tile.z - b.tile.z ||
    a.tile.level - b.tile.level ||
    cmp(a.config, b.config) ||
    cmp(a.source, b.source) ||
    a.id - b.id ||
    (a.shape ?? 0) - (b.shape ?? 0) ||
    (a.rotation ?? 0) - (b.rotation ?? 0) ||
    cmp(a.subtype, b.subtype);

const outside = (s: Site): boolean => s.areaPath.length === 0;

const tally = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => {
    const counted = new Map<string, number>();
    for (const x of xs) {
        const k = key(x);
        counted.set(k, (counted.get(k) ?? 0) + 1);
    }
    return Object.fromEntries([...counted].sort(([a], [b]) => cmp(a, b)));
};

/**
 * The reached tile nearest `t` on its level and plane (the surface, or the underground at z >= 6400): the
 * first Chebyshev ring out to `radius` that holds one, and in it the nearest in a straight line, then by x and
 * z; null when none is.
 */
export function nearestReached(reached: (t: Tile) => boolean, t: Tile, radius = NEAREST_RADIUS): Tile | null {
    const underground = t.z >= 6400;
    for (let r = 0; r <= radius; r++) {
        let best: Tile | null = null;
        let bestD = Infinity;
        for (let dx = -r; dx <= r; dx++)
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const c = { level: t.level, x: t.x + dx, z: t.z + dz };
                if (c.z >= 6400 !== underground || !reached(c)) continue;
                const d = dx * dx + dz * dz;
                if (d < bestD || (d === bestD && best && (c.x < best.x || (c.x === best.x && c.z < best.z)))) {
                    best = c;
                    bestD = d;
                }
            }
        if (best) return best;
    }
    return null;
}

/**
 * What using a site asks, as alternatives, one per kind of its features (gates.ts USE_GATES): `[[]]` when one of
 * them is free. Throws on a gate whose config no feature is placed as.
 */
export function useSets(
    features: readonly Pick<Feature, 'config'>[],
    gates: readonly UseGate[],
): (s: Pick<Site, 'features'>) => string[][] {
    const byConfig = new Map(gates.map(g => [g.config, g.requires]));
    const placedConfigs = new Set(features.map(f => f.config));
    const stale = gates.filter(g => !placedConfigs.has(g.config)).map(g => g.config);
    if (stale.length) throw new Error(`USE_GATES names configs no feature is placed as: ${stale.join(', ')}`);
    return s => {
        const sets = s.features.map(i => byConfig.get(features[i]!.config) ?? []);
        return sets.some(r => !r.length) ? [[]] : sets;
    };
}

/**
 * Each site's reach, the sets of its stand tile, and each npc spawn cluster's, the minimal sets over the tiles
 * `beside` gives it (place.ts besideCluster; types.ts NpcSpawn.reach): the cheapest way beside any of its
 * spawns, not the nearest tile's, which may sit behind a door the cheapest way does not need. A site's sets
 * join `use.sets`' alternatives (useSets: what using one of its features asks). Also the COVERED sites none
 * reaches, by area path then id.
 */
export function addReach(
    placed: { sites: readonly Placed<Site>[]; npcSpawns: readonly Placed<NpcSpawn>[] },
    reach: Pick<Reach, 'setsAt' | 'setsAny' | 'reached'>,
    beside: (c: Placed<NpcSpawn>) => Tile[],
    use: { sets: (s: Placed<Site>) => string[][]; quests?: QuestFacts } = { sets: () => [[]] },
): { sites: Site[]; npcSpawns: NpcSpawn[]; unreached: Unreached[] } {
    const sites = placed.sites.map(s => {
        if (!s.stand) return { ...s, reach: [] };
        const walk = reach.setsAt(s.stand);
        const gated = use.sets(s);
        if (gated.length === 1 && !gated[0]!.length) return { ...s, reach: walk };
        return {
            ...s,
            reach: minimalSets(
                walk.flatMap(w => gated.map(g => [...w, ...g])),
                use.quests,
            ),
        };
    });
    const npcSpawns = placed.npcSpawns.map(c => ({ ...c, reach: reach.setsAny(beside(c)) }));
    const unreached = sites
        .filter(s => COVERED.has(s.kind) && !s.reach.length)
        .map(s => {
            const at = s.stand ?? s.centre;
            return {
                id: s.id,
                kind: s.kind,
                areaPath: s.areaPath,
                at,
                stand: s.stand !== null,
                nearest: nearestReached(reach.reached, at),
            };
        })
        .sort((a, b) => cmp(a.areaPath.join('/'), b.areaPath.join('/')) || bySiteId(a.id, b.id));
    return { sites, npcSpawns, unreached };
}

/** An EXPECTED_UNREACHED entry as the report names it. */
const expectedName = (e: ExpectedUnreached): string =>
    `${'site' in e ? `site ${siteKeyName(e.site)}` : `area ${e.area}`} (${e.source})`;

/**
 * The unreached sites areas.ts EXPECTED_UNREACHED does not match (an entry by the site its SiteKey resolves to in
 * `known.world`, or by an area on the site's area path), how many it does, the entries naming no area in `known`
 * or whose key resolves to no site or several: invalid, and the other entries that match no unreached site:
 * stale. Both are errors.
 */
export function expectedUnreached(
    unreached: readonly Unreached[],
    expected: readonly ExpectedUnreached[],
    known: { areas: ReadonlySet<string>; world: SiteKeyWorld },
): { left: Unreached[]; expected: number; invalid: string[]; stale: string[] } {
    const matches = siteKeyMatches(known.world);
    const siteOf = new Map<ExpectedUnreached, string>();
    const invalid: string[] = [];
    for (const e of expected) {
        if (!('site' in e)) {
            if (!known.areas.has(e.area)) invalid.push(expectedName(e));
            continue;
        }
        const ids = matches(e.site);
        if (ids.length === 1) siteOf.set(e, ids[0]!);
        else invalid.push(`${expectedName(e)}: ${unresolved(ids)}`);
    }
    const valid = (e: ExpectedUnreached): boolean => ('site' in e ? siteOf.has(e) : known.areas.has(e.area));
    const used = new Set<ExpectedUnreached>();
    const left = unreached.filter(u => {
        const hits = expected.filter(e => ('site' in e ? siteOf.get(e) === u.id : u.areaPath.includes(e.area)));
        for (const e of hits) used.add(e);
        return !hits.length;
    });
    return {
        left,
        expected: unreached.length - left.length,
        invalid,
        stale: expected.filter(e => valid(e) && !used.has(e)).map(expectedName),
    };
}

export interface PocketInput {
    graph: Pick<ReachGraph, 'index' | 'edgeFrom' | 'stepMask' | 'within'>;
    /** Whether the fill reached a tile (Reach.reached). */
    reached: (t: Tile) => boolean;
    /** In report order: a pocket comes out where its first site is. */
    unreached: readonly Unreached[];
    users: readonly OpUser[];
    /** What the scan makes of a trigger; called once for each trigger the pockets list. */
    scanOf: (t: Trigger) => HintScan;
    /** POCKET_CAP by default. */
    cap?: number;
}

/**
 * The unreached sites by pocket (Pocket). Each site floods from its tile (Unreached.at) unless an earlier
 * flood took it; a flood that steps onto another's tiles joins its pocket, as edges are one way. A site whose
 * tile is off land, or reached (a centre with no stand), is a pocket of its own with no tiles. Hints are the
 * users with a tile of their footprint on, or beside (one tile, any direction), a tile of the pocket.
 */
export function unreachedPockets(input: PocketInput): Pocket[] {
    const { graph, reached, unreached, users, scanOf } = input;
    const { index, edgeFrom, stepMask } = graph;
    const cap = input.cap ?? POCKET_CAP;
    return graph.within(() => {
        // Each tile's pocket (its flood's id; find gives the pocket it joined), -1 when none took it.
        const owner = new Int32Array(index.size).fill(-1);
        const parent: number[] = [];
        const size: number[] = [];
        const open: boolean[] = [];
        const find = (p: number): number => {
            while (parent[p] !== p) p = parent[p] = parent[parent[p]!]!;
            return p;
        };
        // The lower id stays the root, so a pocket keeps its first site's place.
        const join = (a: number, b: number): void => {
            const [x, y] = [find(a), find(b)];
            if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
        };
        const queue = new Int32Array(cap);
        const pocketOf = unreached.map(u => {
            const s = index.of(u.at.level, u.at.x, u.at.z);
            if (s >= 0 && owner[s]! >= 0) return owner[s]!;
            const p = parent.length;
            parent.push(p);
            size.push(0);
            open.push(false);
            if (s < 0 || reached(u.at)) return p;
            owner[s] = p;
            queue[0] = s;
            let n = 1;
            const visit = (j: number): void => {
                const o = owner[j]!;
                if (o === p) return;
                if (o >= 0) return join(o, p);
                if (reached(index.tile(j))) return;
                if (n === cap) {
                    open[p] = true;
                    return;
                }
                owner[j] = p;
                queue[n++] = j;
            };
            for (let h = 0; h < n; h++) {
                const i = queue[h]!;
                const m = stepMask(i);
                const [level, x, z] = [index.level(i), index.x(i), index.z(i)];
                for (let bit = 0; bit < 8; bit++)
                    if (m & (1 << bit)) visit(index.of(level, x + STEPS[bit]![0], z + STEPS[bit]![1]));
                for (const e of edgeFrom.get(i) ?? []) visit(e.to);
            }
            size[p] = n;
            return p;
        });

        // The hints of each pocket, by root then trigger.
        const scans = new Map<Trigger, HintScan>();
        const hints = new Map<number, Map<Trigger, Hint['at']>>();
        for (const u of users) {
            const near = new Set<number>();
            for (let dx = -1; dx <= u.w; dx++)
                for (let dz = -1; dz <= u.l; dz++) {
                    const j = index.of(u.tile.level, u.tile.x + dx, u.tile.z + dz);
                    if (j >= 0 && owner[j]! >= 0) near.add(find(owner[j]!));
                }
            for (const root of near) {
                let byTrigger = hints.get(root);
                if (!byTrigger) hints.set(root, (byTrigger = new Map()));
                for (const t of u.triggers) push(byTrigger, t, { config: u.config, tile: u.tile });
            }
        }
        const scanned = (t: Trigger): HintScan => {
            let s = scans.get(t);
            if (!s) scans.set(t, (s = scanOf(t)));
            return s;
        };
        const hintsOf = (root: number): Hint[] =>
            [...(hints.get(root) ?? [])]
                .map(([t, at]) => ({
                    trigger: triggerKey(t),
                    source: `${t.file}:${t.line}`,
                    scan: scanned(t),
                    at: at.sort(
                        (a, b) =>
                            a.tile.level - b.tile.level ||
                            a.tile.x - b.tile.x ||
                            a.tile.z - b.tile.z ||
                            cmp(a.config, b.config),
                    ),
                }))
                .sort(
                    (a, b) =>
                        Number(a.scan.k === 'none') - Number(b.scan.k === 'none') ||
                        cmp(a.trigger, b.trigger) ||
                        cmp(a.source, b.source),
                );

        const byRoot = new Map<number, Unreached[]>();
        unreached.forEach((u, k) => push(byRoot, find(pocketOf[k]!), u));
        return [...byRoot].map(([root, sites]): Pocket => {
            const members = [...new Set(pocketOf)].filter(p => find(p) === root);
            let nearest: Pocket['nearest'] = null;
            for (const s of sites) {
                if (!s.nearest) continue;
                const off = cheb(s.at, s.nearest);
                if (!nearest || off < nearest.off) nearest = { tile: s.nearest, site: s.id, off };
            }
            return {
                sites,
                size: members.reduce((n, p) => n + size[p]!, 0),
                open: members.some(p => open[p]),
                nearest,
                hints: hintsOf(root),
            };
        });
    });
}

/**
 * The placed locs and npc spawns with triggers on their ops (OpUser): a trigger on the config or its
 * category, of an op the config has (`op<n>=`) or of use-item.
 */
function opUsers(input: {
    triggers: readonly Trigger[];
    configs: Record<'loc' | 'npc', ReadonlyMap<string, Config>>;
    locs: readonly PlacedLoc[];
    npcs: readonly { config: string; tile: Tile }[];
    size: SiteOptions['size'];
}): OpUser[] {
    const byTarget = new Map<string, Trigger[]>();
    for (const t of input.triggers) push(byTarget, `${t.on}:${t.category ? '_' : ''}${t.target}`, t);
    const cache = new Map<string, Trigger[]>();
    const triggersOn = (on: 'loc' | 'npc', config: string): Trigger[] => {
        const key = `${on}:${config}`;
        let ts = cache.get(key);
        if (!ts) {
            const cfg = input.configs[on].get(config);
            const category = first(cfg, 'category');
            ts = [...(byTarget.get(key) ?? []), ...(category ? (byTarget.get(`${on}:_${category}`) ?? []) : [])].filter(
                t => t.op === 'u' || cfg?.[`op${t.op}`],
            );
            cache.set(key, ts);
        }
        return ts;
    };
    const out: OpUser[] = [];
    for (const l of input.locs) {
        const triggers = triggersOn('loc', l.config);
        if (!triggers.length) continue;
        const { w, l: length } = footprint(l, input.size);
        out.push({ config: l.config, tile: l.tile, w, l: length, triggers });
    }
    for (const n of input.npcs) {
        const triggers = triggersOn('npc', n.config);
        if (triggers.length) out.push({ config: n.config, tile: n.tile, w: 1, l: 1, triggers });
    }
    return out;
}

/**
 * Whether a player on one tile sees another, for the stand rule's approach ops (place.ts SiteOptions.approach): a line
 * of walk between them with the locs that block walking but not sight cleared (blockrange=no: the Burthorpe Games
 * Room's bar pumps), as the collision data has no sight flags (rsmod's LOC_PROJ_BLOCKER and wall ones), so its own
 * line of sight passes every loc. Every wall and every other loc that blocks walking is taken to block sight.
 */
function sightOf(
    collision: BuildInput['collision'],
    locs: readonly PlacedLoc[],
    configs: Map<string, Config>,
): (from: Tile, to: Tile) => boolean {
    const size = locSizes(configs);
    // The footprint of each centrepiece that blocks walking but not sight, by every tile of it.
    const clear = new Map<string, LocEdit[]>();
    for (const l of locs) {
        const cfg = configs.get(l.config);
        if ((l.shape !== 10 && l.shape !== 11) || first(cfg, 'blockrange') !== 'no' || first(cfg, 'blockwalk') === 'no')
            continue;
        const { w, l: length } = footprint(l, size);
        const edit: LocEdit = { tile: l.tile, width: w, length };
        for (let dx = 0; dx < w; dx++)
            for (let dz = 0; dz < length; dz++) push(clear, `${l.tile.level} ${l.tile.x + dx} ${l.tile.z + dz}`, edit);
    }
    return (from, to) => {
        const open = new Set<LocEdit>();
        for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++)
            for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++)
                for (const e of clear.get(`${from.level} ${x} ${z}`) ?? []) open.add(e);
        return collision.edited({ close: [], open: [...open] }, () =>
            collision.line('walk', from.level, from.x, from.z, to.x, to.z),
        );
    };
}

/** An underived connector op as the report lists it: `config (x, z) op<n>`. */
const named = (u: Underived): string => `${u.config} ${coord(u.loc)} op${u.op}`;

/** Reads the game data and builds the world, without writing anything. */
export function buildWorld({ generatedFrom, areas, collision }: BuildInput): {
    world: World;
    report: BuildReport;
    /** The model the methods were resolved with, which the training pages rate them with (readRenderData). */
    model: MethodModel;
} {
    const locConfigs = readConfigs('loc');
    const npcConfigs = readConfigs('npc');
    const scripts = readScripts();
    const triggers = scripts.flatMap(([f, text]) => parseTriggers(f, text));
    const callables = scripts.flatMap(([f, text]) => parseCallables(f, text));
    const dbrows = readDbrows();
    const courses = readCourses(triggers, callables);
    const classify = classifier({
        locConfigs,
        npcConfigs,
        dbrows,
        triggers,
        callables,
        courses,
    });
    const courseStep = (f: Pick<Feature, 'subtype' | 'config' | 'tile'>) => {
        const course = courses.find(c => c.course === f.subtype);
        return course && stepAt(course, f.config, first(locConfigs.get(f.config), 'category'), f.tile);
    };
    const packs = { loc: readPack('loc'), npc: readPack('npc') };
    const map = readAllMapSquares();

    const unpacked: string[] = [];
    const features: Feature[] = [];
    // One feature per use classify gives a placement (Fadli is a bank and a shop, Razmire two shops). Spawns without
    // combat stats need no filter: classify.ts gives the `npc` kind only to configs that have them.
    const place = (source: 'loc' | 'npc', id: number, rest: Pick<Feature, 'tile' | 'shape' | 'rotation'>): void => {
        const config = packs[source].name.get(id);
        if (config === undefined) {
            unpacked.push(`${source} ${id}`);
            return;
        }
        for (const c of classify(source, config)) {
            // A course obstacle whose step is guarded to one tile is one only there (sources/courses.ts CourseStep.at).
            if (c.kind === 'agility-course' && !courseStep({ subtype: c.subtype, config, tile: rest.tile })) continue;
            features.push({ source, id, config, ...rest, kind: c.kind, subtype: c.subtype, name: c.name });
        }
    };
    for (const l of map.locs) place('loc', l.id, { tile: l.tile, shape: l.shape, rotation: l.rotation });
    for (const n of map.npcs) place('npc', n.id, { tile: n.tile });
    // Sorted before buildSites, as a site's `features` are indexes into this array.
    features.sort(byWritten);

    const resolve = areaResolver(areas);
    const zones = readZones();
    // Every placed npc, classified or not, so an npc page can say where any npc stands. A spawn with no
    // config is in `unpacked` already.
    const spawns = map.npcs.flatMap(n => {
        const config = packs.npc.name.get(n.id);
        return config === undefined ? [] : [{ config, tile: n.tile }];
    });
    const constants = readConstants();
    const movements = npcMovements(npcConfigs, scripts, readMovementDefaults(), constants);
    const movement = (config: string) => {
        const m = movements.get(config);
        if (!m) throw new Error(`npc ${config} is placed but has no config`);
        return m;
    };
    const placedSpawns = spawnClusters(spawns, resolve, zones, movement);

    const { connectors, underived, oneWay } = deriveConnectors({
        features,
        triggers,
        callables,
        locConfigs,
        collision,
        size: locSizes(locConfigs),
        constants,
    });
    const row = (i: number): string => {
        const c = connectors[i]!;
        return `${features[c.feature]!.config} ${coord(c.loc)} op${c.op} ${c.opName} -> ${coord(c.landing)} (${c.source})`;
    };
    const byReason = new Map<string, string[]>();
    for (const u of underived) push(byReason, u.reason, named(u));

    const quests = deriveQuests({
        scan: scanQuestCalls(scripts),
        constants,
        varps: readPack('varp'),
        varbits: readConfigs('varbit'),
        overrides: QUEST_OVERRIDES,
        decreasing: QUEST_VARP_EXCEPTIONS,
    });
    const loadoutRules = deriveLoadoutRules(LOADOUT_PROCS, callables);
    const objConfigs = readConfigs('obj');
    // The tool-checker procs and the obj categories they accept, read from the procs and the obj configs.
    const { tools, skipped: skippedCheckers } = toolCheckers(
        callables,
        new Map([...objConfigs].flatMap(([obj, cfg]) => (cfg.category?.[0] ? [[obj, cfg.category[0]]] : []))),
    );
    const sails = deriveSails({
        files: scripts,
        triggers,
        callables,
        constants,
        npcConfigs,
        spawns,
        quests: quests.quests,
        loadoutProcs: LOADOUT_PROCS,
    });
    const curated = curatedTransports(
        CURATED_TRANSPORTS,
        spawns,
        map.locs.flatMap(l => {
            const config = packs.loc.name.get(l.id);
            return config === undefined ? [] : [{ config, tile: l.tile }];
        }),
    );
    const transports = [...sails.transports, ...curated].sort(byTransport);
    const placedLocs = map.locs.flatMap(l => {
        const config = packs.loc.name.get(l.id);
        return config === undefined ? [] : [{ config, tile: l.tile, shape: l.shape, rotation: l.rotation }];
    });
    const scan: GateScanInput = {
        triggers,
        callables,
        queues: scripts.flatMap(([f, text]) => parseQueues(f, text)),
        constants,
        quests: quests.quests,
        loadoutProcs: LOADOUT_PROCS,
        names: new Set([...objConfigs.keys(), ...locConfigs.keys(), ...npcConfigs.keys()]),
        tools,
    };
    // One walker and one run of each trigger, shared by the gate scan, the unreached report's hints and the
    // untimed queues.
    const scanOne = scanTrigger(scan);
    const candidates = scanGates(scan, scanOne);
    const review = reviewGates(candidates, GATES, new Map(scripts));
    const gates = placeGates({
        curated: GATES,
        candidates,
        triggers,
        locConfigs,
        locs: placedLocs,
        quests: quests.quests,
        constants,
    });
    // Where each gated move on an object lands.
    const landings = deriveGateLandings({
        gates: gates.gates,
        scan,
        candidates,
        locConfigs,
        collision,
        size: locSizes(locConfigs),
        locs: placedLocs,
    });
    // Each quest's stages are the constants its gates compare with (Quest.stages).
    const questRows = quests.quests.map(q => {
        const staged = gates.stages.get(q.id);
        return staged ? { ...q, stages: Object.fromEntries([...staged].sort(([a], [b]) => cmp(a, b))) } : q;
    });
    // The loc op moves no gate row makes: the crossing rows.
    const scripted = deriveScriptedMoves({
        scan,
        scanOf: scanOne,
        curated: GATES,
        locConfigs,
        locs: placedLocs,
        collision,
        size: locSizes(locConfigs),
        connectors,
    });
    // The loc teleports to a dbrow's coords: the runecrafting ruins and their temples' exit portals.
    const teleports = deriveDbrowTeleports({
        entries: DBROW_TELEPORTS,
        triggers,
        scripts: new Map(scripts),
        dbrows,
        locConfigs,
        objConfigs,
        locs: placedLocs,
        collision,
        size: locSizes(locConfigs),
    });
    // The npc teleports to an enum's coords: the essence mine's wizards and its portals back.
    const npcTeleports = deriveNpcTeleports({
        entries: NPC_TELEPORTS,
        triggers,
        callables,
        scripts: new Map(scripts),
        constants,
        enums: readConfigs('enum'),
        npcConfigs,
        locConfigs,
        quests: quests.quests,
        spawns: placedSpawns,
        locs: placedLocs,
        collision,
        size: locSizes(locConfigs),
    });
    // The curated teleports and moves (gates.ts CURATED_CROSSINGS), each checked against its script.
    const curatedCrossings = deriveCuratedCrossings({
        entries: CURATED_CROSSINGS,
        triggers,
        scripts: new Map(scripts),
        constants,
        scanOf: scanOne,
        spawns: placedSpawns,
        locs: placedLocs,
        collision,
        size: locSizes(locConfigs),
    });
    refuseDerivedTwins(curatedCrossings.crossings, [
        ...scripted.crossings,
        ...teleports.crossings,
        ...npcTeleports.crossings,
    ]);
    const rows: Crossing[] = [...scripted.crossings, ...teleports.crossings, ...curatedCrossings.crossings];
    const world0 = { features, connectors, gates: landings.gates, transports, quests: questRows };
    // A way back by the mine's portals asks what got the way in to its wizard (sources/npc-teleports.ts joinWaysIn),
    // read off a fill without the ways back.
    const wayIn = fillReach({
        world: { ...world0, crossings: [...rows, ...npcTeleports.crossings.filter(c => returnsTo(c) === undefined)] },
        collision,
        size: locSizes(locConfigs),
    });
    const { crossings: npcRows, unjoined } = joinWaysIn(npcTeleports.crossings, wayIn, questFacts(questRows));
    const crossingRows: Crossing[] = [...rows, ...npcRows];
    // What a walk from the Lumbridge spawn needs to get to each tile (reach.ts), over the rows just built; the
    // distances to sinks walk the same graph. The crossing and rolled gate rows' costs are priced over a first
    // graph (distance.ts priceCrossings), and the graph is built again from the priced rows when there was anything
    // to price (priceCrossings returns new rows only then).
    const unpricedInput = {
        world: { ...world0, crossings: crossingRows },
        collision,
        size: locSizes(locConfigs),
    };
    const unpricedGraph = reachGraph(unpricedInput);
    const priced = priceCrossings(unpricedGraph, unpricedInput.world);
    const repriced = priced.crossings !== crossingRows || priced.gates !== landings.gates;
    const reachInput = repriced
        ? { ...unpricedInput, world: { ...unpricedInput.world, gates: priced.gates, crossings: priced.crossings } }
        : unpricedInput;
    const graph = repriced ? reachGraph(reachInput) : unpricedGraph;
    const fill = fillReach(reachInput, graph);
    // Sites after the fill, so a stand is a tile a walk gets to where one can be (place.ts standTile).
    const log: string[] = [];
    const apRange = approachRange(triggers);
    const placedSites = buildSites(features, resolve, zones, collision, {
        size: locSizes(locConfigs),
        log: line => log.push(line),
        walked: fill.reached,
        free: t => fill.setsAt(t).some(set => set.length === 0),
        approach: {
            range: config => apRange(config, first(npcConfigs.get(config), 'category')),
            inSight: sightOf(collision, placedLocs, locConfigs),
        },
        courses: { defs: courses, step: courseStep },
        shore: f => (f.kind === 'fishing-spot' ? movementEnum(npcConfigs.get(f.config)) : undefined),
        movement,
    }).sort((a, b) => cmp(a.id, b.id));
    // The doors walled once for every cluster's beside tiles (place.ts besideCluster), not once per cluster.
    const walled = collision.walled ?? (<T>(f: () => T): T => f());
    const use = useSets(features, USE_GATES);
    const reached = walled(() =>
        addReach({ sites: placedSites, npcSpawns: placedSpawns }, fill, c => besideCluster(c, collision), {
            sets: use,
            quests: graph.quests,
        }),
    );
    const { npcSpawns, unreached } = reached;
    // Each resource and processor site's nearest bank and processors, by run ticks from its stand (distance.ts).
    // A way out by a portal of the essence mine returns to the wizard it came in by (sources/npc-teleports.ts).
    const context = cameFromContext(reachInput.world.crossings);
    const distance = nearestSinks(graph, reached.sites, { reached: fill.reachedAt, context });
    const movementEnums = readConfigs('enum');
    const sites = reached.sites.map(s => {
        const withNearest = SINKS[s.kind] ? { ...s, nearest: distance.nearest.get(s.id) ?? {} } : s;
        return s.kind === 'fishing-spot'
            ? {
                  ...withNearest,
                  movement: siteMovement(
                      s.features.map(i => features[i]!),
                      npcConfigs,
                      movementEnums,
                  ),
              }
            : withNearest;
    });
    // Every curated method resolved over the same graph, with the sites' nearest sinks (model/method.ts).
    // The model is built once: the training pages rate the methods with it too.
    const model = methodModel(
        {
            dbrows,
            objs: objConfigs,
            locs: locConfigs,
            structs: readConfigs('struct'),
            npcs: npcConfigs,
            params: readConfigs('param'),
            constants,
            scripts,
            hunts: readConfigs('hunt'),
        },
        zones,
    );
    const methods = resolveMethods(
        METHODS,
        {
            world: { sites, features, crossings: reachInput.world.crossings, gates: reachInput.world.gates },
            ...model,
            quests: graph.quests,
        },
        legFinder(graph, reachInput.world.crossings),
    );
    const sailSiteCheck = outOfScopeSites(
        sails.unreached,
        TRANSPORTS_OUT_OF_SCOPE.filter(o => o.sailSite).map(o => o.script),
    );
    const checkWorld = { sites, features, areas };
    const checks: Record<CheckId, CheckResult> = {
        'near-miss': applyAllow(nearMissAreas(checkWorld, COVERED), NEAR_MISS_ALLOW, checkWorld),
        split: applyAllow(splitResources(checkWorld, COVERED), SPLIT_ALLOW, checkWorld),
        stand: applyAllow(
            standConnectivity(checkWorld, { graph, collision, size: locSizes(locConfigs), reach: fill, use, context }),
            STAND_ALLOW,
            checkWorld,
        ),
    };
    const expected = expectedUnreached(unreached, EXPECTED_UNREACHED, {
        areas: new Set(areas.map(a => a.id)),
        world: { sites: reached.sites, features },
    });
    // By the fill's own line for the row; rows the line can't tell apart share it, with every reason each gives.
    const noLanding = new Map<string, string[]>();
    for (const u of landings.underived) for (const r of u.reasons) push(noLanding, noLandingLine(u), r);
    const curatedKind = new Map(GATES.map(e => [e.trigger, e.kind]));
    // The pocket flood reads steps through graph.stepMask, which adds to graph.offLand; the fill's report took
    // its offLand count already, so this has to stay after fillReach.
    const pockets = unreachedPockets({
        graph,
        reached: fill.reached,
        unreached: expected.left,
        users: opUsers({
            triggers,
            configs: { loc: locConfigs, npc: npcConfigs },
            locs: placedLocs,
            npcs: spawns,
            size: locSizes(locConfigs),
        }),
        scanOf: t => {
            const s = scanOne(t);
            if (!s) return { k: 'none' };
            if ('moves' in s) return { k: 'move', to: s.moves };
            const kind = curatedKind.get(s.candidate.trigger);
            return { k: 'candidate', kind: kind ?? s.candidate.kind, reviewed: kind !== undefined };
        },
    });

    return {
        model,
        world: {
            format: WORLD_FORMAT,
            generatedFrom,
            areas: [...areas],
            features,
            sites,
            npcSpawns,
            connectors,
            quests: questRows,
            loadoutRules,
            transports,
            gates: reachInput.world.gates,
            crossings: reachInput.world.crossings,
            methods: methods.methods.map(toWorldMethod),
        },
        report: {
            features: tally(features, f => f.kind),
            sites: tally(sites, s => s.kind),
            uncovered: sites.filter(s => COVERED.has(s.kind) && outside(s)).map(s => s.id),
            npcUncovered: sites.filter(s => s.kind === 'npc' && outside(s)).map(s => s.id),
            unpacked: tally(unpacked, u => u),
            log,
            connectors: {
                derived: connectors.length,
                locs: new Set(connectors.map(c => c.feature)).size,
                oneWay: oneWay.map(row),
                underived: Object.fromEntries([...byReason].sort(([a], [b]) => cmp(a, b))),
                offLand: connectors.flatMap((c, i) =>
                    collision.land(c.landing.level, c.landing.x, c.landing.z) &&
                    collision.walkable(c.landing.level, c.landing.x, c.landing.z)
                        ? []
                        : [row(i)],
                ),
            },
            quests: {
                count: quests.quests.length,
                overrides: QUEST_OVERRIDES.map(o => o.id).sort(cmp),
                unread: quests.unread,
                stale: quests.stale,
            },
            transports: {
                ships: sails.transports.length,
                routes: new Set(sails.transports.map(t => t.route)).size,
                curated: curated.length,
                windows: sails.windows,
                underived: sails.underived,
                unreached: sailSiteCheck.unreached,
                staleOutOfScope: sailSiteCheck.stale,
                unusedRoutes: sails.unusedRoutes,
                other: [
                    ...new Set(
                        transports.flatMap(t =>
                            t.requires
                                .filter(r => r.startsWith('other:'))
                                .map(r => `${t.npc ?? t.loc} -> ${t.route ?? t.kind}: ${r}`),
                        ),
                    ),
                ],
                outOfScope: TRANSPORTS_OUT_OF_SCOPE.map(o => `${o.what} (${o.script}): ${o.reason}`),
            },
            gates: {
                candidates: candidates.length,
                kinds: tally(GATES, e => e.kind),
                placed: gates.gates.length,
                forms: tally(
                    GATES.flatMap(e => (e.kind === 'gate' ? (e.requires ?? []).flat() : [])),
                    r => r.replace(/:.*/, ''),
                ),
                unreviewed: review.unreviewed,
                stale: review.stale,
                drifted: review.drifted,
                invalid: review.invalid,
                unnamed: gates.unnamed,
                unplaced: gates.unplaced,
                unclear: GATES.filter(e => e.kind === 'unclear').map(e => `${e.trigger} (${e.source}): ${e.why}`),
                windows: GATES.filter(e => e.kind === 'quest-window').map(e => `${e.trigger} (${e.source}): ${e.why}`),
                other: GATES.flatMap(e =>
                    (e.requires ?? []).flat().flatMap(r => (r.startsWith('other:') ? [`${e.trigger}: ${r}`] : [])),
                ),
                skippedCheckers,
                untimedQueues: untimedQueues(scan, scanOne),
                landings: {
                    counts: landings.counts,
                    underived: landings.underived,
                    offLand: landings.offLand,
                    unlanded: landings.unlanded,
                    rolled: landings.rolled,
                    unrolled: landings.unrolled,
                    waited: landings.waited,
                    stepped: landings.stepped,
                },
            },
            scripted: {
                rows: scripted.crossings.length,
                counts: scripted.counts,
                unsettled: scripted.unsettled,
                duplicates: scripted.duplicates,
            },
            teleports: { rows: teleports.crossings.length, unstood: teleports.unstood, offLand: teleports.offLand },
            curated: {
                rows: curatedCrossings.crossings.length,
                unstood: curatedCrossings.unstood,
                offLand: curatedCrossings.offLand,
                stepped: curatedCrossings.stepped,
            },
            npcTeleports: {
                rows: npcRows.length,
                unstood: npcTeleports.unstood,
                offLand: npcTeleports.offLand,
                unjoined: unjoined.map(c => `${actName(c)} ${coord(c.at)}: ${c.requires[0]!.join(' ')}`),
                other: [
                    ...new Set(
                        npcRows.flatMap(c =>
                            c.requires
                                .flat()
                                .filter(r => r.startsWith('other:'))
                                .map(r => `${actName(c)}: ${r}`),
                        ),
                    ),
                ],
            },
            // A gate row skipped for want of a landing says what stopped its derivation (sources/gate-landings.ts).
            reach: {
                ...fill.report,
                skipped: fill.report.skipped.map(line => {
                    const why = noLanding.get(line);
                    return why ? `${line}: ${[...new Set(why)].sort(cmp).join('; ')}` : line;
                }),
            },
            distance: distance.report,
            unpriced: priced.unpriced,
            stranded: priced.stranded,
            unreached: { pockets, expected: expected.expected, invalid: expected.invalid, stale: expected.stale },
            methods: { resolved: methods.methods.length, errors: methods.errors },
            checks,
        },
    };
}

/** `"key": [` then one JSON line per item, or `"key": []`. */
const jsonList = (key: string, xs: readonly unknown[]): string =>
    `  "${key}": [` + (xs.length ? `\n${xs.map(x => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : ']');

/** `"key": {` then one `"id": <JSON>` line per entry, or `"key": {}`. */
const jsonRecord = (key: string, record: Readonly<Record<string, unknown>>): string => {
    const entries = Object.entries(record);
    return (
        `  "${key}": {` +
        (entries.length
            ? `\n${entries.map(([id, x]) => `    ${JSON.stringify(id)}: ${JSON.stringify(x)}`).join(',\n')}\n  }`
            : '}')
    );
};

/**
 * Two-space JSON with one area, feature, site, npc spawn cluster, connector, quest, loadout rule,
 * transport, gate, crossing or method per line, so a diff shows which ones changed. Keys keep the order the objects were built in,
 * and undefined fields are left out as JSON.stringify does.
 */
export function serializeWorld(world: World): string {
    return [
        '{',
        `  "format": ${JSON.stringify(world.format)},`,
        `  "generatedFrom": ${JSON.stringify(world.generatedFrom)},`,
        jsonList('areas', world.areas) + ',',
        jsonList('features', world.features) + ',',
        jsonList('sites', world.sites) + ',',
        jsonList('npcSpawns', world.npcSpawns) + ',',
        jsonList('connectors', world.connectors) + ',',
        jsonList('quests', world.quests) + ',',
        jsonRecord('loadoutRules', world.loadoutRules) + ',',
        jsonList('transports', world.transports) + ',',
        jsonList('gates', world.gates) + ',',
        jsonList('crossings', world.crossings) + ',',
        jsonList('methods', world.methods),
        '}',
        '',
    ].join('\n');
}

const counts = (r: Partial<Record<string, number>>): string =>
    Object.entries(r)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ');

const NPC_SAMPLE = 10;

/** A heading and the items under it, indented; nothing when there are none. */
const list = (head: string, xs: readonly string[]): string[] => (xs.length ? [head, ...xs.map(x => `  ${x}`)] : []);

export function formatReport(report: BuildReport): string[] {
    const lines = [`features: ${counts(report.features)}`, `sites: ${counts(report.sites)}`];
    lines.push(
        report.uncovered.length
            ? `ERROR coverage: ${report.uncovered.length} sites outside every area:`
            : 'coverage: every site of a covered kind lies in an area',
        ...report.uncovered.map(id => `  ${id}`),
    );
    // Monster spawns lie all over the map, so these run to hundreds and a full list buries the rest
    // of the report: the count shows when it moves, and the first ids (sites sort by id) give a few
    // to look up.
    const sample = report.npcUncovered.slice(0, NPC_SAMPLE);
    if (report.npcUncovered.length)
        lines.push(
            `warning: ${report.npcUncovered.length} npc site${report.npcUncovered.length === 1 ? '' : 's'} outside every area${
                report.npcUncovered.length > sample.length ? `, the first ${sample.length}` : ''
            }:`,
            ...sample.map(id => `  ${id}`),
        );
    if (Object.keys(report.unpacked).length)
        lines.push(`warning: placements with no config in the pack: ${counts(report.unpacked)}`);
    if (report.log.length) lines.push(`warning: ${report.log.length} sites logged:`, ...report.log.map(l => `  ${l}`));
    const c = report.connectors;
    const underived = Object.values(c.underived).reduce((n, locs) => n + locs.length, 0);
    lines.push(
        `connectors: ${c.derived} derived on ${c.locs} locs, ${c.oneWay.length} one-way, ${underived} underived`,
    );
    if (c.oneWay.length)
        lines.push(
            `warning: ${c.oneWay.length} one-way connectors (none back within ${WAY_BACK} tiles):`,
            ...c.oneWay.map(l => `  ${l}`),
        );
    if (c.offLand.length)
        lines.push(`warning: ${c.offLand.length} connectors land off walkable land:`, ...c.offLand.map(l => `  ${l}`));
    if (underived)
        lines.push(
            `warning: ${underived} connector ops with no landing, by what stopped them:`,
            ...Object.entries(c.underived).flatMap(([reason, locs]) => [
                `  ${reason}: ${locs.length}`,
                `    ${locs.join(', ')}`,
            ]),
        );
    const q = report.quests;
    lines.push(`quests: ${q.count}, ${q.overrides.length} of them from gates.ts overrides (${q.overrides.join(', ')})`);
    if (q.unread.length)
        lines.push(
            `ERROR quests: ${q.unread.length} journal calls or quests not read, with no override in gates.ts:`,
            ...q.unread.map(u => `  ${u}`),
        );
    if (q.stale.length)
        lines.push(`ERROR quests: ${q.stale.length} entries in gates.ts not needed:`, ...q.stale.map(u => `  ${u}`));
    const t = report.transports;
    lines.push(`transports: ${t.ships} ship rows on ${t.routes} routes, ${t.curated} curated rows`);
    lines.push(
        ...list(
            `ERROR transports: ${t.unreached.length} sail sites no npc op reaches (derive, curate or list them out of scope in gates.ts):`,
            t.unreached,
        ),
        ...list(
            `ERROR transports: ${t.staleOutOfScope.length} sail sites gates.ts lists out of scope are gone or now reached:`,
            t.staleOutOfScope,
        ),
        ...list(`warning: ${t.underived.length} sail scripts the walker could not finish:`, t.underived),
        ...list(`warning: ${t.other.length} transport requirements in no other form:`, t.other),
        ...list(`sail paths left out as quest windows: ${t.windows.length}`, t.windows),
        ...(t.unusedRoutes.length ? [`sail routes no npc sails: ${t.unusedRoutes.join(', ')}`] : []),
        ...list(`transports out of scope (gates.ts): ${t.outOfScope.length}`, t.outOfScope),
    );
    const g = report.gates;
    lines.push(
        `gates: ${g.candidates} candidates, by kind ${counts(g.kinds)}; ${g.placed} placed; requirement forms ${counts(g.forms)}`,
        ...list(
            `ERROR gates: ${g.unreviewed.length} candidates gates.ts does not review (confirm or reject each):`,
            g.unreviewed,
        ),
        ...list(`ERROR gates: ${g.stale.length} gates.ts entries the scan no longer finds:`, g.stale),
        ...list(
            `ERROR gates: ${g.drifted.length} gates.ts overrides whose scan proposal changed (read each trigger again):`,
            g.drifted,
        ),
        ...list(`ERROR gates: ${g.invalid.length} gates.ts entries malformed or at odds with the scan:`, g.invalid),
        ...list(`ERROR gates: ${g.unnamed.length} quest stages no constant names:`, g.unnamed),
        ...list(`warning: ${g.unplaced.length} gates with no placed loc:`, g.unplaced),
        ...list(`warning: ${g.other.length} gate requirements in no other form:`, g.other),
        ...list(
            `warning: ${g.skippedCheckers.length} *_checker procs not read as tool checkers (a script testing one reads as unread):`,
            g.skippedCheckers,
        ),
        ...list(
            `warning: ${g.untimedQueues.length} moving scripts queued with a delay or on the weak queue, run by the scan in the order queued and as if they ran:`,
            g.untimedQueues,
        ),
        ...list(`gates the scan can't settle (unclear): ${g.unclear.length}`, g.unclear),
        ...list(`quest windows, kept out of the fill: ${g.windows.length}`, g.windows),
    );
    const l = g.landings;
    lines.push(
        `gate moves on objects: ${l.counts.to} to, ${l.counts.landings} landings, ${l.counts.opens} opens, ` +
            `${l.counts.underived} underived (rows; ${l.counts.windows} quest windows left as they are); ` +
            `${l.rolled} gate rows behind a roll`,
    );
    // The underived rows by trigger: how many, then each construct that stopped one, with its script line.
    const byTrigger = new Map<string, { rows: string[]; reasons: Set<string> }>();
    for (const u of l.underived) {
        const entry = byTrigger.get(u.trigger) ?? { rows: [], reasons: new Set<string>() };
        byTrigger.set(u.trigger, entry);
        entry.rows.push(`${u.loc} ${coord(u.tile)}`);
        for (const r of u.reasons) entry.reasons.add(r);
    }
    if (byTrigger.size)
        lines.push(
            `warning: ${l.counts.underived} gate rows on objects with no landing derived, by trigger:`,
            ...[...byTrigger]
                .sort(([a, x], [b, y]) => y.rows.length - x.rows.length || cmp(a, b))
                .flatMap(([trigger, entry]) => [
                    `  ${trigger}: ${entry.rows.length} (${entry.rows.join(', ')})`,
                    ...[...entry.reasons].sort(cmp).map(r => `    ${r}`),
                ]),
        );
    lines.push(
        ...list(
            `warning: ${l.offLand.length} gate landings off walkable land, left out:`,
            l.offLand.map(
                o => `${o.trigger} ${o.loc} ${coord(o.tile)} from ${coord(o.stand)} -> ${coord(o.landing)} (${o.at})`,
            ),
        ),
        ...list(
            `warning: ${l.unlanded.length} stands of gate rows with landings that give no landing, left out:`,
            l.unlanded.map(
                u => `${u.trigger} ${u.loc} ${coord(u.tile)} from ${coord(u.stand)}: ${u.reasons.join('; ')}`,
            ),
        ),
        ...list(
            `warning: ${l.unrolled.length} gate rows behind a roll the row can't take, left without one:`,
            l.unrolled.map(u => `${u.trigger} ${u.loc} ${coord(u.tile)}: ${u.reasons.join('; ')}`),
        ),
        ...list(
            `warning: ${l.waited.length} free gate landings reached past a wait only (a var against map_clock), read as free:`,
            l.waited.map(
                w =>
                    `${w.trigger} ${w.loc} ${coord(w.tile)} from ${coord(w.stand)} -> ${coord(w.landing)}: ${w.waits.join('; ')}`,
            ),
        ),
        ...list(
            `warning: ${l.stepped.length} gate landings on a tile of the loc itself, landed on the tiles stepped out to:`,
            l.stepped.map(
                m =>
                    `${m.trigger} ${m.loc} ${coord(m.tile)} from ${coord(m.stand)} -> ${coord(m.landing)}: ${m.to.map(coord).join(', ')}`,
            ),
        ),
        ...formatScripted(report.scripted),
        ...formatTeleports(report.teleports),
        ...formatNpcTeleports(report.npcTeleports),
        ...formatCurated(report.curated),
        ...list(
            `warning: ${report.unpriced.length} crossing costs the distances could not price, those edges not taken:`,
            report.unpriced,
        ),
        ...list(
            `warning: ${report.stranded.length} random landings no walk leaves for the rest of their row's, given no spread:`,
            report.stranded,
        ),
        ...list(
            `ERROR unreached: ${report.unreached.invalid.length} areas.ts EXPECTED_UNREACHED entries name no such area, or a site key no site or several sites hold (a typo?):`,
            report.unreached.invalid,
        ),
        ...list(
            `ERROR unreached: ${report.unreached.stale.length} areas.ts EXPECTED_UNREACHED entries no unreached site matches (reached now, or gone):`,
            report.unreached.stale,
        ),
    );
    return lines;
}

/** What each check finds, as its ERROR lines name it, and the allow.ts table it is curated in. */
const CHECKS: Record<CheckId, { finds: string; table: string }> = {
    'near-miss': {
        finds: `sites 1-${NEAR_MISS_GAP} tiles outside a leaf area not their own`,
        table: 'NEAR_MISS_ALLOW',
    },
    split: {
        finds: 'same-config site pairs split across leaf areas with features within their SITE_RADIUS',
        table: 'SPLIT_ALLOW',
    },
    stand: {
        finds: 'stands cut off from most of their members or from a bank',
        table: 'STAND_ALLOW',
    },
};

/** Each check's count found and allowed, then its findings left, invalid entries and stale ones: all errors. */
export function formatChecks(checks: BuildReport['checks']): string[] {
    return (Object.keys(CHECKS) as CheckId[]).flatMap(id => {
        const c = checks[id];
        const { finds, table } = CHECKS[id];
        return [
            `checks: ${id}: ${c.left.length + c.allowed} ${finds}, ${c.allowed} allowed by allow.ts ${table}`,
            ...list(`ERROR ${id}: ${c.left.length} ${finds} that allow.ts ${table} does not allow:`, c.left),
            ...list(
                `ERROR ${id}: ${c.invalid.length} allow.ts ${table} entries with a site key no site or several sites hold (a typo?):`,
                c.invalid,
            ),
            ...list(
                `ERROR ${id}: ${c.stale.length} allow.ts ${table} entries no finding matches (fixed now, or gone):`,
                c.stale,
            ),
        ];
    });
}

/** The unsettled scripted moves a trigger lists at most, after which it counts the rest. */
const UNSETTLED_AT = 4;

/**
 * The scripted moves' section: rows written, triggers and placed locs by outcome, then the duplicates of a
 * connector row (an error) and the unsettled moves by trigger, most locs first, each with its first locs and
 * every reason.
 */
export function formatScripted(r: BuildReport['scripted']): string[] {
    const byTrigger = new Map<string, { at: string[]; reasons: Set<string> }>();
    for (const u of r.unsettled) {
        const entry = byTrigger.get(u.trigger) ?? { at: [], reasons: new Set<string>() };
        byTrigger.set(u.trigger, entry);
        entry.at.push(`${u.loc} ${coord(u.tile)}${u.stand ? ` from ${coord(u.stand)}` : ''}`);
        for (const why of u.reasons) entry.reasons.add(why);
    }
    return [
        `scripted moves: ${r.rows} crossing rows; triggers ${counts(r.counts.triggers)}; placed locs ${counts(r.counts.locs)}`,
        ...list(`ERROR scripted: ${r.duplicates.length} moves on a connector's loc and op, refused:`, r.duplicates),
        ...(byTrigger.size
            ? [
                  `warning: ${r.unsettled.length} scripted moves whose landing no bound run settles, by trigger:`,
                  ...[...byTrigger]
                      .sort(([a, x], [b, y]) => y.at.length - x.at.length || cmp(a, b))
                      .flatMap(([trigger, { at, reasons }]) => [
                          `  ${trigger}: ${at.length} (${at.slice(0, UNSETTLED_AT).join(', ')}${at.length > UNSETTLED_AT ? ` and ${at.length - UNSETTLED_AT} more` : ''})`,
                          ...[...reasons].sort(cmp).map(why => `    ${why}`),
                      ]),
              ]
            : []),
    ];
}

/** The dbrow teleports' section: rows written, then the placed locs given none and the landings left out (warnings). */
export function formatTeleports(r: BuildReport['teleports']): string[] {
    return [
        `dbrow teleports: ${r.rows} crossing rows (gates.ts DBROW_TELEPORTS)`,
        ...list(
            `warning: ${r.unstood.length} dbrow teleport locs no tile on land is used from, no row:`,
            r.unstood.map(m => `${m.trigger} ${m.loc} ${coord(m.tile)}`),
        ),
        ...list(
            `warning: ${r.offLand.length} dbrow teleport landings off walkable land, left out:`,
            r.offLand.map(m => `${m.trigger} ${m.loc} ${coord(m.tile)} -> ${coord(m.landing)}`),
        ),
    ];
}

/**
 * The npc teleports' section: rows written, then the clusters and locs given none, the landings left out, the ways
 * back left out and the requirements in no other form (warnings).
 */
export function formatNpcTeleports(r: BuildReport['npcTeleports']): string[] {
    return [
        `npc teleports: ${r.rows} crossing rows (gates.ts NPC_TELEPORTS)`,
        ...list(
            `warning: ${r.unstood.length} npc teleport npcs and locs no tile on land is used from, no row:`,
            r.unstood.map(m => `${m.trigger} ${m.config} ${coord(m.tile)}`),
        ),
        ...list(
            `warning: ${r.offLand.length} npc teleport landings off walkable land, left out:`,
            r.offLand.map(m => `${m.trigger} ${m.config} ${coord(m.tile)} -> ${coord(m.landing)}`),
        ),
        ...list(
            `warning: ${r.unjoined.length} npc teleport ways back to an npc no walk gets to the teleport of, no row:`,
            r.unjoined,
        ),
        ...list(`warning: ${r.other.length} npc teleport requirements in no other form:`, r.other),
    ];
}

/** The curated crossings' section: rows written, then the placements given none and the landings left out or moved. */
export function formatCurated(r: BuildReport['curated']): string[] {
    return [
        `curated crossings: ${r.rows} crossing rows (gates.ts CURATED_CROSSINGS)`,
        ...list(
            `warning: ${r.unstood.length} curated crossing placements no tile on land is used from, no row:`,
            r.unstood.map(m => `${m.trigger} ${m.config} ${coord(m.tile)}`),
        ),
        ...list(
            `warning: ${r.offLand.length} curated crossing landings off walkable land, left out:`,
            r.offLand.map(m => `${m.trigger} ${m.config} ${coord(m.tile)} -> ${coord(m.landing)}`),
        ),
        ...list(
            `warning: ${r.stepped.length} curated crossing landings on a blocked tile, landed on the tiles stepped out to:`,
            r.stepped.map(
                m =>
                    `${m.trigger} ${m.config} ${coord(m.tile)} -> ${coord(m.landing)}: ${(m.to ?? []).map(coord).join(', ')}`,
            ),
        ),
    ];
}

/** The methods' section of the build report: how many resolved, and an error per record that did not. */
export function formatMethods(r: BuildReport['methods']): string[] {
    return [
        `methods: ${r.resolved} resolved`,
        ...list(`ERROR methods: ${r.errors.length} records methods.ts does not resolve:`, r.errors),
    ];
}

/** How far apart two tiles are, Chebyshev, as the unreached report counts it. */
const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** The placed locs or spawns a hint lists at most, after which it counts the rest. */
const HINT_AT = 4;

/** What the scan made of a hint's trigger, as the report says it. */
function scanText(s: HintScan): string {
    if (s.k === 'none') return 'no move found';
    if (s.k === 'candidate') return `gate candidate: ${s.kind}${s.reviewed ? ' (gates.ts)' : " (the scan's proposal)"}`;
    // A stair trigger shared by many locs jumps to each one's own tile: the first few, then how many more.
    const tiles = s.to.filter(to => to !== CROSS);
    const ways = [
        ...(s.to.includes(CROSS) ? ['across it'] : []),
        ...tiles.slice(0, HINT_AT).map(to => `to ${coord(coordTile(to))}`),
    ];
    return `unconditional move ${ways.join(', ')}${tiles.length > HINT_AT ? ` and ${tiles.length - HINT_AT} more` : ''}`;
}

/** A hint's placed locs or spawns: each config with its tiles, the first HINT_AT of them, then how many more. */
function atText(at: Hint['at']): string {
    const byConfig = new Map<string, Tile[]>();
    for (const a of at.slice(0, HINT_AT)) push(byConfig, a.config, a.tile);
    const shown = [...byConfig].map(([config, tiles]) => `${config} ${tiles.map(coord).join(', ')}`).join(', ');
    return at.length > HINT_AT ? `${shown} and ${at.length - HINT_AT} more` : shown;
}

/**
 * The unreached report: the COVERED sites no walk from the Lumbridge spawn reaches, less those areas.ts
 * EXPECTED_UNREACHED explains, counted by kind, then by pocket (Pocket), most sites first: each with its areas,
 * size, nearest reached tile, its sites by kind, and its hints, the triggers that move the player first, then
 * those with no move found on one line. Each pocket wants a connector, gate or transport, or an
 * EXPECTED_UNREACHED entry. Warnings: they do not fail the build (a stale entry does, in formatReport).
 */
export function formatUnreached(unreached: BuildReport['unreached'], areas: readonly Area[]): string[] {
    const { pockets, expected } = unreached;
    if (!pockets.length)
        return [
            'unreached: every site of a covered kind is reached from the Lumbridge spawn' +
                (expected ? `, but the ${expected} areas.ts EXPECTED_UNREACHED leaves out` : ''),
        ];
    const left = expected ? `; areas.ts EXPECTED_UNREACHED leaves out ${expected} more` : '';
    const names = new Map(areas.map(a => [a.id, a.name]));
    const sites = pockets.flatMap(p => p.sites);
    const open = pockets.filter(p => p.open).length;
    const ordered = pockets
        .map((p, k) => ({ p, k }))
        .sort((a, b) => b.p.sites.length - a.p.sites.length || a.k - b.k)
        .map(({ p }) => p);
    return [
        `warning: ${sites.length} sites of covered kinds no walk from the Lumbridge spawn reaches ` +
            `(${counts(tally(sites, u => u.kind))}), in ${pockets.length} pockets (${open} open), most sites first${left}:`,
        ...ordered.flatMap(p => {
            const leaves = [...new Set(p.sites.map(s => s.areaPath.at(-1) ?? ''))].map(id =>
                id ? `${id} (${names.get(id) ?? id})` : 'no area',
            );
            const byKind = new Map<string, Unreached[]>();
            for (const s of p.sites) push(byKind, s.kind, s);
            const moving = p.hints.filter(h => h.scan.k !== 'none');
            const still = p.hints.filter(h => h.scan.k === 'none');
            return [
                `  ${leaves.join(', ')}: ${p.sites.length} site${p.sites.length === 1 ? '' : 's'}, ${p.size} tiles` +
                    (p.open ? ' and more (open: the flood stopped at its cap)' : '') +
                    '; ' +
                    (p.nearest
                        ? `nearest reached ${coord(p.nearest.tile)}, ${p.nearest.off} tiles off ${p.nearest.site}`
                        : `no reached tile within ${NEAREST_RADIUS} tiles of its sites`),
                ...[...byKind]
                    .sort(([a], [b]) => cmp(a, b))
                    .map(
                        ([kind, us]) =>
                            `    ${kind} ${us.length}: ` +
                            us.map(u => `${u.id} ${u.stand ? '' : 'centre '}${coord(u.at)}`).join(', '),
                    ),
                ...moving.map(h => `    hint ${h.trigger} (${h.source}): ${scanText(h.scan)}; on ${atText(h.at)}`),
                ...(still.length
                    ? [
                          `    no move found: ${still.map(h => `${h.trigger} (${h.source}) on ${h.at.length}`).join(', ')}`,
                      ]
                    : []),
                ...(p.hints.length ? [] : ['    no hints: no trigger on or beside it']),
            ];
        }),
    ];
}

if (import.meta.main) {
    // Imported here only: it parses the collision data the SDK bundles (see collision.ts).
    const { reachCollision } = await import('./collision');
    const { world, report, model } = buildWorld({
        generatedFrom: contentHash(),
        areas: AREAS,
        collision: reachCollision,
    });
    const worldFiles = new Map([
        [relative(ROOT, WORLD_JSON), serializeWorld(world)],
        ...renderWorld(world, readRenderData(model)),
    ]);
    // In order: shops and items take the README as the step before left it, and items reads the npc pages.
    const npcs = npcPages(world);
    const shops = shopPages(world, npcs.files);
    const items = itemPages(new Map([...npcs.files, ...shops.files]));
    const files = new Map([...worldFiles, ...npcs.files, ...shops.files, ...items.files]);
    const removals = [...npcs.stale, ...shops.stale, ...items.stale];
    // Every world file but world.json is a page, the README included.
    const generated = `world.json, ${worldFiles.size - 1} world pages (README.md among them) and ${files.size - worldFiles.size} npc, shop and item pages`;
    if (process.argv.includes('--check')) {
        const stale = drift(files, ROOT, removals);
        if (stale.length) {
            console.log(`${stale.length} generated files differ from a fresh build; run bun run world and commit:`);
            for (const p of stale) console.log(`  ${p}`);
            process.exitCode = 1;
        } else console.log(`world: ${generated} are fresh`);
        // A fresh world.json can still have a report error: `bun run world` fails on it, so the check
        // does too.
        if (failed(report)) {
            for (const line of [
                ...formatReport(report),
                ...formatMethods(report.methods),
                ...formatChecks(report.checks),
            ])
                console.log(line);
            process.exitCode = 1;
        }
    } else {
        const removed = writeFiles(files, ROOT, removals);
        // The report, then where a walk from the Lumbridge spawn gets to (reach.ts) and the covered sites it
        // does not: warnings only, so `--check` leaves them out.
        for (const line of [
            ...formatReport(report),
            ...formatReach(report.reach),
            ...formatDistance(report.distance),
            ...formatMethods(report.methods),
            ...formatChecks(report.checks),
            ...formatUnreached(report.unreached, world.areas),
        ])
            console.log(line);
        console.log(`wrote ${generated}${removed.length ? `, removed ${removed.length} stale` : ''}`);
        if (failed(report)) process.exitCode = 1;
    }
}
