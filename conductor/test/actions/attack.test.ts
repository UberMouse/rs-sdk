import { describe, expect, test } from 'bun:test';
import { ATTACK_WAIT_TICKS, attack } from '../../actions/attack';
import { world } from '../world';
import { refuse, runOp } from './harness';

const at = { x: 3188, z: 3278 };
const INDEX = 7;
/** An old message, from before the attack. */
const base = world().message("I can't reach that!").tick(1);
const coop = base.npc('Chicken', at.x, at.z, { index: INDEX, options: ['Attack'] });
const chicken = coop.build().nearbyNpcs[0]!;
/** The chicken has left view: killed by someone else, or despawned. */
const gone = base;

describe('attack', () => {
    test('sends Attack on the NPC and succeeds once the bot targets it in combat', async () => {
        const { result, sends, driver } = await runOp(
            coop.series(10, (w, i) => (i >= 3 ? w.fighting(INDEX) : w)),
            ctx => attack(ctx, chicken),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: INDEX, optionIndex: 1, reason: 'Attack Chicken' }]);
        expect(driver.state().tick).toBe(4);
    });

    test('a hit landing on the NPC is a start too, even with the chicken killed by it', async () => {
        const { result } = await runOp(
            coop.series(10, (w, i) => (i >= 2 ? gone.tick(i + 1).hit(INDEX) : w)),
            ctx => attack(ctx, chicken),
        );
        expect(result).toEqual({ ok: true });
    });

    test('a hit or a fight on another NPC, or an old hit on this one, is no start', async () => {
        const before = coop.hit(INDEX);
        const { result } = await runOp(
            before.series(1, w => w.hit(INDEX + 1).fighting(INDEX + 1)),
            ctx => attack(ctx, chicken),
        );
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timeout waiting to attack Chicken' });
    });

    test("the server's can't-reach, after the send, is cant-reach", async () => {
        const { result } = await runOp([coop.build(), coop.tick(2).message("I can't reach that!").build()], ctx =>
            attack(ctx, chicken),
        );
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Chicken' });
    });

    test('the client finding no route is cant-reach, with nothing waited for', async () => {
        const { result, driver } = await runOp(coop.series(1), ctx => attack(ctx, chicken), {
            respond: () => ({ success: false, message: 'No path to target', reason: 'cant_reach' }),
        });
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'No path to target' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('a single-way combat refusal is already-in-combat', async () => {
        for (const text of ["I'm already under attack!", 'Someone else is fighting that.']) {
            const { result } = await runOp([coop.build(), coop.tick(2).message(text).build()], ctx =>
                attack(ctx, chicken),
            );
            expect(result).toEqual({ ok: false, reason: 'already-in-combat', message: 'Chicken is already in combat' });
        }
    });

    test('the fight starting on the tick of a refusal is still a start', async () => {
        const { result } = await runOp(
            [coop.build(), coop.tick(2).message("I'm already under attack!").fighting(INDEX).build()],
            ctx => attack(ctx, chicken),
        );
        expect(result).toEqual({ ok: true });
    });

    test('the NPC leaving view first is target-gone', async () => {
        const { result } = await runOp([coop.build(), gone.tick(2).build()], ctx => attack(ctx, chicken));
        expect(result).toEqual({
            ok: false,
            reason: 'target-gone',
            message: 'Chicken disappeared before combat was observed',
        });
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await runOp(coop.series(1), ctx => attack(ctx, chicken));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timeout waiting to attack Chicken' });
        expect(driver.state().tick).toBe(1 + ATTACK_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(coop.series(1), ctx => attack(ctx, chicken), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('an NPC with no Attack option is no-option, and nothing is sent', async () => {
        const fred = base.npc('Fred the Farmer', at.x, at.z, { options: ['Talk-to'] });
        const { result, sends } = await runOp(fred.series(1), ctx => attack(ctx, fred.build().nearbyNpcs[0]!));
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'No attack option on Fred the Farmer' });
        expect(sends).toEqual([]);
    });
});
