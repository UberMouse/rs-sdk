// The rune essence mine in the committed world.json (sources/npc-teleports.ts, gates.ts NPC_TELEPORTS): each wizard
// teleports into the mine under Rune Mysteries, priced at every landing but the stranded nooks, each portal goes back
// to every wizard under its came-from and what got the way in to him, the mine's sites are reached with the quest
// and take their products to a bank by a portal and Aubury's exit, and no reach set or nearest way elsewhere asks a
// came-from.
import { describe, expect, test } from 'bun:test';
import { TRANSPORTS_OUT_OF_SCOPE } from '../gates';
import { loadWorld } from '../load';
import { CAME_FROM } from '../requirements';
import { readConstants } from '../sources/constants';
import { coordTile } from '../sources/runescript';
import type { Tile } from '../types';

const world = loadWorld();
const rows = world.crossings.filter(c => c.source.startsWith('skill_runecraft/scripts/essence_mine.rs2:'));
const MINE = world.areas.find(a => a.id === 'rune-essence-mine')!.rects[0]!;
const inMine = (t: Tile) => t.level === 0 && t.x >= MINE.x1 && t.x <= MINE.x2 && t.z >= MINE.z1 && t.z <= MINE.z2;
const constants = readConstants();
/** Each wizard, by npc config, with its op and the coord its op passes the label. */
const WIZARDS: [npc: string, op: number, back: string][] = [
    ['ardounge_wizard', 3, '^essence_mine_to_cromperty'],
    ['aubury', 4, '^essence_mine_to_aubury'],
    ['gnome_brimstail', 3, '^essence_mine_to_brimstail'],
    ['guild_wizard', 3, '^essence_mine_to_disentor'],
    ['head_wizard', 3, '^essence_mine_to_sedridor'],
];
const sites = world.sites.filter(s => s.areaPath.includes('rune-essence-mine'));

describe('the essence mine teleports', () => {
    const teleports = rows.filter(c => c.act.kind === 'npc-op');

    test('one per wizard, by the op its trigger has, under Rune Mysteries, from beside where the wizard wanders', () => {
        expect(teleports.map(c => c.act)).toEqual(WIZARDS.map(([npc, op]) => ({ kind: 'npc-op', npc, op })));
        for (const c of teleports) {
            expect(c.via).toBe('teleport');
            expect(c.requires).toEqual([['quest:runemysteries']]);
            expect(c.source).toBe('skill_runecraft/scripts/essence_mine.rs2:25');
            const { npc } = c.act as { npc: string };
            const spawn = world.npcSpawns.find(n => n.config === npc && n.centre.x === c.at.x && n.centre.z === c.at.z);
            const { x1, z1, x2, z2 } = spawn!.roam;
            expect(c.from.every(t => t.x >= x1 - 1 && t.x <= x2 + 1 && t.z >= z1 - 1 && t.z <= z2 + 1)).toBe(true);
            // Wandering widens where it is used from, and still takes the ring beside where it spawns.
            const b = spawn!.bbox;
            const ring = (t: Tile) => Math.max(b.x1 - t.x, t.x - b.x2, b.z1 - t.z, t.z - b.z2) === 1;
            expect(c.from.some(ring)).toBe(true);
        }
    });

    test('each lands in the mine, on every essence_mine_teleports coord that is open', () => {
        const [first] = teleports;
        for (const c of teleports) expect(c.landings).toEqual(first!.landings);
        expect(first!.landings.every(l => inMine(l.tile))).toBe(true);
        expect(first!.landings.map(l => l.tile)).toContainEqual(coordTile('0_45_75_32_33'));
    });

    test('every landing is priced but the five stranded nooks no walk leaves', () => {
        const NOOKS = ['2895,4838', '2911,4839', '2920,4857', '2921,4857', '2922,4857'];
        for (const c of teleports) {
            const unpriced = c.landings.filter(l => l.spread === undefined).map(l => `${l.tile.x},${l.tile.z}`);
            expect([c.act, unpriced]).toEqual([c.act, NOOKS]);
        }
    });

    test("each takes its label's p_delay(4), 5 ticks (essence_mine.rs2:20)", () => {
        for (const c of teleports) expect([c.act, c.ticks]).toEqual([c.act, 5]);
    });

    test('a landing is as likely as the coords whose open radius-1 squares hold it: 1 / 22 shared among each', () => {
        // ServerOps.ts map_findsquare: a uniform tile of the coord's open radius-1 square. The squares are disjoint, so
        // each landing's chance is 1 / (22 x the open tiles of its square), from 1/22 x 1/9 up, and they sum to 1.
        const [first] = teleports;
        const sizes = first!.landings.map(l => 1 / (22 * l.chance!));
        for (const n of sizes) expect(Math.abs(n - Math.round(n)) < 1e-9 && n >= 1 && n <= 9).toBe(true);
        expect(first!.landings.reduce((t, l) => t + l.chance!, 0)).toBeCloseTo(1, 12);
    });

    test('they are no longer out of scope', () =>
        expect(TRANSPORTS_OUT_OF_SCOPE.filter(o => o.script.includes('essence_mine'))).toEqual([]));
});

describe('the mine’s portals back', () => {
    const back = rows.filter(c => c.act.kind === 'loc-op');

    test('each of the four portals goes back to every wizard, under its came-from and the quest', () => {
        expect(new Set(back.map(c => `${c.at.x},${c.at.z}`)).size).toBe(4);
        expect(back).toHaveLength(4 * WIZARDS.length);
        for (const c of back) {
            expect(c.act).toEqual({ kind: 'loc-op', loc: 'blankrunestone_exit_portal', op: 1 });
            expect(c.requires).toHaveLength(1);
            expect(c.requires[0]).toContain('quest:runemysteries');
            expect(c.requires[0]!.filter(r => r.startsWith(CAME_FROM))).toHaveLength(1);
        }
    });

    test("each takes its label's p_delay(1), 2 ticks, and lands on every tile alike", () => {
        for (const c of back) {
            expect(c.ticks).toBe(2);
            expect(c.landings.every(l => l.chance === undefined)).toBe(true);
        }
    });

    test("each lands within 2 of the wizard's coord: Distentor's in the Magic Guild asks 66 Magic too", () => {
        for (const [npc, , name] of WIZARDS) {
            const exit = coordTile(constants.get(name)!.value);
            const to = back.filter(c => c.requires[0]!.includes(`${CAME_FROM}${npc}`));
            expect([npc, to.length]).toEqual([npc, 4]);
            for (const c of to)
                for (const l of c.landings)
                    expect([npc, Math.max(Math.abs(l.tile.x - exit.x), Math.abs(l.tile.z - exit.z)) <= 2]).toEqual([
                        npc,
                        true,
                    ]);
        }
        const guild = back.filter(c => c.requires[0]!.includes(`${CAME_FROM}guild_wizard`));
        for (const c of guild)
            expect(c.requires).toEqual([['other:came from guild_wizard', 'quest:runemysteries', 'skill:magic:66']]);
    });
});

describe('the mine’s sites', () => {
    test('every one is reached with Rune Mysteries, so the mine leaves the unreached report', () => {
        expect(sites.map(s => s.id).filter(id => id.startsWith('rock:'))).toHaveLength(4);
        for (const s of sites) expect([s.id, s.reach]).toEqual([s.id, [['quest:runemysteries']]]);
    });

    test("the rocks' nearest bank is Varrock East, by a portal and Aubury's exit", () => {
        for (const s of sites.filter(x => x.kind === 'rock'))
            expect([s.id, s.nearest?.bank]).toEqual([
                s.id,
                {
                    site: 'bank:varrock-east-bank:0',
                    runTicks: expect.any(Number),
                    requires: ['other:came from aubury', 'quest:runemysteries'],
                },
            ]);
    });

    test('no nearest way of a site outside the mine takes a portal: it could go in by one wizard, out by another', () => {
        // Only sites have a nearest (distance.ts SINKS); an npc spawn has none to check.
        const outside = world.sites.filter(s => !s.areaPath.includes('rune-essence-mine'));
        const ways = outside.flatMap(s => Object.values(s.nearest ?? {}).map(n => [s.id, n.requires] as const));
        expect(ways.length).toBeGreaterThan(1000);
        expect(ways.filter(([, requires]) => requires.some(r => r.startsWith(CAME_FROM)))).toEqual([]);
    });

    test('no reach set of a site or npc spawn asks a came-from: a fill takes a portal back only where it walks', () => {
        for (const r of [...world.sites, ...world.npcSpawns].flatMap(s => s.reach.flat()))
            expect(r.startsWith(CAME_FROM)).toBe(false);
    });
});
