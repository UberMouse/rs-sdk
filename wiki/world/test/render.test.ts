import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    drift,
    HAND_WRITTEN,
    openshopTitles,
    README,
    readmeBody,
    renderWorld,
    writeFiles,
    type RenderData,
} from '../render';
import { bySiteId, link, slug } from '../render/common';
import type { Config } from '../sources/configs';
import type { Feature, FeatureKind, Site, World } from '../types';

const feature = (
    kind: FeatureKind,
    subtype: string,
    name: string,
    config: string,
    x: number,
    z: number,
    level = 0,
    source: 'loc' | 'npc' = 'loc',
) => ({ source, id: 1, config, tile: { level, x, z }, kind, subtype, name }) satisfies Feature;

const site = (
    id: string,
    areaPath: string[],
    features: number[],
    counts: Record<string, number>,
    rest: Partial<Site> = {},
) => {
    const kind = id.slice(0, id.indexOf(':')) as FeatureKind;
    return {
        id,
        kind,
        areaPath,
        centre: { level: 0, x: 3200, z: 3200 },
        bbox: { x1: 3200, z1: 3200, x2: 3201, z2: 3201, level: 0 },
        stand: { level: 0, x: 3200, z: 3199 },
        counts,
        features,
        f2p: true,
        multiway: false,
        wildernessLevel: 0,
        ...rest,
    } satisfies Site;
};

// A region holding a town holding a bank; a tree site in the town on level 1, one in the region in the
// Wilderness, two more in the town to show sites sort by their number, and sites of kinds without pages.
const world: World = {
    format: 1,
    generatedFrom: 'abc123',
    areas: [
        { id: 'region', name: 'Region', rects: [{ x1: 3000, z1: 3000, x2: 3500, z2: 3500 }] },
        {
            id: 'town',
            name: 'Town',
            parent: 'region',
            rects: [{ x1: 3100, z1: 3100, x2: 3300, z2: 3300 }],
            notes: 'A town.',
            requires: ['members'],
        },
        { id: 'town-bank', name: 'Town bank', parent: 'town', rects: [{ x1: 3200, z1: 3200, x2: 3201, z2: 3201 }] },
    ],
    features: [
        feature('bank', 'booth', 'Bank booth', 'bankbooth', 3200, 3200),
        feature('bank', 'booth', 'Bank booth', 'bankbooth', 3201, 3200),
        feature('bank', 'banker', 'Banker', 'banker1', 3200, 3201),
        feature('tree', 'yew', 'Yew', 'yewtree', 3150, 3150, 1),
        feature('tree', 'oak', 'Oak', 'oaktree', 3151, 3150, 1),
        feature('tree', 'yew', 'Yew', 'yewtree', 3400, 3400),
        feature('connector', '', 'Ladder', 'ladder', 3160, 3160),
        feature('tree', 'yew', 'Yew', 'yewtree', 3170, 3170),
        feature('tree', 'yew', 'Yew', 'yewtree', 3180, 3180),
        feature('npc', 'goblin', 'Goblin', 'goblin', 3190, 3190),
    ],
    sites: [
        site('bank:town-bank:0', ['region', 'town', 'town-bank'], [0, 1, 2], { banker: 1, booth: 2 }),
        site('connector:town:0', ['region', 'town'], [6], { connector: 1 }, { stand: null }),
        site('npc:unnamed:0', [], [9], { goblin: 1 }),
        site('tree:region:0', ['region'], [5], { yew: 1 }, { f2p: false, multiway: true, wildernessLevel: 12 }),
        site(
            'tree:town:0',
            ['region', 'town'],
            [3, 4],
            { oak: 1, yew: 1 },
            { centre: { level: 1, x: 3150, z: 3150 }, stand: { level: 1, x: 3150, z: 3151 } },
        ),
        site('tree:town:10', ['region', 'town'], [8], { yew: 1 }),
        site('tree:town:2', ['region', 'town'], [7], { yew: 1 }),
    ],
};

const data: RenderData = {
    dbrows: [
        {
            row: 'yew_tree_table',
            table: 'woodcutting_trees',
            data: {
                tree: [['yewtree']],
                levelrequired: [['60']],
                productexp: [['1750']],
                product: [['yew_logs']],
                respawnrate: [['200']],
                successchance: [
                    ['bronze_axe', '4', '12'],
                    ['rune_axe', '14', '44'],
                ],
            },
        },
        {
            row: 'oak_tree_table',
            table: 'woodcutting_trees',
            data: { tree: [['oaktree']], levelrequired: [['15']], productexp: [['375']], product: [['oak_logs']] },
        },
    ],
    npcConfigs: new Map(),
    objConfigs: new Map([
        ['yew_logs', { name: ['Yew logs'] }],
        ['bronze_axe', { name: ['Bronze axe'] }],
        ['rune_axe', { name: ['Rune axe'] }],
    ]),
    shopTitles: new Map(),
    readmeBody: '\nHand-written.\n',
};

const pages = renderWorld(world, data);

describe('renderWorld', () => {
    test('renders a page per area, resource subtype and service kind, and the README, in path order', () =>
        expect([...pages.keys()]).toEqual([
            'wiki/places/region.md',
            'wiki/places/town-bank.md',
            'wiki/places/town.md',
            'wiki/resources/tree/oak.md',
            'wiki/resources/tree/yew.md',
            'wiki/services/altar.md',
            'wiki/services/anvil.md',
            'wiki/services/bank.md',
            'wiki/services/fire.md',
            'wiki/services/furnace.md',
            'wiki/services/pottery-oven.md',
            'wiki/services/pottery-wheel.md',
            'wiki/services/range.md',
            'wiki/services/rc-altar.md',
            'wiki/services/rc-ruins.md',
            'wiki/services/sand-pit.md',
            'wiki/services/shop.md',
            'wiki/services/spinning-wheel.md',
            'wiki/services/tanner.md',
            'wiki/services/water-source.md',
            'wiki/world/README.md',
        ]));

    test('is deterministic', () => expect(renderWorld(world, data)).toEqual(pages));

    test('a place page: breadcrumb, notes, its own sites by kind, its child areas summed', () => {
        expect(pages.get('wiki/places/town.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Town

          [Region](region.md) › Town

          A town.

          Requires: members.

          ## Trees

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`tree:town:0\` | (3150, 3150) L1 | [oak](../resources/tree/oak.md) 1, [yew](../resources/tree/yew.md) 1 | yes | no | - |
          | \`tree:town:2\` | (3200, 3200) | [yew](../resources/tree/yew.md) 1 | yes | no | - |
          | \`tree:town:10\` | (3200, 3200) | [yew](../resources/tree/yew.md) 1 | yes | no | - |

          ## Ladders and stairs

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`connector:town:0\` | (3200, 3200) | Ladder 1 | yes | no | - |

          ## Areas within

          | Area | Sites in it |
          |---|---|
          | [Town bank](town-bank.md) | bank 1 |
          "
        `);
    });

    test('a region page sums every site under each child; a site in no area is on no place page', () => {
        expect(pages.get('wiki/places/region.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Region

          ## Trees

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`tree:region:0\` | (3200, 3200) | [yew](../resources/tree/yew.md) 1 | no | yes | 12 |

          ## Areas within

          | Area | Sites in it |
          |---|---|
          | [Town](town.md) | bank 1, tree 3, connector 1 |
          "
        `);
    });

    test('a resource page: the dbrow data in xp units, then every site holding the subtype', () => {
        expect(pages.get('wiki/resources/tree/yew.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Tree: yew

          In-game name: Yew. 4 sites with 4 placed in all; 3 of the sites in F2P.

          ## Data

          From the \`woodcutting_trees\` row \`yew_tree_table\`.

          | Level | XP | Product | Respawn (ticks) | Depletes |
          |---|---|---|---|---|
          | 60 | 175 | Yew logs | 200 | 1 in 8 logs |

          | Axe | Low | High |
          |---|---|---|
          | Bronze axe | 4 | 12 |
          | Rune axe | 14 | 44 |

          Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at Woodcutting level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).

          A respawnrate of 0 in the row means 120-199 ticks and a tree that depletes with every log; any other tree depletes 1 in 8 logs (skill_woodcutting/scripts/woodcut.rs2).

          Respawn is the base in game ticks (0.6 s), which the scripts shorten as more players are online (general/scripts/player_count.rs2).

          ## Sites

          | Area | Site | Centre | Stand | Count | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|---|---|
          | [Region](../../places/region.md) | \`tree:region:0\` | (3200, 3200) | (3200, 3199) | 1 | no | yes | 12 |
          | [Town (Region)](../../places/town.md) | \`tree:town:0\` | (3150, 3150) L1 | (3150, 3151) L1 | 1 | yes | no | - |
          | [Town (Region)](../../places/town.md) | \`tree:town:2\` | (3200, 3200) | (3200, 3199) | 1 | yes | no | - |
          | [Town (Region)](../../places/town.md) | \`tree:town:10\` | (3200, 3200) | (3200, 3199) | 1 | yes | no | - |
          "
        `);
    });

    test('a resource subtype with no axe rows and no respawnrate says so', () => {
        expect(pages.get('wiki/resources/tree/oak.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Tree: oak

          In-game name: Oak. 1 site with 1 placed in all; 1 of the sites in F2P.

          ## Data

          From the \`woodcutting_trees\` row \`oak_tree_table\`.

          | Level | XP | Product | Respawn (ticks) | Depletes |
          |---|---|---|---|---|
          | 15 | 37.5 | oak_logs | - | - |

          The row lists no success chance per axe.

          Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at Woodcutting level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).

          A respawnrate of 0 in the row means 120-199 ticks and a tree that depletes with every log; any other tree depletes 1 in 8 logs (skill_woodcutting/scripts/woodcut.rs2).

          Respawn is the base in game ticks (0.6 s), which the scripts shorten as more players are online (general/scripts/player_count.rs2).

          ## Sites

          | Area | Site | Centre | Stand | Count | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|---|---|
          | [Town (Region)](../../places/town.md) | \`tree:town:0\` | (3150, 3150) L1 | (3150, 3151) L1 | 1 | yes | no | - |
          "
        `);
    });

    test('a service page: every site of the kind with area, stand and counts', () => {
        expect(pages.get('wiki/services/bank.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Banks

          1 site, 1 of them in F2P.

          | Area | Site | Centre | Stand | Counts | F2P |
          |---|---|---|---|---|---|
          | [Town bank (Town)](../places/town-bank.md) | \`bank:town-bank:0\` | (3200, 3200) | (3200, 3199) | Bank booth 2, Banker 1 | yes |
          "
        `);
    });

    test('the README: a generated head, then the hand-written body as it was', () => {
        expect(pages.get(README)).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) down to the hand-written line below. -->
          # World index

          Generated from \`server/content\` at \`abc123\`: 3 areas (1 top level), 10 features, 7 sites, in [wiki/world.json](../world.json).

          | Folder | Pages | One page per |
          |---|---|---|
          | [wiki/places/](../places/) | 3 | area: the sites whose deepest area it is, by kind, then each child area with its sites summed |
          | [wiki/resources/](../resources/) | 2 | resource subtype (tree, rock, fishing spot, stall, thieving chest, pickpocket target): its dbrow data, then every site |
          | [wiki/services/](../services/) | 15 | service kind (bank, shop, furnace, anvil, range, altar, ...): every site |

          <!-- Hand-written below this line: build.ts keeps it as it is. -->

          Hand-written.
          "
        `);
    });

    test('two subtypes that would share a page throw', () => {
        const clash = {
            ...world,
            sites: [site('tree:town:0', ['region', 'town'], [3], { 'rune stones': 1, 'rune-stones': 1 })],
        };
        expect(() => renderWorld(clash, data)).toThrow(
            'tree subtypes share the page wiki/resources/tree/rune-stones.md',
        );
    });
});

// One site of each resource kind and of the kinds counted by in-game name, all in one town: two
// pickpocket configs and a monster share the name Man, a shop is titled each of the three ways, and a
// tree's subtype has two dbrow rows.
const named: World = {
    format: 1,
    generatedFrom: 'abc123',
    areas: [{ id: 'town', name: 'Town', rects: [{ x1: 3000, z1: 3000, x2: 3500, z2: 3500 }] }],
    features: [
        feature('rock', 'iron', 'Rocks', 'ironrock1', 3200, 3200),
        feature('stall', 'bakerystall', "Baker's stall", 'bakerystall', 3200, 3200),
        feature('fishing-spot', 'saltfish', 'Fishing spot', '0_1_saltfish', 3200, 3200, 0, 'npc'),
        feature('fishing-spot', 'saltfish', 'Fishing spot', '0_2_saltfish', 3201, 3200, 0, 'npc'),
        feature('thieving-chest', 'chest_10_coins', 'Chest', 'chest_10_coins', 3200, 3200),
        feature('pickpocket', 'man', 'Man', 'man', 3200, 3200, 0, 'npc'),
        feature('pickpocket', 'man2', 'Man', 'man2', 3201, 3200, 0, 'npc'),
        feature('shop', 'swordshop', 'Shop keeper', 'swordkeeper', 3200, 3200, 0, 'npc'),
        feature('shop', 'rottenshop', 'Fadli', 'fadli', 3201, 3200, 0, 'npc'),
        feature('shop', 'junkshop', 'Junk man', 'junkman', 3202, 3200, 0, 'npc'),
        feature('npc', 'goblin', 'Goblin', 'goblin', 3200, 3200, 0, 'npc'),
        feature('npc', 'man3', 'Man', 'man3', 3201, 3200, 0, 'npc'),
        feature('bank', 'banker', 'Banker', 'banker1', 3200, 3200, 0, 'npc'),
        feature('bank', 'banker', 'Banker', 'banker2', 3201, 3200, 0, 'npc'),
        feature('bank', 'booth', 'Bank booth', 'bankbooth', 3202, 3200),
        feature('tree', 'willow', 'Willow', 'willowtree', 3200, 3200),
    ],
    sites: [
        site('bank:town:0', ['town'], [12, 13, 14], { banker: 2, booth: 1 }),
        site('fishing-spot:town:0', ['town'], [2, 3], { saltfish: 2 }),
        site('npc:town:0', ['town'], [10, 11], { goblin: 1, man3: 1 }),
        site('pickpocket:town:0', ['town'], [5, 6], { man: 1, man2: 1 }),
        site('rock:town:0', ['town'], [0], { iron: 1 }),
        site('shop:town:0', ['town'], [7, 8, 9], { junkshop: 1, rottenshop: 1, swordshop: 1 }),
        site('stall:town:0', ['town'], [1], { bakerystall: 1 }),
        site('thieving-chest:town:0', ['town'], [4], { chest_10_coins: 1 }),
        site('tree:town:0', ['town'], [15], { willow: 1 }),
    ],
};

const namedData: RenderData = {
    dbrows: [
        {
            row: 'iron_rock',
            table: 'mining_table',
            data: {
                rock: [['ironrock1']],
                ore_name: [['iron']],
                rock_level: [['15']],
                rock_exp: [['350']],
                rock_output: [['iron_ore']],
                rock_respawnrate: [['9']],
                rock_successchance: [['96', '350']],
            },
        },
        {
            row: 'bakery',
            table: 'stealing',
            data: {
                loc: [['bakerystall']],
                level: [['5']],
                experience: [['160']],
                respawn_ticks: [['4']],
                owner: [['baker']],
                guard: [['guard1'], ['guard1']],
                loot: [['cake', '1', '1', '10'], ['coins', '2', '5', '10'], ['cake', '1', '1', '5'], []],
            },
        },
        {
            row: 'chest_10',
            table: 'trapped_chest',
            data: {
                loc: [['chest_10_coins']],
                level: [['13']],
                experience: [['78']],
                respawn_ticks: [['12']],
                loot: [['coins', '10', '10']],
            },
        },
        {
            row: 'man_row',
            table: 'pickpocket',
            data: {
                npc: [['man'], ['man2']],
                level: [['1']],
                experience: [['80']],
                success_chance: [['180', '240']],
                stun_ticks: [['8']],
                stun_damage: [['1']],
                loot: [['coins', '3', '3']],
            },
        },
        {
            row: 'willow_tree_table',
            table: 'woodcutting_trees',
            data: { tree: [['willowtree']], successchance: [['bronze_axe', '8', '24'], ['rune_axe']] },
        },
        { row: 'willow_table', table: 'woodcutting_trees', data: { tree: [['willowtree2']] } },
    ],
    npcConfigs: new Map<string, Config>([
        ['0_1_saltfish', { name: ['Fishing spot'], op1: ['Net'], op3: ['Bait'], op5: ['hidden'] }],
        ['0_2_saltfish', { name: ['Fishing spot'] }],
        ['baker', { name: ['Baker'] }],
        ['guard1', { name: ['Guard'] }],
        ['swordkeeper', { param: ['owned_shop,swordshop', 'shop_title,Sword Shop'] }],
        // The explicit call's title wins over the npc's own, and a title for another inv is not this one's.
        ['fadli', { param: ['owned_shop,rottenshop', "shop_title,Fadli's Shop"] }],
        ['junkman', { param: ['owned_shop,othershop', 'shop_title,Other Shop'] }],
    ]),
    objConfigs: new Map([
        ['iron_ore', { name: ['Iron ore'] }],
        ['cake', { name: ['Cake'] }],
        ['coins', { name: ['Coins'] }],
        ['bronze_axe', { name: ['Bronze axe'] }],
    ]),
    shopTitles: new Map([['rottenshop', 'Shop of Distaste']]),
    readmeBody: '',
};

const namedPages = renderWorld(named, namedData);

/** A resource page's Data section, without the heading. */
const dataOf = (path: string): string => {
    const page = namedPages.get(path)!;
    return page.slice(page.indexOf('## Data\n') + '## Data\n'.length, page.indexOf('## Sites\n'));
};

describe('in-game names and resource data', () => {
    test('a place page counts by in-game name: a shop by its title, a config beside a name the page shares', () => {
        expect(namedPages.get('wiki/places/town.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Town

          ## [Banks](../services/bank.md)

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`bank:town:0\` | (3200, 3200) | Bank booth 1, Banker 2 | yes | no | - |

          ## [Shops](../services/shop.md)

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`shop:town:0\` | (3200, 3200) | Junk man (junkshop) 1, Shop of Distaste (rottenshop) 1, Sword Shop (swordshop) 1 | yes | no | - |

          ## Trees

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`tree:town:0\` | (3200, 3200) | [willow](../resources/tree/willow.md) 1 | yes | no | - |

          ## Rocks

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`rock:town:0\` | (3200, 3200) | [iron](../resources/rock/iron.md) 1 | yes | no | - |

          ## Fishing spots

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`fishing-spot:town:0\` | (3200, 3200) | [Fishing spot (saltfish)](../resources/fishing-spot/saltfish.md) 2 | yes | no | - |

          ## Stalls

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`stall:town:0\` | (3200, 3200) | [Baker's stall](../resources/stall/bakerystall.md) 1 | yes | no | - |

          ## Thieving chests

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`thieving-chest:town:0\` | (3200, 3200) | [chest_10_coins](../resources/thieving-chest/chest_10_coins.md) 1 | yes | no | - |

          ## Pickpocket targets

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`pickpocket:town:0\` | (3200, 3200) | [Man (man)](../resources/pickpocket/man.md) 1, [Man (man2)](../resources/pickpocket/man2.md) 1 | yes | no | - |

          ## Monsters

          | Site | Centre | Counts | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|
          | \`npc:town:0\` | (3200, 3200) | Goblin 1, Man (man3) 1 | yes | no | - |
          "
        `);
    });

    test('a services page: shops by title with the inv beside it, banks by name', () => {
        expect(namedPages.get('wiki/services/shop.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Shops

          1 site, 1 of them in F2P.

          | Area | Site | Centre | Stand | Counts | F2P |
          |---|---|---|---|---|---|
          | [Town](../places/town.md) | \`shop:town:0\` | (3200, 3200) | (3200, 3199) | Junk man (junkshop) 1, Shop of Distaste (rottenshop) 1, Sword Shop (swordshop) 1 | yes |
          "
        `);
        expect(namedPages.get('wiki/services/bank.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Banks

          1 site, 1 of them in F2P.

          | Area | Site | Centre | Stand | Counts | F2P |
          |---|---|---|---|---|---|
          | [Town](../places/town.md) | \`bank:town:0\` | (3200, 3200) | (3200, 3199) | Bank booth 1, Banker 2 | yes |
          "
        `);
    });

    test('a pickpocket page is titled by its in-game name, with the config where another shares it', () => {
        expect(namedPages.get('wiki/resources/pickpocket/man2.md')).toMatchInlineSnapshot(`
          "<!-- Generated by wiki/world/build.ts (bun run world) from the game data. Do not edit. -->
          # Pickpocket target: Man (man2)

          In-game name: Man. 1 site with 1 placed in all; 1 of the sites in F2P.

          ## Data

          From the \`pickpocket\` row \`man_row\`.

          | Level | XP | Low | High | Stun (ticks) | Stun damage | Loot |
          |---|---|---|---|---|---|---|
          | 1 | 8 | 180 | 240 | 8 | 1 | Coins x3 |

          Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at Thieving level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).

          ## Sites

          | Area | Site | Centre | Stand | Count | F2P | Multiway | Wilderness |
          |---|---|---|---|---|---|---|---|
          | [Town](../../places/town.md) | \`pickpocket:town:0\` | (3200, 3200) | (3200, 3199) | 1 | yes | no | - |
          "
        `);
    });

    test("a stall's page is titled by its in-game name; its data: owner, guards once, loot once", () => {
        expect(namedPages.get('wiki/resources/stall/bakerystall.md')!.split('\n')[1]).toBe("# Stall: Baker's stall");
        expect(dataOf('wiki/resources/stall/bakerystall.md')).toMatchInlineSnapshot(`
          "
          From the \`stealing\` row \`bakery\`.

          | Level | XP | Respawn (ticks) | Owner | Guards | Loot |
          |---|---|---|---|---|---|
          | 5 | 16 | 4 | Baker | Guard | Cake, Coins x2-5, - x- |

          "
        `);
    });

    test('rock, fishing spot and thieving chest data', () => {
        expect(dataOf('wiki/resources/rock/iron.md')).toMatchInlineSnapshot(`
          "
          From the \`mining_table\` row \`iron_rock\`.

          | Row | Level | XP | Ore | Respawn (ticks) | Low | High |
          |---|---|---|---|---|---|---|
          | iron_rock | 15 | 35 | Iron ore | 9 | 96 | 350 |

          Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at Mining level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts). The pair is the same whatever the pickaxe: mining_table has no pickaxe column.

          Respawn is the base in game ticks (0.6 s), which the scripts shorten as more players are online (general/scripts/player_count.rs2).

          "
        `);
        expect(dataOf('wiki/resources/fishing-spot/saltfish.md')).toMatchInlineSnapshot(`
          "
          The options of each spot config placed in the world (its npc config).

          | Config | Name | Options |
          |---|---|---|
          | 0_1_saltfish | Fishing spot | Net, Bait |
          | 0_2_saltfish | Fishing spot | - |

          "
        `);
        expect(dataOf('wiki/resources/thieving-chest/chest_10_coins.md')).toMatchInlineSnapshot(`
          "
          From the \`trapped_chest\` row \`chest_10\`.

          | Level | XP | Respawn (ticks) | Loot |
          |---|---|---|---|
          | 13 | 7.8 | 12 | Coins x10 |

          "
        `);
    });

    test("a subtype's several rows each name their axe table; a missing tuple value reads -", () => {
        expect(dataOf('wiki/resources/tree/willow.md')).toMatchInlineSnapshot(`
          "
          From the \`woodcutting_trees\` rows \`willow_tree_table\`, \`willow_table\`.

          | Level | XP | Product | Respawn (ticks) | Depletes |
          |---|---|---|---|---|
          | - | - | - | - | - |
          | - | - | - | - | - |

          \`willow_tree_table\`:

          | Axe | Low | High |
          |---|---|---|
          | Bronze axe | 8 | 24 |
          | rune_axe | - | - |

          \`willow_table\`:

          The row lists no success chance per axe.

          Low and high are the stat_random bounds: an attempt succeeds with chance (low + 1)/256 at Woodcutting level 1, rising evenly to (high + 1)/256 at 99 (server/engine/src/engine/script/handlers/PlayerOps.ts).

          A respawnrate of 0 in the row means 120-199 ticks and a tree that depletes with every log; any other tree depletes 1 in 8 logs (skill_woodcutting/scripts/woodcut.rs2).

          Respawn is the base in game ticks (0.6 s), which the scripts shorten as more players are online (general/scripts/player_count.rs2).

          "
        `);
    });
});

describe('openshopTitles', () => {
    test('reads the title literal of each explicit call, skipping commented-out ones', () => {
        const titles = openshopTitles([
            '\n~openshop(b, 550, 1000, 20, "Zaff\'s \\"Staffs\\"");\nif (x) ~openshop(a, 1, 1, 1, "A");',
            '\n// ~openshop(c, 1, 1, 1, "C");\n~openshop(d, 1, 1, 1, $title);\n~openshop(a, 1, 1, 1, "A");',
        ]);
        expect([...titles]).toEqual([
            ['a', 'A'],
            ['b', 'Zaff\'s "Staffs"'],
        ]);
    });

    test('a comma inside the title is part of it', () =>
        expect([...openshopTitles(['~openshop(a, 1, 1, 1, "Bob\'s Brilliant Axes, and more");'])]).toEqual([
            ['a', "Bob's Brilliant Axes, and more"],
        ]));

    test('two titles for one inv throw', () =>
        expect(() => openshopTitles(['~openshop(a, 1, 1, 1, "A");', '~openshop(a, 1, 1, 1, "B");'])).toThrow(
            '~openshop calls give a two titles: "A" and "B"',
        ));
});

describe('helpers', () => {
    test('slug keeps config names and dashes the rest', () => {
        expect(slug('0_45_152_lavafish')).toBe('0_45_152_lavafish');
        expect(slug('rune stones')).toBe('rune-stones');
    });

    test('link is relative between repo paths', () => {
        expect(link('wiki/places/a.md', 'wiki/places/b.md')).toBe('b.md');
        expect(link('wiki/resources/tree/yew.md', 'wiki/places/a.md')).toBe('../../places/a.md');
        expect(link('wiki/world/README.md', 'wiki/places/')).toBe('../places/');
    });

    test('site ids sort by kind and area, then by number', () =>
        expect(['tree:town:10', 'tree:town:2', 'bank:town:1'].sort(bySiteId)).toEqual([
            'bank:town:1',
            'tree:town:2',
            'tree:town:10',
        ]));

    test('readmeBody is what follows the hand-written line, and throws without it', () => {
        expect(readmeBody(`head\n${HAND_WRITTEN}\nbody\n`)).toBe('body\n');
        expect(() => readmeBody('no marker\n')).toThrow('has no line');
    });
});

const roots: string[] = [];
afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })));

/** A repo with a stale page, a changed page and a file outside the generated folders. */
const tree = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'render-test-'));
    roots.push(root);
    mkdirSync(join(root, 'wiki/resources/rock'), { recursive: true });
    mkdirSync(join(root, 'wiki/places'), { recursive: true });
    writeFileSync(join(root, 'wiki/resources/rock/old.md'), 'stale');
    writeFileSync(join(root, 'wiki/places/kept.md'), 'old text');
    writeFileSync(join(root, 'wiki/other.md'), 'not generated');
    return root;
};

describe('writeFiles and drift', () => {
    const files = new Map([
        ['wiki/places/kept.md', 'new text'],
        ['wiki/places/new.md', 'a new page'],
        ['wiki/world.json', '{}\n'],
    ]);

    test('drift lists changed, missing and stale generated files, but not files outside the folders', () =>
        expect(drift(files, tree())).toEqual([
            'wiki/places/kept.md',
            'wiki/places/new.md',
            'wiki/resources/rock/old.md',
            'wiki/world.json',
        ]));

    test('writeFiles writes every file, removes the stale ones and their emptied folder, then nothing drifts', () => {
        const root = tree();
        expect(writeFiles(files, root)).toEqual(['wiki/resources/rock/old.md']);
        expect(readFileSync(join(root, 'wiki/places/kept.md'), 'utf8')).toBe('new text');
        expect(existsSync(join(root, 'wiki/resources/rock'))).toBe(false);
        expect(existsSync(join(root, 'wiki/resources'))).toBe(true);
        expect(readFileSync(join(root, 'wiki/other.md'), 'utf8')).toBe('not generated');
        expect(drift(files, root)).toEqual([]);
    });

    test('drift reports a path it cannot read as a file (a folder there) as differing', () => {
        const root = tree();
        mkdirSync(join(root, 'wiki/world.json'));
        expect(drift(files, root)).toContain('wiki/world.json');
    });

    test('writeFiles refuses a path outside world.json, the README and the generated folders, writing nothing', () => {
        for (const p of ['wiki/other.md', 'wiki/places/../other.md', '../outside.md', 'wiki/placesx/a.md']) {
            const root = tree();
            expect(() => writeFiles(new Map([...files, [p, 'x']]), root)).toThrow(`not ${p}`);
            expect(readFileSync(join(root, 'wiki/places/kept.md'), 'utf8')).toBe('old text');
            expect(existsSync(join(root, 'wiki/resources/rock/old.md'))).toBe(true);
        }
        expect(() => writeFiles(new Map([[README, 'x']]), tree())).not.toThrow();
    });

    test('writeFiles refuses a generated folder that is a symlink, leaving its target alone', () => {
        const root = tree();
        const elsewhere = mkdtempSync(join(tmpdir(), 'render-test-target-'));
        roots.push(elsewhere);
        writeFileSync(join(elsewhere, 'precious.md'), 'keep');
        rmSync(join(root, 'wiki/places'), { recursive: true });
        symlinkSync(elsewhere, join(root, 'wiki/places'));
        expect(() => writeFiles(files, root)).toThrow('wiki/places is a symlink');
        expect(readFileSync(join(elsewhere, 'precious.md'), 'utf8')).toBe('keep');
    });

    test('writeFiles refuses a dangling symlink in place of a generated folder, creating nothing at its target', () => {
        const root = tree();
        const missing = join(root, 'nowhere');
        rmSync(join(root, 'wiki/places'), { recursive: true });
        symlinkSync(missing, join(root, 'wiki/places'));
        expect(() => writeFiles(files, root)).toThrow('wiki/places is a symlink');
        expect(existsSync(missing)).toBe(false);
        expect(existsSync(join(root, 'wiki/resources/rock/old.md'))).toBe(true);
    });
});
