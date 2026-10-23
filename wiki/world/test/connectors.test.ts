import { describe, expect, test } from 'bun:test';
import { locSizes, type LocReach } from '../place';
import type { Config } from '../sources/configs';
import {
    deriveConnectors,
    directionOf,
    MAX_PATHS,
    type ConnectorCollision,
    type Connectors,
} from '../sources/connectors';
import { parseConstants } from '../sources/constants';
import { coordTile, tileCoord } from '../sources/runescript';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Feature, Tile } from '../types';

// Scripts in the three forms ladders+stairs/scripts/*.rs2 use (tables keyed by the loc's tile, jumps
// relative to the player or the loc, labels called with coords), and the constructs that stop them.
const LADDERS = `[oploc1,ladder]
p_arrivedelay;
switch_coord (loc_coord) {
    case 0_50_50_10_10 : @ladder_quest; // a quest's ladder
    case default : ~climb_ladder(movecoord(coord(), 0, 1, 0), true);
}

[oploc1,laddertop]
p_arrivedelay;
~taunt(coord);
~climb_ladder(movecoord(coord(), 0, -1, 0), false);

[oploc1,ladder_cellar]
def_coord $coord = loc_coord;
if (loc_coord = 0_50_150_0_0) {
    ~climb_ladder(0_50_50_5_5, true);
    return;
}
~climb_ladder(movecoord(coord(), 0, 0, 6400), false);

[proc,climb_ladder](coord $coord, boolean $up)
anim(human_reachforladder, 0);
p_delay(0);
p_telejump($coord);

[label,ladder_quest]
if (%quest < ^quest_done) {
    mes("The trapdoor will not open.");
} else {
    ~climb_ladder(movecoord(coord(), 0, 1, 0), true);
}

[proc,taunt](coord $c)
while (npc_findnext = true) {
    npc_say("Die intruder!!!");
}
`;

const STAIRS = `[oploc1,stairs]
switch_coord (loc_coord) {
    case 0_50_50_20_20 : p_telejump(1_50_50_21_22); // explicit
    case default : @unhandled_stairs(loc_coord);
}

[oploc1,stairsmiddle]
switch_coord (loc_coord) {
    case 1_50_50_20_20 : @stair_options(2_50_50_21_22, 0_50_50_21_22);
    case default : @unhandled_stairs(loc_coord);
}

[oploc2,stairsmiddle]
switch_coord (loc_coord) {
    case 1_50_50_20_20 : p_telejump(2_50_50_21_22);
}

[oploc1,woodstairs]
switch_int (loc_angle) {
    case 0 : p_telejump(movecoord(loc_coord, 2, 1, 0));
    case 1 : p_telejump(movecoord(loc_coord, 0, 1, -1));
}

[oploc1,boardstairs]
def_int $randomX = ~random_range(-1, 1);
p_telejump(movecoord(1_34_77_30_5, $randomX, 0, 0));

[oploc1,loopstairs]
@loop_label;

[oploc1,loststairs]
@nowhere;

[label,loop_label]
while (true) { p_telejump(coord); }

[label,stair_options](coord $up, coord $down)
def_int $option = ~p_choice2_header("Climb up the stairs.", 1, "Climb down the stairs.", 2, "Climb up or down?");
if ($option = 1) {
    p_telejump($up);
} else if ($option = 2) {
    p_telejump($down);
}

[label,unhandled_stairs](coord $coord)
mes("Unhandled stairs: <~coord_tostring($coord)>");
`;

const LADDERS_FILE = 'ladders+stairs/scripts/ladders.rs2';
const STAIRS_FILE = 'ladders+stairs/scripts/stairs.rs2';
const triggers = [...parseTriggers(LADDERS_FILE, LADDERS), ...parseTriggers(STAIRS_FILE, STAIRS)];
const callables = [...parseCallables(LADDERS_FILE, LADDERS), ...parseCallables(STAIRS_FILE, STAIRS)];

/** `file:line` of the first line of `text` holding `needle`. */
const lineOf = (file: string, text: string, needle: string): string =>
    `${file}:${text.split('\n').findIndex(l => l.includes(needle)) + 1}`;

const configs = new Map<string, Config>([
    ['ladder', { op1: ['Climb-up'] }],
    ['laddertop', { op1: ['Climb-down'] }],
    ['ladder_cellar', { op1: ['Climb-down'] }],
    ['stairs', { op1: ['Climb-up'], width: ['2'], length: ['2'] }],
    ['stairsmiddle', { op1: ['Climb'], op2: ['Climb-up'], width: ['2'], length: ['2'] }],
    ['woodstairs', { op1: ['Climb-up'] }],
    ['boardstairs', {}],
    ['loopstairs', { op1: ['Climb-up'] }],
    ['loststairs', { op1: ['Climb-up'] }],
]);
const size = locSizes(configs);

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const loc = (config: string, tile: Tile, rotation = 0): Feature => ({
    source: 'loc',
    id: 1,
    config,
    tile,
    shape: 10,
    rotation,
    kind: 'connector',
    subtype: '',
    name: config,
});
const key = (t: Tile) => `${t.level},${t.x},${t.z}`;

/**
 * Every tile walkable and on land but the blocked (and, for `land`, the offLand) ones; a loc is reached
 * from a tile on its footprint or sharing an edge with it, as place.test.ts's stub.
 */
function stub(blocked: Tile[] = [], offLand: Tile[] = []): ConnectorCollision {
    const closed = new Set(blocked.map(key));
    const sea = new Set(offLand.map(key));
    return {
        walkable: (level, x, z) => !closed.has(key(at(level, x, z))),
        land: (level, x, z) => !sea.has(key(at(level, x, z))),
        reached: (from: Tile, l: LocReach) => {
            const [w, len] = l.rotation % 2 === 1 ? [l.length, l.width] : [l.width, l.length];
            const dx = from.x < l.x ? l.x - from.x : from.x > l.x + w - 1 ? from.x - (l.x + w - 1) : 0;
            const dz = from.z < l.z ? l.z - from.z : from.z > l.z + len - 1 ? from.z - (l.z + len - 1) : 0;
            return dx + dz <= 1;
        },
    };
}

/** The loc tiles of `features`, blocked as a ladder's or staircase's own tiles are. */
const footprints = (features: Feature[]): Tile[] =>
    features.flatMap(f => {
        const n = f.config.includes('stairs') && f.config !== 'woodstairs' ? 2 : 1;
        return Array.from({ length: n * n }, (_, i) =>
            at(f.tile.level, f.tile.x + (i % n), f.tile.z + Math.floor(i / n)),
        );
    });

const derive = (features: Feature[], blocked: Tile[] = [], offLand: Tile[] = []): Connectors =>
    deriveConnectors({
        features,
        triggers,
        callables,
        locConfigs: configs,
        collision: stub([...footprints(features), ...blocked], offLand),
        size,
    });

/** `derive` over other scripts, each a `[file, text]`, and their configs. */
const deriveWith = (
    script: [string, string],
    features: Feature[],
    locConfigs: Map<string, Config>,
    others: [string, string][] = [],
): Connectors =>
    deriveConnectors({
        features,
        triggers: [script, ...others].flatMap(([f, t]) => parseTriggers(f, t)),
        callables: [script, ...others].flatMap(([f, t]) => parseCallables(f, t)),
        locConfigs,
        collision: stub(footprints(features)),
        size: locSizes(locConfigs),
    });

/** The rows for one feature, as `op direction landing stand` lines. */
const rowsOf = (out: Connectors, feature: number): string[] =>
    out.connectors
        .filter(c => c.feature === feature)
        .map(
            c =>
                `op${c.op} ${c.opName} ${c.direction} ${key(c.landing)} from ${c.stand ? key(c.stand) : '-'}${c.relative ? ' relative' : ''}`,
        );

describe('coord literals', () => {
    test('level_mx_mz_x_z is the tile 64 * mx + x, 64 * mz + z, and back', () => {
        expect(coordTile('0_50_50_4_7')).toEqual(at(0, 3204, 3207));
        expect(coordTile('1_48_149_31_40')).toEqual(at(1, 3103, 9576));
        expect(tileCoord(at(1, 3103, 9576))).toBe('1_48_149_31_40');
    });
});

describe('directionOf', () => {
    test('by level; on one level into or out of the underground; else other', () => {
        expect(directionOf(at(0, 3200, 3200), at(1, 3200, 3201))).toBe('up');
        expect(directionOf(at(2, 3200, 3200), at(1, 3200, 3201))).toBe('down');
        expect(directionOf(at(0, 3200, 3200), at(0, 3200, 9600))).toBe('down');
        expect(directionOf(at(0, 3200, 9600), at(0, 3200, 3200))).toBe('up');
        expect(directionOf(at(0, 3200, 9600), at(0, 3300, 9700))).toBe('other');
    });
});

describe('explicit tables: switch_coord (loc_coord) keyed by the loc tile', () => {
    test("a case lands where it says; the stand is the reach tile nearest the way back's landing", () => {
        // The middle floor's Climb-down lands at (3221, 3222), north of the ground floor's stairs: the
        // ground floor's stand is that tile, not the reach tile first by position.
        const out = derive([loc('stairs', at(0, 3220, 3220)), loc('stairsmiddle', at(1, 3220, 3220))]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-up up 1,3221,3222 from 0,3221,3222']);
        expect(out.connectors[0]!.source).toBe(lineOf(STAIRS_FILE, STAIRS, 'case 0_50_50_20_20'));
        // Up and back down pair; the middle floor's two ways up have no top floor to come back from.
        expect(out.oneWay.map(i => out.connectors[i]!.direction)).toEqual(['up', 'up']);
        expect(out.oneWay.every(i => out.connectors[i]!.feature === 1)).toBe(true);
    });

    test('a tile with no case, whose default never moves the player, is underived with both constructs', () => {
        const out = derive([loc('stairs', at(0, 3300, 3300))]);
        expect(out.connectors).toEqual([]);
        expect(out.underived).toEqual([
            {
                feature: 0,
                loc: at(0, 3300, 3300),
                config: 'stairs',
                op: 1,
                reason:
                    `\`switch_coord (loc_coord)\` (${lineOf(STAIRS_FILE, STAIRS, 'switch_coord (loc_coord) {')}) has no case for it, ` +
                    `then \`@unhandled_stairs(loc_coord)\` (${lineOf(STAIRS_FILE, STAIRS, 'case default : @unhandled_stairs')}) does not move the player`,
            },
        ]);
    });
});

describe('labels shared by several locs', () => {
    test('a label called with coords lands on each; a dialog choice is a row per landing', () => {
        const out = derive([loc('stairsmiddle', at(1, 3220, 3220))]);
        expect(rowsOf(out, 0)).toEqual([
            'op1 Climb down 0,3221,3222 from 1,3219,3220',
            'op1 Climb up 2,3221,3222 from 1,3219,3220',
            'op2 Climb-up up 2,3221,3222 from 1,3219,3220',
        ]);
        // The coords were written in the case that called the label.
        expect(out.connectors[0]!.source).toBe(lineOf(STAIRS_FILE, STAIRS, 'case 1_50_50_20_20 : @stair_options'));
    });

    test("a label's branch on a varp is taken both ways, and the one that climbs lands", () => {
        const out = derive([loc('ladder', at(0, 3210, 3210))]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-up up 1,3209,3210 from 0,3209,3210 relative']);
        expect(out.underived).toEqual([]);
    });
});

describe("a category's triggers", () => {
    test("run for an op the config has no trigger of its own for, as the engine's getByTrigger picks", () => {
        const file = 'ladders+stairs/scripts/category.rs2';
        const text = `[oploc1,_cat_ladder]
p_telejump(movecoord(loc_coord, 1, 1, 0));

[oploc2,_cat_ladder]
p_telejump(movecoord(loc_coord, 0, 1, 1));

[oploc1,catladder_own]
p_telejump(movecoord(loc_coord, 0, 2, 0));
`;
        // A quest's own op2 for its ladder, outside ladders+stairs/, also replaces the category's.
        const quest: [string, string] = [
            'quests/quest_x/scripts/ladder.rs2',
            '[oploc2,catladder_quest]\nmes("No.");\n',
        ];
        const out = deriveWith(
            [file, text],
            [loc('catladder_own', at(0, 3400, 3400)), loc('catladder_quest', at(0, 3410, 3410))],
            new Map([
                ['catladder_own', { category: ['cat_ladder'], op1: ['Climb-up'], op2: ['Climb'] }],
                ['catladder_quest', { category: ['cat_ladder'], op1: ['Climb-up'], op2: ['Climb'] }],
            ]),
            [quest],
        );
        expect(out.connectors.map(c => `${c.feature} op${c.op} ${key(c.landing)}`)).toEqual([
            '0 op1 2,3400,3400',
            '0 op2 1,3400,3401',
            '1 op1 1,3411,3410',
        ]);
        expect(out.underived).toEqual([]);
    });

    test("a config's own aploc1 is another trigger type: it does not hide the category's oploc1", () => {
        const file = 'ladders+stairs/scripts/category.rs2';
        const text = '[oploc1,_cat_ladder]\np_telejump(movecoord(loc_coord, 1, 1, 0));\n';
        const quest: [string, string] = ['quests/quest_x/scripts/ladder.rs2', '[aploc1,catladder_ap]\nmes("No.");\n'];
        const out = deriveWith(
            [file, text],
            [loc('catladder_ap', at(0, 3420, 3420))],
            new Map([['catladder_ap', { category: ['cat_ladder'], op1: ['Climb-up'] }]]),
            [quest],
        );
        expect(out.connectors.map(c => `${c.feature} op${c.op} ${key(c.landing)}`)).toEqual(['0 op1 1,3421,3420']);
        expect(out.underived).toEqual([]);
    });
});

describe('relative jumps', () => {
    test("movecoord(coord(), ...) shifts the player's tile: the landing is the stand moved", () => {
        const out = derive([loc('ladder', at(0, 3230, 3230))]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-up up 1,3229,3230 from 0,3229,3230 relative']);
        expect(out.connectors[0]!.source).toBe(lineOf(LADDERS_FILE, LADDERS, 'case default : ~climb_ladder'));
    });

    test('the stand is one whose landing is walkable land', () => {
        // West, south and north of the ladder land in the sea or on a wall upstairs; east does not.
        const out = derive(
            [loc('ladder', at(0, 3230, 3230))],
            [at(1, 3230, 3229)],
            [at(1, 3229, 3230), at(1, 3230, 3231)],
        );
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-up up 1,3231,3230 from 0,3231,3230 relative']);
    });

    test('then one whose landing reaches a connector, so the way back is used from where the player lands', () => {
        // The ladder below is at (3230, 3230); of the hatch's four reach tiles only its south one lands
        // beside it.
        const out = derive([loc('ladder', at(0, 3230, 3230)), loc('laddertop', at(1, 3230, 3232))]);
        expect(rowsOf(out, 1)).toEqual(['op1 Climb-down down 0,3230,3231 from 1,3230,3231 relative']);
    });

    test('switch_int (loc_angle) picks the jump by rotation; movecoord(loc_coord, ...) shifts the loc tile', () => {
        const out = derive([loc('woodstairs', at(0, 3240, 3240), 0), loc('woodstairs', at(0, 3250, 3250), 1)]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-up up 1,3242,3240 from 0,3239,3240']);
        expect(rowsOf(out, 1)).toEqual(['op1 Climb-up up 1,3250,3249 from 0,3249,3250']);
        // Nothing comes back down from either.
        expect(out.oneWay).toEqual([0, 1]);
    });

    test('if (loc_coord = <coord>) picks one loc out; the rest fall through to the relative jump', () => {
        const out = derive([loc('ladder_cellar', at(0, 3200, 9600)), loc('ladder_cellar', at(0, 3260, 3260))]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-down up 0,3205,3205 from 0,3199,9600']);
        expect(rowsOf(out, 1)).toEqual(['op1 Climb-down down 0,3259,9660 from 0,3259,3260 relative']);
    });

    test('a proc that never moves the player is passed over unread, even with a construct the parser lacks', () => {
        const out = derive([loc('laddertop', at(1, 3270, 3270))]);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-down down 0,3269,3270 from 1,3269,3270 relative']);
        expect(out.underived).toEqual([]);
    });
});

describe('an op that swaps its loc (general_use/scripts/trapdoors.rs2, manholes.rs2)', () => {
    const file = 'general_use/scripts/trapdoors.rs2';
    const text = `[oploc1,trapdoor]
mes("The trapdoor opens...");
sound_synth(door_open, 1, 0);
loc_change(trapdoor_open, 500);

[oploc1,trapdoor_open]
mes("You climb down through the trapdoor...");
p_telejump(movecoord(coord(), 0, 0, 6400));

[oploc2,trapdoor_open]
mes("You close the trapdoor.");
sound_synth(door_close, 1, 0);
loc_change(trapdoor, 500);

[oploc1,manhole]
mes("You pull back the cover from over the manhole.");
loc_change(manhole_open, 400);
loc_add(movecoord(loc_coord, 0, 0, -1), manhole_cover, loc_angle, loc_shape, 400);

[oploc1,grate]
if (%grate_unlocked = 1) {
    loc_change(grate_open, 500);
}

[oploc1,chute]
loc_change(chute_open, 500);
p_telejump(movecoord(coord(), 0, 1, 0));

[oploc1,manhole_open]
p_telejump(movecoord(coord(), 0, 0, 6400));

[oploc1,grate_open]
p_telejump(movecoord(coord(), 0, 0, 6400));

[oploc1,chute_open]
p_telejump(movecoord(coord(), 0, 0, 6400));
`;
    const trapdoorConfigs = new Map<string, Config>([
        ['trapdoor', { op1: ['Open'] }],
        ['trapdoor_open', { op1: ['Climb-down'], op2: ['Close'] }],
        ['manhole', { op1: ['Open'] }],
        ['manhole_open', { op1: ['Climb-down'] }],
        ['grate', { op1: ['Open'] }],
        ['grate_open', { op1: ['Climb-down'] }],
        ['chute', { op1: ['Slide'] }],
        ['chute_open', { op1: ['Climb-down'] }],
    ]);
    const move = lineOf(file, text, 'p_telejump(movecoord(coord(), 0, 0, 6400));');

    test("is followed: the placed loc's op lands where the swapped-in loc's moving op does, named in `thenOp`", () => {
        const out = deriveWith([file, text], [loc('trapdoor', at(0, 3230, 3230))], trapdoorConfigs);
        // Close, the open trapdoor's op2, swaps back and moves no one: no row, and nothing underived.
        expect(out.connectors).toEqual([
            {
                feature: 0,
                loc: at(0, 3230, 3230),
                op: 1,
                opName: 'Open',
                direction: 'down',
                landing: at(0, 3229, 9630),
                stand: at(0, 3229, 3230),
                relative: true,
                source: move,
                thenOp: { op: 1, opName: 'Climb-down' },
            },
        ]);
        expect(out.underived).toEqual([]);
    });

    test('a placed open trapdoor climbs down itself; its Close is underived, naming the swap', () => {
        const out = deriveWith([file, text], [loc('trapdoor_open', at(0, 3240, 3240))], trapdoorConfigs);
        expect(rowsOf(out, 0)).toEqual(['op1 Climb-down down 0,3239,9640 from 0,3239,3240 relative']);
        expect(out.connectors[0]!.thenOp).toBeUndefined();
        expect(out.underived.map(u => [u.op, u.reason])).toEqual([
            [
                2,
                `\`loc_change(trapdoor, 500)\` (${lineOf(file, text, 'loc_change(trapdoor, 500)')}) turns it into trapdoor, none of whose ops moves the player`,
            ],
        ]);
    });

    test('a swap beside a loc_add on another tile (the manhole cover) is still followed', () => {
        const out = deriveWith([file, text], [loc('manhole', at(0, 3250, 3250))], trapdoorConfigs);
        expect(rowsOf(out, 0)).toEqual(['op1 Open down 0,3249,9650 from 0,3249,3250 relative']);
        expect(out.connectors[0]!.thenOp).toEqual({ op: 1, opName: 'Climb-down' });
        expect(out.underived).toEqual([]);
    });

    test('a loc_change under a condition, or beside a move, is not followed', () => {
        const out = deriveWith(
            [file, text],
            [loc('grate', at(0, 3260, 3260)), loc('chute', at(0, 3270, 3270))],
            trapdoorConfigs,
        );
        expect(out.underived.map(u => [u.config, u.reason])).toEqual([
            ['grate', `${lineOf(file, text, '[oploc1,grate]')} never moves the player`],
        ]);
        // The chute's own move is its landing: one level up, not the open chute's drop.
        expect(rowsOf(out, 1)).toEqual(['op1 Slide up 1,3269,3270 from 0,3269,3270 relative']);
        expect(out.connectors[0]!.thenOp).toBeUndefined();
    });
});

describe('what stops a derivation is reported, never guessed', () => {
    test('a landing computed from a random offset names the unknown value', () => {
        const out = derive([loc('boardstairs', at(0, 3280, 3280))]);
        expect(out.connectors).toEqual([]);
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`p_telejump(movecoord(1_34_77_30_5, $randomX, 0, 0))\` (${lineOf(STAIRS_FILE, STAIRS, 'p_telejump(movecoord(1_34_77_30_5')}): $randomX is not known offline`,
        ]);
    });

    test('a construct the parser does not read is named with its line', () => {
        const out = derive([loc('loopstairs', at(0, 3290, 3290))]);
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`while (true) { p_telejump(coord); }\` (${lineOf(STAIRS_FILE, STAIRS, 'while (true)')}) is not read`,
        ]);
    });

    test('a return of several values ends that path, named with its line', () => {
        const file = 'ladders+stairs/scripts/pair.rs2';
        const text = `[oploc1,pairstairs]
return(1, 2);
p_telejump(1_50_50_30_30);
`;
        const out = deriveWith(
            [file, text],
            [loc('pairstairs', at(0, 3230, 3230))],
            new Map([['pairstairs', { op1: ['Climb-up'] }]]),
        );
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`return\` (${lineOf(file, text, 'return(1, 2)')}) returns 2 values`,
        ]);
        expect(out.connectors).toEqual([]);
    });

    test('a jump to a label no script defines', () => {
        const out = derive([loc('loststairs', at(0, 3295, 3295))]);
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`@nowhere\` (${lineOf(STAIRS_FILE, STAIRS, '@nowhere;')}) jumps to a label no script defines`,
        ]);
    });

    test('a proc that can move the player, used as a value, ends that path and is named', () => {
        const file = 'ladders+stairs/scripts/trapdoors.rs2';
        const text = `[oploc1,trapdoor]
if (~trapdoor_drop(coord) = true) {
    p_telejump(0_50_150_30_30);
}

[oploc1,hatch]
if (~has_key = true) {
    p_telejump(1_50_50_30_30);
}

[proc,trapdoor_drop](coord $c)
p_telejump(movecoord($c, 0, 0, 6400));
return(true);

[proc,has_key]
return(true);
`;
        const out = deriveWith(
            [file, text],
            [loc('trapdoor', at(0, 3230, 3230)), loc('hatch', at(0, 3240, 3240))],
            new Map([
                ['trapdoor', { op1: ['Climb-down'] }],
                ['hatch', { op1: ['Climb-up'] }],
            ]),
        );
        expect(out.underived.map(u => [u.config, u.reason])).toEqual([
            [
                'trapdoor',
                `\`~trapdoor_drop(coord)\` (${lineOf(file, text, 'if (~trapdoor_drop')}) moves the player inside a value`,
            ],
        ]);
        // A proc that never moves the player is still an unknown value, taken both ways.
        expect(out.connectors.map(c => `${c.feature} ${key(c.landing)}`)).toEqual(['1 1,3230,3230']);
    });

    test('an unfollowable proc that several paths reach is named once', () => {
        const file = 'ladders+stairs/scripts/trapdoors.rs2';
        const text = `[oploc1,trapdoor]
if (%trapdoor_seen = 1) {
    mes("Again.");
}
def_boolean $dropped = ~trapdoor_drop(coord);

[proc,trapdoor_drop](coord $c)
p_telejump(movecoord($c, 0, 0, 6400));
return(true);
`;
        const out = deriveWith(
            [file, text],
            [loc('trapdoor', at(0, 3230, 3230))],
            new Map([['trapdoor', { op1: ['Climb-down'] }]]),
        );
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`~trapdoor_drop(coord)\` (${lineOf(file, text, 'def_boolean $dropped')}) moves the player inside a value`,
        ]);
        expect(out.connectors).toEqual([]);
    });

    test('a landing not known offline that several paths reach is named once', () => {
        const file = 'ladders+stairs/scripts/drop.rs2';
        const text = `[oploc1,dropstairs]
if (%dropstairs_seen = 1) {
    mes("Again.");
}
p_telejump($nowhere);
`;
        const out = deriveWith(
            [file, text],
            [loc('dropstairs', at(0, 3260, 3260))],
            new Map([['dropstairs', { op1: ['Climb-down'] }]]),
        );
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`p_telejump($nowhere)\` (${lineOf(file, text, 'p_telejump($nowhere)')}): $nowhere is not known offline`,
        ]);
    });

    test('a callee the parser does not read, that several paths reach, is named once', () => {
        const file = 'ladders+stairs/scripts/loop.rs2';
        const text = `[oploc1,loopladder]
if (%loopladder_seen = 1) {
    mes("Again.");
}
~loop_climb;

[proc,loop_climb]
while (true) { p_telejump(coord); }
`;
        const out = deriveWith(
            [file, text],
            [loc('loopladder', at(0, 3270, 3270))],
            new Map([['loopladder', { op1: ['Climb-up'] }]]),
        );
        expect(out.underived.map(u => u.reason)).toEqual([
            `\`while (true) { p_telejump(coord); }\` (${lineOf(file, text, 'while (true)')}) is not read`,
        ]);
    });

    test(`an op that branches past ${MAX_PATHS} ways is underived, its landings dropped`, () => {
        const file = 'ladders+stairs/scripts/maze.rs2';
        const ifs = Array.from({ length: Math.log2(MAX_PATHS) + 1 }, (_, i) => `if (%maze_${i} = 1) { mes("${i}"); }`);
        const text = `[oploc1,mazestairs]\n${ifs.join('\n')}\np_telejump(1_50_50_40_40);\n\n[oploc1,shortstairs]\n${ifs.slice(1).join('\n')}\np_telejump(1_50_50_40_40);\n`;
        const out = deriveWith(
            [file, text],
            [loc('mazestairs', at(0, 3240, 3240)), loc('shortstairs', at(0, 3250, 3250))],
            new Map([
                ['mazestairs', { op1: ['Climb-up'] }],
                ['shortstairs', { op1: ['Climb-up'] }],
            ]),
        );
        expect(out.underived.map(u => [u.config, u.reason])).toEqual([
            ['mazestairs', `too many paths: ${file}:1 branches past ${MAX_PATHS} ways`],
        ]);
        // Exactly MAX_PATHS paths still run.
        expect(out.connectors.map(c => `${c.feature} ${key(c.landing)}`)).toEqual(['1 1,3240,3240']);
    });

    test('a relative landing with no tile on land reaching the loc', () => {
        const ring = [at(0, 3299, 3300), at(0, 3301, 3300), at(0, 3300, 3299), at(0, 3300, 3301)];
        const out = derive([loc('ladder', at(0, 3300, 3300))], ring);
        expect(out.connectors).toEqual([]);
        expect(out.underived.map(u => u.reason)).toEqual([
            `the landing is the player's tile shifted (${lineOf(LADDERS_FILE, LADDERS, 'case default : ~climb_ladder')}), and no tile on land reaches the loc`,
        ]);
    });
});

describe('gangplanks: moves that chain, a value proc and constants (general_use/scripts/gangplank.rs2)', () => {
    // The generic gangplank scripts as the game has them: a step onto the plank, then a jump on from there,
    // by a sign `~gangplank_dir_mod` reads off the loc's angle.
    const file = 'general_use/scripts/gangplank.rs2';
    const text = `[proc,gangplank_dir_mod]()(int)
switch_int (loc_angle) {
    case ^loc_west,^loc_north : return (1);
    case ^loc_east,^loc_south : return (-1);
}
return (0);

[oploc1,_gangplank_board]
def_int $dir_mod = ~gangplank_dir_mod;
def_string $board_mes = loc_param(board_message);
switch_int (loc_angle) {
    case ^loc_west,^loc_east :
        p_teleport(movecoord(coord, $dir_mod, 0, 0));
        p_delay(0);
        p_telejump(movecoord(coord, calc(2 * $dir_mod), 1, 0));
    case ^loc_north,^loc_south :
        p_teleport(movecoord(coord, 0, 0, calc(-1 * $dir_mod)));
        p_delay(0);
        p_telejump(movecoord(coord, 0, 1, calc(-2 * $dir_mod)));
}
if(string_length($board_mes) ! 0) {
    mes($board_mes);
}

[oploc1,_gangplank_disembark]
def_int $dir_mod = ~gangplank_dir_mod;
switch_int (loc_angle) {
    case ^loc_west,^loc_east :
        p_teleport(movecoord(coord, calc(-1 * $dir_mod), 0, 0));
        p_delay(0);
        p_telejump(movecoord(coord, calc(-2 * $dir_mod), -1, 0));
    case ^loc_north,^loc_south :
        p_teleport(movecoord(coord, 0, 0, $dir_mod));
        p_delay(0);
        p_telejump(movecoord(coord, 0, -1, calc(2 * $dir_mod)));
}
`;
    const constants = parseConstants('engine.constant', '^loc_west = 0\n^loc_north = 1\n^loc_east = 2\n^loc_south = 3');
    const planks = new Map<string, Config>([
        ['plank_on', { op1: ['Cross'], category: ['gangplank_board'] }],
        ['plank_off', { op1: ['Cross'], category: ['gangplank_disembark'] }],
    ]);
    const run = (features: Feature[], withConstants = true): Connectors =>
        deriveConnectors({
            features,
            triggers: parseTriggers(file, text),
            callables: parseCallables(file, text),
            locConfigs: planks,
            collision: stub(footprints(features)),
            size: locSizes(planks),
            ...(withConstants ? { constants } : {}),
        });

    test('boarding lands where the second move leaves the player: the stand shifted 3 off the quay, a level up', () => {
        // A ship moored south of the quay: the plank at angle 1 (north) on the quay, its partner on the deck.
        const out = run([loc('plank_on', at(0, 3030, 3217), 1), loc('plank_off', at(1, 3030, 3216), 1)]);
        expect(rowsOf(out, 0)).toEqual(['op1 Cross up 1,3030,3215 from 0,3030,3218 relative']);
        expect(rowsOf(out, 1)).toEqual(['op1 Cross down 0,3030,3218 from 1,3030,3215 relative']);
        expect(out.connectors[0]!.source).toBe(lineOf(file, text, 'p_telejump(movecoord(coord, 0, 1, calc(-2'));
        expect(out.oneWay).toEqual([]);
        expect(out.underived).toEqual([]);
    });

    test("the value proc's sign follows the angle: at angle 0 (west) boarding goes 3 east", () => {
        const out = run([loc('plank_on', at(0, 3030, 3217), 0)]);
        expect(rowsOf(out, 0)).toEqual(['op1 Cross up 1,3032,3217 from 0,3029,3217 relative']);
    });

    test('without the angle constants the sign is not known, and the op is underived, never guessed', () => {
        const out = run([loc('plank_on', at(0, 3030, 3217), 1)], false);
        expect(out.connectors).toEqual([]);
        expect(out.underived.length).toBeGreaterThan(0);
        expect(out.underived.every(u => u.op === 1 && u.reason.includes('is not known offline'))).toBe(true);
    });
});
