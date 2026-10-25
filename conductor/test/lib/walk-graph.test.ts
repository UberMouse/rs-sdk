import { describe, expect, test } from 'bun:test';
import { locSizes } from '../../../wiki/world/place';
import { fillReach, type ReachCollision, wallTiles } from '../../../wiki/world/reach';
import { readConfigs } from '../../../wiki/world/sources/configs';
import { at, Grid } from '../../../wiki/world/test/grid';
import { CROSSING_TICKS } from '../../../wiki/world/distance';
import { expectedTicks, statRandomChance } from '../../../wiki/world/roll';
import { ANY_CAME_FROM } from '../../../wiki/world/requirements';
import type { Act, Crossing, Gate, Roll, Transport, World } from '../../../wiki/world/types';
import { type Account, NO_ACCOUNT } from '../../lib/account';
import { CONNECTORS, MAX_HOPS } from '../../lib/connectors';
import {
    BANK_DETOUR_TICKS,
    crossingRefusal,
    type Detour,
    doorRefusal,
    moveRefusal,
    nearestWay,
    planWay,
    walkGraph,
    type WalkGraph,
    type WalkSearch,
} from '../../lib/walk-graph';
import { WORLD } from '../../lib/world-index';

const configs = readConfigs('loc');
const opName = (loc: string, op: number) => configs.get(loc)?.[`op${op}`]?.[0];
/** The gated door rows: a wall with no `to`. */
const doors = WORLD.gates.filter(g => g.kind === 'gate' && [0, 1, 2, 3, 9].includes(g.shape) && !g.to);
const row = (loc: string) => {
    const g = doors.find(d => d.loc === loc);
    if (!g) throw new Error(`no door row ${loc}`);
    return g;
};

const SKILLS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting']
    .concat(['fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving'])
    .concat(['runecraft']);
const maxed = (extra: Partial<Account> = {}): Account => ({
    levels: Object.fromEntries(SKILLS.map(s => [s, 99])),
    coins: 0,
    ...extra,
});
/** Run ticks from one side of a door row's wall to the other, or undefined; crossing it is 2 (a gate's crossing). */
const across = (g: Gate, account: Account) => {
    const [a, b] = wallTiles(g)!;
    return nearestWay(a, [b], { account, connectors: CONNECTORS, maxHops: MAX_HOPS })?.runTicks;
};
const CROSSED = 2;

describe('doorRefusal: the door rows a walk crosses are those the walker opens', () => {
    test('every row it refuses is in one of these classes', () => {
        const classes = new Set(
            doors.flatMap(g => {
                const why = doorRefusal(g, opName);
                return why ? [why.replace(/^op .*, not Open$/, 'op not Open')] : [];
            }),
        );
        expect([...classes].sort()).toEqual([
            'a oplocu trigger (an item used on it)',
            'a payment other than the toll',
            'asks to force the doors (quests/quest_legends/scripts/quest_legends.rs2:466)',
            'op not Open',
        ]);
    });

    test('refused: lock picking, the crumbly wall shortcuts, the Shilo furnace fee, the Legends trial gates', () => {
        expect(doorRefusal(row('loc_2551'), opName)).toBe('op Pick Lock, not Open');
        expect(doorRefusal(row('cave_railings5'), opName)).toBe('op Pick-lock, not Open');
        expect(doorRefusal(row('east_ardy_sewer_gate_south'), opName)).toBe('op Pick Lock, not Open');
        expect(doorRefusal(row('castlecrumbly'), opName)).toBe('op Climb-over, not Open');
        expect(doorRefusal(row('shilofurnacedoor'), opName)).toBe('a payment other than the toll');
        expect(doorRefusal(row('lgstrengthtrialgatel'), opName)).toMatch(/force the doors/);
        expect(doorRefusal(row('crumbled_wall'), opName)).toBe('op Jump-over, not Open');
    });

    test('crossed: the guild doors and member gates opened by Open, and the Al Kharid toll gate', () => {
        for (const loc of ['magicguild_door_r', 'ranging_guild_door', 'crafting_guild_door', 'chefdoor'])
            expect(doorRefusal(row(loc), opName), loc).toBeUndefined();
        const members = doors.filter(g => g.loc.startsWith('membergate'));
        expect(members.length).toBeGreaterThan(0);
        for (const g of members) expect(doorRefusal(g, opName), g.loc).toBeUndefined();
        expect(doorRefusal(row('border_gate_toll_left'), opName)).toBeUndefined();
    });
});

describe('the walk search crosses a door only when the walker opens it, or makes its move', () => {
    test('a pick-lock door is a move (cross sends Pick-lock), taken at the Thieving level it asks, not below', () => {
        const door = row('loc_2551');
        expect(doorRefusal(door, opName)).toBe('op Pick Lock, not Open');
        expect(moveRefusal(door)).toBeUndefined();
        expect(across(door, maxed())).toBe(CROSSED);
        const below = across(door, { levels: { thieving: 15 }, coins: 0 });
        expect(below === undefined || below > CROSSED).toBe(true);
    });

    test("a guild door the account qualifies for is crossed: the Magic Guild's at Magic 66", () => {
        const door = row('magicguild_door_r');
        expect(across(door, maxed())).toBe(CROSSED);
        const below = across(door, { levels: { magic: 65 }, coins: 0 });
        expect(below === undefined || below > CROSSED).toBe(true);
    });

    test('the toll gate is crossed with 10 coins, gone round without', () => {
        const toll = row('border_gate_toll_left');
        expect(across(toll, { ...NO_ACCOUNT, coins: 10 })).toBe(CROSSED);
        expect(across(toll, NO_ACCOUNT)!).toBeGreaterThan(CROSSED);
    });
});

/** An island: everything east of a blocked column at x 3216. */
const sea = () => {
    const grid = new Grid();
    for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
    return grid;
};
const size = locSizes(new Map());
const empty = { features: [], connectors: [], gates: [], transports: [], crossings: [] };
type Rows = Partial<Pick<World, 'gates' | 'transports' | 'crossings'>>;
/** The walk graph of a scripted world: `rows` over `collision` (the island by default). */
const graphOf = (
    rows: Rows,
    collision = sea(),
    names: (loc: string, op: number) => string | undefined = () => 'Open',
) => walkGraph({ world: { ...empty, ...rows }, collision, size, opName: names });
/** A search of a scripted world's walk graph, with nothing met but `{}` unless `account` says. */
const search = (graph: WalkGraph, account: Account = NO_ACCOUNT): WalkSearch => ({
    account,
    connectors: [],
    maxHops: MAX_HOPS,
    graph,
});
const WEST = at(0, 3205, 3220);
const EAST = at(0, 3225, 3220);
/** A move from (3215, z) on the west shore to the island, landing at (3217, z), free unless `over` says. */
const move = (over: Partial<Crossing> = {}, z = 3220): Crossing => ({
    via: 'scripted',
    act: { kind: 'loc-op', loc: 'log_balance', op: 1 },
    at: at(0, 3214, z),
    from: [at(0, 3215, z)],
    landings: [{ tile: at(0, 3217, z), spread: 0 }],
    requires: [[]],
    source: 'a.rs2:1',
    ...over,
});
const crossed = (w: ReturnType<typeof nearestWay>) =>
    w?.hops.flatMap(h => (h.kind === 'cross' ? [h.move.act] : [])) ?? [];
/** Run ticks of a way of `steps` steps (half a tick each) and crossings of `crossing` ticks, rounded up once. */
const ticks = (steps: number, crossing: number) => Math.ceil((steps + 2 * crossing) / 2);

describe('the walk search ignores every edge kind it does not walk', () => {
    test('a ship to the island: the fill reaches it, the walk does not', () => {
        const ship: Transport = {
            kind: 'ship',
            npc: 'sailor',
            from: at(0, 3210, 3210),
            to: EAST,
            fare: 0,
            requires: [],
            source: 'sail.rs2:1',
        };
        const world = { ...empty, transports: [ship] };
        expect(fillReach({ world, collision: sea(), size, start: WEST }).setsAt(EAST)).toEqual([[]]);
        const graph = graphOf({ transports: [ship] });
        expect(nearestWay(WEST, [EAST], search(graph))).toBeUndefined();
        expect(nearestWay(WEST, [at(0, 3205, 3225)], search(graph))?.runTicks).toBe(3);
    });

    test('a door it opens, on a graph of its own, is walked through', () => {
        const DOOR = at(0, 3216, 3220);
        const gate: Gate = {
            trigger: 'oploc1,door',
            kind: 'gate',
            loc: 'door',
            tile: DOOR,
            shape: 0,
            angle: 0,
            requires: [[]],
            source: 't.rs2:1',
        };
        const grid = new Grid().wallColumn(3216, 3200, 3231, [3220]);
        const way = nearestWay(WEST, [EAST], search(graphOf({ gates: [gate] }, grid)));
        // 10 steps to the door's west tile, the crossing, 9 steps on.
        expect(way?.runTicks).toBe(ticks(10 + 9, 2));
        expect(way?.hops.map(h => h.kind)).toEqual(['door']);
    });
});

describe('the walk search makes scripted moves and teleports', () => {
    test('a scripted move: walked to its from tile, crossed, walked on, the move a hop of the way', () => {
        const way = nearestWay(WEST, [EAST], search(graphOf({ crossings: [move()] })));
        // 10 steps to (3215, 3220), the move, 8 steps on.
        expect(way?.runTicks).toBe(ticks(10 + 8, CROSSING_TICKS.scripted));
        expect(way?.hops).toEqual([
            {
                kind: 'cross',
                move: {
                    via: 'scripted',
                    act: { kind: 'loc-op', loc: 'log_balance', op: 1 },
                    at: at(0, 3214, 3220),
                    landings: [at(0, 3217, 3220)],
                    source: 'a.rs2:1',
                },
                stand: at(0, 3215, 3220),
                landing: at(0, 3217, 3220),
                requires: [[]],
            },
        ]);
    });

    test('a teleport that needs an obj carried: taken with it, no way without', () => {
        const talisman = move({
            via: 'teleport',
            act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
            requires: [['item:air_talisman:held']],
        });
        const graph = graphOf({ crossings: [talisman] });
        expect(nearestWay(WEST, [EAST], search(graph))).toBeUndefined();
        const carrying: Account = { ...NO_ACCOUNT, held: new Map([['air_talisman', 1]]) };
        const way = nearestWay(WEST, [EAST], search(graph, carrying));
        expect(way?.runTicks).toBe(ticks(10 + 8, CROSSING_TICKS.teleport));
        expect(crossed(way)).toEqual([talisman.act]);
    });

    test('a teleport behind a quest: no way until the caller says the quest is done', () => {
        const wizard = move({
            via: 'teleport',
            act: { kind: 'npc-op', npc: 'aubury', op: 4 },
            requires: [['quest:runemysteries']],
        });
        const graph = graphOf({ crossings: [wizard] });
        expect(nearestWay(WEST, [EAST], search(graph))).toBeUndefined();
        const done: Account = { ...NO_ACCOUNT, met: new Set(['quest:runemysteries']) };
        expect(crossed(nearestWay(WEST, [EAST], search(graph, done)))).toEqual([wizard.act]);
    });

    test('a random landing costs its longest (the spread), and a way goes on from whichever landing it gets', () => {
        const [north, south] = [at(0, 3220, 3228), at(0, 3220, 3212)];
        const random = move({
            landings: [
                { tile: north, spread: 8 },
                { tile: south, spread: 8 },
            ],
        });
        const graph = graphOf({ crossings: [random] });
        const way = nearestWay(WEST, [EAST], search(graph));
        // To the move, its crossing and the spread, then the 8 diagonal steps from either landing.
        expect(way?.runTicks).toBe(ticks(10 + 8, CROSSING_TICKS.scripted + 8));
        // The walk lands on one and plans again from there: either reaches the target in 8 steps.
        for (const landed of [north, south]) expect(nearestWay(landed, [EAST], search(graph))?.runTicks).toBe(4);
    });

    test("an interface click the row opens nothing for is left out: a glider's button, though the fill takes it", () => {
        const glider = move({ via: 'teleport', act: { kind: 'interface', component: 'glidermap:com_21' } });
        expect(crossingRefusal(glider)).toMatch(/interface no op of the row opens/);
        const world = { ...empty, crossings: [glider] };
        expect(fillReach({ world, collision: sea(), size, start: WEST }).setsAt(EAST)).toEqual([[]]);
        expect(nearestWay(WEST, [EAST], search(graphOf({ crossings: [glider] })))).toBeUndefined();
        // Every other act is made: an item op, the whistle's.
        const whistle = move({ via: 'teleport', act: { kind: 'item-op', obj: 'magic_whistle', op: 1 } });
        expect(crossingRefusal(whistle)).toBeUndefined();
        expect(crossed(nearestWay(WEST, [EAST], search(graphOf({ crossings: [whistle] }))))).toEqual([whistle.act]);
    });

    test('a move given up on (avoid) is not taken', () => {
        const graph = graphOf({ crossings: [move()] });
        expect(nearestWay(WEST, [EAST], { ...search(graph), avoid: m => m.at.x === 3214 })).toBeUndefined();
    });
});

describe('the essence mine portals: the way back to the wizard on record', () => {
    // The mine is the island; each portal row lands by its wizard, behind a came-from requirement.
    const MINE = at(0, 3225, 3220);
    const [byA, byB] = [at(0, 3205, 3204), at(0, 3205, 3228)];
    const portal = (exit: typeof byA, wizard: string): Crossing => ({
        via: 'teleport',
        act: { kind: 'loc-op', loc: 'blankrunestone_exit_portal', op: 1 },
        at: at(0, 3226, 3226),
        from: [at(0, 3226, 3225)],
        landings: [{ tile: exit, spread: 0 }],
        requires: [[`other:came from ${wizard}`]],
        source: 'essence_mine.rs2:41',
    });
    const graph = graphOf({ crossings: [portal(byA, 'wiz_a'), portal(byB, 'wiz_b')] });
    const TARGET = at(0, 3206, 3227);
    const landed = (met: string[]) =>
        nearestWay(MINE, [TARGET], search(graph, { ...NO_ACCOUNT, met: new Set(met) }))?.hops.flatMap(h =>
            h.kind === 'cross' ? [h.landing] : [],
        );

    test("the wizard on record's portal edge, even when the other wizard's exit is nearer the destination", () => {
        expect(landed(['other:came from wiz_a'])).toEqual([byA]);
        expect(landed(['other:came from wiz_b'])).toEqual([byB]);
    });

    test('in the mine with none on record, the nearest exit (the walk goes on from wherever the portal lands)', () => {
        expect(landed([ANY_CAME_FROM])).toEqual([byB]);
    });

    test('with none on record and not known to be in the mine, no portal is taken', () => {
        expect(landed([])).toBeUndefined();
    });
});

/** An account with an Agility level (base and current) and hitpoints left. */
const agile = (level: number, hitpoints = 99): Account => ({
    levels: { agility: level },
    coins: 0,
    current: { agility: level, hitpoints },
});

describe("rolled crossings are priced at the bot's current level", () => {
    // A wall between the shores with one gap, at z 3205: the way round from FROM to TO is 15 steps to (3215, 3205),
    // one through the gap and 15 on, 31 half ticks. The shortcut across the wall at z 3220 is a roll whose failure
    // takes 20 ticks and 5 hitpoints; through it the way is 3 steps, the roll's expected ticks, 4 steps.
    const ROUND_HALF = 31;
    const roll: Roll = { stat: 'agility', low: 50, high: 250, source: 'a.rs2:2', fail: { ticks: 20, damage: 5 } };
    const shortcut = move({
        landings: [{ tile: at(0, 3216, 3220), spread: 0 }],
        requires: [['skill:agility:10']],
        roll,
    });
    const graph = graphOf({ crossings: [shortcut] }, new Grid().wallColumn(3216, 3200, 3231, [3205]));
    const [FROM, TO] = [at(0, 3212, 3220), at(0, 3220, 3220)];
    const way = (a: Account) => nearestWay(FROM, [TO], search(graph, a));
    /** The way through the shortcut at a level, in half ticks: the roll's expected ticks rounded up to a half tick. */
    const throughHalf = (level: number) =>
        3 +
        4 +
        Math.ceil(
            2 * expectedTicks(CROSSING_TICKS.scripted, statRandomChance(level, roll.low, roll.high), 20, 0) - 1e-9,
        );
    const levels = Array.from({ length: 90 }, (_, i) => i + 10);
    /** The last level the shortcut costs more than the way round, and the first it costs less. */
    const [ROUND_AT, CROSS_AT] = [
        levels.findLast(l => throughHalf(l) > ROUND_HALF)!,
        levels.find(l => throughHalf(l) < ROUND_HALF)!,
    ];

    test('skipped at a low level and taken at a high one, switching where the expected costs cross', () => {
        expect(way(agile(10))!.runTicks).toBe(Math.ceil(ROUND_HALF / 2));
        expect([ROUND_AT, CROSS_AT]).toEqual([60, 62]);
        expect(crossed(way(agile(10)))).toEqual([]);
        expect(crossed(way(agile(ROUND_AT)))).toEqual([]);
        expect(crossed(way(agile(CROSS_AT)))).toEqual([shortcut.act]);
        expect(way(agile(CROSS_AT))!.runTicks).toBe(Math.ceil(throughHalf(CROSS_AT) / 2));
        expect(crossed(way(agile(99)))).toEqual([shortcut.act]);
    });

    test('below the level it asks, never; the current level prices the roll, not the base', () => {
        expect(crossed(way(agile(9)))).toEqual([]);
        expect(crossed(way({ ...agile(CROSS_AT), current: { agility: ROUND_AT, hitpoints: 99 } }))).toEqual([]);
        expect(crossed(way({ ...agile(ROUND_AT), current: { agility: CROSS_AT, hitpoints: 99 } }))).toEqual([
            shortcut.act,
        ]);
    });

    test('a failure that can take the hitpoints the bot has left refuses it, whatever the level', () => {
        expect(crossed(way(agile(99, roll.fail.damage)))).toEqual([]);
        expect(crossed(way(agile(99, roll.fail.damage + 1)))).toEqual([shortcut.act]);
    });
});

const gate = (over: Partial<Gate> = {}): Gate => ({
    trigger: 'oploc1,squeeze',
    kind: 'gate',
    loc: 'squeeze',
    tile: at(0, 3216, 3220),
    shape: 0,
    angle: 0,
    requires: [[]],
    source: 't.rs2:1',
    ...over,
});
const walled = () => new Grid().wallColumn(3216, 3200, 3231, [3220]);
const climbOver = () => 'Climb-over';

describe('gate rows the walker does not open are moves', () => {
    test('a door crossed by another op than Open: its op, sent with cross', () => {
        const way = nearestWay(WEST, [EAST], search(graphOf({ gates: [gate()] }, walled(), climbOver)));
        expect(crossed(way)).toEqual([{ kind: 'loc-op', loc: 'squeeze', op: 1 }]);
    });

    test('a payment asked in dialogue: refused without choices, made with them', () => {
        const pass = { requires: [['consume:shantay_pass:1']] };
        expect(moveRefusal(gate(pass))).toMatch(/payment/);
        const choices = { kind: 'loc-op' as const, loc: 'squeeze', op: 1, choices: ['Yes'] };
        expect(moveRefusal(gate({ ...pass, act: choices }))).toBeUndefined();
        const carrying: Account = { ...NO_ACCOUNT, held: new Map([['shantay_pass', 1]]) };
        const graph = graphOf({ gates: [gate({ ...pass, act: choices })] }, walled(), climbOver);
        expect(crossed(nearestWay(WEST, [EAST], search(graph, carrying)))).toEqual([choices]);
    });

    test('a use-item trigger names no obj: refused', () => {
        expect(moveRefusal(gate({ trigger: 'oplocu,squeeze' }))).toMatch(/item used on it/);
    });
});

describe('bank detours for an obj a crossing needs', () => {
    // A free way to the island far north (z 3231) and a talisman teleport straight across (z 3220).
    const START = at(0, 3210, 3220);
    const talisman = move({
        via: 'teleport',
        act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
        landings: [{ tile: EAST, spread: 0 }],
        requires: [['item:air_talisman:held']],
    });
    const graph = graphOf({ crossings: [talisman, move({}, 3231)] });
    const NEAR_BANK = at(0, 3210, 3216);
    const detour = (count: number, banks = [NEAR_BANK], free = 27): Detour => ({
        bank: obj => (obj === 'air_talisman' ? count : 0),
        banks,
        free,
        stackable: () => false,
    });
    const plan = (d?: Detour) => planWay(START, [EAST], { ...search(graph), ...(d && { detour: d }) });
    const free = plan()!;

    test('taken when the bank holds the obj and the detour is shorter: to the bank, withdraw, the teleport', () => {
        const way = plan(detour(1))!;
        // 4 steps to the bank, the bank's ticks, 5 steps to the ruins' from tile, the teleport.
        expect(way.runTicks).toBe(2 + BANK_DETOUR_TICKS + ticks(5, CROSSING_TICKS.teleport));
        expect(way.runTicks).toBeLessThan(free.runTicks);
        expect(way.hops.map(h => h.kind)).toEqual(['bank', 'cross']);
        expect(way.hops[0]).toMatchObject({ stand: NEAR_BANK, withdraw: [{ obj: 'air_talisman', count: 1 }] });
        expect(crossed(way)).toEqual([talisman.act]);
    });

    test('skipped when the bank holds none: the free way north', () => {
        expect(plan(detour(0))).toEqual(free);
        expect(crossed(free)).toEqual([{ kind: 'loc-op', loc: 'log_balance', op: 1 }]);
    });

    test('skipped when the detour is longer: a bank far south', () => {
        expect(plan(detour(1, [at(0, 3200, 3200)]))).toEqual(free);
    });

    test('skipped with no free slot for the obj', () => {
        expect(plan(detour(1, [NEAR_BANK], 0))).toEqual(free);
    });
});

/** A way's bank detour hop. */
const withdrawn = (way: ReturnType<typeof planWay>) => way?.hops.find(h => h.kind === 'bank');
/** A talisman teleport across the column at x, from the tile west of it to the one east. */
const ruins = (x: number): Crossing =>
    move({
        via: 'teleport',
        act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
        at: at(0, x - 2, 3220),
        from: [at(0, x - 1, 3220)],
        landings: [{ tile: at(0, x + 1, 3220), spread: 0 }],
        requires: [['item:air_talisman:held']],
    });

describe('what a bank detour withdraws', () => {
    const START = at(0, 3210, 3220);
    const NEAR_BANK = at(0, 3210, 3216);
    const banked = (obj: string, count: number): Detour => ({
        bank: o => (o === obj ? count : 0),
        banks: [NEAR_BANK],
        free: 27,
        stackable: () => false,
    });

    test('an obj two crossings ask to be held is withdrawn once', () => {
        // Two blocked columns, each crossed by a talisman teleport: the way to the far shore makes both.
        const grid = new Grid();
        for (const x of [3216, 3222]) for (let tz = 3200; tz < 3232; tz++) grid.block(at(0, x, tz));
        const graph = graphOf({ crossings: [ruins(3216), ruins(3222)] }, grid);
        const way = planWay(START, [at(0, 3226, 3220)], { ...search(graph), detour: banked('air_talisman', 3) });
        expect(way?.hops.filter(h => h.kind === 'cross')).toHaveLength(2);
        expect(withdrawn(way)).toMatchObject({ withdraw: [{ obj: 'air_talisman', count: 1 }] });
    });

    test('an obj a crossing spends is withdrawn less what the bot carries', () => {
        const passes = move({ requires: [['consume:shantay_pass:2']] });
        const graph = graphOf({ crossings: [passes] });
        const carrying: Account = { ...NO_ACCOUNT, held: new Map([['shantay_pass', 1]]) };
        const way = planWay(START, [EAST], { ...search(graph, carrying), detour: banked('shantay_pass', 5) });
        expect(withdrawn(way)).toMatchObject({ withdraw: [{ obj: 'shantay_pass', count: 1 }] });
    });
});

describe('the Wilderness: a move into it is planned only when the way starts or ends there', () => {
    // The island moved north by DZ tiles, so the Wilderness's south edge (z 3520) crosses it: the grid's z 3216 and up.
    const DZ = 304;
    const down = <T extends { z: number }>(t: T): T => ({ ...t, z: t.z - DZ });
    const north = (g: Grid): ReachCollision => ({
        zones: g.zones.map(([level, x, z]) => [level, x, z + DZ] as const),
        canStep: (level, x, z, dx, dz) => g.canStep(level, x, z - DZ, dx, dz),
        walkable: (level, x, z) => g.walkable(level, x, z - DZ),
        land: (level, x, z) => g.land(level, x, z - DZ),
        reached: (from, loc) => g.reached(down(from), down(loc)),
        edited: (edits, f) =>
            g.edited(
                {
                    close: edits.close.map(e => ({ ...e, tile: down(e.tile) })),
                    open: edits.open.map(e => ({ ...e, tile: down(e.tile) })),
                },
                f,
            ),
    });
    // From the west shore south of the edge, a teleport lands on the island north of it.
    const FROM = at(0, 3210, 3510);
    const teleport = move({ via: 'teleport', landings: [{ tile: at(0, 3220, 3530), spread: 0 }] }, 3510);
    const graph = walkGraph({ world: { ...empty, crossings: [teleport] }, collision: north(sea()), size, opName });

    test('to the island south of the edge: no way, the teleport lands in the Wilderness', () => {
        expect(nearestWay(FROM, [at(0, 3220, 3510)], search(graph))).toBeUndefined();
    });

    test('to a tile in the Wilderness: through the teleport', () => {
        expect(crossed(nearestWay(FROM, [at(0, 3225, 3530)], search(graph)))).toEqual([teleport.act]);
    });
});

const way = (from: [number, number], to: [number, number], account: Account) =>
    nearestWay(at(0, ...from), [at(0, ...to)], { account, connectors: CONNECTORS, maxHops: MAX_HOPS });

describe('the Waterfall dungeon: the ways out, on the world index', () => {
    const KEY = 'baxtorian_key_waterfall_quest';
    const DOOR = 'baxtorian_door_2_waterfall_quest';
    const keyed = (met: string[] = []): Account => ({
        ...NO_ACCOUNT,
        held: new Map([[KEY, 1]]),
        met: new Set(met),
    });
    const CHALICE: [number, number] = [2603, 9912];
    const PILLARS: [number, number] = [2563, 9912];
    const FALADOR_WEST_BANK: [number, number] = [2946, 3369];
    const USE_KEY: Act = { kind: 'item-on-loc', obj: KEY, loc: DOOR };

    test('from the chalice room to the mainland: Open the Door, the key on the south Door, the entry Door, the Barrel', () => {
        const out = way(CHALICE, FALADOR_WEST_BANK, keyed());
        expect(crossed(out).map(a => (a.kind === 'loc-op' ? `${a.loc} op${a.op}` : a.kind))).toEqual([
            `${DOOR} op1`,
            'item-on-loc',
            'baxtorian_door_waterfall_quest op1',
            'barrel_waterfall_quest op1',
        ]);
        expect(crossed(out)[1]).toEqual(USE_KEY);
    });

    test('without the key there is no way: the Door south of the corridor takes it', () => {
        expect(way(CHALICE, FALADOR_WEST_BANK, NO_ACCOUNT)).toBeUndefined();
    });

    test('the key on the Door (2566, 9901) leads to the chalice room only from stage 8, and the caller says so', () => {
        expect(way(PILLARS, CHALICE, keyed())).toBeUndefined();
        const through = way(PILLARS, [2604, 9901], keyed(['quest:waterfall>=8']));
        expect(crossed(through)).toEqual([USE_KEY]);
        // From the corridor side too (the script does not look at the side).
        expect(crossed(way([2566, 9901], [2604, 9901], keyed(['quest:waterfall>=8'])))).toEqual([USE_KEY]);
    });

    test('the pillar room reaches the mainland through the chalice room once the amulet is placed', () => {
        const out = way(PILLARS, FALADOR_WEST_BANK, keyed(['quest:waterfall>=8']));
        expect(
            crossed(out).map(a =>
                a.kind === 'loc-op' ? `${a.loc} op${a.op}` : a.kind === 'item-on-loc' ? `${a.kind} ${a.loc}` : a.kind,
            ),
        ).toEqual([
            `item-on-loc ${DOOR}`,
            `${DOOR} op1`,
            `item-on-loc ${DOOR}`,
            'baxtorian_door_waterfall_quest op1',
            'barrel_waterfall_quest op1',
        ]);
    });
});
