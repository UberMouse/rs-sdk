// Facts about the real world, checked against one in-memory build of the game data.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BANKS } from '../../../conductor/lib/banks';
import { AREAS } from '../areas';
import { buildWorld, COVERED } from '../build';
import { reachCollision, siteCollision } from '../collision';
import { WIKI } from '../paths';
import { locSizes } from '../place';
import { readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { readCallables, readTriggers } from '../sources/triggers';
import { coord } from '../reach';
import type { Feature, Site, Tile } from '../types';

// Built when the file loads, where no timeout applies: the build reads all the game data, 3-4s here,
// too close to the 5s bun gives a beforeAll hook (and bun-types 1.2 declares no hook timeout).
const { world, report } = buildWorld({ generatedFrom: 'test', areas: AREAS, collision: reachCollision });

/** Lower case, letters and digits only: a shop page's slug against an inventory name. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

let squares: ReturnType<typeof readAllMapSquares> | undefined;
/** Every placement in the map files, read once: the closed booths are not features. */
const mapSquares = (): ReturnType<typeof readAllMapSquares> => (squares ??= readAllMapSquares());

const sitesOf = (kind: Site['kind']): Site[] => world.sites.filter(s => s.kind === kind);
const featuresOf = (s: Site): Feature[] => s.features.map(i => world.features[i]!);
/** The sites of a kind whose deepest area is `leaf`. */
const inLeaf = (kind: Site['kind'], leaf: string): Site[] => sitesOf(kind).filter(s => s.areaPath.at(-1) === leaf);
/** The inventories the shop features of an npc config record. */
const shopSubtypesOf = (npc: string): string[] =>
    sitesOf('shop')
        .flatMap(featuresOf)
        .filter(f => f.config === npc)
        .map(f => f.subtype);
const spawnsOf = (config: string) => world.npcSpawns.filter(s => s.config === config);
const reachOf = (id: string) => world.sites.find(s => s.id === id)?.reach;
/** A gate landing as the build report writes one. */
const shown = (g: { trigger: string; tile: Tile }, stand: Tile, landing: Tile) =>
    `${g.trigger} ${coord(g.tile)} from ${coord(stand)} -> ${coord(landing)}`;
/** The crossing rows done by an op on a loc config. */
const rowsOn = (loc: string) => world.crossings.filter(c => c.act.kind === 'loc-op' && c.act.loc === loc);
/** The place-page ids the Locations rows of an npc page link, in page order. */
const pagePlaces = (page: string): string[] =>
    [
        ...readFileSync(join(WIKI, 'npcs', page), 'utf8')
            .split('\n## ')
            .find(s => /^Locations?\n/.test(s))!
            .matchAll(/^\| \[[^\]]+\]\(\.\.\/places\/([a-z0-9-]+)\.md\) \|/gm),
    ].map(m => m[1]!);
/** A script opening `inv` as a shop. */
const opens = (inv: string): RegExp => new RegExp(`~openshop\\(\\s*${inv}\\s*,`);

test('the build covers every site it must place', () => expect(report.uncovered).toEqual([]));

describe('the unreached report', () => {
    const { pockets, expected, stale } = report.unreached;
    const pocketOf = (site: string) => pockets.find(p => p.sites.some(s => s.id === site));

    test("EXPECTED_UNREACHED matches, and leaves out Tutorial Island's sites, its caves' and its bank's", () => {
        expect(stale).toEqual([]);
        const tutorial = world.sites.filter(
            s => COVERED.has(s.kind) && s.areaPath.some(a => a.startsWith('tutorial-island')),
        );
        expect(tutorial.map(s => s.id)).toContain('bank:tutorial-island-bank:0');
        expect(expected).toBeGreaterThanOrEqual(tutorial.length);
        const listed = new Set(pockets.flatMap(p => p.sites.map(s => s.id)));
        expect(tutorial.filter(s => listed.has(s.id))).toEqual([]);
    });

    test('a pocket per stretch of land, none of them the places the scripted moves reach', () => {
        expect(pockets.length).toBeLessThanOrEqual(160);
        const gone = [
            'tree-gnome-stronghold',
            'gnome-stronghold-bank',
            'grand-tree',
            'grand-tree-bank',
            'gnome-ball-field',
            'gnome-agility-course',
            'tree-gnome-village',
            'mage-arena-chamber',
            'mage-arena-bank',
            'lighthouse',
        ];
        // By leaf area, as the report names pockets: the swamp inside the stronghold's bounds is walled in on its own.
        expect(pockets.flatMap(p => p.sites).filter(s => gone.includes(s.areaPath.at(-1)!))).toEqual([]);
        expect(pocketOf('bank:gnome-stronghold-bank:0')).toBeUndefined();
    });
});

describe('the scripted moves (sources/gate-landings.ts deriveScriptedMoves)', () => {
    test('reach the Gnome Stronghold, Grand Tree and Mage Arena banks free, and the lighthouse shop with the quest', () => {
        expect(reachOf('bank:gnome-stronghold-bank:0')).toEqual([[]]);
        expect(reachOf('bank:grand-tree-bank:0')).toEqual([[]]);
        expect(reachOf('bank:mage-arena-bank:0')).toEqual([[]]);
        // Over the broken bridge (quest_horror.rs2:63), through the doorway only with the quest done (:3).
        expect(reachOf('shop:lighthouse:0')).toEqual([['quest:horror']]);
    });

    test("the Gnome Stronghold gate's forcemove crosses it each way, its gates.ts why as the rows' notes", () => {
        const rows = rowsOn('gnome_areagate');
        expect(rows.map(r => [r.landings.map(l => l.tile), r.source])).toEqual([
            [[{ level: 0, x: 2461, z: 3382 }], 'areas/area_gnome/scripts/gnome_gate.rs2:57'],
            [[{ level: 0, x: 2461, z: 3385 }], 'areas/area_gnome/scripts/gnome_gate.rs2:59'],
        ]);
        expect(rows.every(r => r.via === 'scripted' && r.requires.length === 1 && !r.requires[0]!.length)).toBe(true);
        expect(rows[0]!.notes).toStartWith('Shut only while The Grand Tree');
    });

    test('the Grand Tree doors, the Gnome Village railing, the Mage Arena ladders and the lighthouse stairs have rows', () => {
        for (const loc of [
            'treedoorl',
            'treedoorr',
            'treegnomelooserailing',
            'magearena_ladder_to_cellar',
            'magearena_ladder_from_cellar',
            'horror_broken_bridge_left_spot',
            'horror_broken_bridge_right_spot',
            'horror_lighthouse_spiralstairs_base',
        ])
            expect(rowsOn(loc).length).toBeGreaterThan(0);
        // The railing squeezes the player through it, one tile either way (gnomevillage_fence.rs2:12).
        expect(rowsOn('treegnomelooserailing').map(r => [r.from, r.landings[0]!.tile])).toEqual([
            [
                [
                    { level: 0, x: 2515, z: 3161 },
                    { level: 0, x: 2516, z: 3161 },
                ],
                { level: 0, x: 2515, z: 3160 },
            ],
            [[{ level: 0, x: 2515, z: 3160 }], { level: 0, x: 2515, z: 3161 }],
        ]);
    });

    test('an agility walk behind a roll carries it and its failure: the Wilderness course log', () => {
        const [row] = rowsOn('wilderness_log_balance1');
        expect(row!.roll).toMatchObject({
            stat: 'agility',
            low: 200,
            high: 250,
            source: 'skill_agility/scripts/wilderness_course.rs2:136',
            fail: { to: { level: 0, x: 2998, z: 10345 } },
        });
    });

    test('no move is a duplicate of a connector row, and every row is written, beside the teleports', () => {
        expect(report.scripted.duplicates).toEqual([]);
        expect(report.scripted.rows + report.teleports.rows + report.npcTeleports.rows + report.curated.rows).toBe(
            world.crossings.length,
        );
    });

    test("Crandor up the rope from Elvarg's lair asks Dragon Slayer: the secret door from the volcano side", () => {
        // Karamja by the 30-coin ship, or by the glider to Gandius.
        expect(reachOf('rock:crandor:0')).toEqual([
            ['coins:30', 'quest:dragon'],
            ['quest:dragon', 'quest:grandtree'],
        ]);
    });
});

describe('the Shantay Pass, a move the trigger queues ([queue,shantay_pass_enter])', () => {
    const [pass, ...more] = world.gates.filter(g => g.trigger === 'oploc1,shantay_pass_henge_doorway');

    test('from the north it takes a pass and lands south of the gate, where the queued script steps the player', () => {
        expect(more).toEqual([]);
        expect(pass!.requires).toEqual([['consume:shantay_pass:1', 'members']]);
        expect(pass!.from).toBe('north');
        const north = pass!.landings!.filter(l => l.stand.z > pass!.tile.z);
        expect(north.length).toBeGreaterThan(0);
        // p_teleport(0_51_48_40_46), then p_telejump(movecoord(coord, 0, 0, -3)) (shantay_pass.rs2:105, :109).
        for (const l of north) expect(l.landing).toEqual({ level: 0, x: 3304, z: 3115 });
    });

    test('its act answers the poster, asked only of a player holding no disclaimer', () =>
        expect(pass!.act).toEqual({
            kind: 'loc-op',
            loc: 'shantay_pass_henge_doorway',
            op: 1,
            choices: ["Yeah, that poster doesn't scare me!"],
        }));

    test('the desert south of it is reached with a pass: the Bedabin camp shop, and the mining camp with its key', () => {
        expect(reachOf('shop:bedabin-camp:0')).toEqual([['consume:shantay_pass:1']]);
        // The camp's gates open with the metal key held (quest_desertrescue.rs2:119).
        expect(reachOf('rock:desert-mining-camp:0')).toEqual([['consume:shantay_pass:1', 'item:metal_key:held']]);
    });

    test('a stand level with the gate goes out free, as `from: north` alone would not say', () => {
        // `coordz(coord) <= coordz(loc_coord)` steps the player three north scot-free (shantay_pass.rs2:70, :72).
        const east = pass!.landings!.find(l => l.stand.x === 3306 && l.stand.z === pass!.tile.z);
        expect(east).toEqual({
            stand: { level: 0, x: 3306, z: 3116 },
            landing: { level: 0, x: 3306, z: 3119 },
            free: true,
        });
        // So the way back north to the Shantay chest takes no pass: only the camp's key.
        expect(world.sites.find(s => s.id === 'rock:desert-mining-camp:0')?.nearest?.bank).toEqual({
            site: 'bank:shantay-pass-bank-chest:0',
            runTicks: 60,
            requires: ['item:metal_key:held'],
        });
    });
});

describe('free gate landings (sources/gate-landings.ts)', () => {
    test('every one: a side the script lets through, past nothing the bound run cannot read but a wait', () => {
        // A new one, or one gone, is a change to what a stand crosses free: read its script.
        const free = world.gates.flatMap(g =>
            (g.landings ?? []).filter(l => l.free).map(l => shown(g, l.stand, l.landing)),
        );
        expect(free).toEqual([
            // South of the gate, the Regicide guard lets the player out (regicide_arandar_gate_guard.rs2:5).
            'oploc1,overpass_gate_left (2384, 3334) from (2384, 3333) -> (2385, 3335)',
            'oploc1,overpass_gate_left (2384, 3334) from (2385, 3333) -> (2385, 3335)',
            'oploc1,overpass_gate_right (2386, 3334) from (2386, 3333) -> (2385, 3335)',
            'oploc1,overpass_gate_right (2386, 3334) from (2387, 3333) -> (2387, 3335)',
            // The pipes ask Agility from one end only, then wait out a player in the pipe (barbarian_course.rs2:126,
            // :139; karam_dungeon.rs2:289, :299, :319, :329).
            'oploc1,barbarian_obstacle_pipe (2552, 3559) from (2551, 3559) -> (2552, 3561)',
            'oploc1,barbarian_obstacle_pipe (2552, 3559) from (2552, 3558) -> (2552, 3561)',
            'oploc1,barbarian_obstacle_pipe (2552, 3559) from (2553, 3559) -> (2552, 3561)',
            'oploc1,karam_dungeon_pipe2 (2655, 9567) from (2655, 9569) -> (2655, 9563)',
            'oploc1,karam_dungeon_pipe2 (2655, 9567) from (2656, 9568) -> (2655, 9563)',
            'oploc1,karam_dungeon_pipe2 (2655, 9571) from (2654, 9572) -> (2655, 9566)',
            'oploc1,karam_dungeon_pipe2 (2655, 9571) from (2655, 9573) -> (2655, 9566)',
            'oploc1,karam_dungeon_pipe (2698, 9493) from (2697, 9493) -> (2698, 9500)',
            'oploc1,karam_dungeon_pipe (2698, 9493) from (2698, 9492) -> (2698, 9500)',
            'oploc1,karam_dungeon_pipe (2698, 9493) from (2699, 9493) -> (2698, 9500)',
            'oploc1,karam_dungeon_pipe (2698, 9498) from (2697, 9498) -> (2698, 9503)',
            'oploc1,karam_dungeon_pipe (2698, 9498) from (2698, 9497) -> (2698, 9503)',
            'oploc1,karam_dungeon_pipe (2698, 9498) from (2699, 9498) -> (2698, 9503)',
            // South of the Shantay Pass, and level with it, the player goes north scot-free (shantay_pass.rs2:70).
            'oploc1,shantay_pass_henge_doorway (3302, 3116) from (3303, 3115) -> (3303, 3118)',
            'oploc1,shantay_pass_henge_doorway (3302, 3116) from (3304, 3115) -> (3304, 3118)',
            'oploc1,shantay_pass_henge_doorway (3302, 3116) from (3306, 3116) -> (3306, 3119)',
            // North of the lumberyard fence, members only from the south, the player waits out a climber
            // (quest_fluffs.rs2:117, :131).
            'oploc1,gertrudefence (3305, 3493) from (3304, 3493) -> (3305, 3492)',
            'oploc1,gertrudefence (3305, 3493) from (3305, 3494) -> (3305, 3492)',
            'oploc1,gertrudefence (3305, 3493) from (3306, 3493) -> (3305, 3492)',
        ]);
        // Those past a wait, each listed in the build report: the pipes and the fence.
        expect(report.gates.landings.waited.map(w => shown(w, w.stand, w.landing))).toEqual(
            free.filter(f => /pipe|gertrudefence/.test(f)),
        );
    });
});

describe('banks', () => {
    test('Varrock West bank: 6 booths, 6 bankers, level 0', () => {
        const [site, ...rest] = inLeaf('bank', 'varrock-west-bank');
        expect(rest).toEqual([]);
        expect(site!.counts).toEqual({ banker: 6, booth: 6 });
        expect(featuresOf(site!).every(f => f.tile.level === 0)).toBe(true);
    });

    test('Lumbridge has no bank site', () => {
        expect(sitesOf('bank').filter(s => s.areaPath.some(id => id.startsWith('lumbridge')))).toEqual([]);
    });

    test('Canifis bank is one site on level 0 with 4 booths and 2 bankers', () => {
        // The bridge flag puts the booths, filed on level 1, on level 0 (sources/maps.ts).
        const sites = sitesOf('bank').filter(s => s.areaPath.includes('canifis'));
        expect(sites.length).toBe(1);
        expect(sites[0]!.counts).toEqual({ banker: 2, booth: 4 });
        expect(featuresOf(sites[0]!).every(f => f.tile.level === 0)).toBe(true);
    });

    test('both Gnome Stronghold banks are on level 1', () => {
        const sites = ['gnome-stronghold-bank', 'grand-tree-bank'].flatMap(leaf => inLeaf('bank', leaf));
        expect(sites.length).toBe(2);
        expect(sites.flatMap(featuresOf).every(f => f.tile.level === 1)).toBe(true);
    });

    test('25 bank sites, the Shantay chest among them', () => {
        expect(
            sitesOf('bank')
                .map(s => s.areaPath.at(-1))
                .sort(),
        ).toEqual([
            'al-kharid-bank',
            'ardougne-north-bank',
            'ardougne-south-bank',
            'canifis-bank',
            'castle-wars-bank',
            'catherby-bank',
            'draynor-bank',
            'duel-arena-bank',
            'edgeville-bank',
            'falador-east-bank',
            'falador-west-bank',
            'fishing-guild-bank',
            'gnome-stronghold-bank',
            'grand-tree-bank',
            'legends-guild-bank',
            'mage-arena-bank',
            'miscellania-bank',
            'seers-village-bank',
            'shantay-pass-bank-chest',
            'shilo-village-bank',
            'tutorial-island-bank',
            'varrock-east-bank',
            'varrock-west-bank',
            'yanille-bank',
            'zanaris-bank',
        ]);
        // The Shantay chest is a bank: [oploc1,thbankchest] in areas/area_alkharid/scripts/
        // shantay_chest.rs2 shows a message and goes to @openbank (members only). It is a site of its
        // own, one chest.
        const [shantay] = inLeaf('bank', 'shantay-pass-bank-chest');
        expect(shantay!.counts).toEqual({ chest: 1 });
        expect(featuresOf(shantay!).map(f => f.config)).toEqual(['thbankchest']);
        // Shantay and his prison door reach @openbank only to pay the jail fine (classify.ts
        // BANK_SIDE_EFFECTS), so neither is a bank.
        const shantays = world.features.filter(f => f.config === 'shantay' || f.config === 'shantay_prisondoor');
        expect(shantays.map(f => `${f.config} ${f.kind}`)).toEqual(['shantay shop']);
    });

    test('the Duel Arena bank is Fadli and the two closed chests; the tutorial bank has its bankers', () => {
        // The closed chests open into bank chests (minigames/game_duelarena/scripts/misc_locs.rs2).
        const [duel] = inLeaf('bank', 'duel-arena-bank');
        expect(duel!.counts).toEqual({ banker: 1, chest: 2 });
        expect(featuresOf(duel!).map(f => f.config)).toEqual(['loc_3193', 'loc_3193', 'duel_fadli']);
        // noobbanker's Talk-to menu opens the bank (tutorial/scripts/npcs/tut_banker.rs2).
        const [tutorial] = inLeaf('bank', 'tutorial-island-bank');
        expect(tutorial!.counts).toEqual({ banker: 2, booth: 2 });
    });

    test('closed and private booths are not banks', () => {
        const pack = readPack('loc');
        const ids = new Set(['bankboothclosed', 'loc_2214'].map(c => pack.id.get(c)));
        const placed = mapSquares().locs.filter(l => ids.has(l.id));
        // Both are placed in the world, so the build saw them and left them out.
        expect(new Set(placed.map(l => pack.name.get(l.id)))).toEqual(new Set(['bankboothclosed', 'loc_2214']));
        expect(world.features.filter(f => f.config === 'bankboothclosed' || f.config === 'loc_2214')).toEqual([]);
    });

    test('every banks.ts stand tile reaches a booth or chest of its bank site, near its stand tile', () => {
        // banks.ts is a view of these sites, and its curated stand can be 4 tiles from the generated one, both
        // right: at Varrock West the generated stand (3185, 3440) is the public-side tile nearest the booth row's
        // centre and banks.ts has (3185, 3436) at the row's south end. Each reaches a booth by the engine's reach
        // test (collision.real.test.ts pins the banks.ts one), so that test is the check. A site of bankers only
        // has no loc to reach.
        const size = locSizes(readConfigs('loc'));
        const banks = new Map(sitesOf('bank').map(s => [s.id, s]));
        for (const b of BANKS) {
            const tile = b.stand;
            const site = banks.get(b.id);
            const booths = site ? featuresOf(site).filter(f => f.source === 'loc') : [];
            const reaches =
                !booths.length ||
                booths.some(f =>
                    siteCollision.reached(tile, {
                        ...f.tile,
                        ...size(f),
                        shape: f.shape ?? 10,
                        rotation: f.rotation ?? 0,
                    }),
                );
            const near = (s: Site): number => Math.max(Math.abs(s.stand!.x - tile.x), Math.abs(s.stand!.z - tile.z));
            expect({
                bank: b.name,
                walkable: siteCollision.walkable(tile.level, tile.x, tile.z),
                reaches,
                near: !!site?.stand && near(site) <= 4,
            }).toEqual({
                bank: b.name,
                walkable: true,
                reaches: true,
                near: true,
            });
        }
    });
});

describe('resources and shops', () => {
    test('yew trees exist and every tree site has a subtype from trees.dbrow', () => {
        const rows = readDbrows().filter(r => r.table === 'woodcutting_trees');
        // A tree's subtype is the name of the dbrow row listing its config: yew_tree_table -> yew.
        const rowOf = new Map(rows.flatMap(r => (r.data.tree ?? []).map(([config]) => [config!, r.row])));
        const trees = sitesOf('tree');
        expect(trees.some(s => s.counts.yew)).toBe(true);
        for (const f of trees.flatMap(featuresOf)) expect(rowOf.get(f.config)).toStartWith(`${f.subtype}_`);
    });

    test('Varrock East mine has tin, copper and iron rocks', () => {
        // ironrock1 at (3285-3286, 3368-3369) and ironrock2 at (3288, 3370) in server/content/maps/
        // m51_52.jm2, as learnings/mining.md has it ("SE Varrock mine": copper, tin, iron).
        const counts = inLeaf('rock', 'varrock-east-mine').flatMap(s => Object.keys(s.counts));
        expect(new Set(counts)).toEqual(new Set(['copper', 'iron', 'tin']));
    });

    // wiki/generate-shops.ts writes a page for every restocking inventory, whether or not anything
    // opens it, so these pages have no shop site, each for a reason in the data.
    /** Inventories no script opens: no `~openshop(<inv>, ...)` anywhere in server/content/scripts. */
    const UNOPENED = ['fishrestaurant', 'foodshop', 'furstall', 'silvershop', 'spiceshop'];
    /**
     * Second inventories of a shopkeeper who opens another on members worlds, at another quest stage
     * or by another menu choice (rommik.rs2, dommik.rs2, zaff.rs2, regicidegeneralshopkeeper.rs2,
     * razmire_keelgan.rs2): the site records the first ~openshop classify.ts reaches, so the page's
     * inventory is not a site's subtype.
     */
    const SECOND: Record<string, string> = {
        'craftingshop-free': 'rommik',
        'craftingshop2-free': 'dommik',
        razmirebuildingstore: 'razmire_keelgan_afflicted',
        'regicide-general-shop': 'regicidegeneralshopkeeper',
        staffshop: 'zaff',
    };

    test('every shop page in wiki/shops has a shop site, but for pages the data explains', () => {
        const shops = sitesOf('shop').flatMap(featuresOf);
        const names = new Set(shops.map(f => f.name.toLowerCase()));
        // A page without a known owner is named after its inventory, the shop feature's subtype.
        const invs = new Set(shops.map(f => norm(f.subtype)));
        const dir = join(WIKI, 'shops');
        const missing = readdirSync(dir)
            .filter(f => f.endsWith('.md') && f !== 'README.md')
            .map(f => f.replace(/\.md$/, ''))
            .filter(slug => {
                const page = readFileSync(join(dir, `${slug}.md`), 'utf8');
                const owner = page.match(/^\| \*\*Owner\*\* \|(.*)\|$/m)?.[1] ?? '';
                const owners = [...owner.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]!.toLowerCase());
                return !owners.some(o => names.has(o)) && !invs.has(norm(slug));
            });
        expect(missing.sort()).toEqual([...UNOPENED, ...Object.keys(SECOND)].sort());
    });

    test('the pages without a site are explained by the data', () => {
        const bodies = [...readTriggers(), ...readCallables()].map(s => s.body).join('\n');
        for (const inv of UNOPENED) expect(bodies).not.toMatch(opens(inv));
        for (const [page, npc] of Object.entries(SECOND)) {
            const inv = page.replaceAll('-', '_');
            expect(bodies).toMatch(opens(inv));
            expect(shopSubtypesOf(npc)).not.toEqual([]);
            expect(shopSubtypesOf(npc)).not.toContain(inv);
        }
    });

    test('a shop page names its sites, and only the pages the data explains say not placed', () => {
        const dir = join(WIKI, 'shops');
        const pages = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
        const notPlaced = pages.filter(f => {
            const row = readFileSync(join(dir, f), 'utf8').match(/^\| \*\*Coordinates\*\* \| (.*) \|$/m)?.[1];
            expect(row).toBeDefined();
            if (row!.startsWith('not placed: ')) return true;
            // `(x, z) in [Area](../places/<id>.md)` per site, `; `-separated.
            expect(row).toMatch(/^\(\d+, \d+\)( L\d)? in \[[^\]]+\]\(\.\.\/places\/[a-z0-9-]+\.md\)(; |$)/);
            return false;
        });
        expect(notPlaced.map(f => f.replace(/\.md$/, '')).sort()).toEqual([...UNOPENED, ...Object.keys(SECOND)].sort());
    });
});

describe('npc locations', () => {
    const BANKER_CONFIGS = new Set([
        'banker1',
        'banker2',
        'fairy_banker',
        'kharidbanker1',
        'kharidbanker2',
        'misc_banker',
        'shilobanker',
        'werewolfbanker',
    ]);
    /** The 18 banks the configs of wiki/npcs/banker.md stand in: the old page named Draynor's "Edgeville area". */
    const BANKER_BANKS = [
        'al-kharid-bank',
        'ardougne-north-bank',
        'ardougne-south-bank',
        'canifis-bank',
        'catherby-bank',
        'draynor-bank',
        'edgeville-bank',
        'falador-east-bank',
        'falador-west-bank',
        'fishing-guild-bank',
        'legends-guild-bank',
        'miscellania-bank',
        'seers-village-bank',
        'shilo-village-bank',
        'varrock-east-bank',
        'varrock-west-bank',
        'yanille-bank',
        'zanaris-bank',
    ];
    const npcPack = readPack('npc');

    test('npcSpawns holds every placed npc once, in clusters of one config, level and leaf area', () => {
        const placed = mapSquares().npcs.filter(n => npcPack.name.has(n.id));
        expect(world.npcSpawns.reduce((sum, s) => sum + s.count, 0)).toBe(placed.length);
        for (const s of world.npcSpawns) {
            expect(s.centre.level).toBe(s.bbox.level!);
            expect(s.count).toBeGreaterThan(0);
        }
    });

    test("every banker of the Banker page is in a bank site, 18 of them, each its bank's", () => {
        const bankers = world.features
            .map((f, i) => ({ f, i }))
            .filter(({ f }) => f.source === 'npc' && BANKER_CONFIGS.has(f.config));
        const placed = mapSquares().npcs.filter(n => BANKER_CONFIGS.has(npcPack.name.get(n.id) ?? ''));
        expect(bankers.length).toBe(placed.length);
        expect(bankers.every(({ f }) => f.kind === 'bank')).toBe(true);
        const leaves = sitesOf('bank')
            .filter(s => s.features.some(i => BANKER_CONFIGS.has(world.features[i]!.config)))
            .map(s => s.areaPath.at(-1));
        expect(leaves.sort()).toEqual(BANKER_BANKS);
    });

    test('wiki/npcs/banker.md lists those 18 banks, and Fadli and Gundai their own', () => {
        expect(pagePlaces('banker.md').sort()).toEqual(BANKER_BANKS);
        expect(pagePlaces('fadli.md')).toEqual(['duel-arena-bank']);
        expect(pagePlaces('gundai.md')).toEqual(['mage-arena-bank']);
    });

    test('Fadli and Gundai stand in their banks: one placement each, in a bank site', () => {
        for (const [config, leaf] of [
            ['duel_fadli', 'duel-arena-bank'],
            ['magearena_banker', 'mage-arena-bank'],
        ] as const) {
            expect(spawnsOf(config).map(s => [s.areaPath.at(-1), s.count])).toEqual([[leaf, 1]]);
            const bank = sitesOf('bank').filter(s => s.features.some(i => world.features[i]!.config === config));
            expect(bank.map(s => s.areaPath.at(-1))).toEqual([leaf]);
        }
    });

    test('an npc no kind takes still has a place: Sigli the Huntsman in Rellekka', () => {
        expect(world.features.some(f => f.config === 'viking_sigli')).toBe(false);
        expect(spawnsOf('viking_sigli')).toEqual([
            {
                config: 'viking_sigli',
                areaPath: ['kandarin', 'rellekka'],
                centre: { level: 0, x: 2660, z: 3653 },
                bbox: { x1: 2660, z1: 3653, x2: 2660, z2: 3653, level: 0 },
                count: 1,
                f2p: false,
                reach: [[]],
            },
        ]);
        expect(pagePlaces('sigli-the-huntsman.md')).toEqual(['rellekka']);
    });
});
