// Builds wiki/world.json from the game data: every classified placement as a feature, clustered into
// sites named by the curated areas, then a report. `bun run world` writes the file and exits 1 when a
// site that agents choose from (COVERED) lies outside every area, so a new bank or mine can't go
// unnamed.
import { writeFileSync } from 'fs';
import { areaResolver } from './area-resolve';
import { AREAS } from './areas';
import { classifier } from './classify';
import { ROOT, WORLD_JSON } from './paths';
import { buildSites, locSizes, type SiteCollision } from './place';
import { readConfigs } from './sources/configs';
import { readDbrows } from './sources/dbrows';
import { readAllMapSquares } from './sources/maps';
import { readPack } from './sources/packs';
import { readCallables, readTriggers } from './sources/triggers';
import { readZones } from './sources/zones';
import { WORLD_FORMAT, type Area, type Feature, type FeatureKind, type Site, type World } from './types';

/**
 * The kinds whose every site must lie in an area: what an agent picks a place by (banks, shops,
 * resources, services, thieving). `npc` and `connector` sites may be anywhere; `npc` ones outside
 * every area are only warned about.
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

const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0);

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
    const sites: Site[] = buildSites(features, areaResolver(areas), readZones(), collision, {
        size: locSizes(locConfigs),
        log: line => log.push(line),
    }).sort((a, b) => cmp(a.id, b.id));

    return {
        world: { format: WORLD_FORMAT, generatedFrom, areas: [...areas], features, sites },
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
 * Two-space JSON with one area, feature or site per line, so a diff shows which ones changed. Keys
 * keep the order the objects were built in, and undefined fields are left out as JSON.stringify does.
 */
export function serializeWorld(world: World): string {
    return [
        '{',
        `  "format": ${JSON.stringify(world.format)},`,
        `  "generatedFrom": ${JSON.stringify(world.generatedFrom)},`,
        jsonList('areas', world.areas) + ',',
        jsonList('features', world.features) + ',',
        jsonList('sites', world.sites),
        '}',
        '',
    ].join('\n');
}

const git = (args: string[]): string => {
    const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stderr: 'pipe' });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString().trim()}`);
    return run.stdout.toString().trim();
};

/**
 * The last commit that touched server/content, with `-dirty` when server/content has uncommitted
 * changes, so the hash moves only when the game data does. It names the content commit and nothing
 * more: it misses an edit to this builder or to areas.ts, so whether world.json is fresh is answered
 * by rebuilding and comparing the bytes, not by this hash.
 */
export function contentHash(): string {
    const hash = git(['log', '-1', '--format=%H', '--', 'server/content']);
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error(`git log on server/content gave no commit: ${hash}`);
    return git(['status', '--porcelain', '--', 'server/content']) ? `${hash}-dirty` : hash;
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
    // Monsters roam everywhere, so these are many and listing them all buries the rest: a count and
    // the first ids (the sites are sorted by id) show whether the number moved and where.
    const sample = report.npcUncovered.slice(0, NPC_SAMPLE);
    if (report.npcUncovered.length)
        lines.push(
            `warning: ${report.npcUncovered.length} npc sites outside every area, the first ${sample.length}:`,
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
    writeFileSync(WORLD_JSON, serializeWorld(world));
    for (const line of formatReport(report)) console.log(line);
    if (report.uncovered.length) process.exitCode = 1;
}
