import { describe, expect, test } from 'bun:test';
import { NO_ACCOUNT, type Account } from '../../lib/account';
import { CONNECTORS, planConnectors, planeOf, type Tile } from '../../lib/connectors';

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
// The prison door at (2848, 10107) on level 1 asks for the cell key or a finished Troll Stronghold.
const DONE: Account = { ...NO_ACCOUNT, met: new Set(['quest:troll']) };
const chainOf = (from: Tile, to: Tile, account: Account = DONE) =>
    planConnectors(from, to, CONNECTORS, account)?.map(c => `${c.direction} ${c.loc.level}:${c.loc.x},${c.loc.z}`);

// The Troll Stronghold's custom stairs (quest_troll.rs2:204-220, `troll_stronghold_stairs` up and
// `troll_stronghold_stairstop` down), read as connectors through classify.ts CONNECTOR_SCRIPTS; the interior is one
// named underground area (connectors.ts UNDERGROUND_AREAS), so a route between its levels climbs them and does not
// leave by the Exit (2823, 10048) or the Stronghold door and walk round the mountain.
describe('Troll Stronghold stairs', () => {
    test('the eight stairs are connectors', () => {
        const rows = CONNECTORS.filter(c => c.loc.x >= 2810 && c.loc.x <= 2875 && c.loc.z >= 10040).map(
            c => `${c.direction} ${c.loc.level}:${c.loc.x},${c.loc.z}`,
        );
        expect(rows.sort()).toEqual(
            [
                'up 0:2852,10061',
                'up 1:2842,10051',
                'up 0:2852,10106',
                'up 1:2842,10108',
                'down 1:2852,10061',
                'down 2:2843,10051',
                'down 1:2852,10107',
                'down 2:2843,10108',
            ].sort(),
        );
    });

    test('the interior is one named plane on every level', () => {
        for (const level of [0, 1, 2]) expect(planeOf(level, 2840, 10080)).toBe(`${level}u-troll-stronghold`);
    });

    test("Burntmeat's kitchen (L1) down to the east side of level 0", () => {
        expect(chainOf(at(1, 2844, 10057), at(0, 2860, 10070))).toEqual(['down 1:2852,10061']);
    });

    test("the generals' room (L2) down to the kitchen (L1) and the east side (L0)", () => {
        expect(chainOf(at(2, 2831, 10088), at(1, 2844, 10057))).toEqual(['down 2:2843,10051']);
        expect(chainOf(at(2, 2831, 10088), at(0, 2860, 10070))).toEqual(['down 2:2843,10051', 'down 1:2852,10061']);
    });

    test("the east side (L0) up to the kitchen (L1) and the generals' room (L2)", () => {
        expect(chainOf(at(0, 2860, 10070), at(1, 2844, 10057))).toEqual(['up 0:2852,10061']);
        expect(chainOf(at(0, 2860, 10070), at(2, 2831, 10088))).toEqual(['up 0:2852,10061', 'up 1:2842,10051']);
    });

    // The prison side of level 0 (the Exit, the Rack, the cells) joins the rest only through the prison door at
    // (2848, 10107) on level 1, whose op is Unlock and which opens without a key at troll_quest >= 30
    // (quest_troll.rs2:222-233): the walker opens it (lib/walk-graph.ts WALKER_OPENS), so the way is the stairs and
    // never the Exit.
    test('the prison side of level 0 is reached by the stairs through the prison door', () => {
        expect(chainOf(at(0, 2823, 10050), at(1, 2844, 10057))).toEqual(['up 0:2852,10106']);
        expect(chainOf(at(1, 2844, 10057), at(0, 2828, 10096))).toEqual(['down 1:2852,10107']);
        expect(chainOf(at(2, 2831, 10088), at(0, 2832, 10079))).toEqual(['down 2:2843,10108', 'down 1:2852,10107']);
    });

    test('without the quest or the key the prison door is not crossed, so there is no way', () => {
        expect(chainOf(at(1, 2844, 10057), at(0, 2828, 10096), NO_ACCOUNT)).toBeUndefined();
        const key: Account = { ...NO_ACCOUNT, held: new Map([['troll_key_prison', 1]]) };
        expect(chainOf(at(1, 2844, 10057), at(0, 2828, 10096), key)).toEqual(['down 1:2852,10107']);
    });
});
