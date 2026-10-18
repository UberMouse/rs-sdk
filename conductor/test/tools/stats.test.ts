// stats.ts --methods end to end: the tool run on a fixture checkout (`--root`) holding plan runs of guard-thieve (the
// guard-falador-pickpocket method's plan) and their phase runs' recordings.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { RECORDING_VERSION, recordingFile } from '../../core/drivers/recording';
import { REPO_ROOT } from '../../lib/env';
import type { MethodRuns } from '../../lib/methods';

const BOT = 'tbot';
const METHOD = 'guard-falador-pickpocket';
const root = mkdtempSync(join(tmpdir(), 'stats-methods-'));
const dir = join(root, 'conductor/runs', BOT);
mkdirSync(dir, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A run log holding one result event; returns its path. */
function log(name: string, t: number, o: Record<string, unknown>): string {
    const file = join(dir, `${name}.ndjson`);
    const result = { t, type: 'result', bot: BOT, status: 'done', reason: 'r', params: {}, logFile: file, ...o };
    writeFileSync(file, JSON.stringify(result) + '\n');
    return file;
}

/** A recording whose header is version `v` and whose first state starts at Thieving `thieving`. */
function recording(v: number, thieving: number): Buffer {
    const state = {
        skills: [
            { name: 'Thieving', level: thieving, baseLevel: thieving, experience: 0 },
            { name: 'Hitpoints', level: 40, baseLevel: 40, experience: 0 },
        ],
        inventory: [{ name: 'Trout' }],
        equipment: [],
    };
    const lines = [
        { k: 'h', v, at: 1 },
        { k: 'p', d: state },
    ];
    return gzipSync(lines.map(l => JSON.stringify(l) + '\n').join(''));
}

/** A guard-thieve plan run of half an hour at `day`, its one phase run's recording `rec` (none when undefined). */
function planRun(id: string, day: string, rec: Buffer | undefined): void {
    const t = Date.parse(`${day}T01:00:00Z`);
    const phase = log(`${id}-thieving`, t - 1000, { task: 'thieving', runId: `${id}-p`, partOf: id, durationMs: 1000 });
    if (rec) writeFileSync(recordingFile(phase), rec);
    log(`${id}-plan-guard-thieve`, t, {
        task: 'plan:guard-thieve',
        runId: id,
        durationMs: 1_800_000,
        xpGained: { Thieving: 500_000 },
    });
}

planRun('run-0', '2026-09-20', recording(RECORDING_VERSION, 50));
planRun('run-1', '2026-10-02', recording(RECORDING_VERSION, 60));
// A killed run's zero-byte recording, and one from another recording version.
planRun('run-2', '2026-10-03', Buffer.alloc(0));
planRun('run-3', '2026-10-04', recording(RECORDING_VERSION + 1, 70));

function stats(...args: string[]) {
    const p = Bun.spawnSync(['bun', 'conductor/tools/stats.ts', BOT, '--root', root, ...args], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

describe('stats.ts --methods', () => {
    test('--task and --phases are refused', () => {
        for (const extra of [['--task', 'thieving'], ['--phases']]) {
            const r = stats('--methods', ...extra);
            expect(r.code).toBe(2);
            expect(r.stderr).toContain('--methods counts whole plan runs: no --task or --phases');
        }
    }, 30_000);

    test('--json: each method with its runs; start levels from the recordings, unreadable ones skipped with a warning', () => {
        const r = stats('--methods', '--json');
        expect(r.code).toBe(0);
        expect(r.stderr).toMatch(
            /^stats: 2 unreadable recording\(s\) in .*conductor\/runs\/tbot, their runs counted as having no recorded start; first: /m,
        );
        const list = JSON.parse(r.stdout) as MethodRuns[];
        const m = list.find(x => x.method === METHOD)!;
        expect(Object.keys(m).sort()).toEqual(
            [
                'counted',
                'excluded',
                'floor',
                'gap',
                'hours',
                'last',
                'levelRange',
                'method',
                'perRun',
                'plans',
                'runs',
                'toolKind',
                'xpPerHour',
            ].sort(),
        );
        expect(m).toMatchObject({ plans: ['guard-thieve'], runs: 4, hours: 2, excluded: 2, last: '2026-10-04' });
        expect(m.perRun.map(p => [p.runId, p.date, p.levels?.thieving])).toEqual([
            ['run-0', '2026-09-20', 50],
            ['run-1', '2026-10-02', 60],
            ['run-2', '2026-10-03', undefined],
            ['run-3', '2026-10-04', undefined],
        ]);
        expect(m.counted).toEqual({ runs: 2, hours: 1, xpPerHour: { thieving: 1_000_000 } });
        expect(m.floor!.thieving).toBeGreaterThan(0);
        expect(m.perRun[0]!.floor!.thieving).toBeGreaterThan(0);
        // Thieving 50 and 60: no single entry.
        expect(m.entry).toBeUndefined();
        expect(list.filter(x => x.method !== METHOD).every(x => x.runs === 0)).toBe(true);
    }, 30_000);

    test('--since narrows to runs at one level: the entry, its `from` naming the --since', () => {
        const r = stats('--methods', '--since', '2026-10-01');
        expect(r.code).toBe(0);
        const lines = r.stdout.split('\n');
        expect(lines[0]).toBe(`${METHOD} (plans: guard-thieve) · runs 3 · 1.50 h · last 2026-10-04`);
        expect(lines).toContain(
            '  2 runs (1.00 h) with no recorded start left out of the floor and gap below; all runs measured thieving 1,000,000/h',
        );
        expect(r.stdout).toContain('        level: { thieving: 60 },');
        expect(r.stdout).toContain("        from: 'stats.ts tbot --methods --since 2026-10-01',");
        expect(lines.filter(l => l.startsWith('no runs: '))).toHaveLength(1);
    }, 30_000);
});
