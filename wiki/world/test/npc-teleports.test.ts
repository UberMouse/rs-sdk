// The npc teleports to an enum's coords (sources/npc-teleports.ts) on a scripted world: the npc op triggers that jump
// to the label give a row per spawn cluster, landing on the enum's rings; the back trigger gives a row per placed loc
// and npc, under the npc's came-from requirement; the ways back ask what got the way in (joinWaysIn); a site's context
// takes the came-from requirements (cameFromContext), so its way out by a portal finds a bank; and the entries the
// data refutes.
import { describe, expect, test } from 'bun:test';
import { nearestSinks } from '../distance';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { parseConfigs } from '../sources/configs';
import type { Constant } from '../sources/constants';
import { cameFromContext, deriveNpcTeleports, joinWaysIn, type NpcTeleport } from '../sources/npc-teleports';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Crossing, Tile } from '../types';
import { at, Grid } from './grid';

const FILE = 'skill_test/scripts/test_mine.rs2';
const SCRIPT = `[label,test_teleport](coord $back)
if (%testquest < ^testquest_complete) {
    mes("Not yet.");
    return;
}
%test_back = $back;
p_delay(4);
def_coord $coord = enum(int, coord, test_spots, random(enum_getoutputcount(test_spots)));
$coord = map_findsquare($coord, 0, 1, ^map_findsquare_lineofsight);
p_telejump($coord);

[opnpc1,wizard_a]
if (%testquest = ^testquest_complete) @test_teleport(^to_a);

[opnpc3,wizard_a]
@test_teleport(^to_a);

[opnpc4,wizard_b]
// the shop wizard teleports on op 4
@test_teleport(^to_b);

[opnpc3,wizard_c]
@test_teleport(^to_a);

[oploc1,test_portal]
p_delay(1);
def_coord $coord = map_findsquare(%test_back, 0, 2, ^map_findsquare_lineofwalk);
p_telejump($coord);
`;
/** `FILE:<line>` of the first line holding `needle`. */
const lineOf = (needle: string): string => `${FILE}:${SCRIPT.split('\n').findIndex(l => l.includes(needle)) + 1}`;

const ENTRY: NpcTeleport = {
    label: 'test_teleport',
    via: 'teleport',
    enum: 'test_spots',
    requires: ['quest:testquest'],
    checkedAt: lineOf('%testquest < ^testquest_complete'),
    ring: lineOf('map_findsquare($coord'),
    source: lineOf('p_telejump($coord);'),
    back: {
        trigger: 'oploc1,test_portal',
        via: 'teleport',
        varp: 'test_back',
        ring: lineOf('map_findsquare(%test_back'),
        source: `${FILE}:${SCRIPT.split('\n').findLastIndex(l => l.includes('p_telejump')) + 1}`,
    },
};

// The x 3232-3239 column is walkable but not land (test/grid.ts): the second spot's ring reaches into it.
const ENUMS = `[test_spots]
inputtype=int
outputtype=coord
val=0,0_50_50_20_20
val=1,0_50_50_31_10
`;
const NPCS = `[wizard_a]
op1=Talk-to
op3=Teleport

[wizard_b]
op4=Teleport

[wizard_c]
op1=Talk-to
`;
const LOCS = `[test_portal]
op1=Use
`;
const constant = (value: string): Constant => ({ value, at: 'test.constant:1' });
const CONSTANTS = new Map([
    ['^to_a', constant('0_50_50_5_5')],
    ['^to_b', constant('0_50_50_10_5')],
    ['^map_findsquare_lineofwalk', constant('0')],
    ['^map_findsquare_lineofsight', constant('1')],
]);
const cluster = (config: string, t: Tile) => {
    const box = { x1: t.x, z1: t.z, x2: t.x, z2: t.z };
    return { config, centre: t, bbox: box, roam: box };
};
const SPAWNS = [
    cluster('wizard_a', at(0, 3205, 3225)),
    cluster('wizard_b', at(0, 3210, 3228)),
    // Off land, and nothing round it on land: no tile it is used from.
    cluster('wizard_b', at(0, 3236, 3225)),
    cluster('wizard_c', at(0, 3225, 3228)),
];
const PORTAL = at(0, 3215, 3215);
const locConfigs = parseConfigs(LOCS);
// A wall down the west edge of column 3207 cuts wizard_a's back ring; one east of (3220, 3220) the first spot's ring.
const collision = () => new Grid().wallColumn(3207, 3203, 3207).wall(at(0, 3220, 3220), 1, 0);
const derive = (
    entry: NpcTeleport = ENTRY,
    more: { script?: string; enums?: string; quests?: { id: string; varp: string }[] } = {},
) => {
    const script = more.script ?? SCRIPT;
    return deriveNpcTeleports({
        entries: [entry],
        triggers: parseTriggers(FILE, script),
        callables: parseCallables(FILE, script),
        scripts: new Map([[FILE, script]]),
        constants: CONSTANTS,
        enums: parseConfigs(more.enums ?? ENUMS),
        npcConfigs: parseConfigs(NPCS),
        locConfigs,
        quests: more.quests ?? [{ id: 'testquest', varp: 'testquest' }],
        spawns: SPAWNS,
        locs: [{ config: 'test_portal', tile: PORTAL, shape: 10, rotation: 0 }],
        collision: collision(),
        size: locSizes(locConfigs),
    });
};
const xz = (ts: { tile: Tile }[]) => ts.map(l => [l.tile.x, l.tile.z]);
const npcRows = (cs: Crossing[]) => cs.filter(c => c.act.kind === 'npc-op');
const backRows = (cs: Crossing[]) => cs.filter(c => c.act.kind === 'loc-op');

describe('deriveNpcTeleports', () => {
    const { crossings, unstood, offLand } = derive();

    test('each npc op that jumps to the label, by its op, from the tiles beside each cluster on land', () => {
        const rows = npcRows(crossings);
        expect(rows.map(c => [c.act, c.at])).toEqual([
            [{ kind: 'npc-op', npc: 'wizard_a', op: 3 }, at(0, 3205, 3225)],
            [{ kind: 'npc-op', npc: 'wizard_b', op: 4 }, at(0, 3210, 3228)],
        ]);
        for (const c of rows) {
            expect(c.via).toBe('teleport');
            expect(c.requires).toEqual([['quest:testquest']]);
            expect(c.source).toBe(ENTRY.source);
            // The cluster's tile and the eight round it.
            expect(c.from).toHaveLength(9);
        }
    });

    test('a dialogue that jumps on a branch, and a config without the op, are not callers', () => {
        expect(npcRows(crossings).some(c => c.act.kind === 'npc-op' && c.act.npc === 'wizard_c')).toBe(false);
        expect(npcRows(crossings).some(c => c.act.kind === 'npc-op' && c.act.op === 1)).toBe(false);
    });

    test("they land on each spot's ring with a line of sight to it, on walkable land", () => {
        const [a] = npcRows(crossings);
        expect(xz(a!.landings)).toEqual([
            // The first spot's ring, less the column past the wall east of (3220, 3220).
            [3219, 3219],
            [3219, 3220],
            [3219, 3221],
            [3220, 3219],
            [3220, 3220],
            [3220, 3221],
            // The second spot's ring, less the column off land.
            [3230, 3209],
            [3230, 3210],
            [3230, 3211],
            [3231, 3209],
            [3231, 3210],
            [3231, 3211],
        ]);
        // A spot of two, then a tile of its ring: the first ring's 6 tiles 1/2 x 1/6 each; the second's 9 walkable
        // tiles (its off-land column among them) 1/2 x 1/9.
        expect(a!.landings.map(l => l.chance)).toEqual([...Array(6).fill(1 / 12), ...Array(6).fill(1 / 18)]);
        // One spot: every landing equally likely, and no chance written.
        const even = ENUMS.replace('val=1,0_50_50_31_10\n', '');
        expect(npcRows(derive(ENTRY, { enums: even }).crossings)[0]!.landings.every(l => l.chance === undefined)).toBe(
            true,
        );
    });

    test('the portal goes back to each npc’s coord, ringed with a line of walk, under its came-from', () => {
        const rows = backRows(crossings);
        expect(rows.map(c => [c.act, c.at, c.requires])).toEqual([
            [{ kind: 'loc-op', loc: 'test_portal', op: 1 }, PORTAL, [['other:came from wizard_a']]],
            [{ kind: 'loc-op', loc: 'test_portal', op: 1 }, PORTAL, [['other:came from wizard_b']]],
        ]);
        const [a, b] = rows;
        // wizard_a's 5x5 ring round (3205, 3205), less the column past the wall at x 3207.
        expect(a!.landings).toHaveLength(20);
        expect(a!.landings.every(l => l.tile.x >= 3203 && l.tile.x <= 3206)).toBe(true);
        expect(b!.landings).toHaveLength(25);
        expect(b!.source).toBe(ENTRY.back.source);
        expect(b!.from).toHaveLength(4);
    });

    test("each row's ticks are its block's delays up to the jump, p_delay(n) n + 1", () => {
        // The label's p_delay(4) before its p_telejump: 5; the portal's p_delay(1): 2.
        expect(npcRows(crossings).map(c => c.ticks)).toEqual([5, 5]);
        expect(backRows(crossings).map(c => c.ticks)).toEqual([2, 2]);
        // Two delays before the jump add: 5 + 1.
        const two = SCRIPT.replace('p_delay(4);', 'p_delay(4); p_delay(0);');
        expect(npcRows(derive(ENTRY, { script: two }).crossings).map(c => c.ticks)).toEqual([6, 6]);
    });

    test('a cluster used from no tile on land, and the landings off land, are reported', () => {
        expect(unstood).toEqual([{ trigger: 'opnpc4,wizard_b', config: 'wizard_b', tile: at(0, 3236, 3225) }]);
        // The second spot's off-land column, once per cluster.
        expect(offLand.map(m => `${m.config} ${m.tile.x} ${m.landing.x},${m.landing.z}`)).toEqual([
            'wizard_a 3205 3232,3209',
            'wizard_a 3205 3232,3210',
            'wizard_a 3205 3232,3211',
            'wizard_b 3210 3232,3209',
            'wizard_b 3210 3232,3210',
            'wizard_b 3210 3232,3211',
            'wizard_b 3236 3232,3209',
            'wizard_b 3236 3232,3210',
            'wizard_b 3236 3232,3211',
        ]);
    });

    test('refuses an entry the data refutes', () => {
        expect(() => derive({ ...ENTRY, label: 'nowhere' })).toThrow(/no such label/);
        expect(() => derive({ ...ENTRY, source: ENTRY.ring })).toThrow(/is not a p_telejump/);
        expect(() => derive({ ...ENTRY, ring: ENTRY.source })).toThrow(/has no \$<local> = map_findsquare/);
        expect(() => derive(ENTRY, { script: SCRIPT.replace('p_telejump($coord);', 'p_telejump($back);') })).toThrow(
            /is not a p_telejump\(\$coord\)/,
        );
        expect(() => derive({ ...ENTRY, source: `${FILE}:30` })).toThrow(/is not in skill_test/);
        expect(() => derive(ENTRY, { script: SCRIPT.replace('p_delay(4);', 'p_delay($wait);') })).toThrow(
            /the jump has a delay it can't read: p_delay\(\$wait\)/,
        );
        expect(() => derive({ ...ENTRY, enum: 'other_spots' })).toThrow(/does not draw \$coord from other_spots/);
        expect(() => derive(ENTRY, { enums: ENUMS.replace('outputtype=coord', 'outputtype=int') })).toThrow(
            /does not give coords/,
        );
        expect(() => derive(ENTRY, { enums: '' })).toThrow(/no such enum test_spots/);
        expect(() => derive({ ...ENTRY, requires: ['quest:otherquest'] })).toThrow(/no quest otherquest/);
        expect(() => derive({ ...ENTRY, checkedAt: ENTRY.source })).toThrow(/does not read %testquest/);
        // The varp is read as a whole name: %testquest is not %testq.
        expect(() => derive(ENTRY, { quests: [{ id: 'testquest', varp: 'testq' }] })).toThrow(/does not read %testq$/);
        expect(() => derive({ ...ENTRY, back: { ...ENTRY.back, varp: 'elsewhere' } })).toThrow(
            /does not set %elsewhere to \$back/,
        );
        expect(() => derive({ ...ENTRY, back: { ...ENTRY.back, trigger: 'oploc2,test_portal' } })).toThrow(
            /no loc op trigger/,
        );
        expect(() => derive(ENTRY, { script: SCRIPT.replace('(^to_b)', '(^nowhere)') })).toThrow(
            /opnpc4,wizard_b passes \^nowhere, no coord/,
        );
        expect(() => derive(ENTRY, { script: SCRIPT.replace(/^@test_teleport.*$/gm, 'mes("No.");') })).toThrow(
            /no npc op trigger jumps to it/,
        );
        // wizard_a's op1 and op3 passing different coords: one way back could not hold both.
        const twice = SCRIPT.replace(
            'if (%testquest = ^testquest_complete) @test_teleport(^to_a);',
            '@test_teleport(^to_b);',
        );
        expect(() => derive(ENTRY, { script: twice })).toThrow(/wizard_a's ops pass \^to_b and \^to_a/);
    });
});

describe('the ways back', () => {
    const { crossings } = derive();
    // wizard_a's tiles (x below 3208) are reached free, wizard_b's with 66 Magic.
    const fill = { setsAny: (ts: readonly Tile[]) => (ts.some(t => t.x < 3208) ? [[]] : [['skill:magic:66']]) };

    test('ask what got the way in: the npc’s teleport, and the sets that reach it', () => {
        const joined = joinWaysIn(crossings, fill).crossings;
        expect(backRows(joined).map(c => c.requires)).toEqual([
            [['other:came from wizard_a', 'quest:testquest']],
            [['other:came from wizard_b', 'quest:testquest', 'skill:magic:66']],
        ]);
        // The npcs' rows are as they were.
        expect(npcRows(joined)).toEqual(npcRows(crossings));
    });

    test('a way back to an npc no set gets to is left out, and returned for the report', () => {
        const joined = joinWaysIn(crossings, { setsAny: ts => (ts.some(t => t.x < 3208) ? [[]] : []) });
        expect(backRows(joined.crossings).map(c => c.requires)).toEqual([
            [['other:came from wizard_a', 'quest:testquest']],
        ]);
        expect(joined.unjoined).toEqual(
            backRows(crossings).filter(c => c.requires[0]!.includes('other:came from wizard_b')),
        );
    });

    test('a teleport row asking `members` gives a way back without it, as no set holds it', () => {
        const members = crossings.map(c =>
            c.act.kind === 'npc-op' ? { ...c, requires: [['members', 'quest:testquest']] } : c,
        );
        expect(backRows(joinWaysIn(members, fill).crossings).map(c => c.requires)).toEqual([
            [['other:came from wizard_a', 'quest:testquest']],
            [['other:came from wizard_b', 'quest:testquest', 'skill:magic:66']],
        ]);
    });

    test("a site's context takes every came-from, so its way out by the portal finds a bank", () => {
        // A tree west of a wall no step crosses, reached by the quest; the bank east of it, by a came-from row.
        const grid = new Grid().wallColumn(3210, 3200, 3231);
        const back: Crossing = {
            via: 'teleport',
            act: { kind: 'loc-op', loc: 'test_portal', op: 1 },
            at: at(0, 3205, 3200),
            from: [at(0, 3205, 3201)],
            landings: [{ tile: at(0, 3215, 3200), spread: 0 }],
            requires: [['other:came from wizard_a', 'quest:testquest']],
            source: ENTRY.back.source,
        };
        const graph = reachGraph({
            world: { features: [], connectors: [], gates: [], transports: [], crossings: [back] },
            collision: grid,
            size: locSizes(new Map()),
        });
        const sites = [
            { id: 'bank:east:0', kind: 'bank' as const, stand: at(0, 3220, 3200), reach: [[]] },
            { id: 'tree:west:0', kind: 'tree' as const, stand: at(0, 3205, 3205), reach: [['quest:testquest']] },
        ];
        expect(cameFromContext([back])(['quest:testquest'])).toEqual(['other:came from wizard_a', 'quest:testquest']);
        expect(nearestSinks(graph, sites).nearest.get('tree:west:0')).toEqual({});
        const context = cameFromContext([back]);
        const expected = {
            site: 'bank:east:0',
            runTicks: 8,
            requires: ['other:came from wizard_a', 'quest:testquest'],
        };
        expect(nearestSinks(graph, sites, { context }).nearest.get('tree:west:0')?.bank).toEqual(expected);
        expect(nearestSinks(graph, sites, { context, full: true }).nearest.get('tree:west:0')?.bank).toEqual(expected);
    });
});
