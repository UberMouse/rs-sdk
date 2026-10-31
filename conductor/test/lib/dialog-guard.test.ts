// The dialog guard's stuck count (interrupts.ts dialogGuard): consecutive stuck passes, which a cleared page resets.
import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { Effect } from '../../core/drivers/timeline';
import { send, ticks, wait } from '../../core/op';
import { defineTask, type Step } from '../../lib/task';
import { type Page, dialogScript } from '../dialog-script';
import { simulate } from '../simulate';
import { world } from '../world';

const base = world();

/** A conversation the task opened and answers itself: it clicks the first option of each choice, after a pause. */
const converse: Step = {
    name: 'converse',
    when: () => true,
    *run() {
        yield* send({ type: 'interactNpc', npcIndex: 1, optionIndex: 1, reason: 'talk' });
        for (let i = 0; i < 40; i++) {
            const w = yield* wait('a choice or the end', s => s.dialog.isOpen && s.dialog.options.length > 1, 12);
            if (w.kind !== 'met') return { done: `conversation over after ${i} choices` };
            // The guard sees the choice open for these ticks and leaves it alone.
            yield* ticks(2);
            yield* send({ type: 'clickDialogOption', optionIndex: 1, reason: 'answer choice' });
            yield* ticks(1);
        }
        return { fail: 'too long' };
    },
};

const idle = defineTask({
    name: 'dialog-guard-idle',
    description: 'test',
    params: z.object({}),
    steps: [
        {
            name: 'idle',
            when: () => true,
            *run() {
                yield* wait('never', () => false, 100);
                return { done: 'unreachable' };
            },
        },
    ],
});

const task = defineTask({ name: 'dialog-guard', description: 'test', params: z.object({}), steps: [converse] });

const CHOICES = 8;
/** Continue pages between two choices: more than the stuck limit. */
const PAGES = 7;

/** A conversation that never closes between its choices (the task answers them) and its continue pages (the guard clears them). */
const long: Page[] = [
    ...Array.from({ length: CHOICES }, (): Page[] => [
        ['Go on', 'Tell me more'],
        ...Array.from({ length: PAGES }, (): Page => []),
    ]).flat(),
    null,
];

/** Page `i` of a three-page cycle. */
const cyclePage =
    (i: number): Effect =>
    s =>
        world(s)
            .dialog({ text: `cycle ${i % 3}`, options: [] })
            .build();

describe('dialog guard stuck count', () => {
    test('a long conversation of cleared pages and answered choices is not a stuck dialog', async () => {
        const r = await simulate(task, { timeline: base.series(300), react: dialogScript(long).react });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(`converse: conversation over after ${CHOICES} choices`);
        expect(r.sends.filter(s => s === 'answer choice')).toHaveLength(CHOICES);
    });

    test('a page that never clears still fails the run at the stuck limit', async () => {
        const stuck = base.series(60, (w, i) => (i >= 2 ? w.dialog({ text: 'stuck', options: [] }) : w));
        const r = await simulate(idle, { timeline: stuck });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('dialog stuck open');
    });

    test('a dialog cycling through a few pages forever still fails at the stuck limit', async () => {
        let n = 0;
        const cycle = base.series(300, (w, i) => (i >= 2 ? w.dialog({ text: 'cycle 0', options: [] }) : w));
        const r = await simulate(idle, {
            timeline: cycle,
            react: a => (a.type === 'clickDialogOption' ? cyclePage(++n) : undefined),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('dialog stuck open');
    });
});
