// The rune essence mine in the committed world.json (sources/npc-teleports.ts, gates.ts NPC_TELEPORTS): each wizard
// teleports into the mine under Rune Mysteries, each portal goes back to every wizard under its came-from and what
// got the way in to him, the mine's sites are reached with the quest and take their products to a bank by a portal
// and Aubury's exit, and no reach set elsewhere asks a came-from.
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

    test("one per wizard, by the op its trigger has, under Rune Mysteries, from beside the wizard's spawn", () => {
        expect(teleports.map(c => c.act)).toEqual(WIZARDS.map(([npc, op]) => ({ kind: 'npc-op', npc, op })));
        for (const c of teleports) {
            expect(c.via).toBe('teleport');
            expect(c.requires).toEqual([['quest:runemysteries']]);
            expect(c.source).toBe('skill_runecraft/scripts/essence_mine.rs2:25');
            expect(c.from.every(t => Math.max(Math.abs(t.x - c.at.x), Math.abs(t.z - c.at.z)) <= 1)).toBe(true);
        }
    });

    test('each lands in the mine, on every essence_mine_teleports coord that is open', () => {
        const [first] = teleports;
        for (const c of teleports) expect(c.landings).toEqual(first!.landings);
        expect(first!.landings.every(l => inMine(l.tile))).toBe(true);
        expect(first!.landings.map(l => l.tile)).toContainEqual(coordTile('0_45_75_32_33'));
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

    test('no reach set of a site or npc spawn asks a came-from: a fill takes a portal back only where it walks', () => {
        for (const r of [...world.sites, ...world.npcSpawns].flatMap(s => s.reach.flat()))
            expect(r.startsWith(CAME_FROM)).toBe(false);
    });
});
