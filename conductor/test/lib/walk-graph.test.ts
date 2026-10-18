import { describe, expect, test } from 'bun:test';
import { locSizes } from '../../../wiki/world/place';
import { fillReach, wallTiles } from '../../../wiki/world/reach';
import { readConfigs } from '../../../wiki/world/sources/configs';
import { at, Grid } from '../../../wiki/world/test/grid';
import type { Crossing, Gate, Transport } from '../../../wiki/world/types';
import { type Account, NO_ACCOUNT } from '../../lib/account';
import { CONNECTORS, MAX_HOPS } from '../../lib/connectors';
import { doorRefusal, nearestWay, walkGraph, type WalkGraph } from '../../lib/walk-graph';
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

describe('the walk search crosses a door only when the walker opens it', () => {
    test('with 99 in every skill, a pick-lock door and a crumbly wall shortcut are still not crossed', () => {
        for (const loc of ['loc_2551', 'castlecrumbly']) {
            const ticks = across(row(loc), maxed());
            expect(ticks === undefined || ticks > CROSSED, `${loc}: ${ticks}`).toBe(true);
        }
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
/** A search of a scripted world's walk graph, with nothing met but `{}`. */
const search = (graph: WalkGraph) => ({ account: NO_ACCOUNT, connectors: [], maxHops: MAX_HOPS, graph });

describe('the walk search ignores every edge kind it does not walk', () => {
    const size = locSizes(new Map());
    const WEST = at(0, 3205, 3220);
    const EAST = at(0, 3225, 3220);
    const ship: Transport = {
        kind: 'ship',
        npc: 'sailor',
        from: at(0, 3210, 3210),
        to: EAST,
        fare: 0,
        requires: [],
        source: 'sail.rs2:1',
    };
    const move = (via: Crossing['via']): Crossing => ({
        via,
        act:
            via === 'scripted'
                ? { kind: 'loc-op', loc: 'log_balance', op: 1 }
                : { kind: 'npc-op', npc: 'aubury', op: 4 },
        at: at(0, 3214, 3220),
        from: [at(0, 3215, 3220)],
        landings: [{ tile: EAST, spread: 0 }],
        requires: [[]],
        source: 'a.rs2:1',
    });
    const empty = { features: [], connectors: [], gates: [], transports: [], crossings: [] };

    test.each([
        ['a ship', { ...empty, transports: [ship] }],
        ['a scripted move', { ...empty, crossings: [move('scripted')] }],
        ['a teleport', { ...empty, crossings: [move('teleport')] }],
    ])('%s to the island, free: the fill reaches it, the walk does not', (_, world) => {
        expect(fillReach({ world, collision: sea(), size, start: WEST }).setsAt(EAST)).toEqual([[]]);
        const graph = walkGraph({ world, collision: sea(), size, opName: () => undefined });
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
        const graph = walkGraph({ world: { ...empty, gates: [gate] }, collision: grid, size, opName: () => 'Open' });
        // 10 steps to the door's west tile, the crossing, 9 steps on.
        expect(nearestWay(WEST, [EAST], search(graph))?.runTicks).toBe(Math.ceil((10 + 2 * 2 + 9) / 2));
    });
});
