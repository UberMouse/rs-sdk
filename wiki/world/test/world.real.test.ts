// Facts about the real world, checked against one in-memory build of the game data.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BANKS } from '../../../conductor/lib/banks';
import { AREAS } from '../areas';
import { buildWorld } from '../build';
import { reachCollision, siteCollision } from '../collision';
import { WIKI } from '../paths';
import { locSizes } from '../place';
import { readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { readCallables, readTriggers } from '../sources/triggers';
import type { Feature, Site } from '../types';

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

    test('every banks.ts stand tile reaches a booth of a generated bank site, near its stand tile', () => {
        // A banks.ts stand can be 4 tiles from the generated one, both right: at Varrock West the
        // generated stand (3185, 3440) is the public-side tile nearest the booth row's centre and
        // banks.ts has (3185, 3436) at the row's south end. Each reaches a booth by the engine's reach
        // test (collision.real.test.ts pins the banks.ts one), so that test is the check.
        const size = locSizes(readConfigs('loc'));
        const banks = sitesOf('bank').filter(s => s.stand && s.centre.level === 0);
        for (const b of BANKS) {
            const tile = { level: 0, ...b.stand };
            const near = (s: Site): number => Math.max(Math.abs(s.stand!.x - tile.x), Math.abs(s.stand!.z - tile.z));
            const site = banks.reduce((best, s) => (near(s) < near(best) ? s : best));
            const booths = featuresOf(site).filter(f => f.source === 'loc');
            const reaches = booths.some(f =>
                siteCollision.reached(tile, { ...f.tile, ...size(f), shape: f.shape ?? 10, rotation: f.rotation ?? 0 }),
            );
            expect({
                bank: b.name,
                walkable: siteCollision.walkable(0, tile.x, tile.z),
                reaches,
                near: near(site) <= 4,
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
