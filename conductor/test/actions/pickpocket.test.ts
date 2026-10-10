import { describe, expect, test } from 'bun:test';
import { PICKPOCKET_ACK_TICKS, PICKPOCKET_RESOLVE_TICKS, pickpocket } from '../../actions/pickpocket';
import { world } from '../world';
import { refuse, runOp } from './harness';

const at = { x: 3222, z: 3218 };
const INDEX = 7;
const base = world().skill('Thieving', 1, 0);
const street = base.npc('Man', at.x, at.z, { index: INDEX, options: ['Talk-to', 'Attack', 'Pickpocket'] });
const man = street.build().nearbyNpcs[0]!;
const attempt = "You attempt to pick the man's pocket.";

describe('pickpocket', () => {
    test('sends Pickpocket (option 3) and succeeds once Thieving XP arrives', async () => {
        const { result, sends, driver } = await runOp(
            street.series(12, (w, i) => {
                if (i >= 5) return w.message(attempt).skill('Thieving', 1, 8);
                return i >= 3 ? w.message(attempt) : w;
            }),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({ ok: true, outcome: 'success', xpGained: 8 });
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: INDEX, optionIndex: 3, reason: 'Pickpocket Man' }]);
        expect(driver.state().tick).toBe(5);
    });

    test('the stun message is a caught attempt, not a failure', async () => {
        const { result } = await runOp(
            street.series(12, (w, i) =>
                i >= 4 ? w.message(attempt).message("You've been stunned!") : i >= 2 ? w.message(attempt) : w,
            ),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({ ok: true, outcome: 'caught' });
    });

    test('"You fail to pick" alone also reads as caught', async () => {
        const { result } = await runOp(
            street.series(12, (w, i) => (i >= 2 ? w.message("You fail to pick the man's pocket.") : w)),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({ ok: true, outcome: 'caught' });
    });

    test('a refusal for combat is in-combat', async () => {
        const { result } = await runOp(
            street.series(12, (w, i) => (i >= 2 ? w.message("You can't pickpocket during combat.") : w)),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'in-combat',
            message: 'Cannot pickpocket Man during combat',
        });
    });

    test("the server's can't-reach answer is cant-reach", async () => {
        const { result } = await runOp(
            street.series(12, (w, i) => (i >= 2 ? w.message("I can't reach that!") : w)),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Man' });
    });

    test('no sign of the attempt within the ack window is not-started (stunned or dropped)', async () => {
        const { result, driver } = await runOp(street.series(1), ctx => pickpocket(ctx, man));
        expect(result).toMatchObject({ ok: false, reason: 'not-started' });
        expect(driver.state().tick).toBe(PICKPOCKET_ACK_TICKS);
    });

    test('the NPC leaving view before any message is target-gone', async () => {
        const { result } = await runOp(
            street.series(12, (w, i) => (i >= 2 ? base : w)),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toEqual({ ok: false, reason: 'target-gone', message: 'Man left view before the attempt' });
    });

    test('an attempt that neither pays nor stuns times out after the resolve window', async () => {
        const { result, driver } = await runOp(
            street.series(30, (w, i) => (i >= 2 ? w.message(attempt) : w)),
            ctx => pickpocket(ctx, man),
        );
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(driver.state().tick).toBe(2 + PICKPOCKET_RESOLVE_TICKS);
    });

    test('an NPC with no Pickpocket option sends nothing', async () => {
        const guard = base.npc('Guard', at.x, at.z, { options: ['Attack'] }).build().nearbyNpcs[0]!;
        const { result, sends } = await runOp(street.series(1), ctx => pickpocket(ctx, guard));
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'No Pickpocket option on Guard' });
        expect(sends).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(street.series(1), ctx => pickpocket(ctx, man), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('messages from before the send do not count', async () => {
        const old = street.message("You've been stunned!").tick(1);
        const { result } = await runOp(old.series(1), ctx => pickpocket(ctx, man));
        expect(result).toMatchObject({ ok: false, reason: 'not-started' });
    });
});
