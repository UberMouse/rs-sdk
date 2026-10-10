import { describe, expect, test } from 'bun:test';
import { CAST_WAIT_TICKS, cast } from '../../actions/cast';
import { Spells } from '../../../sdk/spells';
import { world } from '../world';
import { refuse, runOp } from './harness';

const INDEX = 7;
const base = world().skill('Magic', 1, 0);
const coop = base.npc('Chicken', 3232, 3295, { index: INDEX, options: ['Attack'] });
const chicken = coop.build().nearbyNpcs[0]!;
const run = (states: ReturnType<typeof coop.series>, opts = {}) =>
    runOp(states, ctx => cast(ctx, chicken, Spells.WIND_STRIKE, 'Wind Strike'), opts);

describe('cast', () => {
    test('sends the spell on the NPC and succeeds on the Magic XP the cast pays', async () => {
        const { result, sends, driver } = await run(coop.series(10, (w, i) => (i >= 3 ? w.skill('Magic', 1, 55) : w)));
        expect(result).toEqual({ ok: true, xpGained: 55 });
        expect(sends).toEqual([
            { type: 'spellOnNpc', npcIndex: INDEX, spellComponent: 1152, reason: 'cast Wind Strike on Chicken' },
        ]);
        expect(driver.state().tick).toBe(3);
    });

    test('Magic XP from before the cast is no evidence', async () => {
        const { result } = await run(coop.skill('Magic', 1, 55).series(1));
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    });

    test("the server's rune refusal is no-runes", async () => {
        const msg = 'You do not have enough Air Runes to cast this spell.';
        const { result } = await run([coop.build(), coop.tick(2).message(msg).build()]);
        expect(result).toEqual({ ok: false, reason: 'no-runes', message: msg });
    });

    test("the server's level refusal is level", async () => {
        const msg = 'Your Magic level is not high enough for this spell.';
        const { result } = await run([coop.build(), coop.tick(2).message(msg).build()]);
        expect(result).toEqual({ ok: false, reason: 'level', message: msg });
    });

    test("the server's can't-reach is cant-reach, and an old one is ignored", async () => {
        const old = coop.message("I can't reach that!").tick(1);
        const gone = await run([old.build(), old.tick(2).message("I can't reach that!").build()]);
        expect(gone.result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Chicken' });
        const stale = await run(old.series(1));
        expect(stale.result).toMatchObject({ ok: false, reason: 'timeout' });
    });

    test('the client finding no route is cant-reach, with nothing waited for', async () => {
        const { result, driver } = await run(coop.series(1), {
            respond: () => ({ success: false, message: 'No path to target', reason: 'cant_reach' }),
        });
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'No path to target' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('the NPC leaving view first is target-gone', async () => {
        const { result } = await run([coop.build(), base.tick(2).build()]);
        expect(result).toEqual({
            ok: false,
            reason: 'target-gone',
            message: 'Chicken disappeared before the cast landed',
        });
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(coop.series(1));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Timeout waiting for Wind Strike on Chicken',
        });
        expect(driver.state().tick).toBe(CAST_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await run(coop.series(1), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
