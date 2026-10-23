// Fishing spots over the committed world.json and the real game data: where a shore's spots can move to, the area
// that covers them, the Catherby shore's region, and the shark catch beside tuna and swordfish.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { loadWorld } from '../load';
import { METHODS } from '../methods';
import { readGameData } from '../model/families/index';
import { legFinder } from '../model/legs';
import { methodModel, methodRate, resolveMethods, type MethodContext } from '../model/method';
import { profileOf, type Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { questFacts } from '../requirements';
import { readConfigs } from '../sources/configs';
import { COVER_MARGIN } from '../sources/fishing-movement';

const world = loadWorld();
const data = readGameData();
const ctx: MethodContext = { world, ...methodModel(data), quests: questFacts(world.quests) };
const graph = reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
const { methods } = resolveMethods(METHODS, ctx, legFinder(graph, world.crossings));
const spots = world.sites.filter(s => s.kind === 'fishing-spot');
const site = (id: string) => spots.find(s => s.id === id)!;

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
                expect(Math.max(Math.abs(t.x - m.centre.x), Math.abs(t.z - m.centre.z))).toBeLessThanOrEqual(
                    m.radius - COVER_MARGIN,
                );
        }
        expect(catherby.movement!.rarefish!.centre).toEqual({ level: 0, x: 2848, z: 3427 });
        expect(catherby.movement!.rarefish!.radius).toBe(15);
    });
});

test('every fishing site covers its spawns, and a spot that never moves covers only itself', () => {
    for (const s of spots) {
        expect(Object.keys(s.movement!).sort()).toEqual(Object.keys(s.counts).sort());
        for (const f of s.features.map(i => world.features[i]!)) {
            const m = s.movement![f.subtype]!;
            expect(m.tiles.some(t => t.x === f.tile.x && t.z === f.tile.z && t.level === f.tile.level)).toBe(true);
            expect(Math.max(Math.abs(f.tile.x - m.centre.x), Math.abs(f.tile.z - m.centre.z))).toBeLessThanOrEqual(
                m.radius - COVER_MARGIN,
            );
        }
    }
    const brimhaven = site('fishing-spot:brimhaven:0').movement!['category_633']!;
    expect(brimhaven.tiles).toHaveLength(1);
    expect(brimhaven.radius).toBe(COVER_MARGIN);
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
