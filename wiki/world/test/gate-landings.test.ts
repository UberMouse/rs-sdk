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
import { parseCallables, parseTriggers } from '../sources/triggers';
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

[proc,climb_ladder](coord $coord, boolean $up)
p_delay(0);
p_telejump($coord);

[proc,step_through](coord $from, coord $to)(coord)
return(movecoord($to, 1, 0, 0));

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
    constants: collectConstants([['quest.constant', '^cook_complete = 3']]),
    quests: [quest],
    loadoutProcs: {},
    names: new Set(['machete', 'guard']),
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

    test('a swap for a loc that does not block, then a landing a value proc computes: opens', () => {
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
            'source',
            'notes',
        ]);
    });
});
