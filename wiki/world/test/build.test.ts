import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { byWritten, formatReport, serializeWorld, type BuildReport } from '../build';
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
};

describe('serializeWorld', () => {
    test('one area, feature or site per line, empty lists inline, a trailing newline', () => {
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
                '  "sites": []',
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
    };

    test('counts, then coverage', () =>
        expect(formatReport(report)).toEqual([
            'features: bank 3, tree 2',
            'sites: bank 1, tree 1',
            'coverage: every site of a covered kind lies in an area',
        ]));

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
        ]);
    });

    test('counts the npc sites outside every area and lists the first ten', () => {
        const npcUncovered = Array.from({ length: 12 }, (_, i) => `npc:unnamed:${i}`);
        const lines = formatReport({ ...report, npcUncovered });
        expect(lines.slice(3)).toEqual([
            'warning: 12 npc sites outside every area, the first 10:',
            ...npcUncovered.slice(0, 10).map(id => `  ${id}`),
        ]);
    });
});
