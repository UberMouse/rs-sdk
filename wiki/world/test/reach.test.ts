import { describe, expect, test } from 'bun:test';
import { locSizes } from '../place';
import { fillReach, formatReach, MAX_SETS, wallTiles, type ReachInput } from '../reach';
import { at, Grid } from './grid';
import type { Connector, Crossing, Feature, Gate, Tile, Transport } from '../types';

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

    test('with `oneWay`, the other side is refused, not free', () => {
        const oneWay = sided('west').map(g => ({ ...g, oneWay: true as const }));
        expect(fill(split(), { gates: oneWay }).setsAt(EAST)).toEqual([['skill:agility:5']]);
        expect(fill(split(), { gates: sided('west') }, { start: EAST }).setsAt(WEST)).toEqual([[]]);
        expect(fill(split(), { gates: oneWay }, { start: EAST }).setsAt(WEST)).toEqual([]);
        expect(fill(split(), { gates: oneWay }).report.edges.gates).toBe(1);
        // A side the two tiles don't differ on refuses neither: gated both ways, as without `oneWay`.
        const level = sided('north').map(g => ({ ...g, oneWay: true as const }));
        expect(fill(split(), { gates: level }).setsAt(EAST)).toEqual([['skill:agility:5']]);
        expect(fill(split(), { gates: level }, { start: EAST }).setsAt(WEST)).toEqual([['skill:agility:5']]);
    });

    test('a row with no requirement set adds no edge, not a free one; with `from` the other side stays free', () => {
        const none = fill(split(), { gates: [gate({ tile: DOOR, requires: [] })] });
        expect(none.setsAt(EAST)).toEqual([]);
        expect(none.report.edges.gates).toBe(0);
        const west = [gate({ tile: DOOR, requires: [], from: 'west' })];
        expect(fill(split(), { gates: west }).setsAt(EAST)).toEqual([]);
        expect(fill(split(), { gates: west }, { start: EAST }).setsAt(WEST)).toEqual([[]]);
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
        // With `oneWay` it lands nowhere: the script turns that side away.
        const refused = fill(room(), {
            gates: [rock({ landings: [{ stand: at(0, 3205, 3209), landing }], from: 'north', oneWay: true })],
        });
        expect(refused.setsAt(INNER)).toEqual([]);
    });

    test('a `free` landing lands free from a stand level with the loc, which `from` takes for the checked side', () => {
        const landing = at(0, 3221, 3222);
        const level = at(0, 3204, 3210);
        const free = fill(room(), {
            gates: [rock({ landings: [{ stand: level, landing, free: true }], from: 'north' })],
        });
        expect(free.setsAt(INNER)).toEqual([[]]);
        const checked = fill(room(), { gates: [rock({ landings: [{ stand: level, landing }], from: 'north' })] });
        expect(checked.setsAt(INNER)).toEqual([['skill:agility:10']]);
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
        const tree = (requires: string[][]) =>
            gate({ trigger: 'oploc1,tree', loc: 'tree', tile: DOOR, shape: 10, opens: true, requires });
        const reach = fill(grid, { gates: [tree([['category:weapon_axe:held']])] });
        expect(reach.setsAt(DOOR)).toEqual([['category:weapon_axe:held']]);
        expect(reach.setsAt(EAST)).toEqual([['category:weapon_axe:held']]);
        expect(reach.report.openTiles).toBe(1);
        expect(grid.walkable(0, 3216, 3220)).toBe(false);
        // With no requirement set no set meets it, not every one.
        expect(fill(grid, { gates: [tree([])] }).setsAt(EAST)).toEqual([]);
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
        // From north of it only: free from the south, or with `oneWay` not climbed from there.
        const north = fill(grid(), world({}, [{ ...guard, from: 'north' }]));
        expect(north.setsAt(UP)).toEqual([[]]);
        expect(north.report.edges.connectors).toBe(4);
        const oneWay = fill(grid(), world({}, [{ ...guard, from: 'north', oneWay: true }]));
        expect(oneWay.setsAt(UP)).toEqual([['quest:mcannon>=2']]);
        expect(oneWay.report.edges.connectors).toBe(3);
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

/** The sealed room's west door, then a door into its middle tile alone: a route through both. */
const twoDoors = (outer: string[][], inner: string[][], quests?: ReachInput['world']['quests']) =>
    fill(sealed().room(3221, 3221, 3221, 3221), {
        gates: [westDoor(3220, outer), gate({ tile: at(0, 3221, 3221), requires: inner })],
        quests,
    }).setsAt(INNER);

/** The sealed room through doors in its west wall, each at a z with its requirement sets. */
const into = (...doors: [number, string[][]][]) =>
    fill(sealed(), { gates: doors.map(([z, r]) => westDoor(z, r)) }).setsAt(INNER);

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

    test('a tile holding sets in several blocks keeps them all while the block pool grows', () => {
        // Ten incomparable ways onto level 1: each of its 1024 tiles holds ten sets, three blocks of the pool, so
        // the pool grows (past 1024 blocks) while a tile is linking a block it took.
        const ways = Array.from({ length: 10 }, (_, i) =>
            crossing({ from: [START], landings: [{ tile: at(1, 3200, 3200) }], requires: [[`quest:q${i}`]] }),
        );
        const reach = fill(new Grid(), { crossings: ways });
        const all = ways.map((_, i) => [`quest:q${i}`]);
        expect(reach.setsAt(at(1, 3231, 3231))).toEqual(all);
        expect(reach.setsAt(at(1, 3215, 3200))).toEqual(all);
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

    test('setsAny: the minimal sets over several tiles; reached: whether any set gets to a tile', () => {
        // Two sealed rooms, one behind 10 coins and one behind a quest; a pocket no door opens.
        const grid = sealed().room(3225, 3225, 3226, 3226).room(3229, 3229, 3229, 3229);
        const reach = fill(grid, {
            gates: [westDoor(3221, [['coins:10']]), gate({ tile: at(0, 3225, 3225), requires: [['quest:a']] })],
        });
        const [coins, quest, pocket] = [INNER, at(0, 3225, 3225), at(0, 3229, 3229)];
        expect(reach.setsAny([coins, quest])).toEqual([['coins:10'], ['quest:a']]);
        expect(reach.setsAny([coins, quest, START])).toEqual([[]]);
        expect(reach.setsAny([pocket, at(1, 9999, 9999)])).toEqual([]);
        expect([coins, quest, START, pocket, at(1, 9999, 9999)].map(reach.reached)).toEqual([
            true,
            true,
            true,
            false,
            false,
        ]);
    });

    test("along a route a quest's stages merge to the highest, and completion to `quest:<id>`", () => {
        expect(twoDoors([['quest:a>=3']], [['quest:a>=5']])).toEqual([['quest:a>=5']]);
        const quests = [{ id: 'a', varp: 'a', varpId: 1, complete: 5, stages: {}, source: 'a.rs2:1' }];
        expect(twoDoors([['quest:a>=3']], [['quest:a>=5']], quests)).toEqual([['quest:a']]);
        expect(twoDoors([['quest:a']], [['quest:a>=3']], quests)).toEqual([['quest:a']]);
        // A stage past complete (a step after the quest) meets completion too.
        expect(twoDoors([['quest:a']], [['quest:a>=7']], quests)).toEqual([['quest:a>=7']]);
        expect(twoDoors([['skill:agility:5']], [['skill:agility:15']])).toEqual([['skill:agility:15']]);
    });

    test('a join whose canonical form shrinks is taken from its lower bucket, and walks on from there', () => {
        // Quest a is done by another varp too, so {quest:a, quest:a>=3} stays two requirements (bucket 2). Past the
        // second door, at quest:a>=5 (past complete), the join is {quest:a>=5}: one requirement, bucket 1, which
        // the fill had already let go. The far corner of the inner room is reached only by walking on from there.
        const quests = [
            {
                id: 'a',
                varp: 'a',
                varpId: 1,
                complete: 4,
                or: [{ varp: 'b', varpId: 2, complete: 1 }],
                stages: {},
                source: 'a.rs2:1',
            },
        ];
        const reach = fill(sealed().room(3221, 3221, 3222, 3222), {
            gates: [
                westDoor(3220, [['quest:a', 'quest:a>=3']]),
                gate({ tile: at(0, 3221, 3221), requires: [['quest:a>=5']] }),
            ],
            quests,
        });
        expect(reach.setsAt(at(0, 3220, 3220))).toEqual([['quest:a', 'quest:a>=3']]);
        expect(reach.setsAt(at(0, 3221, 3221))).toEqual([['quest:a>=5']]);
        expect(reach.setsAt(at(0, 3222, 3222))).toEqual([['quest:a>=5']]);
    });

    test('along a route the coins of every crossing add up, the same toll twice included', () => {
        expect(twoDoors([['coins:10']], [['coins:30']])).toEqual([['coins:40']]);
        expect(twoDoors([['coins:10']], [['coins:10']])).toEqual([['coins:20']]);
    });

    test('across two routes a set another dominates is dropped: a lower stage, level or total wins', () => {
        expect(into([3220, [['quest:a>=8']]], [3222, [['quest:a>=3']]])).toEqual([['quest:a>=3']]);
        expect(into([3220, [['skill:agility:30']]], [3222, [['skill:agility:10']]])).toEqual([['skill:agility:10']]);
        expect(into([3220, [['coins:30']]], [3222, [['coins:10']]])).toEqual([['coins:10']]);
        // A larger total asking nothing else is still dominated; one asking less elsewhere is kept beside it.
        expect(into([3220, [['coins:30', 'quest:a']]], [3222, [['coins:10', 'quest:a']]])).toEqual([
            ['coins:10', 'quest:a'],
        ]);
        expect(into([3220, [['coins:30']]], [3222, [['coins:10', 'quest:a']]])).toEqual([
            ['coins:30'],
            ['coins:10', 'quest:a'],
        ]);
    });

    test('requirements add up along a route', () => {
        const inner = sealed().room(3221, 3221, 3221, 3221);
        const reach = fill(inner, {
            gates: [westDoor(3220, [['coins:10']]), gate({ tile: at(0, 3221, 3221), requires: [['skill:agility:5']] })],
        });
        expect(reach.setsAt(INNER)).toEqual([['coins:10', 'skill:agility:5']]);
    });

    test('a tile keeps at most maxSets minimal sets, and the tiles that would hold more are reported', () => {
        const gates = [westDoor(3220, [['quest:a']]), westDoor(3221, [['quest:b']]), westDoor(3222, [['quest:c']])];
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

/** An island: everything east of a blocked column at x 3216. */
const sea = () => {
    const grid = new Grid();
    for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
    return grid;
};

describe('transports', () => {
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

const crossing = (c: Partial<Crossing> & Pick<Crossing, 'from' | 'landings'>): Crossing => ({
    via: 'teleport',
    act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'ruins' },
    at: at(0, 3210, 3211),
    requires: [['item:air_talisman:held']],
    source: 'runecraft.rs2:45',
    ...c,
});

/** Three sealed rooms on the island, so a room is entered only by the edge that lands in it. */
const rooms = () => sea().room(3220, 3220, 3222, 3222).room(3226, 3226, 3228, 3228).room(3226, 3204, 3228, 3206);

describe('crossings', () => {
    const ISLAND = [at(0, 3221, 3221), at(0, 3227, 3227), at(0, 3227, 3205)];
    const FROM = [at(0, 3210, 3210), at(0, 3211, 3210)];

    test('every landing of a random landing is reached from every from tile, under the same alternatives', () => {
        const reach = fill(rooms(), {
            crossings: [crossing({ from: FROM, landings: ISLAND.map(tile => ({ tile })) })],
        });
        for (const t of ISLAND) expect(reach.setsAt(t)).toEqual([['item:air_talisman:held']]);
        expect(reach.setsAt(at(0, 3231, 3231))).toEqual([]);
        expect(reach.report.edges.crossings).toBe(FROM.length * ISLAND.length);
        const scripted = fill(rooms(), {
            crossings: [
                crossing({
                    via: 'scripted',
                    act: { kind: 'loc-op', loc: 'log_balance', op: 1 },
                    from: [at(0, 3205, 3205)],
                    landings: [{ tile: at(0, 3230, 3230), spread: 0 }],
                    requires: [['skill:agility:30'], ['quest:x', 'members']],
                }),
            ],
        });
        expect(scripted.setsAt(at(0, 3231, 3231))).toEqual([['quest:x'], ['skill:agility:30']]);
        expect(scripted.setsAt(ISLAND[0]!)).toEqual([]);
    });

    test('a row with no requirement set adds no edge: nothing makes the move ([[]] asks for nothing)', () => {
        const reach = fill(rooms(), {
            crossings: [crossing({ from: FROM, landings: [{ tile: ISLAND[0]! }], requires: [] })],
        });
        expect(reach.setsAt(ISLAND[0]!)).toEqual([]);
        expect(reach.report.edges.crossings).toBe(0);
    });

    test('a row with no tile it is done from adds no edge and is reported; a landing off land is reported', () => {
        const reach = fill(sea(), {
            crossings: [
                crossing({ from: [], landings: [{ tile: EAST }] }),
                crossing({ from: FROM, landings: [{ tile: at(0, 3235, 3220) }] }),
            ],
        });
        expect(reach.setsAt(EAST)).toEqual([]);
        expect(reach.report.skipped).toEqual([
            'teleport item-on-loc air_talisman ruins (3210, 3211): (3235, 3220) is not on land',
            'teleport item-on-loc air_talisman ruins (3210, 3211): no tile it is done from',
        ]);
    });

    test("a rolled gate's requirement is as without its roll: the roll prices the edge, it gates nothing", () => {
        const roll = { stat: 'agility', low: 10, high: 200, source: 'a.rs2:1', fail: { ticks: 3, damage: 2 } };
        const gates = [gate({ tile: DOOR, requires: [['skill:agility:5']] })];
        const rolled = fill(split(), { gates: [{ ...gates[0]!, roll }] });
        expect(rolled.setsAt(EAST)).toEqual(fill(split(), { gates }).setsAt(EAST));
        expect(rolled.setsAt(EAST)).toEqual([['skill:agility:5']]);
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
            'reach edges: 0 connector, 0 gate, 0 transport, 0 crossing; 0 opened loc tiles; 32 tiles beside reached land not land (not entered); 12 ms, 3.0 MiB of typed arrays',
            'warning: 1 tiles would hold more than 16 minimal sets, so results there may be incomplete; the first few:',
            '  (3225, 3220)',
            'warning: 1 rows the fill could not use:',
            '  oploc1,door door (3216, 3220): a wall of shape 1, whose two sides are not read',
        ]);
    });
});
