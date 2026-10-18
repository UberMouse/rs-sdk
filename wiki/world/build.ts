// Builds wiki/world.json from the game data: every classified placement as a feature, clustered into
// sites named by the curated areas, every npc spawn clustered per config (npcSpawns, which the npc
// pages read), every connector's landings (sources/connectors.ts), the quest table (sources/quests.ts),
// the loadout rules (sources/loadout.ts), the transports (sources/transports.ts, gates.ts) and the gates
// (sources/gate-scan.ts, gates.ts); then prints a report and renders the pages (render.ts). `bun run
// world` writes them, prints the reach fill's report (reach.ts: what a walk from the Lumbridge spawn reaches,
// reported only, not written to world.json), and exits 1 when the report has an error (failed): a site that breaks the COVERED
// rule, a quest or journal call the scan can't read with no override, a gates.ts quest entry no longer
// needed, a sail site no npc op reaches that gates.ts does not list as out of scope, or one it lists that
// is gone or now reached, a gate candidate gates.ts does not review, or a gates.ts gate entry that is
// stale, malformed, at odds with the scan without saying why, or names a quest stage no constant does. `--check`
// writes nothing: it exits 1 when world.json or a page differs from what the game data and this code
// generate now, so a hand edit or a stale page fails verify:conductor, and on a report error as the
// build does.
import { relative } from 'path';
import { areaResolver } from './area-resolve';
import { AREAS } from './areas';
import { classifier } from './classify';
import { contentHash } from './content-hash';
import { ROOT, WORLD_JSON } from './paths';
import { drift, readRenderData, renderWorld, writeFiles } from './render';
import { coord } from './render/common';
import { buildSites, locSizes, spawnClusters } from './place';
import { fillReach, formatReach } from './reach';
import { readConfigs } from './sources/configs';
import { deriveConnectors, WAY_BACK, type ConnectorCollision, type Underived } from './sources/connectors';
import { readDbrows } from './sources/dbrows';
import { readAllMapSquares } from './sources/maps';
import { readPack } from './sources/packs';
import {
    CURATED_TRANSPORTS,
    GATES,
    LOADOUT_PROCS,
    QUEST_OVERRIDES,
    QUEST_VARP_EXCEPTIONS,
    TRANSPORTS_OUT_OF_SCOPE,
} from './gates';
import { readConstants } from './sources/constants';
import { deriveGateLandings, type GateLandings } from './sources/gate-landings';
import { placeGates, reviewGates, scanGates, type GateScanInput } from './sources/gate-scan';
import { toolCheckers } from './sources/conditions';
import { deriveLoadoutRules } from './sources/loadout';
import { deriveQuests, scanQuestCalls } from './sources/quests';
import { byTransport, curatedTransports, deriveSails, outOfScopeSites } from './sources/transports';
import { parseCallables, parseTriggers, readScripts } from './sources/triggers';
import { readZones } from './sources/zones';
import { WORLD_FORMAT, type Area, type Feature, type FeatureKind, type Site, type World } from './types';
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
]);

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
         * Gate rows on objects whose move is not a coord literal (sources/gate-landings.ts): counted by
         * outcome, the rows no path derives (Task 3's unreached list), stands whose landing is off land, and
         * stands of rows with landings that give none.
         */
        landings: Pick<GateLandings, 'counts' | 'underived' | 'offLand' | 'unlanded'>;
    };
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
    r.gates.unnamed.length > 0;

export interface BuildInput {
    generatedFrom: string;
    areas: readonly Area[];
    collision: ConnectorCollision;
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

/** An underived connector op as the report lists it: `config (x, z) op<n>`. */
const named = (u: Underived): string => `${u.config} ${coord(u.loc)} op${u.op}`;

/** Reads the game data and builds the world, without writing anything. */
export function buildWorld({ generatedFrom, areas, collision }: BuildInput): { world: World; report: BuildReport } {
    const locConfigs = readConfigs('loc');
    const npcConfigs = readConfigs('npc');
    const scripts = readScripts();
    const triggers = scripts.flatMap(([f, text]) => parseTriggers(f, text));
    const callables = scripts.flatMap(([f, text]) => parseCallables(f, text));
    const classify = classifier({
        locConfigs,
        npcConfigs,
        dbrows: readDbrows(),
        triggers,
        callables,
    });
    const packs = { loc: readPack('loc'), npc: readPack('npc') };
    const map = readAllMapSquares();

    const unpacked: string[] = [];
    const features: Feature[] = [];
    // One feature per kind classify gives a placement (Fadli is a bank and a shop). Spawns without
    // combat stats need no filter: classify.ts gives the `npc` kind only to configs that have them.
    const place = (source: 'loc' | 'npc', id: number, rest: Pick<Feature, 'tile' | 'shape' | 'rotation'>): void => {
        const config = packs[source].name.get(id);
        if (config === undefined) {
            unpacked.push(`${source} ${id}`);
            return;
        }
        for (const c of classify(source, config))
            features.push({ source, id, config, ...rest, kind: c.kind, subtype: c.subtype, name: c.name });
    };
    for (const l of map.locs) place('loc', l.id, { tile: l.tile, shape: l.shape, rotation: l.rotation });
    for (const n of map.npcs) place('npc', n.id, { tile: n.tile });
    // Sorted before buildSites, as a site's `features` are indexes into this array.
    features.sort(byWritten);

    const log: string[] = [];
    const resolve = areaResolver(areas);
    const zones = readZones();
    const sites: Site[] = buildSites(features, resolve, zones, collision, {
        size: locSizes(locConfigs),
        log: line => log.push(line),
    }).sort((a, b) => cmp(a.id, b.id));
    // Every placed npc, classified or not, so an npc page can say where any npc stands. A spawn with no
    // config is in `unpacked` already.
    const spawns = map.npcs.flatMap(n => {
        const config = packs.npc.name.get(n.id);
        return config === undefined ? [] : [{ config, tile: n.tile }];
    });
    const npcSpawns = spawnClusters(spawns, resolve, zones);

    const constants = readConstants();
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
    const scan: GateScanInput = {
        triggers,
        callables,
        constants,
        quests: quests.quests,
        loadoutProcs: LOADOUT_PROCS,
        names: new Set([...objConfigs.keys(), ...locConfigs.keys(), ...npcConfigs.keys()]),
        tools,
    };
    const candidates = scanGates(scan);
    const review = reviewGates(candidates, GATES, new Map(scripts));
    const gates = placeGates({
        curated: GATES,
        candidates,
        triggers,
        locConfigs,
        locs: map.locs.flatMap(l => {
            const config = packs.loc.name.get(l.id);
            return config === undefined ? [] : [{ config, tile: l.tile, shape: l.shape, rotation: l.rotation }];
        }),
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
    });
    // Each quest's stages are the constants its gates compare with (Quest.stages).
    const questRows = quests.quests.map(q => {
        const staged = gates.stages.get(q.id);
        return staged ? { ...q, stages: Object.fromEntries([...staged].sort(([a], [b]) => cmp(a, b))) } : q;
    });
    const sailSiteCheck = outOfScopeSites(
        sails.unreached,
        TRANSPORTS_OUT_OF_SCOPE.filter(o => o.sailSite).map(o => o.script),
    );

    return {
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
            gates: landings.gates,
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
                landings: {
                    counts: landings.counts,
                    underived: landings.underived,
                    offLand: landings.offLand,
                    unlanded: landings.unlanded,
                },
            },
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
 * transport or gate per line, so a diff shows which ones changed. Keys keep the order the objects were built in,
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
        jsonList('gates', world.gates),
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
        ...list(`gates the scan can't settle (unclear): ${g.unclear.length}`, g.unclear),
        ...list(`quest windows, kept out of the fill: ${g.windows.length}`, g.windows),
    );
    const l = g.landings;
    lines.push(
        `gate moves on objects: ${l.counts.to} to, ${l.counts.landings} landings, ${l.counts.opens} opens, ` +
            `${l.counts.underived} underived (rows; ${l.counts.windows} quest windows left as they are)`,
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
    );
    return lines;
}

if (import.meta.main) {
    // Imported here only: it parses the collision data the SDK bundles (see collision.ts).
    const { reachCollision } = await import('./collision');
    const { world, report } = buildWorld({ generatedFrom: contentHash(), areas: AREAS, collision: reachCollision });
    const files = new Map([
        [relative(ROOT, WORLD_JSON), serializeWorld(world)],
        ...renderWorld(world, readRenderData()),
    ]);
    // Every file but world.json is a page, the README included.
    const generated = `world.json and ${files.size - 1} pages (README.md among them)`;
    if (process.argv.includes('--check')) {
        const stale = drift(files);
        if (stale.length) {
            console.log(`${stale.length} generated files differ from a fresh build; run bun run world and commit:`);
            for (const p of stale) console.log(`  ${p}`);
            process.exitCode = 1;
        } else console.log(`world: ${generated} are fresh`);
        // A fresh world.json can still have a report error: `bun run world` fails on it, so the check
        // does too.
        if (failed(report)) {
            for (const line of formatReport(report)) console.log(line);
            process.exitCode = 1;
        }
    } else {
        const removed = writeFiles(files);
        for (const line of formatReport(report)) console.log(line);
        // Where a walk from the Lumbridge spawn gets to, and what it needs (reach.ts). It is reported only, not
        // written to world.json, and reports no error, so `--check` leaves it out.
        const reach = fillReach({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
        for (const line of formatReach(reach.report)) console.log(line);
        console.log(`wrote ${generated}${removed.length ? `, removed ${removed.length} stale` : ''}`);
        if (failed(report)) process.exitCode = 1;
    }
}
