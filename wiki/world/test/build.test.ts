import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    addReach,
    byWritten,
    failed,
    formatReport,
    formatUnreached,
    nearestReached,
    serializeWorld,
    type BuildReport,
    type Unreached,
} from '../build';
import { loadWorld } from '../load';
import { besideCluster, grownBox, type Placed, type StepCollision } from '../place';
import { WORLD_FORMAT, type Feature, type NpcSpawn, type Site, type Tile, type World } from '../types';

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
};

describe('serializeWorld', () => {
    test('one area, feature, site, npc spawn cluster, connector, quest, rule, transport or gate per line, empty lists inline, a trailing newline', () => {
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
            writeFileSync(file, `{"format":${WORLD_FORMAT},"areas":[]}`);
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
            // A format-3 file written before quests and transports, with its format bumped by hand, is still
            // refused; so are a format-5 one without gates and one whose loadoutRules is not an object.
            const { quests: _, loadoutRules: _r, transports: _t, ...before } = world;
            writeFileSync(file, JSON.stringify(before));
            expect(() => loadWorld(file)).toThrow(
                /needs generatedFrom, areas, features, sites, npcSpawns, connectors, quests, loadoutRules, transports and gates/,
            );
            const { gates: _g, ...noGates } = world;
            writeFileSync(file, JSON.stringify(noGates));
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
            writeFileSync(file, JSON.stringify({ ...world, loadoutRules: [] }));
            expect(() => loadWorld(file)).toThrow(/not a world.json/);
        } finally {
            rmSync(dir, { recursive: true });
        }
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
            },
        },
        reach: {
            nodes: 64,
            reached: 10,
            free: 8,
            byLevel: [10, 0, 0, 0],
            sets: 2,
            labels: 11,
            edges: { connectors: 0, gates: 1, transports: 0 },
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
        unreached: [],
    };
    const gatesLine =
        'gates: 3 candidates, by kind gate 2, side-effect 1; 4 placed; requirement forms quest 1, skill 1';
    const landingsLine =
        'gate moves on objects: 0 to, 0 landings, 0 opens, 0 underived (rows; 0 quest windows left as they are)';
    const tail = [
        'quests: 68, 2 of them from gates.ts overrides (cog, ikov)',
        'transports: 19 ship rows on 9 routes, 2 curated rows',
        gatesLine,
        landingsLine,
    ];

    test('counts, then coverage, then connectors, quests, transports and gates', () =>
        expect(formatReport(report)).toEqual([
            'features: bank 3, tree 2',
            'sites: bank 1, tree 1',
            'coverage: every site of a covered kind lies in an area',
            'connectors: 3 derived on 2 locs, 0 one-way, 0 underived',
            ...tail,
        ]));

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
        ])
            expect(failed(one)).toBe(true);
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
        expect(formatReport({ ...report, gates }).slice(-22)).toEqual([
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
        expect(lines.slice(-10)).toEqual([
            'gate moves on objects: 1 to, 2 landings, 3 opens, 3 underived (rows; 1 quest windows left as they are)',
            'warning: 3 gate rows on objects with no landing derived, by trigger:',
            '  oploc1,bridge: 2 (bridge (5, 5), bridge (5, 6))',
            '    no tile on land reaches the loc',
            '  oploc1,pipe: 1 (pipe (1, 1))',
            '    no path moves (p.rs2:2)',
            'warning: 1 gate landings off walkable land, left out:',
            '  oploc1,rock rock (9, 9) from (8, 9) -> (10, 9) (r.rs2:7)',
            'warning: 1 stands of gate rows with landings that give no landing, left out:',
            '  oploc1,rock rock (9, 9) from (9, 8): a (r.rs2:2); b (r.rs2:3)',
        ]);
        // Warnings: they do not fail the build.
        expect(failed({ ...report, gates: { ...report.gates, landings } })).toBe(false);
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

    test('formatUnreached: counts by kind, then each area with its sites, or one line when none', () => {
        const u = unreachedRow;
        const areas = [
            { id: 'isle', name: 'The Isle', rects: [] },
            { id: 'cave', name: 'Cave', rects: [] },
        ];
        expect(
            formatUnreached(
                [
                    u('bank:isle:0', ['isle'], tile(5, 5, 1), tile(5, 9, 1)),
                    u('rock:isle:0', ['isle'], tile(5, 5), null, false),
                    u('rock:cave:0', ['cave'], tile(5, 6405), tile(8, 6405)),
                    u('tree:unnamed:0', [], tile(1, 1), null),
                ],
                areas,
            ),
        ).toEqual([
            'warning: 4 sites of covered kinds no walk from the Lumbridge spawn reaches (bank 1, rock 2, tree 1), by area:',
            '  isle (The Isle):',
            '    bank:isle:0 stand (5, 5) L1, level 1: nearest reached (5, 9) L1, 4 tiles off',
            '    rock:isle:0 centre (no stand) (5, 5), level 0: no reached tile within 64 tiles',
            '  cave (Cave):',
            '    rock:cave:0 stand (5, 6405), level 0, underground: nearest reached (8, 6405), 3 tiles off',
            '  no area:',
            '    tree:unnamed:0 stand (1, 1), level 0: no reached tile within 64 tiles',
        ]);
        expect(formatUnreached([], areas)).toEqual([
            'unreached: every site of a covered kind is reached from the Lumbridge spawn',
        ]);
    });
});
