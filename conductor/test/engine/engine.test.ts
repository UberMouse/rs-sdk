import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotWorldState } from '../../../sdk/types';
import { SMITHING_INTERFACE } from '../../actions/dismiss';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { TickStall } from '../../core/interpret';
import { type Op, send, ticks, uninterruptible, wait } from '../../core/op';
import { LEFTOVER_CLOSE_TICKS, LEFTOVER_STEP, MAX_STEP_COMMANDS, SETTLE_TICKS } from '../../lib/engine';
import type { TaskGuard } from '../../lib/interrupts';
import { defineTask, type Outcome, type Step } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import { act } from '../core/fixtures';
import { attackedFrom, type StateSpec, timeline, world, type World } from '../world';
import { runDef, runTask } from './harness';

const xpOf = (s: BotWorldState) => s.skills[0]?.experience ?? 0;

/** Sends `chop`, waits for XP; its finally sends `cleanup`. */
function* chop(): Op<Outcome> {
    try {
        yield* send(act('chop'));
        const w = yield* wait('xp', s => xpOf(s) > 0, 50);
        return w.kind === 'met' ? { done: `xp at tick ${w.state.tick}` } : { fail: 'no xp' };
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Waits for something that never comes; its finally sends `cleanup`. */
function* idle(): Op<Outcome> {
    try {
        yield* send(act('start'));
        yield* wait('never', () => false, 1000);
        return { done: 'unreachable' };
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Opens the bank, then waits uninterruptibly; its finally closes the bank. */
function* banking(): Op<Outcome> {
    try {
        yield* send(act('open bank'));
        yield* uninterruptible(wait('never', () => false, 50));
        return { done: 'unreachable' };
    } finally {
        yield* send(act('close bank'));
    }
}

/** Sends forever without waiting; its finally sends `cleanup`. */
function* spam(): Op<Outcome> {
    try {
        for (;;) yield* send(act('spam'));
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Waits for XP, then fails. */
function* chopOnce(): Op<Outcome> {
    yield* wait('xp', s => xpOf(s) > 0, 50);
    return { fail: 'out of trees' };
}

/** Waits a tick, then throws. */
function* boom(): Op<Outcome> {
    yield* wait('a tick', () => false, 1);
    throw new Error('boom');
}

/** Rejects a microtask later, so an unhandled rejection would surface while the test still runs. */
async function lateReject(): Promise<never> {
    await Promise.resolve();
    throw new Error('late boom');
}

/** A task guard whose async `run` (past the types) fires from `from` on. */
const asyncGuard = (from: number): TaskGuard => ({
    name: 'async',
    policy: 'abort',
    episode: () => ({}),
    when: s => s.tick >= from,
    run: lateReject as unknown as TaskGuard['run'],
});

const step = (name: string, run: Step['run']): Step => ({ name, when: () => true, run });

/** A step that waits what ctx.stepTicksLeft() says is left, plus `extra`, recording what it read. */
const spendLeft = (extra: number, seen: (number | undefined)[]): Step => ({
    name: 'spend',
    when: () => true,
    *run(ctx) {
        const left = ctx.stepTicksLeft();
        seen.push(left);
        yield* ticks(3);
        seen.push(ctx.stepTicksLeft());
        yield* ticks((left ?? 0) - 3 + extra);
        return { done: `waited at tick ${ctx.state().tick}` };
    },
});

const guardLog = (events: Record<string, unknown>[], name: string) =>
    events.filter(e => e.type === 'log' && typeof e.msg === 'string' && e.msg.startsWith(`guard ${name} `));

/** HP drops at tick 2; the bot slides one tile a tick until `holdEnd`; the eat lands at `healAt`. */
const held = (holdEnd: number, healAt: number) =>
    timeline(60, t => ({
        hp: t >= 2 && t < healAt ? 4 : 10,
        food: t >= healAt ? 1 : 2,
        xp: t >= healAt + 3 ? 25 : 0,
    })).map((s, t) => ({
        ...s,
        player: s.player && { ...s.player, worldX: s.player.worldX + Math.min(t, holdEnd) },
    }));
const ignoring = { react: () => undefined };

describe('guards during a generator step', () => {
    test('low HP mid-wait aborts the step, runs its finally, eats, and the step runs again', async () => {
        const states = timeline(20, t => ({ hp: t === 3 || t === 4 ? 4 : 10, food: 2, xp: t >= 10 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: xp at tick 10');
        // Aborted at tick 3, cleaned up, ate, then chopped again once HP was back. The guard's eat
        // took a tick (the shrimp gone at tick 4); HP was still low then, so the interrupt ate again
        // between steps, as it would for a legacy task.
        expect(r.sends).toEqual(['chop', 'cleanup', 'Eat Shrimps', 'Eat Shrimps', 'chop', 'cleanup']);
        expect(guardLog(r.events, 'interrupt:low-hp')).toEqual([
            { type: 'log', msg: 'guard interrupt:low-hp (abort)', data: { tick: 3 } },
        ]);
        expect(r.result.stepRuns).toEqual({ chop: 2, 'interrupt:low-hp': 2 });
    });

    test('a level-up dialog mid-wait is dismissed and the same wait completes', async () => {
        const states = timeline(20, t => ({ dialog: t === 3, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: xp at tick 8');
        expect(r.sends).toEqual(['chop', 'continue dialog', 'cleanup']);
        expect(r.result.stepRuns).toEqual({ chop: 1, 'interrupt:dialog': 1 });
    });

    describe('starting in combat', () => {
        const fighting = timeline(10, t => ({
            inCombat: t < 5,
            lastDamageTick: t < 5 ? t : undefined,
            xp: t >= 5 ? 1 : 0,
        }));
        const steps = [step('chop', chop)];
        const fleeing = defineTask({
            name: 'test',
            description: 'engine test',
            params: z.object({ flee: z.boolean() }),
            startInCombat: p => p.flee,
            steps,
        });

        test('is refused by default, naming the attacker', async () => {
            const r = await runTask(steps, fighting);
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toStartWith('in combat at');
            expect(r.sends).toEqual([]);
        });

        test('a stale inCombat flag (no attacker, last hit long ago) does not refuse', async () => {
            // The replayed hill-giant start: inCombat true, no target, the last hit 17 ticks before.
            const stale = timeline(30, t => ({ inCombat: true, lastDamageTick: 0, xp: t >= 20 ? 1 : 0 })).map(s => ({
                ...s,
                tick: s.tick + 17,
            }));
            const r = await runTask(steps, stale);
            expect(r.result.reason).not.toStartWith('in combat');
        });

        test('is allowed for a task whose startInCombat holds for its params, and only then', async () => {
            const allowed = await runDef(fleeing, fighting, { params: { flee: true } });
            expect(allowed.result.status).toBe('done');
            const refused = await runDef(fleeing, fighting, { params: { flee: false } });
            expect(refused.result.reason).toStartWith('in combat at');
        });
    });

    describe('low HP while a movement script holds the player', () => {
        test('an eat ignored during the hold is retried once it ends', async () => {
            const r = await runTask([step('chop', chop)], held(14, 20), ignoring);
            expect(r.result.status).toBe('done');
            expect(r.sends.filter(x => x === 'Eat Shrimps').length).toBe(2);
            expect(r.events.some(e => String(e.msg).includes('eat ignored while held'))).toBe(true);
        });

        test('a hold that never ends fails after a bounded number of retries', async () => {
            const r = await runTask([step('chop', chop)], held(1000, 1000), ignoring);
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toContain('could not eat Shrimps');
            expect(r.sends.filter(x => x === 'Eat Shrimps').length).toBe(4); // the first eat and 3 held retries
        });

        test('an eat ignored while animating in place is retried once the animation ends', async () => {
            const anim = timeline(60, t => ({
                hp: t >= 2 && t < 28 ? 4 : 10,
                food: t >= 28 ? 1 : 2,
                xp: t >= 31 ? 25 : 0,
            })).map((s, t) => ({ ...s, player: s.player && { ...s.player, animId: t < 20 ? 5 : -1 } }));
            const r = await runTask([step('chop', chop)], anim, ignoring);
            expect(r.result.status).toBe('done');
            expect(r.events.some(e => String(e.msg).includes('eat ignored while held'))).toBe(true);
        });

        test('an eat ignored under fire is not retried', async () => {
            const fight = timeline(60, t => ({ hp: t >= 2 ? 4 : 10, food: 2, inCombat: t >= 2, xp: 0 })).map(s => ({
                ...s,
                player: s.player && { ...s.player, animId: 5 },
            }));
            const r = await runTask([step('chop', chop)], fight, ignoring);
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toContain('could not eat Shrimps');
            expect(r.events.some(e => String(e.msg).includes('eat ignored while held'))).toBe(false);
        });

        test('an eat ignored while standing still is not retried', async () => {
            const r = await runTask([step('chop', chop)], held(0, 1000), ignoring);
            expect(r.result.status).toBe('failed');
            expect(r.sends.filter(x => x === 'Eat Shrimps').length).toBe(2); // the guard's, and the end-of-run one
        });
    });

    describe('low HP with no food', () => {
        const hurt = timeline(20, t => ({ hp: 4, food: 0, inCombat: t >= 3, xp: t >= 8 ? 25 : 0 }));
        const steps = [step('chop', chop)];
        const walker = defineTask({
            name: 'test',
            description: 'engine test',
            params: z.object({ keep: z.boolean() }),
            keepGoingWithoutFood: p => p.keep,
            startInCombat: () => true,
            steps,
        });

        test('fails the run by default', async () => {
            const r = await runTask(steps, hurt);
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toStartWith('interrupt:low-hp: hp 4/10');
        });

        test('does not for a task whose keepGoingWithoutFood holds for its params, and only then', async () => {
            const fighting = timeline(20, t => ({ hp: 4, food: 0, inCombat: true, xp: t >= 8 ? 25 : 0 }));
            const kept = await runDef(walker, fighting, { params: { keep: true } });
            expect(kept.result.status).toBe('done');
            expect(kept.result.stepRuns['interrupt:low-hp']).toBeUndefined();
            const failed = await runDef(walker, hurt, { params: { keep: false } });
            expect(failed.result.reason).toStartWith('interrupt:low-hp');
        });

        test('such a task out of combat still rests to regenerate', async () => {
            const resting = timeline(30, t => ({ hp: t >= 6 ? 10 : 4, food: 0, xp: t >= 12 ? 25 : 0 }));
            const r = await runDef(walker, resting, { params: { keep: true } });
            expect(r.result.status).toBe('done');
            expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
        });

        test('such a task hit out of combat (ranged, flickering flag) keeps going too', async () => {
            const shot = timeline(20, t => ({
                hp: 4,
                food: 0,
                inCombat: false,
                lastDamageTick: t,
                xp: t >= 8 ? 25 : 0,
            }));
            const r = await runDef(walker, shot, { params: { keep: true } });
            expect(r.result.status).toBe('done');
            expect(r.result.stepRuns['interrupt:low-hp']).toBeUndefined();
        });

        test('such a task still eats held food at low HP', async () => {
            const fed = timeline(20, t => ({ hp: t === 3 || t === 4 ? 4 : 10, food: 2, xp: t >= 10 ? 25 : 0 }));
            const r = await runDef(walker, fed, { params: { keep: true } });
            expect(r.result.status).toBe('done');
            expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
        });
    });

    test('a respawn since the run started ends the run with the death guard', async () => {
        const base = timeline(10, t => ({ dead: t === 3 }));
        const states = base.map(s => ({ ...s, player: { ...s.player!, respawnCount: s.tick >= 3 ? 1 : 0 } }));
        const r = await runTask([step('idle', idle)], states);
        expect(r.result).toMatchObject({ status: 'failed', endedBy: 'interrupt:death' });
    });

    test('death mid-wait fails the run, even inside an uninterruptible section', async () => {
        const r = await runTask(
            [step('bank', banking)],
            timeline(20, t => ({ dead: t === 4 })),
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:death: died');
        expect(r.result.endedBy).toBe('interrupt:death');
        expect(r.sends).toEqual(['open bank', 'close bank']);
        expect(r.result.lastStep).toBe('bank');
    });
});

/** A main modal outside NEVER_CLOSE_INTERFACES, standing in for a book or quest scroll. */
const BOOK = 1234;

describe('the interface guard', () => {
    test('a book opened mid-wait is closed and the same wait completes', async () => {
        const states = timeline(20, t => ({ interfaceId: t === 3 || t === 4 ? BOOK : undefined, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: xp at tick 8');
        expect(r.sends).toEqual(['chop', `close interface ${BOOK}`, 'cleanup']);
        expect(r.result.stepRuns).toEqual({ chop: 1, 'interrupt:interface': 1 });
    });

    test('a task that allows it keeps the interface open', async () => {
        const states = timeline(20, t => ({ interfaceId: t >= 3 ? BOOK : undefined, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states, { allow: ['interface'] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['chop', 'cleanup']);
        expect(r.result.stepRuns).toEqual({ chop: 1 });
    });

    test('an interface that will not close fails the run after the episode limit', async () => {
        const states = timeline(30, t => ({ interfaceId: t >= 3 ? BOOK : undefined }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `interrupt:interface: interface ${BOOK} stuck open after 3 closes: interface ${BOOK} still open`,
        );
        const close = `close interface ${BOOK}`;
        expect(r.sends).toEqual(['chop', close, close, close, 'cleanup']);
    });
});

/** A closeModal takes any main modal and dialog away from the next tick on. */
const closes: TimelineOptions['react'] = action =>
    action.type === 'closeModal'
        ? s => (s.interface.isOpen || s.dialog.isOpen ? world(s).modal(false).dialog(false).build() : s)
        : undefined;
const closeLeftover = (what: string) => `close ${what}`;
const leftoverLog = (events: Record<string, unknown>[]) =>
    events.filter(e => e.type === 'log' && typeof e.msg === 'string' && e.msg.includes('left open before the run'));

const withChoice = (options: string[]) =>
    timeline(20, t => ({ xp: t >= 8 ? 25 : 0 })).map((s, i) => (i < 20 ? world(s).dialog({ options }).build() : s));
const gone: TimelineOptions['react'] = action =>
    action.type === 'clickDialogOption' || action.type === 'closeModal'
        ? s => world(s).dialog(false).build()
        : undefined;

describe('a modal left open before the run', () => {
    test('the anvil interface open at the start is closed before the first step', async () => {
        const states = timeline(20, t => ({ interfaceId: SMITHING_INTERFACE, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states, { react: closes });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([closeLeftover(`interface ${SMITHING_INTERFACE}`), 'chop', 'cleanup']);
        expect(r.result.stepRuns).toEqual({ [LEFTOVER_STEP]: 1, chop: 1 });
        expect(leftoverLog(r.events).map(e => e.msg)).toEqual([
            `interface ${SMITHING_INTERFACE} left open before the run: clearing it`,
        ]);
    });

    test('nothing open sends nothing extra', async () => {
        const states = timeline(20, t => ({ xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states, { react: closes });
        expect(r.sends).toEqual(['chop', 'cleanup']);
        expect(r.result.stepRuns).toEqual({ chop: 1 });
        expect(leftoverLog(r.events)).toEqual([]);
    });

    test('a skill make menu open at the start is closed too', async () => {
        const menu = ['Make X', 'Make 10', 'Make 5', 'Arrow shafts'];
        const states = timeline(20, t => ({ xp: t >= 8 ? 25 : 0 })).map(s =>
            world(s).dialog({ options: menu }).build(),
        );
        const r = await runTask([step('chop', chop)], states, { react: closes });
        expect(r.sends).toEqual([closeLeftover('skill menu'), 'chop', 'cleanup']);
    });

    describe('a choice dialog left open before the run', () => {
        const toll = ["No thank you, I'll walk around.", 'Who does my money go to?', 'Yes, ok.'];
        test('is declined with its refusal, never the paying option', async () => {
            const r = await runTask([step('chop', chop)], withChoice(toll), { react: gone });
            expect(r.result.status).toBe('done');
            expect(r.sends).toEqual(['decline stray choice', 'chop', 'cleanup']);
            expect(r.result.stepRuns[LEFTOVER_STEP]).toBe(1);
        });

        test('a "continue" page first, then the choice: the guard declines it after the stuck limit and the run goes on', async () => {
            const states = timeline(60, t => ({ xp: t >= 40 ? 25 : 0 })).map((s, i) =>
                i < 40
                    ? world(s)
                          .dialog({ options: i < 2 ? ['Click here to continue'] : toll })
                          .build()
                    : s,
            );
            const r = await runTask([step('chop', chop)], states, {
                react: a =>
                    a.type === 'clickDialogOption' && a.reason.startsWith('decline')
                        ? s => world(s).dialog(false).build()
                        : a.type === 'clickDialogOption'
                          ? s => world(s).dialog({ options: toll }).build()
                          : undefined,
            });
            expect(r.result.status).toBe('done');
            expect(r.sends.filter(x => x === 'decline stray choice')).toHaveLength(1);
            expect(r.sends).not.toContain('pay the toll');
        });

        test('with no refusal among the options it is closed', async () => {
            const r = await runTask([step('chop', chop)], withChoice(['Yes, ok.', 'Who does my money go to?']), {
                react: gone,
            });
            expect(r.sends).toEqual(['close stray choice', 'chop', 'cleanup']);
        });

        test('a task that drives dialogs keeps it', async () => {
            const r = await runTask([step('chop', chop)], withChoice(toll), { react: gone, allow: ['dialog'] });
            expect(r.sends).toEqual(['chop', 'cleanup']);
        });
    });

    test('one that will not close is closed twice, logged, and the run goes on', async () => {
        const states = timeline(20, t => ({ interfaceId: SMITHING_INTERFACE, xp: t >= 10 ? 25 : 0 }));
        let stepStart = -1;
        const timed = step('chop', ctx => {
            stepStart = ctx.state().tick;
            return chop();
        });
        const r = await runTask([timed], states);
        const what = `interface ${SMITHING_INTERFACE}`;
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([closeLeftover(what), `${closeLeftover(what)} (second attempt)`, 'chop', 'cleanup']);
        expect(r.events).toContainEqual({
            type: 'log',
            msg: `${what} left open before the run did not close: ${what} still open after two closes`,
            data: undefined,
        });
        // Bounded: the first close's wait and the second's one tick, then the step runs.
        expect(stepStart).toBe(LEFTOVER_CLOSE_TICKS + 1);
        expect(r.result.reason).toBe('chop: xp at tick 10');
    });

    test('death during the close ends the run, as the critical guards act on it', async () => {
        // The interface never closes, so the close is still waiting when the death message arrives.
        const states = timeline(20, t => ({ interfaceId: SMITHING_INTERFACE, dead: t === 2 }));
        const r = await runTask([step('chop', chop)], states);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:death: died');
        expect(r.sends).toEqual([closeLeftover(`interface ${SMITHING_INTERFACE}`)]);
        expect(r.result.stepRuns).toEqual({ [LEFTOVER_STEP]: 1, 'interrupt:death': 1 });
    });

    test('low HP waits for the close: its eat would be refused under the modal', async () => {
        const states = timeline(20, t => ({ interfaceId: SMITHING_INTERFACE, hp: t < 4 ? 4 : 10, food: 2 }));
        const r = await runTask([step('chop', chop)], states, { react: closes });
        expect(r.sends.slice(0, 2)).toEqual([closeLeftover(`interface ${SMITHING_INTERFACE}`), 'Eat Shrimps']);
    });

    test('a trade screen open at the start is left alone', async () => {
        const TRADE = 3323;
        const states = timeline(20, t => ({ interfaceId: TRADE, xp: t >= 8 ? 25 : 0 }));
        const r = await runTask([step('chop', chop)], states, { react: closes });
        expect(r.sends).toEqual(['chop', 'cleanup']);
        expect(r.result.stepRuns[LEFTOVER_STEP]).toBeUndefined();
    });
});

describe('onTick during a generator step', () => {
    test('an xp stop ends the run mid-wait as done', async () => {
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ xp: t >= 5 ? 20 : 0 })),
            {
                stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 10 }],
            },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +10 Woodcutting xp');
        expect(r.sends).toEqual(['start', 'cleanup']);
        expect(r.result.durationMs).toBe(5 * TICK_MS);
    });

    test('a minutes stop ends the run mid-wait as done', async () => {
        // 0.01 min = 600 ms: past it on the second tick.
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stops: [{ kind: 'minutes', minutes: 0.01 }],
            },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.01 min');
        expect(r.result.durationMs).toBe(2 * TICK_MS);
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('the watchdog ends a run that changes nothing as stuck', async () => {
        const r = await runTask([step('idle', idle)], timeline(3), { stuckAfterMs: 5 * TICK_MS });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('no XP, position, HP or inventory change for 2s (last step: idle)');
        expect(r.result.durationMs).toBe(6 * TICK_MS);
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('the step timeout cancels the step as a tick budget and runs its finally', async () => {
        // Moving every tick, so only the step budget can end it.
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stepTimeoutMs: 5 * TICK_MS,
            },
        );
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('step "idle" ran over 5 ticks (2s)');
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('ctx.stepTicksLeft is the step budget less the ticks spent, and waiting all of it is within budget', async () => {
        const seen: (number | undefined)[] = [];
        // Moving every tick, so only the step budget can end it.
        const r = await runTask(
            [spendLeft(0, seen)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stepTimeoutMs: 10 * TICK_MS,
            },
        );
        expect(seen).toEqual([10, 7]);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('spend: waited at tick 10');
    });

    test('one tick past ctx.stepTicksLeft is where the engine ends the step', async () => {
        const seen: (number | undefined)[] = [];
        const r = await runTask(
            [spendLeft(1, seen)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stepTimeoutMs: 10 * TICK_MS,
            },
        );
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('step "spend" ran over 10 ticks (4s)');
        expect(r.result.durationMs).toBe(11 * TICK_MS);
    });

    test('ctx.stepTicksLeft is undefined outside a generator step, and each step run starts a full budget', async () => {
        const seen: (number | undefined)[] = [];
        let runs = 0;
        const decide: Step = {
            name: 'decide',
            when: () => runs === 1,
            run: ctx => {
                seen.push(ctx.stepTicksLeft());
                runs++;
            },
        };
        const again: Step = {
            name: 'again',
            when: () => runs !== 1,
            *run(ctx) {
                seen.push(ctx.stepTicksLeft());
                yield* ticks(4);
                if (++runs === 3) return { done: 'twice' };
            },
        };
        const r = await runTask(
            [decide, again],
            timeline(30, t => ({ z: 3200 + t })),
            {
                stepTimeoutMs: 10 * TICK_MS,
            },
        );
        expect(r.result.reason).toBe('again: twice');
        expect(seen).toEqual([10, undefined, 10]);
    });

    test('a step that sends forever without waiting fails at the command cap, running its finally', async () => {
        const r = await runTask([step('spam', spam)], timeline(3));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain(`yielded over ${MAX_STEP_COMMANDS} commands`);
        expect(r.sends.length).toBe(MAX_STEP_COMMANDS + 1);
        expect(r.sends.at(-1)).toBe('cleanup');
    });

    test('the command cap counts per tick, so a step that waits may send more in total', async () => {
        const rounds = MAX_STEP_COMMANDS / 10 + 20;
        function* chatty(): Op<Outcome> {
            for (let round = 0; round < rounds; round++) {
                for (let i = 0; i < 10; i++) yield* send(act('ping'));
                yield* wait('a tick', () => false, 1);
            }
            return { done: 'all sent' };
        }
        const r = await runTask(
            [step('chatty', chatty)],
            timeline(rounds + 1, t => ({ z: 3200 + t })),
        );
        expect(r.result.status).toBe('done');
        expect(r.sends.length).toBe(rounds * 10);
        expect(r.sends.length).toBeGreaterThan(MAX_STEP_COMMANDS);
    });

    test('a step that throws ends the run as an error with an exception event', async () => {
        const r = await runTask([step('boom', boom)], timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('boom threw: boom');
        expect(r.events).toContainEqual(expect.objectContaining({ type: 'exception', message: 'boom' }));
    });

    test('a client that stops publishing ticks ends the run stuck', async () => {
        class Stalls extends TimelineDriver {
            override nextTick() {
                return this.ticksElapsed >= 3
                    ? Promise.reject(new TickStall('client stopped publishing ticks for 30s'))
                    : super.nextTick();
            }
        }
        const r = await runTask([step('chop', chop)], [], { driver: new Stalls(timeline(10)) });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('client stopped publishing ticks for 30s');
        expect(r.sends).toEqual(['chop', 'cleanup']);
    });
});

const externalStops = (events: Record<string, unknown>[]) => events.filter(e => e.type === 'external-stop');

describe('an external stop', () => {
    test('firing mid-wait cancels the step, runs its finally, and ends the run done with its reason', async () => {
        // Moving every tick, so only the external stop can end it.
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                externalStop: s => (s.tick >= 5 ? 'phase until met' : null),
            },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('phase until met');
        expect(r.sends).toEqual(['start', 'cleanup']);
        expect(r.result.durationMs).toBe(5 * TICK_MS);
        expect(externalStops(r.events)).toEqual([
            { type: 'external-stop', reason: 'phase until met', tick: 5, check: expect.any(Number) },
        ]);
    });

    test('firing between steps ends the run before the next step', async () => {
        let runs = 0;
        const decide = step('decide', () => {
            runs++;
        });
        const r = await runTask([decide], timeline(10), { externalStop: () => (runs >= 3 ? 'plan stop' : null) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('plan stop');
        expect(r.result.stepRuns).toEqual({ decide: 3 });
        expect(externalStops(r.events)).toHaveLength(1);
    });

    test('one that throws mid-wait ends the run as an error, after the step cleans up', async () => {
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ z: 3200 + t })),
            {
                externalStop: s => {
                    if (s.tick >= 5) throw new Error('plan predicate broke');
                    return null;
                },
            },
        );
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('threw: plan predicate broke');
        expect(r.sends).toEqual(['start', 'cleanup']);
    });

    test('one that throws between steps ends the run as an error before the next step', async () => {
        let runs = 0;
        const decide = step('decide', () => {
            runs++;
        });
        const r = await runTask([decide], timeline(10), {
            externalStop: () => {
                if (runs >= 2) throw new Error('plan predicate broke');
                return null;
            },
        });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('threw: plan predicate broke');
        expect(r.result.stepRuns).toEqual({ decide: 2 });
    });

    test('one that already holds at the start ends the run done after preflight, with no step run', async () => {
        const order: string[] = [];
        const def = defineTask({
            name: 'test',
            description: 'engine test',
            params: z.object({}),
            preflight: () => {
                order.push('preflight');
                return null;
            },
            steps: [step('idle', idle)],
        });
        const r = await runDef(def, timeline(5), {
            externalStop: () => {
                order.push('externalStop');
                return 'already there';
            },
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('already there');
        expect(r.result.stepRuns).toEqual({});
        expect(r.sends).toEqual([]);
        expect(order).toEqual(['preflight', 'externalStop']);
    });

    test("the task's own stops are checked first", async () => {
        const r = await runTask(
            [step('idle', idle)],
            timeline(30, t => ({ xp: t >= 5 ? 20 : 0 })),
            {
                stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 10 }],
                externalStop: s => (s.tick >= 5 ? 'phase until met' : null),
            },
        );
        expect(r.result.reason).toBe('reached +10 Woodcutting xp');
        expect(externalStops(r.events)).toEqual([]);
    });
});

describe('partOf', () => {
    test("is in the result only when given: the plan's runId", async () => {
        const decide = step('decide', () => ({ done: 'decided' }));
        const phase = await runTask([decide], timeline(5), { partOf: 'plan-run-7' });
        expect(phase.result.partOf).toBe('plan-run-7');
        const alone = await runTask([decide], timeline(5));
        expect('partOf' in alone.result).toBe(false);
    });
});

describe('decision-only steps', () => {
    test('a plain run that returns an outcome ends the run, counted and logged like any step', async () => {
        const r = await runTask([step('decide', () => ({ done: 'decided' }))], timeline(5));
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('decide: decided');
        expect(r.result.stepRuns).toEqual({ decide: 1 });
        expect(r.result.lastStep).toBe('decide');
        expect(r.events).toContainEqual(expect.objectContaining({ type: 'step', step: 'decide' }));
        expect(r.driver.commands).toEqual([]);
    });

    test('a plain run that returns nothing lets the loop go on to the next pass', async () => {
        let runs = 0;
        const decide = step('decide', ctx => {
            if (++runs === 3) return { fail: `third run at tick ${ctx.state().tick}` };
        });
        const r = await runTask([decide], timeline(10));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^decide: third run at tick \d+$/);
        expect(r.result.stepRuns).toEqual({ decide: 3 });
    });

    test('a guard still acts before it', async () => {
        const r = await runTask(
            [step('decide', () => ({ done: 'decided' }))],
            timeline(10, t => ({ dialog: t === 0 })),
        );
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns).toEqual({ 'interrupt:dialog': 1, decide: 1 });
    });

    test('a run that returns a promise (an async run, past the types) ends the run as an error', async () => {
        let settled = false;
        const asyncRun = async () => {
            await Promise.resolve();
            settled = true;
            throw new Error('late boom');
        };
        // The cast stands in for a task written in plain JS or cast past the Step type.
        const r = await runTask([step('async', asyncRun as unknown as Step['run'])], timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('step "async" returned a promise: async steps are not supported');
        expect(r.result.stepRuns).toEqual({ async: 1 });
        await Promise.resolve();
        expect(settled).toBe(true);
    });

    test('a preflight that returns a promise ends the run as an error, not "preflight: [object Promise]"', async () => {
        const def = defineTask({
            name: 'test',
            description: 'engine test',
            params: z.object({}),
            preflight: lateReject as unknown as () => string | null,
            steps: [step('idle', idle)],
        });
        const r = await runDef(def, timeline(5));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('preflight returned a promise: async preflights are not supported');
        expect(r.sends).toEqual([]);
    });

    test('a task guard that returns a promise between steps ends the run as an error', async () => {
        const r = await runTask([step('decide', () => undefined)], timeline(5), { guards: [asyncGuard(0)] });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('guard "interrupt:async" returned a promise: async guards are not supported');
        expect(r.result.stepRuns).toEqual({ 'interrupt:async': 1 });
    });

    test('a task guard that returns a promise mid-wait ends the run as an error, after the step cleans up', async () => {
        const r = await runTask([step('idle', idle)], timeline(10), { guards: [asyncGuard(3)] });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('guard "interrupt:async" returned a promise: async guards are not supported');
        expect(r.sends).toEqual(['start', 'cleanup']);
    });
});

describe('as the run ends', () => {
    test('below the low-HP line with food at hand, the bot eats once before the result', async () => {
        // HP drops on the tick the stop is reached, so the stop ends the run before the low-HP guard acts.
        const states = timeline(20, t => ({ hp: t >= 3 ? 4 : 10, xp: t >= 3 ? 20 : 0, food: 2 }));
        const r = await runTask([step('idle', idle)], states, {
            stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 10 }],
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +10 Woodcutting xp');
        expect(r.sends).toEqual(['start', 'cleanup', 'Eat Shrimps']);
        expect(r.result.inventoryDelta).toEqual({ Shrimps: -1 });
        expect(r.result.stepRuns).toEqual({ idle: 1 });
    });

    test('a dialog that would swallow the eat is dismissed first', async () => {
        const states = timeline(20, t => ({ hp: t >= 3 ? 4 : 10, xp: t >= 3 ? 20 : 0, food: 2, dialog: t === 3 }));
        const r = await runTask([step('idle', idle)], states, {
            stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 10 }],
        });
        expect(r.sends).toEqual(['start', 'cleanup', 'continue dialog', 'Eat Shrimps']);
    });

    test('above the line, or with nothing to eat, it sends nothing', async () => {
        const stops = [{ kind: 'xp' as const, skill: 'Woodcutting', amount: 10 }];
        const healthy = await runTask(
            [step('idle', idle)],
            timeline(20, t => ({ xp: t >= 3 ? 20 : 0, food: 2 })),
            {
                stops,
            },
        );
        expect(healthy.sends).toEqual(['start', 'cleanup']);
        const noFood = await runTask(
            [step('idle', idle)],
            timeline(20, t => ({ hp: t >= 3 ? 4 : 10, xp: t >= 3 ? 20 : 0, food: 0 })),
            { stops },
        );
        expect(noFood.sends).toEqual(['start', 'cleanup']);
    });

    test('under an open bank or shop it does not try: the game would refuse the eat there', async () => {
        const stops = [{ kind: 'xp' as const, skill: 'Woodcutting', amount: 10 }];
        for (const open of [(w: World) => w.bank([]), (w: World) => w.shop([])]) {
            // The modal opens on the tick the stop is reached, with HP low and food at hand.
            const states = timeline(20, t => ({ hp: t >= 3 ? 4 : 10, xp: t >= 3 ? 20 : 0, food: 2 })).map(s =>
                s.tick >= 3 ? open(world(s)).build() : s,
            );
            const r = await runTask([step('idle', idle)], states, { stops });
            expect(r.result.status).toBe('done');
            expect(r.sends).toEqual(['start', 'cleanup']);
        }
    });

    test('a client that stops ticking does not hold up the result', async () => {
        class Stalls extends TimelineDriver {
            override nextTick() {
                return this.ticksElapsed >= 3
                    ? Promise.reject(new TickStall('client stopped publishing ticks for 30s'))
                    : super.nextTick();
            }
        }
        const states = timeline(10, t => ({ hp: t >= 3 ? 4 : 10, food: 2 }));
        const r = await runTask([step('chop', chop)], [], { driver: new Stalls(states), allow: ['low-hp'] });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('client stopped publishing ticks for 30s');
        expect(r.sends).toEqual(['chop', 'cleanup', 'Eat Shrimps']);
        expect(r.result.hp).toEqual({ current: 4, max: 10 });
    });
});

describe('the result', () => {
    test('TaskResult fields are populated, with a screenshot on a non-done finish', async () => {
        const states = timeline(10, t => (t < 3 ? { food: 2 } : { food: 1, xp: 100, level: 2 }));
        const r = await runTask([step('chop', chopOnce)], states);
        expect(r.result).toEqual({
            task: 'test',
            bot: 'tester',
            runId: 'run-1',
            status: 'failed',
            reason: 'chop: out of trees',
            endedBy: 'chop',
            params: {},
            durationMs: 3 * TICK_MS,
            loops: 1,
            stepRuns: { chop: 1 },
            lastStep: 'chop',
            xpGained: { Woodcutting: 100 },
            levelsGained: { Woodcutting: { from: 1, to: 2 } },
            inventoryDelta: { Shrimps: -1 },
            finalPos: { x: 3222, z: 3218, level: 0 },
            hp: { current: 10, max: 10 },
            inCombat: false,
            screenshots: ['/shots/test-failed.png'],
            logFile: '/logs/run-1.ndjson',
        });
        expect(r.events.map(e => e.type)).toEqual(['start', 'step', 'screenshot', 'result']);
        expect(r.events.at(-1)).toEqual({ type: 'result', ...r.result });
        expect(r.printed.at(-1)).toBe('[task:test] failed: chop: out of trees');
    });
});

/** Attacks, then waits on the fight: no finally, so every send after the stop is the engine's. */
function* attackAndWait(): Op<Outcome> {
    yield* send(act('attack'));
    yield* wait('never', () => false, 1000);
    return { done: 'unreachable' };
}

/** Ticks 0..n-1 with `spec`, attacked (a goblin beside the bot) from tick 3 until `until`. */
const fighting = (n: number, until: number, spec: (t: number) => StateSpec = () => ({})) =>
    timeline(n, spec).map((s, i) => attackedFrom(world(s), i, until).build());

/** Attacks, then fails at tick 6. */
function* giveUp(): Op<Outcome> {
    yield* send(act('attack'));
    yield* wait('tick 6', s => s.tick >= 6, 1000);
    return { fail: 'gave up' };
}

describe('a stop in a fight', () => {
    // 0.05 min = 3000 ms: past it at tick 8, mid-fight.
    const stops = [{ kind: 'minutes' as const, minutes: 0.05 }];

    test('a minutes stop while attacked ends done at the first tick not attacked, sending nothing more', async () => {
        const r = await runTask([step('fight', attackAndWait)], fighting(30, 20), { stops });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.05 min; fight settled in 12 ticks');
        expect(r.result.durationMs).toBe(20 * TICK_MS);
        expect(r.result.inCombat).toBe(false);
        expect(r.sends).toEqual(['attack']);
    });

    test(`a fight longer than ${SETTLE_TICKS} ticks ends at the cap, still done`, async () => {
        const r = await runTask([step('fight', attackAndWait)], fighting(10, Infinity), { stops });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(`reached 0.05 min; still in combat after ${SETTLE_TICKS} ticks`);
        expect(r.result.durationMs).toBe((8 + SETTLE_TICKS) * TICK_MS);
        expect(r.result.inCombat).toBe(true);
        expect(r.sends).toEqual(['attack']);
    });

    test('low HP during the settle eats, and the settle goes on', async () => {
        const states = fighting(30, 20, t => ({ hp: t === 10 || t === 11 ? 4 : 10, food: 2 }));
        const r = await runTask([step('fight', attackAndWait)], states, { stops });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.05 min; fight settled in 12 ticks');
        // HP is scripted low for two ticks, so the guard eats on each.
        expect(r.sends).toEqual(['attack', 'Eat Shrimps', 'Eat Shrimps']);
    });

    test('low HP during the settle with no food under fire ends failed with the low-HP reason', async () => {
        const states = fighting(30, 20, t => ({ hp: t >= 10 ? 4 : 10 }));
        const r = await runTask([step('fight', attackAndWait)], states, { stops });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('reached 0.05 min; interrupt:low-hp: hp 4/10 at');
        expect(r.result.reason).toEndWith('no food');
        expect(r.result.endedBy).toBe('interrupt:low-hp');
        expect(r.result.durationMs).toBe(10 * TICK_MS);
        expect(r.sends).toEqual(['attack']);
    });

    test('death during the settle ends failed with the death reason, and the dead bot does not eat', async () => {
        const states = fighting(30, 20, t => ({ hp: t >= 10 ? 0 : 10, dead: t === 10, food: 2 }));
        const r = await runTask([step('fight', attackAndWait)], states, { stops });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('reached 0.05 min; interrupt:death: died');
        expect(r.result.endedBy).toBe('interrupt:death');
        expect(r.result.durationMs).toBe(10 * TICK_MS);
        expect(r.sends).toEqual(['attack']);
    });

    test('a stop with no attacker (stale inCombat, last hit long ago) ends on its tick', async () => {
        const stale = timeline(30, () => ({ inCombat: true, lastDamageTick: 0 })).map(s => ({
            ...s,
            tick: s.tick + 17,
        }));
        const r = await runTask([step('fight', attackAndWait)], stale, { stops });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.05 min');
        expect(r.result.durationMs).toBe(8 * TICK_MS);
    });

    test('an external stop mid-fight is settled the same way, and fires once', async () => {
        const r = await runTask([step('fight', attackAndWait)], fighting(30, 20), {
            externalStop: s => (s.tick >= 6 ? 'plan stop' : null),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('plan stop; fight settled in 14 ticks');
        expect(r.sends).toEqual(['attack']);
        expect(externalStops(r.events)).toHaveLength(1);
    });

    test('a stop while the bot fights a target that does not hit back is settled until the target is gone', async () => {
        // The bot targets goblin 5 from tick 3; the goblin never faces it, and dies (leaves view) at tick 20.
        const states = timeline(30, () => ({})).map((s, i) =>
            i >= 3 && i < 20
                ? world(s)
                      .fighting(5)
                      .npcBeside('Goblin', { index: 5, options: ['Attack'] })
                      .build()
                : s,
        );
        const r = await runTask([step('fight', attackAndWait)], states, { stops });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached 0.05 min; fight settled in 12 ticks');
        expect(r.result.durationMs).toBe(20 * TICK_MS);
        expect(r.sends).toEqual(['attack']);
    });

    test('a stop while the bot faces an NPC it cannot attack (a fishing spot) ends on its tick', async () => {
        const states = timeline(30, () => ({})).map(s =>
            world(s)
                .fighting(5)
                .npcBeside('Fishing spot', { index: 5, options: ['Net', 'Bait'] })
                .build(),
        );
        const r = await runTask([step('fight', attackAndWait)], states, { stops });
        expect(r.result.reason).toBe('reached 0.05 min');
        expect(r.result.durationMs).toBe(8 * TICK_MS);
    });

    test('a client that stops ticking during the settle ends the run stuck', async () => {
        class Stalls extends TimelineDriver {
            override nextTick() {
                return this.ticksElapsed >= 12
                    ? Promise.reject(new TickStall('client stopped publishing ticks for 30s'))
                    : super.nextTick();
            }
        }
        const r = await runTask([step('fight', attackAndWait)], [], { driver: new Stalls(fighting(30, 20)), stops });
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toBe('reached 0.05 min; client stopped publishing ticks for 30s');
    });

    test('a failed run mid-fight is not settled', async () => {
        const r = await runTask([step('fight', giveUp)], fighting(30, 20));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('fight: gave up');
        expect(r.result.durationMs).toBe(6 * TICK_MS);
        expect(r.result.inCombat).toBe(true);
    });
});
