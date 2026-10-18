import { describe, expect, test } from 'bun:test';
import { locSizes, type LocReach } from '../place';
import { fillReach, formatReach, MAX_SETS, wallTiles, type ReachCollision, type ReachInput } from '../reach';
import type { Connector, Feature, Gate, Tile, Transport } from '../types';

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const key = (l: number, x: number, z: number) => `${l} ${x} ${z}`;

/**
 * A 32x32 world at x, z 3200-3231 on levels 0 and 1 (16 zones each), and a column of zones at x 3232-3239
 * the walker allocates but the data does not list (as sdk/pathfinding.ts's mainland fill): walkable, not land.
 * Walls sit on the edge between two tiles; a blocked tile can't be stood on; steps follow rsmod's rule (a
 * diagonal needs both orthogonal steps open).
 */
class Grid implements ReachCollision {
    readonly zones: [number, number, number][] = [];
    private readonly blocked = new Set<string>();
    private readonly walls = new Set<string>();

    constructor() {
        for (const level of [0, 1])
            for (let x = 3200; x < 3232; x += 8) for (let z = 3200; z < 3232; z += 8) this.zones.push([level, x, z]);
    }

    private inData = (l: number, x: number, z: number) =>
        (l === 0 || l === 1) && x >= 3200 && x < 3232 && z >= 3200 && z < 3232;
    private allocated = (l: number, x: number, z: number) => this.inData(l, x, z) || (l === 0 && x >= 3232 && x < 3240);

    block(...tiles: Tile[]): this {
        for (const t of tiles) this.blocked.add(key(t.level, t.x, t.z));
        return this;
    }
    /** A wall between `t` and its neighbour by (dx, dz). */
    wall(t: Tile, dx: number, dz: number): this {
        this.walls.add(`${key(t.level, t.x, t.z)} ${dx} ${dz}`);
        this.walls.add(`${key(t.level, t.x + dx, t.z + dz)} ${-dx} ${-dz}`);
        return this;
    }
    /** A wall along the west edge of column x, from z1 to z2, but for the gaps. */
    wallColumn(x: number, z1: number, z2: number, gaps: number[] = []): this {
        for (let z = z1; z <= z2; z++) if (!gaps.includes(z)) this.wall(at(0, x, z), -1, 0);
        return this;
    }
    /** Walls all round the box (x1, z1)-(x2, z2) on level 0. */
    room(x1: number, z1: number, x2: number, z2: number): this {
        for (let x = x1; x <= x2; x++) this.wall(at(0, x, z1), 0, -1).wall(at(0, x, z2), 0, 1);
        for (let z = z1; z <= z2; z++) this.wall(at(0, x1, z), -1, 0).wall(at(0, x2, z), 1, 0);
        return this;
    }

    walkable = (l: number, x: number, z: number) => this.allocated(l, x, z) && !this.blocked.has(key(l, x, z));
    land = (l: number, x: number, z: number) => this.inData(l, x, z);
    private open = (l: number, x: number, z: number, dx: number, dz: number) =>
        this.walkable(l, x + dx, z + dz) && !this.walls.has(`${key(l, x, z)} ${dx} ${dz}`);
    canStep = (l: number, x: number, z: number, dx: number, dz: number): boolean => {
        if (!dx || !dz) return this.open(l, x, z, dx, dz);
        return (
            this.open(l, x, z, dx, 0) &&
            this.open(l, x, z, 0, dz) &&
            this.open(l, x + dx, z, 0, dz) &&
            this.open(l, x, z + dz, dx, 0)
        );
    };
    /** A wall is used from its two tiles (place.ts's reach test); any other loc from a tile sharing an edge. */
    reached = (from: Tile, l: LocReach): boolean => {
        if (l.shape === 0) {
            const [a, b] = wallTiles({ tile: l, shape: 0, angle: l.rotation })!;
            return [a, b].some(t => t.x === from.x && t.z === from.z);
        }
        const [w, len] = l.rotation % 2 === 1 ? [l.length, l.width] : [l.width, l.length];
        const dx = from.x < l.x ? l.x - from.x : from.x > l.x + w - 1 ? from.x - (l.x + w - 1) : 0;
        const dz = from.z < l.z ? l.z - from.z : from.z > l.z + len - 1 ? from.z - (l.z + len - 1) : 0;
        return dx + dz === 1;
    };
    edited = <T>(edits: Parameters<ReachCollision['edited']>[0], f: () => T): T => {
        const added: string[] = [];
        const cleared: string[] = [];
        for (const { tile, shape, angle } of edits.close) {
            const [a, b] = wallTiles({ tile, shape, angle })!;
            const edge = `${key(a.level, a.x, a.z)} ${b.x - a.x} ${b.z - a.z}`;
            if (shape !== 0 || this.walls.has(edge)) continue;
            this.wall(a, b.x - a.x, b.z - a.z);
            added.push(edge, `${key(b.level, b.x, b.z)} ${a.x - b.x} ${a.z - b.z}`);
        }
        for (const { tile, width, length } of edits.open)
            for (let x = tile.x; x < tile.x + width; x++)
                for (let z = tile.z; z < tile.z + length; z++)
                    if (this.blocked.delete(key(tile.level, x, z))) cleared.push(key(tile.level, x, z));
        try {
            return f();
        } finally {
            for (const e of added) this.walls.delete(e);
            for (const t of cleared) this.blocked.add(t);
        }
    };
}

const START = at(0, 3200, 3200);
const size = locSizes(new Map());

const fill = (grid: Grid, world: Partial<ReachInput['world']> = {}, more: Partial<ReachInput> = {}) =>
    fillReach({
        world: { features: [], connectors: [], gates: [], transports: [], ...world },
        collision: grid,
        size,
        start: START,
        ...more,
    });

const gate = (g: Partial<Gate> & Pick<Gate, 'tile'>): Gate => ({
    trigger: 'oploc1,door',
    kind: 'gate',
    loc: 'door',
    shape: 0,
    angle: 0,
    requires: [[]],
    source: 't.rs2:1',
    ...g,
});

const feature = (config: string, tile: Tile): Feature => ({
    source: 'loc',
    id: 1,
    config,
    tile,
    shape: 10,
    rotation: 0,
    kind: 'connector',
    subtype: '',
    name: config,
});

const connector = (c: Partial<Connector> & Pick<Connector, 'loc' | 'landing'>): Connector => ({
    feature: 0,
    op: 1,
    opName: 'Climb-up',
    direction: 'up',
    stand: null,
    source: 'ladders.rs2:1',
    ...c,
});

const transport = (t: Partial<Transport> & Pick<Transport, 'from' | 'to'>): Transport => ({
    kind: 'ship',
    npc: 'sailor',
    fare: 0,
    requires: [],
    source: 'sail.rs2:1',
    ...t,
});

/** A wall down the west edge of column 3216, whole but for a gap at z 3220: east of it is (3220, 3220). */
const split = () => new Grid().wallColumn(3216, 3200, 3231, [3220]);
const EAST = at(0, 3225, 3220);
const WEST = at(0, 3205, 3220);
/** The door in that gap: its loc tile is (3216, 3220), its far tile (3215, 3220). */
const DOOR = at(0, 3216, 3220);

/** The door in the gap, gated from side `from`. */
const sided = (from: Gate['from']) => [gate({ tile: DOOR, requires: [['skill:agility:5']], from })];
/** A sealed room at (3220-3222, 3220-3222), INNER its middle, and a door in its west wall at z. */
const sealed = () => new Grid().room(3220, 3220, 3222, 3222);
const INNER = at(0, 3221, 3221);
const westDoor = (z: number, requires: string[][]) => gate({ tile: at(0, 3220, z), requires });

describe('walking', () => {
    test('an open walk reaches every tile of the land with no requirement', () => {
        const reach = fill(new Grid());
        expect(reach.setsAt(at(0, 3231, 3231))).toEqual([[]]);
        expect(reach.report).toMatchObject({ nodes: 2048, reached: 1024, free: 1024, byLevel: [1024, 0, 0, 0] });
        expect(reach.report.sets).toBe(1);
    });

    test('tiles the walker allocates but the data does not list are not land: never entered, counted', () => {
        const reach = fill(new Grid());
        expect(reach.setsAt(at(0, 3232, 3210))).toEqual([]);
        // The column of 32 tiles east of the land, each a step from a reached tile.
        expect(reach.report.offLand).toBe(32);
    });

    test('a wall blocks a step, and a pocket no step or edge enters is not reached', () => {
        const reach = fill(new Grid().room(3210, 3210, 3212, 3212).block(at(0, 3220, 3200)));
        expect(reach.setsAt(at(0, 3211, 3211))).toEqual([]);
        expect(reach.setsAt(at(0, 3209, 3211))).toEqual([[]]);
        expect(reach.setsAt(at(0, 3220, 3200))).toEqual([]);
        expect(reach.report.reached).toBe(1024 - 9 - 1);
    });

    test('a door the collision has open (no gate names it) is walked through', () => {
        expect(fill(split()).setsAt(EAST)).toEqual([[]]);
        expect(fill(new Grid().wallColumn(3216, 3200, 3231)).setsAt(EAST)).toEqual([]);
    });

    test('the start must be a walkable tile on land', () => {
        expect(() => fill(new Grid().block(START))).toThrow('is not a walkable tile on land');
    });
});

describe('gated doors (wall rows with no `to`)', () => {
    test('are walled again and crossed as an edge carrying the requirement; members is always met', () => {
        const grid = split();
        const reach = fill(grid, { gates: [gate({ tile: DOOR, requires: [['members', 'skill:agility:5']] })] });
        expect(reach.setsAt(EAST)).toEqual([['skill:agility:5']]);
        expect(reach.setsAt(WEST)).toEqual([[]]);
        expect(reach.report.edges.gates).toBe(2);
        // The edit is undone: the door is open again in the collision.
        expect(grid.canStep(0, 3215, 3220, 1, 0)).toBe(true);
    });

    test('any one of several requirement sets crosses it', () => {
        const reach = fill(split(), { gates: [gate({ tile: DOOR, requires: [['coins:10'], ['quest:prince>=100']] })] });
        expect(reach.setsAt(EAST)).toEqual([['coins:10'], ['quest:prince>=100']]);
    });

    test('with `from`, the check applies from that side only; the other way is free', () => {
        // `loc` is the door's own tile (3216, east), `far` the one it opens onto (3215, west).
        expect(fill(split(), { gates: sided('loc') }).setsAt(EAST)).toEqual([[]]);
        expect(fill(split(), { gates: sided('far') }).setsAt(EAST)).toEqual([['skill:agility:5']]);
        expect(fill(split(), { gates: sided('loc') }, { start: EAST }).setsAt(WEST)).toEqual([['skill:agility:5']]);
        // A compass side names the tile on that side: west of the two is the far one here.
        expect(fill(split(), { gates: sided('west') }).setsAt(EAST)).toEqual([['skill:agility:5']]);
        expect(fill(split(), { gates: sided('east') }).setsAt(EAST)).toEqual([[]]);
        // A side the two tiles don't differ on (north, on a wall between west and east) can't free either way.
        expect(fill(split(), { gates: sided('north') }).setsAt(EAST)).toEqual([['skill:agility:5']]);
    });

    test('a quest window is never crossed', () => {
        const reach = fill(split(), { gates: [gate({ tile: DOOR, kind: 'quest-window', requires: [] })] });
        expect(reach.setsAt(EAST)).toEqual([]);
    });

    test('a wall the fill cannot read the sides of is reported and left as the collision has it', () => {
        const reach = fill(split(), { gates: [gate({ tile: DOOR, shape: 1, requires: [['item:key:held']] })] });
        expect(reach.setsAt(EAST)).toEqual([[]]);
        expect(reach.report.skipped).toEqual([
            'oploc1,door door (3216, 3220): a wall of shape 1, whose two sides are not read',
        ]);
    });
});

describe('wallTiles', () => {
    test("a straight wall's own tile, then the one its angle faces (0 west, 1 north, 2 east, 3 south)", () => {
        const t = at(0, 10, 10);
        expect([0, 1, 2, 3].map(angle => wallTiles({ tile: t, shape: 0, angle })![1])).toEqual([
            at(0, 9, 10),
            at(0, 10, 11),
            at(0, 11, 10),
            at(0, 10, 9),
        ]);
    });

    test("a diagonal door's two diagonal neighbours: north-west and south-east at an even angle", () => {
        const t = at(0, 10, 10);
        expect(wallTiles({ tile: t, shape: 9, angle: 0 })).toEqual([at(0, 9, 11), at(0, 11, 9)]);
        expect(wallTiles({ tile: t, shape: 9, angle: 1 })).toEqual([at(0, 11, 11), at(0, 9, 9)]);
        expect(wallTiles({ tile: t, shape: 2, angle: 0 })).toBeUndefined();
    });
});

describe('gate moves on objects', () => {
    // The sealed room, and a rock at (3205, 3210) whose move lands inside it.
    const ROCK = at(0, 3205, 3210);
    const room = () => sealed().block(ROCK);
    const rock = (g: Partial<Gate>) =>
        gate({ trigger: 'oploc1,rock', loc: 'rock', tile: ROCK, shape: 10, requires: [['skill:agility:10']], ...g });

    test('`to` jumps there from every approach tile', () => {
        const reach = fill(room(), { gates: [rock({ to: at(0, 3221, 3222) })] });
        expect(reach.setsAt(INNER)).toEqual([['skill:agility:10']]);
        expect(reach.report.edges.gates).toBe(4);
    });

    test('with `from`, `to` is jumped to from that side only (a stand level with the loc counts as on it)', () => {
        const reach = fill(room(), { gates: [rock({ to: at(0, 3221, 3222), from: 'north' })] });
        expect(reach.setsAt(INNER)).toEqual([['skill:agility:10']]);
        // North, west and east of the rock; not south.
        expect(reach.report.edges.gates).toBe(3);
    });

    test('with `from`, a stand of `landings` strictly on the other side lands free', () => {
        const landing = at(0, 3221, 3222);
        const reach = fill(room(), {
            gates: [rock({ landings: [{ stand: at(0, 3205, 3209), landing }], from: 'north' })],
        });
        expect(reach.setsAt(INNER)).toEqual([[]]);
    });

    test('`landings` jump from each stand to its landing; another approach tile does not', () => {
        const unreachable = at(0, 3221, 3220);
        const reach = fill(room().block(at(0, 3204, 3210)), {
            gates: [rock({ landings: [{ stand: at(0, 3204, 3210), landing: unreachable }] })],
        });
        // Its only stand is blocked, so nothing lands.
        expect(reach.setsAt(INNER)).toEqual([]);
        const open = fill(room(), {
            gates: [rock({ landings: [{ stand: at(0, 3205, 3209), landing: unreachable }] })],
        });
        expect(open.setsAt(INNER)).toEqual([['skill:agility:10']]);
    });

    test("`opens` makes the loc's tiles walkable to a set that meets it, for the fill only", () => {
        // A line of trees down column 3216; the one at z 3220 is cut through.
        const grid = new Grid();
        for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
        const reach = fill(grid, {
            gates: [
                gate({
                    trigger: 'oploc1,tree',
                    loc: 'tree',
                    tile: DOOR,
                    shape: 10,
                    opens: true,
                    requires: [['category:weapon_axe:held']],
                }),
            ],
        });
        expect(reach.setsAt(DOOR)).toEqual([['category:weapon_axe:held']]);
        expect(reach.setsAt(EAST)).toEqual([['category:weapon_axe:held']]);
        expect(reach.report.openTiles).toBe(1);
        expect(grid.walkable(0, 3216, 3220)).toBe(false);
    });

    test('a row with no landing is reported', () => {
        const reach = fill(room(), { gates: [rock({})] });
        expect(reach.report.skipped).toEqual(['oploc1,rock rock (3205, 3210): a gate row with no derived landing']);
    });
});

describe('connectors', () => {
    const LADDER = at(0, 3210, 3210);
    const UP = at(1, 3210, 3211);
    const grid = () => new Grid().block(LADDER);
    const world = (c: Partial<Connector>, gates: Gate[] = []) => ({
        features: [feature('ladder', LADDER)],
        connectors: [connector({ loc: LADDER, landing: UP, ...c })],
        gates,
    });

    test('a landing is reached from any approach tile of the loc', () => {
        const reach = fill(grid(), world({}));
        expect(reach.setsAt(UP)).toEqual([[]]);
        expect(reach.report.edges.connectors).toBe(4);
        expect(reach.report.byLevel[1]).toBe(1024);
    });

    test('a relative landing only from its stand', () => {
        const reach = fill(grid(), world({ relative: true, stand: at(0, 3210, 3211) }));
        expect(reach.setsAt(UP)).toEqual([[]]);
        expect(reach.report.edges.connectors).toBe(1);
        // A stand walled off from the start: the climb is never made.
        const walled = fill(grid().room(3210, 3211, 3210, 3211), world({ relative: true, stand: at(0, 3210, 3211) }));
        expect(walled.setsAt(UP)).toEqual([]);
    });

    test("a gate on the connector's loc and op puts its requirements on the climb", () => {
        const guard = gate({
            trigger: 'oploc1,ladder',
            loc: 'ladder',
            tile: LADDER,
            shape: 10,
            requires: [['quest:mcannon>=2']],
        });
        expect(fill(grid(), world({}, [guard])).setsAt(UP)).toEqual([['quest:mcannon>=2']]);
        // On another op it is another move.
        expect(fill(grid(), world({}, [{ ...guard, trigger: 'oploc2,ladder' }])).setsAt(UP)).toEqual([[]]);
        const window = fill(grid(), world({}, [{ ...guard, kind: 'quest-window', requires: [] }]));
        expect(window.setsAt(UP)).toEqual([]);
        expect(window.report.skipped).toEqual(['connector ladder (3210, 3210) op1: a quest window, never crossed']);
    });

    test('a landing off land is reported, not added', () => {
        const reach = fill(grid(), world({ landing: at(0, 3235, 3210) }));
        expect(reach.report.edges.connectors).toBe(0);
        expect(reach.report.skipped).toEqual(['connector ladder (3210, 3210) op1: (3235, 3210) is not on land']);
    });
});

describe('requirement sets', () => {
    test('two gates with overlapping requirements: the superset is dropped, an incomparable set kept', () => {
        const reach = fill(sealed(), {
            gates: [
                westDoor(3220, [['quest:a', 'skill:mining:1']]),
                westDoor(3221, [['quest:a']]),
                westDoor(3222, [['coins:10']]),
            ],
        });
        expect(reach.setsAt(INNER)).toEqual([['coins:10'], ['quest:a']]);
        expect(reach.report.labels).toBe(reach.report.reached - 9 + 9 * 2);
    });

    test('a set arriving first is dropped when a subset reaches the tile later', () => {
        // The dear door is nearer the start; both reach the room while the empty set floods, the cheap one
        // after it is taken.
        const reach = fill(sealed(), {
            gates: [westDoor(3220, [['quest:a', 'skill:mining:1']]), westDoor(3222, [['quest:a']])],
        });
        expect(reach.setsAt(INNER)).toEqual([['quest:a']]);
        // Each room tile keeps the one set, not the dear one beside it.
        expect(reach.report.labels).toBe(reach.report.reached);
    });

    test('requirements add up along a route', () => {
        const inner = sealed().room(3221, 3221, 3221, 3221);
        const reach = fill(inner, {
            gates: [westDoor(3220, [['coins:10']]), gate({ tile: at(0, 3221, 3221), requires: [['skill:agility:5']] })],
        });
        expect(reach.setsAt(INNER)).toEqual([['coins:10', 'skill:agility:5']]);
    });

    test('a tile keeps at most maxSets minimal sets, and the tiles that would hold more are reported', () => {
        const gates = [westDoor(3220, [['coins:1']]), westDoor(3221, [['coins:2']]), westDoor(3222, [['coins:3']])];
        const reach = fill(sealed(), { gates }, { maxSets: 2 });
        expect(reach.setsAt(INNER)).toHaveLength(2);
        expect(reach.report.bound.tiles).toBeGreaterThan(0);
        expect(reach.report.bound.max).toBe(2);
        expect(fill(sealed(), { gates }).report.bound).toEqual({ max: MAX_SETS, tiles: 0, sample: [] });
    });

    test('a full tile evicts its largest set for a smaller incomparable one, ties by canonical string', () => {
        const gates = [
            westDoor(3220, [['quest:b', 'quest:c']]),
            westDoor(3221, [['quest:a', 'quest:d']]),
            westDoor(3222, [['coins:1']]),
        ];
        const reach = fill(sealed(), { gates }, { maxSets: 2 });
        // The smallest sets are kept, ties to the lowest canonical string, whatever the order.
        expect(reach.setsAt(INNER)).toEqual([['coins:1'], ['quest:a', 'quest:d']]);
        const swapped = fill(sealed(), { gates: [gates[1]!, gates[0]!, gates[2]!] }, { maxSets: 2 });
        expect(swapped.setsAt(INNER)).toEqual([['coins:1'], ['quest:a', 'quest:d']]);
        const one = [westDoor(3220, [['quest:a', 'quest:b']]), westDoor(3222, [['coins:1']])];
        expect(fill(sealed(), { gates: one }, { maxSets: 1 }).setsAt(INNER)).toEqual([['coins:1']]);
        expect(reach.report.bound.tiles).toBeGreaterThan(0);
    });

    test('the same input fills the same way', () => {
        const gates = [
            westDoor(3220, [['quest:b']]),
            westDoor(3221, [['quest:a']]),
            westDoor(3222, [['coins:10', 'quest:a']]),
        ];
        const [a, b] = [fill(sealed(), { gates }), fill(sealed(), { gates })];
        const { ms: _a, ...ra } = a.report;
        const { ms: _b, ...rb } = b.report;
        expect(ra).toEqual(rb);
        expect(a.setsAt(INNER)).toEqual(b.setsAt(INNER));
        expect(a.setsAt(INNER)).toEqual([['quest:a'], ['quest:b']]);
    });
});

describe('transports', () => {
    // An island: everything east of a blocked column at x 3216.
    const sea = () => {
        const grid = new Grid();
        for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
        return grid;
    };
    const SAILOR = at(0, 3210, 3210);

    test('a fare is a requirement of the ride; members is always met', () => {
        const reach = fill(sea(), {
            transports: [transport({ from: SAILOR, to: EAST, fare: 30, requires: ['coins:30', 'members'] })],
        });
        expect(reach.setsAt(EAST)).toEqual([['coins:30']]);
        expect(reach.setsAt(at(0, 3230, 3230))).toEqual([['coins:30']]);
        // From the sailor's tile and its eight neighbours.
        expect(reach.report.edges.transports).toBe(9);
    });

    test('a sailor on a blocked tile is boarded from beside it', () => {
        const reach = fill(sea().block(SAILOR), { transports: [transport({ from: SAILOR, to: EAST })] });
        expect(reach.setsAt(EAST)).toEqual([[]]);
        expect(reach.report.edges.transports).toBe(8);
    });

    test('a ride from a tile the start never reaches is never taken', () => {
        const reach = fill(
            sea(),
            { transports: [transport({ from: at(0, 3225, 3225), to: WEST })] },
            { start: at(0, 3205, 3205) },
        );
        expect(reach.setsAt(EAST)).toEqual([]);
    });
});

describe('formatReach', () => {
    test('counts, edges and cost, then the bound and the rows not used', () => {
        const report = fill(split(), {
            gates: [gate({ tile: DOOR, shape: 1, requires: [['item:key:held']] })],
        }).report;
        const lines = formatReach({
            ...report,
            ms: 12,
            bytes: 3 * 2 ** 20,
            bound: { max: 16, tiles: 1, sample: [EAST] },
        });
        expect(lines).toEqual([
            'reach: 1024 of 2048 tiles from the Lumbridge spawn, 1024 with no requirement (by level 1024 / 0 / 0 / 0); 1 requirement sets on 1024 labels',
            'reach edges: 0 connector, 0 gate, 0 transport; 0 opened loc tiles; 32 tiles beside reached land not land (not entered); 12 ms, 3.0 MiB of typed arrays',
            'warning: 1 tiles would hold more than 16 minimal sets, so results there may be incomplete; the first few:',
            '  (3225, 3220)',
            'warning: 1 rows the fill could not use:',
            '  oploc1,door door (3216, 3220): a wall of shape 1, whose two sides are not read',
        ]);
    });
});
