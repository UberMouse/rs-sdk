import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { byWritten, failed, formatReport, serializeWorld, type BuildReport } from '../build';
import { loadWorld } from '../load';
import { WORLD_FORMAT, type Feature, type World } from '../types';

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
    ],
    quests: [{ id: 'zanaris', varp: 'zanaris', varpId: 147, complete: 6, stages: {}, source: 'quests.rs2:329' }],
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
            source: 'sailors.rs2:10',
        },
    ],
};

describe('serializeWorld', () => {
    test('one area, feature, site, npc spawn cluster, connector, quest, rule or transport per line, empty lists inline, a trailing newline', () => {
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
                '    {"config":"man","areaPath":["town"],"centre":{"level":0,"x":5,"z":5},"bbox":{"x1":4,"z1":5,"x2":6,"z2":5,"level":0},"count":2,"f2p":true}',
                '  ],',
                '  "connectors": [',
                '    {"feature":0,"loc":{"level":0,"x":1,"z":2},"op":1,"opName":"Climb-up","direction":"up","landing":{"level":1,"x":1,"z":3},"stand":{"level":0,"x":1,"z":3},"relative":true,"source":"ladders+stairs/scripts/ladders.rs2:81"}',
                '  ],',
                '  "quests": [',
                '    {"id":"zanaris","varp":"zanaris","varpId":147,"complete":6,"stages":{},"source":"quests.rs2:329"}',
                '  ],',
                '  "loadoutRules": {',
                '    "entrana": {"forbidCategories":{"weapon_axe":"both","cannon_parts":"carried"},"source":"monk.rs2:26"}',
                '  },',
                '  "transports": [',
                '    {"kind":"ship","route":"port_sarim_to_karamja","npc":"captain_tobias","from":{"level":0,"x":3028,"z":3216},"to":{"level":1,"x":2956,"z":3143},"fare":30,"requires":["coins:30"],"source":"sailors.rs2:10"}',
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
            // refused; so is one whose loadoutRules is not an object.
            const { quests: _, loadoutRules: _r, transports: _t, ...before } = world;
            writeFileSync(file, JSON.stringify(before));
            expect(() => loadWorld(file)).toThrow(
                /needs generatedFrom, areas, features, sites, npcSpawns, connectors, quests, loadoutRules and transports/,
            );
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
    } finally {
        rmSync(dir, { recursive: true });
    }
});

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
            unusedRoutes: [],
            other: [],
            outOfScope: [],
        },
    };
    const tail = [
        'quests: 68, 2 of them from gates.ts overrides (cog, ikov)',
        'transports: 19 ship rows on 9 routes, 2 curated rows',
    ];

    test('counts, then coverage, then connectors, quests and transports', () =>
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
                unusedRoutes: ['crandor_to_port_sarim'],
                other: ['sailor -> karamja: other:`x = 1` (s.rs2:3)'],
                outOfScope: ['gliders (glider.rs2:7): a menu'],
            },
        };
        expect(formatReport(bad).slice(4)).toEqual([
            'quests: 68, 2 of them from gates.ts overrides (cog, ikov)',
            'ERROR quests: 1 with no readable journal call and no override in gates.ts:',
            '  upass: `1` is not a varp (q.rs2:1)',
            'ERROR quests: 1 overrides in gates.ts not needed:',
            '  ikov: not needed',
            'transports: 19 ship rows on 9 routes, 2 curated rows',
            'ERROR transports: 1 sail sites no npc op reaches (derive, curate or list them out of scope in gates.ts):',
            '  boat.rs2:9',
            'warning: 1 sail scripts the walker could not finish:',
            '  sailor (s.rs2:1): `while (true) {` (s.rs2:2): a loop is not followed',
            'warning: 1 transport requirements in no other form:',
            '  sailor -> karamja: other:`x = 1` (s.rs2:3)',
            'sail paths left out as quest windows: 1',
            '  ned (1, 2) -> port_sarim_to_crandor: `%dragonquest = ^x` (ned.rs2:4)',
            'sail routes no npc sails: crandor_to_port_sarim',
            'transports out of scope (gates.ts): 1',
            '  gliders (glider.rs2:7): a menu',
        ]);
        expect(failed(bad)).toBe(true);
        for (const one of [
            { ...report, uncovered: ['bank:x'] },
            { ...report, quests: { ...report.quests, unread: ['x'] } },
            { ...report, quests: { ...report.quests, stale: ['x'] } },
            { ...report, transports: { ...report.transports, unreached: ['x'] } },
        ])
            expect(failed(one)).toBe(true);
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
