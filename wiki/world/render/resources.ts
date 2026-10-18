// wiki/resources/<kind>/<subtype>.md: what the game data says about one resource subtype (the dbrow the
// skill script reads, or a fishing spot's options), then every site holding it.
import { rockSubtype, treeSubtype } from '../classify';
import { first } from '../sources/configs';
import type { DbRow } from '../sources/dbrows';
import type { Feature, Site, World } from '../types';
import { cmp } from '../util';
import {
    areaCell,
    areasOf,
    byAreaThenId,
    coord,
    count,
    GENERATED,
    reachLabel,
    reachSummary,
    RESOURCE_KINDS,
    resourcePath,
    table,
    wilderness,
    yesNo,
    type Page,
    type PageData,
    type ResourceKind,
} from './common';

const SINGULAR: Record<ResourceKind, string> = {
    tree: 'Tree',
    rock: 'Rock',
    'fishing-spot': 'Fishing spot',
    stall: 'Stall',
    'thieving-chest': 'Thieving chest',
    pickpocket: 'Pickpocket target',
};

/** A column's first value tuple. */
const cell = (row: DbRow, column: string): string[] | undefined => row.data[column]?.[0];

const value = (row: DbRow, column: string): string => cell(row, column)?.[0] ?? '-';

// The xp columns hold tenths: the scripts pass them straight to stat_advance, and the engine keeps
// stats in tenths of xp (its level table is scaled by 10, server/engine/src/engine/entity/Player.ts:84).
const xp = (row: DbRow, column: string): string => {
    const tenths = cell(row, column)?.[0];
    return tenths === undefined ? '-' : String(Number(tenths) / 10);
};

/**
 * Builds a fact table's cells from the data. The name of an obj or npc config falls back to the
 * config, and a value missing from a dbrow tuple reads `-`, as `value` has it.
 */
function facts(data: PageData) {
    const objName = (obj: string | undefined): string =>
        obj === undefined ? '-' : (first(data.objConfigs.get(obj), 'name') ?? obj);
    const npcName = (npc: string | undefined): string =>
        npc === undefined ? '-' : (first(data.npcConfigs.get(npc), 'name') ?? npc);
    /** `loot` tuples (obj, min, max, weight, ...) as `Coins x3`, `Cake`, each once. */
    const loot = (row: DbRow): string => {
        const items = (row.data.loot ?? []).map(([obj, min = '-', max = '-']) => {
            const n = min === max ? min : `${min}-${max}`;
            return `${objName(obj)}${n === '1' ? '' : ` x${n}`}`;
        });
        return [...new Set(items)].join(', ') || '-';
    };
    const rows = (name: string, match: (row: DbRow) => boolean): DbRow[] =>
        data.dbrows.filter(r => r.table === name && match(r));
    return { objName, npcName, loot, rows };
}

const STAT_RANDOM = (skill: string): string =>
    `Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at ${skill} level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).`;

const RESPAWN =
    'Respawn is the base in game ticks (0.4 s on this server, learnings/local-server.md), which the scripts shorten as more players are online (general/scripts/player_count.rs2).';

const XP_RATE =
    'Base XP is the dbrow value; the server multiplies it by its xpRate (25 on the local server, learnings/local-server.md).';

const fromRows = (name: string, rows: readonly DbRow[]): string =>
    `From the \`${name}\` row${rows.length > 1 ? 's' : ''} ${rows.map(r => `\`${r.row}\``).join(', ')}.`;

const NO_ROW = (name: string): string[] => [`No \`${name}\` row names this subtype.`];

/** The data section of a subtype's page, by kind; `configs` are the placed configs of the subtype. */
function dataSection(kind: ResourceKind, subtype: string, configs: readonly string[], data: PageData): string[] {
    const f = facts(data);
    switch (kind) {
        case 'tree': {
            const rows = f.rows('woodcutting_trees', r => treeSubtype(r) === subtype);
            if (!rows.length) return NO_ROW('woodcutting_trees');
            return [
                fromRows('woodcutting_trees', rows),
                '',
                ...table(
                    ['Level', 'Base XP', 'Product', 'Respawn (ticks)', 'Depletes'],
                    rows.map(r => {
                        // woodcut.rs2 [label,get_logs]: a respawnrate of 0 means 120 + random(80) ticks
                        // and deplete chance 0, and random(0) is always 0, so every log depletes. A row
                        // without the column would read -1 (ScriptVarType.getDefault); none lacks it.
                        const rate = cell(r, 'respawnrate')?.[0];
                        const [respawn, depletes] =
                            rate === undefined
                                ? ['-', '-']
                                : rate === '0'
                                  ? ['120-199', 'every log']
                                  : [rate, '1 in 8 logs'];
                        return [
                            value(r, 'levelrequired'),
                            xp(r, 'productexp'),
                            f.objName(value(r, 'product')),
                            respawn,
                            depletes,
                        ];
                    }),
                ),
                '',
                // Several rows' axe tables would read as one without a name over each.
                ...rows.flatMap(r => [
                    ...(rows.length > 1 ? [`\`${r.row}\`:`, ''] : []),
                    ...(r.data.successchance?.length
                        ? table(
                              ['Axe', 'Low', 'High'],
                              r.data.successchance.map(([axe, low = '-', high = '-']) => [f.objName(axe), low, high]),
                          )
                        : ['The row lists no success chance per axe.']),
                    '',
                ]),
                STAT_RANDOM('Woodcutting'),
                '',
                'A respawnrate of 0 in the row means 120-199 ticks and a tree that depletes with every log; any other tree depletes 1 in 8 logs (skill_woodcutting/scripts/woodcut.rs2).',
                '',
                XP_RATE,
                '',
                RESPAWN,
            ];
        }
        case 'rock': {
            const rows = f.rows('mining_table', r => rockSubtype(r) === subtype);
            if (!rows.length) return NO_ROW('mining_table');
            return [
                fromRows('mining_table', rows),
                '',
                ...table(
                    ['Row', 'Level', 'Base XP', 'Ore', 'Respawn (ticks)', 'Low', 'High'],
                    rows.map(r => [
                        r.row,
                        value(r, 'rock_level'),
                        xp(r, 'rock_exp'),
                        f.objName(value(r, 'rock_output')),
                        value(r, 'rock_respawnrate'),
                        cell(r, 'rock_successchance')?.[0] ?? '-',
                        cell(r, 'rock_successchance')?.[1] ?? '-',
                    ]),
                ),
                '',
                `${STAT_RANDOM('Mining')} The pair is the same whatever the pickaxe: mining_table has no pickaxe column.`,
                '',
                XP_RATE,
                '',
                RESPAWN,
            ];
        }
        case 'fishing-spot':
            return [
                'The options of each spot config placed in the world (its npc config).',
                '',
                ...table(
                    ['Config', 'Name', 'Options'],
                    configs.map(c => {
                        const cfg = data.npcConfigs.get(c);
                        const ops = ['op1', 'op2', 'op3', 'op4', 'op5']
                            .map(op => first(cfg, op))
                            .filter((o): o is string => o !== undefined && o !== 'hidden');
                        return [c, first(cfg, 'name') ?? c, ops.join(', ') || '-'];
                    }),
                ),
            ];
        case 'stall': {
            const rows = f.rows('stealing', r => value(r, 'loc') === subtype);
            if (!rows.length) return NO_ROW('stealing');
            return [
                fromRows('stealing', rows),
                '',
                ...table(
                    ['Level', 'Base XP', 'Respawn (ticks)', 'Owner', 'Guards', 'Loot'],
                    rows.map(r => [
                        value(r, 'level'),
                        xp(r, 'experience'),
                        value(r, 'respawn_ticks'),
                        cell(r, 'owner') ? f.npcName(value(r, 'owner')) : '-',
                        [...new Set((r.data.guard ?? []).map(([g]) => f.npcName(g)))].join(', ') || '-',
                        f.loot(r),
                    ]),
                ),
                '',
                XP_RATE,
            ];
        }
        case 'thieving-chest': {
            const rows = f.rows('trapped_chest', r => value(r, 'loc') === subtype);
            if (!rows.length) return NO_ROW('trapped_chest');
            return [
                fromRows('trapped_chest', rows),
                '',
                ...table(
                    ['Level', 'Base XP', 'Respawn (ticks)', 'Loot'],
                    rows.map(r => [value(r, 'level'), xp(r, 'experience'), value(r, 'respawn_ticks'), f.loot(r)]),
                ),
                '',
                XP_RATE,
            ];
        }
        case 'pickpocket': {
            const rows = f.rows('pickpocket', r => (r.data.npc ?? []).some(([n]) => n === subtype));
            if (!rows.length) return NO_ROW('pickpocket');
            return [
                fromRows('pickpocket', rows),
                '',
                ...table(
                    ['Level', 'Base XP', 'Low', 'High', 'Stun (ticks)', 'Stun damage', 'Loot'],
                    rows.map(r => [
                        value(r, 'level'),
                        xp(r, 'experience'),
                        cell(r, 'success_chance')?.[0] ?? '-',
                        cell(r, 'success_chance')?.[1] ?? '-',
                        value(r, 'stun_ticks'),
                        value(r, 'stun_damage'),
                        f.loot(r),
                    ]),
                ),
                '',
                XP_RATE,
                '',
                STAT_RANDOM('Thieving'),
            ];
        }
    }
}

// Kinds whose subtype is a config: their pages are titled by the in-game name, with the config
// beside it only where another subtype of the kind shares the name (man, man2 and man3 are all Man).
const TITLED_BY_NAME: ReadonlySet<ResourceKind> = new Set<ResourceKind>(['pickpocket', 'stall']);

/** One page per subtype of each resource kind, as its repo-relative path and text. */
export function renderResources(world: World, data: PageData): Page[] {
    const areas = areasOf(world);
    const requires = reachLabel(world, data);
    const out = new Map<string, string>();
    for (const kind of RESOURCE_KINDS) {
        const sites = world.sites.filter(s => s.kind === kind);
        const subtypes = [...new Set(sites.flatMap(s => Object.keys(s.counts)))].sort(cmp).map(subtype => {
            const holding = sites.filter(s => s.counts[subtype] !== undefined).sort(byAreaThenId);
            const features: Feature[] = holding
                .flatMap(s => s.features.map(i => world.features[i]!))
                .filter(f => f.subtype === subtype);
            return { subtype, holding, features, name: [...new Set(features.map(f => f.name))].sort(cmp).join(', ') };
        });
        const named = new Map<string, number>();
        for (const { name } of subtypes) named.set(name, (named.get(name) ?? 0) + 1);
        for (const { subtype, holding, features, name } of subtypes) {
            const path = resourcePath(kind, subtype);
            if (out.has(path)) throw new Error(`${kind} subtypes share the page ${path}`);
            const title = !TITLED_BY_NAME.has(kind) ? subtype : named.get(name)! > 1 ? `${name} (${subtype})` : name;
            const configs = [...new Set(features.map(f => f.config))].sort(cmp);
            const f2p = holding.filter(s => s.f2p).length;
            const row = (s: Site): string[] => [
                areaCell(path, areas, s.areaPath),
                `\`${s.id}\``,
                coord(s.centre),
                s.stand ? coord(s.stand) : '-',
                String(s.counts[subtype]),
                yesNo(s.f2p),
                yesNo(s.multiway),
                wilderness(s.wildernessLevel),
                requires(s.reach),
            ];
            out.set(
                path,
                [
                    GENERATED,
                    `# ${SINGULAR[kind]}: ${title}`,
                    '',
                    `In-game name: ${name}. ${count(holding.length, 'site')} with ${features.length} placed in all; ${f2p} of the sites in F2P; ${reachSummary(holding)}.`,
                    '',
                    '## Data',
                    '',
                    ...dataSection(kind, subtype, configs, data),
                    '',
                    '## Sites',
                    '',
                    ...table(
                        ['Area', 'Site', 'Centre', 'Stand', 'Count', 'F2P', 'Multiway', 'Wilderness', 'Requires'],
                        holding.map(row),
                    ),
                    '',
                ].join('\n'),
            );
        }
    }
    return [...out];
}
