import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { type Op, send, wait } from '../../core/op';
import type { TaskGuard } from '../../lib/interrupts';
import { defineTask, type Outcome, type Step, type TaskDef } from '../../lib/task';
import { act } from '../core/fixtures';
import { attackedFrom, type StateSpec, timeline, world } from '../world';
import { runDef } from './harness';

const step = (name: string, run: Step['run']): Step => ({ name, when: () => true, run });

const task = (steps: Step[], extra: Partial<TaskDef> = {}): TaskDef => ({
    name: 'coded',
    description: 'outcome code test',
    params: z.object({}),
    steps,
    ...extra,
});

/** Ends the run with `outcome` at once. */
const decides = (outcome: Outcome) => step('decide', () => outcome);

/** Sends one action, waits a tick, then ends with `outcome`. */
function acts(outcome: Outcome): Step {
    return step('act', function* (): Op<Outcome> {
        yield* send(act('poke'));
        yield* wait('a tick', () => false, 1);
        return outcome;
    });
}

/** Waits for what never comes: only a guard ends it. */
const waits = step('wait', function* (): Op<Outcome> {
    yield* send(act('start'));
    yield* wait('never', () => false, 1000);
});

/** Fires from tick 2 and ends the run with `outcome`. */
const firesAt2 = (outcome: Outcome, outcomes?: Record<string, string>): TaskGuard => ({
    name: 'tripwire',
    policy: 'abort',
    episode: () => ({}),
    when: s => s.tick >= 2,
    run: () => outcome,
    ...(outcomes && { outcomes }),
});

describe('outcome codes', () => {
    test("a step's { fail, code } reaches the result beside the unchanged reason", async () => {
        const def = defineTask(
            task([decides({ fail: 'no trees', code: 'no-trees' })], { outcomes: { 'no-trees': 'No tree in view.' } }),
        );
        const r = await runDef(def, timeline(5));
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'decide: no trees',
            endedBy: 'decide',
            code: 'no-trees',
        });
    });

    test("an op step's { done, code } reaches the result", async () => {
        const def = defineTask(
            task([acts({ done: 'full', code: 'full' })], { outcomes: { full: 'The inventory is full.' } }),
        );
        const r = await runDef(def, timeline(5));
        expect(r.result).toMatchObject({ status: 'done', reason: 'act: full', endedBy: 'act', code: 'full' });
    });

    test("a guard's code reaches the result, from inside a wait and checked against the guard's own declaration", async () => {
        const guard = firesAt2({ fail: 'tripped', code: 'tripped' }, { tripped: 'The wire trips.' });
        const r = await runDef(defineTask(task([waits], { guards: [guard] })), timeline(10));
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'interrupt:tripwire: tripped',
            endedBy: 'interrupt:tripwire',
            code: 'tripped',
        });
    });

    test('a run whose outcome has no code has no code key', async () => {
        const r = await runDef(defineTask(task([decides({ fail: 'no trees' })])), timeline(5));
        expect(r.result.reason).toBe('decide: no trees');
        expect(Object.keys(r.result)).not.toContain('code');
        expect(JSON.stringify(r.result)).not.toContain('"code"');
    });

    test('a step ending with a code its task does not declare ends the run error, naming the step and the code', async () => {
        const def = defineTask(
            task([decides({ done: 'full', code: 'full' })], { outcomes: { other: 'Something else.' } }),
        );
        const r = await runDef(def, timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('step "decide" ended with outcome code "full", which it does not declare');
        expect(r.result.code).toBeUndefined();
        expect(r.result.endedBy).toBeUndefined();
    });

    test('a guard ending with a code only its task declares ends the run error, naming the guard', async () => {
        const guard = firesAt2({ fail: 'tripped', code: 'tripped' });
        const def = defineTask(task([waits], { guards: [guard], outcomes: { tripped: 'The task, not the guard.' } }));
        const r = await runDef(def, timeline(10));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe(
            'guard "interrupt:tripwire" ended with outcome code "tripped", which it does not declare',
        );
    });

    test('a step ending with a code only a guard declares ends the run error', async () => {
        const guard = firesAt2(undefined, { tripped: 'The wire trips.' });
        const def = defineTask(task([decides({ fail: 'x', code: 'tripped' })], { guards: [guard] }));
        const r = await runDef(def, timeline(5));
        expect(r.result.reason).toBe('step "decide" ended with outcome code "tripped", which it does not declare');
    });
});

describe('declared outcomes', () => {
    test('defineTask throws on a code that is not lower-case kebab-case, or an empty sentence', () => {
        for (const code of ['Full', 'no_trees', '1st', '-x', 'no trees', ''])
            expect(() => defineTask(task([], { outcomes: { [code]: 'When.' } }))).toThrow(
                `task "coded": outcome code "${code}" is not lower-case kebab-case`,
            );
        expect(() => defineTask(task([], { outcomes: { full: ' ' } }))).toThrow(
            'task "coded": outcome code "full" has no sentence on when it happens',
        );
        expect(() => defineTask(task([], { outcomes: { 'no-trees2': 'When.' } }))).not.toThrow();
    });

    test("defineTask throws on a malformed code a task's guard declares", () => {
        const guard = firesAt2(undefined, { Bad: 'When.' });
        expect(() => defineTask(task([], { guards: [guard] }))).toThrow(
            'guard "tripwire" of task "coded": outcome code "Bad" is not lower-case kebab-case',
        );
    });

    test('a def built without defineTask is checked at run time: the run ends error with the same message', async () => {
        const r = await runDef(task([decides({ done: 'x' })], { outcomes: { Bad: 'When.' } }), timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toStartWith('task "coded": outcome code "Bad" is not lower-case kebab-case');
        const g = await runDef(task([waits], { guards: [firesAt2(undefined, { ok: '' })] }), timeline(5));
        expect(g.result).toMatchObject({
            status: 'error',
            reason: 'guard "tripwire" of task "coded": outcome code "ok" has no sentence on when it happens',
        });
    });
});

/** Ticks 0..n-1 with `spec`, attacked (a goblin beside the bot) from tick 3 until tick 20. */
const fighting = (n: number, spec: (t: number) => StateSpec = () => ({})) =>
    timeline(n, spec).map((s, i) => attackedFrom(world(s), i, 20).build());

/** Attacks, then ends with `outcome` at tick 6, mid-fight. */
const endsMidFight = (outcome: Outcome) =>
    step('fight', function* (): Op<Outcome> {
        yield* send(act('attack'));
        yield* wait('tick 6', s => s.tick >= 6, 1000);
        return outcome;
    });

/** A task of endsMidFight that declares `won`. */
const coded = (outcome: Outcome) => defineTask(task([endsMidFight(outcome)], { outcomes: { won: 'It won.' } }));

describe('outcome codes through the fight settle', () => {
    test("a done whose fight just settles keeps the step's code", async () => {
        const r = await runDef(coded({ done: 'won', code: 'won' }), fighting(30));
        expect(r.result).toMatchObject({ status: 'done', code: 'won', endedBy: 'fight' });
        expect(r.result.reason).toStartWith('fight: won; fight settled in');
    });

    test("a guard that ends the run during the settle gives its own code, dropping the step's", async () => {
        const died = await runDef(
            coded({ done: 'won', code: 'won' }),
            fighting(30, t => ({ hp: t >= 10 ? 0 : 10, dead: t === 10 })),
        );
        expect(died.result).toMatchObject({ status: 'failed', code: 'died', endedBy: 'interrupt:death' });
        const starved = await runDef(
            coded({ done: 'won', code: 'won' }),
            fighting(30, t => ({ hp: t >= 10 ? 4 : 10 })),
        );
        expect(starved.result).toMatchObject({ status: 'failed', endedBy: 'interrupt:low-hp' });
        expect(starved.result.code).toBeUndefined();
    });
});

test('a code that is not a string, from untyped JS, ends the run error', async () => {
    const outcome = { fail: 'x', code: 3 } as unknown as Outcome;
    const r = await runDef(defineTask(task([decides(outcome)], { outcomes: { three: 'Three.' } })), timeline(5));
    expect(r.result.status).toBe('error');
    expect(r.result.code).toBeUndefined();
});
