// wiki/resources/<kind>/<subtype>.md: what the game data says about one resource subtype (the dbrow the
// skill script reads, or a fishing spot's options and what each catches), then every site holding it.
import { rockSubtype, treeSubtype } from '../classify';
import { fishStruct } from '../model/families/fishing';
import { statRandomRule } from '../roll';
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
    nearestLabel,
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
    flax: 'Flax',
    'agility-course': 'Agility course',
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

const RESPAWN =
    'Respawn is the base in game ticks (0.4 s on this server, learnings/local-server.md), which the scripts shorten as more players are online (general/scripts/player_count.rs2).';

const XP_RATE =
    'Base XP is the dbrow value; the server multiplies it by its xpRate (25 on the local server, learnings/local-server.md).';

const fromRows = (name: string, rows: readonly DbRow[]): string =>
    `From the \`${name}\` row${rows.length > 1 ? 's' : ''} ${rows.map(r => `\`${r.row}\``).join(', ')}.`;

const NO_ROW = (name: string): string[] => [`No \`${name}\` row names this subtype.`];

/** A course's lap: its obstacles in lap order and its bonus, from the site's Course. */
function lapSection(site: Site, world: World): string[] {
    const { course } = site;
    if (!course) return [`\`${site.id}\` has no lap.`];
    return [
        `\`${site.id}\`: progress varp \`${course.varp}\`, a lap bonus of ${course.lapBonus / 10} base XP (${course.source}). An obstacle moves the lap on only as the next step (an earlier one sets it back); one of each step's obstacles completes it.`,
        '',
        ...table(
            ['Step', 'Obstacle', 'Loc', 'Tile', 'Source'],
            course.obstacles.map(o => [
                String(o.step),
                world.features[o.feature]!.name,
                `\`${o.loc}\``,
                coord(o.tile),
                o.source,
            ]),
        ),
        '',
    ];
}

/** A config placed in the world, and whether it is a loc or an npc. */
type Placed = Pick<Feature, 'config' | 'source'>;

const SPOT_OPS = ['1', '2', '3', '4', '5'];

/**
 * A fishing spot's options, then what each option catches: its level, tool, bait and fish from the spot scripts
 * (readSpots), each fish's XP and roll from its fishing struct. An option whose catch readSpots cannot read has a row
 * saying so, citing the script, so no option is left out.
 */
function fishingSection(subtype: string, configs: readonly Placed[], data: PageData): string[] {
    const f = facts(data);
    const cfgs = configs.map(c => ({
        config: c.config,
        cfg: (c.source === 'loc' ? data.locConfigs : data.npcConfigs).get(c.config),
    }));
    // A `hidden` op is one the scripts re-enter (p_opnpc, p_oploc: memberfish.rs2, lavafish_loc.rs2), not an option a
    // player clicks.
    const shown = (cfg: (typeof cfgs)[number]['cfg']): [op: string, name: string][] =>
        SPOT_OPS.flatMap(op => {
            const name = first(cfg, `op${op}`);
            return name === undefined || name === 'hidden' ? [] : [[op, name]];
        });
    const options = new Map<string, Set<string>>();
    for (const { cfg } of cfgs)
        for (const [op, name] of shown(cfg)) options.set(op, (options.get(op) ?? new Set()).add(name));
    const spot = data.fishingSpots.get(subtype);
    let twoFish = false;
    const rows = [...options]
        .sort(([a], [b]) => cmp(a, b))
        .flatMap(([op, names]): string[][] => {
            const option = [...names].sort(cmp).join(' / ');
            const o = spot?.ops.get(op);
            const c = o?.tool ? spot!.catches.get(o.tool) : undefined;
            if (!c) {
                const where = o ? o.source : `no op${op} trigger on ${subtype} in skill_fishing/scripts/fishing_spots`;
                const tool = o?.tool ? f.objName(o.tool) : '-';
                return [
                    [
                        option,
                        '-',
                        tool,
                        '-',
                        "can't read this catch: not a plain ~fish_roll loop",
                        '-',
                        '-',
                        '-',
                        where,
                    ],
                ];
            }
            if (c.fish2) twoFish = true;
            const fish = [{ obj: c.fish1, level: c.level }, ...(c.fish2 ? [c.fish2] : [])];
            return fish.map(({ obj, level }) => {
                const s = fishStruct(data.objConfigs, data.structs, obj);
                return [
                    option,
                    String(level),
                    f.objName(c.tool),
                    c.bait ? f.objName(c.bait) : '-',
                    f.objName(obj),
                    String(s.xp / 10),
                    String(s.low),
                    String(s.high),
                    c.source,
                ];
            });
        });
    return [
        'The options of each spot config placed in the world (its npc or loc config).',
        '',
        ...table(
            ['Config', 'Name', 'Options'],
            cfgs.map(({ config, cfg }) => [
                config,
                first(cfg, 'name') ?? config,
                shown(cfg)
                    .map(([, n]) => n)
                    .join(', ') || '-',
            ]),
        ),
        '',
        "What each option catches, from the spot's script (Source) and each fish's fishing struct (skill_fishing/configs/fishing.struct): Base XP is its productexp, Low and High its success_low and success_high.",
        '',
        ...(rows.length
            ? table(['Option', 'Level', 'Tool', 'Bait', 'Catch', 'Base XP', 'Low', 'High', 'Source'], rows)
            : ['No config of this subtype shows an option.']),
        '',
        ...(twoFish
            ? [
                  "Where an option catches two fish, ~fish_roll rolls the higher-level one first, from its level, and the other only when that roll misses (skill_fishing/scripts/fishing.rs2:46-72; ~fish_roll_loc's :75-103 the same); the bait goes only on a catch.",
                  '',
              ]
            : []),
        statRandomRule('Fishing'),
        '',
        'The server multiplies the base XP by its xpRate (25 on the local server, learnings/local-server.md).',
    ];
}

/**
 * The data section of a subtype's page, by kind; `configs` are the placed configs of the subtype, `holding` its
 * sites.
 */
function dataSection(
    kind: ResourceKind,
    subtype: string,
    configs: readonly Placed[],
    holding: readonly Site[],
    world: World,
    data: PageData,
): string[] {
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
                statRandomRule('Woodcutting'),
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
                `${statRandomRule('Mining')} The pair is the same whatever the pickaxe: mining_table has no pickaxe column.`,
                '',
                XP_RATE,
                '',
                RESPAWN,
            ];
        }
        case 'fishing-spot':
            return fishingSection(subtype, configs, data);
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
                statRandomRule('Thieving'),
            ];
        }
        case 'flax':
            return [
                'Picked one at a time through `[oploc2,flax]` (general_use/scripts/pickables.rs2), which adds the obj flax.',
            ];
        case 'agility-course':
            return [
                ...holding.flatMap(s => lapSection(s, world)),
                "Base XP is the script's stat_advance tenths over 10; the server multiplies it by its xpRate (25 on the local server, learnings/local-server.md).",
            ];
    }
}

/**
 * Where a fishing spot moves (Site.movement): the area that covers every tile it can stand on, to copy into a plan,
 * then the tiles themselves.
 */
function movementSection(holding: Site[], subtype: string): string[] {
    const sites = holding.filter(s => s.movement?.[subtype]);
    if (!sites.length) return [];
    return [
        '## Movement',
        '',
        "A spot teleports to a random tile of its movement enum that holds no other spot every 280 + random(250) ticks (skill_fishing/scripts/fishing_movement.rs2), so the spots of a shore roam over all of its tiles and a plan must stay within reach of every one. The cover is a centre and a Chebyshev radius that include every tile with 3 tiles of margin; copy it as the plan's `area`.",
        '',
        ...table(
            ['Site', 'Cover centre', 'Cover radius', 'Tiles'],
            sites.map(s => {
                const m = s.movement![subtype]!;
                return [`\`${s.id}\``, coord(m.centre), String(m.radius), String(m.tiles.length)];
            }),
        ),
        '',
        ...sites.flatMap(s => [`\`${s.id}\` tiles: ${s.movement![subtype]!.tiles.map(t => coord(t)).join(', ')}`, '']),
    ];
}

// Kinds whose subtype is a config: their pages are titled by the in-game name, with the config
// beside it only where another subtype of the kind shares the name (man, man2 and man3 are all Man).
const TITLED_BY_NAME: ReadonlySet<ResourceKind> = new Set<ResourceKind>(['pickpocket', 'stall']);

/** One page per subtype of each resource kind, as its repo-relative path and text. */
export function renderResources(world: World, data: PageData): Page[] {
    const areas = areasOf(world);
    const requires = reachLabel(world, data);
    const nearestBank = nearestLabel(world, data, 'bank');
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
            const configs = [
                ...new Map(features.map(f => [f.config, { config: f.config, source: f.source }])).values(),
            ].sort((a, b) => cmp(a.config, b.config));
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
                requires(s),
                nearestBank(s),
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
                    ...dataSection(kind, subtype, configs, holding, world, data),
                    '',
                    '## Sites',
                    '',
                    ...table(
                        [
                            'Area',
                            'Site',
                            'Centre',
                            'Stand',
                            'Count',
                            'F2P',
                            'Multiway',
                            'Wilderness',
                            'Requires',
                            'Nearest bank',
                        ],
                        holding.map(row),
                    ),
                    '',
                    ...(kind === 'fishing-spot' ? movementSection(holding, subtype) : []),
                ].join('\n'),
            );
        }
    }
    return [...out];
}
