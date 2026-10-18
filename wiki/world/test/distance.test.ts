import { describe, expect, test } from 'bun:test';
import { CROSSING_TICKS, formatDistance, nearestSinks } from '../distance';
import { locSizes } from '../place';
import { reachGraph, type ReachInput } from '../reach';
import type { Connector, Feature, FeatureKind, Gate, Tile, Transport } from '../types';
import { at, Grid } from './grid';

const size = locSizes(new Map());

/** The nearest sinks of `sites` over the grid and the world's rows. */
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
    return nearestSinks(
        graph,
        sites.map(s => ({
            id: s.id,
            kind: s.id.slice(0, s.id.indexOf(':')) as FeatureKind,
            stand: s.stand,
            reach: s.reach ?? [[]],
        })),
    );
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
