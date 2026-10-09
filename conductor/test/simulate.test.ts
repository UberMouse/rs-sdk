import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { type Op, scan, send, wait } from '../core/op';
import { defineTask, type Outcome } from '../lib/task';
import { simulate } from './simulate';
import { world } from './world';

const chop = defineTask({
    name: 'chop-once',
    description: 'finds a tree, chops it until a log arrives',
    params: z.object({ want: z.number().default(1) }),
    steps: [
        {
            name: 'chop',
            when: () => true,
            *run(ctx): Op<Outcome> {
                const [tree] = yield* scan();
                if (!tree) return { fail: 'no tree' };
                const sent = yield* send({ type: 'none', reason: `chop ${tree.name}` });
                if (!sent.success) return { fail: sent.message };
                const logs = () => ctx.state().inventory.filter(i => i.name === 'Logs').length;
                const got = yield* wait('log', () => logs() >= ctx.params.want, 20);
                return got.kind === 'met' ? { done: `${logs()} logs at tick ${got.state.tick}` } : { fail: 'no log' };
            },
        },
    ],
});

const tree = world()
    .skill('Woodcutting', 1, 0)
    .loc('Tree', 3224, 3220, { options: ['Chop down'] });
/** Ticks 0..5; the log arrives with the xp on tick 3. */
const chopping = tree.series(6, (w, i) => (i >= 3 ? w.inv('Logs', 1).skill('Woodcutting', 1, 25) : w));

describe('simulate', () => {
    test('drives a generator task end to end and reports what it did', async () => {
        const r = await simulate(chop, {
            params: { want: 1 },
            timeline: chopping,
            scan: () => [tree.build().nearbyLocs[0]!],
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('chop: 1 logs at tick 3');
        expect(r.result.xpGained).toEqual({ Woodcutting: 25 });
        expect(r.result.inventoryDelta).toEqual({ Logs: 1 });
        expect(r.steps).toEqual(['chop']);
        expect(r.sends).toEqual(['chop Tree']);
        expect(r.commands.map(c => c.type)).toEqual(['scan', 'send']);
    });

    test('respond answers the task sends', async () => {
        const r = await simulate(chop, {
            timeline: chopping,
            scan: () => [tree.build().nearbyLocs[0]!],
            respond: () => ({ success: false, message: 'cant_reach' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('chop: cant_reach');
    });

    test('a task that finds nothing fails, and bad params are an error', async () => {
        const none = await simulate(chop, { timeline: chopping });
        expect(none.result.reason).toBe('chop: no tree');
        const bad = await simulate(chop, { params: { want: 'many' }, timeline: chopping });
        expect(bad.result.status).toBe('error');
    });

    test('the engine guards act on a built world: hungry and hurt, the bot eats first', async () => {
        const hurt = world().player({ hp: 3 }).inv('Shrimps', 2);
        const r = await simulate(chop, { timeline: hurt.series(30), scan: () => [] });
        expect(r.legacy[0]).toBe('eat Shrimps');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
    });

    test('it needs a world to run in', async () => {
        await expect(simulate(chop, {})).rejects.toThrow('timeline or a driver');
    });
});
