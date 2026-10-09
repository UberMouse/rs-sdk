import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { TimelineDriver } from '../core/drivers/timeline';
import { type Op, scan, send, wait } from '../core/op';
import { defineTask, type Outcome } from '../lib/task';
import { consume } from './react';
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
        expect(r.sends[0]).toBe('Eat Shrimps');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
    });

    test('the world uses up what the bot eats or drops, from the next tick on, unless the send was refused', async () => {
        const dropper = defineTask({
            name: 'drop-one',
            description: 'eats a shrimp and drops a log',
            params: z.object({}),
            steps: [
                {
                    name: 'act',
                    when: () => true,
                    *run(ctx): Op<Outcome> {
                        const shrimp = ctx.state().inventory[0];
                        const logs = ctx.state().inventory.find(i => i.name === 'Logs');
                        yield* send({ type: 'useInventoryItem', slot: shrimp!.slot, optionIndex: 1, reason: 'eat' });
                        yield* send({ type: 'dropItem', slot: logs!.slot, reason: 'drop' });
                        const now = ctx.state().inventory.length;
                        const next = (yield* wait('a tick', () => false, 1)).state.inventory.map(i => i.name);
                        return { done: `${now} then ${next.join(',')}` };
                    },
                },
            ],
        });
        const kit = world().inv('Shrimps', 2).inv('Logs', 1).series(5);
        const r = await simulate(dropper, { timeline: kit });
        expect(r.result.reason).toBe('act: 3 then Shrimps');
        const refused = await simulate(dropper, { timeline: kit, respond: () => ({ success: false, message: 'no' }) });
        expect(refused.result.reason).toBe('act: 3 then Shrimps,Shrimps,Logs');
        const inert = await simulate(dropper, { timeline: kit, react: () => undefined });
        expect(inert.result.reason).toBe('act: 3 then Shrimps,Shrimps,Logs');
    });

    test('a consumed item stays gone while the script holds it, and the effect ends once the script has caught up', async () => {
        // Logs dropped at tick 0; the script has none at tick 1 (it modelled the drop itself) and gains one at tick 2.
        const none = world().inv('Shrimps', 1);
        const states = [
            none.inv('Logs', 1).tick(0),
            none.tick(1),
            none.inv('Logs', 1).tick(2),
            none.inv('Logs', 1).tick(3),
        ];
        const driver = new TimelineDriver(
            states.map(w => w.build()),
            { react: consume },
        );
        await driver.send({ type: 'dropItem', slot: 1, reason: 'drop' });
        const seen: number[] = [];
        for (let i = 0; i < 3; i++)
            seen.push((await driver.nextTick()).inventory.filter(x => x.name === 'Logs').length);
        expect(seen).toEqual([0, 1, 1]);
    });

    test('a task that never finishes is ended by a stop, not left hanging', async () => {
        const endless = defineTask({
            name: 'endless',
            description: 'waits for something that never happens',
            params: z.object({}),
            steps: [
                {
                    name: 'wait',
                    when: () => true,
                    *run(): Op<Outcome> {
                        for (;;) yield* wait('never', () => false, 1);
                    },
                },
            ],
        });
        const r = await simulate(endless, {
            timeline: world().series(10),
            stops: [{ kind: 'minutes', minutes: 0.005 }],
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('reached 0.005 min');
    });

    test('it needs a world to run in', async () => {
        await expect(simulate(chop, {})).rejects.toThrow('timeline or a driver');
    });
});
