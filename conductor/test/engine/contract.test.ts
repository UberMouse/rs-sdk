// The task contract the engine enforces: typed memory, step streaks, `allow`, a task's own guards,
// and the guards' episode state.
import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotWorldState } from '../../../sdk/types';
import { DISMISS_WAIT_TICKS } from '../../actions/dismiss';
import { log, type Op, send, ticks, wait } from '../../core/op';
import type { TaskGuard } from '../../lib/interrupts';
import { defineTask, type Outcome, type Step } from '../../lib/task';
import { act } from '../core/fixtures';
import { LUMBRIDGE, timeline, worldState } from '../world';
import { runDef, runTask } from './harness';

const zOf = (s: BotWorldState) => s.player?.worldZ ?? 0;
const xpOf = (s: BotWorldState) => s.skills[0]?.experience ?? 0;
const count = (xs: string[], x: string) => xs.filter(y => y === x).length;
/** Eats sent: the low-HP guard's, and the engine's one as a run ends below the line with food left. */
const eats = (r: { sends: string[] }) => count(r.sends, 'Eat Shrimps');
/** The dialog guard's clicks. */
const continues = (r: { sends: string[] }) => count(r.sends, 'continue dialog');

/** Done once `tick` is reached. */
const finishAt = (tick: number): Step => ({
    name: 'finish',
    when: ctx => ctx.state().tick >= tick,
    run: ctx => ({ done: `at tick ${ctx.state().tick}` }),
});

/** Lets one tick pass. */
const idleStep: Step = {
    name: 'idle',
    when: () => true,
    *run() {
        yield* ticks(1);
    },
};

describe('streaks', () => {
    test("reset whenever their step's `when` is false, even when an earlier step runs, and not otherwise", async () => {
        const counted: number[] = [];
        const others: number[] = [];
        const steps: Step[] = [
            { name: 'finish', when: ctx => zOf(ctx.state()) === 3, run: () => ({ done: 'end' }) },
            {
                name: 'first',
                when: ctx => [1, 4].includes(zOf(ctx.state())),
                *run() {
                    yield* ticks(1);
                },
            },
            {
                name: 'count',
                when: ctx => ![2, 4].includes(zOf(ctx.state())),
                *run(ctx) {
                    counted.push(ctx.streak('runs').add());
                    yield* ticks(1);
                },
            },
            {
                name: 'other',
                when: () => true,
                *run(ctx) {
                    others.push(ctx.streak('runs').add());
                    yield* ticks(1);
                },
            },
        ];
        // z per tick: `count` runs, runs, is passed over for `first` while still applying, runs, stops
        // applying while `first` runs, runs, stops applying while `other` runs, runs.
        const zs = [0, 0, 1, 0, 4, 0, 2, 0, 3];
        const r = await runTask(
            steps,
            timeline(zs.length, t => ({ z: zs[t] })),
        );
        expect(r.result.status).toBe('done');
        expect(counted).toEqual([1, 2, 3, 1, 1]);
        // Each step has its own streaks.
        expect(others).toEqual([1]);
    });

    test('a generator step owns its streaks across its waits', async () => {
        const counted: number[] = [];
        const steps: Step[] = [
            finishAt(4),
            {
                name: 'count',
                when: ctx => ctx.state().tick !== 2,
                *run(ctx) {
                    // Past a wait: the step owns its streaks until its run ends.
                    yield* ticks(0);
                    counted.push(ctx.streak('runs').add());
                    yield* ticks(1);
                },
            },
            idleStep,
        ];
        const r = await runTask(steps, timeline(6));
        expect(r.result.reason).toBe('finish: at tick 4');
        expect(counted).toEqual([1, 2, 1]);
    });

    test('asking for a streak outside a step run is an error', async () => {
        const steps: Step[] = [{ name: 'misuse', when: ctx => ctx.streak('runs').add(0) > 0, run: () => {} }];
        const r = await runTask(steps, timeline(3));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe(`setup threw: ctx.streak("runs") called outside a step's run`);
    });
});

describe('typed memory', () => {
    const visits = defineTask({
        name: 'visits',
        description: 'typed memory',
        params: z.object({}),
        memory: () => ({ visits: 0, ticks: [] as number[] }),
        steps: [
            {
                name: 'done',
                when: ctx => ctx.memory.visits >= 3,
                run: ctx => ({ done: `${ctx.memory.visits} visits at ticks ${ctx.memory.ticks.join(',')}` }),
            },
            {
                name: 'unused',
                when: () => false,
                *run(ctx) {
                    // @ts-expect-error the factory types `ctx.memory`: a misspelt key does not compile.
                    yield* log(`${ctx.memory.visit}`);
                },
            },
            {
                name: 'visit',
                when: () => true,
                *run(ctx) {
                    ctx.memory.visits += 1;
                    ctx.memory.ticks.push(ctx.state().tick);
                    yield* ticks(1);
                },
            },
        ],
    });

    test('ctx.memory comes from the factory, fresh for each run', async () => {
        for (let run = 0; run < 2; run++) {
            const r = await runDef(visits, timeline(5));
            expect(r.result.reason).toBe('done: 3 visits at ticks 0,1,2');
        }
    });
});

/** Talks to someone, clicks through their dialog and waits for it to close. */
function* talk(): Op<Outcome> {
    yield* send(act('talk'));
    const opened = yield* wait('dialog', s => s.dialog.isOpen, 10);
    if (opened.kind !== 'met') return { fail: 'no dialog' };
    yield* send(act('continue'));
    const closed = yield* wait('closed', s => !s.dialog.isOpen, 10);
    return closed.kind === 'met' ? { done: `closed at tick ${closed.state.tick}` } : { fail: 'still open' };
}

/** Answers a dialog that is open between steps. */
const answer: Step = {
    name: 'answer',
    when: ctx => ctx.state().dialog.isOpen,
    *run() {
        yield* send(act('continue'));
        yield* wait('closed', s => !s.dialog.isOpen, 10);
    },
};

const dialogAt = (from: number, to: number) => timeline(10, t => ({ dialog: t >= from && t <= to }));

describe('allow', () => {
    test("allow: ['dialog'] lets a step drive a dialog inside its waits", async () => {
        const steps: Step[] = [{ name: 'talk', when: () => true, run: talk }];
        const allowed = await runTask(steps, dialogAt(2, 4), { allow: ['dialog'] });
        expect(allowed.result.reason).toBe('talk: closed at tick 5');
        expect(allowed.sends).toEqual(['talk', 'continue']);
        expect(allowed.result.stepRuns).toEqual({ talk: 1 });

        // Without it the guard dismisses the dialog first.
        const guarded = await runTask(steps, dialogAt(2, 4));
        expect(continues(guarded)).toBeGreaterThan(0);
        expect(guarded.result.stepRuns['interrupt:dialog']).toBeGreaterThan(0);
    });

    test('the critical guards cannot be allowed', () => {
        defineTask({
            name: 'critical',
            description: 'allow',
            params: z.object({}),
            // @ts-expect-error death is critical: `allow` only takes the guards a task may handle itself.
            allow: ['death'],
            steps: [],
        });
    });

    test('a task that allows a critical guard through a cast ends in error', async () => {
        const def = defineTask({ name: 'critical', description: 'allow', params: z.object({}), steps: [idleStep] });
        const r = await runDef({ ...def, allow: ['death'] as never }, timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('task allows critical guard(s): death');
        expect(r.sends).toEqual([]);
    });

    test("allow: ['dialog'] leaves a dialog open between steps to the task's own steps", async () => {
        const steps = [answer, finishAt(5), idleStep];
        const allowed = await runTask(steps, dialogAt(0, 1), { allow: ['dialog'] });
        expect(allowed.result.status).toBe('done');
        expect(allowed.sends).toEqual(['continue']);
        expect(allowed.result.stepRuns).toEqual({ answer: 1, idle: 3, finish: 1 });

        const guarded = await runTask(steps, dialogAt(0, 1));
        expect(guarded.result.stepRuns.answer).toBeUndefined();
        expect(guarded.result.stepRuns['interrupt:dialog']).toBeGreaterThan(0);
    });
});

/** HP 4 of 10 (low) on the ticks `low` picks. Each eat uses up one of `food` but heals nothing. */
const lowOn = (n: number, low: (t: number) => boolean, food = 2) => timeline(n, t => ({ hp: low(t) ? 4 : 10, food }));

/** Waits for tick 10; its finally takes two ticks. */
function* slowCleanup(): Op<Outcome> {
    try {
        yield* wait('tick 10', s => s.tick >= 10, 50);
        return { done: 'reached tick 10' };
    } finally {
        yield* ticks(2);
    }
}

/** Waits for XP; dialogs during the wait are the dialog guard's. */
function* waitForXp(): Op<Outcome> {
    const w = yield* wait('xp', s => xpOf(s) > 0, 100);
    return { done: `${w.kind} at tick ${w.state.tick}` };
}

/** A dialog open over two stretches, closed for tick 23 between them. */
const openTwice = (t: number) => (t >= 2 && t <= 22) || (t >= 24 && t <= 44);

const dialogs = (open: (t: number) => boolean) => timeline(40, t => ({ dialog: open(t), xp: t >= 30 ? 25 : 0 }));

describe('guard episodes', () => {
    test('low-HP eats are bounded within one episode', async () => {
        const r = await runTask(
            [idleStep],
            lowOn(20, () => true, 9),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interrupt:low-hp: hp 4/10 at (3222,3218) after 8 eats');
        // The guard's eight, then the engine's one as the run ends still low with food left.
        expect(eats(r)).toBe(8 + 1);
    });

    test('a healthy tick ends a low-HP episode, so the next one gets its own eats', async () => {
        // Six eats, healthy at tick 6, six more: twelve in all, over the per-episode limit of eight.
        const r = await runTask(
            [finishAt(13), idleStep],
            lowOn(20, t => t !== 6 && t < 13, 12),
        );
        expect(r.result.reason).toBe('finish: at tick 13');
        expect(eats(r)).toBe(12);
    });

    test('the low-HP guard re-checks HP after the aborted step cleans up, and does not eat once healed', async () => {
        const r = await runTask(
            [{ name: 'work', when: () => true, run: slowCleanup }],
            lowOn(20, t => t === 3),
        );
        expect(r.result.reason).toBe('work: reached tick 10');
        expect(eats(r)).toBe(0);
        expect(r.result.stepRuns).toEqual({ work: 2, 'interrupt:low-hp': 1 });
    });

    test('a dialog that stays open through a wait fails the run after the stuck limit', async () => {
        const r = await runTask(
            [{ name: 'wait', when: () => true, run: waitForXp }],
            dialogs(t => t >= 2),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interrupt:dialog: dialog stuck open: dialog still on the same page: ');
        // Each run clicks, and waits DISMISS_WAIT_TICKS for the page to move on.
        expect(continues(r)).toBe(6);
        expect(r.driver.state().tick).toBe(2 + 6 * DISMISS_WAIT_TICKS);
    });

    test('a dialog seen closed mid-wait ends its episode, so the next one gets its own runs', async () => {
        // Four stuck runs, then a fifth whose click sees the dialog close at tick 23, where the guard
        // finds it closed; four more stuck runs and a closing one. Eight stuck runs in all, more than
        // the five an episode allows.
        const r = await runTask(
            [{ name: 'wait', when: () => true, run: waitForXp }],
            timeline(70, t => ({ dialog: openTwice(t), xp: t >= 60 ? 25 : 0 })),
        );
        expect(r.result.reason).toBe('wait: met at tick 60');
        expect(continues(r)).toBe(10);
    });
});

const noFood = (spec: (t: number) => { hp?: number; inCombat?: boolean; dead?: boolean }) =>
    timeline(20, t => ({ food: 0, ...spec(t) }));

describe('low HP with nothing to eat', () => {
    test('still losing HP fails the run, out of combat too', async () => {
        const r = await runTask(
            [idleStep],
            noFood(t => ({ hp: 4 - Math.min(3, Math.floor(t / 4)) })),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:low-hp: hp \d\/10 at \(\d+,\d+\), no food$/);
        expect(eats(r)).toBe(0);
    });

    test('flat HP out of combat waits for regeneration, then gives up after the cap', async () => {
        const r = await runTask(
            [idleStep],
            noFood(() => ({ hp: 4 })),
            // 500 ticks of waiting is longer than the default watchdog.
            { stuckAfterMs: 10 * 60 * 60_000 },
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interrupt:low-hp: hp 4/10 at (3222,3218) not regenerating after 500 ticks');
    });

    test('regenerating HP ends the wait without failing', async () => {
        const r = await runTask(
            [finishAt(30), idleStep],
            noFood(t => ({ hp: t < 8 ? 4 : 10 })),
        );
        expect(r.result.reason).toBe('finish: at tick 30');
    });

    test('in combat fails within one regeneration slice', async () => {
        const r = await runTask(
            [idleStep],
            // Out of combat only on the first tick (the engine refuses to start in combat), so the guard
            // spends one regeneration slice before it sees the fight.
            noFood(t => ({ hp: 4, inCombat: t >= 1 })),
        );
        expect(r.result.reason).toBe('interrupt:low-hp: hp 4/10 at (3222,3218), no food');
        expect(r.driver.state().tick).toBeLessThanOrEqual(5);
    });

    test("a death during the low-HP guard's regeneration wait ends the run at once", async () => {
        // The guard waits in slices of five. Dying at tick 8 falls inside a slice: only the guards on
        // during that wait see it before the slice ends.
        const r = await runTask(
            [idleStep],
            noFood(t => ({ hp: 4, dead: t >= 8 })),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:death: /);
        expect(r.driver.state().tick).toBeLessThanOrEqual(9);
    });

    test('a death message from before the run started is not this run', async () => {
        const stale = { type: 0, text: 'Oh dear, you are dead!', sender: '', tick: 2, fromSelf: false };
        const states = Array.from({ length: 10 }, (_, i) => ({ ...worldState(5 + i), gameMessages: [stale] }));
        const r = await runTask([finishAt(8), idleStep], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: at tick 8');
    });
});

/** A task's own guard: aborts while the bot stands north of Lumbridge, failing on a third run in one episode. */
const north: TaskGuard<{ runs: number }> = {
    name: 'north',
    policy: 'abort',
    episode: () => ({ runs: 0 }),
    when: s => zOf(s) > LUMBRIDGE.z,
    *run(_s, _run, episode) {
        if (++episode.runs > 2) return { fail: `north for ${episode.runs} runs` };
        yield* ticks(1);
    },
};

/** Sends `start`, waits for XP; its finally sends `cleanup`. */
function* work(): Op<Outcome> {
    try {
        yield* send(act('start'));
        const w = yield* wait('xp', s => xpOf(s) > 0, 50);
        return { done: `${w.kind} at tick ${w.state.tick}` };
    } finally {
        yield* send(act('cleanup'));
    }
}

/** The guards that fired, as "guard <name> (<policy>) at <tick>". */
const guardLog = (events: Record<string, unknown>[]) =>
    events.flatMap(e =>
        e.type === 'log' && typeof e.msg === 'string' && e.msg.startsWith('guard ')
            ? [`${e.msg} at ${(e.data as { tick: number }).tick}`]
            : [],
    );

const workStep: Step = { name: 'work', when: () => true, run: work };

/** North of Lumbridge on the ticks `isNorth` picks; XP from tick 20. */
const northOn = (isNorth: (t: number) => boolean, more: (t: number) => { hp?: number; food?: number } = () => ({})) =>
    timeline(30, t => ({ z: isNorth(t) ? LUMBRIDGE.z + 1 : LUMBRIDGE.z, xp: t >= 20 ? 25 : 0, ...more(t) }));

const northTwice = (t: number) => t === 3 || t === 4 || t === 8 || t === 9;

describe('task guards', () => {
    test('a task guard aborts a step mid-wait, holds between steps, and the step runs again once clear', async () => {
        const r = await runTask(
            [workStep],
            northOn(t => t === 3 || t === 4),
            { guards: [north] },
        );
        expect(r.result.reason).toBe('work: met at tick 20');
        expect(r.sends).toEqual(['start', 'cleanup', 'start', 'cleanup']);
        // Fired inside the wait at tick 3; its one-tick wait ended at tick 4, where it held between steps.
        expect(guardLog(r.events)).toEqual(['guard interrupt:north (abort) at 3']);
        expect(r.result.stepRuns).toEqual({ work: 2, 'interrupt:north': 2 });
    });

    test("a clear tick ends a task guard's episode, so its limit is per episode", async () => {
        const ok = await runTask([workStep], northOn(northTwice), { guards: [north] });
        expect(ok.result.reason).toBe('work: met at tick 20');
        expect(ok.result.stepRuns['interrupt:north']).toBe(4);

        const held = await runTask(
            [workStep],
            northOn(t => t >= 3 && t <= 10),
            { guards: [north] },
        );
        expect(held.result.status).toBe('failed');
        expect(held.result.reason).toBe('interrupt:north: north for 3 runs');
    });

    test("the shared guards come first, and a task's abort guard does not cut short their handlers", async () => {
        const r = await runTask(
            [workStep],
            northOn(
                t => t === 3,
                t => ({ hp: t === 3 ? 4 : 10, food: 1 }),
            ),
            { guards: [north] },
        );
        expect(r.result.reason).toBe('work: met at tick 20');
        // North still holds as the low-HP guard starts to eat, but ranks below it, so the eat is not cut short.
        expect(r.sends).toEqual(['start', 'cleanup', 'Eat Shrimps', 'start', 'cleanup']);
        expect(guardLog(r.events)).toEqual(['guard interrupt:low-hp (abort) at 3']);
        expect(r.result.stepRuns['interrupt:north']).toBeUndefined();
    });

    test('a task guard named like a shared one ends the run in error before it starts', async () => {
        const r = await runTask([idleStep], timeline(5), { guards: [{ ...north, name: 'dialog' }] });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('task guard name(s) taken: dialog');
        expect(r.sends).toEqual([]);
    });
});
