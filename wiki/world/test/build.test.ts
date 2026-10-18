import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    addReach,
    byWritten,
    expectedUnreached,
    failed,
    formatReport,
    formatScripted,
    formatNpcTeleports,
    formatTeleports,
    formatUnreached,
    nearestReached,
    serializeWorld,
    unreachedPockets,
    type BuildReport,
    type HintScan,
    type OpUser,
    type Pocket,
    type Unreached,
} from '../build';
import { loadWorld } from '../load';
import { besideCluster, grownBox, locSizes, type Placed, type StepCollision } from '../place';
import { fillReach, reachGraph } from '../reach';
import type { Trigger } from '../sources/triggers';
import { WORLD_FORMAT, type Crossing, type Feature, type NpcSpawn, type Site, type Tile, type World } from '../types';
import { Grid } from './grid';

const tree = (x: number, z: number, config = 'tree'): Feature => ({
    source: 'loc',
    id: 1276,
    config,
    tile: { level: 0, x, z },
    shape: 10,
    rotation: 0,
    kind: 'tree',
    subtype: 'normal',
    name: 'Tree',
});

const world: World = {
    format: WORLD_FORMAT,
    generatedFrom: 'abc',
    areas: [{ id: 'town', name: 'Town', rects: [{ x1: 0, z1: 0, x2: 9, z2: 9 }] }],
    features: [tree(1, 2), tree(3, 4)],
    sites: [],
    npcSpawns: [
        {
            config: 'man',
            areaPath: ['town'],
            centre: { level: 0, x: 5, z: 5 },
            bbox: { x1: 4, z1: 5, x2: 6, z2: 5, level: 0 },
            count: 2,
            f2p: true,
            reach: [[]],
        },
    ],
    connectors: [
        {
            feature: 0,
            loc: { level: 0, x: 1, z: 2 },
            op: 1,
            opName: 'Climb-up',
            direction: 'up',
            landing: { level: 1, x: 1, z: 3 },
            stand: { level: 0, x: 1, z: 3 },
            relative: true,
            source: 'ladders+stairs/scripts/ladders.rs2:81',
        },
        // A trapdoor: Open swaps in the open trapdoor, whose Climb-down moves the player.
        {
            feature: 1,
            loc: { level: 0, x: 3, z: 4 },
            op: 1,
            opName: 'Open',
            direction: 'down',
            landing: { level: 0, x: 2, z: 6404 },
            stand: { level: 0, x: 2, z: 4 },
            relative: true,
            source: 'general_use/scripts/trapdoors.rs2:11',
            thenOp: { op: 1, opName: 'Climb-down' },
        },
    ],
    quests: [
        {
            id: 'ball',
            varp: 'ballquest',
            varpId: 226,
            complete: 7,
            stages: {},
            source: 'boy.rs2:13',
            varpDecreases: 'witch.rs2:25: set back',
        },
    ],
    loadoutRules: {
        entrana: { forbidCategories: { weapon_axe: 'both', cannon_parts: 'carried' }, source: 'monk.rs2:26' },
    },
    transports: [
        {
            kind: 'ship',
            route: 'port_sarim_to_karamja',
            npc: 'captain_tobias',
            from: { level: 0, x: 3028, z: 3216 },
            to: { level: 1, x: 2956, z: 3143 },
            fare: 30,
            requires: ['coins:30'],
            source: 'sailors.rs2:31',
            paidAt: ['sailors.rs2:29'],
        },
    ],
    gates: [
        {
            trigger: 'oploc1,chefdoor',
            kind: 'gate',
            loc: 'chefdoor',
            tile: { level: 0, x: 3143, z: 3443 },
            shape: 0,
            angle: 1,
            requires: [['item:chefs_hat:worn', 'skill:cooking:32']],
            from: 'far',
            source: 'skill_cooking/scripts/cooking_guild.rs2:4',
        },
        {
            trigger: 'oploc1,miningguildladder',
            kind: 'gate',
            loc: 'miningguildladder',
            tile: { level: 0, x: 3018, z: 3339 },
            shape: 10,
            angle: 0,
            requires: [['skill:mining:60']],
            landings: [{ stand: { level: 0, x: 3017, z: 3339 }, landing: { level: 0, x: 3017, z: 9739 } }],
            source: 'areas/area_falador/scripts/mining_guild.rs2:2',
        },
        {
            trigger: 'oploc1,_jungle_bush',
            kind: 'gate',
            loc: 'kharazi_jungle_plant1',
            tile: { level: 0, x: 2760, z: 2937 },
            shape: 10,
            angle: 0,
            requires: [['category:weapon_axe:held', 'item:machette:held', 'quest:legends']],
            opens: true,
            source: 'quests/quest_legends/scripts/jungle_tree.rs2:8',
        },
    ],
    crossings: [
        // A teleport with a random landing of two tiles, and a rolled shortcut that fails onto another tile.
        {
            via: 'teleport',
            act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
            at: { level: 0, x: 2984, z: 3291 },
            from: [{ level: 0, x: 2984, z: 3290 }],
            landings: [
                { tile: { level: 0, x: 2841, z: 4829 }, spread: 1 },
                { tile: { level: 0, x: 2842, z: 4829 }, spread: 1 },
            ],
            requires: [['item:air_talisman:held']],
            source: 'skill_runecraft/scripts/runecraft.rs2:45',
        },
        {
            via: 'scripted',
            act: { kind: 'loc-op', loc: 'log_balance', op: 1 },
            at: { level: 0, x: 2602, z: 3336 },
            from: [{ level: 0, x: 2603, z: 3336 }],
            landings: [{ tile: { level: 0, x: 2598, z: 3336 }, spread: 0 }],
            requires: [['skill:agility:33']],
            roll: {
                stat: 'agility',
                low: 60,
                high: 250,
                source: 'agility.rs2:10',
                fail: { ticks: 4, to: { level: 0, x: 2600, z: 3330 }, damage: 3, back: 4 },
            },
            source: 'agility.rs2:12',
        },
    ],
};

/** The message loadWorld refuses `bad` with, less the file's name; `read` when it reads it. */
const refused = (bad: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'world-'));
    try {
        const file = join(dir, 'world.json');
        writeFileSync(file, JSON.stringify(bad));
        try {
            loadWorld(file);
        } catch (e) {
            return (e as Error).message.replace(`${file} `, '');
        }
        return 'read';
    } finally {
        rmSync(dir, { recursive: true });
    }
};

describe('serializeWorld', () => {
    test('one area, feature, site, npc spawn cluster, connector, quest, rule, transport, gate or crossing per line, empty lists inline, a trailing newline', () => {
        expect(serializeWorld(world)).toBe(
            [
                '{',
                `  "format": ${WORLD_FORMAT},`,
                '  "generatedFrom": "abc",',
                '  "areas": [',
                '    {"id":"town","name":"Town","rects":[{"x1":0,"z1":0,"x2":9,"z2":9}]}',
                '  ],',
                '  "features": [',
                `    ${JSON.stringify(tree(1, 2))},`,
                `    ${JSON.stringify(tree(3, 4))}`,
                '  ],',
                '  "sites": [],',
                '  "npcSpawns": [',
                '    {"config":"man","areaPath":["town"],"centre":{"level":0,"x":5,"z":5},"bbox":{"x1":4,"z1":5,"x2":6,"z2":5,"level":0},"count":2,"f2p":true,"reach":[[]]}',
                '  ],',
                '  "connectors": [',
                '    {"feature":0,"loc":{"level":0,"x":1,"z":2},"op":1,"opName":"Climb-up","direction":"up","landing":{"level":1,"x":1,"z":3},"stand":{"level":0,"x":1,"z":3},"relative":true,"source":"ladders+stairs/scripts/ladders.rs2:81"},',
                '    {"feature":1,"loc":{"level":0,"x":3,"z":4},"op":1,"opName":"Open","direction":"down","landing":{"level":0,"x":2,"z":6404},"stand":{"level":0,"x":2,"z":4},"relative":true,"source":"general_use/scripts/trapdoors.rs2:11","thenOp":{"op":1,"opName":"Climb-down"}}',
                '  ],',
                '  "quests": [',
                '    {"id":"ball","varp":"ballquest","varpId":226,"complete":7,"stages":{},"source":"boy.rs2:13","varpDecreases":"witch.rs2:25: set back"}',
                '  ],',
                '  "loadoutRules": {',
                '    "entrana": {"forbidCategories":{"weapon_axe":"both","cannon_parts":"carried"},"source":"monk.rs2:26"}',
                '  },',
                '  "transports": [',
                '    {"kind":"ship","route":"port_sarim_to_karamja","npc":"captain_tobias","from":{"level":0,"x":3028,"z":3216},"to":{"level":1,"x":2956,"z":3143},"fare":30,"requires":["coins:30"],"source":"sailors.rs2:31","paidAt":["sailors.rs2:29"]}',
                '  ],',
                '  "gates": [',
                '    {"trigger":"oploc1,chefdoor","kind":"gate","loc":"chefdoor","tile":{"level":0,"x":3143,"z":3443},"shape":0,"angle":1,"requires":[["item:chefs_hat:worn","skill:cooking:32"]],"from":"far","source":"skill_cooking/scripts/cooking_guild.rs2:4"},',
                '    {"trigger":"oploc1,miningguildladder","kind":"gate","loc":"miningguildladder","tile":{"level":0,"x":3018,"z":3339},"shape":10,"angle":0,"requires":[["skill:mining:60"]],"landings":[{"stand":{"level":0,"x":3017,"z":3339},"landing":{"level":0,"x":3017,"z":9739}}],"source":"areas/area_falador/scripts/mining_guild.rs2:2"},',
                '    {"trigger":"oploc1,_jungle_bush","kind":"gate","loc":"kharazi_jungle_plant1","tile":{"level":0,"x":2760,"z":2937},"shape":10,"angle":0,"requires":[["category:weapon_axe:held","item:machette:held","quest:legends"]],"opens":true,"source":"quests/quest_legends/scripts/jungle_tree.rs2:8"}',
                '  ],',
                '  "crossings": [',
                `    ${JSON.stringify(world.crossings[0])},`,
                `    ${JSON.stringify(world.crossings[1])}`,
                '  ]',
                '}',
                '',
            ].join('\n'),
        );
    });

    test('leaves out undefined fields, so an npc feature has no shape or rotation', () => {
        const npc: Feature = {
            source: 'npc',
            id: 2,
            config: 'man',
            tile: { level: 0, x: 1, z: 1 },
            kind: 'pickpocket',
            subtype: 'man',
            name: 'Man',
        };
        const line = serializeWorld({ ...world, features: [{ ...npc, shape: undefined }] })
            .split('\n')
            .find(l => l.includes('"config":"man"'))!;
        expect(JSON.parse(line)).toEqual(npc);
        expect(line).not.toContain('shape');
    });

    test('loadWorld reads back what serializeWorld wrote', () => {
        const dir = mkdtempSync(join(tmpdir(), 'world-'));
        try {
            const file = join(dir, 'world.json');
            writeFileSync(file, serializeWorld(world));
            expect(loadWorld(file)).toEqual(world);
            // An act, a roll and a transport's act, written and read back.
            const more: World = {
                ...world,
                gates: [{ ...world.gates[0]!, roll: world.crossings[1]!.roll! }],
                transports: [
                    {
                        ...world.transports[0]!,
                        act: { kind: 'npc-op', npc: 'captain_tobias', op: 1, choices: ['Yes please.'] },
                    },
                ],
            };
            writeFileSync(file, serializeWorld(more));
            expect(loadWorld(file)).toEqual(more);
            writeFileSync(file, `{"format":${WORLD_FORMAT},"areas":[]}`);
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
            // A format-3 file written before quests and transports, with its format bumped by hand, is still
            // refused; so are a format-5 one without gates and one whose loadoutRules is not an object.
            const { quests: _, loadoutRules: _r, transports: _t, ...before } = world;
            writeFileSync(file, JSON.stringify(before));
            expect(() => loadWorld(file)).toThrow(
                /needs generatedFrom, areas, features, sites, npcSpawns, connectors, quests, loadoutRules, transports, gates and crossings/,
            );
            const { gates: _g, ...noGates } = world;
            writeFileSync(file, JSON.stringify(noGates));
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
            writeFileSync(file, JSON.stringify({ ...world, loadoutRules: [] }));
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
            const { crossings: _c, ...noCrossings } = world;
            writeFileSync(file, JSON.stringify(noCrossings));
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    describe('loadWorld refuses a malformed crossing-model field, naming its row', () => {
        const [teleport, shortcut] = world.crossings as [Crossing, Crossing];
        const withCrossing = (c: unknown) => ({ ...world, crossings: [teleport, c] });
        const roll = shortcut.roll!;

        test.each([
            ['a via it does not know', { ...shortcut, via: 'ship' }, 'crossings[1]: a via of "ship"'],
            ['an act of no kind', { ...shortcut, act: { kind: 'swim' } }, 'crossings[1]: an act of kind "swim"'],
            [
                'an item-on-loc with both an obj and a category',
                { ...teleport, act: { kind: 'item-on-loc', obj: 'a', category: 'b', loc: 'c' } },
                'crossings[1]: an item-on-loc act needs a loc and one of an obj or a category',
            ],
            [
                'a loc-op of op 6',
                { ...shortcut, act: { kind: 'loc-op', loc: 'x', op: 6 } },
                'crossings[1]: a loc-op act needs a loc and an op 1-5',
            ],
            [
                'npc-op choices that are not texts',
                { ...shortcut, act: { kind: 'npc-op', npc: 'aubury', op: 3, choices: [2] } },
                'crossings[1]: an npc-op act needs an npc, an op 1-5, and choices, when it has them, as option texts',
            ],
            ['no landings', { ...teleport, landings: [] }, 'crossings[1]: no landings'],
            [
                'a spread that is not run ticks',
                { ...teleport, landings: [{ tile: teleport.landings[0]!.tile, spread: -1 }] },
                'crossings[1]: a landing needs a tile, and spread, when it has one, as run ticks',
            ],
            [
                'a roll with no fail',
                { ...shortcut, roll: { ...roll, fail: undefined } },
                "crossings[1]: a roll's fail needs ticks and damage",
            ],
            [
                'a way back with no fail tile',
                { ...shortcut, roll: { ...roll, fail: { ticks: 4, damage: 0, back: 2 } } },
                "crossings[1]: a roll's fail.back is run ticks from its fail.to",
            ],
            ['a rolled row with no source', { ...shortcut, source: undefined }, 'crossings[1]: no source'],
            [
                'requires with no set (the free form is [[]])',
                { ...teleport, requires: [] },
                'crossings[1]: its requires has no set, so nothing makes the move ([[]] asks for nothing)',
            ],
        ])('%s', (_, row, why) => {
            expect(refused(withCrossing(row))).toBe(`is not a world.json: ${why}: regenerate it with bun run world`);
        });

        test("a gate's roll and a transport's act are checked too", () => {
            expect(
                refused({ ...world, gates: [world.gates[0], { ...world.gates[1], roll: { stat: 'agility' } }] }),
            ).toBe(
                'is not a world.json: gates[1]: a roll needs a stat, whole low and high bounds, and a source: regenerate it with bun run world',
            );
            expect(refused({ ...world, transports: [{ ...world.transports[0], act: { kind: 'interface' } }] })).toBe(
                'is not a world.json: transports[0]: an interface act needs a component: regenerate it with bun run world',
            );
        });
    });
});

test('byWritten orders by kind, then x, z, level and config', () => {
    const fs = [tree(5, 1), tree(1, 9, 'oaktree'), { ...tree(1, 1), kind: 'rock' as const }, tree(1, 9)];
    expect(fs.sort(byWritten).map(f => `${f.kind} ${f.tile.x},${f.tile.z} ${f.config}`)).toEqual([
        'rock 1,1 tree',
        'tree 1,9 oaktree',
        'tree 1,9 tree',
        'tree 5,1 tree',
    ]);
});

test('loadWorld refuses a file of another format, or of none, and says how to regenerate it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'world-'));
    try {
        const file = join(dir, 'world.json');
        writeFileSync(file, serializeWorld({ ...world, format: WORLD_FORMAT + 1 }));
        expect(() => loadWorld(file)).toThrow(`format ${WORLD_FORMAT + 1}, this code reads format ${WORLD_FORMAT}`);
        const { format: _, ...old } = world;
        writeFileSync(file, JSON.stringify(old));
        expect(() => loadWorld(file)).toThrow(/format none.*regenerate it with bun run world/);
        // Format 10 was written before sites and npc spawn clusters had their reach.
        writeFileSync(file, serializeWorld({ ...world, format: 10 }));
        expect(() => loadWorld(file)).toThrow(`format 10, this code reads format ${WORLD_FORMAT}`);
        // Format 11 was written before resource and processor sites had their nearest bank.
        writeFileSync(file, serializeWorld({ ...world, format: 11 }));
        expect(() => loadWorld(file)).toThrow(`format 11, this code reads format ${WORLD_FORMAT}`);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

const at = (x: number, z: number) => ({ level: 0, x, z });

describe('formatReport', () => {
    const report: BuildReport = {
        features: { bank: 3, tree: 2 },
        sites: { bank: 1, tree: 1 },
        uncovered: [],
        npcUncovered: [],
        unpacked: {},
        log: [],
        connectors: { derived: 3, locs: 2, oneWay: [], underived: {}, offLand: [] },
        quests: { count: 68, overrides: ['cog', 'ikov'], unread: [], stale: [] },
        transports: {
            ships: 19,
            routes: 9,
            curated: 2,
            windows: [],
            underived: [],
            unreached: [],
            staleOutOfScope: [],
            unusedRoutes: [],
            other: [],
            outOfScope: [],
        },
        gates: {
            candidates: 3,
            kinds: { gate: 2, 'side-effect': 1 },
            placed: 4,
            forms: { quest: 1, skill: 1 },
            unreviewed: [],
            stale: [],
            drifted: [],
            invalid: [],
            unnamed: [],
            unplaced: [],
            unclear: [],
            windows: [],
            other: [],
            skippedCheckers: [],
            landings: {
                counts: { to: 0, landings: 0, opens: 0, underived: 0, windows: 0 },
                underived: [],
                offLand: [],
                unlanded: [],
                rolled: 0,
                unrolled: [],
            },
        },
        scripted: {
            rows: 0,
            counts: { triggers: {}, locs: { rows: 0, unsettled: 0, duplicate: 0, door: 0, 'not-a-passage': 0 } },
            unsettled: [],
            duplicates: [],
        },
        teleports: { rows: 0, unstood: [], offLand: [] },
        npcTeleports: { rows: 0, unstood: [], offLand: [], unjoined: [], other: [] },
        reach: {
            nodes: 64,
            reached: 10,
            free: 8,
            byLevel: [10, 0, 0, 0],
            sets: 2,
            labels: 11,
            edges: { connectors: 0, gates: 1, transports: 0, crossings: 0 },
            openTiles: 0,
            offLand: 0,
            bound: { max: 16, tiles: 0, sample: [] },
            skipped: [],
            ms: 1,
            bytes: 1024,
        },
        distance: {
            contexts: { bank: 1, furnace: 0, range: 0, anvil: 0 },
            sinks: { bank: 1, furnace: 0, range: 0, anvil: 0 },
            found: { bank: 1, furnace: 0, range: 0, anvil: 0 },
            missing: { bank: 0, furnace: 0, range: 0, anvil: 0 },
            settled: 10,
            ms: 1,
            bytes: 1024,
        },
        unpriced: [],
        unreached: { pockets: [], expected: 0, invalid: [], stale: [] },
    };
    const gatesLine =
        'gates: 3 candidates, by kind gate 2, side-effect 1; 4 placed; requirement forms quest 1, skill 1';
    const landingsLine =
        'gate moves on objects: 0 to, 0 landings, 0 opens, 0 underived (rows; 0 quest windows left as they are); ' +
        '0 gate rows behind a roll';
    const scriptedLine =
        'scripted moves: 0 crossing rows; triggers ; placed locs rows 0, unsettled 0, duplicate 0, door 0, not-a-passage 0';
    const teleportsLine = 'dbrow teleports: 0 crossing rows (gates.ts DBROW_TELEPORTS)';
    const npcTeleportsLine = 'npc teleports: 0 crossing rows (gates.ts NPC_TELEPORTS)';
    const tail = [
        'quests: 68, 2 of them from gates.ts overrides (cog, ikov)',
        'transports: 19 ship rows on 9 routes, 2 curated rows',
        gatesLine,
        landingsLine,
        scriptedLine,
        teleportsLine,
        npcTeleportsLine,
    ];

    test('counts, then coverage, then connectors, quests, transports and gates', () =>
        expect(formatReport(report)).toEqual([
            'features: bank 3, tree 2',
            'sites: bank 1, tree 1',
            'coverage: every site of a covered kind lies in an area',
            'connectors: 3 derived on 2 locs, 0 one-way, 0 underived',
            ...tail,
        ]));

    test('warns of the crossing costs the distances could not price, after the gate moves', () => {
        const unpriced = ['teleport item-on-loc air_talisman ruins (3214, 3221): no walk to its landing (3220, 3220)'];
        expect(formatReport({ ...report, unpriced }).slice(-2)).toEqual([
            'warning: 1 crossing costs the distances could not price, those edges not taken:',
            `  ${unpriced[0]}`,
        ]);
    });

    test('lists the one-way and off-land connectors, and the underived ops by what stopped them', () => {
        const lines = formatReport({
            ...report,
            connectors: {
                derived: 3,
                locs: 2,
                oneWay: ['ladder (1, 2) op1 Climb-up -> (1, 3) L1 (ladders.rs2:81)'],
                offLand: ['ladder (5, 5) op1 Climb-up -> (5, 6) L4 (ladders.rs2:62)'],
                underived: {
                    '`@unhandled_stairs(loc_coord)` (stairs.rs2:42) does not move the player': [
                        'stairs (9, 9) op1',
                        'stairs (8, 8) op1',
                    ],
                },
            },
        });
        expect(lines.slice(3)).toEqual([
            'connectors: 3 derived on 2 locs, 1 one-way, 2 underived',
            'warning: 1 one-way connectors (none back within 5 tiles):',
            '  ladder (1, 2) op1 Climb-up -> (1, 3) L1 (ladders.rs2:81)',
            'warning: 1 connectors land off walkable land:',
            '  ladder (5, 5) op1 Climb-up -> (5, 6) L4 (ladders.rs2:62)',
            'warning: 2 connector ops with no landing, by what stopped them:',
            '  `@unhandled_stairs(loc_coord)` (stairs.rs2:42) does not move the player: 2',
            '    stairs (9, 9) op1, stairs (8, 8) op1',
            ...tail,
        ]);
    });

    test('lists the uncovered sites and the warnings', () => {
        const lines = formatReport({
            ...report,
            uncovered: ['tree:unnamed:0'],
            npcUncovered: ['npc:unnamed:0'],
            unpacked: { 'loc 9': 2 },
        });
        expect(lines.slice(2)).toEqual([
            'ERROR coverage: 1 sites outside every area:',
            '  tree:unnamed:0',
            'warning: 1 npc site outside every area:',
            '  npc:unnamed:0',
            'warning: placements with no config in the pack: loc 9 2',
            'connectors: 3 derived on 2 locs, 0 one-way, 0 underived',
            ...tail,
        ]);
    });

    test('counts the npc sites outside every area and lists the first ten', () => {
        const npcUncovered = Array.from({ length: 12 }, (_, i) => `npc:unnamed:${i}`);
        const lines = formatReport({ ...report, npcUncovered });
        expect(lines.slice(3)).toEqual([
            'warning: 12 npc sites outside every area, the first 10:',
            ...npcUncovered.slice(0, 10).map(id => `  ${id}`),
            'connectors: 3 derived on 2 locs, 0 one-way, 0 underived',
            ...tail,
        ]);
    });

    test('lists the quest and transport errors, warnings and notes, and failed says when to exit 1', () => {
        expect(failed(report)).toBe(false);
        const bad: BuildReport = {
            ...report,
            quests: { ...report.quests, unread: ['upass: `1` is not a varp (q.rs2:1)'], stale: ['ikov: not needed'] },
            transports: {
                ...report.transports,
                windows: ['ned (1, 2) -> port_sarim_to_crandor: `%dragonquest = ^x` (ned.rs2:4)'],
                underived: ['sailor (s.rs2:1): `while (true) {` (s.rs2:2): a loop is not followed'],
                unreached: ['boat.rs2:9'],
                staleOutOfScope: ['trawler.rs2:36'],
                unusedRoutes: ['crandor_to_port_sarim'],
                other: ['sailor -> karamja: other:`x = 1` (s.rs2:3)'],
                outOfScope: ['gliders (glider.rs2:7): a menu'],
            },
        };
        expect(formatReport(bad).slice(4)).toEqual([
            'quests: 68, 2 of them from gates.ts overrides (cog, ikov)',
            'ERROR quests: 1 journal calls or quests not read, with no override in gates.ts:',
            '  upass: `1` is not a varp (q.rs2:1)',
            'ERROR quests: 1 entries in gates.ts not needed:',
            '  ikov: not needed',
            'transports: 19 ship rows on 9 routes, 2 curated rows',
            'ERROR transports: 1 sail sites no npc op reaches (derive, curate or list them out of scope in gates.ts):',
            '  boat.rs2:9',
            'ERROR transports: 1 sail sites gates.ts lists out of scope are gone or now reached:',
            '  trawler.rs2:36',
            'warning: 1 sail scripts the walker could not finish:',
            '  sailor (s.rs2:1): `while (true) {` (s.rs2:2): a loop is not followed',
            'warning: 1 transport requirements in no other form:',
            '  sailor -> karamja: other:`x = 1` (s.rs2:3)',
            'sail paths left out as quest windows: 1',
            '  ned (1, 2) -> port_sarim_to_crandor: `%dragonquest = ^x` (ned.rs2:4)',
            'sail routes no npc sails: crandor_to_port_sarim',
            'transports out of scope (gates.ts): 1',
            '  gliders (glider.rs2:7): a menu',
            gatesLine,
            landingsLine,
            scriptedLine,
            teleportsLine,
            npcTeleportsLine,
        ]);
        expect(failed(bad)).toBe(true);
        for (const one of [
            { ...report, uncovered: ['bank:x'] },
            { ...report, quests: { ...report.quests, unread: ['x'] } },
            { ...report, quests: { ...report.quests, stale: ['x'] } },
            { ...report, transports: { ...report.transports, unreached: ['x'] } },
            { ...report, transports: { ...report.transports, staleOutOfScope: ['x'] } },
            { ...report, gates: { ...report.gates, unreviewed: ['x'] } },
            { ...report, gates: { ...report.gates, stale: ['x'] } },
            { ...report, gates: { ...report.gates, drifted: ['x'] } },
            { ...report, gates: { ...report.gates, invalid: ['x'] } },
            { ...report, gates: { ...report.gates, unnamed: ['x'] } },
            { ...report, scripted: { ...report.scripted, duplicates: ['x'] } },
            { ...report, unreached: { ...report.unreached, invalid: ['x'] } },
            { ...report, unreached: { ...report.unreached, stale: ['x'] } },
        ])
            expect(failed(one)).toBe(true);
    });

    test('lists the stale EXPECTED_UNREACHED entries as an error', () => {
        const stale = {
            ...report,
            unreached: { pockets: [], expected: 0, invalid: [], stale: ['area isle (i.rs2:1)'] },
        };
        expect(formatReport(stale).slice(-2)).toEqual([
            'ERROR unreached: 1 areas.ts EXPECTED_UNREACHED entries no unreached site matches (reached now, or gone):',
            '  area isle (i.rs2:1)',
        ]);
        expect(failed(stale)).toBe(true);
    });

    test('lists the EXPECTED_UNREACHED entries naming no area or site as their own error', () => {
        const invalid = {
            ...report,
            unreached: { pockets: [], expected: 0, invalid: ['site rock:cvae:0 (c.rs2:2)'], stale: [] },
        };
        expect(formatReport(invalid).slice(-2)).toEqual([
            'ERROR unreached: 1 areas.ts EXPECTED_UNREACHED entries name no such area or site (a typo?):',
            '  site rock:cvae:0 (c.rs2:2)',
        ]);
        expect(failed(invalid)).toBe(true);
    });

    test('lists the gate errors, warnings, unclear entries and quest windows; warnings alone do not fail', () => {
        const gates: BuildReport['gates'] = {
            ...report.gates,
            unreviewed: ['oploc1,newdoor (d.rs2:1): gate'],
            stale: ['oploc1,olddoor (d.rs2:9)'],
            drifted: ["oploc1,movedoor (m.rs2:3): the scan's proposal changed from 00000000; read the trigger again"],
            invalid: ['oploc1,chefdoor (c.rs2:4): the scan proposes side-effect'],
            unnamed: ['oploc1,x (x.rs2:2): quest:ball>=3'],
            unplaced: ['oploc1,ghost (g.rs2:1)'],
            other: ['oploc1,odd: other:`x = 1` (o.rs2:3)'],
            unclear: ['oploc1,maze (m.rs2:1): too many paths'],
            windows: ['oploc1,dragonshipgangplank_on (l.rs2:1): open only while the ship is bought'],
            skippedCheckers: ['~god_staff_checker (c.rs2:51): returns a staff under a cape check'],
        };
        expect(formatReport({ ...report, gates }).slice(-25)).toEqual([
            gatesLine,
            'ERROR gates: 1 candidates gates.ts does not review (confirm or reject each):',
            '  oploc1,newdoor (d.rs2:1): gate',
            'ERROR gates: 1 gates.ts entries the scan no longer finds:',
            '  oploc1,olddoor (d.rs2:9)',
            'ERROR gates: 1 gates.ts overrides whose scan proposal changed (read each trigger again):',
            "  oploc1,movedoor (m.rs2:3): the scan's proposal changed from 00000000; read the trigger again",
            'ERROR gates: 1 gates.ts entries malformed or at odds with the scan:',
            '  oploc1,chefdoor (c.rs2:4): the scan proposes side-effect',
            'ERROR gates: 1 quest stages no constant names:',
            '  oploc1,x (x.rs2:2): quest:ball>=3',
            'warning: 1 gates with no placed loc:',
            '  oploc1,ghost (g.rs2:1)',
            'warning: 1 gate requirements in no other form:',
            '  oploc1,odd: other:`x = 1` (o.rs2:3)',
            'warning: 1 *_checker procs not read as tool checkers (a script testing one reads as unread):',
            '  ~god_staff_checker (c.rs2:51): returns a staff under a cape check',
            "gates the scan can't settle (unclear): 1",
            '  oploc1,maze (m.rs2:1): too many paths',
            'quest windows, kept out of the fill: 1',
            '  oploc1,dragonshipgangplank_on (l.rs2:1): open only while the ship is bought',
            landingsLine,
            scriptedLine,
            teleportsLine,
            npcTeleportsLine,
        ]);
        expect(
            failed({
                ...report,
                gates: { ...report.gates, unplaced: ['x'], other: ['y'], unclear: ['z'], skippedCheckers: ['w'] },
            }),
        ).toBe(false);
    });

    test('counts the gate moves on objects, lists the underived rows by trigger and the landings off land', () => {
        const landings: BuildReport['gates']['landings'] = {
            counts: { to: 1, landings: 2, opens: 3, underived: 3, windows: 1 },
            rolled: 0,
            unrolled: [],
            underived: [
                { trigger: 'oploc1,pipe', loc: 'pipe', tile: at(1, 1), reasons: ['no path moves (p.rs2:2)'] },
                {
                    trigger: 'oploc1,bridge',
                    loc: 'bridge',
                    tile: at(5, 5),
                    reasons: ['no tile on land reaches the loc'],
                },
                {
                    trigger: 'oploc1,bridge',
                    loc: 'bridge',
                    tile: at(5, 6),
                    reasons: ['no tile on land reaches the loc'],
                },
            ],
            offLand: [
                {
                    trigger: 'oploc1,rock',
                    loc: 'rock',
                    tile: at(9, 9),
                    stand: at(8, 9),
                    landing: at(10, 9),
                    at: 'r.rs2:7',
                },
            ],
            unlanded: [
                {
                    trigger: 'oploc1,rock',
                    loc: 'rock',
                    tile: at(9, 9),
                    stand: at(9, 8),
                    reasons: ['a (r.rs2:2)', 'b (r.rs2:3)'],
                },
            ],
        };
        const lines = formatReport({ ...report, gates: { ...report.gates, landings } });
        expect(lines.slice(-13)).toEqual([
            'gate moves on objects: 1 to, 2 landings, 3 opens, 3 underived (rows; 1 quest windows left as they are); ' +
                '0 gate rows behind a roll',
            'warning: 3 gate rows on objects with no landing derived, by trigger:',
            '  oploc1,bridge: 2 (bridge (5, 5), bridge (5, 6))',
            '    no tile on land reaches the loc',
            '  oploc1,pipe: 1 (pipe (1, 1))',
            '    no path moves (p.rs2:2)',
            'warning: 1 gate landings off walkable land, left out:',
            '  oploc1,rock rock (9, 9) from (8, 9) -> (10, 9) (r.rs2:7)',
            'warning: 1 stands of gate rows with landings that give no landing, left out:',
            '  oploc1,rock rock (9, 9) from (9, 8): a (r.rs2:2); b (r.rs2:3)',
            scriptedLine,
            teleportsLine,
            npcTeleportsLine,
        ]);
        // Warnings: they do not fail the build.
        expect(failed({ ...report, gates: { ...report.gates, landings } })).toBe(false);
    });

    test('the scripted moves: rows and counts, duplicates of a connector (an error), then the unsettled by trigger', () => {
        const scripted: BuildReport['scripted'] = {
            rows: 3,
            counts: {
                triggers: { rows: 2, unsettled: 2 },
                locs: { rows: 2, unsettled: 6, duplicate: 1, door: 0, 'not-a-passage': 0 },
            },
            duplicates: ['oploc1,ladder ladder (5, 5) op1'],
            unsettled: [
                { trigger: 'oploc1,pit', loc: 'pit', tile: at(1, 1), reasons: ['`x` (p.rs2:2) is not known offline'] },
                ...[1, 2, 3, 4, 5].map(x => ({
                    trigger: 'oploc1,rope',
                    loc: 'rope',
                    tile: at(x, 9),
                    stand: at(x, 8),
                    reasons: [`lands on 2 tiles: (${x}, 10), (${x}, 11)`],
                })),
            ],
        };
        expect(formatScripted(scripted)).toEqual([
            'scripted moves: 3 crossing rows; triggers rows 2, unsettled 2; placed locs rows 2, unsettled 6, duplicate 1, door 0, not-a-passage 0',
            "ERROR scripted: 1 moves on a connector's loc and op, refused:",
            '  oploc1,ladder ladder (5, 5) op1',
            'warning: 6 scripted moves whose landing no bound run settles, by trigger:',
            '  oploc1,rope: 5 (rope (1, 9) from (1, 8), rope (2, 9) from (2, 8), rope (3, 9) from (3, 8), rope (4, 9) from (4, 8) and 1 more)',
            '    lands on 2 tiles: (1, 10), (1, 11)',
            '    lands on 2 tiles: (2, 10), (2, 11)',
            '    lands on 2 tiles: (3, 10), (3, 11)',
            '    lands on 2 tiles: (4, 10), (4, 11)',
            '    lands on 2 tiles: (5, 10), (5, 11)',
            '  oploc1,pit: 1 (pit (1, 1))',
            '    `x` (p.rs2:2) is not known offline',
        ]);
        expect(failed({ ...report, scripted })).toBe(true);
        expect(failed({ ...report, scripted: { ...scripted, duplicates: [] } })).toBe(false);
    });

    test('the dbrow teleports: rows, then the locs given none and the landings left out, as warnings', () => {
        const teleports: BuildReport['teleports'] = {
            rows: 2,
            unstood: [{ trigger: 'oploc1,_rc_exit_portal', loc: 'portal', tile: at(4, 4) }],
            offLand: [{ trigger: 'oplocu,_rc_ruins', loc: 'ruins', tile: at(1, 1), landing: at(9, 9) }],
        };
        expect(formatTeleports(teleports)).toEqual([
            'dbrow teleports: 2 crossing rows (gates.ts DBROW_TELEPORTS)',
            'warning: 1 dbrow teleport locs no tile on land is used from, no row:',
            '  oploc1,_rc_exit_portal portal (4, 4)',
            'warning: 1 dbrow teleport landings off walkable land, left out:',
            '  oplocu,_rc_ruins ruins (1, 1) -> (9, 9)',
        ]);
        expect(failed({ ...report, teleports })).toBe(false);
    });

    test('the npc teleports: rows, then the npcs and locs given none, the landings and ways back left out and other: requirements', () => {
        const npcTeleports: BuildReport['npcTeleports'] = {
            rows: 3,
            unstood: [{ trigger: 'opnpc3,wizard', config: 'wizard', tile: at(4, 4) }],
            offLand: [{ trigger: 'oploc1,portal', config: 'portal', tile: at(1, 1), landing: at(9, 9) }],
            unjoined: ['loc-op 1 portal (1, 1): other:came from hermit'],
            other: ['loc-op 1 portal: other:came from wizard'],
        };
        expect(formatNpcTeleports(npcTeleports)).toEqual([
            'npc teleports: 3 crossing rows (gates.ts NPC_TELEPORTS)',
            'warning: 1 npc teleport npcs and locs no tile on land is used from, no row:',
            '  opnpc3,wizard wizard (4, 4)',
            'warning: 1 npc teleport landings off walkable land, left out:',
            '  oploc1,portal portal (1, 1) -> (9, 9)',
            'warning: 1 npc teleport ways back to an npc no walk gets to the teleport of, no row:',
            '  loc-op 1 portal (1, 1): other:came from hermit',
            'warning: 1 npc teleport requirements in no other form:',
            '  loc-op 1 portal: other:came from wizard',
        ]);
        expect(failed({ ...report, npcTeleports })).toBe(false);
    });
});

test('loadWorld names a file that is not valid JSON and says how to regenerate it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'world-'));
    try {
        const file = join(dir, 'world.json');
        writeFileSync(file, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n');
        expect(() => loadWorld(file)).toThrow(/world\.json is not valid JSON \(.*\): regenerate it with bun run world/);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

const tile = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const key = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;
/** A fill that reaches exactly these tiles. */
const reachedOnly =
    (...ts: Tile[]) =>
    (t: Tile) =>
        ts.some(r => key(r) === key(t));
/** An unreached row of a site with an id of the form `kind:area:n`. */
const unreachedRow = (id: string, areaPath: string[], from: Tile, nearest: Tile | null, stand = true): Unreached => ({
    id,
    kind: id.slice(0, id.indexOf(':')) as Site['kind'],
    areaPath,
    at: from,
    stand,
    nearest,
});

/** With no walls about, every tile of a cluster's bbox grown by one is beside it. */
const open = (c: Placed<NpcSpawn>): Tile[] => grownBox(c.bbox, c.centre.level);
/** Whether two tiles share an edge. */
const edge = (a: Tile, b: Tile): boolean => Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;
/** A wall between x 30 and 31: whether a move from `from` to column `x` crosses it westward. */
const across31 = (from: Tile, x: number): boolean => from.x === 31 && x === 30;

describe('reach on sites and npc spawn clusters', () => {
    /** A fill that reaches (0..9, 0..9) on level 0 with no requirement, (20, 0) with 40 Mining, nothing else. */
    const sets = new Map<string, string[][]>([[key(tile(20, 0)), [['skill:mining:40']]]]);
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) sets.set(key(tile(x, z)), [[]]);
    const fake = {
        setsAt: (t: Tile) => sets.get(key(t)) ?? [],
        setsAny: (ts: readonly Tile[]) => {
            const all = ts.flatMap(t => sets.get(key(t)) ?? []);
            return all.some(s => !s.length) ? [[]] : all;
        },
        reached: (t: Tile) => sets.has(key(t)),
    };
    const site = (id: string, stand: Tile | null, rest: Partial<Placed<Site>> = {}): Placed<Site> => ({
        id,
        kind: id.slice(0, id.indexOf(':')) as Site['kind'],
        areaPath: ['town'],
        centre: stand ?? tile(30, 30),
        bbox: { x1: 0, z1: 0, x2: 0, z2: 0, level: 0 },
        stand,
        counts: {},
        features: [],
        f2p: false,
        multiway: false,
        wildernessLevel: 0,
        ...rest,
    });
    const cluster = (x1: number, x2: number): Placed<NpcSpawn> => ({
        config: 'goblin',
        areaPath: ['town'],
        centre: tile(Math.round((x1 + x2) / 2), 0),
        bbox: { x1, z1: 0, x2, z2: 0, level: 0 },
        count: 2,
        f2p: false,
    });

    test("a site's reach is its stand's sets; one with no stand, or a stand no set reaches, has none", () => {
        const { sites } = addReach(
            {
                sites: [
                    site('bank:town:0', tile(1, 1)),
                    site('rock:town:0', tile(20, 0)),
                    site('tree:town:0', tile(15, 15)),
                    site('furnace:town:0', null),
                ],
                npcSpawns: [],
            },
            fake,
            open,
        );
        expect(sites.map(s => [s.id, s.reach])).toEqual([
            ['bank:town:0', [[]]],
            ['rock:town:0', [['skill:mining:40']]],
            ['tree:town:0', []],
            ['furnace:town:0', []],
        ]);
    });

    test("an npc cluster's reach is the cheapest over the tiles beside it, not its nearest tile's", () => {
        // Spawns at x 11-21: the tile beside x 11 (x 10) is not reached, but x 9 is not beside it either; x 20
        // is, with 40 Mining. A cluster at x 10-20 has x 9 beside it, reached free.
        const { npcSpawns } = addReach(
            { sites: [], npcSpawns: [cluster(11, 21), cluster(10, 20), cluster(40, 41)] },
            fake,
            open,
        );
        expect(npcSpawns.map(c => c.reach)).toEqual([[['skill:mining:40']], [[]], []]);
    });

    test('a cluster behind a wall keeps [] though the tile across the wall is reached', () => {
        // A goblin at (30, 5); (31, 5), east of it across a wall, is the one tile the walk gets to.
        const across = tile(31, 5);
        const only = {
            setsAt: () => [],
            setsAny: (ts: readonly Tile[]) => (ts.some(t => key(t) === key(across)) ? [[]] : []),
            reached: () => false,
        };
        // The engine's entity test: from a tile sharing an edge with the npc, but not through the wall.
        const walled: StepCollision = {
            walkable: () => true,
            reached: (from, npc) => edge(from, npc) && !across31(from, npc.x),
            canStep: (_l, x, z, dx, _dz) => !across31({ level: 0, x, z }, x + dx),
        };
        const goblin = { ...cluster(30, 30), centre: tile(30, 5), bbox: { x1: 30, z1: 5, x2: 30, z2: 5, level: 0 } };
        const reachBeside = (collision: StepCollision) =>
            addReach({ sites: [], npcSpawns: [goblin] }, only, c => besideCluster(c, collision)).npcSpawns[0]!.reach;
        expect(besideCluster(goblin, walled)).not.toContainEqual(across);
        expect(reachBeside(walled)).toEqual([]);
        // With no wall, the same tile is beside the goblin: the entity test passes, or the step does.
        expect(reachBeside({ ...walled, reached: edge })).toEqual([[]]);
        expect(reachBeside({ ...walled, canStep: () => true })).toEqual([[]]);
    });

    test('lists the covered sites no set reaches, by area path then id, with the nearest reached tile', () => {
        const { unreached } = addReach(
            {
                sites: [
                    site('shop:town:10', tile(12, 5)),
                    site('shop:town:2', tile(11, 5), { areaPath: ['town', 'square'] }),
                    site('shop:town:1', tile(13, 5)),
                    site('npc:town:0', tile(15, 15)),
                    site('connector:town:0', null),
                    site('bank:town:0', null, { centre: tile(200, 200) }),
                ],
                npcSpawns: [],
            },
            fake,
            open,
        );
        expect(unreached).toEqual([
            { id: 'bank:town:0', kind: 'bank', areaPath: ['town'], at: tile(200, 200), stand: false, nearest: null },
            { id: 'shop:town:1', kind: 'shop', areaPath: ['town'], at: tile(13, 5), stand: true, nearest: tile(9, 5) },
            { id: 'shop:town:10', kind: 'shop', areaPath: ['town'], at: tile(12, 5), stand: true, nearest: tile(9, 5) },
            {
                id: 'shop:town:2',
                kind: 'shop',
                areaPath: ['town', 'square'],
                at: tile(11, 5),
                stand: true,
                nearest: tile(9, 5),
            },
        ]);
    });

    test('the nearest reached tile: the first ring that has one, then the straightest, then by x and z', () => {
        const reached = reachedOnly;
        expect(nearestReached(reached(tile(5, 5)), tile(5, 5))).toEqual(tile(5, 5));
        // Ring 2 holds (7, 7) and (7, 6); (7, 6) is the straighter. (3, 6) ties with it and has the lower x.
        expect(nearestReached(reached(tile(7, 7), tile(7, 6)), tile(5, 5))).toEqual(tile(7, 6));
        expect(nearestReached(reached(tile(7, 6), tile(3, 6)), tile(5, 5))).toEqual(tile(3, 6));
        // Another level, or the other plane (the underground at z >= 6400), is not looked at.
        expect(nearestReached(reached(tile(5, 6, 1)), tile(5, 5))).toBeNull();
        expect(nearestReached(reached(tile(5, 6400)), tile(5, 6399))).toBeNull();
        expect(nearestReached(reached(tile(5, 9)), tile(5, 5), 3)).toBeNull();
    });
});

/** An op 1 trigger in t.rs2. */
const trigger = (on: Trigger['on'], target: string, line: number): Trigger => ({
    file: 't.rs2',
    on,
    kind: 'op',
    op: '1',
    target,
    category: false,
    line,
    body: '',
});
/** A 1 by 1 loc or npc spawn with one trigger. */
const user = (config: string, where: Tile, t: Trigger): OpUser => ({ config, tile: where, w: 1, l: 1, triggers: [t] });
/** A pocket of 12 tiles, closed, with no nearest reached tile and no hints but as given. */
const pocket = (p: Partial<Pocket> & Pick<Pocket, 'sites'>): Pocket => ({
    size: 12,
    open: false,
    nearest: null,
    hints: [],
    ...p,
});

describe('the unreached report', () => {
    const u = unreachedRow;
    const areas = [
        { id: 'isle', name: 'The Isle', rects: [] },
        { id: 'cave', name: 'Cave', rects: [] },
    ];

    test('EXPECTED_UNREACHED leaves out its sites, an area entry its child areas too, and names the stale and the invalid', () => {
        const rows = [
            u('bank:isle-bank:0', ['isle', 'isle-bank'], tile(5, 5), null),
            u('tree:isle:0', ['isle'], tile(6, 6), null),
            u('rock:cave:0', ['cave'], tile(5, 6405), null),
            u('shop:town:0', ['town'], tile(9, 9), null),
        ];
        expect(
            expectedUnreached(
                rows,
                [
                    { area: 'isle', reason: 'new accounts only', source: 'i.rs2:1' },
                    { site: 'rock:cave:0', reason: 'a quest step', source: 'c.rs2:2' },
                    { area: 'gone', reason: 'reached now', source: 'g.rs2:3' },
                    { site: 'shop:town:9', reason: 'gone', source: 's.rs2:4' },
                    { area: 'isel', reason: 'a typo', source: 't.rs2:5' },
                    { site: 'rock:cvae:0', reason: 'a typo', source: 't.rs2:6' },
                ],
                {
                    areas: new Set(['isle', 'cave', 'gone']),
                    sites: new Set([...rows.map(r => r.id), 'shop:town:9']),
                },
            ),
        ).toEqual({
            left: [rows[3]!],
            expected: 3,
            invalid: ['area isel (t.rs2:5)', 'site rock:cvae:0 (t.rs2:6)'],
            stale: ['area gone (g.rs2:3)', 'site shop:town:9 (s.rs2:4)'],
        });
    });

    describe('pockets', () => {
        // Rooms walled all round: A (3210-3214, 3210-3214) and B (3220-3224, 3220-3224), 25 tiles each, and C
        // (3204-3206, 3220-3222), 9 tiles, whose ladder lands in A. The walk from (3200, 3200) gets to none.
        const grid = new Grid().room(3210, 3210, 3214, 3214).room(3220, 3220, 3224, 3224).room(3204, 3220, 3206, 3222);
        const ladder = tile(3205, 3221);
        const input = {
            world: {
                features: [
                    {
                        source: 'loc' as const,
                        id: 1,
                        config: 'ladder',
                        tile: ladder,
                        shape: 10,
                        rotation: 0,
                        kind: 'connector' as const,
                        subtype: '',
                        name: 'Ladder',
                    },
                ],
                connectors: [
                    {
                        feature: 0,
                        loc: ladder,
                        op: 1,
                        opName: 'Climb-down',
                        direction: 'down' as const,
                        stand: null,
                        landing: tile(3212, 3212),
                        source: 'ladders.rs2:1',
                    },
                ],
                gates: [],
                transports: [],
            },
            collision: grid,
            size: locSizes(new Map()),
            start: tile(3200, 3200),
        };
        const graph = reachGraph(input);
        const reach = fillReach(input, graph);
        const door = trigger('loc', 'door', 1);
        const lever = trigger('loc', 'lever', 2);
        const guard = trigger('npc', 'guard', 3);
        const users = [
            // On reached land beside A's west wall; on reached land beside no pocket; inside B.
            user('door', tile(3209, 3212), door),
            user('lever', tile(3202, 3202), lever),
            user('guard', tile(3222, 3222), guard),
        ];
        const scans = new Map<Trigger, HintScan>([
            [door, { k: 'candidate', kind: 'gate', reviewed: true }],
            [guard, { k: 'move', to: ['cross'] }],
        ]);
        const asked: Trigger[] = [];
        const scanOf = (t: Trigger): HintScan => {
            asked.push(t);
            return scans.get(t) ?? { k: 'none' };
        };
        const a0 = u('tree:a:0', ['a'], tile(3211, 3211), tile(3209, 3211));
        const a1 = u('tree:a:1', ['a'], tile(3213, 3213), null);
        const b0 = u('rock:b:0', ['b'], tile(3221, 3221), tile(3219, 3219));
        const c0 = u('fire:c:0', ['c'], tile(3204, 3220), tile(3203, 3220));

        test('sites a flood joins share a pocket, through an edge too; walled-off ones get their own', () => {
            expect(reach.reached(tile(3212, 3212))).toBe(false);
            const pockets = unreachedPockets({
                graph,
                reached: reach.reached,
                unreached: [a0, a1, b0, c0],
                users,
                scanOf,
            });
            expect(pockets).toEqual([
                {
                    // C's flood takes its 9 tiles, then the ladder's edge leads onto A's.
                    sites: [a0, a1, c0],
                    size: 34,
                    open: false,
                    nearest: { tile: tile(3203, 3220), site: 'fire:c:0', off: 1 },
                    hints: [
                        {
                            trigger: 'oploc1,door',
                            source: 't.rs2:1',
                            scan: { k: 'candidate', kind: 'gate', reviewed: true },
                            at: [{ config: 'door', tile: tile(3209, 3212) }],
                        },
                    ],
                },
                {
                    sites: [b0],
                    size: 25,
                    open: false,
                    nearest: { tile: tile(3219, 3219), site: 'rock:b:0', off: 2 },
                    hints: [
                        {
                            trigger: 'opnpc1,guard',
                            source: 't.rs2:3',
                            scan: { k: 'move', to: ['cross'] },
                            at: [{ config: 'guard', tile: tile(3222, 3222) }],
                        },
                    ],
                },
            ]);
            // The lever, in the reached area beside no pocket, is not a hint, so never scanned.
            expect(asked).not.toContain(lever);
        });

        test('a flood that hits the cap is open, with the hints of the tiles it took', () => {
            const [capped] = unreachedPockets({
                graph,
                reached: reach.reached,
                unreached: [a0],
                users,
                scanOf,
                cap: 10,
            });
            expect(capped).toMatchObject({ sites: [a0], size: 10, open: true });
            // (3211, 3211) first, then breadth first: the door at (3209, 3212) is beside (3210, 3212), taken.
            expect(capped!.hints.map(h => h.trigger)).toEqual(['oploc1,door']);
        });

        test('a site whose tile is reached, or off land, is a pocket of its own with no tiles', () => {
            const out = u('bank:x:0', ['x'], tile(3201, 3201), null, false);
            const off = u('bank:y:0', ['y'], tile(3201, 3201, 2), null, false);
            expect(
                unreachedPockets({ graph, reached: reach.reached, unreached: [out, off], users, scanOf }).map(p => [
                    p.sites,
                    p.size,
                    p.hints,
                ]),
            ).toEqual([
                [[out], 0, []],
                [[off], 0, []],
            ]);
        });
    });

    test('formatUnreached: counts, then each pocket, most sites first, with its sites by kind and its hints', () => {
        const isle = pocket({
            sites: [
                u('bank:isle:0', ['isle'], tile(5, 5, 1), tile(5, 9, 1)),
                u('rock:isle:0', ['isle'], tile(5, 5), null, false),
            ],
            size: 40,
            nearest: { tile: tile(5, 9, 1), site: 'bank:isle:0', off: 4 },
            hints: [
                {
                    trigger: 'oploc1,door',
                    source: 'd.rs2:3',
                    scan: { k: 'candidate', kind: 'gate', reviewed: true },
                    at: [{ config: 'door', tile: tile(4, 4) }],
                },
                {
                    trigger: 'oploc1,stairs',
                    source: 's.rs2:2',
                    scan: {
                        k: 'move',
                        to: ['0_0_0_9_9', '0_0_0_10_9', '0_0_0_11_9', '0_0_0_12_9', '0_0_0_13_9', 'cross'],
                    },
                    at: [1, 2, 3, 4, 5, 6].map(z => ({ config: z < 6 ? 'stairs' : 'stairs_top', tile: tile(1, z) })),
                },
                {
                    trigger: 'opnpc1,pilot',
                    source: 'p.rs2:1',
                    scan: { k: 'candidate', kind: 'quest-window', reviewed: false },
                    at: [{ config: 'pilot', tile: tile(6, 6, 1) }],
                },
                {
                    trigger: 'oploc1,_tree',
                    source: 'w.rs2:1',
                    scan: { k: 'none' },
                    at: [tile(7, 7), tile(8, 8)].map(t => ({ config: 'tree', tile: t })),
                },
                {
                    trigger: 'opnpc1,man',
                    source: 'm.rs2:1',
                    scan: { k: 'none' },
                    at: [{ config: 'man', tile: tile(9, 9) }],
                },
            ],
        });
        const cave = pocket({
            sites: [
                u('rock:cave:0', ['cave'], tile(5, 6405), tile(8, 6405)),
                u('rock:cave:1', ['cave'], tile(6, 6405), null),
                u('tree:unnamed:0', [], tile(1, 1), null),
            ],
            nearest: { tile: tile(8, 6405), site: 'rock:cave:0', off: 3 },
        });
        const wide = pocket({ sites: [u('tree:isle:0', ['isle'], tile(7, 7), null)], size: 32768, open: true });
        expect(formatUnreached({ pockets: [isle, cave, wide], expected: 2, invalid: [], stale: [] }, areas)).toEqual([
            'warning: 6 sites of covered kinds no walk from the Lumbridge spawn reaches (bank 1, rock 3, tree 2), ' +
                'in 3 pockets (1 open), most sites first; areas.ts EXPECTED_UNREACHED leaves out 2 more:',
            '  cave (Cave), no area: 3 sites, 12 tiles; nearest reached (8, 6405), 3 tiles off rock:cave:0',
            '    rock 2: rock:cave:0 (5, 6405), rock:cave:1 (6, 6405)',
            '    tree 1: tree:unnamed:0 (1, 1)',
            '    no hints: no trigger on or beside it',
            '  isle (The Isle): 2 sites, 40 tiles; nearest reached (5, 9) L1, 4 tiles off bank:isle:0',
            '    bank 1: bank:isle:0 (5, 5) L1',
            '    rock 1: rock:isle:0 centre (5, 5)',
            '    hint oploc1,door (d.rs2:3): gate candidate: gate (gates.ts); on door (4, 4)',
            '    hint oploc1,stairs (s.rs2:2): unconditional move across it, to (9, 9), to (10, 9), to (11, 9), to (12, 9) and 1 more; ' +
                'on stairs (1, 1), (1, 2), (1, 3), (1, 4) and 2 more',
            "    hint opnpc1,pilot (p.rs2:1): gate candidate: quest-window (the scan's proposal); on pilot (6, 6) L1",
            '    no move found: oploc1,_tree (w.rs2:1) on 2, opnpc1,man (m.rs2:1) on 1',
            '  isle (The Isle): 1 site, 32768 tiles and more (open: the flood stopped at its cap); no reached tile within 64 tiles of its sites',
            '    tree 1: tree:isle:0 (7, 7)',
            '    no hints: no trigger on or beside it',
        ]);
        expect(formatUnreached({ pockets: [], expected: 0, invalid: [], stale: [] }, areas)).toEqual([
            'unreached: every site of a covered kind is reached from the Lumbridge spawn',
        ]);
        expect(formatUnreached({ pockets: [], expected: 9, invalid: [], stale: [] }, areas)).toEqual([
            'unreached: every site of a covered kind is reached from the Lumbridge spawn, but the 9 areas.ts EXPECTED_UNREACHED leaves out',
        ]);
    });
});
