import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotSDK } from '../../../sdk/index';
import { readRecording, recordingFile } from '../../core/drivers/recording';
import { ReplayDriver } from '../../core/drivers/replay';
import { definePlan, phase, runPlan } from '../../lib/plan';
import { replayRun } from '../../lib/replay';
import { errorResult, type LiveRun, loadPlan, openLiveRun, parseRunArgs, runsDir } from '../../lib/run-cli';
import type { TaskResult } from '../../lib/task';
import { chopper, FakeGame, logsOf } from '../core/fake-game';

const FIXTURES = join(import.meta.dir, '../fixtures/plans');

const logEvents = (file: string) =>
    readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as Record<string, unknown>);

const noRecorderWarnings = (msg: string) => {
    throw new Error(`unexpected recorder warning: ${msg}`);
};

describe('parseRunArgs', () => {
    test('a task run, as before', () => {
        expect(
            parseRunArgs(['bot1', 'woodcutting', '--params', '{"tree":"oak"}', '--until', 'minutes:2', '--takeover']),
        ).toEqual({
            args: {
                bot: 'bot1',
                task: 'woodcutting',
                plan: null,
                params: { tree: 'oak' },
                stops: [{ kind: 'minutes', minutes: 2 }],
                takeover: true,
            },
        });
    });

    test('a plan run', () => {
        expect(parseRunArgs(['bot1', '--plan', 'p.ts', '--until', 'minutes:2'])).toEqual({
            args: {
                bot: 'bot1',
                task: '',
                plan: 'p.ts',
                params: {},
                stops: [{ kind: 'minutes', minutes: 2 }],
                takeover: false,
            },
        });
    });

    test.each([
        [['bot1', 'woodcutting', '--plan', 'p.ts'], '--plan and a <task> are mutually exclusive'],
        [['bot1', '--plan', 'p.ts', 'woodcutting'], '--plan and a <task> are mutually exclusive'],
        [['--plan', 'p.ts'], 'expected <bot> --plan <file>'],
        [['bot1', '--plan'], '--plan needs a file'],
        [['bot1', '--plan', 'a.ts', '--plan', 'b.ts'], '--plan given twice'],
        [['bot1', '--plan', 'p.ts', '--params', '{}'], "--params is for a task; a plan's params are in its file"],
        [['bot1'], 'expected <bot> <task>'],
        [['bot1', 'woodcutting', '--nope'], 'unknown flag --nope'],
    ])('%j is a usage error', (argv, error) => {
        expect(parseRunArgs(argv).error).toBe(error);
    });

    test('a usage error keeps what parsed before it, for the error RESULT', () => {
        const { args, error } = parseRunArgs(['bot1', 'woodcutting', '--params', '{"a":1}', '--until', 'bogus']);
        expect(error).toBeDefined();
        expect(args).toMatchObject({ bot: 'bot1', task: 'woodcutting', params: { a: 1 } });
    });
});

describe('loadPlan', () => {
    // A draft where the task-runner writes one, inside the gitignored run artifacts.
    const draftDir = join(runsDir(`.test-${process.pid}`), 'plans');
    afterAll(() => rmSync(join(draftDir, '..'), { recursive: true, force: true }));

    test('loads a plan that imports through @conductor/*, relative to the cwd', async () => {
        const { def, path } = await loadPlan('chop.ts', FIXTURES);
        expect(def.name).toBe('chop');
        expect(def.phases.map(p => p.task.name)).toEqual(['woodcutting']);
        expect(path).toBe(join(FIXTURES, 'chop.ts'));
    });

    test('resolves @conductor/* from a draft under conductor/runs/<bot>/plans/', async () => {
        mkdirSync(draftDir, { recursive: true });
        writeFileSync(join(draftDir, 'draft.ts'), readFileSync(join(FIXTURES, 'chop.ts')));
        const { def } = await loadPlan(join(draftDir, 'draft.ts'));
        expect(def.name).toBe('chop');
    });

    test('a module whose default export is not a plan is refused, naming the file', async () => {
        expect(loadPlan('not-a-plan.ts', FIXTURES)).rejects.toThrow(
            'not-a-plan.ts does not default-export a plan (export default definePlan(...))',
        );
    });

    test('a missing file is refused, naming it', async () => {
        expect(loadPlan('nope.ts', FIXTURES)).rejects.toThrow('no plan file nope.ts');
    });
});

describe('a plan whose phases run on openLiveRun', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-cli-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("each phase's recording replays to its result, with the plan's clock read through its driver", async () => {
        const game = new FakeGame();
        const plan = definePlan({
            name: 'chop-twice',
            // Two more logs each run.
            phases: [
                phase(chopper({ dropAt: 10 }), {}, { until: v => logsOf(v.state) >= 2 * (v.runs('chopper') + 1) }),
            ],
            until: v => v.runs('chopper') >= 2,
        });
        let current: LiveRun | null = null;
        const runs: LiveRun[] = [];
        game.start();
        try {
            const result = await runPlan(plan, {
                botName: 'tester',
                runId: 'plan-1',
                logFile: join(dir, 'plan-1.ndjson'),
                sinks: { event: () => {}, print: () => {}, screenshot: async () => null },
                // A `minutes:` stop, so the plan reads the clock on every check of every phase.
                stops: [{ kind: 'minutes', minutes: 60 }],
                state: () => game.getState(),
                // As run-task passes it.
                now: () => current?.driver.now() ?? Date.now(),
                newPhaseRun: p => {
                    const run = openLiveRun(game as unknown as BotSDK, {
                        dir,
                        task: p.task.name,
                        bot: 'tester',
                        params: p.params,
                        stops: [],
                        partOf: 'plan-1',
                        print: () => {},
                        warn: noRecorderWarnings,
                    });
                    current = run;
                    runs.push(run);
                    return {
                        ...run,
                        close: () => {
                            run.close();
                            current = null;
                        },
                    };
                },
            });
            expect(result).toMatchObject({ status: 'done', reason: 'plan until met' });
        } finally {
            game.stop();
        }

        expect(runs).toHaveLength(2);
        for (const run of runs) {
            const logged = logEvents(run.logFile).find(e => e.type === 'result');
            const { type: _type, t: _t, ...phaseResult } = logged!;
            expect(phaseResult).toMatchObject({ status: 'done', reason: 'until met', partOf: 'plan-1' });

            const recording = readRecording(recordingFile(run.logFile));
            expect(recording.header.run.partOf).toBe('plan-1');
            const clockReads = spyOn(ReplayDriver.prototype, 'now');
            let report;
            try {
                report = await replayRun(recording, chopper({ dropAt: 10 }));
                // The replay's externalStop reads no clock, so the plan's must have read none of its own live.
                const recorded = recording.records.reduce((n, r) => n + (r.w?.length ?? 0), 0);
                expect(clockReads).toHaveBeenCalledTimes(recorded);
            } finally {
                clockReads.mockRestore();
            }
            expect(report.divergence).toBeNull();
            // Duration included: every clock read the phase made live is one the replay reads back.
            expect(report.replayed).toEqual(phaseResult as unknown as TaskResult);
        }
    });

    test("kill writes an error result to the run's log unless its own result is there, and closes the recording", () => {
        const game = new FakeGame();
        const open = () =>
            openLiveRun(game as unknown as BotSDK, {
                dir,
                task: 'chopper',
                bot: 'tester',
                params: { a: 1 },
                stops: [],
                partOf: 'plan-9',
                print: () => {},
                warn: noRecorderWarnings,
            });

        const killed = open();
        const r = killed.kill('killed by SIGTERM', 1234);
        expect(r).toEqual(
            errorResult(
                { task: 'chopper', bot: 'tester', params: { a: 1 }, partOf: 'plan-9' },
                'killed by SIGTERM',
                1234,
                killed,
            ),
        );
        expect(logEvents(killed.logFile).filter(e => e.type === 'result')).toEqual([
            { t: expect.any(Number), type: 'result', ...r },
        ]);
        expect(readRecording(recordingFile(killed.logFile)).truncated).toBe(true);
        killed.close();

        const finished = open();
        finished.sinks.event({ type: 'result', status: 'done', reason: 'ok' });
        expect(finished.kill('killed by SIGINT')).toMatchObject({ runId: '', logFile: '' });
        expect(logEvents(finished.logFile).filter(e => e.type === 'result')).toHaveLength(1);
        finished.close();
    });
});
