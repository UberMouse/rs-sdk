// The curated crossings (sources/curated-crossings.ts) on a scripted world: an npc op's rows by the zones its script
// checks, with the dialogue choices; an item op done on a zone's tiles, and back from the land a walk inside its zone
// gets to; a landing on a blocked tile landed beside; a random draw's tiles; an interface click at an npc with its ring;
// the entries the scripts refute; and a curated row a derived one makes too.
import { describe, expect, test } from 'bun:test';
import { locSizes } from '../place';
import { parseConfigs } from '../sources/configs';
import type { Constant } from '../sources/constants';
import { deriveCuratedCrossings, refuseDerivedTwins, type CuratedCrossing } from '../sources/curated-crossings';
import { scanTrigger, type GateScanInput } from '../sources/gate-scan';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Tile } from '../types';
import { at, Grid } from './grid';

const FILE = 'areas/area_test/scripts/test.rs2';
const SCRIPT = `[opnpc1,pilot]
if(inzone(0_50_50_0_0, 0_50_50_15_31, npc_coord) = true) {
    switch_int(~p_choice2("Fly east", 1, "Stay", 2)) {
        case 1 : p_teleport(0_50_50_25_5);
    }
    return;
}
p_teleport(0_50_50_5_25);

[oploc1,stairs]
def_int $z = random(2);
def_int $x = ~random_range(-1, 1);
p_telejump(movecoord(0_50_50_20_20, $x, 0, $z));

[opheld1,whistle]
if(inzone(0_50_50_2_2, 0_50_50_3_3, coord) = true) {
    p_teleport(0_50_50_28_28);
} else if(inzone(0_50_50_24_24, 0_50_50_31_31, coord) = true) {
    p_teleport(0_50_50_2_1);
}

[if_button,glider:com_1] @fly(^dest_a);

[label,fly](coord $dest)
p_teleport(map_findsquare($dest, 0, 1, ^map_findsquare_lineofwalk));
`;
/** `FILE:<line>` of the first line holding `needle`. */
const lineOf = (needle: string): string => `${FILE}:${SCRIPT.split('\n').findIndex(l => l.includes(needle)) + 1}`;

const constant = (value: string): Constant => ({ value, at: 'test.constant:1' });
const CONSTANTS = new Map([
    ['^dest_a', constant('0_50_50_10_10')],
    ['^map_findsquare_lineofwalk', constant('0')],
]);
const locConfigs = parseConfigs('[stairs]\nop1=Climb');
const scan: GateScanInput = {
    triggers: parseTriggers(FILE, SCRIPT),
    callables: parseCallables(FILE, SCRIPT),
    constants: CONSTANTS,
    quests: [],
    loadoutProcs: {},
    names: new Set(),
};
const cluster = (config: string, t: Tile) => ({ config, centre: t, bbox: { x1: t.x, z1: t.z, x2: t.x, z2: t.z } });
const SPAWNS = [cluster('pilot', at(0, 3205, 3210)), cluster('pilot', at(0, 3220, 3210))];
const STAIRS = at(0, 3210, 3220);
// The whistle's landing (3228, 3228) is blocked, and a sealed room in the back zone no walk from the landing enters.
const collision = () =>
    new Grid()
        .block(at(0, 3228, 3228))
        .room(3224, 3224, 3225, 3225)
        .wall(at(0, 3228, 3228), 0, 1)
        .wall(at(0, 3227, 3228), 1, 0);
const derive = (entries: CuratedCrossing[], script = SCRIPT) =>
    deriveCuratedCrossings({
        entries,
        triggers: parseTriggers(FILE, script),
        scripts: new Map([[FILE, script]]),
        constants: CONSTANTS,
        scanOf: scanTrigger({ ...scan, triggers: parseTriggers(FILE, script) }),
        spawns: SPAWNS,
        locs: [{ config: 'stairs', tile: STAIRS, shape: 10, rotation: 0 }],
        collision: collision(),
        size: locSizes(locConfigs),
    });

const EAST: CuratedCrossing = {
    via: 'teleport',
    trigger: 'opnpc1,pilot',
    act: { kind: 'npc-op', npc: 'pilot', op: 1, choices: ['Fly east'] },
    where: { placed: { in: ['0_50_50_0_0', '0_50_50_15_31'], at: lineOf('inzone(0_50_50_0_0') } },
    to: ['0_50_50_25_5'],
    requires: [['quest:test']],
    source: lineOf('p_teleport(0_50_50_25_5)'),
};
const NORTH: CuratedCrossing = {
    via: 'teleport',
    trigger: 'opnpc1,pilot',
    act: { kind: 'npc-op', npc: 'pilot', op: 1 },
    where: { placed: { notIn: [['0_50_50_0_0', '0_50_50_15_31']], at: lineOf('inzone(0_50_50_0_0') } },
    to: ['0_50_50_5_25'],
    requires: [[]],
    source: lineOf('p_teleport(0_50_50_5_25)'),
};
const WHISTLE_IN: CuratedCrossing = {
    via: 'teleport',
    trigger: 'opheld1,whistle',
    act: { kind: 'item-op', obj: 'whistle', op: 1 },
    where: { zone: { in: ['0_50_50_2_2', '0_50_50_3_3'], at: lineOf('inzone(0_50_50_2_2') } },
    to: ['0_50_50_28_28'],
    requires: [['item:whistle:held']],
    source: lineOf('p_teleport(0_50_50_28_28)'),
};
const WHISTLE_OUT: CuratedCrossing = {
    ...WHISTLE_IN,
    where: {
        zone: { in: ['0_50_50_24_24', '0_50_50_31_31'], seed: '0_50_50_28_28', at: lineOf('inzone(0_50_50_24_24') },
    },
    to: ['0_50_50_2_1'],
    source: lineOf('p_teleport(0_50_50_2_1)'),
};
const STAIRS_DOWN: CuratedCrossing = {
    via: 'scripted',
    trigger: 'oploc1,stairs',
    act: { kind: 'loc-op', loc: 'stairs', op: 1 },
    to: ['0_50_50_20_20'],
    draw: { x: [-1, 1], z: [0, 1] },
    requires: [[]],
    source: lineOf('p_telejump(movecoord'),
};
const GLIDER: CuratedCrossing = {
    via: 'teleport',
    trigger: 'if_button,glider:com_1',
    act: { kind: 'interface', component: 'glider:com_1' },
    where: { placed: { npc: 'pilot', in: ['0_50_50_0_0', '0_50_50_15_31'], at: lineOf('inzone(0_50_50_0_0') } },
    to: ['0_50_50_10_10'],
    ring: [0, 1, 0],
    requires: [[]],
    source: lineOf('p_teleport(map_findsquare'),
};
const tiles = (ls: { tile: Tile }[]) => ls.map(l => l.tile);
/** The stairs entry kept to the placed locs on some tiles. */
const stairsAt = (...literals: string[]): CuratedCrossing => ({
    ...STAIRS_DOWN,
    where: { placed: { tiles: literals, at: STAIRS_DOWN.source } },
});
const fails = (e: CuratedCrossing, why: RegExp) => expect(() => derive([e])).toThrow(why);

describe('deriveCuratedCrossings', () => {
    test("an npc op's rows go only to the spawns its zones keep, with the act's choices", () => {
        const { crossings } = derive([EAST, NORTH]);
        expect(crossings.map(c => [c.at, tiles(c.landings), c.act])).toEqual([
            [at(0, 3205, 3210), [at(0, 3225, 3205)], EAST.act],
            [at(0, 3220, 3210), [at(0, 3205, 3225)], NORTH.act],
        ]);
        expect(crossings[0]!.from).toContainEqual(at(0, 3205, 3211));
        expect(crossings[0]!.requires).toEqual([['quest:test']]);
    });

    test('an item op is done from the zone on land, and lands beside a blocked landing on the tiles stepped out to', () => {
        const { crossings, stepped } = derive([WHISTLE_IN]);
        const [row] = crossings;
        expect(row!.from).toEqual([at(0, 3202, 3202), at(0, 3202, 3203), at(0, 3203, 3202), at(0, 3203, 3203)]);
        // North and west of (3228, 3228) are walled off, and a diagonal step needs both its sides open: south,
        // south-east and east are stepped to.
        expect(tiles(row!.landings)).toEqual([at(0, 3228, 3227), at(0, 3229, 3227), at(0, 3229, 3228)]);
        expect(stepped).toHaveLength(1);
        expect(stepped[0]!.landing).toEqual(at(0, 3228, 3228));
    });

    test('with a seed, the zone is done from only the land a walk inside it gets to from there', () => {
        const [row] = derive([WHISTLE_OUT]).crossings;
        expect(row!.from).toContainEqual(at(0, 3230, 3230));
        // Inside the sealed room, and the blocked landing itself: neither is a tile it is done from.
        expect(row!.from).not.toContainEqual(at(0, 3224, 3224));
        expect(row!.from).not.toContainEqual(at(0, 3228, 3228));
        expect(tiles(row!.landings)).toEqual([at(0, 3202, 3201)]);
    });

    test("a random draw's every tile is a landing", () => {
        const [row] = derive([STAIRS_DOWN]).crossings;
        expect(tiles(row!.landings)).toEqual([
            at(0, 3219, 3220),
            at(0, 3219, 3221),
            at(0, 3220, 3220),
            at(0, 3220, 3221),
            at(0, 3221, 3220),
            at(0, 3221, 3221),
        ]);
        expect(row!.at).toEqual(STAIRS);
    });

    test("an interface click is done beside the npc that opens it, landing on its ring's tiles", () => {
        const [row, ...more] = derive([GLIDER]).crossings;
        expect(more).toEqual([]);
        expect(row!.at).toEqual(at(0, 3205, 3210));
        expect(tiles(row!.landings)).toHaveLength(9);
    });
});

describe('deriveCuratedCrossings: what the scripts refute', () => {
    test('a header no script has', () => fails({ ...EAST, trigger: 'opnpc1,nobody' }, /no script has this header/));
    test('a landing neither the script nor the line names', () =>
        fails({ ...EAST, to: ['0_50_50_9_9'] }, /names 0_50_50_9_9/));
    test("a choice that is no option of the scripts'", () =>
        fails(
            { ...EAST, act: { ...EAST.act, kind: 'npc-op', npc: 'pilot', op: 1, choices: ['Fly west'] } },
            /"Fly west"/,
        ));
    test('a zone no inzone checks', () =>
        fails(
            { ...EAST, where: { placed: { in: ['0_50_50_0_0', '0_50_50_9_9'], at: EAST.source } } },
            /inzone\(0_50_50_0_0, 0_50_50_9_9/,
        ));
    test('a landing the gate scan finds no move to, on a loc or npc op trigger', () =>
        fails({ ...NORTH, to: ['0_50_50_15_31'], source: EAST.source }, /finds no move to 0_50_50_15_31/));
    test('requirements not written canonically', () =>
        fails({ ...EAST, requires: [['quest:test'], ['quest:test', 'members']] }, /write requires as/));
});

describe('deriveCuratedCrossings: placements kept by tile', () => {
    test('a loc op is done at the placed loc on a listed tile', () => {
        const { crossings } = derive([stairsAt('0_50_50_10_20')]);
        expect(crossings.map(c => c.at)).toEqual([STAIRS]);
    });

    test('a tile where the loc is not placed is refused', () =>
        fails(stairsAt('0_50_50_11_20'), /stairs is not placed at 0_50_50_11_20/));
});

describe('refuseDerivedTwins', () => {
    const rows = derive([EAST, STAIRS_DOWN]).crossings;
    const stairs = rows.find(r => r.act.kind === 'loc-op')!;
    const derived = { ...stairs, landings: [{ tile: at(0, 3230, 3230) }], source: 'derived.rs2:1' };

    test('a curated act a derived row has too is refused, naming both sources', () =>
        expect(() => refuseDerivedTwins(rows, [derived])).toThrow(
            `loc-op 1 stairs (${STAIRS_DOWN.source}, derived from derived.rs2:1)`,
        ));
    test("the same op on another loc, or another op on the loc, is no twin; nor are curated rows each other's", () => {
        const other = [
            { ...derived, act: { kind: 'loc-op' as const, loc: 'ladder', op: 1 } },
            { ...derived, act: { kind: 'loc-op' as const, loc: 'stairs', op: 2 } },
        ];
        expect(() => refuseDerivedTwins(rows, other)).not.toThrow();
        expect(() => refuseDerivedTwins([...rows, ...rows], [])).not.toThrow();
    });
});
