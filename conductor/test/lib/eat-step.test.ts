import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { EAT_WAIT_TICKS } from '../../actions/eat';
import { type EatStepOptions, eatStep, foodInInventory, wantsToEat } from '../../lib/eat-step';
import { failStreak } from '../../lib/streak';
import { defineTask } from '../../lib/task';
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
async function run(lands: boolean[], opts: Partial<EatStepOptions<typeof params>> = {}) {
    let eats = 0;
    let tried = 0;
    const pick = opts.food ?? foodInInventory;
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
            {
                name: 'end',
                when: () => eats >= lands.length && (lands.length > 0 || tried > 0),
                run: () => ({ done: 'end' }),
            },
            eatStep<typeof params>({
                wants: wantsToEat,
                streak: EAT_FAILS,
                failText: (f, r) => `could not eat ${f.name}: ${r.message}`,
                ...opts,
                food: (s, p) => (tried++, pick(s, p)),
            }),
        ],
    });
    const result = await runDef(def, hurt.series(1), { react, params });
    return Object.assign(result, { tried });
}

describe('eatStep', () => {
    test('eats the food it picks while it wants to', async () => {
        const r = await run([true, true]);
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Eat Shrimps', 'Eat Shrimps']);
        expect(r.steps).toEqual(['eat', 'end']);
    });

    test('with no food the step does not apply and sends nothing', async () => {
        const r = await run([], { food: () => undefined });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
        expect(r.tried).toBeGreaterThanOrEqual(1);
        expect(r.steps).toEqual(['eat', 'end']);
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

describe('wantsToEat', () => {
    test('is false with no food held', () => {
        expect(wantsToEat(world().player({ hp: 5, maxHp: 10 }).build(), params)).toBe(false);
    });

    test('is false above the line', () => {
        expect(wantsToEat(hurt.player({ hp: 7 }).build(), params)).toBe(false);
    });

    test('is false at exactly the line (6 of 10 at 0.6 is not below)', () => {
        expect(wantsToEat(hurt.player({ hp: 6 }).build(), params)).toBe(false);
    });

    test('is true below the line with food held', () => {
        expect(wantsToEat(hurt.build(), params)).toBe(true);
    });
});
