import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { BURN_WAIT_TICKS, burn } from '../../actions/burn';
import type { Step } from '../../lib/task';
import { runTask } from '../engine/harness';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const LOGS = /^logs$/i;
const kit = world().skill('Firemaking', 1, 0).inv('Tinderbox', 1).inv('Logs', 2).tick(1);
/** The fire caught: one log gone, 40 xp. */
const lit = (w: World) => w.inv('Logs', 1).skill('Firemaking', 1, 40);
const light: BotAction = { type: 'useItemOnItem', sourceSlot: 0, targetSlot: 1, reason: 'light Logs' };

describe('burn', () => {
    test('uses the tinderbox on the logs and succeeds on Firemaking xp', async () => {
        const { result, sends } = await runOp([kit.build(), kit.tick(2).build(), lit(kit.tick(5)).build()], ctx =>
            burn(ctx, LOGS),
        );
        expect(result).toEqual({ ok: true, xpGained: 40 });
        expect(sends).toEqual([light]);
    });

    test("a refused tile is cant-light-here, with the game's message", async () => {
        const refused = kit.tick(3).message("You can't light a fire here.");
        const { result, driver } = await runOp([kit.build(), refused.build()], ctx => burn(ctx, LOGS));
        expect(result).toEqual({ ok: false, reason: 'cant-light-here', message: "You can't light a fire here." });
        expect(driver.state().tick).toBe(3);
    });

    test('a refusal from before the light does not count', async () => {
        const old = kit.message("You can't light a fire here.");
        const { result } = await runOp([old.build(), lit(old.tick(4)).build()], ctx => burn(ctx, LOGS));
        expect(result).toEqual({ ok: true, xpGained: 40 });
    });

    test('too low a level is level-too-low', async () => {
        const oak = world().skill('Firemaking', 1, 0).inv('Tinderbox', 1).inv('Oak logs', 1).tick(1);
        const msg = 'You need a Firemaking level of 15 to burn Oak logs.';
        const { result } = await runOp([oak.build(), oak.tick(2).message(msg).build()], ctx =>
            burn(ctx, /^oak logs$/i),
        );
        expect(result).toEqual({ ok: false, reason: 'level-too-low', message: msg });
    });

    test('no fire within the wait is a timeout', async () => {
        const { result, driver } = await runOp(kit.series(1), ctx => burn(ctx, LOGS));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timed out waiting for fire' });
        expect(driver.state().tick).toBe(1 + BURN_WAIT_TICKS);
    });

    test('missing tinderbox or logs, and a refused send, fail before any wait', async () => {
        const noBox = await runOp(world().inv('Logs', 1).series(1), ctx => burn(ctx, LOGS));
        expect(noBox.result).toEqual({ ok: false, reason: 'no-tinderbox', message: 'No tinderbox in inventory' });
        const noLogs = await runOp(world().inv('Tinderbox', 1).inv('Oak logs', 1).series(1), ctx => burn(ctx, LOGS));
        expect(noLogs.result).toEqual({ ok: false, reason: 'no-logs', message: 'No logs in inventory' });
        expect([...noBox.sends, ...noLogs.sends]).toEqual([]);
        const refused = await runOp(kit.series(1), ctx => burn(ctx, LOGS), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('under the engine, the dialog guard clears the level-up that arrives with the fire', async () => {
        const step: Step = {
            name: 'burn',
            when: () => true,
            *run(ctx) {
                const r = yield* burn(ctx, LOGS);
                return r.ok ? { done: `+${r.xpGained} xp` } : { fail: r.message };
            },
        };
        const levelUp = lit(kit).dialog({ options: ['Click here to continue'] });
        const states = [kit.tick(0), kit, kit.tick(2), levelUp.tick(3), lit(kit).tick(4)].map(w => w.build());
        const r = await runTask([step], states);
        expect(r.result.reason).toBe('burn: +40 xp');
        expect(r.sends).toEqual(['light Logs', 'continue dialog']);
        expect(r.result.stepRuns).toEqual({ burn: 1, 'interrupt:dialog': 1 });
    });
});
