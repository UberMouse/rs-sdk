import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { send, wait } from '../../core/op';
import {
    combatAtLeast,
    definePlan,
    isPlan,
    levelAtLeast,
    type Phase,
    phase,
    type PlanView,
    recordReads,
    type PhaseOptions,
    type PhaseRun,
    PHASE_SETTLE_READS,
    type PlanDef,
    planParams,
    PLAN_SETTLE_TICKS,
    runPlan,
    type PlanResult,
    type Predicate,
} from '../../lib/plan';
import { journalOf } from '../../lib/journal-memory';
import { journalTitle, QUEST_TAB_REQUIRED, QUESTS } from '../../lib/quests';
import { SETTLE_TICKS } from '../../lib/engine';
import type { StopCondition } from '../../lib/stop';
import { defineTask, type Outcome } from '../../lib/task';
import { countItems, TICK_MS } from '../../lib/util';
import chopBurnPlan from '../../plans/chop-burn';
import waitTask from '../../tasks/wait';
import woodcutting from '../../tasks/woodcutting';
import { act } from '../core/fixtures';
import { withJournal } from '../journal';
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

/** An `observes` task that looks at nothing and ends done. */
const glance = { ...scripted('glance', [{ done: 'looked' }]), observes: true as const };

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

/** A plan of `phases` whose defaults retry, at most 2 failures in a row. */
const withDefaults = (phases: Phase[]) =>
    definePlan({ name: 'test-plan', phases, defaults: { onFail: 'retry', maxFails: 2 } });
/** A phase task that always fails. */
const busy = () => scripted('primary', [{ fail: 'busy' }]);
/** Each phase run's status and the onFail decision its phase-end logged ('-' for none). */
const decisions = (r: PlanSimulation) =>
    r.events.filter(e => e.type === 'phase-end').map(e => `${e.status} ${e.onFail ?? '-'}`);

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
        expect(selects.map(e => e.last)).toEqual([
            null,
            { phase: 'primary', status: 'failed', reason: 'try: busy', endedBy: 'try' },
        ]);
    });
});

const withNeeds = (list: PlanDef['needs'], needsUnless?: Predicate) =>
    definePlan({
        name: 'test-plan',
        phases: [phase(train, {})],
        needs: list,
        needsUnless,
        until: v => v.runs('train') > 0,
    });

describe('needs', () => {
    const EMPTY = world().skill('Woodcutting', 1, 0).skill('Firemaking', 1, 0);
    const NEEDS = [{ item: 'Pot' }, { item: 'Nails', count: 12 }, { item: /pickaxe$/i, label: 'pickaxe' }];

    test('a short need fails the plan at once, naming each shortfall, before any phase', async () => {
        const r = await sim(withNeeds(NEEDS), { timeline: [EMPTY.inv('Nails', 5, { id: 1539 }).build()] });
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'plan needs 1 Pot (held 0), 12 Nails (held 5), 1 pickaxe (held 0)',
        });
        expect(r.runs).toEqual([]);
        expect(r.events[0]!.needs).toEqual(['Pot', 'Nails', 'pickaxe']);
    });

    test('needs held (a worn pickaxe counts) let the plan start', async () => {
        const w = EMPTY.inv('Pot').inv('Nails', 12, { id: 1539 }).equipment({ name: 'Bronze pickaxe' });
        const r = await sim(withNeeds(NEEDS), { timeline: [w.build()] });
        expect(r.result.status).toBe('done');
        expect(selected(r)).toEqual(['train']);
    });

    test('a resumed plan (needsUnless holds) is not checked', async () => {
        const r = await sim(
            withNeeds(NEEDS, v => v.quest('imp') !== 'none'),
            { timeline: [EMPTY.quests({ imp: 'started' }).build()] },
        );
        expect(r.result.status).toBe('done');
        const fresh = await sim(
            withNeeds(NEEDS, v => v.quest('imp') !== 'none'),
            {
                timeline: [EMPTY.quests({}).build()],
            },
        );
        expect(fresh.result.reason).toStartWith('plan needs ');
    });

    test('an unlabelled pattern need is named by its source in the event and the reason', async () => {
        const r = await sim(withNeeds([{ item: /pickaxe$/i }]), { timeline: [EMPTY.build()] });
        expect(r.result.reason).toBe('plan needs 1 pickaxe$ (held 0)');
        expect(r.events[0]!.needs).toEqual(['pickaxe$']);
    });

    test('a throwing needsUnless ends the plan error, not a rejection', async () => {
        const r = await sim(
            withNeeds(NEEDS, () => {
                throw new Error('x');
            }),
            { timeline: [EMPTY.build()] },
        );
        expect(r.result).toMatchObject({ status: 'error', reason: 'plan needsUnless threw: x' });
        expect(r.runs).toEqual([]);
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
        // Unsettled, so the minute runs out inside a phase run rather than in a settle between two.
        const r = await sim({ ...chopBurn(), settle: false }, { stops: [{ kind: 'minutes', minutes: 1 }] });
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

    test("'retry' runs the failed phase again, with no other phase between, and the plan goes on", async () => {
        const outcomes: Outcome[] = [{ fail: 'busy' }, { fail: 'busy' }, { done: 'did it' }];
        const r = await sim(
            plan(
                [
                    phase(scripted('primary', outcomes), {}, { onFail: 'retry', when: v => v.last?.status !== 'done' }),
                    phase(train, {}),
                ],
                v => v.runs('train') >= 1,
            ),
        );
        expect(selected(r)).toEqual(['primary', 'primary', 'primary', 'train']);
        expect(r.result.status).toBe('done');
    });

    test("'retry' leaves the choice to selection: a phase above whose when holds still wins", async () => {
        const r = await sim(
            plan(
                [
                    phase(train, {}, { when: v => v.last?.status === 'failed' }),
                    phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: 'retry' }),
                ],
                v => v.runs('train') >= 2,
            ),
        );
        expect(selected(r)).toEqual(['primary', 'train', 'primary', 'train']);
        expect(r.result.status).toBe('done');
    });

    test("'retry' fails the plan at maxFails in a row; a done run resets the count", async () => {
        const always = await sim(
            plan([phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: 'retry', maxFails: 2 })]),
        );
        expect(selected(always)).toEqual(['primary', 'primary']);
        expect(always.result).toMatchObject({ status: 'failed', reason: 'primary failed 2 times in a row: try: busy' });
        // Without the reset the third run (the second failure) would end the plan.
        const outcomes: Outcome[] = [{ fail: 'busy' }, { done: 'did it' }, { fail: 'busy' }];
        const reset = await sim(plan([phase(scripted('primary', outcomes), {}, { onFail: 'retry', maxFails: 2 })]));
        expect(selected(reset)).toEqual(['primary', 'primary', 'primary', 'primary']);
        expect(reset.result.reason).toBe('primary failed 2 times in a row: try: busy');
    });

    test("'retry' counts its failures across another phase's done runs: only its own done clears them", async () => {
        const r = await sim(
            plan([
                phase(train, {}, { when: v => v.last?.phase !== 'train' }),
                phase(busy(), {}, { onFail: 'retry', maxFails: 3 }),
            ]),
        );
        expect(selected(r)).toEqual(['train', 'primary', 'train', 'primary', 'train', 'primary']);
        expect(r.result).toMatchObject({ status: 'failed', reason: 'primary failed 3 times in a row: try: busy' });
    });

    test('the function form may return retry; a death still ends the plan', async () => {
        const r = await sim(
            plan([phase(scripted('primary', [{ fail: 'busy' }]), {}, { onFail: () => 'retry', maxFails: 2 })]),
        );
        expect(selected(r)).toEqual(['primary', 'primary']);
        expect(r.result.reason).toBe('primary failed 2 times in a row: try: busy');
        const timeline = BASE.series(10, (w, i) => (i === 4 ? w.message('Oh dear, you are dead!') : w));
        const died = await sim(plan([phase(watch, {}, { onFail: () => 'retry', maxFails: 9 })]), { timeline });
        expect(died.result.reason).toStartWith('watch: died');
        expect(selected(died)).toEqual(['watch']);
    });

    test("a plan's defaults apply to phases without their own onFail or maxFails; a phase's own wins", async () => {
        const byDefault = await sim(withDefaults([phase(busy(), {})]));
        expect(selected(byDefault)).toEqual(['primary', 'primary']);
        expect(byDefault.result.reason).toBe('primary failed 2 times in a row: try: busy');
        const ownOnFail = await sim(withDefaults([phase(busy(), {}, { onFail: 'fail' })]));
        expect(ownOnFail.result).toMatchObject({ status: 'failed', reason: 'primary: try: busy' });
        const ownMax = await sim(withDefaults([phase(busy(), {}, { maxFails: 4 })]));
        expect(ownMax.result.reason).toBe('primary failed 4 times in a row: try: busy');
    });

    test('phase-end names the onFail decision of a failed run, and none for a done one', async () => {
        const outcomes: Outcome[] = [{ fail: 'busy' }, { done: 'did it' }];
        const retried = await sim(
            plan([phase(scripted('primary', outcomes), {}, { onFail: 'retry' })], v => v.runs('primary') >= 2),
        );
        expect(decisions(retried)).toEqual(['failed retry', 'done -']);
        expect(decisions(await failsUntil(2))).toEqual(['failed continue', 'done -', 'failed continue']);
        const failed = await sim(plan([phase(scripted('broken', [{ fail: 'broke' }]), {})]));
        expect(decisions(failed)).toEqual(['failed fail']);
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

// A Guard steps beside the bot on every tick 9 mod 10 of the first 100, then stays: outside the idle signature.
const guardEvery10 = BASE.series(100, (w, i) => (i % 10 === 9 ? w.npcBeside('Guard') : w));
const guardBeside = (v: PlanView) => v.npcs('Guard', 1) > 0;

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

    test('observes runs between idle runs leave the idle run as it was: the rail still ends the plan', async () => {
        const looks = [phase(glance, {}, { when: v => v.runs('glance') < v.runs('a') + v.runs('b') }), ...handBack];
        const r = await sim(plan(looks));
        expect(selected(r)).toEqual(['a', 'glance', 'b', 'glance', 'a']);
        expect(r.result).toMatchObject({ status: 'done', reason: `${NOTHING}: a, b done (try: nothing to do)` });
    });

    test('retried failures that change nothing are left to maxFails, not the idle rail', async () => {
        const r = await sim(plan([phase(failing('a'), {}, { onFail: 'retry', maxFails: 5 })]));
        expect(selected(r)).toEqual(['a', 'a', 'a', 'a', 'a']);
        expect(r.result).toMatchObject({ status: 'failed', reason: 'a failed 5 times in a row: try: cannot' });
    });

    test("waits their phase's until ends are left out of the idle rail: more than three in a row run", async () => {
        const def = plan([phase(waitTask, { ticks: 50 }, { until: guardBeside })], v => v.runs('wait') >= 5);
        const r = await sim(def, { timeline: guardEvery10 });
        expect(r.runs.map(x => x.result.reason)).toEqual(Array(5).fill('until met'));
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        // The same runs of a task that does not declare `waits` are idle: the instant repeat ends the plan.
        const notWaits = { ...waitTask, waits: undefined };
        const stall = await sim(plan([phase(notWaits, { ticks: 50 }, { until: guardBeside })]), {
            timeline: guardEvery10,
        });
        expect(selected(stall)).toEqual(['wait', 'wait']);
        expect(stall.result.reason).toBe(`${NOTHING}: wait done (until met)`);
    });

    test('a wait phase whose until ends it maxWaits times in a row fails the plan', async () => {
        const def = plan([phase(waitTask, { ticks: 50 }, { until: guardBeside })]);
        const r = await sim(def, { timeline: guardEvery10, maxWaits: 3 });
        expect(selected(r)).toEqual(['wait', 'wait', 'wait']);
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'wait waited 3 times in a row with its until met each time',
        });
    });

    test('two wait phases whose untils alternate hit the cap together', async () => {
        const waits = [
            phase(waitTask, { ticks: 50 }, { name: 'a', when: v => v.last?.phase !== 'a', until: guardBeside }),
            phase(waitTask, { ticks: 50 }, { name: 'b', until: guardBeside }),
        ];
        const r = await sim(plan(waits), { timeline: guardEvery10, maxWaits: 4 });
        expect(selected(r)).toEqual(['a', 'b', 'a', 'b']);
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'waited 4 times in a row across a, b with their untils met each time',
        });
    });

    test('a run of another phase between until-ended waits resets the wait count', async () => {
        const other = scripted('other', [{ done: 'did it' }]);
        const def = plan(
            [
                phase(other, {}, { name: 'b', when: v => v.last?.phase === 'wait' && v.runs('wait') % 2 === 0 }),
                phase(waitTask, { ticks: 50 }, { until: guardBeside }),
            ],
            v => v.runs('wait') >= 6,
        );
        const r = await sim(def, { timeline: guardEvery10, maxWaits: 3, maxIdlePhases: 9 });
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(selected(r)).toEqual(['wait', 'wait', 'b', 'wait', 'wait', 'b', 'wait', 'wait']);
    });

    test('an observes run between until-ended waits neither counts as one nor resets the count', async () => {
        const def = plan([
            phase(glance, {}, { when: v => v.runs('glance') < v.runs('wait') }),
            phase(waitTask, { ticks: 50 }, { until: guardBeside }),
        ]);
        const r = await sim(def, { timeline: guardEvery10, maxWaits: 3 });
        expect(selected(r)).toEqual(['wait', 'glance', 'wait', 'glance', 'wait']);
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'wait waited 3 times in a row with its until met each time',
        });
    });

    test('waits that run their ticks out with nothing changed end the plan as the rail does', async () => {
        const waits = [
            phase(waitTask, { ticks: 2 }, { name: 'a', when: v => v.last?.phase !== 'a' }),
            phase(waitTask, { ticks: 2 }, { name: 'b' }),
        ];
        const r = await sim(plan(waits));
        expect(selected(r)).toEqual(['a', 'b', 'a']);
        expect(r.result).toMatchObject({ status: 'done', reason: `${NOTHING}: a, b done (wait: waited 2 ticks)` });
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

    test('a phase with a param its task does not take fails the plan at load, naming the phase and the key', async () => {
        const r = await sim(plan([phase(chop, {}), phase(chop, { tre: 'oak' } as never, { name: 'second' })]));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toBe('phase "second" has unknown param "tre" (chop takes: tree)');
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

/**
 * Runs `def` from BASE with phase runs that see the world as the plan last read it and change nothing, and a plan
 * `nextTick` that hands out `ticks` in turn (throwing an Error one), then the last state again a tick on. `reads`
 * counts the plan's nextTick calls.
 */
async function settling(
    def: PlanDef,
    ticks: (BotWorldState | Error)[],
    opts: { nextTick?: boolean; stops?: StopCondition[] } = {},
) {
    let cur = BASE.build();
    const queue = [...ticks];
    const events: Record<string, unknown>[] = [];
    let reads = 0;
    const sinks = {
        event: (e: Record<string, unknown>) => events.push(e),
        print: () => {},
        screenshot: async () => null,
    };
    const nextTick = async () => {
        reads++;
        const next = queue.shift() ?? { ...cur, tick: cur.tick + 1 };
        if (next instanceof Error) throw next;
        return (cur = next);
    };
    const result = await runPlan(def, {
        botName: 'tester',
        runId: 'plan-1',
        logFile: '/logs/plan-1.ndjson',
        sinks,
        stops: opts.stops ?? [],
        state: () => cur,
        ...(opts.nextTick !== false && { nextTick }),
        newPhaseRun: (p, index) => ({
            driver: new TimelineDriver([cur]),
            sinks: { ...sinks, event: () => {} },
            runId: `phase-${index}-${p.name}`,
            logFile: `/logs/phase-${index}.ndjson`,
        }),
    });
    return { result, events, reads, selected: events.filter(e => e.type === 'select').map(e => e.phase) };
}
/** BASE with the player `dx` tiles east of its start, `tick` ticks on. */
const eastBy = (dx: number, tick = dx) => ({
    ...world(BASE.build())
        .player({ at: { x: LX + dx, z: LZ } })
        .build(),
    tick,
});
const settles = (r: { events: Record<string, unknown>[] }) => r.events.filter(e => e.type === 'settle');
/** A phase done at once that changes nothing, chosen while the bot stands where it started. */
const goPhase = (opts: PhaseOptions = {}) =>
    phase(scripted('go', [{ done: 'went' }]), {}, { when: v => v.x === LX, ...opts });
/** A one-phase plan whose phase is done at once and changes nothing. */
const stay = (until: Predicate) =>
    definePlan({ name: 'test-plan', phases: [phase(scripted('stay', [{ done: 'stayed' }]), {})], until });

describe('the settle after a phase run', () => {
    test('the next selection sees the state published after the run: a phase gated on it is chosen', async () => {
        const there = phase(scripted('there', [{ done: 'arrived' }]), {}, { when: v => v.x === LX + 1 });
        const r = await settling(
            definePlan({ name: 'test-plan', phases: [goPhase(), there], until: v => v.runs('there') >= 1 }),
            [eastBy(1), eastBy(1, 2)],
        );
        expect(r.selected).toEqual(['go', 'there']);
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        // Only go's settle read more than one state; there's read one, unchanged.
        expect(settles(r)).toEqual([{ type: 'settle', phase: 'go', reads: 2, changed: true }]);
    });

    test('a state that keeps changing ends the settle at PHASE_SETTLE_READS reads', async () => {
        const xs: number[] = [];
        const probe = phase(scripted('probe', [{ done: 'x' }]), {}, { when: v => (xs.push(v.x), false) });
        const once = phase(scripted('go', [{ done: 'went' }]), {}, { when: v => v.runs('go') < 1 });
        const r = await settling(
            definePlan({ name: 'test-plan', phases: [once, probe] }),
            [1, 2, 3, 4, 5, 6, 7].map(dx => eastBy(dx)),
        );
        expect(r.reads).toBe(PHASE_SETTLE_READS);
        expect(xs).toEqual([LX + PHASE_SETTLE_READS]);
        expect(settles(r)).toEqual([{ type: 'settle', phase: 'go', reads: PHASE_SETTLE_READS, changed: true }]);
        expect(r.result.reason).toStartWith('no phase applies');
    });

    test('a run whose settled state differs from its start is not idle; one whose settled state equals it is', async () => {
        // Each run ends where it started, and only the settle sees it moved.
        const moved = await settling(
            stay(v => v.runs('stay') >= 3),
            [1, 1, 2, 2, 3, 3].map((dx, i) => eastBy(dx, i + 1)),
        );
        expect(moved.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        // Back where it started once the settle ends: idle, so the instant repeat ends the plan.
        const back = await settling(
            stay(() => false),
            [eastBy(1), { ...BASE.build(), tick: 2 }, { ...BASE.build(), tick: 3 }],
        );
        expect(back.selected).toEqual(['stay', 'stay']);
        expect(back.result.reason).toStartWith('nothing left to do: stay done');
        expect(settles(back)).toEqual([{ type: 'settle', phase: 'stay', reads: 3, changed: false }]);
    });

    test('settle false on the plan or the phase skips it, and without nextTick there is none', async () => {
        const plans = [
            definePlan({ name: 'test-plan', phases: [goPhase()], settle: false }),
            definePlan({ name: 'test-plan', phases: [goPhase({ settle: false })] }),
        ];
        for (const def of plans) {
            const r = await settling(def, [eastBy(1)]);
            // Unsettled, the second selection still sees the start, and go repeats in place: only the end-of-plan settle reads.
            expect(r.selected).toEqual(['go', 'go']);
            expect(r.reads).toBe(PLAN_SETTLE_TICKS);
            expect(settles(r)).toEqual([]);
        }
        const none = await settling(definePlan({ name: 'test-plan', phases: [goPhase()] }), [eastBy(1)], {
            nextTick: false,
        });
        expect(none.selected).toEqual(['go', 'go']);
        expect(none.result.reason).toStartWith('nothing left to do');
        // A phase's own settle wins over the plan's.
        const there = phase(scripted('there', [{ done: 'arrived' }]), {}, { when: v => v.x === LX + 1 });
        const own = await settling(
            definePlan({
                name: 'test-plan',
                phases: [goPhase({ settle: true }), there],
                settle: false,
                until: v => v.runs('there') >= 1,
            }),
            [eastBy(1)],
        );
        expect(own.selected).toEqual(['go', 'there']);
    });

    test('a nextTick that throws ends the settle with the last state read, and the plan goes on', async () => {
        const there = phase(scripted('there', [{ done: 'arrived' }]), {}, { when: v => v.x === LX + 1 });
        const def = definePlan({ name: 'test-plan', phases: [goPhase(), there], until: v => v.runs('there') >= 1 });
        const r = await settling(def, [eastBy(1), new Error('client stopped publishing')]);
        expect(r.selected).toEqual(['go', 'there']);
        expect(r.result.status).toBe('done');
        expect(settles(r)[0]).toEqual({ type: 'settle', phase: 'go', reads: 1, changed: true });
        // Thrown at the first read: the run's own end state stands, and nothing changed to log.
        const stalled = await settling(
            definePlan({ name: 'test-plan', phases: [goPhase()], until: v => v.runs('go') >= 1 }),
            [new Error('client stopped publishing')],
        );
        expect(stalled.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(settles(stalled)).toEqual([]);
    });

    test('a minutes stop that comes true on a settle read ends the plan done before another phase starts', async () => {
        const r = await settling(
            stay(() => false),
            [{ ...BASE.build(), tick: 60_000 / TICK_MS }],
            { stops: [{ kind: 'minutes', minutes: 1 }] },
        );
        expect(r.result).toMatchObject({ status: 'done', reason: 'reached 1 min' });
        expect(r.events.filter(e => e.type === 'phase-start')).toHaveLength(1);
        expect(r.result.recent.map(x => x.reason)).toEqual(['try: stayed']);
    });

    test('a respawn a settle read shows ends the plan failed: died between phases', async () => {
        const base = BASE.build();
        const r = await settling(
            stay(() => false),
            [{ ...base, tick: 1, player: { ...base.player!, respawnCount: 1 } }],
        );
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'died between phases (1 respawn since the plan started); last: stay done: try: stayed',
        });
        expect(r.events.filter(e => e.type === 'phase-start')).toHaveLength(1);
    });
});

/** What `f` reads off the view at the plan's first selection; the plan then ends, no phase applying. */
async function look<T>(state: BotWorldState, f: (v: PlanView) => T): Promise<T> {
    const seen: T[] = [];
    await sim(plan([phase(train, {}, { when: v => (seen.push(f(v)), false) })]), { timeline: [state] });
    if (seen.length !== 1) throw new Error(`look: ${seen.length} selections`);
    return seen[0]!;
}
/** The message `f` throws, or null. */
const thrown = (f: () => unknown): string | null => {
    try {
        f();
        return null;
    } catch (e) {
        return (e as Error).message;
    }
};
const NO_PLAYER: BotWorldState = { ...BASE.build(), player: null };
const { x: LX, z: LZ } = LUMBRIDGE;
const whereAndLevel = (v: PlanView) => [v.x, v.z, v.floor, v.combatLevel];
const questsStarted = (v: PlanView) => [v.questStarted('imp'), v.questStarted('cook'), v.questStarted('doric')];

describe('the view', () => {
    test("v.last carries the previous run's code and endedBy", async () => {
        const coded = {
            ...scripted('primary', [{ fail: 'busy', code: 'busy' }]),
            outcomes: { busy: 'The thing is busy.' },
        };
        const seen: PlanView['last'][] = [];
        const r = await sim(
            plan(
                [
                    phase(train, {}, { when: v => (seen.push(v.last), v.last?.code === 'busy') }),
                    phase(coded, {}, { onFail: 'continue', when: v => v.last?.endedBy !== 'try' }),
                ],
                v => v.runs('train') >= 1,
            ),
        );
        expect(selected(r)).toEqual(['primary', 'train']);
        expect(seen).toEqual([
            null,
            { phase: 'primary', status: 'failed', reason: 'try: busy', code: 'busy', endedBy: 'try' },
        ]);
        expect(r.runs[0]!.result.code).toBe('busy');
    });

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

    test('v.bank sums the slots that share a name', async () => {
        const timeline = BASE.series(8, (w, i) =>
            i === 2 || i === 3
                ? w.bank([
                      { name: 'Herb', count: 6, id: 199 },
                      { name: 'Herb', count: 10, id: 201 },
                      { name: 'Herb', count: 10, id: 203 },
                  ])
                : w,
        );
        const seen: (number | undefined)[] = [];
        await sim(
            plan(
                [
                    phase(train, {}, { when: v => (seen.push(v.bank('Herb')), v.bank('Herb') === 26) }),
                    phase(watch, {}, { until: v => v.state.tick >= 6 }),
                ],
                v => v.runs('train') > 0,
            ),
            { timeline },
        );
        expect(seen).toEqual([undefined, 26]);
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
            [1, { phase: 'train', status: 'done', reason: 'train: trained', endedBy: 'train' }],
        ]);
    });

    test('x, z, floor and combatLevel read the player; 0 in a state with no player', async () => {
        const at = BASE.player({ at: { x: LX + 5, z: LZ - 2, level: 1 }, combatLevel: 40 }).build();
        expect(await look(at, whereAndLevel)).toEqual([LX + 5, LZ - 2, 1, 40]);
        expect(await look(NO_PLAYER, whereAndLevel)).toEqual([0, 0, 0, 0]);
    });

    test('within counts Chebyshev tiles to radius, else tolerance, else the exact tile, and checks a given level', async () => {
        const seen = await look(BASE.build(), v => ({
            radius: [
                v.within({ x: LX + 3, z: LZ + 3, radius: 3 }),
                v.within({ x: LX + 3, z: LZ, radius: 2 }),
                v.within({ x: LX + 1, z: LZ, radius: 0, tolerance: 5 }),
            ],
            tolerance: [v.within({ x: LX - 2, z: LZ, tolerance: 2 }), v.within({ x: LX, z: LZ - 2, tolerance: 1 })],
            exact: [v.within({ x: LX, z: LZ }), v.within({ x: LX + 1, z: LZ })],
            level: [v.within({ x: LX, z: LZ, radius: 5, level: 0 }), v.within({ x: LX, z: LZ, radius: 5, level: 1 })],
        }));
        expect(seen).toEqual({
            radius: [true, false, false],
            tolerance: [true, false],
            exact: [true, false],
            level: [true, false],
        });
        expect(await look(NO_PLAYER, v => v.within({ x: 0, z: 0, radius: 10_000 }))).toBe(false);
    });

    test('held counts the pack and what is worn, worn only what is worn; coins counts the pack', async () => {
        const state = BASE.inv('Bronze sword').inv('Coins', 250).equipment({ name: 'Bronze sword' }).build();
        const seen = await look(state, v => [
            v.held('bronze sword'),
            v.worn('Bronze sword'),
            v.held(/^bronze/i),
            v.held('Bones'),
            v.worn('Bones'),
            v.coins,
        ]);
        expect(seen).toEqual([2, 1, 2, 24, 0, 250]);
        expect(await look(BASE.build(), v => v.coins)).toBe(0);
    });

    test('npcs, locs and ground count by exact name or pattern, within a distance when given', async () => {
        const state = BASE.npc('Cow', LX + 2, LZ)
            .npc('Cow', LX, LZ + 6)
            .npc('Cow calf', LX + 1, LZ)
            .loc('Tree', LX + 1, LZ)
            .loc('Tree', LX - 5, LZ)
            .ground('Bones', LX, LZ, 3)
            .ground('Bones', LX + 4, LZ)
            .build();
        const seen = await look(state, v => ({
            npcs: [v.npcs('cow'), v.npcs('Cow', 2), v.npcs(/^cow/i), v.npcs(/^cow/i, 1)],
            locs: [v.locs('tree'), v.locs('Tree', 4), v.locs('Oak')],
            ground: [v.ground('bones'), v.ground('Bones', 0)],
        }));
        expect(seen).toEqual({ npcs: [2, 1, 3, 1], locs: [2, 1, 0], ground: [2, 1] });
    });

    test('a global regex reads the same on every call, for said and for a pattern member', async () => {
        const state = BASE.message('You catch a shrimp.')
            .npc('Cow', LX + 1, LZ)
            .build();
        const seen = await look(state, v => {
            const said = /shrimp/g;
            const npcs = /^cow$/gi;
            const inv = /^bones$/giy;
            return [1, 2, 3].map(() => [v.said(said), v.npcs(npcs), v.inv(inv)]);
        });
        expect(seen).toEqual([1, 2, 3].map(() => [true, 1, 24]));
    });

    test('said matches a dialog line, a page across its lines, the open dialog and game messages, not player chat', async () => {
        const state = BASE.recentDialog(['Hello there.', 'I need some'])
            .recentDialog(['flour please.'])
            .recentDialog(['Bring me an egg', 'and a pot of flour.'])
            .message('You catch a shrimp.')
            .message('the secret word', 2)
            .dialog({ text: 'Select an option' })
            .build();
        const seen = await look(state, v => [
            v.said(/^hello there\.$/i),
            v.said(/an egg and a pot/),
            v.said(/some flour/),
            v.said(/catch a shrimp/),
            v.said(/secret word/),
            v.said(/select an option/i),
        ]);
        // A pattern joins the lines of one page, not two pages.
        expect(seen).toEqual([true, true, false, true, false, true]);
    });

    test('said with sinceTicks leaves out pages and messages older than that', async () => {
        const state = BASE.tick(10)
            .recentDialog(['Old page'])
            .message('Old message')
            .tick(20)
            .recentDialog(['New page'])
            .message('New message')
            .build();
        const seen = await look(state, v => [
            v.said(/Old page/),
            v.said(/Old page/, 5),
            v.said(/Old message/, 5),
            v.said(/Old message/, 10),
            v.said(/New page/, 5),
            v.said(/New message/, 0),
        ]);
        expect(seen).toEqual([true, false, false, true, true, true]);
    });

    test('lastDone and lastFailed read the previous run, by any phase or one of those named', async () => {
        const stall = defineTask({ ...watch, name: 'stall', stuckAfterMs: 2000 });
        const seen: boolean[][] = [];
        // The first phase's `when` is asked once a selection; each phase runs once, then none applies.
        const r = await sim(
            plan([
                phase(
                    train,
                    {},
                    {
                        when: v => {
                            seen.push([
                                v.lastDone(),
                                v.lastDone('train'),
                                v.lastDone('broke', 'stall'),
                                v.lastFailed(),
                                v.lastFailed('broke'),
                                v.lastFailed('train', 'stall'),
                            ]);
                            return v.runs('train') === 0;
                        },
                    },
                ),
                phase(failing('broke'), {}, { when: v => v.runs('broke') === 0, onFail: 'continue' }),
                phase(stall, {}, { when: v => v.runs('stall') === 0, onFail: 'continue' }),
            ]),
        );
        expect(selected(r)).toEqual(['train', 'broke', 'stall', null]);
        expect(seen).toEqual([
            [false, false, false, false, false, false],
            [true, true, false, false, false, false],
            [false, false, false, true, true, false],
            [false, false, false, true, false, true],
        ]);
    });

    test('lastDone and lastFailed throw on a name the plan has no phase for, before any run as after', async () => {
        const seen = await look(BASE.build(), v => [
            thrown(() => v.lastDone('nope')),
            thrown(() => v.lastFailed('nope')),
        ]);
        expect(seen).toEqual(['no phase "nope" in plan "test-plan"', 'no phase "nope" in plan "test-plan"']);
    });

    test('questStarted holds for a yellow quest only; throws on an unknown id', async () => {
        const quests = BASE.quests({ imp: 'started', cook: 'done' }).build();
        expect(await look(quests, questsStarted)).toEqual([true, false, false]);
        expect(await look(BASE.build(), v => thrown(() => v.questStarted('nope')))).toBe(
            'unknown quest "nope"; see QUESTS in lib/quests.ts',
        );
    });

    test("the select event's reads record each new call and scalar", async () => {
        const r = await sim(
            plan([
                phase(
                    train,
                    {},
                    {
                        when: v =>
                            [
                                v.x,
                                v.z,
                                v.floor,
                                v.combatLevel,
                                v.coins,
                                v.within({ x: LX, z: LZ, radius: 2 }),
                                v.held('Bones'),
                                v.worn('Bones'),
                            ].length < 0,
                    },
                ),
                phase(
                    scripted('other', [{ done: 'ok' }]),
                    {},
                    {
                        when: v =>
                            [
                                v.npcs('Cow', 3),
                                v.locs(/tree/i),
                                v.ground('Bones'),
                                v.said(/hello/),
                                v.lastDone(),
                                v.lastFailed('train'),
                                v.questStarted('imp'),
                            ].length < 0,
                    },
                ),
            ]),
        );
        expect(r.events.find(e => e.type === 'select')?.reads).toEqual({
            train: {
                x: LX,
                z: LZ,
                floor: 0,
                combatLevel: 3,
                coins: 0,
                'within({"x":3222,"z":3218,"radius":2})': true,
                "held('Bones')": 24,
                "worn('Bones')": 0,
            },
            other: {
                "npcs('Cow', 3)": 0,
                'locs(/tree/i)': 0,
                "ground('Bones')": 0,
                'said(/hello/)': false,
                'lastDone()': false,
                "lastFailed('train')": false,
                "questStarted('imp')": false,
            },
        });
    });
});

describe('requires builders', () => {
    test('combatAtLeast and levelAtLeast make one named entry each', () => {
        expect(Object.keys({ ...combatAtLeast(5), ...levelAtLeast('woodcutting', 10) })).toEqual([
            'combat level 5+',
            'Woodcutting 10+',
        ]);
    });

    test('a plan short of one fails naming it; one that meets both runs', async () => {
        const short = await sim(needs({ ...combatAtLeast(4) }));
        expect(short.result).toMatchObject({ status: 'failed', reason: 'plan requires combat level 4+' });
        const low = await sim(needs({ ...combatAtLeast(3), ...levelAtLeast('Woodcutting', 2) }));
        expect(low.result).toMatchObject({ status: 'failed', reason: 'plan requires Woodcutting 2+' });
        const met = await sim(
            needs({ ...combatAtLeast(3), ...levelAtLeast('woodcutting', 1) }, v => v.runs('train') > 0),
        );
        expect(met.result.status).toBe('done');
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

const RUNE = journalTitle(QUESTS.runemysteries!);

/** `plant`, and a 'read journal' send showing the journal for one tick with the next of `pages` (the last repeating). */
function journalPages(pages: string[][]) {
    let read = 0;
    return (action: BotAction): Effect | undefined => {
        if (action.reason !== 'read journal') return plant(action);
        const lines = pages[Math.min(read++, pages.length - 1)]!;
        let shown = false;
        return s => (shown ? s : ((shown = true), withJournal(s, RUNE, lines)));
    };
}

/** An `observes` task that opens the journal and ends done once it shows. */
const peek = defineTask({
    name: 'peek',
    description: 'plan test journal read',
    params: z.object({}),
    observes: true,
    // It opens the journal on purpose.
    allow: ['interface'],
    steps: [
        {
            name: 'read',
            when: () => true,
            *run() {
                yield* send(act('read journal'));
                const w = yield* wait('the journal', s => journalOf(s) !== null, 5);
                return w.kind === 'timeout' ? { fail: 'no journal' } : { done: 'read' };
            },
        },
    ],
});

/** Idle phases a and b in turn, with a journal read (peek) after each, the journal showing `pages` in turn. */
const idleWithReads = (pages: string[][]) =>
    sim(
        plan(
            [
                phase(peek, {}, { when: v => v.runs('peek') < v.runs('a') + v.runs('b') }),
                phase(
                    scripted('noop', [{ done: 'nothing to do' }]),
                    {},
                    { name: 'a', when: v => v.last?.phase !== 'a' },
                ),
                phase(scripted('noop', [{ done: 'nothing to do' }]), {}, { name: 'b' }),
            ],
            v => v.runs('a') + v.runs('b') >= 5,
        ),
        { react: journalPages(pages) },
    );

const journalEvents = (r: PlanSimulation) => r.events.filter(e => e.type === 'journal');

describe('the journal memory and observes tasks', () => {
    test("v.journalSays follows the quest's text as last seen in a phase run, joined across wrapped lines", async () => {
        const pages = [
            ['I need to find', 'the head wizard.'],
            ['Sedridor wants me to take', 'the talisman.'],
        ];
        /** What each selection read: the first phase's `when` is asked at every one. */
        const atSelection: unknown[] = [];
        const inTrain: unknown[] = [];
        const peekWhen = (v: PlanView) => {
            atSelection.push([v.journalSays('runemysteries', /find the head/), journalOf(v.state)]);
            return v.runs('peek') <= v.runs('train') && v.runs('peek') < 2;
        };
        const r = await sim(
            plan(
                [
                    phase(peek, {}, { when: peekWhen }),
                    phase(
                        train,
                        {},
                        {
                            when: v => (
                                inTrain.push([
                                    v.journalSays('runemysteries', /find the head/),
                                    v.journalSays('runemysteries', /talisman/g),
                                    v.journalSays('runemysteries', /talisman/g),
                                ]),
                                true
                            ),
                        },
                    ),
                ],
                v => v.runs('train') >= 2,
            ),
            { react: journalPages(pages) },
        );
        expect(selected(r)).toEqual(['peek', 'train', 'peek', 'train']);
        // The journal shows only during peek's runs: no selection reads it open.
        expect(atSelection).toEqual([
            [undefined, null],
            [true, null],
            [true, null],
            [false, null],
        ]);
        expect(inTrain).toEqual([
            [true, false, false],
            [false, true, true],
        ]);
        expect(r.result.status).toBe('done');
    });

    test("a journal seen only in a state the phase's driver read reaches the memory", async () => {
        // The phase's until ends it at tick 3, in a fight; the engine waits the fight out through the phase's driver
        // alone (no external stop), and the journal shows at tick 6 of that wait only.
        const timeline = BASE.series(20, (w, i) =>
            i >= 3 && i < 9 ? w.player({ inCombat: true, lastDamageTick: i }) : w,
        ).map((s, i) => (i === 6 ? withJournal(s, RUNE, ['seen in the fight']) : s));
        const seen: unknown[] = [];
        const r = await sim(
            plan(
                [
                    phase(watch, {}, { when: v => v.runs('watch') < 1, until: v => v.state.tick >= 3 }),
                    phase(train, {}, { when: v => (seen.push(v.journalSays('runemysteries', /in the fight/)), true) }),
                ],
                v => v.runs('train') >= 1,
            ),
            { timeline },
        );
        expect(stoppedAt(r)).toBe(3);
        expect(settledAt(r)).toBe(9);
        expect(seen).toEqual([true]);
    });

    test('an unknown quest id throws, as v.quest does', async () => {
        const ids = await look(BASE.build(), v => [
            thrown(() => v.journalSays('nope', /x/)),
            thrown(() => v.journalAge('nope')),
            v.journalSays('runemysteries', /x/),
            v.journalAge('runemysteries'),
        ]);
        const unknown = 'unknown quest "nope"; see QUESTS in lib/quests.ts';
        expect(ids).toEqual([unknown, unknown, undefined, undefined]);
    });

    test('v.journalAge is 0 after a read, rises by one per acting run and not for an observes run', async () => {
        const ages: unknown[] = [];
        const r = await sim(
            plan(
                [
                    // Asked first at every selection, so it records the age each one reads.
                    phase(peek, {}, { when: v => (ages.push(v.journalAge('runemysteries')), ages.length === 1) }),
                    phase(glance, {}, { when: v => v.runs('glance') <= v.runs('train') }),
                    phase(train, {}),
                ],
                v => v.runs('train') >= 2,
            ),
            { react: journalPages([['a line']]) },
        );
        expect(selected(r)).toEqual(['peek', 'glance', 'train', 'glance', 'train']);
        expect(ages).toEqual([undefined, 0, 0, 1, 1]);
    });

    test("after an observes run v.last is the acting run before it, whose 'continue' skip still applies", async () => {
        const lasts: unknown[] = [];
        const r = await sim(
            plan(
                [
                    phase(busy(), {}, { onFail: 'continue' }),
                    phase(glance, {}, { when: v => v.runs('glance') < v.runs('primary') }),
                    phase(train, {}, { when: v => (lasts.push([v.last, v.lastFailed('primary')]), true) }),
                ],
                v => v.runs('train') >= 1,
            ),
        );
        expect(selected(r)).toEqual(['primary', 'glance', 'train']);
        const checks = r.events.filter(e => e.type === 'select').map(e => (e.checks as Record<string, string>).primary);
        expect(checks).toEqual(['chosen', 'skipped: failed last', 'skipped: failed last']);
        expect(lasts).toEqual([[{ phase: 'primary', status: 'failed', reason: 'try: busy', endedBy: 'try' }, true]]);
        // The result's lastStep is the last phase run of any task.
        expect(r.result.lastStep).toBe('train');
    });

    test('an observes run that saw the journal text change clears the idle run', async () => {
        const moving = await idleWithReads([['one'], ['two'], ['three'], ['four'], ['five']]);
        expect(selected(moving)).toEqual(['a', 'peek', 'b', 'peek', 'a', 'peek', 'b', 'peek', 'a']);
        expect(moving.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        // The same text each time: no progress, and the rail ends the plan as without the reads.
        const still = await idleWithReads([['one']]);
        expect(selected(still)).toEqual(['a', 'peek', 'b', 'peek', 'a']);
        expect(still.result.reason).toBe('nothing left to do: a, b done (try: nothing to do); plan until not met');
    });

    test('an observes phase whose when never goes false ends the plan failed after maxIdlePhases runs', async () => {
        const r = await sim(plan([phase(glance, {})]));
        expect(selected(r)).toEqual(['glance', 'glance', 'glance']);
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'glance looked 3 times in a row with no acting run between',
        });
        const longer = await sim(plan([phase(glance, {})]), { maxIdlePhases: 5 });
        expect(selected(longer)).toHaveLength(5);
    });

    test('alternating observes phases are counted together', async () => {
        const stare = { ...scripted('stare', [{ done: 'looked' }]), observes: true as const };
        const r = await sim(
            plan([phase(glance, {}, { when: v => v.runs('glance') <= v.runs('stare') }), phase(stare, {})]),
        );
        expect(selected(r)).toEqual(['glance', 'stare', 'glance']);
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'looked 3 times in a row across glance, stare with no acting run between',
        });
    });

    test('an acting run between observes runs resets their count', async () => {
        const r = await sim(
            plan([phase(glance, {}, { when: v => v.runs('glance') < 2 || v.runs('train') >= 1 }), phase(train, {})]),
        );
        expect(selected(r)).toEqual(['glance', 'glance', 'train', 'glance', 'glance', 'glance']);
        expect(r.result.reason).toBe('glance looked 3 times in a row with no acting run between');
    });

    test('the journal event is logged on the first sight and on a change only', async () => {
        const r = await sim(
            plan([phase(peek, {}), phase(train, {})], v => v.runs('peek') >= 3),
            { react: journalPages([['one'], ['one'], ['two']]) },
        );
        expect(selected(r)).toEqual(['peek', 'peek', 'peek']);
        expect(journalEvents(r)).toEqual([
            { type: 'journal', quest: 'runemysteries', text: 'one', changed: false },
            { type: 'journal', quest: 'runemysteries', text: 'two', changed: true },
        ]);
    });
});

describe('runPlan: a phase run that holds its dialog', () => {
    /** Ends done at once, holding the open dialog for the next phase (as combat's stopOnDialog does). */
    const holder = defineTask({
        name: 'holder',
        description: 'plan test: ends holding its dialog',
        params: z.object({}),
        // The dialog is open from the first state: the dialog guard would answer it before the step.
        allow: ['dialog'],
        holdsDialog: (_p, s) => s.dialog.isOpen,
        steps: [{ name: 'stop', when: () => true, run: () => ({ done: 'dialog opened' }) }],
    });
    /** Answers a dialog: it allows the dialog guard, so its start leaves the dialog open. */
    const answer = { ...scripted('answer', [{ done: 'answered' }]), allow: ['dialog'] as const };
    const choiceOpen = [BASE.dialog({ options: ['Yes', 'No'] }).build()];

    test('a plan ending on it says so, and nothing between the run and the end acts on the bot', async () => {
        const r = await sim(
            plan([phase(holder, {})], v => v.last?.phase === 'holder'),
            { timeline: choiceOpen },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.holdsDialog).toBe(true);
        expect(r.driver.commands.filter(c => c.type === 'send')).toEqual([]);
        expect(r.driver.state().dialog.isOpen).toBe(true);
    });

    test('the next phase starts with the dialog still open, and a plan ending after it holds nothing', async () => {
        const r = await sim(
            plan(
                [phase(holder, {}, { when: v => v.last === null }), phase(answer, {})],
                v => v.last?.phase === 'answer',
            ),
            { timeline: choiceOpen },
        );
        expect(r.runs.map(x => x.phase)).toEqual(['holder', 'answer']);
        expect(r.runs[0]!.result.holdsDialog).toBe(true);
        expect(r.runs[1]!.events.find(e => e.type === 'step')?.step).toBe('try');
        expect(r.driver.commands.filter(c => c.type === 'send')).toEqual([]);
        expect('holdsDialog' in r.result).toBe(false);
    });

    test('a plan ending non-done after a holding run has no holdsDialog key, so the epilogue runs', async () => {
        const r = await sim(plan([phase(holder, {}, { when: v => v.last === null }), phase(failing('bad'), {})]), {
            timeline: choiceOpen,
        });
        expect(r.runs[0]!.result.holdsDialog).toBe(true);
        expect(r.result.status).not.toBe('done');
        expect('holdsDialog' in r.result).toBe(false);
    });

    test('a kill after a holding run has no holdsDialog key', async () => {
        let killed: PlanResult | null = null;
        await sim(
            plan([phase(holder, {})], v => v.last?.phase === 'holder'),
            {
                timeline: choiceOpen,
                onKillable: kill => {
                    killed = kill('killed by SIGINT');
                },
            },
        );
        expect(killed).not.toBeNull();
        expect('holdsDialog' in killed!).toBe(false);
    });
});
