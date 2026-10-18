// The loc op moves no gate row makes (sources/gate-landings.ts deriveScriptedMoves), on scripted triggers: a jump to
// a literal, a forcemove to a fixed tile, an agility walk behind a roll, a temporary block, and what gives no row (a
// landing no run settles, a failure whose damage is not known, a landing off walkable land, alone or beside one on
// land, a step onto a plant that blocks nothing, a connector's own loc and op, a door, a shuffle beside the loc).
import { describe, expect, test } from 'bun:test';
import { locSizes, type LocReach } from '../place';
import type { ConnectorCollision } from '../sources/connectors';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { deriveScriptedMoves, walksTo, type ScriptedMoves } from '../sources/gate-landings';
import { scanGates, scanTrigger, type CuratedGate, type GateScanInput } from '../sources/gate-scan';
import { coordTile } from '../sources/runescript';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Quest, Tile } from '../types';

const FILE = 'areas/test.rs2';
const SCRIPT = `[oploc1,jumprock]
p_telejump(0_50_50_10_10);

[oploc1,ledge]
~forcemove(0_1_1_46_41);

[oploc1,logbalance]
p_delay(0);
if (stat_random(agility, 100, 200) = false) {
    p_telejump(0_1_1_30_30);
    ~damage_self(calc(((stat(hitpoints) * 10) / 100) + 1));
    p_delay(2);
    return;
}
~forcemove(movecoord(coord, 0, 0, 6));

[oploc1,tripwire]
if (stat_random(agility, 30, 155) = false) {
    mes("You snag the wire.");
}
p_telejump(movecoord(loc_coord, 0, 0, 5));

[oploc1,citygate]
if (%cookquest = 2 & coordz(coord) < coordz(loc_coord)) {
    mes("Not today.");
    return;
}
~forcemove(movecoord(coord, 0, 0, 3));

[oploc1,sinkhole]
p_telejump(map_findsquare(0_50_50_1_1, 1, 1, 0));

[oploc1,cellarladder]
p_telejump(0_50_50_5_5);

[oploc1,shuffle]
p_teleport(movecoord(coord, 2, 0, 0));

[oploc1,testdoor]
~open_test_door;

[oploc1,rubblepile]
if (stat_random(agility, 100, 200) = false) {
    ~damage_self(divide(stat(hitpoints), random(5)));
    return;
}
~forcemove(movecoord(coord, 0, 0, 6));

[oploc1,wallgap]
p_telejump(movecoord(loc_coord, 0, 0, 3));

[oploc1,ferrystone]
if (random(2) = 0) {
    p_telejump(movecoord(loc_coord, 0, 0, 2));
} else {
    p_telejump(movecoord(loc_coord, 0, 0, 5));
}

[oploc2,potatoplant]
p_arrivedelay;
if (inv_freespace(inv) = 0) {
    mes("You don't have room for this potato.");
    p_teleport(loc_coord);
    p_delay(0);
} else {
    p_teleport(loc_coord);
    p_delay(0);
    loc_del(50);
    inv_add(inv, potato, 1);
}

[oploc1,steppingstone]
p_telejump(loc_coord);

[proc,forcemove](coord $dest_coord)
~walk(calc(coordx($dest_coord) - coordx(coord)), calc(coordz($dest_coord) - coordz(coord)));

[proc,walk](int $dx, int $dz)
if ($dx = 0 & $dz = 0) {
    return;
}
def_int $mx = 0;
def_int $mz = 0;
if ($dx > 0) {
    $mx = 1;
} else if ($dx < 0) {
    $mx = -1;
}
if ($dz > 0) {
    $mz = 1;
} else if ($dz < 0) {
    $mz = -1;
}
p_teleport(movecoord(coord, $mx, 0, $mz));
p_delay(0);
~walk(calc($dx - $mx), calc($dz - $mz));

[proc,damage_self](int $amount)
damage(uid, 1, $amount);
`;
const DOORS = 'doors/scripts/test_doors.rs2';
const DOOR_SCRIPT = `[proc,open_test_door]
def_int $x;
p_teleport(movecoord(loc_coord, $x, 0, 0));
`;
/** `file:line` of the first line of SCRIPT holding `needle`, from the line holding `after` on. */
const lineOf = (needle: string, after = ''): string => {
    const lines = SCRIPT.split('\n');
    const from = lines.findIndex(l => l.includes(after));
    return `${FILE}:${lines.findIndex((l, i) => i >= from && l.includes(needle)) + 1}`;
};

const quest: Quest = { id: 'cook', varp: 'cookquest', varpId: 1, complete: 3, stages: {}, source: '' };
const scan: GateScanInput = {
    triggers: parseTriggers(FILE, SCRIPT),
    callables: [...parseCallables(FILE, SCRIPT), ...parseCallables(DOORS, DOOR_SCRIPT)],
    constants: collectConstants([['quest.constant', '^cook_complete = 3']]),
    quests: [quest],
    loadoutProcs: {},
    names: new Set(),
};
const CONFIGS = [
    'jumprock',
    'ledge',
    'logbalance',
    'tripwire',
    'citygate',
    'sinkhole',
    'cellarladder',
    'shuffle',
    'rubblepile',
    'wallgap',
    'ferrystone',
    'steppingstone',
];
// The plant blocks nothing (blockwalk=no); every other config blocks its tile.
const locConfigs = parseConfigs(
    [...[...CONFIGS, 'testdoor'].map(c => `[${c}]\nop1=Use`), '[potatoplant]\nop2=Pick\nblockwalk=no'].join('\n'),
);

const at = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const key = (t: Tile): string => `${t.level},${t.x},${t.z}`;
/** Where each config is placed: on the row z = 100, a river at z 102-103 to the north of it. */
const PLACED: Record<string, Tile> = {
    jumprock: at(100, 100),
    ledge: at(110, 100),
    logbalance: at(130, 100),
    tripwire: at(140, 100),
    citygate: at(150, 100),
    sinkhole: at(160, 100),
    cellarladder: at(170, 100),
    shuffle: at(180, 100),
    testdoor: at(190, 100),
    rubblepile: at(120, 100),
    wallgap: at(125, 100),
    ferrystone: at(135, 100),
    potatoplant: at(145, 100),
    steppingstone: at(155, 100),
};
/** Tiles blocked beside a loc so that one stand is left: the one named. */
const ONLY: Record<string, Tile> = {
    ledge: at(110, 99),
    logbalance: at(130, 99),
    tripwire: at(140, 99),
    citygate: at(150, 101),
    rubblepile: at(120, 99),
};
const RIVER = new Set(
    Array.from({ length: 200 }, (_, i) => [at(i, 102), at(i, 103)])
        .flat()
        .map(key),
);
const blocked = new Set([
    ...Object.values(PLACED).map(key),
    ...Object.entries(ONLY).flatMap(([config, stand]) => {
        const l = PLACED[config]!;
        return [at(l.x - 1, l.z), at(l.x + 1, l.z), at(l.x, l.z - 1), at(l.x, l.z + 1)]
            .filter(t => key(t) !== key(stand))
            .map(key);
    }),
]);
const walkable = (level: number, x: number, z: number) =>
    !blocked.has(key(at(x, z, level))) && !RIVER.has(key(at(x, z, level)));
/** Every tile walkable and on land but the locs, the river and the tiles ONLY blocks; a loc is used from an edge. */
const collision: ConnectorCollision & {
    canStep: (l: number, x: number, z: number, dx: number, dz: number) => boolean;
} = {
    walkable,
    land: () => true,
    reached: (from: Tile, l: LocReach) => Math.abs(from.x - l.x) + Math.abs(from.z - l.z) === 1,
    canStep: (level, x, z, dx, dz) => walkable(level, x + dx, z + dz),
};

const TEMPORARY: CuratedGate = {
    trigger: 'oploc1,citygate',
    kind: 'temporary-block',
    source: lineOf('%cookquest = 2'),
    why: 'Shut only while Cook is at stage 2.',
};

const derive = (connectors: { loc: Tile; op: number }[] = []): ScriptedMoves =>
    deriveScriptedMoves({
        scan,
        scanOf: scanTrigger(scan),
        curated: [TEMPORARY],
        locConfigs,
        locs: Object.entries(PLACED).map(([config, tile]) => ({ config, tile, shape: 10, rotation: 0 })),
        collision,
        size: locSizes(locConfigs),
        connectors,
    });
const out = derive();
const rowsOf = (config: string) => out.crossings.filter(c => c.act.kind === 'loc-op' && c.act.loc === config);
/** The four tiles sharing an edge with `t`, sorted as rows write stands. */
const around = (t: Tile): Tile[] => [at(t.x - 1, t.z), at(t.x, t.z - 1), at(t.x, t.z + 1), at(t.x + 1, t.z)];

describe('deriveScriptedMoves: rows', () => {
    test('an unconditional p_telejump to a literal: one free row from every stand, landing on the literal', () => {
        expect(rowsOf('jumprock')).toEqual([
            {
                via: 'scripted',
                act: { kind: 'loc-op', loc: 'jumprock', op: 1 },
                at: PLACED.jumprock!,
                from: around(PLACED.jumprock!),
                landings: [{ tile: coordTile('0_50_50_10_10') }],
                requires: [[]],
                source: lineOf('p_telejump(0_50_50_10_10)'),
            },
        ]);
    });

    test('a ~forcemove to a fixed tile lands there, across the river, its source the call', () => {
        const [row, ...more] = rowsOf('ledge');
        expect(more).toEqual([]);
        expect(row).toMatchObject({ from: [ONLY.ledge], landings: [{ tile: coordTile('0_1_1_46_41') }] });
        expect(row!.source).toBe(lineOf('~forcemove(0_1_1_46_41)'));
    });

    test('an agility walk behind a roll: the landing it succeeds to, and the roll with its failure', () => {
        expect(rowsOf('logbalance')).toEqual([
            {
                via: 'scripted',
                act: { kind: 'loc-op', loc: 'logbalance', op: 1 },
                at: PLACED.logbalance!,
                from: [ONLY.logbalance!],
                landings: [{ tile: at(130, 105) }],
                requires: [[]],
                // The fall: p_delay(0) then p_delay(2), 1 + 3 ticks; 99 hitpoints * 10 / 100 + 1 damage at most; the
                // river bank it telejumps to.
                roll: {
                    stat: 'agility',
                    low: 100,
                    high: 200,
                    source: lineOf('stat_random(agility, 100, 200)'),
                    fail: { ticks: 4, to: coordTile('0_1_1_30_30'), damage: 10 },
                },
                source: lineOf('~forcemove(movecoord(coord, 0, 0, 6))'),
            },
        ]);
    });

    test('a roll whose failure makes the move all the same does not gate it: no roll', () => {
        const [row] = rowsOf('tripwire');
        expect(row!.landings).toEqual([{ tile: at(140, 105) }]);
        expect(row!.roll).toBeUndefined();
    });

    test("a temporary block's forcemove crosses the shut loc: a free row, with gates.ts's why as its notes", () => {
        expect(scanGates(scan).find(c => c.trigger === 'oploc1,citygate')?.kind).toBe('temporary-block');
        expect(rowsOf('citygate')).toEqual([
            {
                via: 'scripted',
                act: { kind: 'loc-op', loc: 'citygate', op: 1 },
                at: PLACED.citygate!,
                from: [ONLY.citygate!],
                landings: [{ tile: at(150, 104) }],
                requires: [[]],
                source: lineOf('~forcemove(movecoord(coord, 0, 0, 3))'),
                notes: TEMPORARY.why,
            },
        ]);
    });
});

describe('deriveScriptedMoves: no row', () => {
    test('a landing the run cannot settle is reported with the construct and its line, never guessed', () => {
        expect(rowsOf('sinkhole')).toEqual([]);
        expect(out.unsettled.filter(u => u.loc === 'sinkhole')).toEqual([
            {
                trigger: 'oploc1,sinkhole',
                loc: 'sinkhole',
                tile: PLACED.sinkhole!,
                reasons: [
                    `\`p_telejump(map_findsquare(0_50_50_1_1, 1, 1, 0))\` (${lineOf('map_findsquare')}): \`map_findsquare(0_50_50_1_1, 1, 1, 0)\` is not known offline`,
                ],
            },
        ]);
    });

    test('a failure dealing damage divided by a random draw is not known offline: reported, not understated', () => {
        expect(rowsOf('rubblepile')).toEqual([]);
        expect(out.unsettled.filter(u => u.loc === 'rubblepile')).toEqual([
            {
                trigger: 'oploc1,rubblepile',
                loc: 'rubblepile',
                tile: PLACED.rubblepile!,
                reasons: [
                    `\`~damage_self(divide(stat(hitpoints), random(5)))\` (${lineOf('random(5)')}): the damage is not known offline`,
                ],
            },
        ]);
    });

    test('a move onto a tile the collision data blocks is reported as off walkable land, not taken as no passage', () => {
        expect(rowsOf('wallgap')).toEqual([]);
        expect(out.unsettled.filter(u => u.loc === 'wallgap')).toEqual([
            {
                trigger: 'oploc1,wallgap',
                loc: 'wallgap',
                tile: PLACED.wallgap!,
                reasons: [
                    `lands off walkable land at (125, 103) (${lineOf('p_telejump(movecoord(loc_coord, 0, 0, 3))')})`,
                ],
            },
        ]);
    });

    test('a stand with one path landing across on land and one off walkable land: no row, the off-land landing reported', () => {
        expect(rowsOf('ferrystone')).toEqual([]);
        expect(out.unsettled.filter(u => u.loc === 'ferrystone')).toEqual([
            {
                trigger: 'oploc1,ferrystone',
                loc: 'ferrystone',
                tile: PLACED.ferrystone!,
                reasons: [
                    `lands off walkable land at (135, 102) (${lineOf('p_telejump(movecoord(loc_coord, 0, 0, 2))')})`,
                ],
            },
        ]);
    });

    test("a move onto a blocked tile of a loc that blocks nothing (a plant picked, room or none) is no passage; onto a blocking loc's, reported", () => {
        expect(rowsOf('potatoplant')).toEqual([]);
        expect(out.unsettled.some(u => u.loc === 'potatoplant')).toBe(false);
        expect(out.unsettled.filter(u => u.loc === 'steppingstone')).toEqual([
            {
                trigger: 'oploc1,steppingstone',
                loc: 'steppingstone',
                tile: PLACED.steppingstone!,
                reasons: [`lands off walkable land at (155, 100) (${lineOf('p_telejump(loc_coord)')})`],
            },
        ]);
    });

    test("a move on a connector row's loc tile and op is refused as a duplicate", () => {
        const withLadder = derive([{ loc: PLACED.cellarladder!, op: 1 }]);
        expect(withLadder.crossings.some(c => c.act.kind === 'loc-op' && c.act.loc === 'cellarladder')).toBe(false);
        expect(withLadder.duplicates).toEqual(['oploc1,cellarladder cellarladder (170, 100) op1']);
        expect(withLadder.counts.locs.duplicate).toBe(1);
        // Without the connector row it is a row like any other.
        expect(rowsOf('cellarladder')).toHaveLength(1);
    });

    test('a shuffle beside the loc a short walk makes anyway, and a door the door procs open, are no passage', () => {
        expect(rowsOf('shuffle')).toEqual([]);
        expect(rowsOf('testdoor')).toEqual([]);
        expect(out.unsettled.map(u => u.loc)).toEqual([
            'ferrystone',
            'rubblepile',
            'sinkhole',
            'steppingstone',
            'wallgap',
        ]);
    });

    test('the counts: triggers and placed locs by outcome', () => {
        expect(out.counts).toEqual({
            triggers: { door: 1, 'not-a-passage': 2, rows: 6, unsettled: 5 },
            locs: { rows: 6, unsettled: 5, duplicate: 0, door: 1, 'not-a-passage': 2 },
        });
    });
});

describe('walksTo', () => {
    const canStep = collision.canStep;
    test('a tile a walk as short as the distance and two steps more reaches', () => {
        expect(walksTo(canStep, at(100, 90), at(104, 90))).toBe(true);
        expect(walksTo(canStep, at(100, 90), at(100, 90))).toBe(true);
    });
    test('not across the river, past the short walk, nor onto another level', () => {
        expect(walksTo(canStep, at(100, 101), at(100, 104))).toBe(false);
        expect(walksTo(canStep, at(100, 90), at(109, 90))).toBe(false);
        expect(walksTo(canStep, at(100, 90), at(100, 90, 1))).toBe(false);
    });
});
