import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    applyPhaseEvent,
    applyPlanEvent,
    applyRunEvent,
    foldPhase,
    foldRun,
    followed,
    groupSessions,
    type LogEvent,
    nameOf,
    newRun,
    openRun,
    parseGained,
    PHASE_LINES,
    planStats,
    type RunSummary,
    stampTime,
    summarize,
} from '../../../tools/plan-view/model';

const DIR = join(import.meta.dir, '../../fixtures/plan-view/conductor2');
const PLAN = '2026-10-11T00-21-22-727Z-plan-pottery-craft';
const events = (runId: string): LogEvent[] =>
    readFileSync(join(DIR, `${runId}.ndjson`), 'utf8')
        .trim()
        .split('\n')
        .map(l => JSON.parse(l) as LogEvent);

describe('foldRun, a plan', () => {
    test('a finished plan log from before phase-start: runs named at phase-end, the result ending it', () => {
        const run = foldRun('plan', PLAN, 'conductor2', events(PLAN));
        expect(run.name).toBe('pottery-craft');
        expect(run.state).toBe('ended');
        expect(run.phases.map(p => p.phase)).toEqual([
            'bank-pottery',
            'craft-bowl',
            'craft-pot',
            'fill-bucket',
            'fill-jug',
            'mining',
            'shop-rimmington',
            'shop-lumbridge',
            'prep',
        ]);
        expect(run.selections).toHaveLength(6);
        expect(run.runs.map(r => [r.phase, r.runId, r.status])).toEqual([
            ['shop-lumbridge', '2026-10-11T00-21-22-734Z-shop', 'done'],
            ['shop-rimmington', '2026-10-11T00-21-25-548Z-shop', 'done'],
            ['mining', '2026-10-11T00-22-38-352Z-mining', 'done'],
            ['fill-bucket', '2026-10-11T00-23-21-142Z-fill', 'done'],
            ['craft-pot', '2026-10-11T00-23-55-152Z-crafting', 'done'],
            ['craft-bowl', '2026-10-11T00-25-05-121Z-crafting', 'failed'],
        ]);
        expect(run.runs[1]!.selection).toBe(1);
        expect(run.selections[1]!.inventory).toMatchObject({ Coins: 24, Jug: 2 });
        expect(run.result?.status).toBe('failed');
        expect(run.endedAt).toBe(run.result!.t);
        // Logs before the CLI stamped them have no session or pid.
        expect(run.session).toBeNull();
        expect(run.pid).toBeNull();
        expect(run.sourceCopy).toEndWith(`${PLAN}.plan.ts`);
    });

    test('phase-start names the run while it is open; source carries pid and session', () => {
        const run = newRun('plan', '2026-10-11T01-00-00-000Z-plan-p', 'b');
        expect(run.name).toBe('p');
        expect(run.startedAt).toBe(Date.parse('2026-10-11T01:00:00.000Z'));
        const apply = (e: Record<string, unknown>) => applyPlanEvent(run, { t: 10, ...e } as LogEvent);
        apply({ type: 'source', file: 'f.ts', copy: 'c.plan.ts', pid: 42, session: 's1' });
        apply({ type: 'start', plan: 'p', phases: [{ phase: 'a', task: 'a', params: {} }], requires: [], stops: [] });
        apply({ type: 'select', phase: 'a', checks: { a: 'chosen' }, last: null, inventory: {}, free: 28, bank: null });
        expect(openRun(run)).toMatchObject({ phase: 'a', runId: null, endedAt: null });
        apply({ type: 'phase-start', phase: 'a', index: 0, runId: 'r-a', logFile: '/x/r-a.ndjson' });
        expect(openRun(run)).toMatchObject({ runId: 'r-a', logFile: '/x/r-a.ndjson' });
        expect(run).toMatchObject({ pid: 42, session: 's1', state: 'running' });
        apply({ type: 'phase-end', phase: 'a', runId: 'r-a', status: 'done', reason: 'ok' });
        expect(openRun(run)).toBeNull();
        expect(run.runs[0]).toMatchObject({ status: 'done', reason: 'ok', endedAt: 10 });
    });

    test("a select's reads, the plan's own and each phase's; phase-end's time and XP", () => {
        const run = newRun('plan', '2026-10-11T01-00-00-000Z-plan-p', 'b');
        const apply = (e: Record<string, unknown>) => applyPlanEvent(run, { t: 10, ...e } as LogEvent);
        apply({ type: 'start', plan: 'p', phases: [{ phase: 'a', task: 'a', params: {} }], requires: [], stops: [] });
        apply({
            type: 'select',
            phase: 'a',
            checks: { a: 'chosen' },
            reads: { a: { "inv('Logs')": 3 } },
            planReads: { "level('Fishing')": 65 },
            last: null,
            inventory: {},
            free: 28,
            bank: null,
        });
        expect(run.selections[0]).toMatchObject({
            reads: { a: { "inv('Logs')": 3 } },
            planReads: { "level('Fishing')": 65 },
        });
        apply({ type: 'phase-end', status: 'done', reason: 'ok', durationMs: 9, xpGained: { Fishing: 50 } });
        expect(run.runs[0]).toMatchObject({ durationMs: 9, xpGained: { Fishing: 50 } });
        // a log from before them
        apply({ type: 'select', phase: 'a', checks: {}, last: null, inventory: {}, free: 28, bank: null });
        expect(run.selections[1]).toMatchObject({ reads: {}, planReads: null });
    });

    test('a kill ends the phase in progress as the result counts it', () => {
        const run = newRun('plan', 'x-plan-p', 'b');
        const apply = (e: Record<string, unknown>) => applyPlanEvent(run, { t: 5, ...e } as LogEvent);
        apply({ type: 'select', phase: 'a', checks: {}, last: null, inventory: {}, free: 1, bank: null });
        apply({ type: 'phase-start', phase: 'a', index: 0, runId: 'r-a', logFile: 'l' });
        apply({
            type: 'result',
            status: 'error',
            reason: 'killed by SIGINT',
            recent: [{ phase: 'a', runId: 'r-a', logFile: 'l', status: 'error', reason: 'killed by SIGINT' }],
        });
        expect(run.state).toBe('ended');
        expect(run.runs[0]).toMatchObject({ status: 'error', reason: 'killed by SIGINT', endedAt: 5 });
    });

    test('malformed phases, last and result fields are dropped or defaulted, not trusted', () => {
        const run = newRun('plan', 'x-plan-p', 'b');
        const apply = (e: Record<string, unknown>) => applyPlanEvent(run, { t: 1, ...e } as LogEvent);
        apply({ type: 'start', phases: [{ phase: 'a', task: 'chop' }, 'junk', { phase: 3 }] });
        expect(run.phases).toEqual([{ phase: 'a', task: 'chop', params: null }]);
        apply({ type: 'select', phase: 'a', checks: {}, last: { phase: 'z', status: 'weird' } });
        expect(run.selections[0]!.last).toBeNull();
        apply({ type: 'result', status: 'done', reason: 'r', xpGained: 'lots' });
        expect(run.result).toMatchObject({ status: 'done', xpGained: {}, inventoryDelta: {}, levelsGained: {} });
    });

    test('a select with no phase starts no run; malformed events are ignored', () => {
        const run = newRun('plan', 'x-plan-p', 'b');
        applyPlanEvent(run, { t: 1, type: 'select', phase: null, checks: 'nope' } as unknown as LogEvent);
        applyPlanEvent(run, { t: 2, type: 'phase-end', phase: 'a' } as LogEvent);
        applyPlanEvent(run, { t: 3, type: 'who-knows' } as LogEvent);
        expect(run.runs).toEqual([]);
        expect(run.selections[0]).toMatchObject({ phase: null, checks: {}, free: 0 });
    });
});

describe('task runs', () => {
    test("a task log folds as a run of one phase, the log's own; its result names the plan it was part of", () => {
        const id = '2026-10-11T00-22-38-352Z-mining';
        const run = foldRun('task', id, 'conductor2', events(id));
        expect(run).toMatchObject({ kind: 'task', name: 'mining', state: 'ended', partOf: PLAN, selections: [] });
        expect(run.phases.map(p => [p.phase, p.task])).toEqual([['mining', 'mining']]);
        expect(run.runs).toHaveLength(1);
        expect(run.runs[0]).toMatchObject({ index: 0, phase: 'mining', runId: id, status: 'done', selection: -1 });
        expect(run.runs[0]!.endedAt).toBe(run.result!.t);
        expect(summarize(run)).toMatchObject({ kind: 'task', name: 'mining', phaseRuns: 1, status: 'done' });
    });

    test('a task run of its own: source carries pid and session; it runs until its result', () => {
        const run = newRun('task', '2026-10-11T01-00-00-000Z-woodcutting', 'b');
        expect(run.name).toBe('woodcutting');
        const apply = (e: Record<string, unknown>) => applyRunEvent(run, { t: 10, ...e } as LogEvent);
        apply({ type: 'source', pid: 42, session: 's1' });
        apply({ type: 'start', task: 'woodcutting', bot: 'b', params: { tree: 'oak' }, stops: [{ kind: 'minutes' }] });
        expect(openRun(run)).toMatchObject({ runId: run.runId, phase: 'woodcutting', startedAt: 10 });
        expect(run).toMatchObject({ pid: 42, session: 's1', state: 'running', stops: [{ kind: 'minutes' }] });
        expect(run.phases[0]!.params).toEqual({ tree: 'oak' });
        apply({ type: 'step', step: 'chop' });
        apply({ type: 'result', status: 'failed', reason: 'chop: no tree', xpGained: { Woodcutting: 25 } });
        expect(openRun(run)).toBeNull();
        expect(run).toMatchObject({ state: 'ended', partOf: null, endedAt: 10 });
        expect(run.runs[0]).toMatchObject({ status: 'failed', reason: 'chop: no tree' });
        expect(summarize(run).xpGained).toBe(25);
    });

    test('nameOf reads the plan or task name from a runId', () => {
        expect(nameOf('plan', PLAN)).toBe('pottery-craft');
        expect(nameOf('task', '2026-10-11T00-23-21-142Z-fill')).toBe('fill');
        expect(nameOf('task', '2026-10-11T00-23-21-142Z-fish-cook')).toBe('fish-cook');
    });
});

describe('foldPhase', () => {
    test('a phase log: current step, step counts from progress and result, XP, lines', () => {
        const log = foldPhase('2026-10-11T00-23-55-152Z-crafting', events('2026-10-11T00-23-55-152Z-crafting'));
        expect(log.task).toBe('crafting');
        expect(log.params).toMatchObject({ product: 'pot' });
        expect(log.step).toBe('fire');
        expect(log.gained).toBe('Crafting +315');
        expect(log.stepRuns).toEqual({ 'return-to-area': 1, soften: 4, shape: 4, 'interrupt:dialog': 4, fire: 1 });
        expect(log.lines.at(-1)).toMatchObject({ kind: 'stop', text: 'stop: until met' });
        expect(log.lines.filter(l => l.kind === 'log')).toHaveLength(4);
        expect(log.result?.status).toBe('done');
    });

    test('keeps the last PHASE_LINES lines', () => {
        const many = Array.from({ length: PHASE_LINES + 5 }, (_, i) => ({ t: i, type: 'step', step: `s${i}` }));
        const log = foldPhase('x-woodcutting', many);
        expect(log.task).toBe('woodcutting');
        expect(log.lines).toHaveLength(PHASE_LINES);
        expect(log.lines[0]!.text).toBe('s5');
        expect(log.stepRuns['s0']).toBe(1);
    });
});

const row = (p: Partial<RunSummary> & Pick<RunSummary, 'runId' | 'startedAt'>): RunSummary => ({
    bot: 'b',
    kind: 'plan',
    name: 'p',
    endedAt: p.startedAt + 1,
    state: 'ended',
    status: 'done',
    reason: null,
    session: null,
    phaseRuns: 0,
    xpGained: 0,
    ...p,
});

describe('sessions', () => {
    test('groups by session, untagged by local day; a running session first, then newest', () => {
        const day = new Date(2026, 9, 11, 12).getTime();
        const groups = groupSessions([
            row({ runId: 'a', startedAt: day, session: 's1', bot: 'w1' }),
            row({ runId: 'b', startedAt: day + 100, session: 's1', bot: 'main' }),
            row({ runId: 'c', startedAt: day - 50, session: 's2', state: 'running', endedAt: null }),
            row({ runId: 'd', startedAt: day + 500 }),
            row({ runId: 'e', startedAt: day + 86_400_000 }),
        ]);
        expect(groups.map(g => g.key)).toEqual(['s2', 'untagged:2026-10-12', 'untagged:2026-10-11', 's1']);
        const s1 = groups.at(-1)!;
        expect(s1.runs.map(p => p.runId)).toEqual(['b', 'a']);
        expect(s1.bots).toEqual(['main', 'w1']);
        expect(s1).toMatchObject({ firstAt: day, lastAt: day + 101 });
    });

    test("followed is the bot's newest plan", () => {
        const plans = [
            row({ runId: 'a', startedAt: 1 }),
            row({ runId: 'b', startedAt: 3 }),
            row({ runId: 'c', startedAt: 9, bot: 'o' }),
        ];
        expect(followed(plans, 'b')?.runId).toBe('b');
        expect(followed(plans, 'none')).toBeNull();
    });

    test('summarize totals XP and reads the result', () => {
        const s = summarize(foldRun('plan', PLAN, 'conductor2', events(PLAN)));
        expect(s).toMatchObject({
            kind: 'plan',
            name: 'pottery-craft',
            status: 'failed',
            phaseRuns: 6,
            xpGained: 1787,
            state: 'ended',
        });
    });

    test('stampTime reads a runId stamp', () => {
        expect(stampTime(PLAN)).toBe(Date.parse('2026-10-11T00:21:22.727Z'));
        expect(stampTime('plan-x')).toBeNull();
    });
});

/** A plan of walk, fish and bank phases, at t (ms) from 0. */
const plan = () => {
    const run = newRun('plan', '2026-10-11T01-00-00-000Z-plan-p', 'b');
    const apply = (t: number, e: Record<string, unknown>) => applyPlanEvent(run, { t, ...e } as LogEvent);
    apply(0, {
        type: 'start',
        plan: 'p',
        phases: [
            { phase: 'walk', task: 'travel', params: {} },
            { phase: 'fish', task: 'fishing', params: {} },
            { phase: 'bank', task: 'bank', params: {} },
        ],
        requires: [],
        stops: [],
    });
    const select = (t: number, phase: string) =>
        apply(t, { type: 'select', phase, checks: {}, last: null, inventory: {}, free: 28, bank: null });
    return { run, apply, select };
};

describe('planStats', () => {
    test('a running plan: time per phase with the open run, XP over finished runs, and the gaps between', () => {
        const { run, apply, select } = plan();
        select(1_000, 'walk');
        apply(61_000, { type: 'phase-end', status: 'done', reason: 'there', durationMs: 60_000, xpGained: {} });
        select(62_000, 'fish');
        const fishXp = { Fishing: 3000, Cooking: 0 };
        apply(182_000, { type: 'phase-end', status: 'done', reason: 'full', durationMs: 120_000, xpGained: fishXp });
        select(183_000, 'fish');
        // fish's second run is open; now is 243 s in
        const st = planStats(run, 243_000);
        expect(st.phases).toEqual([
            { phase: 'walk', runs: 1, fails: 0, timeMs: 60_000, xp: {}, xpTimeMs: 60_000 },
            { phase: 'fish', runs: 2, fails: 0, timeMs: 180_000, xp: fishXp, xpTimeMs: 120_000 },
            { phase: 'bank', runs: 0, fails: 0, timeMs: 0, xp: null, xpTimeMs: 0 },
        ]);
        expect(st).toMatchObject({
            elapsedMs: 243_000,
            productiveMs: 180_000,
            overheadMs: 60_000,
            unratedMs: 0,
            betweenMs: 3_000,
            xp: { Fishing: 3000, Cooking: 0 },
            // to the end of the last finished run: the open one's 60 s have no XP yet
            xpTimeMs: 183_000,
        });
    });

    test("the open run's XP so far counts, rated over the time to its latest progress", () => {
        const { run, apply, select } = plan();
        select(0, 'walk');
        apply(60_000, { type: 'phase-end', status: 'done', reason: 'there', durationMs: 60_000, xpGained: {} });
        select(60_000, 'fish');
        // fishing since 60 s; its log's latest progress, at 150 s, says +4500; now is 160 s
        const st = planStats(run, 160_000, { xp: { Fishing: 4500 }, at: 150_000 });
        expect(st.phases[1]).toEqual({
            phase: 'fish',
            runs: 1,
            fails: 0,
            timeMs: 100_000,
            xp: { Fishing: 4500 },
            xpTimeMs: 90_000,
        });
        expect(st).toMatchObject({ productiveMs: 100_000, xp: { Fishing: 4500 }, xpTimeMs: 150_000 });
        // without it the open run has no XP yet
        expect(planStats(run, 160_000).phases[1]).toMatchObject({ xp: null, xpTimeMs: 0 });
    });

    test('runs without phase-end XP (older logs) leave their phase and the plan unrated', () => {
        const { run, apply, select } = plan();
        select(0, 'fish');
        apply(10_000, { type: 'phase-end', status: 'failed', reason: 'no spot' });
        const st = planStats(run, 20_000);
        expect(st.phases[1]).toEqual({ phase: 'fish', runs: 1, fails: 1, timeMs: 10_000, xp: null, xpTimeMs: 0 });
        expect(st).toMatchObject({ unratedMs: 10_000, productiveMs: 0, xp: null });
    });

    test("an ended plan takes each phase's totals from its result", () => {
        const run = foldRun('plan', PLAN, 'conductor2', events(PLAN));
        const st = planStats(run, 0);
        for (const summary of run.result!.phases!) {
            const ps = st.phases.find(p => p.phase === summary.phase)!;
            expect(ps).toMatchObject({ timeMs: summary.durationMs, xp: summary.xpGained });
        }
        expect(st.elapsedMs).toBe(run.endedAt! - run.startedAt);
        expect(st.phases.find(p => p.phase === 'craft-bowl')).toMatchObject({ runs: 1, fails: 1 });
    });
});

describe('phase log XP', () => {
    test('parseGained reads the progress summary', () => {
        expect(parseGained('Thieving +25290, Hitpoints +12')).toEqual({ Thieving: 25290, Hitpoints: 12 });
        expect(parseGained('')).toEqual({});
    });

    test('progress sets the XP so far and when; the result replaces it', () => {
        const log = foldPhase('2026-10-11T01-00-00-000Z-thieving', [
            { t: 5, type: 'progress', stepRuns: {}, gained: 'Thieving +300' },
        ] as LogEvent[]);
        expect(log).toMatchObject({ xpGained: { Thieving: 300 }, xpAt: 5 });
        applyPhaseEvent(log, { t: 9, type: 'result', status: 'done', reason: 'ok', xpGained: { Thieving: 420 } });
        expect(log).toMatchObject({ xpGained: { Thieving: 420 }, xpAt: 9 });
    });
});
