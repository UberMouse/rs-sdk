import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { EAT_WAIT_TICKS } from '../../actions/eat';
import { type EatStepOptions, eatStep, foodInInventory, wantsToEat } from '../../lib/eat-step';
import { failStreak } from '../../lib/streak';
import { defineTask, type TaskContext } from '../../lib/task';
import { runDef } from '../engine/harness';
import { consume } from '../react';
import type { Simulation } from '../simulate';
import { world } from '../world';

const EAT_FAILS = failStreak({ name: 'eatFails', limit: 3, worstTicks: EAT_WAIT_TICKS });
// At 5/10 HP: under the step's 0.6, not under the low-HP guard's half, so only the step eats.
const hurt = world().player({ hp: 5, maxHp: 10 }).inv('Shrimps', 10);
const params = { food: ['Shrimps'], eatBelow: 0.6 };
const logged = (r: Simulation) => r.events.flatMap(e => (e.type === 'log' ? [e.msg] : []));

/**
 * Runs the eat step (with `opts` over combat's options) on a bot that stays hurt; eat n lands when `lands[n]` is
 * true (the food leaves the inventory) and is ignored otherwise. Done once every eat in `lands` was sent.
 */
function run(lands: boolean[], opts: Partial<EatStepOptions<typeof params>> = {}) {
    let eats = 0;
    const react = (action: BotAction, state: BotWorldState) => {
        if (action.type !== 'useInventoryItem') return undefined;
        return lands[eats++] ? consume(action, state) : undefined;
    };
    const def = defineTask({
        name: 'test',
        description: 'eat-step test',
        params: z.object({ food: z.array(z.string()), eatBelow: z.number() }),
        silent: [EAT_FAILS],
        steps: [
            { name: 'end', when: () => eats >= lands.length, run: () => ({ done: 'end' }) },
            eatStep<typeof params>({
                wants: wantsToEat,
                food: foodInInventory,
                streak: EAT_FAILS,
                failText: (food, r) => `could not eat ${food.name}: ${r.message}`,
                ...opts,
            }),
        ],
    });
    return runDef(def, hurt.series(1), { react, params });
}

describe('eatStep', () => {
    test('eats the food it picks while it wants to', async () => {
        const r = await run([true, true]);
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Eat Shrimps', 'Eat Shrimps']);
        expect(r.steps).toEqual(['eat', 'end']);
    });

    test('with no food it does not apply, and run alone sends nothing', () => {
        const none = world().player({ hp: 5, maxHp: 10 }).build();
        expect(wantsToEat(none, params)).toBe(false);
        expect(wantsToEat(hurt.player({ hp: 6 }).build(), params)).toBe(false);
        expect(wantsToEat(hurt.build(), params)).toBe(true);
        const step = eatStep<typeof params>({
            wants: () => true,
            food: () => undefined,
            streak: EAT_FAILS,
            failText: () => 'never',
        });
        const ctx = { state: () => none, params } as unknown as TaskContext<typeof params, object>;
        const g = step.run(ctx) as Generator;
        expect(g.next()).toEqual({ done: true, value: undefined });
    });

    test('fails with the given text at the streak limit', async () => {
        const r = await run([false, false, false, true]);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('eat: could not eat Shrimps: Failed to eat Shrimps');
        expect(r.sends).toHaveLength(3);
        expect(logged(r)).toEqual([]);
    });

    test('a successful eat clears the streak', async () => {
        const r = await run([false, true, false, false, true]);
        expect(r.result.status).toBe('done');
        expect(r.sends).toHaveLength(5);
    });

    test('keepOnSuccess leaves the count, and logFailure logs each failed eat before it counts', async () => {
        const r = await run([false, true, false, false, true], {
            keepOnSuccess: true,
            failText: (_, f) => `3 eats in a row failed (last: ${f.message})`,
            logFailure: (food, f) => `eat ${food.name} failed (${f.reason}): ${f.message}`,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('eat: 3 eats in a row failed (last: Failed to eat Shrimps)');
        expect(r.sends).toHaveLength(4);
        expect(logged(r)).toEqual(Array(3).fill('eat Shrimps failed (timeout): Failed to eat Shrimps'));
    });
});
