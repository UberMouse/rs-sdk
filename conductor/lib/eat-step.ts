// A task's own eat step: eat the food it picks while it wants to, failing the run after the declared streak of eats
// that did nothing. The engine's low-HP guard (lib/interrupts.ts) eats on its own below its line; this step tops HP
// up above it.
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { eat, type EatResult } from '../actions/eat';
import { log } from '../core/op';
import type { ReasonStreak } from './streak';
import type { Step } from './task';
import { hpBelow } from './threat';
import { exactName } from './util';

/** A failed eat, as the failure text and the log line read it. */
export type EatFailure = Extract<EatResult, { ok: false }>;

export interface EatStepOptions<P> {
    /** The step's `when`; it must imply that `food` returns something, or the step does nothing. */
    wants: (state: BotWorldState, params: P) => boolean;
    /** The item to eat; none, and the step does nothing. */
    food: (state: BotWorldState, params: P) => InventoryItem | undefined;
    /** Counts the eats that failed; its `ctx.streak` name is the task's own. */
    streak: ReasonStreak;
    /** The run's failure at the streak's limit. */
    failText: (food: InventoryItem, failure: EatFailure) => string;
    /** Logged on each failed eat, before it is counted. */
    logFailure?: (food: InventoryItem, failure: EatFailure) => string;
    /**
     * By default a successful eat clears the count, so the limit means consecutive failures. `true` keeps the count
     * across successes until the engine resets it when the step stops applying. Only agility sets it, to keep how it
     * behaved before the shared step; new tasks leave it off.
     */
    keepOnSuccess?: boolean;
}

/** The step named `eat`. */
export function eatStep<P, M extends object = object>(opts: EatStepOptions<P>): Step<P, M> {
    return {
        name: 'eat',
        when: ctx => opts.wants(ctx.state(), ctx.params),
        *run(ctx) {
            const food = opts.food(ctx.state(), ctx.params);
            if (!food) return;
            const r = yield* eat(ctx, food);
            if (r.ok) {
                if (!opts.keepOnSuccess) opts.streak.clear(ctx);
                return;
            }
            if (opts.logFailure) yield* log(opts.logFailure(food, r));
            return opts.streak.missWith(ctx, opts.failText(food, r));
        },
    };
}

/** Params of a task that eats configured food below a fraction of max HP. */
export interface FoodParams {
    food: readonly string[];
    eatBelow: number;
}

/** The first inventory item that is configured food. */
export const foodInInventory = (s: BotWorldState, p: Pick<FoodParams, 'food'>) =>
    s.inventory.find(i => p.food.some(f => exactName(f).test(i.name)));

/**
 * HP is under `eatBelow` of max and configured food is held. The low-HP guard eats first below its line (`LOW_HP_FRACTION`
 * of max HP with one attacker), so with `eatBelow` at or under `LOW_HP_FRACTION` this seldom applies.
 */
export const wantsToEat = (s: BotWorldState, p: FoodParams) => hpBelow(s, p.eatBelow) && !!foodInInventory(s, p);
