// The loc teleports to a dbrow's coords (sources/dbrow-teleports.ts) on a scripted world: a use-item trigger whose
// row's obj is the act and is held, with members from its row; a loc-op one landing on a findsquare ring; a config
// with its own trigger, or without the op, left out; a landing off land and a loc used from no land reported; and the
// entries the data refutes.
import { describe, expect, test } from 'bun:test';
import { locSizes } from '../place';
import { parseConfigs } from '../sources/configs';
import { deriveDbrowTeleports, findsquareTiles, type DbrowTeleport } from '../sources/dbrow-teleports';
import { parseDbrows } from '../sources/dbrows';
import { parseTriggers } from '../sources/triggers';
import type { Tile } from '../types';
import { at, Grid } from './grid';

const FILE = 'skill_test/scripts/test_rc.rs2';
const SCRIPT = `[oploc1,_test_portal]
def_dbrow $data = ~get_test_data(loc_param(rune_type));
p_telejump(map_findsquare(db_getfield($data, test_table:exit_coord, random(db_getfieldcount($data, test_table:exit_coord)))));

[oplocu,_test_ruins]
if (oc_category(last_useitem) = talismans) {
    p_telejump(map_findsquare(db_getfield($data, test_table:enter_coord, random(db_getfieldcount($data, test_table:enter_coord)))));
}

[oploc1,own_portal]
mes("Not this one.");
`;
// The x 3232-3239 column is walkable but not land (test/grid.ts): the law exit lands there.
const DBROWS = `[test_air]
table=test_table
data=type,1
data=members,0
data=talisman,air_talisman
data=enter_coord,0_50_50_20_20,0,0,0
data=exit_coord,0_50_50_5_5,0,1,0

[test_law]
table=test_table
data=type,2
data=members,1
data=talisman,law_talisman
data=enter_coord,0_50_50_25_25,0,0,0
data=enter_coord,0_50_50_25_25,0,0,0
data=enter_coord,0_50_50_28_25,0,0,0
data=exit_coord,0_50_50_36_5,0,0,0
`;
const LOCS = `[air_ruins]
width=3
length=3
category=test_ruins
param=rune_type,1

[law_ruins]
category=test_ruins
param=rune_type,2

[air_portal]
op1=Use
category=test_portal
param=rune_type,1

[law_portal]
op1=Use
category=test_portal
param=rune_type,2

[own_portal]
op1=Use
category=test_portal
param=rune_type,1

[opless_portal]
category=test_portal
param=rune_type,1
`;
const OBJS = `[air_talisman]
category=talismans

[law_talisman]
category=talismans
`;

const RUINS: DbrowTeleport = {
    trigger: 'oplocu,_test_ruins',
    via: 'teleport',
    table: 'test_table',
    key: { column: 'type', param: 'rune_type' },
    landings: 'enter_coord',
    use: { column: 'talisman', category: 'talismans' },
    members: 'members',
    source: `${FILE}:7`,
};
const PORTAL: DbrowTeleport = {
    trigger: 'oploc1,_test_portal',
    via: 'scripted',
    table: 'test_table',
    key: { column: 'type', param: 'rune_type' },
    landings: 'exit_coord',
    source: `${FILE}:3`,
};

const locConfigs = parseConfigs(LOCS);
const placed = [
    { config: 'air_ruins', tile: at(0, 3210, 3210), shape: 10, rotation: 0 },
    { config: 'law_ruins', tile: at(0, 3220, 3210), shape: 10, rotation: 0 },
    { config: 'air_portal', tile: at(0, 3215, 3225), shape: 10, rotation: 0 },
    // Off land, and nothing round it on land: no tile it is used from.
    { config: 'air_portal', tile: at(0, 3236, 3220), shape: 10, rotation: 0 },
    { config: 'law_portal', tile: at(0, 3225, 3225), shape: 10, rotation: 0 },
    { config: 'own_portal', tile: at(0, 3200, 3220), shape: 10, rotation: 0 },
    { config: 'opless_portal', tile: at(0, 3200, 3228), shape: 10, rotation: 0 },
];
const collision = () =>
    new Grid().block(...placed.filter(l => l.config.endsWith('ruins')).map(l => l.tile), at(0, 3204, 3204));
const derive = (entries: DbrowTeleport[], more: { objs?: string; locs?: string } = {}) => {
    const configs = more.locs ? parseConfigs(more.locs) : locConfigs;
    return deriveDbrowTeleports({
        entries,
        triggers: parseTriggers(FILE, SCRIPT),
        scripts: new Map([[FILE, SCRIPT]]),
        dbrows: parseDbrows(DBROWS),
        locConfigs: configs,
        objConfigs: parseConfigs(more.objs ?? OBJS),
        locs: placed,
        collision: collision(),
        size: locSizes(configs),
    });
};
const key = (t: Tile) => `${t.level} ${t.x} ${t.z}`;

/** No tile blocked. */
const open = () => true;

describe('findsquareTiles', () => {
    test('radius 0 is the coord itself', () =>
        expect(findsquareTiles(['0_50_50_5_5', '0', '0', '0'], open)).toEqual([at(0, 3205, 3205)]));
    test('a ring from min to max, without the blocked tiles', () => {
        const tiles = findsquareTiles(['0_50_50_5_5', '1', '1', '0'], (_l, x, z) => !(x === 3204 && z === 3204));
        expect(tiles).toHaveLength(7);
        expect(tiles.map(key)).not.toContain('0 3205 3205');
    });
    test('the coord when every tile is blocked, as the engine hands it back', () =>
        expect(findsquareTiles(['0_50_50_5_5', '0', '2', '0'], () => false)).toEqual([at(0, 3205, 3205)]));
    test('a line of walk or sight is not read', () =>
        expect(() => findsquareTiles(['0_50_50_5_5', '0', '2', '1'], open)).toThrow(/type 1/));
});

describe('deriveDbrowTeleports', () => {
    const { crossings, unstood, offLand } = derive([RUINS, PORTAL]);
    const row = (loc: string) => crossings.filter(c => 'loc' in c.act && c.act.loc === loc);

    test('a use-item trigger: the row’s obj used on the loc, held, and members where the row says so', () => {
        const [air] = row('air_ruins');
        expect(air!.via).toBe('teleport');
        expect(air!.act).toEqual({ kind: 'item-on-loc', obj: 'air_talisman', loc: 'air_ruins' });
        expect(air!.requires).toEqual([['item:air_talisman:held']]);
        expect(air!.landings).toEqual([{ tile: at(0, 3220, 3220) }]);
        expect(air!.source).toBe(`${FILE}:7`);
        // Done from each tile beside the 3x3 footprint.
        expect(air!.from).toHaveLength(12);
        const [law] = row('law_ruins');
        expect(law!.act).toEqual({ kind: 'item-on-loc', obj: 'law_talisman', loc: 'law_ruins' });
        expect(law!.requires).toEqual([['item:law_talisman:held', 'members']]);
        // The row's coords, each tile once.
        expect(law!.landings.map(l => l.tile)).toEqual([at(0, 3225, 3225), at(0, 3228, 3225)]);
    });

    test('a loc-op trigger lands on every open tile of its coord’s ring, free', () => {
        const [portal, ...more] = row('air_portal');
        expect(more).toEqual([]);
        expect(portal!.via).toBe('scripted');
        expect(portal!.act).toEqual({ kind: 'loc-op', loc: 'air_portal', op: 1 });
        expect(portal!.requires).toEqual([[]]);
        expect(portal!.landings.map(l => key(l.tile))).toEqual(
            [
                [3204, 3205],
                [3204, 3206],
                [3205, 3204],
                [3205, 3205],
                [3205, 3206],
                [3206, 3204],
                [3206, 3205],
                [3206, 3206],
            ].map(([x, z]) => key(at(0, x!, z!))),
        );
    });

    test('a config with its own trigger of the op is left to it, and one without the op is not used by it', () => {
        expect(row('own_portal')).toEqual([]);
        expect(row('opless_portal')).toEqual([]);
    });

    test('a loc used from no tile on land, and a landing off land, are reported and given no row', () => {
        expect(unstood).toEqual([{ trigger: 'oploc1,_test_portal', loc: 'air_portal', tile: at(0, 3236, 3220) }]);
        expect(offLand).toEqual([
            { trigger: 'oploc1,_test_portal', loc: 'law_portal', tile: at(0, 3225, 3225), landing: at(0, 3236, 3205) },
        ]);
        expect(row('law_portal')).toEqual([]);
    });

    test('refuses an entry the data refutes', () => {
        expect(() => derive([{ ...PORTAL, source: `${FILE}:2` }])).toThrow(/not a p_telejump\(map_findsquare/);
        expect(() => derive([{ ...PORTAL, trigger: 'oploc2,_test_portal' }])).toThrow(/no such loc trigger/);
        expect(() => derive([{ ...RUINS, use: undefined }])).toThrow(/a use-item trigger needs a use obj/);
        expect(() => derive([{ ...PORTAL, use: RUINS.use }])).toThrow(/a use-item trigger needs a use obj/);
        expect(() =>
            derive([RUINS], { objs: '[air_talisman]\ncategory=talismans\n[law_talisman]\ncategory=other' }),
        ).toThrow(/law_talisman is not of category talismans/);
        expect(() => derive([RUINS], { locs: LOCS.replace('param=rune_type,2', 'param=rune_type,9') })).toThrow(
            /no test_table row has type 9/,
        );
        expect(() => derive([RUINS], { locs: LOCS.replace('param=rune_type,2\n', '') })).toThrow(
            /law_ruins has no param rune_type/,
        );
    });
});
