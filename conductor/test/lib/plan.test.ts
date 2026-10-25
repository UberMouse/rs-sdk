import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { send, wait } from '../../core/op';
import {
    definePlan,
    isPlan,
    type Phase,
    phase,
    type PlanView,
    recordReads,
    type PhaseRun,
    type PlanDef,
    planParams,
    PLAN_SETTLE_TICKS,
    type PlanResult,
    type Predicate,
} from '../../lib/plan';
import { QUEST_TAB_REQUIRED } from '../../lib/quests';
import { SETTLE_TICKS } from '../../lib/engine';
import { defineTask, type Outcome } from '../../lib/task';
import { countItems, TICK_MS } from '../../lib/util';
import chopBurnPlan from '../../plans/chop-burn';
import woodcutting from '../../tasks/woodcutting';
import { act } from '../core/fixtures';
import { type PlanSimulation, simulatePlan, type SimulatePlanOptions } from '../simulate';
import { LUMBRIDGE, world } from '../world';

const LOGS = /^Logs$/;
const logs = (s: BotWorldState) => countItems(s, LOGS);

/** 24 slots of Bones leave 4 free, so a producer fills the inventory in 4 sends. */
const BASE = world().skill('Woodcutting', 1, 0).skill('Firemaking', 1, 0).inv('Bones', 24);

const gainXp = (s: BotWorldState, skill: string, xp: number): BotWorldState => ({
    ...s,
    skills: s.skills.map(k => (k.name === skill ? { ...k, experience: k.experience + xp } : k)),
});

/** The test world's answer to the fake tasks' sends: a chop adds a log, a burn takes one, each with XP. */
function plant(action: BotAction): Effect | undefined {
    switch (action.reason) {
        case 'chop':
            return s =>
                gainXp(
                    world(s)
                        .inv('Logs', logs(s) + 1)
                        .build(),
                    'Woodcutting',
                    25,
                );
        case 'burn':
            return s =>
                gainXp(
                    world(s)
                        .inv('Logs', logs(s) - 1)
                        .build(),
                    'Firemaking',
                    40,
                );
        case 'train':
            return s => gainXp(s, 'Woodcutting', 10);
        case 'move east':
        case 'move west':
            return s =>
                world(s)
                    .player({ at: { x: SPOTS[action.reason === 'move east' ? 'east' : 'west'], z: LUMBRIDGE.z } })
                    .build();
        case 'rest':
            return s =>
                world(s)
                    .player({ hp: (s.player?.hp ?? 0) - 1 })
                    .build();
    }
    return undefined;
}

/** Where `move` goes: west is where the bot starts. */
const SPOTS = { east: LUMBRIDGE.x + 8, west: LUMBRIDGE.x };

/** Walks to a spot, gaining nothing. */
const move = defineTask({
    name: 'move',
    description: 'plan test walk',
    params: z.object({ to: z.enum(['east', 'west']) }),
    steps: [
        {
            name: 'move',
            when: () => true,
            *run(ctx) {
                const x = SPOTS[ctx.params.to];
                if (ctx.state().player?.worldX === x) return { done: 'there' };
                yield* send(act(`move ${ctx.params.to}`));
                yield* wait('arrived', s => s.player?.worldX === x, 5);
                return { done: 'arrived' };
            },
        },
    ],
});

/** Loses a hit point and ends: an HP change and nothing else. */
const rest = defineTask({
    name: 'rest',
    description: 'plan test hp only',
    params: z.object({}),
    steps: [
        {
            name: 'rest',
            when: () => true,
            *run(ctx) {
                const hp = ctx.state().player?.hp;
                yield* send(act('rest'));
                yield* wait('hp', s => s.player?.hp !== hp, 5);
                return { done: 'rested' };
            },
        },
    ],
});

/** A producer: a log a send until the inventory is full. */
const chop = defineTask({
    name: 'chop',
    description: 'plan test producer',
    params: z.object({ tree: z.enum(['tree', 'oak']).default('tree') }),
    steps: [
        { name: 'full', when: ctx => ctx.inventoryFull(), run: () => ({ done: 'inventory full' }) },
        {
            name: 'chop',
            when: () => true,
            *run(ctx) {
                const n = logs(ctx.state());
                yield* send(act('chop'));
                const w = yield* wait('a log', s => logs(s) > n, 5);
                if (w.kind === 'timeout') return { fail: 'no log' };
            },
        },
    ],
});

/** A consumer: a log a send until none are left. */
const burn = defineTask({
    name: 'burn',
    description: 'plan test consumer',
    params: z.object({}),
    steps: [
        { name: 'out', when: ctx => logs(ctx.state()) === 0, run: () => ({ done: 'no logs left' }) },
        {
            name: 'burn',
            when: () => true,
            *run(ctx) {
                const n = logs(ctx.state());
                yield* send(act('burn'));
                const w = yield* wait('a fire', s => logs(s) < n, 5);
                if (w.kind === 'timeout') return { fail: 'no fire' };
            },
        },
    ],
});

/** Gains 10 Woodcutting XP and ends. */
const train = defineTask({
    name: 'train',
    description: 'plan test progress',
    params: z.object({}),
    steps: [
        {
            name: 'train',
            when: () => true,
            *run(ctx) {
                const xp = ctx.state().skills[0]!.experience;
                yield* send(act('train'));
                yield* wait('xp', s => s.skills[0]!.experience > xp, 5);
                return { done: 'trained' };
            },
        },
    ],
});

/** Waits for nothing: only an external stop (or the watchdog) ends it. */
const watch = defineTask({
    name: 'watch',
    description: 'plan test open-ended',
    params: z.object({}),
    steps: [
        {
            name: 'watch',
            when: () => true,
            *run() {
                yield* send(act('watch'));
                yield* wait('never', () => false, 1000);
            },
        },
    ],
});

/** A task named `name` whose runs end with `outcomes` in turn, the last repeating; it changes nothing. */
function scripted(name: string, outcomes: Outcome[]) {
    let run = 0;
    return defineTask({
        name,
        description: 'plan test scripted outcome',
        params: z.object({}),
        steps: [{ name: 'try', when: () => true, run: () => outcomes[Math.min(run++, outcomes.length - 1)] }],
    });
}

const failing = (name: string) => scripted(name, [{ fail: 'cannot' }]);

const plan = (phases: Phase[], until?: Predicate): PlanDef => definePlan({ name: 'test-plan', phases, until });

const sim = (def: PlanDef, opts: Partial<SimulatePlanOptions> = {}) =>
    simulatePlan(def, { timeline: [BASE.build()], react: plant, ...opts });

const NO_PROGRESS = 'phases make no progress (no XP, and each ended where it started or in a state seen since)';

/** The phases selection chose, in order (null for "none applies"). */
const selected = (r: PlanSimulation) => r.events.filter(e => e.type === 'select').map(e => e.phase);

/** The tick the first phase run's external stop fired at. */
const stoppedAt = (r: PlanSimulation) => r.runs[0]!.events.find(e => e.type === 'external-stop')?.tick;
/** The tick the first phase run ended at: its duration, as the scripted runs start at tick 0. */
const settledAt = (r: PlanSimulation) => r.runs[0]!.result.durationMs / TICK_MS;

/** Burns a full inventory of logs, else chops: the consumer above the producer. */
const chopBurn = (until?: Predicate) =>
    plan([phase(burn, {}, { when: v => v.full && v.inv('Logs') > 0 }), phase(chop, {})], until);

/** A phase that always fails, under 'continue', above one that always trains. */
const failsUntil = (maxFails?: number) =>
    sim(plan([phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: 'continue', maxFails }), phase(train, {})]));

/** Burns any logs held, else chops. */
const burnAny = (until: Predicate) => plan([phase(burn, {}, { when: v => v.inv('logs') > 0 }), phase(chop, {})], until);

/** A one-phase plan of `train` with `requires`. */
const needs = (requires: Record<string, Predicate>, until?: Predicate) =>
    definePlan({ name: 'test-plan', phases: [phase(train, {})], requires, until });

/** simulatePlan options that call `onTick` with the plan's kill function after each tick of phase run `runId`. */
const killable = (runId: string, onTick: (kill: (reason: string) => PlanResult) => void) => {
    let kill: ((reason: string) => PlanResult) | null = null;
    return {
        onKillable: (k: (reason: string) => PlanResult) => {
            kill = k;
        },
        phaseRun: (run: PhaseRun): PhaseRun => {
            if (run.runId !== runId) return run;
            const d = run.driver;
            return {
                ...run,
                driver: {
                    state: () => d.state(),
                    nextTick: async () => {
                        const s = await d.nextTick();
                        onTick(kill!);
                        return s;
                    },
                    send: a => d.send(a),
                    scan: r => d.scan(r),
                    log: (m, x) => d.log(m, x),
                    screenshot: l => d.screenshot(l),
                    now: () => d.now(),
                },
            };
        },
    };
};

describe('phase and definePlan', () => {
    test('phase names itself after its task, and leaves maxFails to the runner unless told', () => {
        const p = phase(chop, {});
        expect(p.name).toBe('chop');
        expect(p.maxFails).toBeUndefined();
        const named = phase(chop, { tree: 'oak' }, { name: 'oaks', maxFails: 1, onFail: 'continue' });
        expect(named).toMatchObject({ name: 'oaks', maxFails: 1, onFail: 'continue', params: { tree: 'oak' } });
    });

    test("phase type-checks params against the task's schema", () => {
        const ok = phase(woodcutting, { tree: 'oak', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } });
        // @ts-expect-error: woodcutting has no maple tree
        const bad = phase(woodcutting, { tree: 'maple' });
        expect(ok.task).toBe(woodcutting);
        expect(bad.params).toEqual({ tree: 'maple' });
    });

    test('definePlan refuses no phases, a bad name and a phase name used twice', () => {
        expect(() => definePlan({ name: 'empty', phases: [] })).toThrow('has no phases');
        expect(() => definePlan({ name: 'Chop Burn', phases: [phase(chop, {})] })).toThrow('must match');
        expect(() => definePlan({ name: 'twice', phases: [phase(chop, {}), phase(chop, { tree: 'oak' })] })).toThrow(
            'used twice: chop',
        );
        expect(() =>
            definePlan({ name: 'twice', phases: [phase(chop, {}), phase(chop, { tree: 'oak' }, { name: 'oaks' })] }),
        ).not.toThrow();
    });

    test('isPlan recognises only what definePlan returned', () => {
        const def = { name: 'p', phases: [phase(chop, {})] };
        expect(isPlan(definePlan(def))).toBe(true);
        expect(isPlan(def)).toBe(false);
        expect(isPlan(null)).toBe(false);
    });
});

describe('selection', () => {
    test('the first phase whose when holds runs; a phase without a when always applies', async () => {
        const holding = await sim(
            burnAny(v => v.runs('chop') > 0),
            { timeline: [BASE.inv('Logs', 2).build()] },
        );
        expect(selected(holding)).toEqual(['burn', 'chop']);
        const empty = await sim(burnAny(v => v.runs('burn') > 0));
        expect(selected(empty)).toEqual(['chop', 'burn']);
    });

    test('a phase whose until already holds is passed over', async () => {
        const r = await sim(
            plan([phase(chop, {}, { until: v => v.inv('Bones') >= 24 }), phase(train, {})], v => v.runs('train') > 0),
        );
        expect(selected(r)).toEqual(['train']);
        expect(r.result.status).toBe('done');
    });

    test('v.quest reads the quest tab; the plan ends when v.questDone holds', async () => {
        const seen: string[] = [];
        const def = plan(
            [
                phase(
                    train,
                    {},
                    {
                        when: v => {
                            seen.push(v.quest('imp'));
                            return true;
                        },
                    },
                ),
            ],
            v => v.questDone('imp'),
        );
        const r = await sim(def, {
            timeline: [
                BASE.quests({}).build(),
                BASE.quests({ imp: 'started' }).build(),
                BASE.quests({ imp: 'done' }).build(),
            ],
        });
        expect(r.result.status).toBe('done');
        expect(seen[0]).toBe('none');
    });

    test('a quest already done passes the plan before any phase', async () => {
        const r = await sim(
            plan([phase(train, {})], v => v.questDone('runemysteries')),
            { timeline: [BASE.quests({ runemysteries: 'done' }).build()] },
        );
        expect(r.result.status).toBe('done');
        expect(r.runs).toEqual([]);
    });

    test('a state with no quest tab reads none', async () => {
        const seen: string[] = [];
        const r = await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push(v.quest('imp'));
                                return true;
                            },
                        },
                    ),
                ],
                v => v.runs('train') > 0 && !v.questDone('imp'),
            ),
        );
        expect(r.result.status).toBe('done');
        expect(seen[0]).toBe('none');
    });

    test('QUEST_TAB_REQUIRED fails a plan on a state with no quest tab, but a done quest ends it first', async () => {
        const def = needs({ ...QUEST_TAB_REQUIRED }, v => v.questDone('imp'));
        const blind = await sim(def);
        expect(blind.result).toMatchObject({ status: 'failed', reason: 'plan requires quest tab (state.questTab)' });
        expect(blind.runs).toEqual([]);
        const done = await sim(def, { timeline: [BASE.quests({ imp: 'done' }).build()] });
        expect(done.result.status).toBe('done');
    });

    test('no applicable phase fails the plan, logging what the selection saw', async () => {
        const r = await sim(plan([phase(burn, {}, { when: v => v.inv('Logs') > 0 })]));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('no phase applies');
        expect(r.runs).toEqual([]);
        expect(r.events.find(e => e.type === 'select')).toEqual({
            type: 'select',
            phase: null,
            checks: { burn: 'when false' },
            reads: { burn: { "inv('Logs')": 0 } },
            last: null,
            inventory: { Bones: 24 },
            free: 4,
            bank: null,
        });
    });

    test('no applicable phase after a skipped failure names the last run, and the log what each phase answered', async () => {
        const r = await sim(
            plan([
                phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: 'continue' }),
                phase(burn, {}, { when: v => v.inv('Logs') > 0 }),
            ]),
        );
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'no phase applies (last: primary failed: try: busy)',
        });
        const selects = r.events.filter(e => e.type === 'select');
        expect(selects.map(e => e.checks)).toEqual([
            { primary: 'chosen' },
            { primary: 'skipped: failed last', burn: 'when false' },
        ]);
        expect(selects.map(e => e.last)).toEqual([null, { phase: 'primary', status: 'failed', reason: 'try: busy' }]);
    });
});

describe('requires', () => {
    test('a requirement that does not hold fails the plan naming it, before any phase', async () => {
        const r = await sim(needs({ 'woodcutting 5+': v => v.level('Woodcutting') >= 5 }));
        expect(r.result).toMatchObject({ status: 'failed', reason: 'plan requires woodcutting 5+' });
        expect(r.runs).toEqual([]);
        expect(r.events.map(e => e.type)).toEqual(['start', 'result']);
        expect(r.events[0]!.requires).toEqual(['woodcutting 5+']);
    });

    test('requirements are checked before every phase choice', async () => {
        const r = await sim(needs({ 'fewer than 2 trains': v => v.runs('train') < 2 }, v => v.runs('train') >= 3));
        expect(selected(r)).toEqual(['train', 'train']);
        expect(r.result).toMatchObject({ status: 'failed', reason: 'plan requires fewer than 2 trains' });
    });

    test('a requirement that throws ends the plan error, naming it', async () => {
        const r = await sim(needs({ 'mining 5+': v => v.level('Mining') >= 5 }));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toStartWith('plan requires "mining 5+" threw: unknown skill "Mining"');
    });

    test('chop-burn requires combat 5, against the Giant spiders on its walk', async () => {
        const low = await sim(chopBurnPlan);
        expect(low.result).toMatchObject({ status: 'failed', reason: 'plan requires combat level 5+' });
        expect(low.runs).toEqual([]);
        // Combat 12, as the plan smoke test's bot: past the gate, a phase runs (here refused: no axe).
        const able = await sim(chopBurnPlan, { timeline: [BASE.player({ combatLevel: 12 }).build()] });
        expect(able.runs.length).toBeGreaterThan(0);
        expect(able.result.reason).not.toContain('requires');
    });
});

describe('a producer and a consumer', () => {
    test('cycle chop -> burn twice, each phase run a part of the plan', async () => {
        const r = await sim(chopBurn(v => v.runs('burn') >= 2));
        expect(selected(r)).toEqual(['chop', 'burn', 'chop', 'burn']);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('plan until met');
        expect(r.runs.map(x => x.result.reason)).toEqual([
            'full: inventory full',
            'out: no logs left',
            'full: inventory full',
            'out: no logs left',
        ]);
        expect(r.runs.map(x => x.result.partOf)).toEqual(['plan-1', 'plan-1', 'plan-1', 'plan-1']);
        expect(r.result.xpGained).toEqual({ Woodcutting: 200, Firemaking: 320 });
    });
});

describe('until', () => {
    test("a phase's until ends that phase done, and the plan goes on", async () => {
        const r = await sim(
            plan(
                [
                    phase(burn, {}, { when: v => v.inv('Logs') >= 2 }),
                    phase(chop, {}, { until: v => v.inv('Logs') >= 2 }),
                ],
                v => v.runs('burn') > 0,
            ),
        );
        expect(selected(r)).toEqual(['chop', 'burn']);
        expect(r.runs[0]!.result).toMatchObject({ status: 'done', reason: 'until met', inventoryDelta: { Logs: 2 } });
        expect(r.result.reason).toBe('plan until met');
    });

    // Copper ore arrives at tick 5, in a fight from tick 3 to tick 8: the engine settles it.
    const fight = BASE.series(20, (w, i) => {
        const fighting = i >= 3 && i < 9 ? w.player({ inCombat: true, lastDamageTick: i }) : w;
        return i >= 5 ? fighting.inv('Copper ore', 1) : fighting;
    });
    test("a phase's until that holds in a fight waits for the fight to end", async () => {
        const r = await sim(
            plan([phase(watch, {}, { until: v => v.inv('Copper ore') > 0 })], v => v.runs('watch') > 0),
            {
                timeline: fight,
            },
        );
        expect(stoppedAt(r)).toBe(5);
        expect(settledAt(r)).toBe(9);
        expect(r.runs[0]!.result.reason).toBe('until met; fight settled in 4 ticks');
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met', inCombat: false });
    });

    test("the plan's until waits out a fight too", async () => {
        const r = await sim(
            plan([phase(watch, {})], v => v.inv('Copper ore') > 0),
            { timeline: fight },
        );
        expect(settledAt(r)).toBe(9);
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met', inCombat: false });
    });

    test("the plan's stops wait out a fight", async () => {
        // 0.02 min is 1200ms: tick 3, the fight's first.
        const r = await sim(plan([phase(watch, {})]), {
            timeline: fight,
            stops: [{ kind: 'minutes', minutes: 0.02 }],
        });
        expect(stoppedAt(r)).toBe(3);
        expect(settledAt(r)).toBe(9);
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 0.02 min', inCombat: false });
    });

    // The fight above, with HP low from tick 6 and no food.
    const losing = BASE.series(20, (w, i) =>
        i >= 3 && i < 9 ? w.player({ inCombat: true, lastDamageTick: i, hp: i >= 6 ? 2 : 10 }) : w,
    );
    for (const onFail of ['fail', 'continue'] as const)
        test(`a plan stop whose settle fails on low HP ends the plan failed (onFail: ${onFail})`, async () => {
            const r = await sim(plan([phase(watch, {}, { onFail })]), {
                timeline: losing,
                stops: [{ kind: 'minutes', minutes: 0.02 }],
            });
            expect(stoppedAt(r)).toBe(3);
            expect(r.runs).toHaveLength(1);
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toStartWith('watch: reached 0.02 min; interrupt:low-hp: hp 2/10');
            expect(r.result.reason).toEndWith('no food');
        });

    test(`a fight longer than ${SETTLE_TICKS} ticks ends the plan at the cap, still in combat`, async () => {
        const endless = BASE.series(SETTLE_TICKS + 20, (w, i) =>
            i >= 3 ? w.player({ inCombat: true, lastDamageTick: i }) : w,
        );
        const r = await sim(plan([phase(watch, {})]), {
            timeline: endless,
            stops: [{ kind: 'minutes', minutes: 0.02 }],
        });
        expect(stoppedAt(r)).toBe(3);
        expect(settledAt(r)).toBe(3 + SETTLE_TICKS);
        expect(r.runs[0]!.result.reason).toBe(`reached 0.02 min; still in combat after ${SETTLE_TICKS} ticks`);
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 0.02 min', inCombat: true });
    });
});

describe("the plan's until and stops", () => {
    test("the plan's until ends the running phase and the plan done", async () => {
        const r = await sim(chopBurn(v => v.inv('Logs') >= 2));
        expect(r.runs).toHaveLength(1);
        expect(r.runs[0]!.result.reason).toBe('plan until met');
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met', inventoryDelta: { Logs: 2 } });
    });

    test('an xp stop counts from the XP the plan started with, across phases', async () => {
        const r = await sim(chopBurn(), { stops: [{ kind: 'xp', skill: 'woodcutting', amount: 150 }] });
        expect(selected(r)).toEqual(['chop', 'burn', 'chop']);
        expect(r.runs[2]!.result.xpGained).toEqual({ Woodcutting: 50 });
        expect(r.result).toMatchObject({
            status: 'done',
            reason: 'reached +150 woodcutting xp',
            xpGained: { Woodcutting: 150, Firemaking: 160 },
        });
    });

    test("a minutes stop counts from the plan's start, across phases", async () => {
        const r = await sim(chopBurn(), { stops: [{ kind: 'minutes', minutes: 1 }] });
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 1 min', durationMs: 60_000 });
        expect(r.runs.length).toBeGreaterThan(4);
        expect(r.runs.at(-1)!.result.reason).toBe('reached 1 min');
        expect(r.runs.at(-1)!.result.durationMs).toBeLessThan(60_000);
        // Compact however many runs: one entry per phase, the last few runs.
        expect(r.result.phases).toHaveLength(2);
        expect(r.result.recent.map(x => x.runId)).toEqual(r.runs.slice(-3).map(x => x.runId));
    });

    test("an injected clock is the plan's and every phase run's", async () => {
        const driver = new TimelineDriver([BASE.build()], { react: plant });
        // 1000ms a tick where the default reads TICK_MS (400): 0.05 min is tick 3, not tick 8.
        const r = await sim(plan([phase(watch, {})]), {
            driver,
            now: () => driver.state().tick * 1000,
            stops: [{ kind: 'minutes', minutes: 0.05 }],
        });
        expect(stoppedAt(r)).toBe(3);
        expect(r.runs[0]!.result.durationMs).toBe(3000);
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 0.05 min', durationMs: 3000 });
    });

    test('an unknown skill in a stop ends the plan error before any phase runs', async () => {
        const r = await sim(chopBurn(), { stops: [{ kind: 'xp', skill: 'woodcuting', amount: 1 }] });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('unknown skill "woodcuting"');
        expect(r.runs).toEqual([]);
    });
});

describe('onFail', () => {
    test("'fail' (the default) ends the plan with the phase's status and reason", async () => {
        const r = await sim(plan([phase(scripted('broken', [{ fail: 'broke' }]), {})]));
        expect(r.result).toMatchObject({ status: 'failed', reason: 'broken: try: broke' });
        expect(r.result.screenshots).toEqual(['/shots/broken-failed.png']);
    });

    test('a stuck phase ends the plan stuck', async () => {
        const stall = defineTask({ ...watch, name: 'stall', stuckAfterMs: 2000 });
        const r = await sim(plan([phase(stall, {})]));
        expect(r.result.status).toBe('stuck');
        expect(r.result.reason).toStartWith('stall: no XP, position, HP or inventory change');
    });

    test("'continue' skips the failed phase once, so the phase below gets the turn", async () => {
        const r = await sim(
            plan(
                [phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: 'continue' }), phase(train, {})],
                v => v.runs('train') >= 2,
            ),
        );
        expect(selected(r)).toEqual(['primary', 'train', 'primary', 'train']);
        expect(r.result.status).toBe('done');
    });

    test('the function form decides from the result', async () => {
        const seen: string[] = [];
        const r = await sim(
            plan([
                phase(
                    scripted('primary', [{ fail: 'retry later' }, { fail: 'fatal' }]),
                    {},
                    {
                        onFail: res => {
                            seen.push(`${res.status} ${res.reason}`);
                            return res.reason.includes('retry') ? 'continue' : 'fail';
                        },
                    },
                ),
                phase(train, {}),
            ]),
        );
        expect(seen).toEqual(['failed try: retry later', 'failed try: fatal']);
        expect(selected(r)).toEqual(['primary', 'train', 'primary']);
        expect(r.result).toMatchObject({ status: 'failed', reason: 'primary: try: fatal' });
    });

    test('maxFails failures in a row (default 3) fail the plan', async () => {
        const byDefault = await failsUntil();
        expect(selected(byDefault)).toEqual(['primary', 'train', 'primary', 'train', 'primary']);
        expect(byDefault.result).toMatchObject({
            status: 'failed',
            reason: 'primary failed 3 times in a row: try: busy',
        });
        const two = await failsUntil(2);
        expect(selected(two)).toEqual(['primary', 'train', 'primary']);
        expect(two.result.reason).toBe('primary failed 2 times in a row: try: busy');
    });

    test('a done run clears the failure count', async () => {
        // Without the reset the second failure (the 4th run) would end the plan.
        const outcomes: Outcome[] = [{ fail: 'busy' }, { done: 'did it' }, { fail: 'busy' }];
        const r = await sim(
            plan([phase(scripted('primary', outcomes), {}, { onFail: 'continue', maxFails: 2 }), phase(train, {})]),
        );
        expect(selected(r)).toEqual(['primary', 'train', 'primary', 'primary', 'train', 'primary']);
        expect(r.result.reason).toBe('primary failed 2 times in a row: try: busy');
    });

    test('a death in a phase ends the plan failed, whatever its onFail and maxFails', async () => {
        const timeline = BASE.series(10, (w, i) => (i === 4 ? w.message('Oh dear, you are dead!') : w));
        const r = await sim(plan([phase(watch, {}, { onFail: 'continue', maxFails: 9 }), phase(train, {})]), {
            timeline,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('watch: died');
        expect(r.result.reason).not.toContain('interrupt:death');
        expect(selected(r)).toEqual(['watch']);
        expect(r.runs[0]!.result.endedBy).toBe('interrupt:death');
        const fn = await sim(plan([phase(watch, {}, { onFail: () => 'continue' }), phase(train, {})]), { timeline });
        expect(fn.result.reason).toStartWith('watch: died');
    });

    test('a respawn seen between two phase runs ends the plan failed', async () => {
        const timeline = BASE.series(12, (w, i) =>
            i < 1 ? w : world({ ...w.build(), player: { ...w.build().player!, respawnCount: 1 } }),
        );
        const r = await sim(
            plan([phase(train, {})], v => v.runs('train') >= 3),
            { timeline },
        );
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('died between phases (1 respawn since the plan started); last: train done');
        expect(selected(r)).toEqual(['train']);
    });

    test('a respawn from before the plan started is not this plan', async () => {
        const base = BASE.build();
        const timeline = [{ ...base, player: { ...base.player!, respawnCount: 2 } }];
        const r = await sim(
            plan([phase(train, {})], v => v.runs('train') >= 2),
            { timeline },
        );
        expect(r.result.status).toBe('done');
    });

    test('an error phase ends the plan error, whatever its onFail', async () => {
        const thrower = defineTask({
            name: 'thrower',
            description: 'plan test',
            params: z.object({}),
            steps: [
                {
                    name: 'boom',
                    when: () => true,
                    run: () => {
                        throw new Error('bug');
                    },
                },
            ],
        });
        const r = await sim(plan([phase(thrower, {}, { onFail: 'continue' })]));
        expect(r.result).toMatchObject({ status: 'error', reason: 'thrower: boom threw: bug' });
    });
});

describe('rails', () => {
    const noop = scripted('noop', [{ done: 'nothing to do' }]);
    const handBack = [phase(noop, {}, { name: 'a', when: v => v.last?.phase !== 'a' }), phase(noop, {}, { name: 'b' })];

    const NOTHING = 'nothing left to do';

    test('phases that finish and change nothing end the plan done after maxIdlePhases in a row', async () => {
        const r = await sim(plan(handBack));
        expect(r.result).toMatchObject({ status: 'done', reason: `${NOTHING}: a, b done (try: nothing to do)` });
        const longer = await sim(plan(handBack), { maxIdlePhases: 5 });
        expect(selected(longer)).toEqual(['a', 'b', 'a', 'b', 'a']);
        expect(longer.result.status).toBe('done');
    });

    test('the done reason names an unmet plan until', async () => {
        const r = await sim(plan(handBack, v => v.inv('Logs') > 99));
        expect(r.result.reason).toBe(`${NOTHING}: a, b done (try: nothing to do); plan until not met`);
    });

    test('phases that fail without changing anything are a stall: the plan fails', async () => {
        const r = await sim(
            plan([
                phase(failing('a'), {}, { name: 'a', when: v => v.last?.phase !== 'a', onFail: 'continue' }),
                phase(failing('b'), {}, { name: 'b', onFail: 'continue' }),
            ]),
        );
        expect(r.result).toMatchObject({ status: 'failed', reason: `${NO_PROGRESS}: a, b, a` });
    });

    test('a phase chosen again that ends done at once in the state it started in ends the plan done, without waiting', async () => {
        // It fills the inventory first (a change), then is re-chosen and has nothing left to do.
        const fill = scripted('fill', [{ done: 'inventory full: 25 ores' }]);
        const r = await sim(
            plan([phase(fill, {}, { name: 'mining' })], v => v.inv('Copper ore') >= 12),
            {
                maxIdlePhases: 9,
            },
        );
        expect(selected(r)).toEqual(['mining', 'mining']);
        expect(r.result).toMatchObject({
            status: 'done',
            reason: `${NOTHING}: mining done (try: inventory full: 25 ores); plan until not met`,
        });
    });

    test('progress, then done at once in the same state, ends the plan done: nothing left to do', async () => {
        const fill = scripted('fill', [{ done: 'inventory full: 25 ores' }]);
        const r = await sim(plan([phase(fill, {}, { name: 'mining' })]), { maxIdlePhases: 9 });
        expect(selected(r)).toEqual(['mining', 'mining']);
        expect(r.result).toMatchObject({
            status: 'done',
            reason: `${NOTHING}: mining done (try: inventory full: 25 ores)`,
        });
    });

    test('phases that undo each other without gaining XP are idle once their end states repeat', async () => {
        const r = await sim(
            plan([
                phase(move, { to: 'east' }, { name: 'east', when: v => v.last?.phase !== 'east' }),
                phase(move, { to: 'west' }, { name: 'west' }),
            ]),
        );
        // Each run moves the bot; from the third on, each ends where an earlier one did.
        expect(selected(r)).toEqual(['east', 'west', 'east', 'west', 'east']);
        expect(r.result).toMatchObject({
            status: 'done',
            reason: expect.stringContaining('nothing left to do: east, west'),
        });
    });

    test('a phase that only changes HP is idle', async () => {
        const r = await sim(plan([phase(rest, {})]));
        expect(r.runs.map(x => x.result.reason)).toEqual(['rest: rested', 'rest: rested']);
        expect(r.result).toMatchObject({ status: 'done', reason: expect.stringContaining('nothing left to do: rest') });
        expect(r.result.hp).toEqual({ current: 8, max: 10 });
    });

    test('a phase that makes progress resets the idle count', async () => {
        const r = await sim(
            plan(
                [phase(noop, {}, { when: v => v.last?.phase !== 'noop' }), phase(train, {})],
                v => v.runs('train') >= 4,
            ),
        );
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns).toEqual({ noop: 4, train: 4 });
    });

    test("every phase's params are checked before the first phase runs", async () => {
        const r = await sim(
            plan([
                phase(chop, {}),
                // A plan file type-checks this; a draft run before it is checked must still fail fast.
                phase(chop, { tree: 'maple' } as never, { name: 'second' }),
            ]),
        );
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toStartWith('phase "second" has invalid params: tree:');
        expect(r.runs).toEqual([]);
        expect(r.driver.commands).toEqual([]);
    });

    test('a throwing when ends the plan error, naming the phase and the predicate', async () => {
        const r = await sim(plan([phase(chop, {}, { when: v => v.level('Woodcuting') > 1 })]));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toStartWith('phase "chop" when threw: unknown skill "Woodcuting"');
    });

    test("a phase's until that throws mid-phase stops the phase and ends the plan error", async () => {
        const r = await sim(
            plan([
                phase(
                    chop,
                    {},
                    {
                        until: v => {
                            if (v.inv('Logs') >= 2) throw new Error('boom');
                            return false;
                        },
                    },
                ),
            ]),
        );
        expect(r.runs).toHaveLength(1);
        expect(r.result).toMatchObject({ status: 'error', reason: 'phase "chop" until threw: boom' });
    });

    test("the plan's until that throws ends the plan error", async () => {
        const r = await sim(plan([phase(chop, {})], v => v.runs('chop ') > 0));
        expect(r.result).toMatchObject({
            status: 'error',
            reason: 'plan until threw: no phase "chop " in plan "test-plan"',
        });
    });

    test('an onFail that throws ends the plan error', async () => {
        const r = await sim(
            plan([
                phase(
                    scripted('broken', [{ fail: 'broke' }]),
                    {},
                    {
                        onFail: () => {
                            throw new Error('boom');
                        },
                    },
                ),
            ]),
        );
        expect(r.result).toMatchObject({ status: 'error', reason: 'phase "broken" onFail threw: boom' });
    });
});

describe('phase runs', () => {
    test('a close that throws is logged, and the run still counts', async () => {
        const closed: string[] = [];
        const r = await sim(
            plan([phase(train, {})], v => v.runs('train') >= 2),
            {
                phaseRun: run => ({
                    ...run,
                    close: () => {
                        closed.push(run.runId);
                        throw new Error('close broke');
                    },
                }),
            },
        );
        expect(closed).toEqual(['phase-0-train', 'phase-1-train']);
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met', stepRuns: { train: 2 } });
        expect(r.result.recent.map(x => x.status)).toEqual(['done', 'done']);
        expect(r.events.filter(e => e.type === 'close-error')).toEqual(
            closed.map(runId => ({ type: 'close-error', phase: 'train', runId, message: 'close broke' })),
        );
    });

    test("a phase run that throws is still closed, and the plan's reason is its error, not the close's", async () => {
        const closed: string[] = [];
        const r = await sim(plan([phase(train, {})]), {
            phaseRun: run => ({
                ...run,
                sinks: {
                    ...run.sinks,
                    event: e => {
                        if (e.type === 'start') throw new Error('log broke');
                        run.sinks.event(e);
                    },
                },
                close: () => {
                    closed.push(run.runId);
                    throw new Error('close broke');
                },
            }),
        });
        expect(closed).toEqual(['phase-0-train']);
        expect(r.result).toMatchObject({ status: 'error', reason: 'phase "train" threw: log broke' });
    });
});

describe('the view', () => {
    test('v.bank remembers the bank as last seen open in an earlier phase', async () => {
        // The bank is open at ticks 2 and 3, while the first phase runs.
        const timeline = BASE.series(8, (w, i) =>
            i === 2 || i === 3 ? w.bank([{ name: 'Copper ore', count: 10 }]) : w,
        );
        const seen: (number | undefined)[] = [];
        const r = await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push(v.bank('copper ore'));
                                return v.bank(/ ore$/) === 10;
                            },
                        },
                    ),
                    phase(watch, {}, { until: v => v.state.tick >= 6 }),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline },
        );
        expect(selected(r)).toEqual(['watch', 'train']);
        expect(seen).toEqual([undefined, 10]);
        expect(r.result.status).toBe('done');
    });

    test('a phase run starts with the bank as last seen open, the record its walks plan on (ExecuteOptions.bank)', async () => {
        const timeline = BASE.series(8, (w, i) =>
            i === 2 || i === 3 ? w.bank([{ name: 'Copper ore', count: 10 }]) : w,
        );
        const records: (number | undefined)[] = [];
        const probe = defineTask({
            name: 'probe',
            description: 'plan test bank record',
            params: z.object({}),
            steps: [
                {
                    name: 'probe',
                    when: () => true,
                    run(ctx) {
                        records.push(ctx.bank?.('copper ore'), ctx.bank?.('Tin ore'));
                        return { done: 'probed' };
                    },
                },
            ],
        });
        const r = await sim(
            plan(
                [
                    phase(probe, {}, { when: v => v.runs('probe') === 0 || v.runs('watch') > 0 }),
                    phase(watch, {}, { until: v => v.state.tick >= 6 }),
                ],
                v => v.runs('probe') >= 2,
            ),
            { timeline },
        );
        expect(r.result.status).toBe('done');
        // The first probe ran before the plan saw the bank (no record); the second after watch saw it: 10, no tin.
        expect(records).toEqual([undefined, undefined, 10, 0]);
    });

    test("the client's empty bank list on the tick before the close does not wipe what was remembered", async () => {
        // Open and listed at ticks 2-3, emptied for tick 4 only, closed from tick 5.
        const timeline = BASE.series(9, (w, i) => {
            if (i === 2 || i === 3) return w.bank([{ name: 'Copper ore', count: 6 }]);
            return i === 4 ? w.bank([]) : w;
        });
        const seen: (number | undefined)[] = [];
        await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push(v.bank('Copper ore'));
                                return v.runs('watch') > 0;
                            },
                        },
                    ),
                    phase(watch, {}, { until: v => v.state.tick >= 7 }),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline },
        );
        expect(seen).toEqual([undefined, 6]);
    });

    test('a bank left empty for two open ticks reads as emptied', async () => {
        const timeline = BASE.series(9, (w, i) => {
            if (i === 2) return w.bank([{ name: 'Copper ore', count: 6 }]);
            return i === 3 || i === 4 ? w.bank([]) : w;
        });
        const seen: (number | undefined)[] = [];
        await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push(v.bank('Copper ore'));
                                return v.runs('watch') > 0;
                            },
                        },
                    ),
                    phase(watch, {}, { until: v => v.state.tick >= 7 }),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline },
        );
        expect(seen).toEqual([undefined, 0]);
    });

    test('a later look at the bank replaces what was remembered: an item no longer listed reads 0', async () => {
        const timeline = BASE.series(8, (w, i) => {
            if (i === 2)
                return w.bank([
                    { name: 'Copper ore', count: 10 },
                    { name: 'Tin ore', count: 4 },
                ]);
            return i === 5 ? w.bank([{ name: 'Tin ore', count: 4 }]) : w;
        });
        const seen: (number | undefined)[][] = [];
        await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push([v.bank('Copper ore'), v.bank('Tin ore')]);
                                return v.runs('watch') > 0;
                            },
                        },
                    ),
                    phase(watch, {}, { until: v => v.state.tick >= 7 }),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline },
        );
        expect(seen).toEqual([
            [undefined, undefined],
            [0, 4],
        ]);
    });

    test("the result's bankDelta runs from the bank as first seen open to as last seen; none without a look", async () => {
        const timeline = BASE.series(8, (w, i) => {
            if (i === 2)
                return w.bank([
                    { name: 'Copper ore', count: 10 },
                    { name: 'Tin ore', count: 4 },
                ]);
            return i === 5
                ? w.bank([
                      { name: 'Tin ore', count: 7 },
                      { name: 'Bronze bar', count: 3 },
                  ])
                : w;
        });
        const def = plan(
            [phase(watch, {}, { until: v => v.state.tick >= 7 }), phase(train, {})],
            v => v.runs('watch') > 0,
        );
        const r = await sim(def, { timeline });
        expect(r.result.bankDelta).toEqual({ 'Copper ore': -10, 'Tin ore': 3, 'Bronze bar': 3 });
        const unseen = await sim(def, { timeline: BASE.series(8, w => w) });
        expect(unseen.result).not.toHaveProperty('bankDelta');
    });

    test('inv matches a name exactly, ignoring case, or a pattern; free and full count slots', async () => {
        const views: { inv: number[]; free: number; full: boolean }[] = [];
        await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                views.push({
                                    inv: [v.inv('bones'), v.inv('Bone'), v.inv(/^bon/i)],
                                    free: v.free,
                                    full: v.full,
                                });
                                return true;
                            },
                        },
                    ),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline: [BASE.inv('Logs', 4).build()] },
        );
        expect(views).toEqual([{ inv: [24, 0, 24], free: 0, full: true }]);
    });

    test('runs and last describe the finished phase runs', async () => {
        const seen: unknown[] = [];
        await sim(
            plan(
                [
                    phase(
                        train,
                        {},
                        {
                            when: v => {
                                seen.push([v.runs('train'), v.last]);
                                return true;
                            },
                        },
                    ),
                ],
                v => v.runs('train') >= 2,
            ),
        );
        expect(seen).toEqual([
            [0, null],
            [1, { phase: 'train', status: 'done', reason: 'train: trained' }],
        ]);
    });
});

describe('the result and the plan log', () => {
    test('totals run from the first state to the last, by phase, with a compact summary', async () => {
        const r = await sim(chopBurn(v => v.runs('chop') >= 2));
        // The plan's duration ends where it ended, not after the ticks it then reads for late XP.
        const ticks = r.driver.state().tick - PLAN_SETTLE_TICKS;
        expect(r.result).toEqual({
            task: 'plan:test-plan',
            bot: 'tester',
            runId: 'plan-1',
            status: 'done',
            reason: 'plan until met',
            params: {
                plan: 'test-plan',
                phases: [
                    { phase: 'burn', task: 'burn', params: {} },
                    { phase: 'chop', task: 'chop', params: { tree: 'tree' } },
                ],
            },
            durationMs: ticks * TICK_MS,
            loops: 3,
            stepRuns: { burn: 1, chop: 2 },
            lastStep: 'chop',
            xpGained: { Woodcutting: 200, Firemaking: 160 },
            levelsGained: {},
            inventoryDelta: { Logs: 4 },
            finalPos: { x: 3222, z: 3218, level: 0 },
            hp: { current: 10, max: 10 },
            inCombat: false,
            screenshots: [],
            logFile: '/logs/plan-1.ndjson',
            phases: [
                {
                    phase: 'burn',
                    task: 'burn',
                    runs: 1,
                    statuses: { done: 1 },
                    durationMs: r.runs[1]!.result.durationMs,
                    xpGained: { Firemaking: 160 },
                    lastReason: 'out: no logs left',
                },
                {
                    phase: 'chop',
                    task: 'chop',
                    runs: 2,
                    statuses: { done: 2 },
                    durationMs: r.runs[0]!.result.durationMs + r.runs[2]!.result.durationMs,
                    xpGained: { Woodcutting: 200 },
                    lastReason: 'full: inventory full',
                },
            ],
            recent: r.runs.map(x => ({
                phase: x.phase,
                runId: x.runId,
                logFile: `/logs/${x.runId}.ndjson`,
                status: 'done',
                reason: x.result.reason,
            })),
        });
    });

    test('the plan log has start, a select, phase-start and phase-end per run, and the result', async () => {
        const r = await sim(plan([phase(train, {})], v => v.runs('train') >= 2));
        expect(r.events.map(e => e.type)).toEqual([
            'start',
            'select',
            'phase-start',
            'phase-end',
            'select',
            'phase-start',
            'phase-end',
            'result',
        ]);
        expect(r.events[0]).toEqual({
            type: 'start',
            plan: 'test-plan',
            bot: 'tester',
            phases: [{ phase: 'train', task: 'train', params: {} }],
            requires: [],
            stops: [],
        });
        expect(r.events[2]).toEqual({
            type: 'phase-start',
            phase: 'train',
            index: 0,
            runId: 'phase-0-train',
            logFile: '/logs/phase-0-train.ndjson',
        });
        expect(r.events[5]).toMatchObject({ type: 'phase-start', index: 1, runId: 'phase-1-train' });
        // the plan's until read runs('train') at each choice: 0 before the first run, 1 before the second
        expect(r.events[1]).toMatchObject({ type: 'select', planReads: { "runs('train')": 0 } });
        expect(r.events[4]).toMatchObject({ type: 'select', planReads: { "runs('train')": 1 } });
        expect(r.events[3]).toEqual({
            type: 'phase-end',
            phase: 'train',
            runId: 'phase-0-train',
            status: 'done',
            reason: 'train: trained',
            durationMs: r.runs[0]!.result.durationMs,
            xpGained: r.runs[0]!.result.xpGained,
        });
        expect(r.events.at(-1)).toEqual({ type: 'result', ...r.result });
    });

    test("planParams gives each phase's parsed params, raw where they don't parse, as a run's result does", async () => {
        const def = plan([phase(chop, {}), phase(train, {})]);
        expect(planParams(def)).toEqual({
            plan: 'test-plan',
            phases: [
                { phase: 'chop', task: 'chop', params: { tree: 'tree' } },
                { phase: 'train', task: 'train', params: {} },
            ],
        });
        expect((await sim(def)).result.params).toEqual(planParams(def));
        // @ts-expect-error: chop has no maple tree
        const bad = plan([phase(chop, { tree: 'maple' })]);
        expect(planParams(bad).phases[0]!.params).toEqual({ tree: 'maple' });
        expect((await sim(bad)).result.params).toEqual(planParams(bad));
    });
});

describe('a kill', () => {
    test("mid-phase adds up the plan so far, the cut phase run counted as error, and leaves the plan's own totals", async () => {
        let killed: PlanResult | null = null;
        const r = await sim(
            chopBurn(v => v.runs('burn') >= 1),
            killable('phase-1-burn', kill => {
                killed ??= kill('killed by SIGTERM');
            }),
        );
        expect(killed).toMatchObject({
            task: 'plan:test-plan',
            runId: 'plan-1',
            status: 'error',
            reason: 'killed by SIGTERM',
            params: planParams(chopBurn()),
            stepRuns: { chop: 1, burn: 1 },
            lastStep: 'burn',
            xpGained: { Woodcutting: 100 },
        });
        expect(killed!.phases).toMatchObject([
            { phase: 'burn', runs: 1, statuses: { error: 1 }, lastReason: 'killed by SIGTERM' },
            { phase: 'chop', runs: 1, statuses: { done: 1 } },
        ]);
        expect(killed!.recent.map(x => [x.runId, x.status])).toEqual([
            ['phase-0-chop', 'done'],
            ['phase-1-burn', 'error'],
        ]);
        // The kill's copies leave the plan's own summaries alone.
        expect(r.result.phases.find(p => p.phase === 'burn')!.statuses).toEqual({ done: 1 });
    });

    test('before any phase run has no phase totals', async () => {
        let killed: PlanResult | null = null;
        await sim(
            plan([phase(train, {})], v => v.runs('train') >= 1),
            {
                onKillable: kill => {
                    killed = kill('killed by SIGINT');
                },
            },
        );
        expect(killed).toMatchObject({ status: 'error', reason: 'killed by SIGINT', stepRuns: {}, recent: [] });
        expect(killed!.phases.map(p => p.runs)).toEqual([0]);
    });

    test('while a phase run closes counts that run with its own result', async () => {
        let killed: PlanResult | null = null;
        let kill: ((reason: string) => PlanResult) | null = null;
        await sim(
            chopBurn(v => v.runs('burn') >= 1),
            {
                onKillable: k => {
                    kill = k;
                },
                phaseRun: run => ({
                    ...run,
                    close: () => {
                        killed ??= kill!('killed by SIGHUP');
                    },
                }),
            },
        );
        expect(killed!.recent).toMatchObject([{ phase: 'chop', status: 'done' }]);
        expect(killed!.phases.find(p => p.phase === 'chop')!.statuses).toEqual({ done: 1 });
    });
});

describe('recordReads', () => {
    const v = {
        state: { player: { worldX: 3200, worldZ: 3400 }, inventory: [{ name: 'Logs', count: 1 }] },
        inv: (item: string | RegExp) => (String(item).includes('Logs') ? 3 : 0),
        bank: () => undefined,
        free: 25,
        last: { phase: 'fish', status: 'done', reason: 'full' },
    } as unknown as PlanView;

    test('calls by how they were written, fields, and scalars off state by path; the answers unchanged', () => {
        const reads = {};
        const rv = recordReads(v, reads);
        expect(rv.inv('Logs') > 0 && rv.inv(/^raw /i) === 0).toBe(true);
        expect(rv.bank('Coins')).toBeUndefined();
        expect(rv.free).toBe(25);
        expect(rv.state.player?.worldX).toBe(3200);
        expect(rv.last?.phase).toBe('fish');
        // arrays are handed over as they are, unrecorded
        expect(rv.state.inventory.length).toBe(1);
        expect(reads).toEqual({
            "inv('Logs')": 3,
            'inv(/^raw /i)': 0,
            "bank('Coins')": null,
            free: 25,
            'state.player.worldX': 3200,
            last: { phase: 'fish', status: 'done', reason: 'full' },
        });
    });

    test('keeps at most 12 distinct reads, a repeat updating its own', () => {
        const reads: Record<string, unknown> = {};
        const rv = recordReads(v, reads);
        for (let i = 0; i < 20; i++) rv.inv(`item ${i}`);
        rv.inv('item 0');
        expect(Object.keys(reads)).toHaveLength(12);
        expect(reads["inv('item 19')"]).toBeUndefined();
    });
});

/** Quest done at tick `doneAt`, the Smithing lump (and its level) `lumpAt`, as a quest reward reaches the client. */
const reward = (doneAt: number, lumpAt: number) =>
    BASE.skill('Smithing', 1, 0).series(40, (w, i) => {
        const withQuest = i >= doneAt ? w.quests({ imp: 'done' }) : w;
        return i >= lumpAt ? withQuest.skill('Smithing', 40, 12725) : withQuest;
    });

const questPlan = (until: Predicate) => plan([phase(watch, {})], until);

describe('reward lumps outside a phase', () => {
    test('a lump a few ticks after the plan until holds is in the result, not in the phase', async () => {
        const r = await sim(
            questPlan(v => v.questDone('imp')),
            { timeline: reward(3, 5) },
        );
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(r.result.xpGained).toEqual({ Smithing: 12725 });
        expect(r.result.levelsGained).toEqual({ Smithing: { from: 1, to: 40 } });
        expect(r.runs[0]!.result.xpGained).toEqual({});
        expect(r.result.phases.map(p => p.xpGained)).toEqual([{}]);
    });

    test('a lump one tick after the quest flip is counted', async () => {
        const r = await sim(
            questPlan(v => v.questDone('imp')),
            { timeline: reward(3, 4) },
        );
        expect(r.result.xpGained).toEqual({ Smithing: 12725 });
    });

    test('a lump past the settle is not waited for', async () => {
        const r = await sim(
            questPlan(v => v.questDone('imp')),
            { timeline: reward(3, 3 + PLAN_SETTLE_TICKS + 10) },
        );
        expect(r.result.xpGained).toEqual({});
    });

    test('a lump in a later phase window counts once, in the total and that phase', async () => {
        // train gains Woodcutting in its own window; the Smithing lump lands in the next phase window (the sim has no gap between phases).
        const r = await sim(
            plan([phase(train, {}, { when: v => v.runs('train') < 1 }), phase(watch, {})], v => v.questDone('imp')),
            { timeline: reward(8, 4) },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.xpGained.Smithing).toBe(12725);
        expect(r.result.xpGained.Woodcutting).toBe(10);
        const phased = r.result.phases.reduce((n, p) => n + (p.xpGained.Smithing ?? 0), 0);
        expect(r.result.phases.map(p => p.xpGained.Smithing ?? 0)).toEqual([0, 12725]);
        expect(phased).toBe(12725);
    });

    test('a plan that fails does not wait for late XP', async () => {
        const r = await sim(plan([phase(failing('f'), {})]), { timeline: reward(1, 2) });
        expect(r.result.status).toBe('failed');
        expect(r.result.xpGained).toEqual({});
    });
});
