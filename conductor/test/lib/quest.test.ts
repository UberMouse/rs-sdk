import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { resolveComponent } from '../../actions/press';
import type { Effect } from '../../core/drivers/timeline';
import { send, ticks, wait } from '../../core/op';
import { invalidParams, type PlanDef, type PlanView } from '../../lib/plan';
import { lintPlan } from '../../lib/plan-lint';
import {
    cursor,
    defineQuest,
    journal,
    needsRead,
    QUEST_DEFAULTS,
    type QuestDef,
    type QuestStep,
    step,
} from '../../lib/quest';
import { QUEST_TAB_REQUIRED, type QuestProgress } from '../../lib/quests';
import { defineTask } from '../../lib/task';
import { act } from '../core/fixtures';
import { withQuestJournal } from '../journal';
import { type PlanSimulation, simulatePlan } from '../simulate';
import { world } from '../world';

const ID = 'cook';
const ENTRY = resolveComponent(`questlist:${ID}`)!.componentId;
const SKILL = 'Woodcutting';
const xpOf = (s: BotWorldState) => s.skills.find(k => k.name === SKILL)?.experience ?? 0;

/**
 * Does `what`: a send the story answers with a point of XP, done once it shows, failed when it does not. A quiet
 * deed ends done a tick after its send whatever the story did. It leaves a dialog the story opened to the plan.
 */
const deed = defineTask({
    name: 'deed',
    description: 'quest test story action',
    params: z.object({ what: z.string(), quiet: z.boolean().default(false) }),
    allow: ['dialog'],
    steps: [
        {
            name: 'deed',
            when: () => true,
            *run(ctx) {
                const { what, quiet } = ctx.params;
                const before = xpOf(ctx.state());
                yield* send(act(quiet ? `quiet ${what}` : what));
                if (quiet) {
                    yield* ticks(1);
                    return { done: what };
                }
                const w = yield* wait('xp', s => xpOf(s) > before, 3);
                return w.kind === 'met' ? { done: what } : { fail: `${what}: nothing happened` };
            },
        },
    ],
});

interface Story {
    progress: QuestProgress;
    items: Record<string, number>;
    lines: string[];
    dialog: boolean;
    xp: number;
    /** Sends of that deed the story refuses (no effect, no XP) before it answers. */
    refuse: Record<string, number>;
}

/**
 * A story world: each deed's effect changes the story, which one effect renders onto every state (quest tab,
 * held items, XP, dialog, journal). A non-quiet deed with an effect gains a point of XP. A click on the quest's
 * entry shows its journal two ticks later; a close shuts it two ticks later, as the journal task's tests measure it.
 */
function storyWorld(init: Partial<Story>, effects: Record<string, (st: Story) => void>) {
    const st: Story = {
        progress: 'none',
        items: {},
        lines: ['Talk to the cook.'],
        dialog: false,
        xp: 0,
        refuse: {},
        ...init,
    };
    let openAt: number | null = null;
    let closeAt: number | null = null;
    const render: Effect = s => {
        let w = world(s)
            .quests(st.progress === 'none' ? {} : { [ID]: st.progress })
            .skill(SKILL, 1, st.xp)
            .dialog(st.dialog && { text: 'Well?' })
            .modal(false);
        for (const [item, n] of Object.entries(st.items)) w = w.inv(item, n);
        const open = openAt !== null && s.tick >= openAt && (closeAt === null || s.tick < closeAt);
        return open ? withQuestJournal(w.build(), ID, st.lines) : w.build();
    };
    let installed = false;
    const react = (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'clickComponent' && action.componentId === ENTRY) {
            openAt = state.tick + 2;
            closeAt = null;
        } else if (action.type === 'closeModal') {
            if (openAt !== null && closeAt === null) closeAt = state.tick + 2;
        } else if (action.type === 'none') {
            st.dialog = false;
            const quiet = action.reason.startsWith('quiet ');
            const what = quiet ? action.reason.slice('quiet '.length) : action.reason;
            if ((st.refuse[what] ?? 0) > 0) st.refuse[what]!--;
            else if (effects[what]) {
                effects[what](st);
                if (!quiet) st.xp++;
            }
        }
        if (installed) return undefined;
        installed = true;
        return render;
    };
    return { st, react, timeline: [render(world().player({ hp: 10 }).build())] };
}

const quest = (steps: QuestStep[], more: Partial<QuestDef> = {}) =>
    defineQuest({ id: ID, name: 'test-quest', steps, ...more });

const run = (def: PlanDef, w: ReturnType<typeof storyWorld>) =>
    simulatePlan(def, { timeline: w.timeline, react: w.react });

/** The acting and reading phase runs, in order, each with its status when it did not end done. */
const ran = (r: PlanSimulation) =>
    r.runs.map(x => (x.result.status === 'done' ? x.phase : `${x.phase} ${x.result.status}`));

const finish = step('finish', deed, { what: 'finish' });
const FINISH = { finish: (st: Story) => void (st.progress = 'done') };

describe('defineQuest: a quest without journal marks', () => {
    const steps = [
        step('pot', deed, { what: 'pot' }, { done: v => v.held('Pot') > 0 }),
        step('start', deed, { what: 'start' }, { reached: v => v.quest(ID) !== 'none' }),
        step('chat', deed, { what: 'chat' }),
        finish,
    ];
    const effects = {
        pot: (st: Story) => void (st.items.Pot = 1),
        start: (st: Story) => void (st.progress = 'started'),
        chat: () => {},
        ...FINISH,
    };

    test('runs its steps in story order from a fresh state, with no journal phase and no read', async () => {
        const def = quest(steps);
        expect(def.phases.map(p => p.name)).toEqual(['pot', 'start', 'chat', 'finish']);
        const r = await run(def, storyWorld({}, effects));
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(ran(r)).toEqual(['pot', 'start', 'chat', 'finish']);
    });

    test('a throw from a step predicate names the step and the predicate, and ends the plan in error', async () => {
        const boom = quest([
            steps[0]!,
            steps[1]!,
            step(
                'chat',
                deed,
                { what: 'chat' },
                {
                    done: () => {
                        throw new Error('bad');
                    },
                },
            ),
            finish,
        ]);
        const r = await run(boom, storyWorld({}, effects));
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('step "chat" done threw: bad');
    });

    test('a step whose until holds is passed: from the start, and once its run made it true', async () => {
        const untilStep = step('pot', deed, { what: 'pot' }, { until: potHeld });
        const fresh = await run(quest([untilStep, finish]), storyWorld({ items: { Pot: 1 } }, effects));
        expect(fresh.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(ran(fresh)).toEqual(['finish']);
        const during = await run(quest([untilStep, finish]), storyWorld({}, effects));
        expect(during.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(ran(during)).toEqual(['pot', 'finish']);
    });

    test('starts after the last step whose reached holds', async () => {
        const r = await run(quest(steps), storyWorld({ progress: 'started' }, effects));
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['chat', 'finish']);
    });

    test('steps over a done step, and runs it again when its evidence goes away', async () => {
        let deliveries = 0;
        const def = quest([
            step('fetch', deed, { what: 'fetch' }, { done: v => v.held('Pot') + v.held('Bucket') > 0 }),
            step('fill', deed, { what: 'fill' }, { done: v => v.held('Bucket') > 0 }),
            step('deliver', deed, { what: 'deliver' }, { reached: v => v.questStarted(ID) }),
            finish,
        ]);
        const w = storyWorld(
            { items: { Pot: 1 } },
            {
                fetch: st => void (st.items.Pot = 1),
                fill: st => void ((st.items.Pot = 0), (st.items.Bucket = 1)),
                // The first delivery loses the bucket.
                deliver: st => {
                    st.items.Bucket = 0;
                    if (deliveries++ > 0) st.progress = 'started';
                },
                ...FINISH,
            },
        );
        const r = await run(def, w);
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['fill', 'deliver', 'fetch', 'fill', 'deliver', 'finish']);
    });

    test('a step with no evidence runs once, and again after a restart', async () => {
        const def = quest([step('chat', deed, { what: 'chat' }), finish]);
        const w = storyWorld({ refuse: { finish: 3 } }, { chat: () => {}, ...FINISH });
        const first = await run(def, w);
        // The quest default retries the failed finish, up to 3 times in a row.
        expect(first.result).toMatchObject({
            status: 'failed',
            reason: 'finish failed 3 times in a row: deed: finish: nothing happened',
        });
        expect(ran(first)).toEqual(['chat', 'finish failed', 'finish failed', 'finish failed']);
        // A new runPlan on the same world: the plan has no record of the chat, so it runs again.
        const again = await simulatePlan(def, { driver: first.driver });
        expect(again.result.status).toBe('done');
        expect(ran(again)).toEqual(['chat', 'finish']);
    });

    test('skip passes a step', async () => {
        const def = quest([
            step('gate', deed, { what: 'gate' }, { skip: v => v.held('Bucket') > 0 }),
            step('chat', deed, { what: 'chat' }, { done: v => v.questStarted(ID) }),
            finish,
        ]);
        const story = { gate: () => {}, chat: (st: Story) => void (st.progress = 'started'), ...FINISH };
        expect(ran(await run(def, storyWorld({ items: { Bucket: 1 } }, story)))).toEqual(['chat', 'finish']);
        expect(ran(await run(def, storyWorld({}, story)))).toEqual(['gate', 'chat', 'finish']);
    });

    test("a step's own onFail overrides the quest default", async () => {
        const def = quest([step('chat', deed, { what: 'chat' }, { onFail: 'fail' }), finish]);
        const r = await run(def, storyWorld({ refuse: { chat: 1 } }, { chat: () => {}, ...FINISH }));
        expect(r.result).toMatchObject({ status: 'failed', reason: 'chat: deed: chat: nothing happened' });
        expect(ran(r)).toEqual(['chat failed']);
    });
});

describe('defineQuest: a quest with a journal mark', () => {
    const steps = [
        step('start', deed, { what: 'start' }, { reached: v => v.quest(ID) !== 'none' }),
        step('pay', deed, { what: 'pay' }, { reached: journal(/paid the boys/i) }),
        finish,
    ];
    const PAID = ['You have paid the boys.'];
    const effects = (pay: (st: Story) => void = st => void (st.lines = PAID)) => ({
        start: (st: Story) => void (st.progress = 'started'),
        pay,
        ...FINISH,
    });

    test('reads the journal first once the tab shows started, and after a journal-mark step', async () => {
        const def = quest(steps);
        expect(def.phases.map(p => p.name)).toEqual(['journal', 'start', 'pay', 'finish']);
        const r = await run(def, storyWorld({}, effects()));
        expect(r.result).toMatchObject({ status: 'done', reason: 'plan until met' });
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'journal', 'finish']);
    });

    test('a resumed quest reads first, and the journal sets the base', async () => {
        const r = await run(quest(steps), storyWorld({ progress: 'started', lines: PAID }, effects()));
        expect(ran(r)).toEqual(['journal', 'finish']);
    });

    test('a fresh journal that does not match runs the step again', async () => {
        let pays = 0;
        const w = storyWorld(
            {},
            effects(st => void (pays++ > 0 && (st.lines = PAID))),
        );
        const r = await run(quest(steps), w);
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'journal', 'pay', 'journal', 'finish']);
    });

    test('with a dialog open the read is not selected and the step is passed by run order', async () => {
        const w = storyWorld(
            {},
            effects(st => void ((st.dialog = true), (st.lines = PAID))),
        );
        const r = await run(quest(steps), w);
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'finish']);
        const afterPay = r.events.filter(e => e.type === 'select').at(-1) as { checks: Record<string, string> };
        expect(afterPay.checks.journal).toBe('when false');
    });

    const walkOn = [steps[0]!, steps[1]!, step('walk', deed, { what: 'walk' }), finish];
    const walkEffects = (pay: (st: Story) => void) => ({ ...effects(pay), walk: () => {} });

    test('a step passed with a dialog open is confirmed by the read once the next step closed it', async () => {
        const w = storyWorld(
            {},
            walkEffects(st => void ((st.dialog = true), (st.lines = PAID))),
        );
        const r = await run(quest(walkOn), w);
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'walk', 'journal', 'finish']);
    });

    test('a step passed with a dialog open runs again when the read after the next step does not confirm it', async () => {
        let pays = 0;
        const w = storyWorld(
            {},
            walkEffects(st => void (pays++ === 0 ? (st.dialog = true) : (st.lines = PAID))),
        );
        const r = await run(quest(walkOn), w);
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'walk', 'journal', 'pay', 'journal', 'walk', 'finish']);
    });

    test('after a failed run the read runs before the retry', async () => {
        const r = await run(quest(steps), storyWorld({ refuse: { pay: 1 } }, effects()));
        expect(r.result.status).toBe('done');
        expect(ran(r)).toEqual(['start', 'journal', 'pay failed', 'journal', 'pay', 'journal', 'finish']);
    });

    test('a journal-mark step that keeps ending done unconfirmed is ended by the idle rail', async () => {
        const def = quest([steps[0]!, step('pay', deed, { what: 'pay', quiet: true }, steps[1]), finish]);
        const r = await run(
            def,
            storyWorld(
                {},
                effects(() => {}),
            ),
        );
        expect(ran(r)).toEqual(['start', 'journal', 'pay', 'journal', 'pay']);
        expect(r.result).toMatchObject({
            status: 'done',
            reason: 'nothing left to do: pay done (deed: pay); plan until not met',
        });
    });
});

/** A view with what the cursor and needsRead read; the rest throws. */
function fakeView(o: {
    progress?: QuestProgress;
    last?: PlanView['last'];
    journal?: string;
    age?: number;
    dialog?: boolean;
    held?: number;
}): PlanView {
    const known: Partial<PlanView> = {
        state: world()
            .dialog(o.dialog ? {} : false)
            .build(),
        last: o.last ?? null,
        quest: () => o.progress ?? 'none',
        questStarted: () => o.progress === 'started',
        questDone: () => o.progress === 'done',
        journalSays: (_id, pattern) => (o.journal === undefined ? undefined : pattern.test(o.journal)),
        journalAge: () => o.age,
        lastFailed: () => o.last?.status === 'failed' || o.last?.status === 'stuck',
        held: () => o.held ?? 0,
    };
    return new Proxy(known as PlanView, {
        get: (t, k) => {
            if (k in t) return t[k as keyof PlanView];
            throw new Error(`fakeView: ${String(k)} not faked`);
        },
    });
}

const potHeld = (v: PlanView) => v.held('Pot') > 0;

const thrower = (): never => {
    throw new Error('nope');
};

const last = (phase: string, status: 'done' | 'failed' = 'done') => ({ phase, status, reason: '' });

describe('cursor and needsRead', () => {
    const q: QuestDef = {
        id: ID,
        name: 'test-quest',
        steps: [
            step('start', deed, { what: 'start' }, { reached: v => v.quest(ID) !== 'none' }),
            step('item', deed, { what: 'item' }, { done: v => v.held('x') > 0 }),
            step('pay', deed, { what: 'pay' }, { reached: journal(/paid/) }),
            step('chat', deed, { what: 'chat' }),
            step('finish', deed, { what: 'finish' }, { skip: v => v.held('x') > 1 }),
        ],
    };
    const c = (o: Parameters<typeof fakeView>[0]) => cursor(q, fakeView(o));
    const n = (o: Parameters<typeof fakeView>[0]) => needsRead(q, fakeView(o));

    test('the base and each pass rule', () => {
        expect(c({})).toBe(0);
        expect(c({ progress: 'started' })).toBe(1);
        expect(c({ progress: 'started', held: 1 })).toBe(2);
        // A journal mark passes by run order until a fresh journal (age 0), readable, can confirm it.
        const ranPay = { progress: 'started', held: 1, last: last('pay') } as const;
        expect(c({ ...ranPay, journal: 'go', age: 0 })).toBe(2);
        expect(c({ ...ranPay, journal: 'go', age: 0, dialog: true })).toBe(3);
        expect(c(ranPay)).toBe(3);
        expect(c({ ...ranPay, journal: 'go', age: 1 })).toBe(3);
        expect(c({ ...ranPay, last: last('chat'), journal: 'go', age: 2 })).toBe(4);
        expect(c({ ...ranPay, last: last('chat'), journal: 'go', age: 0 })).toBe(2);
        expect(c({ progress: 'started', held: 1, last: last('pay', 'failed'), dialog: true })).toBe(2);
        expect(c({ progress: 'started', journal: 'paid' })).toBe(3);
        expect(c({ progress: 'started', journal: 'paid', last: last('chat') })).toBe(4);
        expect(c({ progress: 'started', journal: 'paid', last: last('chat', 'failed') })).toBe(3);
        // Every step passed: none applies.
        expect(c({ progress: 'started', journal: 'paid', last: last('chat'), held: 2 })).toBeNull();
    });

    test('needsRead: started, unblocked, and unread or stale after a journal-mark step or a failure', () => {
        expect(n({})).toBe(false);
        expect(n({ progress: 'started' })).toBe(true);
        expect(n({ progress: 'started', dialog: true })).toBe(false);
        expect(n({ progress: 'started', age: 0, last: last('pay') })).toBe(false);
        expect(n({ progress: 'started', age: 1, last: last('pay') })).toBe(true);
        expect(n({ progress: 'started', age: 1, journal: 'paid', last: last('chat') })).toBe(false);
        // A journal-mark step passed only by run order (pay, behind chat) asks for the confirming read.
        expect(n({ progress: 'started', age: 1, last: last('chat') })).toBe(true);
        expect(n({ progress: 'started', age: 2, last: last('chat'), journal: 'go' })).toBe(true);
        expect(n({ progress: 'started', age: 2, last: last('chat'), journal: 'go', dialog: true })).toBe(false);
        expect(n({ progress: 'started', age: 0, last: last('chat'), journal: 'go' })).toBe(false);
        expect(n({ progress: 'started', age: 1, last: last('item') })).toBe(false);
        expect(n({ progress: 'started', age: 1, last: last('chat', 'failed') })).toBe(true);
        expect(n({ progress: 'done' })).toBe(false);
        expect(needsRead({ ...q, steps: [q.steps[0]!, q.steps[3]!] }, fakeView({ progress: 'started' }))).toBe(false);
    });

    test('a step whose until holds is passed, and a throw names the step and predicate', () => {
        const u = (held: number) =>
            cursor(
                { ...q, steps: [step('a', deed, { what: 'a' }, { until: v => v.held('x') > 0 }), q.steps[3]!] },
                fakeView({ held }),
            );
        expect(u(0)).toBe(0);
        expect(u(1)).toBe(1);
        const bad = { ...q, steps: [step('a', deed, { what: 'a' }, { until: thrower })] };
        expect(() => cursor(bad, fakeView({}))).toThrow('step "a" until threw: nope');
    });

    test('are pure: the same view gives the same answer, whatever was asked between', () => {
        const a = fakeView({ progress: 'started', held: 1, last: last('pay'), journal: 'go', age: 1 });
        const b = fakeView({ progress: 'started', journal: 'paid', age: 0, last: last('chat') });
        const first = [cursor(q, a), needsRead(q, a)];
        expect([cursor(q, b), needsRead(q, b)]).toEqual([4, false]);
        expect([cursor(q, a), needsRead(q, a)]).toEqual(first);
    });
});

describe('defineQuest: the compiled plan', () => {
    const def = quest([step('pay', deed, { what: 'pay' }, { reached: journal(/paid/) }), finish], {
        requires: { 'Woodcutting 1+': v => v.level(SKILL) >= 1 },
        defaults: { maxFails: 5 },
    });

    test('ends when the quest is done, requires the quest tab, and merges its defaults over the quest default', () => {
        expect(Object.keys(def.requires!)).toEqual([...Object.keys(QUEST_TAB_REQUIRED), 'Woodcutting 1+']);
        expect(def.defaults).toEqual({ ...QUEST_DEFAULTS, maxFails: 5 });
        expect(def.until!(fakeView({ progress: 'done' }))).toBe(true);
        expect(def.until!(fakeView({ progress: 'started' }))).toBe(false);
    });

    test('passes invalidParams and the plan lint, which knows its phase names', () => {
        expect(invalidParams(def)).toEqual([]);
        expect(lintPlan(def, "v => v.lastDone('pay') || v.runs('journal') > 0")).toEqual([]);
        expect(lintPlan(def, "v => v.runs('nope') > 0")).toEqual([
            'line 1: runs(...) names "nope", which is no phase of plan "test-quest"',
        ]);
        const bad = quest([step('pay', deed, { what: 5 } as never)]);
        expect(invalidParams(bad)).toEqual([
            'phase "pay" has invalid params: what: Invalid input: expected string, received number',
        ]);
    });

    test('refuses an unknown quest id, no steps, a step named journal, a name used twice, a g or y pattern', () => {
        const chat = step('chat', deed, { what: 'chat' });
        const cases: [Partial<QuestDef>, string][] = [
            [{ id: 'nope' }, 'quest "test-quest": unknown quest id "nope"; see QUESTS in lib/quests.ts'],
            [{ steps: [] }, 'quest "test-quest": has no steps'],
            [
                { steps: [step('journal', deed, { what: 'x' })] },
                `quest "test-quest": step "journal": the name is the journal read's`,
            ],
            [{ steps: [chat, chat] }, 'quest "test-quest": step "chat": name used twice'],
            ...(['g', 'y'] as const).map((flag): [Partial<QuestDef>, string] => [
                { steps: [step('pay', deed, { what: 'pay' }, { reached: journal(new RegExp('paid', flag)) })] },
                `quest "test-quest": step "pay": journal pattern /paid/${flag} has the g or y flag`,
            ]),
        ];
        for (const [more, message] of cases)
            expect(() => defineQuest({ id: ID, name: 'test-quest', steps: [chat], ...more })).toThrow(message);
    });
});
