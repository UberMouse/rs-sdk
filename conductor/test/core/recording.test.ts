import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseRecording, Recorder } from '../../core/drivers/recording';
import { chopper, FakeGame, recordRun, RUN } from './fake-game';

describe('the recorder', () => {
    test('a write failure turns recording off with one warning, and the run carries on', async () => {
        const warnings: string[] = [];
        let writes = 0;
        const out = {
            write: () => {
                writes++;
                throw new Error('disk full');
            },
            close: () => {},
        };
        const { result, recorder } = await recordRun(chopper(), new FakeGame(), { out, warn: m => warnings.push(m) });
        expect(result.status).toBe('done');
        expect(warnings).toEqual(['recording off: disk full']);
        expect(writes).toBe(1);
        expect(recorder.recording).toBe(false);
    });

    test("a file it can't create is a warning and no recorder", () => {
        const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
        try {
            const blocker = join(dir, 'file');
            writeFileSync(blocker, '');
            const warnings: string[] = [];
            const run = { task: 'test', ...RUN, params: {}, stops: [] };
            expect(Recorder.toFile(join(blocker, 'run.ticks.ndjson.gz'), run, m => warnings.push(m))).toBeNull();
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toStartWith(`recording off: can't create ${blocker}/run.ticks.ndjson.gz: `);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a recording cut off mid-write reads up to its last whole record', async () => {
        const { recording } = await recordRun(chopper(), new FakeGame());
        const lines = [
            JSON.stringify(recording!.header),
            ...recording!.records.slice(0, 5).map(r => JSON.stringify({ ...r, w: undefined })),
        ];
        const bytes = gzipSync(lines.join('\n') + '\n');
        const cut = parseRecording(bytes.subarray(0, bytes.length - 12));
        expect(cut.truncated).toBe(true);
        expect(cut.records.length).toBeLessThan(5);
        expect(cut.records.length).toBeGreaterThan(0);
    });

    test('records the initial state, each publication, and each command with its result', async () => {
        const { result, recording } = await recordRun(chopper({ scans: true }), new FakeGame({ revisions: true }));
        const records = recording!.records;
        expect(recording!.header.run).toMatchObject({ task: 'chopper', ...RUN, params: {} });
        expect(records[0]).toMatchObject({ k: 'p', d: { tick: 100 } });
        const sent = records.filter(r => r.k === 'c');
        const settled = records.filter(r => r.k === 'r');
        expect(settled.map(r => r.k === 'r' && r.id)).toEqual(sent.map(r => r.k === 'c' && r.id));
        expect(sent.some(r => r.k === 'c' && r.cmd.type === 'scan')).toBe(true);
        expect(records.at(-1)).toMatchObject({ k: 'end', status: result.status, reason: result.reason });
        // Later publications carry only what changed: never the unchanged skills list of a tick.
        const later = records.filter(r => r.k === 'p').slice(1);
        expect(later.every(r => r.k === 'p' && ('tick' in r.d || 'revision' in r.d))).toBe(true);
        expect(later.some(r => r.k === 'p' && !('tick' in r.d))).toBe(true);
        expect(later.filter(r => r.k === 'p' && 'skills' in r.d).length).toBeLessThan(later.length / 2);
    });
});
