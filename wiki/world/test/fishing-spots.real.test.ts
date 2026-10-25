// Fishing spots over the committed world.json and the real game data: where a shore's spots can move to, the area
// that covers them, the Catherby shore's region and stand, check 5's findings, the shark catch beside tuna and
// swordfish, and what each page says every option catches.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { reachCollision } from '../collision';
import { loadWorld } from '../load';
import { METHODS } from '../methods';
import { readGameData } from '../model/families/index';
import { legFinder } from '../model/legs';
import { ROOT } from '../paths';
import { methodModel, methodRate, resolveMethods, type MethodContext } from '../model/method';
import { profileOf, type Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { besideSpot, locSizes } from '../place';
import { reachGraph } from '../reach';
import { questFacts } from '../requirements';
import { readConfigs } from '../sources/configs';
import { COVER_MARGIN } from '../cover';
import { movingFeatures } from '../checks';
import { siteAt } from '../site-key';
import { movementEnum } from '../sources/fishing-movement';

const world = loadWorld();
const data = readGameData();
const ctx: MethodContext = { world, ...methodModel(data), quests: questFacts(world.quests) };
const graph = reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
const { methods } = resolveMethods(METHODS, ctx, legFinder(graph, world.crossings));
const spots = world.sites.filter(s => s.kind === 'fishing-spot');
const site = (id: string) => spots.find(s => s.id === id)!;
/** The tiles a site's spots are used from, on any tile they move to (place.ts besideSpot, as checks.ts useTiles has them). */
const walled = reachCollision.walled ?? (<T>(f: () => T): T => f());
const besideOwnSpots = (s: (typeof spots)[number]) =>
    walled(() => Object.values(s.movement!).flatMap(m => m.tiles.flatMap(t => besideSpot(t, reachCollision))));

describe('Catherby shore', () => {
    const catherby = site('fishing-spot:catherby:0');
    test('is one Kandarin site, not one per spawn or one filed under Asgarnia', () => {
        expect(catherby.areaPath).toEqual(['kandarin', 'catherby']);
        expect(catherby.counts).toEqual({ memberfish: 3, rarefish: 2, saltfish: 2 });
        expect(spots.filter(s => s.areaPath.includes('asgarnia') && s.centre.x < 2870 && s.centre.z > 3400)).toEqual(
            [],
        );
    });
    test('rarefish and memberfish spots can stand on every tile the conductor3 run saw', () => {
        for (const subtype of ['rarefish', 'memberfish']) {
            const tiles = catherby.movement![subtype]!.tiles.map(t => `${t.x},${t.z}`);
            for (const seen of [
                '2836,3431',
                '2844,3429',
                '2846,3429',
                '2853,3423',
                '2855,3423',
                '2859,3426',
                '2860,3426',
            ])
                expect(tiles).toContain(seen);
        }
    });
    test('the covering area holds every tile with the margin', () => {
        for (const subtype of ['rarefish', 'memberfish', 'saltfish']) {
            const m = catherby.movement![subtype]!;
            for (const t of m.tiles)
                expect(Math.hypot(t.x - m.centre.x, t.z - m.centre.z)).toBeLessThanOrEqual(m.radius - COVER_MARGIN);
        }
        expect(catherby.movement!.rarefish!.centre).toEqual({ level: 0, x: 2848, z: 3427 });
        expect(catherby.movement!.rarefish!.radius).toBe(16);
    });
    test('stands on the shore, beside a tile its spots move to, needing nothing, with Catherby bank nearest', () => {
        expect(besideOwnSpots(catherby)).toContainEqual(catherby.stand!);
        expect(catherby.reach).toContainEqual([]);
        expect(catherby.nearest!.bank!.site).toBe('bank:catherby-bank:0');
    });
});

describe('check 5, moving feature outside its site', () => {
    const npcs = readConfigs('npc');
    const found = movingFeatures(world, c => movementEnum(npcs.get(c)));
    test("no enum feeds two sites: the audit's A2 enums are each one site now", () => {
        expect(found.filter(f => f.ids.length > 1)).toEqual([]);
        // The audit had fishing_movement_0_34_50_enum over 3 Tirannwn sites; place.ts joinShores made them one.
        const fed = spots.filter(s =>
            s.features.some(i => movementEnum(npcs.get(world.features[i]!.config)) === 'fishing_movement_0_34_50_enum'),
        );
        expect(fed.map(s => s.id)).toEqual(['fishing-spot:tirannwn:1']);
    });
    test("Shilo Village's pool is the one moving out of its area, past the rect's west edge", () => {
        expect(found).toEqual([
            {
                ids: ['fishing-spot:shilo-village:0'],
                keys: [siteAt('fishing-spot', 2855, 2973)],
                detail: 'fishing-spot:shilo-village:0: 1 spot tiles outside shilo-village ((2822, 2969))',
            },
        ]);
    });
});

test('every fishing site covers its spawns, and a spot that never moves covers only itself', () => {
    for (const s of spots) {
        expect(Object.keys(s.movement!).sort()).toEqual(Object.keys(s.counts).sort());
        for (const f of s.features.map(i => world.features[i]!)) {
            const m = s.movement![f.subtype]!;
            expect(m.tiles.some(t => t.x === f.tile.x && t.z === f.tile.z && t.level === f.tile.level)).toBe(true);
            expect(Math.hypot(f.tile.x - m.centre.x, f.tile.z - m.centre.z)).toBeLessThanOrEqual(
                m.radius - COVER_MARGIN,
            );
        }
    }
    const brimhaven = site('fishing-spot:brimhaven:0').movement!['category_633']!;
    expect(brimhaven.tiles).toHaveLength(1);
    expect(brimhaven.radius).toBe(COVER_MARGIN);
});

test('every npc fishing stand is a tile its spots are used from: one sharing an edge with a tile they move to', () => {
    // A loc spot (the lava eels' loc_2630) is used from its reachTiles, as checks.ts useTiles has it.
    const npcSpots = spots.filter(s => s.stand && s.features.every(i => world.features[i]!.source === 'npc'));
    expect(npcSpots.length).toBeGreaterThan(35);
    const off = npcSpots.filter(
        s => !besideOwnSpots(s).some(t => t.x === s.stand!.x && t.z === s.stand!.z && t.level === s.stand!.level),
    );
    expect(off.map(s => s.id)).toEqual([]);
});

test('spots sharing a movement enum are one site per shore', () => {
    const alKharid = spots.filter(s => s.areaPath.includes('al-kharid-river'));
    expect(alKharid).toHaveLength(1);
    expect(spots.filter(s => s.areaPath.at(-1) === 'entrana')).toHaveLength(2);
});

const everyAt = (fishing: number): Profile =>
    profileOf(
        { ...(Object.fromEntries(SKILLS.map(s => [s, 99])) as Record<Skill, number>), fishing },
        { tools: ctx.tools },
    );
const fishXp = (id: string, level: number): number =>
    methodRate(
        methods.find(m => m.def.id === id)!,
        everyAt(level),
        ctx,
        undefined,
        'fishing',
    ).xpPerHour.fishing!;
describe('sharks', () => {
    test('the shark method needs Fishing 76 and Cooking 80', () => {
        const m = methods.find(x => x.def.id === 'shark-catherby-cook-bank')!;
        expect(m.site.id).toBe('fishing-spot:catherby:0');
        expect(m.levels.fishing).toBe(76);
        expect(m.levels.cooking).toBe(80);
    });
    test('the swordfish record still resolves at the Catherby rarefish spots', () => {
        expect(methods.find(x => x.def.id === 'swordfish-catherby-cook-bank')!.site.id).toBe('fishing-spot:catherby:0');
    });
    test('sharks trail swordfish and tuna at 84 and 99: 3/256 low and 40/256 high, 110 xp, against the rarefish rolls', () => {
        // The shark's struct (success_low 3, success_high 40) is a low chance at any level the bot reaches.
        for (const level of [84, 99])
            expect(fishXp('shark-catherby-cook-bank', level)).toBeLessThan(
                fishXp('swordfish-catherby-cook-bank', level),
            );
        expect(fishXp('shark-catherby-cook-bank', 84)).toBeGreaterThan(450_000);
        expect(fishXp('shark-catherby-cook-bank', 99)).toBeGreaterThan(fishXp('shark-catherby-cook-bank', 84));
    });
});

/** A page's table rows under `header`, as cells. */
const rows = (page: string, header: string): string[][] => {
    const lines = page.split('\n');
    const at = lines.indexOf(header);
    if (at < 0) return [];
    const out: string[][] = [];
    for (const line of lines.slice(at + 2)) {
        if (!line.startsWith('|')) break;
        out.push(line.slice(2, -2).split(' | '));
    }
    return out;
};

describe('fishing pages', () => {
    const dir = join(ROOT, 'wiki/resources/fishing-spot');
    const pages = new Map(readdirSync(dir).map(f => [f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')]));
    const YIELDS = '| Option | Level | Tool | Bait | Catch | Base XP | Low | High | Source |';
    const UNREAD = "can't read this catch: ";

    test('every option of every spot config has a catch row, or one saying the catch is not read', () => {
        expect(pages.size).toBeGreaterThan(0);
        for (const [subtype, page] of pages) {
            const options = new Set(rows(page, '| Config | Name | Options |').flatMap(r => r[2]!.split(', ')));
            options.delete('-');
            const caught = rows(page, YIELDS);
            expect([subtype, [...new Set(caught.map(r => r[0]))].sort()]).toEqual([subtype, [...options].sort()]);
            for (const r of caught) {
                expect(r[4]!.startsWith(UNREAD) || r[1] !== '-').toBe(true);
                expect(r[8]).toMatch(/^skill_fishing\/scripts\/fishing_spots\/[a-z_]+\.rs2:\d+$/);
            }
        }
    });

    test('shark, lobster, tuna and swordfish read as their scripts and fishing.struct have them', () => {
        // memberfish.rs2:14 and rarefish.rs2:23, :128, :175 gate them; fishing.struct holds the XP tenths and roll.
        const catches = (subtype: string) => rows(pages.get(subtype)!, YIELDS).map(r => r.slice(0, 8).join(' | '));
        expect(catches('memberfish')).toContain('Harpoon | 76 | Harpoon | - | Raw shark | 110 | 3 | 40');
        expect(catches('rarefish')).toEqual([
            'Cage | 40 | Lobster pot | - | Raw lobster | 90 | 6 | 95',
            'Harpoon | 35 | Harpoon | - | Raw tuna | 80 | 8 | 64',
            'Harpoon | 50 | Harpoon | - | Raw swordfish | 100 | 4 | 48',
        ]);
        expect(pages.get('rarefish')).toContain('~fish_roll rolls the higher-level one first');
        // Big net, karambwanji, karambwan and lava eel each say what readSpots doesn't read: big net's own roll
        // (memberfish.rs2:113), the inline stat_random rolls (tbwt.rs2:52, :124), the oily rod's own check
        // (lavafish.rs2:47, lavafish_loc.rs2:38).
        const unread = (subtype: string) =>
            rows(pages.get(subtype)!, YIELDS).flatMap(r =>
                r[4]!.startsWith(UNREAD) ? [r[4]!.slice(UNREAD.length)] : [],
            );
        expect(
            Object.fromEntries(
                ['memberfish', 'category_632', 'category_633', '0_45_152_lavafish', 'loc_2630'].map(s => [
                    s,
                    unread(s),
                ]),
            ),
        ).toEqual({
            memberfish: ['it rolls with ~fish_roll_big_net, not ~fish_roll'],
            category_632: ['it rolls inline with stat_random(fishing, ...), not ~fish_roll'],
            category_633: ['it rolls inline with stat_random(fishing, ...), not ~fish_roll'],
            '0_45_152_lavafish': ['no ~check_fish_equipment call names its tool'],
            loc_2630: ['no ~check_fish_equipment call names its tool'],
        });
    });
});
