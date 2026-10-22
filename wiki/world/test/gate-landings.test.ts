// Where a gated move on an object lands (sources/gate-landings.ts), on scripted triggers: one per outcome
// (`to`, `landings`, `opens`, underived), and the paths whose moves are never used (a refused check, a
// failed roll, another of the trigger's moves).
import { describe, expect, test } from 'bun:test';
import { locSizes, type LocReach } from '../place';
import type { ConnectorCollision } from '../sources/connectors';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { deriveGateLandings, type GateLandings } from '../sources/gate-landings';
import { scanGates, type GateScanInput } from '../sources/gate-scan';
import { coordTile } from '../sources/runescript';
import { parseCallables, parseQueues, parseTriggers } from '../sources/triggers';
import type { Gate, Quest, Tile } from '../types';

const SCRIPT = `[oploc1,guildladder]
if (stat(mining) < 60) {
    p_telejump(movecoord(coord, 0, 0, -1));
    return;
}
~climb_ladder(movecoord(coord, 0, 0, 6400), true);

[oploc1,rockpile]
if (stat(agility) < 15) {
    return;
}
@rock_climb;

[label,rock_climb]
def_coord $end = movecoord(loc_coord, -1, 0, 0);
if (coordx(coord) < coordx(loc_coord)) {
    $end = movecoord(loc_coord, 1, 0, 0);
}
if (stat_random(agility, 100, 200) = false) {
    p_telejump(movecoord(coord, 0, 0, -3));
    return;
}
p_exactmove(coord, $end, 0, 30, 0);

[oploc1,battlement]
if (%market_bits < 2) {
    if (npc_find(coord, guard, 7, 0) = true) {
        p_teleport(0_50_50_9_9);
    }
    return;
}
p_exactmove(coord, movecoord(loc_coord, 1, 0, 0), 0, 30, 0);

[oploc1,shed]
if (%cookquest < ^cook_complete) {
    p_telejump(0_50_50_1_1);
    return;
}
p_telejump(0_50_50_5_5);

[oploc1,oneside]
if (coordx(coord) > coordx(loc_coord)) {
    mes("You can't reach it from here.");
    return;
}
p_telejump(0_50_50_6_6);

[oploc1,bush]
if (inv_total(inv, machete) = 0) {
    return;
}
loc_change(loc_param(next_loc_stage), 50);
p_teleport(~step_through(coord, loc_coord));

[oploc1,bush2]
if (inv_total(inv, machete) = 0) {
    return;
}
loc_change(loc_param(next_loc_stage), 50);
p_teleport(~step_through(coord, loc_coord));

[oploc1,trapdoor]
if (stat(agility) < 5) {
    return;
}
p_telejump(map_findsquare(0_50_50_1_1, 1, 1, 0));

[oploc1,logbalance]
if (stat(agility) < 20) {
    return;
}
~forcewalk(movecoord(coord, 4, 0, 0));

[oploc1,bars]
if (stat(agility) < 10) {
    return;
}
~forcewalk(movecoord(loc_coord, 0, 0, 3));

[oploc1,steppingstone]
if (stat(agility) < 30) {
    return;
}
if (stat_random(agility, 50, 150) = false) {
    p_delay(1);
    p_telejump(0_50_50_2_2);
    return;
}
p_telejump(0_50_50_3_3);

[oploc1,passgate]
if (coordz(coord) <= coordz(loc_coord)) {
    p_telejump(movecoord(coord, 0, 0, 3));
    return;
}
if (inv_total(inv, pass_ticket) < 1) {
    mes("You need a ticket.");
    return;
}
inv_del(inv, pass_ticket, 1);
queue(passgate_enter, 0, 0);
mes("In you go.");

[oploc1,lowwall]
if (coordz(coord) > coordz(loc_coord)) {
    mes("You can't climb the wall from this side.");
    return;
}
if (stat(agility) < 5) {
    return;
}
p_telejump(movecoord(coord, 0, 0, 2));

[oploc1,turnstile]
if (coordx(coord) < coordx(loc_coord)) {
    p_telejump(0_50_50_9_9);
    return;
}
if (inv_total(inv, coins) < 5) {
    return;
}
inv_del(inv, coins, 5);
p_telejump(0_50_50_9_9);

[oploc1,plank]
if (%plank_fixed = 0) {
    mes("The plank is broken.");
    return;
}
p_telejump(0_50_50_4_4);

[oploc1,guardgate]
if (coordx(coord) < coordx(loc_coord)) {
    if (npc_find(coord, guard, 5, 0) = true) {
        return;
    }
    p_telejump(movecoord(coord, 3, 0, 0));
    return;
}
if (stat(agility) < 5) {
    return;
}
p_telejump(movecoord(coord, -3, 0, 0));

[oploc1,pipe]
if (coordx(coord) < coordx(loc_coord)) {
    if (%pipe_used >= map_clock) {
        mes("The pipe is being used.");
        return;
    }
    %pipe_used = calc(map_clock + 4);
    p_telejump(movecoord(coord, 3, 0, 0));
    return;
}
if (stat(agility) < 5) {
    return;
}
p_telejump(movecoord(coord, -3, 0, 0));

[oploc1,pipe2]
if (coordx(coord) < coordx(loc_coord)) {
    if (map_clock <= %pipe_used) {
        return;
    }
    p_telejump(movecoord(coord, 3, 0, 0));
    return;
}
if (stat(agility) < 5) {
    return;
}
p_telejump(movecoord(coord, -3, 0, 0));

[oploc1,longgate]
if (stat(agility) < 5) {
    return;
}
longqueue(queue_jump, 0, 0_50_50_12_12, 0);

[oploc1,longstargate]
if (stat(agility) < 5) {
    return;
}
longqueue*(queue_jump2, 0, 0)(0_50_50_13_13, 1);

[oploc1,stronggate]
if (stat(agility) < 5) {
    return;
}
strongqueue(queue_jump, 0, 0_50_50_14_14);

[oploc1,stargate]
if (stat(agility) < 5) {
    return;
}
queue*(queue_jump2, 0)(0_50_50_15_15, 1);

[oploc1,rubble]
if (stat(agility) < 5) {
    return;
}
queue(clear_rubble, 0, 0);

[queue,queue_jump](coord $to)
p_telejump($to);

[queue,queue_jump2](coord $to, int $n)
p_telejump($to);

[queue,clear_rubble]
if (loc_find(coord, rubble) = true) {
    loc_del(50);
}
p_telejump(map_findsquare(0_50_50_2_2, 1, 1, 0));

[queue,passgate_enter]
p_teleport(0_1_1_20_40);
p_telejump(movecoord(coord, 0, 0, -3));

[oploc1,lastword]
if (stat(agility) < 5) {
    return;
}
queue(lastword_jump, 0, 0);
p_telejump(0_50_50_7_7);

[queue,lastword_jump]
p_telejump(0_50_50_8_8);

[oploc1,brokenfence]
if (stat(agility) < 5) {
    return;
}
def_coord $end = movecoord(loc_coord, 0, 0, -1);
if (coordz(coord) < coordz(loc_coord)) {
    $end = loc_coord;
}
p_exactmove(coord, $end, 0, 30, 0);

[proc,climb_ladder](coord $coord, boolean $up)
p_delay(0);
p_telejump($coord);

[proc,step_through](coord $from, coord $to)(coord)
return(movecoord($to, %step_dx, 0, 0));

[oploc1,squareladder]
if (stat(mining) < 5) {
    return;
}
p_telejump(~setcoord_mapsquare(coord, 2, 0, 3));

[proc,setcoord_mapsquare](coord $coord, int $mapx, int $mapy, int $mapz)(coord)
def_int $relx = modulo(coordx($coord), 64);
def_int $relz = modulo(coordz($coord), 64);
return(movecoord(0_0_0_0_0, add(multiply($mapx, 64), $relx), $mapy, add(multiply($mapz, 64), $relz)));

[proc,forcewalk](coord $dest)
~walk(calc(coordx($dest) - coordx(coord)), calc(coordz($dest) - coordz(coord)));

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
~walk(calc($dx - $mx), calc($dz - $mz));
`;
const FILE = 'quests/test.rs2';
/** `file:line` of the first line of SCRIPT holding `needle`, from the line holding `after` on. */
const lineOf = (needle: string, after = ''): string => {
    const lines = SCRIPT.split('\n');
    const from = lines.findIndex(l => l.includes(after));
    return `${FILE}:${lines.findIndex((l, i) => i >= from && l.includes(needle)) + 1}`;
};

const quest: Quest = { id: 'cook', varp: 'cookquest', varpId: 1, complete: 3, stages: {}, source: '' };
const scan: GateScanInput = {
    triggers: parseTriggers(FILE, SCRIPT),
    callables: parseCallables(FILE, SCRIPT),
    queues: parseQueues(FILE, SCRIPT),
    constants: collectConstants([['quest.constant', '^cook_complete = 3']]),
    quests: [quest],
    loadoutProcs: {},
    names: new Set(['machete', 'guard', 'pass_ticket']),
};
const locConfigs = parseConfigs(
    [
        '[guildladder]',
        '[rockpile]',
        '[battlement]',
        '[shed]',
        '[oneside]',
        '[bush]\nparam=next_loc_stage,bush_cut',
        '[bush_cut]\nblockwalk=no',
        '[bush2]\nparam=next_loc_stage,bush_grown',
        '[bush_grown]',
        '[trapdoor]',
        '[logbalance]',
        '[bars]',
        '[steppingstone]',
        '[passgate]',
        '[lastword]',
        '[lowwall]',
        '[turnstile]',
        '[plank]',
        '[guardgate]',
        '[pipe]',
        '[pipe2]',
        '[longgate]',
        '[longstargate]',
        '[stronggate]',
        '[stargate]',
        '[rubble]',
        '[squareladder]',
        '[brokenfence]',
    ].join('\n'),
);

const at = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const key = (t: Tile): string => `${t.level},${t.x},${t.z}`;
/** A gate row on a 1x1 object (shape 10) at (x, 100), as placeGates writes one. */
const row = (config: string, x: number, requires: string[][], more: Partial<Gate> = {}): Gate => ({
    trigger: `oploc1,${config}`,
    kind: 'gate',
    loc: config,
    tile: at(x, 100),
    shape: 10,
    angle: 0,
    requires,
    source: `${FILE}:1`,
    ...more,
});

/**
 * Every tile walkable and on land but the blocked (and, for `land`, the offLand) ones; a loc is reached
 * from a tile sharing an edge with it, as connectors.test.ts's stub.
 */
function stub(blocked: Tile[], offLand: Tile[] = []): ConnectorCollision {
    const closed = new Set(blocked.map(key));
    const sea = new Set(offLand.map(key));
    return {
        walkable: (level, x, z) => !closed.has(key(at(x, z, level))),
        land: (level, x, z) => !sea.has(key(at(x, z, level))),
        reached: (from: Tile, l: LocReach) => Math.abs(from.x - l.x) + Math.abs(from.z - l.z) === 1,
    };
}

/** The four tiles sharing an edge with (x, 100), sorted as the rows write stands. */
const around = (x: number): Tile[] => [at(x - 1, 100), at(x, 99), at(x, 101), at(x + 1, 100)];

const derive = (gates: Gate[], blocked: Tile[] = [], offLand: Tile[] = []): GateLandings =>
    deriveGateLandings({
        gates,
        scan,
        candidates: scanGates(scan),
        locConfigs,
        // Each loc's own tile blocks.
        collision: stub([...gates.map(g => g.tile), ...blocked], offLand),
        size: locSizes(locConfigs),
    });
const one = (gate: Gate, blocked: Tile[] = [], offLand: Tile[] = []) => {
    const out = derive([gate], blocked, offLand);
    return { gate: out.gates[0]!, out };
};

describe('deriveGateLandings: one outcome per row', () => {
    test("a jump the player's tile shifts: landings, one per stand", () => {
        const { gate, out } = one(row('guildladder', 100, [['skill:mining:60']]));
        expect(gate.landings).toEqual(around(100).map(stand => ({ stand, landing: { ...stand, z: stand.z + 6400 } })));
        expect(gate.to).toBeUndefined();
        expect(out.counts).toEqual({ to: 0, landings: 1, opens: 0, underived: 0, windows: 0 });
    });

    test('a move on a path the check refuses is never used: the refused climber steps back, -1, not a landing', () => {
        const { gate } = one(row('guildladder', 100, [['skill:mining:60']]));
        expect(gate.landings!.some(l => l.landing.z === l.stand.z - 1)).toBe(false);
    });

    test('a landing picked by the side the player stands on, through a label: landings, across the loc', () => {
        const { gate } = one(row('rockpile', 110, [['skill:agility:15']]));
        expect(gate.landings).toEqual([
            { stand: at(109, 100), landing: at(111, 100) },
            { stand: at(110, 99), landing: at(109, 100) },
            { stand: at(110, 101), landing: at(109, 100) },
            { stand: at(111, 100), landing: at(109, 100) },
        ]);
    });

    test('a failed stat_random roll (a fall) is not the move', () => {
        const { gate } = one(row('rockpile', 110, [['skill:agility:15']]));
        expect(gate.landings!.some(l => l.landing.z === l.stand.z - 3)).toBe(false);
    });

    test('one tile from every stand: to', () => {
        // The trigger's only moves are coord literals, so the row stands for all of them; the one on the
        // refused path (the quest not done) is left out.
        const { gate, out } = one(row('shed', 130, [['quest:cook']]));
        expect(gate.to).toEqual(coordTile('0_50_50_5_5'));
        expect(gate.landings).toBeUndefined();
        expect(out.counts.to).toBe(1);
    });

    test("only the row's move: the scan's crossing, not the trigger's teleport elsewhere", () => {
        // A refusal the bound run can't read (a varp no quest has) moves the player to a fixed tile: that
        // is another of the trigger's moves, not the crossing the row stands for.
        const { gate } = one(row('battlement', 120, [['other:market guard satisfied']]));
        expect(gate.to).toEqual(at(121, 100));
    });

    test('a walk the player steps from their own tile, every stand ending on one tile: to', () => {
        const { gate } = one(row('bars', 180, [['skill:agility:10']]));
        expect(gate.to).toEqual(at(180, 103));
    });

    test('a proc that calls itself with known values walks to its end', () => {
        const { gate } = one(row('logbalance', 170, [['skill:agility:20']]));
        expect(gate.landings).toEqual(around(170).map(stand => ({ stand, landing: { ...stand, x: stand.x + 4 } })));
    });

    test('a proc that only sets locals and returns a value gives it: a jump to the same tile of another mapsquare', () => {
        // As the Haunted Mine's ladders (general/scripts/misc/coord_procs.rs2:253): each stand's own tile, moved to
        // mapsquare (2, 3).
        const { gate } = one(row('squareladder', 190, [['skill:mining:5']]));
        expect(gate.landings).toEqual(
            around(190).map(stand => ({
                stand,
                landing: { level: 0, x: 128 + (stand.x % 64), z: 192 + (stand.z % 64) },
            })),
        );
    });

    test('a swap for a loc that does not block, then a landing a value proc computes from a var: opens', () => {
        const { gate, out } = one(row('bush', 140, [['item:machete:held']]));
        expect(gate.opens).toBe(true);
        expect(gate.to).toBeUndefined();
        expect(gate.landings).toBeUndefined();
        expect(out.counts.opens).toBe(1);
    });

    test('a swap for a loc that blocks opens nothing: underived, with the construct and its line', () => {
        const { gate, out } = one(row('bush2', 150, [['item:machete:held']]));
        expect(gate.opens).toBeUndefined();
        expect(out.underived).toEqual([
            {
                trigger: 'oploc1,bush2',
                loc: 'bush2',
                tile: at(150, 100),
                reasons: [
                    `\`p_teleport(~step_through(coord, loc_coord))\` (${lineOf('p_teleport(~step_through', '[oploc1,bush2]')}): \`~step_through(coord, loc_coord)\` is not known offline`,
                ],
            },
        ]);
    });

    test('a landing the engine finds at run time (map_findsquare): underived, never guessed', () => {
        const { gate, out } = one(row('trapdoor', 160, [['skill:agility:5']]));
        expect([gate.to, gate.landings, gate.opens]).toEqual([undefined, undefined, undefined]);
        expect(out.underived[0]!.reasons).toEqual([
            `\`p_telejump(map_findsquare(0_50_50_1_1, 1, 1, 0))\` (${lineOf('map_findsquare')}): \`map_findsquare(0_50_50_1_1, 1, 1, 0)\` is not known offline`,
        ]);
        expect(out.counts.underived).toBe(1);
    });
});

describe('deriveGateLandings: stands and landings', () => {
    test('a landing off walkable land is left out of the row and reported with its stand', () => {
        const sea = at(99, 6500);
        const { gate, out } = one(row('guildladder', 100, [['skill:mining:60']]), [], [sea]);
        expect(gate.landings!.map(l => l.stand)).toEqual(around(100).slice(1));
        expect(out.offLand).toEqual([
            {
                trigger: 'oploc1,guildladder',
                loc: 'guildladder',
                tile: at(100, 100),
                stand: at(99, 100),
                landing: sea,
                at: lineOf('p_telejump($coord)'),
            },
        ]);
    });

    test("a move onto the loc's own tile lands on the tiles a step from it goes to, reported; with no steps, off land", () => {
        // From the south the fence's climb ends on the fence, which blocks its tile; from any other side, south of it.
        const fence = row('brokenfence', 300, [['skill:agility:5']]);
        const stepping = { ...stub([fence.tile]), canStep: () => true };
        const out = deriveGateLandings({
            gates: [fence],
            scan,
            candidates: scanGates(scan),
            locConfigs,
            collision: stepping,
            size: locSizes(locConfigs),
        });
        const off = [-1, 0, 1].flatMap(dx => [-1, 0, 1].flatMap(dz => (dx || dz ? [at(300 + dx, 100 + dz)] : [])));
        const landings = out.gates[0]!.landings!;
        expect(landings.filter(l => l.stand.z === 99).map(l => l.landing)).toEqual(off);
        expect(landings.filter(l => l.stand.z !== 99).map(l => l.landing)).toEqual([
            at(300, 99),
            at(300, 99),
            at(300, 99),
        ]);
        expect(out.stepped).toEqual([
            {
                trigger: 'oploc1,brokenfence',
                loc: 'brokenfence',
                tile: at(300, 100),
                stand: at(300, 99),
                landing: at(300, 100),
                to: off,
            },
        ]);
        expect(out.offLand).toEqual([]);
        // Without the step test, the fence's tile is a landing off walkable land, as before.
        const { out: flat } = one(fence);
        expect(flat.stepped).toEqual([]);
        expect(flat.offLand.map(o => o.landing)).toEqual([at(300, 100)]);
    });

    test('a stand that gives no landing makes the row landings, not to, and is reported', () => {
        // Two stands, west and east: the east one is refused (no path moves), the west one jumps.
        const { gate, out } = one(row('oneside', 190, []), [at(190, 99), at(190, 101)]);
        expect(gate.to).toBeUndefined();
        expect(gate.landings).toEqual([{ stand: at(189, 100), landing: coordTile('0_50_50_6_6') }]);
        expect(out.unlanded).toEqual([
            {
                trigger: 'oploc1,oneside',
                loc: 'oneside',
                tile: at(190, 100),
                stand: at(191, 100),
                reasons: ['no path an account meeting its requirements takes moves the player'],
            },
        ]);
        expect(out.counts.landings).toBe(1);
    });

    test('one tile off land from every stand writes no to: each stand is reported and the row is underived', () => {
        const sea = coordTile('0_50_50_5_5');
        const { gate, out } = one(row('shed', 130, [['quest:cook']]), [], [sea]);
        expect(gate.to).toBeUndefined();
        expect(out.offLand.map(o => [o.stand, o.landing])).toEqual(around(130).map(stand => [stand, sea]));
        expect(out.underived.map(u => u.reasons)).toEqual([['every landing is off walkable land']]);
        expect(out.counts).toEqual({ to: 0, landings: 0, opens: 0, underived: 1, windows: 0 });
    });

    test('a loc every tile around which blocks still opens, from the tiles it is used from once they open', () => {
        const ring = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => at(140 + dx, 100 + dz)));
        const { gate } = one(row('bush', 140, [['item:machete:held']]), ring);
        expect(gate.opens).toBe(true);
    });

    test('but gives no landing from them: a blocked-in ladder is underived', () => {
        const ring = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dz => at(100 + dx, 100 + dz)));
        const { gate, out } = one(row('guildladder', 100, [['skill:mining:60']]), ring);
        expect(gate.landings).toBeUndefined();
        expect(out.underived[0]!.reasons).toEqual(['no tile on land reaches the loc']);
    });

    test('walls, rows with a to and quest windows are left as they are; windows are counted', () => {
        const wall = row('guildladder', 100, [['skill:mining:60']], { shape: 0 });
        const jump = row('guildladder', 110, [['skill:mining:60']], { to: at(1, 1) });
        const window = row('guildladder', 120, [], { kind: 'quest-window' });
        const out = derive([wall, jump, window]);
        expect(out.gates).toEqual([wall, jump, window]);
        expect(out.counts).toEqual({ to: 0, landings: 0, opens: 0, underived: 0, windows: 1 });
    });

    test('a written row keeps the field order of placeGates, the outcome before source and notes', () => {
        const { gate } = one(row('shed', 130, [['quest:cook']], { from: 'west', notes: 'n' }));
        expect(Object.keys(gate)).toEqual([
            'trigger',
            'kind',
            'loc',
            'tile',
            'shape',
            'angle',
            'requires',
            'from',
            'to',
            'ticks',
            'standTicks',
            'source',
            'notes',
        ]);
    });
});

describe('deriveGateLandings: rolls', () => {
    test("a gated move behind a roll gets it after its source: the failure's ticks and the tile it leaves the player on", () => {
        const { gate, out } = one(row('steppingstone', 200, [['skill:agility:30']], { to: coordTile('0_50_50_3_3') }));
        expect(gate.roll).toEqual({
            stat: 'agility',
            low: 50,
            high: 150,
            source: lineOf('stat_random(agility, 50, 150)'),
            fail: { ticks: 2, to: coordTile('0_50_50_2_2'), damage: 0, hpDamage: { a: 0, b: 1, c: 0 } },
        });
        expect(Object.keys(gate).slice(-2)).toEqual(['source', 'roll']);
        expect(out.rolled).toBe(1);
        expect(out.unrolled).toEqual([]);
    });

    test("a failure that leaves each stand on a tile of its own can't be one roll: reported, the row left without one", () => {
        const { gate, out } = one(row('rockpile', 110, [['skill:agility:15']]));
        expect(gate.roll).toBeUndefined();
        expect(out.unrolled).toEqual([
            {
                trigger: 'oploc1,rockpile',
                loc: 'rockpile',
                tile: at(110, 100),
                reasons: ['the stands give different rolls or failure tiles'],
            },
        ]);
    });

    test('a row with no skill requirement is not run for a roll', () => {
        const { gate, out } = one(row('shed', 130, [['quest:cook']]));
        expect(gate.roll).toBeUndefined();
        expect(out.rolled + out.unrolled.length).toBe(0);
    });
});

describe('deriveGateLandings: free landings', () => {
    test('a stand level with the loc that the script gates stays checked: no landing is free', () => {
        const { gate } = one(row('lowwall', 230, [['skill:agility:5']], { from: 'south' }));
        expect(gate.landings).toEqual([
            { stand: at(229, 100), landing: at(229, 102) },
            { stand: at(230, 99), landing: at(230, 101) },
            { stand: at(231, 100), landing: at(231, 102) },
        ]);
    });

    test('one tile from every stand, but free from some: landings, not to, so the free stands can say so', () => {
        const { gate, out } = one(row('turnstile', 240, [['coins:5']]));
        const turnstile = coordTile('0_50_50_9_9');
        expect(gate.to).toBeUndefined();
        expect(gate.landings).toEqual(
            around(240).map(stand => ({ stand, landing: turnstile, ...(stand.x < 240 ? { free: true } : {}) })),
        );
        expect(out.counts.landings).toBe(1);
    });

    test('a row every landing of which is free marks none: the bound run reads none of its requirement', () => {
        // The pass gate's level and south stands step out free and nothing else lands; but for the gated north
        // stand, every stand's landing is free.
        const { gate } = one(row('passgate', 250, [['consume:pass_ticket:1']], { from: 'north' }), [at(250, 101)]);
        expect(gate.landings).toEqual([
            { stand: at(249, 100), landing: at(249, 103) },
            { stand: at(250, 99), landing: at(250, 102) },
            { stand: at(251, 100), landing: at(251, 103) },
        ]);
    });

    test('a condition the bound run cannot read gates the move: a path past it is not free', () => {
        // The plank's varp is no quest's, so the bound run reads it as nothing it can settle: every stand lands,
        // none free.
        const { gate } = one(row('plank', 255, [['other:%plank_fixed = 1']]));
        expect(gate.to).toEqual(coordTile('0_50_50_4_4'));
        expect(gate.landings).toBeUndefined();
        // From the west the guard gate asks only that no guard is near: an npc the run can't see, so that stand's
        // landing is no freer than the others', which need Agility.
        const guard = one(row('guardgate', 280, [['skill:agility:5']]));
        expect(guard.gate.landings?.filter(l => l.free)).toEqual([]);
        expect(guard.gate.landings?.find(l => l.stand.x === 279)).toEqual({
            stand: at(279, 100),
            landing: at(282, 100),
        });
        expect(guard.out.waited).toEqual([]);
    });

    test('a pipe in use a moment ago is a wait: its stand lands free, and the build lists it', () => {
        // `%pipe_used >= map_clock` taken false, and `map_clock <= %pipe_used` taken false, hold once the clock
        // passes the var.
        for (const [config, x] of [
            ['pipe', 290],
            ['pipe2', 300],
        ] as const) {
            const { gate, out } = one(row(config, x, [['skill:agility:5']]));
            expect(gate.landings?.filter(l => l.free)).toEqual([
                { stand: at(x - 1, 100), landing: at(x + 2, 100), free: true },
            ]);
            const text = config === 'pipe' ? '%pipe_used >= map_clock' : 'map_clock <= %pipe_used';
            expect(out.waited).toEqual([
                {
                    trigger: `oploc1,${config}`,
                    loc: config,
                    tile: at(x, 100),
                    stand: at(x - 1, 100),
                    landing: at(x + 2, 100),
                    waits: [`\`${text}\` (${lineOf(text)})`],
                },
            ]);
        }
    });
});

describe('deriveGateLandings: a move the trigger queues', () => {
    test('behind a check and an obj taken before the queue: from the gated side it lands where the queued script ends', () => {
        // The queued script jumps to its literal, then steps three south of it: a step from the player's tile,
        // which the scan reads as the crossing the row stands for. From the south the trigger steps out free.
        const inside = { ...coordTile('0_1_1_20_40'), z: coordTile('0_1_1_20_40').z - 3 };
        // The stands level with the gate, which `from: north` takes for the gated side, step out free.
        const { gate } = one(row('passgate', 210, [['consume:pass_ticket:1']], { from: 'north' }));
        expect(gate.landings).toEqual([
            { stand: at(209, 100), landing: at(209, 103), free: true },
            { stand: at(210, 99), landing: at(210, 102), free: true },
            { stand: at(210, 101), landing: inside },
            { stand: at(211, 100), landing: at(211, 103), free: true },
        ]);
    });

    test("each queue form's arguments are the queued script's: a long queue's logout action, and a `*` form's own list", () => {
        // longqueue(name, delay, arg, logout), longqueue*(name, delay, logout)(args), strongqueue(name, delay, arg),
        // queue*(name, delay)(args) (Player.ts processQueue drops a long queue's logout action before the script).
        const forms: [string, string][] = [
            ['longgate', '0_50_50_12_12'],
            ['longstargate', '0_50_50_13_13'],
            ['stronggate', '0_50_50_14_14'],
            ['stargate', '0_50_50_15_15'],
        ];
        for (const [config, to] of forms) {
            const { gate } = one(row(config, 260, [['skill:agility:5']]));
            expect(gate.to).toEqual(coordTile(to));
        }
    });

    test("a queued script's loc command leaves the trigger's loc alone: it runs with no active loc", () => {
        // [queue,clear_rubble] deletes the loc it finds, not the rubble its trigger was on: no opens, and its move
        // to a tile the engine finds at run time is underived.
        const { gate, out } = one(row('rubble', 270, [['skill:agility:5']]));
        expect(gate.opens).toBeUndefined();
        expect(out.underived.map(u => u.reasons)).toEqual([
            [
                `\`p_telejump(map_findsquare(0_50_50_2_2, 1, 1, 0))\` (${lineOf('map_findsquare(0_50_50_2_2')}): \`map_findsquare(0_50_50_2_2, 1, 1, 0)\` is not known offline`,
            ],
        ]);
    });

    test('the queued script runs once the trigger has ended, so its move is the landing, not the move after the queue', () => {
        const { gate } = one(row('lastword', 220, [['skill:agility:5']]));
        expect(gate.to).toEqual(coordTile('0_50_50_8_8'));
    });
});
