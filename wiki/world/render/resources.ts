// wiki/resources/<kind>/<subtype>.md: what the game data says about one resource subtype (the dbrow the
// skill script reads, or a fishing spot's options), then every site holding it.
import { rockSubtype, treeSubtype } from '../classify';
import { first, type Config } from '../sources/configs';
import type { DbRow } from '../sources/dbrows';
import type { FeatureKind, Site, World } from '../types';
import {
    areaCell,
    areasOf,
    byAreaThenId,
    cmp,
    coord,
    count,
    GENERATED,
    RESOURCE_KINDS,
    resourcePath,
    table,
    wilderness,
    yesNo,
} from './common';

/** The game data resource pages read besides the world. */
export interface ResourceData {
    dbrows: readonly DbRow[];
    npcConfigs: ReadonlyMap<string, Config>;
    objConfigs: ReadonlyMap<string, Config>;
}

const SINGULAR: Partial<Record<FeatureKind, string>> = {
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

/** Builds a fact table's cells from the data; `name` of an obj or npc config falls back to the config. */
function facts(data: ResourceData) {
    const objName = (obj: string): string => first(data.objConfigs.get(obj), 'name') ?? obj;
    const npcName = (npc: string): string => first(data.npcConfigs.get(npc), 'name') ?? npc;
    /** `loot` tuples (obj, min, max, weight, ...) as `Coins x3`, `Cake`, each once. */
    const loot = (row: DbRow): string => {
        const items = (row.data.loot ?? []).map(([obj, min, max]) => {
            const n = min === max ? min : `${min}-${max}`;
            return `${objName(obj!)}${n === '1' ? '' : ` x${n}`}`;
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
    'Respawn is the base in game ticks (0.6 s), which the scripts shorten as more players are online (general/scripts/player_count.rs2).';

const fromRows = (name: string, rows: readonly DbRow[]): string =>
    `From the \`${name}\` row${rows.length > 1 ? 's' : ''} ${rows.map(r => `\`${r.row}\``).join(', ')}.`;

const NO_ROW = (name: string): string[] => [`No \`${name}\` row names this subtype.`];

/** The data section of a subtype's page, by kind; `configs` are the placed configs of the subtype. */
function dataSection(kind: FeatureKind, subtype: string, configs: readonly string[], data: ResourceData): string[] {
    const f = facts(data);
    switch (kind) {
        case 'tree': {
            const rows = f.rows('woodcutting_trees', r => treeSubtype(r) === subtype);
            if (!rows.length) return NO_ROW('woodcutting_trees');
            return [
                fromRows('woodcutting_trees', rows),
                '',
                ...table(
                    ['Level', 'XP', 'Product', 'Respawn (ticks)', 'Depletes'],
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
                ...rows.flatMap(r =>
                    r.data.successchance?.length
                        ? [
                              ...table(
                                  ['Axe', 'Low', 'High'],
                                  r.data.successchance.map(([axe, low, high]) => [f.objName(axe!), low!, high!]),
                              ),
                              '',
                          ]
                        : ['The row lists no success chance per axe.', ''],
                ),
                STAT_RANDOM('Woodcutting'),
                '',
                'A respawnrate of 0 in the row means 120-199 ticks and a tree that depletes with every log; any other tree depletes 1 in 8 logs (skill_woodcutting/scripts/woodcut.rs2).',
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
                    ['Row', 'Level', 'XP', 'Ore', 'Respawn (ticks)', 'Low', 'High'],
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
                    ['Level', 'XP', 'Respawn (ticks)', 'Owner', 'Guards', 'Loot'],
                    rows.map(r => [
                        value(r, 'level'),
                        xp(r, 'experience'),
                        value(r, 'respawn_ticks'),
                        cell(r, 'owner') ? f.npcName(value(r, 'owner')) : '-',
                        [...new Set((r.data.guard ?? []).map(([g]) => f.npcName(g!)))].join(', ') || '-',
                        f.loot(r),
                    ]),
                ),
            ];
        }
        case 'thieving-chest': {
            const rows = f.rows('trapped_chest', r => value(r, 'loc') === subtype);
            if (!rows.length) return NO_ROW('trapped_chest');
            return [
                fromRows('trapped_chest', rows),
                '',
                ...table(
                    ['Level', 'XP', 'Respawn (ticks)', 'Loot'],
                    rows.map(r => [value(r, 'level'), xp(r, 'experience'), value(r, 'respawn_ticks'), f.loot(r)]),
                ),
            ];
        }
        case 'pickpocket': {
            const rows = f.rows('pickpocket', r => (r.data.npc ?? []).some(([n]) => n === subtype));
            if (!rows.length) return NO_ROW('pickpocket');
            return [
                fromRows('pickpocket', rows),
                '',
                ...table(
                    ['Level', 'XP', 'Low', 'High', 'Stun (ticks)', 'Stun damage', 'Loot'],
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
                STAT_RANDOM('Thieving'),
            ];
        }
        default:
            return [];
    }
}

/** One page per subtype of each resource kind, keyed by repo-relative path. */
export function renderResources(world: World, data: ResourceData): Map<string, string> {
    const areas = areasOf(world);
    const out = new Map<string, string>();
    for (const kind of RESOURCE_KINDS) {
        const sites = world.sites.filter(s => s.kind === kind);
        const subtypes = [...new Set(sites.flatMap(s => Object.keys(s.counts)))].sort(cmp);
        for (const subtype of subtypes) {
            const path = resourcePath(kind, subtype);
            if (out.has(path)) throw new Error(`${kind} subtypes share the page ${path}`);
            const holding = sites.filter(s => s.counts[subtype] !== undefined).sort(byAreaThenId);
            const features = holding
                .flatMap(s => s.features.map(i => world.features[i]!))
                .filter(f => f.subtype === subtype);
            const names = [...new Set(features.map(f => f.name))].sort(cmp);
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
            ];
            out.set(
                path,
                [
                    GENERATED,
                    `# ${SINGULAR[kind]}: ${subtype}`,
                    '',
                    `In-game name: ${names.join(', ')}. ${count(holding.length, 'site')} with ${features.length} placed in all; ${f2p} of the sites in F2P.`,
                    '',
                    '## Data',
                    '',
                    ...dataSection(kind, subtype, configs, data),
                    '',
                    '## Sites',
                    '',
                    ...table(
                        ['Area', 'Site', 'Centre', 'Stand', 'Count', 'F2P', 'Multiway', 'Wilderness'],
                        holding.map(row),
                    ),
                    '',
                ].join('\n'),
            );
        }
    }
    return out;
}
