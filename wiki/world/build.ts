// Builds wiki/world.json from the game data: every classified placement as a feature, clustered into
// sites named by the curated areas, and every npc spawn clustered per config (npcSpawns, which the npc
// pages read); then prints a report and renders the pages (render.ts). `bun run world` writes them and
// exits 1 on a site that breaks the COVERED rule. `--check` writes nothing: it exits 1 when world.json
// or a page differs from what the game data and this code generate now, so a hand edit or a stale page
// fails verify:conductor, and on the COVERED rule as the build does.
import { relative } from 'path';
import { areaResolver } from './area-resolve';
import { AREAS } from './areas';
import { classifier } from './classify';
import { contentHash } from './content-hash';
import { ROOT, WORLD_JSON } from './paths';
import { drift, readRenderData, renderWorld, writeFiles } from './render';
import { buildSites, locSizes, spawnClusters, type SiteCollision } from './place';
import { readConfigs } from './sources/configs';
import { readDbrows } from './sources/dbrows';
import { readAllMapSquares } from './sources/maps';
import { readPack } from './sources/packs';
import { readCallables, readTriggers } from './sources/triggers';
import { readZones } from './sources/zones';
import { WORLD_FORMAT, type Area, type Feature, type FeatureKind, type Site, type World } from './types';
import { cmp } from './util';

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
}

export interface BuildInput {
    generatedFrom: string;
    areas: readonly Area[];
    collision: SiteCollision;
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

/** Reads the game data and builds the world, without writing anything. */
export function buildWorld({ generatedFrom, areas, collision }: BuildInput): { world: World; report: BuildReport } {
    const locConfigs = readConfigs('loc');
    const classify = classifier({
        locConfigs,
        npcConfigs: readConfigs('npc'),
        dbrows: readDbrows(),
        triggers: readTriggers(),
        callables: readCallables(),
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

    return {
        world: { format: WORLD_FORMAT, generatedFrom, areas: [...areas], features, sites, npcSpawns },
        report: {
            features: tally(features, f => f.kind),
            sites: tally(sites, s => s.kind),
            uncovered: sites.filter(s => COVERED.has(s.kind) && outside(s)).map(s => s.id),
            npcUncovered: sites.filter(s => s.kind === 'npc' && outside(s)).map(s => s.id),
            unpacked: tally(unpacked, u => u),
            log,
        },
    };
}

/** `"key": [` then one JSON line per item, or `"key": []`. */
const jsonList = (key: string, xs: readonly unknown[]): string =>
    `  "${key}": [` + (xs.length ? `\n${xs.map(x => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : ']');

/**
 * Two-space JSON with one area, feature, site or npc spawn cluster per line, so a diff shows which
 * ones changed. Keys keep the order the objects were built in, and undefined fields are left out as
 * JSON.stringify does.
 */
export function serializeWorld(world: World): string {
    return [
        '{',
        `  "format": ${JSON.stringify(world.format)},`,
        `  "generatedFrom": ${JSON.stringify(world.generatedFrom)},`,
        jsonList('areas', world.areas) + ',',
        jsonList('features', world.features) + ',',
        jsonList('sites', world.sites) + ',',
        jsonList('npcSpawns', world.npcSpawns),
        '}',
        '',
    ].join('\n');
}

const counts = (r: Partial<Record<string, number>>): string =>
    Object.entries(r)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ');

const NPC_SAMPLE = 10;

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
    return lines;
}

if (import.meta.main) {
    // Imported here only: it parses the collision data the SDK bundles (see collision.ts).
    const { siteCollision } = await import('./collision');
    const { world, report } = buildWorld({ generatedFrom: contentHash(), areas: AREAS, collision: siteCollision });
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
        // A fresh world.json can still hold a site outside every area: `bun run world` fails on it, so
        // the check does too.
        if (report.uncovered.length) {
            for (const line of formatReport(report)) console.log(line);
            process.exitCode = 1;
        }
    } else {
        const removed = writeFiles(files);
        for (const line of formatReport(report)) console.log(line);
        console.log(`wrote ${generated}${removed.length ? `, removed ${removed.length} stale` : ''}`);
        if (report.uncovered.length) process.exitCode = 1;
    }
}
