// What a scripted crossing takes when it succeeds and what its fall costs (sources/gate-scan.ts bound runs, written
// by sources/gate-landings.ts): the ticks of the move's delays, a forced walk one tick a tile, a delay the stand's
// distance sets, a loc_find that moves the active loc on, and a fall's hitpoints-linear hit, worked at 52 and 99.
// The script copies the shapes of skill_agility/scripts/agility.rs2's procs and of gnome_course.rs2 and
// wilderness_course.rs2's obstacles, cut to what the scan reads.
import { describe, expect, test } from 'bun:test';
import { locSizes, type LocReach } from '../place';
import { damageAt } from '../roll';
import type { ConnectorCollision } from '../sources/connectors';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { deriveGateLandings, deriveScriptedMoves } from '../sources/gate-landings';
import { scanGates, scanTrigger, type GateScanInput } from '../sources/gate-scan';
import { coordTile } from '../sources/runescript';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Gate, Tile } from '../types';

const FILE = 'areas/test.rs2';
const SCRIPT = `[oploc1,gnomelog]
p_arrivedelay;
~agility_force_move(75, movecoord(coord, 0, 0, -7));

[oploc1,wildlog]
p_teleport(movecoord(loc_coord, 1, 0, 0));
p_arrivedelay;
~forcemove(movecoord(coord, -4, 0, 0));
if (stat_random(agility, 200, 250) = false) {
    ~agility_delay_fail(movecoord(coord, 0, 0, 2), 0_1_1_30_30, calc(((stat(hitpoints) * 15) / 100) + 1), "You fall.");
    p_teleport(movecoord(coord, 0, 0, -1));
    return;
}
~forcemove(movecoord(coord, -3, 0, 0));
~forcemove(movecoord(coord, -1, 0, 0));

[oploc1,ropeswing]
def_coord $start_pos = movecoord(loc_coord, 0, 0, 1);
def_int $delay = distance(coord, $start_pos);
if (coordz(coord) > coordz($start_pos)) {
    return;
}
p_delay(0);
p_teleport($start_pos);
if ($delay > 0) p_delay($delay);
if (stat_random(agility, 200, 250) = false) {
    ~agility_instant_fail(0_1_1_40_40, calc(((stat(hitpoints) * 15) / 100) + 1), "You fall.");
    return;
}
~agility_exactmove(0, $start_pos, movecoord($start_pos, 0, 0, 5));

[oploc1,pipe]
if (coordz(coord) > coordz(loc_coord)) {
    return;
}
if (stat(agility) < 49) {
    return;
}
if (coord ! movecoord(loc_coord, 0, 0, -1)) {
    p_delay(0);
    p_walk(movecoord(loc_coord, 0, 0, -1));
}
p_delay(0);
~agility_exactmove(3, movecoord(loc_coord, 0, 0, -1), movecoord(loc_coord, 0, 0, 2));
p_delay(0);
p_telejump(movecoord(loc_coord, 0, 0, 9));
p_delay(0);
~change_merged_loc(movecoord(coord, 0, 0, 1));
~agility_exactmove(3, movecoord(loc_coord, 0, 0, -1), movecoord(loc_coord, 0, 0, 2));

[proc,agility_force_move](int $xp, coord $dest)
def_int $change_x = calc(coordx($dest) - coordx(coord));
def_int $change_z = calc(coordz($dest) - coordz(coord));
~agility_walk($change_x, $change_z);
stat_advance(agility, $xp);

[proc,forcemove](coord $dest_coord)
def_int $change_x = calc(coordx($dest_coord) - coordx(coord));
def_int $change_z = calc(coordz($dest_coord) - coordz(coord));
~agility_walk($change_x, $change_z);

[proc,agility_walk](int $change_x, int $change_z)
if ($change_x = 0 & $change_z = 0) {
    return;
}
def_int $move_x = 0;
def_int $move_z = 0;
if ($change_x >= 1) {
    $move_x = 1;
} else if ($change_x <= -1) {
    $move_x = -1;
}
if ($change_z >= 1) {
    $move_z = 1;
} else if ($change_z <= -1) {
    $move_z = -1;
}
p_teleport(movecoord(coord, $move_x, 0, $move_z));
$change_x = calc($change_x - $move_x);
$change_z = calc($change_z - $move_z);
p_delay(0);
~agility_walk($change_x, $change_z);

[proc,agility_exactmove](int $movement_delay, coord $start_coord, coord $end_coord)
p_exactmove($start_coord, $end_coord, 30, 126, ^exact_north);
p_delay($movement_delay);

[proc,agility_delay_fail](coord $fall_face, coord $fail_coord, int $damage, string $message)
facesquare($fall_face);
p_delay(1);
p_telejump($fail_coord);
damage(uid, 1, $damage);
mes($message);
p_delay(0);

[proc,agility_instant_fail](coord $fail_coord, int $damage, string $message)
p_telejump($fail_coord);
~damage_self($damage);
mes($message);

[proc,change_merged_loc](coord $merge_pos)
if (loc_find($merge_pos, loc_type) = true) {
    return;
}

[proc,damage_self](int $amount)
damage(uid, 1, $amount);
`;
/** `file:line` of the first line of SCRIPT holding `needle`, from the line holding `after` on. */
const lineOf = (needle: string, after = ''): string => {
    const lines = SCRIPT.split('\n');
    const from = lines.findIndex(l => l.includes(after));
    return `${FILE}:${lines.findIndex((l, i) => i >= from && l.includes(needle)) + 1}`;
};

const scan: GateScanInput = {
    triggers: parseTriggers(FILE, SCRIPT),
    callables: parseCallables(FILE, SCRIPT),
    constants: collectConstants([['agility.constant', '^exact_north = 0']]),
    quests: [],
    loadoutProcs: {},
    names: new Set(),
};
const locConfigs = parseConfigs(['gnomelog', 'wildlog', 'ropeswing', 'pipe'].map(c => `[${c}]\nop1=Use`).join('\n'));

const at = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const key = (t: Tile): string => `${t.level},${t.x},${t.z}`;
/** The four tiles sharing an edge with `t`, sorted as rows write stands. */
const around = (t: Tile): Tile[] => [at(t.x - 1, t.z), at(t.x, t.z - 1), at(t.x, t.z + 1), at(t.x + 1, t.z)];

const GNOMELOG = at(100, 100);
const WILDLOG = at(130, 100);
const ROPESWING = at(150, 100);
/** The pipe's two pieces, nine apart as the Wilderness course's: the far one has no free edge. */
const PIPE = at(170, 100);
const PIPE_FAR = at(170, 110);
const PLACED: [string, Tile][] = [
    ['gnomelog', GNOMELOG],
    ['wildlog', WILDLOG],
    ['ropeswing', ROPESWING],
    ['pipe', PIPE],
    ['pipe', PIPE_FAR],
];
const span = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** A wall across each crossing, so no short walk reaches its landing: what makes it a crossing. */
const WALLS: Tile[] = [
    ...span(85, 115).map(x => at(x, 97)),
    ...span(85, 115).map(z => at(127, z)),
    ...span(140, 160).map(x => at(x, 104)),
];
const blocked = new Set([
    ...PLACED.map(([, t]) => key(t)),
    // The logs are used from one edge each: the gnome log from the north, the Wilderness log from the east.
    ...around(GNOMELOG)
        .filter(t => key(t) !== key(at(100, 101)))
        .map(key),
    ...around(WILDLOG)
        .filter(t => key(t) !== key(at(131, 100)))
        .map(key),
    ...around(PIPE_FAR).map(key),
    ...WALLS.map(key),
]);
const walkable = (level: number, x: number, z: number) => !blocked.has(key(at(x, z, level)));
const collision: ConnectorCollision & {
    canStep: (l: number, x: number, z: number, dx: number, dz: number) => boolean;
} = {
    walkable,
    land: () => true,
    reached: (from: Tile, l: LocReach) => Math.abs(from.x - l.x) + Math.abs(from.z - l.z) === 1,
    canStep: (level, x, z, dx, dz) => walkable(level, x + dx, z + dz),
};
const locs = PLACED.map(([config, tile]) => ({ config, tile, shape: 10, rotation: 0 }));

const moves = deriveScriptedMoves({
    scan,
    scanOf: scanTrigger(scan),
    curated: [],
    locConfigs,
    locs,
    collision,
    size: locSizes(locConfigs),
    connectors: [],
});
const rowsOf = (config: string) => moves.crossings.filter(c => c.act.kind === 'loc-op' && c.act.loc === config);

describe('a scripted crossing: its success ticks', () => {
    test('a Gnome log: p_arrivedelay, then a forced walk of 7 tiles, 8 ticks', () => {
        // p_arrivedelay, 1 tick; ~agility_force_move walks movecoord(coord, 0, 0, -7) through ~agility_walk, one
        // p_delay(0) (1 tick) a tile: 7. 1 + 7 = 8, landing 7 south of the stand (100, 101): (100, 94).
        expect(rowsOf('gnomelog')).toEqual([
            {
                via: 'scripted',
                act: { kind: 'loc-op', loc: 'gnomelog', op: 1 },
                at: GNOMELOG,
                from: [at(100, 101)],
                landings: [{ tile: at(100, 94) }],
                requires: [[]],
                ticks: 8,
                source: lineOf('~agility_force_move(75'),
            },
        ]);
    });

    test('a Wilderness log, a forced walk either side of the roll: 9 ticks across, 8 to the fall', () => {
        // Success: p_arrivedelay 1, then forcemoves of 4, 3 and 1 tiles, a tick each: 1 + 4 + 3 + 1 = 9, from
        // (131, 100) to (123, 100). Fall: p_arrivedelay 1, the 4-tile walk 4, ~agility_delay_fail's p_delay(1) 2 and
        // p_delay(0) 1: 8, landing at 0_1_1_30_30 then a step south (p_teleport, no tick).
        const [row, ...more] = rowsOf('wildlog');
        expect(more).toEqual([]);
        expect(row).toMatchObject({ from: [at(131, 100)], landings: [{ tile: at(123, 100) }], ticks: 9 });
        const fallen = coordTile('0_1_1_30_30');
        expect(row!.roll).toEqual({
            stat: 'agility',
            low: 200,
            high: 250,
            source: lineOf('stat_random(agility, 200, 250)'),
            // floor(stat(hitpoints) * 15 / 100) + 1, worked at 99 hitpoints: floor(1485 / 100) + 1 = 15.
            fail: { ticks: 8, to: { ...fallen, z: fallen.z - 1 }, damage: 15, hpDamage: { a: 15, b: 100, c: 1 } },
        });
    });

    test("a rope swing's delay the stand's distance to the swing tile sets: one row per count", () => {
        // $start_pos is the tile north of the swing, (150, 101); `distance` is the Chebyshev distance (ServerOps.ts
        // DISTANCE). p_delay(0) 1, then p_delay($delay) $delay + 1 when $delay > 0, then ~agility_exactmove's
        // p_delay(0) 1. From (150, 101) itself: 1 + 1 = 2. From (149, 100) and (151, 100), distance 1: 1 + 2 + 1 = 4.
        // From (150, 99), distance 2: 1 + 3 + 1 = 5. Every one lands 5 north of $start_pos, (150, 106).
        const rows = rowsOf('ropeswing');
        expect(rows.map(r => [r.from, r.ticks, r.landings])).toEqual([
            [[at(149, 100), at(151, 100)], 4, [{ tile: at(150, 106) }]],
            [[at(150, 99)], 5, [{ tile: at(150, 106) }]],
            [[at(150, 101)], 2, [{ tile: at(150, 106) }]],
        ]);
        // The fall from a stand 1 away: p_delay(0) 1 and p_delay(1) 2 before the roll, the instant fail no delay: 3,
        // with floor(HP * 15 / 100) + 1.
        expect(rows[0]!.roll?.fail).toMatchObject({ ticks: 3, hpDamage: { a: 15, b: 100, c: 1 } });
    });
});

describe('a gate: its success ticks', () => {
    test("a pipe whose loc_find moves the active loc on: the far piece's exactmove lands, the slowest stand's ticks", () => {
        // From the stand under the pipe, (170, 99): p_delay(0) 1, the exactmove's p_delay(3) 4, p_delay(0) 1, the
        // telejump to (170, 109), p_delay(0) 1, then loc_find makes the piece at (170, 110) the active loc and its
        // exactmove, p_delay(3) 4, lands at its loc_coord + 2 = (170, 112): 11. From (169, 100) and (171, 100) the
        // p_delay(0) before p_walk adds 1: 12, the row's ticks, the most any stand's takes. From the north, (170, 101), the trigger refuses.
        const gate: Gate = {
            trigger: 'oploc1,pipe',
            kind: 'gate',
            loc: 'pipe',
            tile: PIPE,
            shape: 10,
            angle: 0,
            requires: [['skill:agility:49']],
            source: lineOf('stat(agility) < 49'),
        };
        const out = deriveGateLandings({
            gates: [gate],
            scan,
            candidates: scanGates(scan),
            locConfigs,
            collision,
            size: locSizes(locConfigs),
            locs,
        });
        const landing = at(170, 112);
        expect(out.gates[0]).toMatchObject({
            landings: [at(169, 100), at(170, 99), at(171, 100)].map(stand => ({ stand, landing })),
            ticks: 12,
        });
    });
});

describe('damageAt: a fall at 52 and 99 hitpoints', () => {
    test('floor(HP * 15 / 100) + 1, the Wilderness log and rope swing', () => {
        // 52 * 15 = 780, / 100 = 7 (truncated), + 1 = 8; 99 * 15 = 1485, / 100 = 14, + 1 = 15.
        expect(damageAt({ a: 15, b: 100, c: 1 }, 52)).toBe(8);
        expect(damageAt({ a: 15, b: 100, c: 1 }, 99)).toBe(15);
    });

    test('floor(HP * 216 / 1000) + 1, the Wilderness stepping stones', () => {
        // 52 * 216 = 11232, / 1000 = 11, + 1 = 12; 99 * 216 = 21384, / 1000 = 21, + 1 = 22.
        expect(damageAt({ a: 216, b: 1000, c: 1 }, 52)).toBe(12);
        expect(damageAt({ a: 216, b: 1000, c: 1 }, 99)).toBe(22);
    });
});
