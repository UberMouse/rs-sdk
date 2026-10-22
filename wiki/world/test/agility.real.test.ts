// The agility family over the committed world.json and the real scripts: the three courses' laps worked by hand from
// their scripts (skill_agility/scripts/{gnome,barbarian,wilderness}_course.rs2), the walks between obstacles as the
// reach graph prices them, and the per-stand ticks the laps read.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { wayFinder } from '../distance';
import { loadWorld } from '../load';
import { agility, lapOf } from '../model/families/agility';
import { readGameData } from '../model/families/index';
import type { Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { readConfigs } from '../sources/configs';
import type { Site, Tile } from '../types';
import { tileKey } from '../util';

const world = loadWorld();
const finder = wayFinder(reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) }));
const family = agility(readGameData());

const course = (name: string): Site => {
    const s = world.sites.find(x => x.id === `agility-course:${name}-agility-course:0`);
    if (!s) throw new Error(`no ${name} course`);
    return s;
};
const t = (x: number, z: number, level = 0): Tile => ({ level, x, z });
/** Run ticks from `a` to `b` under the course's own reach set. */
const run = (s: Site, a: Tile, b: Tile): number | undefined => finder.runTicksBetween(a, b, s.reach[0]!)?.runTicks;
/** Every skill, Hitpoints among them, at `level`. */
const profile = (level: number): Profile => ({
    levels: Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>,
    axe: null,
    pickaxe: null,
    glory: false,
    worn: [],
});
// Each course's walks, priced when the file loads, where no timeout applies (as world.real.test.ts builds there): a
// pair no walk joins searches all the graph reaches.
const priced = new Map(
    world.sites
        .filter(s => s.kind === 'agility-course')
        .map(s => [s.id, family.walks!(s, undefined, world).map(p => run(s, p.from, p.to) ?? null)]),
);
const lap = (s: Site, level: number) => family.model(s, undefined, profile(level), world, priced.get(s.id));

describe('the ticks the laps read', () => {
    test('the Wilderness pipe: 11 from the tile south of it, 12 from beside it', () => {
        // wilderness_course.rs2:57-74 from (3004, 3937), movecoord(loc_coord, 0, 0, -1): p_delay(0) 1, the exactmove's
        // p_delay(3) 4, p_delay(0) 1, the telejump, p_delay(0) 1, the second exactmove 4 = 11. From (3003, 3938) or
        // (3005, 3938) the p_delay(0) before p_walk to that tile (:58-59) adds 1: 12.
        const pipe = world.gates.find(g => g.loc === 'obstical_pipe2' && g.to);
        expect(pipe?.ticks).toBe(12);
        expect(pipe?.standTicks).toEqual([
            { stand: t(3003, 3938), ticks: 12 },
            { stand: t(3004, 3937), ticks: 11 },
            { stand: t(3005, 3938), ticks: 12 },
        ]);
    });

    test('the Gnome pipes: 15 from beside the south piece, 13 from the tile under the north one', () => {
        // gnome_course.rs2:58-96. ~forcewalk2 to movecoord(loc_coord, 0, 0, -1): p_delay(0) 1, then
        // ~clipped_telewalk (agility.rs2:47-91) from beside the pipe at (2485, 3431) to (2484, 3430): its x step is the
        // pipe's own tile, blocked, so it steps z then x, p_delay(0) each, 2. Then the exactmove's p_delay(3) 4,
        // p_delay(2) 3, p_delay(0) 1, the second exactmove 4: 15. From (2484, 3434), already under the north piece,
        // no step: 13.
        const rows = world.crossings.filter(
            c =>
                c.act.kind === 'loc-op' &&
                c.act.loc === 'loc_154' &&
                c.from.some(f => tileKey(f) === tileKey(t(2485, 3431))),
        );
        expect(rows.map(c => c.ticks)).toEqual([15]);
        const under = world.crossings.filter(
            c =>
                c.act.kind === 'loc-op' &&
                c.act.loc === 'loc_154' &&
                c.from.some(f => tileKey(f) === tileKey(t(2484, 3434))),
        );
        expect(under.map(c => c.ticks)).toEqual([13]);
    });

    test('the placements crossed before a step are the two Barbarian walls, and only them', () => {
        // barbarian_course.rs2:120-123: every castlecrumbly1 gives 125, only (2542, 3553) moves the lap on.
        const before = ['gnome', 'barbarian', 'wilderness'].flatMap(name =>
            lapOf(course(name), world).flatMap(s =>
                s.before.map(ms => `${name} ${s.step} ${ms[0]!.loc} ${tileKey(ms[0]!.landing)}`),
            ),
        );
        expect(before).toEqual(['barbarian 5 castlecrumbly1 0 2537 3553', 'barbarian 5 castlecrumbly1 0 2540 3553']);
    });
});

describe('the laps, worked by hand', () => {
    test('Gnome at Agility 1: no rolls, 61 ticks, 865 xp tenths', () => {
        const gnome = course('gnome');
        // Each obstacle's ticks + 1 click: log 8 + 1 (from (2474, 3436), the side the pipe lands on), net 2 + 1,
        // branch 2 + 1, rope 7 + 1, tree 2 + 1, net 2 + 1, pipe 15 + 1 (from (2485, 3431)) = 45.
        // The walks: log -> net 2, net -> branch 1, branch -> rope 2, rope -> tree 1, tree -> net 3, net -> pipe 2,
        // pipe -> log 5 = 16.
        expect(run(gnome, t(2474, 3429), t(2474, 3426))).toBe(2);
        expect(run(gnome, t(2473, 3424, 1), t(2473, 3423, 1))).toBe(1);
        expect(run(gnome, t(2473, 3420, 2), t(2477, 3420, 2))).toBe(2);
        expect(run(gnome, t(2483, 3420, 2), t(2485, 3419, 2))).toBe(1);
        expect(run(gnome, t(2487, 3420), t(2487, 3425))).toBe(3);
        expect(run(gnome, t(2487, 3427), t(2485, 3431))).toBe(2);
        expect(run(gnome, t(2484, 3437), t(2474, 3436))).toBe(5);
        const m = lap(gnome, 1);
        expect(m.ticksPerAttempt).toBe(61);
        // 75 + 75 + 50 + 75 + 50 + 75 + 75 (gnome_course.rs2:6, 18, 25, 34, 43, 55, 95) + the bonus 390 (:108).
        expect(m.xpTenths).toEqual({ agility: 865 });
        expect(m).not.toHaveProperty('damage');
    });

    // Wilderness, with no fall: pipe 11 + 1, rope swing 2 + 1, stones 12 + 1, log 9 + 1, rocks 5 + 1 = 44; walks
    // pipe -> rope 2, rope -> stones 2, stones -> log 7 (to (3001, 3946)), log -> rocks 4 (to (2995, 3937)), rocks
    // -> pipe 5 = 20. A fall costs its ticks, the walk back and a click: the rope swing 1 + 10 (out of the pit at
    // (3004, 10357)) + 1 = 12, the stones 10 + 2 + 1 = 13, the log 8 + 27 (out of the spike pit) + 1 = 36.
    const wilderness = course('wilderness');
    test('the Wilderness walks', () => {
        expect(run(wilderness, t(3004, 3950), t(3005, 3953))).toBe(2);
        expect(run(wilderness, t(3005, 3958), t(3002, 3960))).toBe(2);
        expect(run(wilderness, t(2996, 3960), t(3001, 3946))).toBe(7);
        expect(run(wilderness, t(2994, 3945), t(2995, 3937))).toBe(4);
        expect(run(wilderness, t(2995, 3933), t(3004, 3937))).toBe(5);
        expect(run(wilderness, t(3004, 10357), t(3005, 3953))).toBe(10);
        expect(run(wilderness, t(3002, 3963), t(3002, 3960))).toBe(2);
        expect(run(wilderness, t(2998, 10345), t(3001, 3946))).toBe(27);
    });

    test('Wilderness at Agility 99: 5/251 falls on each rolled obstacle', () => {
        // stat_random(200, 250) and (180, 250) at 99: floor(250 x 98/98) + 1 = 251, p = 251/256, 5/251 falls.
        // 64 + 5/251 x (12 + 13 + 36) = 64 + 305/251.
        const m = lap(wilderness, 99);
        expect(m.ticksPerAttempt).toBeCloseTo(64 + 305 / 251, 12);
        // 125 + 200 + 200 + 200 + 0 (wilderness_course.rs2:76, 102, 125, 148; the rocks none) + the bonus 4989 (:176).
        expect(m.xpTenths).toEqual({ agility: 5714 });
        // At 99 HP: the rope swing and log floor(99 x 15/100) + 1 = 15, the stones floor(99 x 216/1000) + 1 = 22.
        expect(m.damage).toBeCloseTo((5 / 251) * (15 + 22 + 15), 12);
    });

    test('Wilderness at Agility 52', () => {
        // (200, 250): floor(200 x 47/98) + floor(250 x 51/98) + 1 = 95 + 130 + 1 = 226, 30/226 falls; (180, 250):
        // 86 + 130 + 1 = 217, 39/217. 64 + 30/226 x (12 + 36) + 39/217 x 13.
        const m = lap(wilderness, 52);
        expect(m.ticksPerAttempt).toBeCloseTo(64 + (30 / 226) * 48 + (39 / 217) * 13, 12);
        // At 52 HP: 15/100 -> 8, 216/1000 -> 12.
        expect(m.damage).toBeCloseTo((30 / 226) * (8 + 8) + (39 / 217) * 12, 12);
    });

    test('Barbarian at Agility 35, the pipe in: the walls on the way, 28/228 falls', () => {
        const barbarian = course('barbarian');
        // Rope swing 2 + 1 from (2551, 3554), log 11 + 1, net 1 + 1, ledge 6 + 1 from (2536, 3547, 1), the three walls
        // 4 + 1 each from the west = 39. Walks: rope -> log 1, log -> net 1, net -> ledge 1, ledge -> the first wall 6
        // (down the ladder), wall -> wall 1 and 1, the last wall -> rope swing 4 = 15.
        expect(run(barbarian, t(2551, 3549), t(2550, 3547))).toBe(1);
        expect(run(barbarian, t(2541, 3546), t(2539, 3546))).toBe(1);
        expect(run(barbarian, t(2537, 3546, 1), t(2536, 3547, 1))).toBe(1);
        expect(run(barbarian, t(2532, 3546, 1), t(2535, 3553))).toBe(6);
        expect(run(barbarian, t(2537, 3553), t(2538, 3553))).toBe(1);
        expect(run(barbarian, t(2540, 3553), t(2541, 3553))).toBe(1);
        expect(run(barbarian, t(2543, 3553), t(2551, 3554))).toBe(4);
        // stat_random(200, 280) at 35: floor(200 x 64/98) + floor(280 x 34/98) + 1 = 130 + 97 + 1 = 228, 28/228
        // falls. The rope swing's: 1 + 6 (out of the pit) + 1 = 8; the ledge's: 6 + 6 (back up the net) + 1 = 13.
        expect(run(barbarian, t(2534, 3545), t(2536, 3547, 1))).toBe(6);
        const m = lap(barbarian, 35);
        expect(m.ticksPerAttempt).toBeCloseTo(54 + (28 / 228) * (8 + 13), 12);
        // 200 + 125 + 75 + 200 + 3 x 125 (barbarian_course.rs2:30, 65, 73, 104, 120) + the bonus 420 (:154).
        expect(m.xpTenths).toEqual({ agility: 1395 });
        // At 35 HP: floor(35 x 15/100) + 1 = 6 a fall.
        expect(m.damage).toBeCloseTo((28 / 228) * 12, 12);
    });
});
