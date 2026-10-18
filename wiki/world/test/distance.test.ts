import { describe, expect, test } from 'bun:test';
import {
    CROSSING_TICKS,
    crossingTicks,
    formatDistance,
    nearestSinks,
    priceCrossings,
    strandedLandings,
} from '../distance';
import { locSizes } from '../place';
import { fillReach, reachGraph, type ReachInput } from '../reach';
import type { Connector, Crossing, Feature, FeatureKind, Gate, Roll, Tile, Transport, World } from '../types';
import { at, Grid } from './grid';

const size = locSizes(new Map());

/**
 * The nearest sinks of `sites` over the grid and the world's rows. Every call also searches each context in full
 * (NearestOptions.full) and checks the improvement-only searches found the same, so each scenario below is an
 * equivalence test too.
 */
const nearest = (
    grid: Grid,
    sites: { id: string; stand: Tile | null; reach?: string[][] }[],
    world: Partial<ReachInput['world']> = {},
) => {
    const graph = reachGraph({
        world: { features: [], connectors: [], gates: [], transports: [], ...world },
        collision: grid,
        size,
    });
    const input = sites.map(s => ({
        id: s.id,
        kind: s.id.slice(0, s.id.indexOf(':')) as FeatureKind,
        stand: s.stand,
        reach: s.reach ?? [[]],
    }));
    const result = nearestSinks(graph, input);
    expect(nearestSinks(graph, input, { full: true }).nearest).toEqual(result.nearest);
    return result;
};

/** A site's nearest bank. */
const bank = (r: ReturnType<typeof nearest>, id: string) => r.nearest.get(id)?.bank;

describe('run ticks', () => {
    test('a step is half a tick, straight or diagonal, rounded up over the path', () => {
        const r = nearest(new Grid(), [
            { id: 'bank:a:0', stand: at(0, 3200, 3200) },
            { id: 'tree:a:0', stand: at(0, 3207, 3203) },
            { id: 'tree:a:1', stand: at(0, 3206, 3200) },
            { id: 'tree:a:2', stand: at(0, 3200, 3200) },
        ]);
        expect(bank(r, 'tree:a:0')).toEqual({ site: 'bank:a:0', runTicks: 4, requires: [] });
        expect(bank(r, 'tree:a:1')?.runTicks).toBe(3);
        // A site on the bank's own stand is no way off.
        expect(bank(r, 'tree:a:2')?.runTicks).toBe(0);
    });

    test('the nearest of several banks by the walk, not the straight line', () => {
        // A wall down the west edge of column 3204, open only at z 3231: the bank west of it is 4 tiles from the
        // tree in a straight line but a 63-step walk round; the one east of it is 10 steps off.
        const grid = new Grid().wallColumn(3204, 3200, 3231, [3231]);
        const r = nearest(grid, [
            { id: 'bank:east:0', stand: at(0, 3218, 3200) },
            { id: 'bank:west:0', stand: at(0, 3200, 3200) },
            { id: 'tree:a:0', stand: at(0, 3208, 3200) },
        ]);
        expect(bank(r, 'tree:a:0')).toEqual({ site: 'bank:east:0', runTicks: 5, requires: [] });
        const west = nearest(grid, [
            { id: 'bank:west:0', stand: at(0, 3200, 3200) },
            { id: 'tree:a:0', stand: at(0, 3208, 3200) },
        ]);
        expect(bank(west, 'tree:a:0')?.runTicks).toBe(32);
    });

    test('a connector costs its crossing: a bank up a ladder', () => {
        const LADDER = at(0, 3210, 3210);
        const UP = at(1, 3210, 3211);
        const ladder: Feature = {
            source: 'loc',
            id: 1,
            config: 'ladder',
            tile: LADDER,
            shape: 10,
            rotation: 0,
            kind: 'connector',
            subtype: '',
            name: 'Ladder',
        };
        const up: Connector = {
            feature: 0,
            loc: LADDER,
            op: 1,
            opName: 'Climb-up',
            direction: 'up',
            landing: UP,
            stand: null,
            source: 'ladders.rs2:1',
        };
        const world = { features: [ladder], connectors: [up] };
        const grid = () => new Grid().block(LADDER);
        // 3 steps to the ladder's east side, the climb, and the bank on the landing.
        const r = nearest(
            grid(),
            [
                { id: 'bank:up:0', stand: UP },
                { id: 'tree:a:0', stand: at(0, 3214, 3210) },
            ],
            world,
        );
        expect(bank(r, 'tree:a:0')).toEqual({
            site: 'bank:up:0',
            runTicks: Math.ceil((3 + CROSSING_TICKS.connector * 2) / 2),
            requires: [],
        });
        // The distance is the way to the bank: a site upstairs with only a ladder up gets none.
        const down = nearest(
            grid(),
            [
                { id: 'bank:down:0', stand: at(0, 3214, 3210) },
                { id: 'tree:up:0', stand: UP },
            ],
            world,
        );
        expect(r.nearest.get('tree:up:0')).toBeUndefined();
        expect(down.nearest.get('tree:up:0')).toEqual({});
        expect(down.report.missing.bank).toBe(1);
    });
});

/** A wall down the west edge of column 3216, with a door at z 3220 and a gap at z 3231. */
const DOOR = at(0, 3216, 3220);
const doorGrid = () => new Grid().wallColumn(3216, 3200, 3231, [3220, 3231]);
const toll: Gate = {
    trigger: 'oploc1,door',
    kind: 'gate',
    loc: 'door',
    tile: DOOR,
    shape: 0,
    angle: 0,
    requires: [['coins:10']],
    source: 't.rs2:1',
};

// The bank west of the door, the trees east of it: through the door 6 + the crossing + 5 steps, round by the
// gap 23 steps.
const sites = (reach: Record<string, string[][]>) => [
    { id: 'bank:west:0', stand: at(0, 3210, 3220) },
    ...Object.entries(reach).map(([id, r]) => ({ id, stand: at(0, 3222, 3220), reach: r })),
];

describe("under the site's own requirement sets", () => {
    const through = Math.ceil((11 + CROSSING_TICKS.gate * 2) / 2);

    test('a site a walk reaches with {} takes only {} edges; one reached with the toll may pay it', () => {
        const r = nearest(
            doorGrid(),
            sites({
                'tree:free:0': [[]],
                'tree:toll:0': [['coins:10']],
                'tree:less:0': [['coins:5']],
                'tree:either:0': [['quest:a'], ['coins:10']],
            }),
            { gates: [toll] },
        );
        expect(bank(r, 'tree:free:0')).toEqual({ site: 'bank:west:0', runTicks: 12, requires: [] });
        expect(bank(r, 'tree:toll:0')).toEqual({ site: 'bank:west:0', runTicks: through, requires: ['coins:10'] });
        // 5 coins do not pay a 10-coin toll.
        expect(bank(r, 'tree:less:0')?.runTicks).toBe(12);
        // The shortest over the site's sets.
        expect(bank(r, 'tree:either:0')).toEqual({ site: 'bank:west:0', runTicks: through, requires: ['coins:10'] });
        // One search per distinct set: {}, {coins:10}, {coins:5}, {quest:a}.
        expect(r.report.contexts.bank).toBe(4);
    });

    test('a gate elsewhere the context also meets does not hide the one on the way', () => {
        // A 10-coin gate on open ground at (3202, 3228), off the way and first of the gated tiles by index: the
        // context's search starts from every gated tile, so the toll door still shortens the tree's way.
        const elsewhere: Gate = { ...toll, tile: at(0, 3202, 3228) };
        const r = nearest(doorGrid(), sites({ 'tree:toll:0': [['coins:10']] }), { gates: [elsewhere, toll] });
        expect(bank(r, 'tree:toll:0')).toEqual({ site: 'bank:west:0', runTicks: through, requires: ['coins:10'] });
    });

    test('of two ways equally short, the one asking fewer requirements', () => {
        // The bank 5 tiles further west: through the door 9 + 4 + 10 = 23 half ticks, round by the gap 11 + 1 + 11.
        const r = nearest(
            doorGrid(),
            [
                { id: 'bank:west:0', stand: at(0, 3205, 3220) },
                { id: 'tree:toll:0', stand: at(0, 3225, 3220), reach: [['coins:10']] },
            ],
            { gates: [toll] },
        );
        expect(bank(r, 'tree:toll:0')).toEqual({ site: 'bank:west:0', runTicks: 12, requires: [] });
    });

    test("a transport's ride costs its crossing, and its fare is the way's requirement", () => {
        // An island east of a blocked column at x 3216, reached by a 30-coin ship.
        const grid = new Grid();
        for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
        const ship: Transport = {
            kind: 'ship',
            npc: 'sailor',
            from: at(0, 3210, 3210),
            to: at(0, 3225, 3220),
            fare: 30,
            requires: ['coins:30'],
            source: 'sail.rs2:1',
        };
        const r = nearest(
            grid,
            [
                { id: 'bank:island:0', stand: at(0, 3228, 3220) },
                { id: 'tree:fare:0', stand: at(0, 3205, 3210), reach: [['coins:30']] },
                { id: 'tree:free:0', stand: at(0, 3205, 3211) },
            ],
            { transports: [ship] },
        );
        // 4 steps to the sailor's west neighbour, the ride, 3 steps to the bank.
        expect(bank(r, 'tree:fare:0')).toEqual({
            site: 'bank:island:0',
            runTicks: Math.ceil((7 + CROSSING_TICKS.ship * 2) / 2),
            requires: ['coins:30'],
        });
        expect(bank(r, 'tree:free:0')).toBeUndefined();
    });

    test("stepping onto an opened loc's tiles asks its requirement and costs a crossing", () => {
        // A line of trees down column 3216; the one at z 3220 is cut through with an axe.
        const grid = new Grid();
        for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
        const cut: Gate = { ...toll, loc: 'tree', shape: 10, opens: true, requires: [['category:weapon_axe:held']] };
        const r = nearest(grid, sites({ 'tree:axe:0': [['category:weapon_axe:held']], 'tree:free:0': [[]] }), {
            gates: [cut],
        });
        // 5 steps to the cut tree, the step onto it and its crossing, 6 steps on.
        expect(bank(r, 'tree:axe:0')).toEqual({
            site: 'bank:west:0',
            runTicks: Math.ceil((12 + CROSSING_TICKS.gate * 2) / 2),
            requires: ['category:weapon_axe:held'],
        });
        expect(bank(r, 'tree:free:0')).toBeUndefined();
    });
});

/** Walls down columns 3212 and 3220, open at each of `gaps` (z): doors at z 3220, a long way round at z 3231. */
const twoWalls = (gaps: number[]) => new Grid().wallColumn(3212, 3200, 3231, gaps).wallColumn(3220, 3200, 3231, gaps);
const doorAt = (x: number, requires: string[][]): Gate => ({ ...toll, tile: at(0, x, 3220), requires });
/** The bank west of both walls, the tree east of them, reached with `reach`. */
const across = (reach: string[][]) => [
    { id: 'bank:west:0', stand: at(0, 3205, 3220) },
    { id: 'tree:east:0', stand: at(0, 3226, 3220), reach },
];
// Through both doors: 6 steps, a crossing, 7 steps, a crossing, 6 steps.
const BOTH_DOORS = Math.ceil((19 + 2 * CROSSING_TICKS.gate * 2) / 2);

describe('ways through more than one gate', () => {
    test('two doors asking different things: a context with both takes both, and asks the two joined', () => {
        const gates = [doorAt(3212, [['coins:10']]), doorAt(3220, [['quest:a']])];
        const r = nearest(twoWalls([3220, 3231]), across([['coins:10', 'quest:a']]), { gates });
        expect(bank(r, 'tree:east:0')).toEqual({
            site: 'bank:west:0',
            runTicks: BOTH_DOORS,
            requires: ['coins:10', 'quest:a'],
        });
        // With only one of the two, the way round both (31 steps) is shorter than one door and round the other (33).
        const one = nearest(twoWalls([3220, 3231]), across([['coins:10']]), { gates });
        expect(bank(one, 'tree:east:0')).toEqual({ site: 'bank:west:0', runTicks: 16, requires: [] });
    });

    test('two 20-coin tolls in series under {coins:30}: never both, so the way round, or no bank', () => {
        const gates = [doorAt(3212, [['coins:20']]), doorAt(3220, [['coins:20']])];
        const r = nearest(twoWalls([3220, 3231]), across([['coins:30']]), { gates });
        const b = bank(r, 'tree:east:0')!;
        expect(b.runTicks).toBeGreaterThan(BOTH_DOORS);
        expect(['[]', '["coins:20"]']).toContain(JSON.stringify(b.requires));
        // With no way round, no bank.
        expect(bank(nearest(twoWalls([3220]), across([['coins:30']]), { gates }), 'tree:east:0')).toBeUndefined();
        // 40 coins pay both.
        expect(bank(nearest(twoWalls([3220]), across([['coins:40']]), { gates }), 'tree:east:0')).toEqual({
            site: 'bank:west:0',
            runTicks: BOTH_DOORS,
            requires: ['coins:40'],
        });
    });
});

describe('which sites get which sinks', () => {
    const r = nearest(new Grid(), [
        { id: 'bank:a:0', stand: at(0, 3200, 3200) },
        { id: 'furnace:a:0', stand: at(0, 3210, 3200) },
        { id: 'anvil:a:0', stand: at(0, 3220, 3200) },
        { id: 'range:a:0', stand: at(0, 3230, 3200) },
        { id: 'rock:a:0', stand: at(0, 3212, 3200) },
        { id: 'fishing-spot:a:0', stand: at(0, 3226, 3200) },
        { id: 'tree:a:0', stand: at(0, 3204, 3200) },
        { id: 'tree:gone:0', stand: at(0, 3205, 3200), reach: [] },
        { id: 'tree:nostand:0', stand: null },
        { id: 'shop:a:0', stand: at(0, 3201, 3200) },
    ]);

    test('ore to a furnace, raw fish to a range, bars to an anvil; every one to a bank', () => {
        expect(r.nearest.get('rock:a:0')).toEqual({
            bank: { site: 'bank:a:0', runTicks: 6, requires: [] },
            furnace: { site: 'furnace:a:0', runTicks: 1, requires: [] },
        });
        expect(r.nearest.get('fishing-spot:a:0')).toEqual({
            bank: { site: 'bank:a:0', runTicks: 13, requires: [] },
            range: { site: 'range:a:0', runTicks: 2, requires: [] },
        });
        expect(Object.keys(r.nearest.get('furnace:a:0')!)).toEqual(['bank', 'anvil']);
        expect(Object.keys(r.nearest.get('tree:a:0')!)).toEqual(['bank']);
        expect(Object.keys(r.nearest.get('range:a:0')!)).toEqual(['bank']);
    });

    test('a site no walk reaches, or with no stand, has none; a kind with no sinks is left out', () => {
        expect(r.nearest.get('tree:gone:0')).toEqual({});
        expect(r.nearest.get('tree:nostand:0')).toEqual({});
        expect(r.nearest.has('shop:a:0')).toBe(false);
        expect(r.nearest.has('bank:a:0')).toBe(false);
        expect(r.report).toMatchObject({
            contexts: { bank: 1, furnace: 1, range: 1, anvil: 1 },
            sinks: { bank: 1, furnace: 1, range: 1, anvil: 1 },
            found: { bank: 6, furnace: 1, range: 1, anvil: 1 },
            missing: { bank: 2, furnace: 0, range: 0, anvil: 0 },
        });
    });

    test('the report section', () => {
        const lines = formatDistance(r.report);
        expect(lines[0]).toBe(
            'distance: bank 6 sites with a nearest, 2 without (1 sinks, 1 contexts); ' +
                'furnace 1 sites with a nearest, 0 without (1 sinks, 1 contexts); ' +
                'range 1 sites with a nearest, 0 without (1 sinks, 1 contexts); ' +
                'anvil 1 sites with a nearest, 0 without (1 sinks, 1 contexts)',
        );
        expect(lines[1]).toMatch(/^distance: 4 searches settled \d+ tiles; \d+ ms, [\d.]+ MiB of typed arrays$/);
    });
});

/** An island: everything east of a blocked column at x 3216. */
const sea = () => {
    const grid = new Grid();
    for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
    return grid;
};

/** A row's landings and rolls priced over the grid (priceCrossings), as the build writes them. */
const priced = (grid: Grid, world: Pick<World, 'crossings'> & Partial<Pick<World, 'gates'>>) =>
    priceCrossings(
        reachGraph({
            world: { features: [], connectors: [], transports: [], gates: [], ...world },
            collision: grid,
            size,
        }),
        { gates: [], ...world },
    );

const crossing = (c: Partial<Crossing> & Pick<Crossing, 'from' | 'landings'>): Crossing => ({
    via: 'teleport',
    act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'ruins' },
    at: at(0, 3214, 3221),
    requires: [['item:air_talisman:held']],
    source: 'runecraft.rs2:45',
    ...c,
});

/** The island with a sealed room round (3230, 3220): no walk gets in or out of it. */
const sealedIsland = () => sea().room(3229, 3219, 3231, 3221);
/** A whole wall down the west edge of column 3216. */
const walled = () => new Grid().wallColumn(3216, 3200, 3231);
/** That wall with a gap at z 3220, for the door in it. */
const gapped = () => new Grid().wallColumn(3216, 3200, 3231, [3220]);

/** Each landing's reached landings as a set, undefined for one off land (strandedLandings). */
const sets = (...xs: (number[] | undefined)[]) => xs.map(x => x && new Set(x));

describe('a random landing costs its longest landing', () => {
    // Three landings on the island, A and B two steps apart, C 10 east of A: from A the farthest is C, 5 ticks; from
    // B, C at 4; from C, A at 5.
    const A = at(0, 3220, 3220);
    const B = at(0, 3222, 3220);
    const C = at(0, 3230, 3220);
    const FROM = at(0, 3214, 3220);
    const row = crossing({ from: [FROM], landings: [A, B, C].map(tile => ({ tile })) });
    // The tree is 4 steps from the ruins; the bank on the island 5 steps from A and from B, 8 from C.
    const islandSites = [
        { id: 'bank:island:0', stand: at(0, 3222, 3225) },
        { id: 'tree:a:0', stand: at(0, 3210, 3220), reach: [['item:air_talisman:held']] },
    ];

    test("priceCrossings stores each landing's spread: the run ticks from the landing farthest from it", () => {
        const p = priced(sea(), { crossings: [row] });
        expect(p.crossings[0]!.landings.map(l => l.spread)).toEqual([5, 4, 5]);
        expect(p.unpriced).toEqual([]);
        // A single landing's spread is 0.
        expect(priced(sea(), { crossings: [{ ...row, landings: [{ tile: A }] }] }).crossings[0]!.landings).toEqual([
            { tile: A, spread: 0 },
        ]);
    });

    test('the way through landing i costs the crossing plus its spread: here through B, the landing with the least', () => {
        const r = nearest(sea(), islandSites, { crossings: priced(sea(), { crossings: [row] }).crossings });
        // 4 steps, the teleport, B's 4 ticks of spread, 5 steps: 4 + 6 + 8 + 5 half ticks, rounded up.
        expect(bank(r, 'tree:a:0')).toEqual({
            site: 'bank:island:0',
            runTicks: Math.ceil((4 + CROSSING_TICKS.teleport * 2 + 8 + 5) / 2),
            requires: ['item:air_talisman:held'],
        });
    });

    test('the distances read the stored spread, whatever it says: one of 0 on C makes C the way', () => {
        const landings = [
            { tile: A, spread: 9 },
            { tile: B, spread: 30 },
            { tile: C, spread: 0 },
        ];
        const r = nearest(sea(), islandSites, { crossings: [{ ...row, landings }] });
        expect(bank(r, 'tree:a:0')?.runTicks).toBe(Math.ceil((4 + CROSSING_TICKS.teleport * 2 + 0 + 8) / 2));
    });

    test('a landing no other landing walks to is not priced, reported, and taken by no distance', () => {
        // C in a sealed room: no walk gets in or out of it. With A it is one landing of two, so neither is the rest
        // the other is stranded from (strandedLandings), and neither spread is known.
        const sealed = { ...row, landings: [A, C].map(tile => ({ tile })) };
        const p = priced(sealedIsland(), { crossings: [sealed] });
        expect(p.crossings[0]!.landings.map(l => l.spread)).toEqual([undefined, undefined]);
        expect(p.unpriced).toEqual([
            'teleport item-on-loc air_talisman ruins (3214, 3221): no walk to its landing (3220, 3220) from (3230, 3220)',
            'teleport item-on-loc air_talisman ruins (3214, 3221): no walk to its landing (3230, 3220) from (3220, 3220)',
        ]);
        expect(p.stranded).toEqual([]);
        expect(nearest(sealedIsland(), islandSites, { crossings: p.crossings }).nearest.get('tree:a:0')).toEqual({});
    });

    test('a stranded landing gets no spread and is reported; the others price to their own farthest', () => {
        // C sealed in, A and B two steps apart: C is stranded from them, so A and B are a tick from each other.
        const p = priced(sealedIsland(), { crossings: [row] });
        expect(p.crossings[0]!.landings.map(l => l.spread)).toEqual([1, 1, undefined]);
        expect(p.unpriced).toEqual([]);
        expect(p.stranded).toEqual([
            'teleport item-on-loc air_talisman ruins (3214, 3221) (runecraft.rs2:45): (3230, 3220)',
        ]);
        // The way to the bank goes by A or B at their own spread: 4 steps, the teleport, 1 tick, 5 steps.
        expect(bank(nearest(sealedIsland(), islandSites, { crossings: p.crossings }), 'tree:a:0')?.runTicks).toBe(
            Math.ceil((4 + CROSSING_TICKS.teleport * 2 + 2 + 5) / 2),
        );
    });

    test('strandedLandings: those that walk to none of the largest group, when it holds most landings on land', () => {
        // A group of three, and two landings that walk only to each other: both stranded.
        expect(strandedLandings(sets([0, 1, 2], [0, 1, 2], [0, 1, 2], [3, 4], [3, 4]))).toEqual(new Set([3, 4]));
        // One that walks into the group but not back is not stranded.
        expect(strandedLandings(sets([0, 1], [0, 1], [0, 1, 2]))).toEqual(new Set());
        // Two apart: no group holds most, so neither is.
        expect(strandedLandings(sets([0], [1]))).toEqual(new Set());
        // A landing off land counts for neither side.
        expect(strandedLandings(sets([0, 1], [0, 1], undefined, [3]))).toEqual(new Set([3]));
    });

    test("a landing off land is reported on its own; the others' spreads leave it out", () => {
        const OFF = at(2, 3220, 3220);
        const p = priced(sea(), { crossings: [{ ...row, landings: [A, B, OFF].map(tile => ({ tile })) }] });
        expect(p.crossings[0]!.landings.map(l => l.spread)).toEqual([1, 1, undefined]);
        expect(p.unpriced).toEqual([
            'teleport item-on-loc air_talisman ruins (3214, 3221): its landing (3220, 3220, 2) is not on land',
        ]);
    });

    test('a lone landing off land is reported unpriced and gets no spread', () => {
        const OFF = at(2, 3220, 3220);
        const p = priced(sea(), { crossings: [{ ...row, landings: [{ tile: OFF }] }] });
        expect(p.crossings[0]!.landings).toEqual([{ tile: OFF }]);
        expect(p.unpriced).toEqual([
            'teleport item-on-loc air_talisman ruins (3214, 3221): its landing (3220, 3220, 2) is not on land',
        ]);
    });

    test('with no crossing row and no rolled gate row, nothing is priced and the rows come back as they were', () => {
        const rows = { crossings: [], gates: [toll] };
        const p = priced(sea(), rows);
        expect(p.crossings).toBe(rows.crossings);
        expect(p.gates).toBe(rows.gates);
        // A crossing row is something to price: the gates come back as a new list.
        expect(priced(sea(), { ...rows, crossings: [row] }).gates).not.toBe(rows.gates);
    });
});

describe('a rolled crossing costs its expected ticks at the lowest level its requirement allows', () => {
    // A whole wall down the west edge of column 3216, and a shortcut over it from W to E at Agility 30: stat_random
    // bounds 50 and 200 succeed 95 times in 256 at 30 (roll.test.ts). A failure takes 4 ticks and drops the player
    // 6 steps west of W, 3 ticks from it.
    const W = at(0, 3215, 3220);
    const E = at(0, 3216, 3220);
    const roll: Roll = {
        stat: 'agility',
        low: 50,
        high: 200,
        source: 'agility.rs2:10',
        fail: { ticks: 4, to: at(0, 3209, 3220), damage: 2 },
    };
    const shortcut = crossing({
        via: 'scripted',
        act: { kind: 'loc-op', loc: 'log_balance', op: 1 },
        at: W,
        from: [W],
        landings: [{ tile: E }],
        requires: [['skill:agility:30'], ['quest:x', 'skill:agility:60']],
        roll,
    });
    const shortcutSites = [
        { id: 'bank:east:0', stand: E },
        { id: 'tree:west:0', stand: W, reach: [['skill:agility:30']] },
    ];
    const p = 95 / 256;

    test("priceCrossings stores the way back from the failure's tile to where the move is tried", () => {
        expect(priced(walled(), { crossings: [shortcut] }).crossings[0]!.roll!.fail.back).toBe(3);
    });

    test('the expected cost: success, plus (1 - p)/p failures, each its ticks and the way back', () => {
        const r = nearest(walled(), shortcutSites, {
            crossings: priced(walled(), { crossings: [shortcut] }).crossings,
        });
        // 2 + (161/95) * (4 + 3) = 13.86 ticks: 28 half ticks.
        const expected = CROSSING_TICKS.scripted + ((1 - p) / p) * (4 + 3);
        expect(Math.ceil(expected * 2)).toBe(28);
        expect(bank(r, 'tree:west:0')).toEqual({ site: 'bank:east:0', runTicks: 14, requires: ['skill:agility:30'] });
    });

    test('a failure that leaves the player where they tried has no way back: 2 + (161/95) * 4 = 8.78 ticks', () => {
        const here = { ...shortcut, roll: { ...roll, fail: { ticks: 4, damage: 2 } } };
        const r = nearest(walled(), shortcutSites, { crossings: priced(walled(), { crossings: [here] }).crossings });
        expect(bank(r, 'tree:west:0')?.runTicks).toBe(Math.ceil(Math.ceil((2 + ((1 - p) / p) * 4) * 2) / 2));
        expect(bank(r, 'tree:west:0')?.runTicks).toBe(9);
    });

    test('an expected cost exactly on a half tick is not rounded up past it: 2 + (216/40) * 45 = 245 ticks', () => {
        // Free, so at level 1, where low 39 succeeds 40 times in 256; the float comes out an ulp above 245.
        const exact = { ...shortcut, requires: [[]], roll: { ...roll, low: 39, fail: { ticks: 45, damage: 0 } } };
        expect(crossingTicks({ via: 'scripted', cost: { spread: 0, roll: exact.roll } }, 1)).toBeGreaterThan(245);
        const r = nearest(walled(), [shortcutSites[0]!, { id: 'tree:west:0', stand: W }], {
            crossings: priced(walled(), { crossings: [exact] }).crossings,
        });
        expect(bank(r, 'tree:west:0')).toEqual({ site: 'bank:east:0', runTicks: 245, requires: [] });
    });

    test('crossingTicks prices it at any level, for a walker at its own; unpriced or never succeeding, undefined', () => {
        const back = { ...roll, fail: { ...roll.fail, back: 3 } };
        expect(crossingTicks({ via: 'scripted', cost: { spread: 0, roll: back } }, 30)).toBeCloseTo(2 + 1127 / 95, 10);
        // At 99, 201 in 256: 2 + (55/201) * 7.
        expect(crossingTicks({ via: 'scripted', cost: { spread: 0, roll: back } }, 99)).toBeCloseTo(2 + 385 / 201, 10);
        expect(crossingTicks({ via: 'scripted', cost: { spread: 0, roll } }, 99)).toBeUndefined();
        expect(crossingTicks({ via: 'scripted', cost: { spread: undefined } })).toBeUndefined();
        expect(
            crossingTicks({ via: 'scripted', cost: { spread: 0, roll: { ...back, low: -1, high: 0 } } }, 1),
        ).toBeUndefined();
        expect(crossingTicks({ via: 'gate' })).toBe(CROSSING_TICKS.gate);
    });

    test('an unpriced roll is taken by no distance', () => {
        const r = nearest(walled(), shortcutSites, {
            crossings: [{ ...shortcut, landings: [{ tile: E, spread: 0 }] }],
        });
        expect(r.nearest.get('tree:west:0')).toEqual({});
    });

    test("a rolled gate's checked edges are priced the same, the way back to the nearest tile it is tried from", () => {
        // The wall with a gap at z 3220 and the door in it: its two tiles are (3216, 3220) and (3215, 3220).
        const door: Gate = {
            ...toll,
            requires: [['skill:agility:30']],
            roll: { ...roll, fail: { ticks: 4, to: at(0, 3210, 3220), damage: 2 } },
        };
        const pg = priced(gapped(), { crossings: [], gates: [door] });
        // 5 steps back to the door's west tile: 3 ticks.
        expect(pg.gates[0]!.roll!.fail.back).toBe(3);
        const r = nearest(
            gapped(),
            [
                { id: 'bank:east:0', stand: DOOR },
                { id: 'tree:west:0', stand: at(0, 3215, 3220), reach: [['skill:agility:30']] },
            ],
            {
                gates: pg.gates,
            },
        );
        expect(bank(r, 'tree:west:0')?.runTicks).toBe(14);
    });

    test('a roll tried from no tile on land has no way back to price, and is reported without a walk', () => {
        // An object gate with no derived landing has no edges; a crossing done from no tile has none either.
        const bush: Gate = { ...toll, shape: 10, roll };
        const unrolled = priced(walled(), { crossings: [{ ...shortcut, from: [] }], gates: [bush] });
        expect(unrolled.gates[0]!.roll!.fail.back).toBeUndefined();
        expect(unrolled.crossings[0]!.roll!.fail.back).toBeUndefined();
        expect(unrolled.unpriced).toEqual([
            'oploc1,door door (3216, 3220): no tile on land it is tried from, so no way back to price',
            'scripted loc-op 1 log_balance (3215, 3220): no tile on land it is tried from, so no way back to price',
        ]);
    });
});

test('kept to the tiles a walk reaches, the searches find the same ways and settle fewer tiles', () => {
    // A one-way crossing over the whole wall, from the west half into the east, where the spawn (3222, 3218) and
    // the bank are: no walk gets to the west half, but every tile of it gets to the bank.
    const row = crossing({
        via: 'scripted',
        act: { kind: 'loc-op', loc: 'rope', op: 1 },
        from: [at(0, 3210, 3210)],
        landings: [{ tile: at(0, 3220, 3210), spread: 0 }],
        requires: [[]],
    });
    const input = {
        world: { features: [], connectors: [], gates: [], transports: [], crossings: [row] },
        collision: walled(),
        size,
    };
    const graph = reachGraph(input);
    const fill = fillReach(input, graph);
    const targets = [
        { id: 'bank:east:0', kind: 'bank' as const, stand: at(0, 3225, 3225), reach: [[]] },
        { id: 'tree:east:0', kind: 'tree' as const, stand: at(0, 3218, 3205), reach: [[]] },
    ];
    const all = nearestSinks(graph, targets);
    const kept = nearestSinks(graph, targets, { reached: fill.reachedAt });
    expect(kept.nearest).toEqual(all.nearest);
    expect(kept.nearest.get('tree:east:0')?.bank?.site).toBe('bank:east:0');
    expect(fill.reached(at(0, 3210, 3210))).toBe(false);
    expect(kept.report.settled).toBeLessThan(all.report.settled);
});
