import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAINED_PLAIN_HINT, CHAIN_WINDOW_MS, chainedPlainHint } from '../../lib/chain-hint';
import {
    appendJournalLine,
    describeCommand,
    formatDuration,
    formatXp,
    journalStamp,
    runJournalLine,
} from '../../lib/journal';
import { emitResult, errorResult, parseRunArgs, ResultLine } from '../../lib/run-cli';
import { formatStop, parseStop } from '../../lib/stop';
import type { TaskResult } from '../../lib/task';

const tmp = mkdtempSync(join(tmpdir(), 'journal-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ended = (over: Partial<TaskResult>): TaskResult => ({
    ...errorResult({ task: 'smithing', bot: 'b', params: {} }, 'out of bars', 126_000, {
        runId: '2026-10-11T03-00-00-000Z-smithing',
        logFile: 'x',
    }),
    status: 'done',
    ...over,
});

describe('runJournalLine', () => {
    const now = new Date('2026-10-11T03:13:15.456Z');
    const opts = { objective: 'Smithing 40', command: 'run-task b smithing', now };

    test('a done run: result in the runners shape, verdict from status and reason', () => {
        const r = ended({ xpGained: { Smithing: 4375 }, levelsGained: { Smithing: { from: 22, to: 31 } } });
        expect(runJournalLine(r, opts)).toEqual({
            at: '2026-10-11T03:13:15Z',
            kind: 'run',
            objective: 'Smithing 40',
            verdict: 'done: out of bars',
            task: 'smithing',
            command: 'run-task b smithing',
            result: '2026-10-11T03-00-00-000Z-smithing done: out of bars; +4375 Smithing 22->31; 2min',
        });
    });

    test('a failed run with no xp', () => {
        const line = runJournalLine(ended({ status: 'failed', reason: 'no anvil', durationMs: 10_000 }), opts);
        expect(line?.verdict).toBe('failed: no anvil');
        expect(line?.result).toEndWith('failed: no anvil; 0xp; 10s');
    });

    test('nothing when the run never opened a log', () => {
        expect(runJournalLine(ended({ runId: '' }), opts)).toBeNull();
    });
});

describe('formatting', () => {
    test('duration', () => {
        expect(formatDuration(86_000)).toBe('86s');
        expect(formatDuration(180_000)).toBe('3min');
    });
    test('xp lists each skill, with levels when they rose', () => {
        expect(formatXp({ xpGained: { A: 5, B: 0, C: 7 }, levelsGained: { C: { from: 1, to: 2 } } })).toBe(
            '+5 A, +7 C 1->2',
        );
    });
    test('stamp', () => {
        expect(journalStamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z');
    });
    test('command: task with params, plan, and stops', () => {
        const stops = [parseStop('minutes:3'), parseStop('level:mining:65')];
        expect(describeCommand({ bot: 'b', task: 'mining', plan: null, params: { ore: 'iron' }, stops })).toBe(
            `run-task b mining --params '{"ore":"iron"}' --until minutes:3 --until level:mining:65`,
        );
        expect(describeCommand({ bot: 'b', task: '', plan: 'p.ts', params: {}, stops: [] })).toBe(
            'run-task b --plan p.ts',
        );
    });
});

describe('appendJournalLine', () => {
    test('creates the file and ends an unterminated last line first', () => {
        const file = join(tmp, 'sub', 'j.jsonl');
        const line = { at: 'a', kind: 'run', objective: 'o', verdict: 'v' } as const;
        appendJournalLine(file, line);
        writeFileSync(file, readFileSync(file, 'utf8').trimEnd());
        appendJournalLine(file, line);
        const lines = readFileSync(file, 'utf8').split('\n');
        expect(lines.length).toBe(3);
        expect(lines.slice(0, 2).map(l => JSON.parse(l).verdict)).toEqual(['v', 'v']);
    });
});

describe('--objective / --journal', () => {
    const base = ['b', 'travel'];
    test('both give the journal', () => {
        const { args, error } = parseRunArgs([...base, '--objective', 'O', '--journal', '/a/j.jsonl']);
        expect(error).toBeUndefined();
        expect(args.journal).toEqual({ objective: 'O', file: '/a/j.jsonl' });
    });
    test('neither: no journal', () => {
        expect(parseRunArgs(base).args.journal).toBeNull();
    });
    test('one alone, or a relative path, is a usage error', () => {
        expect(parseRunArgs([...base, '--objective', 'O']).error).toContain('go together');
        expect(parseRunArgs([...base, '--journal', '/a']).error).toContain('go together');
        expect(parseRunArgs([...base, '--objective', 'O', '--journal', 'j.jsonl']).error).toContain('absolute');
    });
});

const runs = (files: string[], phaseLogs: string[] = [], noResult: string[] = []) => {
    const dir = mkdtempSync(join(tmp, 'runs-'));
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
        const partOf = phaseLogs.includes(f);
        writeFileSync(
            join(dir, `${f}.ndjson`),
            noResult.includes(f)
                ? '{"type":"start"}\n'
                : `{"type":"start"}\n{"type":"result"${partOf ? ',"partOf":"p"' : ''}}\n`,
        );
        writeFileSync(join(dir, `${f}.ticks.ndjson.gz`), 'x');
    }
    return dir;
};

describe('chainedPlainHint', () => {
    const A = '2026-10-11T03-00-00-000Z-travel';
    const B = '2026-10-11T03-05-00-000Z-travel';
    const P = '2026-10-11T03-02-00-000Z-plan-iron';

    test('the first plain run carries none', () => {
        expect(chainedPlainHint(runs([A]), A)).toBeUndefined();
    });
    test('the 2nd plain run in a row carries it', () => {
        expect(chainedPlainHint(runs([A, B]), B)).toBe(CHAINED_PLAIN_HINT);
    });
    test('a plain run right after a plan run carries none', () => {
        expect(chainedPlainHint(runs([A, P, B]), B)).toBeUndefined();
    });
    test("a plan's phase runs after its log do not count as plain", () => {
        const phase = '2026-10-11T03-03-00-000Z-mining';
        expect(chainedPlainHint(runs([P, phase, B], [phase]), B)).toBeUndefined();
    });
    test('a log with no result event (a run cut off) counts as plain', () => {
        expect(chainedPlainHint(runs([A, B], [], [A]), B)).toBe(CHAINED_PLAIN_HINT);
    });
    test('a previous plain run older than the window gives none', () => {
        const old = '2026-10-11T02-00-00-000Z-travel';
        expect(CHAIN_WINDOW_MS).toBe(30 * 60_000);
        expect(chainedPlainHint(runs([old, B]), B)).toBeUndefined();
        const edge = '2026-10-11T03-05-00-000Z-travel';
        const own = '2026-10-11T03-35-00-000Z-travel';
        expect(chainedPlainHint(runs([edge, own]), own)).toBe(CHAINED_PLAIN_HINT);
        expect(
            chainedPlainHint(runs([edge, '2026-10-11T03-35-00-001Z-travel']), '2026-10-11T03-35-00-001Z-travel'),
        ).toBeUndefined();
    });
    test('an unparseable stamp gives none', () => {
        expect(chainedPlainHint(runs(['aaa-travel', B]), B)).toBeUndefined();
    });
    test('a run that never opened a log gets none', () => {
        expect(chainedPlainHint(runs([A]), '')).toBeUndefined();
        expect(chainedPlainHint(join(tmp, 'missing'), B)).toBeUndefined();
    });
});

describe('formatStop', () => {
    test.each(['level:mining:65', 'xp:smithing:500', 'minutes:3'])('round-trips %s', spec => {
        expect(formatStop(parseStop(spec))).toBe(spec);
    });
});

describe('emitResult', () => {
    const own = '2026-10-11T03-05-00-000Z-travel';
    const setup = (
        over: Partial<Parameters<typeof emitResult>[1]> = {},
        files = ['2026-10-11T03-00-00-000Z-travel', own],
    ) => {
        const out: string[] = [];
        const notes: string[] = [];
        const lines: unknown[] = [];
        const opts = {
            resultLine: new ResultLine(l => out.push(l)),
            runsDir: runs(files),
            isPlan: false,
            journal: { objective: 'O', file: '/j', command: 'run-task b travel' },
            appendJournal: (_f: string, l: unknown) => lines.push(l),
            note: (m: string) => notes.push(m),
            ...over,
        };
        return { out, notes, lines, opts };
    };
    const res = (over: Partial<TaskResult> = {}) => ended({ runId: own, ...over });

    test('prints the RESULT with the hint and journals the run', () => {
        const { out, lines, opts } = setup();
        expect(emitResult(res(), opts)).toBe(true);
        expect(JSON.parse(out[0]!.slice(7)).hint).toBe(CHAINED_PLAIN_HINT);
        expect(lines).toHaveLength(1);
    });
    test('a killed result is journalled too', () => {
        const { out, lines, opts } = setup();
        emitResult(res({ status: 'failed', reason: 'killed by SIGTERM' }), opts);
        expect(out).toHaveLength(1);
        expect((lines[0] as { verdict: string }).verdict).toBe('failed: killed by SIGTERM');
    });
    test('an fs error in the hint still prints the RESULT', () => {
        const file = join(tmp, 'not-a-dir');
        writeFileSync(file, 'x');
        const { out, notes, lines, opts } = setup({ runsDir: file });
        expect(emitResult(res(), opts)).toBe(true);
        expect(JSON.parse(out[0]!.slice(7)).hint).toBeUndefined();
        expect(notes[0]).toContain('hint skipped');
        expect(lines).toHaveLength(1);
    });
    test('a journal write failure is noted, the RESULT stands', () => {
        const { out, notes, opts } = setup({
            appendJournal: () => {
                throw new Error('disk full');
            },
        });
        expect(emitResult(res(), opts)).toBe(true);
        expect(out).toHaveLength(1);
        expect(notes[0]).toContain('journal not written: disk full');
    });
    test('no runId: RESULT printed, no hint and no journal line', () => {
        const { out, lines, opts } = setup();
        emitResult(res({ runId: '' }), opts);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0]!.slice(7)).hint).toBeUndefined();
        expect(lines).toHaveLength(0);
    });
    test('a second result is dropped and not journalled', () => {
        const { out, lines, opts } = setup();
        emitResult(res(), opts);
        expect(emitResult(res(), opts)).toBe(false);
        expect(out).toHaveLength(1);
        expect(lines).toHaveLength(1);
    });
});
