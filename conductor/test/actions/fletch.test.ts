import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { FLETCH_MAKE_TICKS, FLETCH_MENU_TICKS, fletch } from '../../actions/fletch';
import type { Step } from '../../lib/task';
import { runTask } from '../engine/harness';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const LOGS = /^logs$/i;
const SHAFTS = 52;
/**
 * Normal logs' make menu: Make X, Make 10, Make 5 and the product's own button, per product, its label
 * after a literal "\n\n\n\n" as the live client publishes it.
 */
const MENU = ['15 Arrow Shafts', 'Short Bow', 'Long Bow'].flatMap(p => [
    'Make X',
    'Make 10',
    'Make 5',
    `\\n\\n\\n\\n${p}`,
]);
const kit = world().skill('Fletching', 1, 0).inv('Knife', 1).inv('Logs', 2).tick(1);
const menu = (w: World) => w.dialog({ options: MENU });
/** One log cut into 15 shafts, 75 xp. */
const cut = (w: World) => w.inv('Logs', 1).inv('Arrow shaft', 1, { id: SHAFTS }).skill('Fletching', 1, 75);
const useKnife: BotAction = { type: 'useItemOnItem', sourceSlot: 0, targetSlot: 1, reason: 'use Knife on Logs' };
const choose = (optionIndex: number, label: string): BotAction => ({
    type: 'clickDialogOption',
    optionIndex,
    reason: `fletch ${label}`,
});

/** The box the game shows instead of making a bow the bot lacks the level for. */
const box = (w: World) => w.recentDialog(['You need a Fletching level of at least 5 to make a shortbow.']);
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });

/** Knife used at tick 1, the menu open at ticks 2-3, the product made at tick 5. */
const fletching = (made: (w: World) => World = cut) => [
    kit.build(),
    menu(kit.tick(2)).build(),
    menu(kit.tick(3)).build(),
    kit.tick(4).build(),
    made(kit.tick(5)).build(),
];

describe('fletch', () => {
    test('uses the knife on the logs, clicks the product in the menu by its label, and waits for the xp', async () => {
        const { result, sends } = await runOp(fletching(), ctx => fletch(ctx, LOGS, 'arrow shaft'));
        expect(result).toEqual({ ok: true, xpGained: 75, product: '15 Arrow Shafts' });
        // Arrow shafts are option 3 of 12, not option 0: the quantity buttons come first.
        expect(sends).toEqual([useKnife, choose(3, '15 Arrow Shafts')]);
    });

    test('picks a product by any of its words; with none named, the first', async () => {
        const bow = await runOp(fletching(), ctx => fletch(ctx, LOGS, 'short bow'));
        expect(bow.sends[1]).toEqual(choose(7, 'Short Bow'));
        const first = await runOp(fletching(), ctx => fletch(ctx, LOGS));
        expect(first.sends[1]).toEqual(choose(3, '15 Arrow Shafts'));
    });

    test('a product the menu does not offer is no-product, naming what it offers', async () => {
        const { result, sends } = await runOp(fletching(), ctx => fletch(ctx, LOGS, 'crossbow'));
        expect(result).toEqual({
            ok: false,
            reason: 'no-product',
            message: 'No fletching product matched "crossbow". Available: "15 Arrow Shafts", "Short Bow", "Long Bow"',
        });
        expect(sends).toEqual([useKnife]);
    });

    test('no menu within its wait is no-menu', async () => {
        const { result, driver } = await runOp(kit.series(1), ctx => fletch(ctx, LOGS, 'arrow shaft'));
        expect(result).toEqual({ ok: false, reason: 'no-menu', message: 'Fletching dialog did not open' });
        expect(driver.state().tick).toBe(1 + FLETCH_MENU_TICKS);
    });

    test("the game's level box after the click is level-too-low", async () => {
        const { result } = await runOp(fletching(box), ctx => fletch(ctx, LOGS, 'short bow'));
        expect(result).toEqual({ ok: false, reason: 'level-too-low', message: 'Fletching level too low' });
    });

    test('no xp within its wait after the click is a timeout', async () => {
        const { result, driver } = await runOp(
            fletching(w => w),
            ctx => fletch(ctx, LOGS, 'arrow shaft'),
        );
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Fletching timed out' });
        expect(driver.state().tick).toBe(2 + FLETCH_MAKE_TICKS);
    });

    test('needs an item named exactly Knife, and the logs asked for; a refused send fails at once', async () => {
        const throwing = world().inv('Bronze knife', 1, { id: 864 }).inv('Logs', 1);
        const noKnife = await runOp(throwing.series(1), ctx => fletch(ctx, LOGS));
        expect(noKnife.result).toEqual({ ok: false, reason: 'no-knife', message: 'No knife in inventory' });
        const oak = world().inv('Knife', 1).inv('Oak logs', 1);
        const noLogs = await runOp(oak.series(1), ctx => fletch(ctx, LOGS));
        expect(noLogs.result).toEqual({ ok: false, reason: 'no-logs', message: 'No logs in inventory' });
        const refused = await runOp(kit.series(1), ctx => fletch(ctx, LOGS), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

describe('fletch under the engine: its own menu vs the dialog guard', () => {
    const step: Step = {
        name: 'fletch',
        when: () => true,
        *run(ctx) {
            const r = yield* fletch(ctx, LOGS, 'arrow shaft');
            return r.ok ? { done: `made ${r.product}` } : { fail: r.message };
        },
    };

    test('the guard leaves the make menu to the op, and clears a level-up before and after it', async () => {
        // A level-up still open as the knife is used (ticks 1-2), then the menu (3-4), then the level-up
        // that comes with the shafts (6).
        const states = [
            kit.tick(0),
            levelUp(kit),
            levelUp(kit.tick(2)),
            menu(kit.tick(3)),
            menu(kit.tick(4)),
            kit.tick(5),
            levelUp(cut(kit.tick(6))),
            cut(kit.tick(7)),
        ].map(w => w.build());
        // The step starts at tick 0, before the first level-up, so the guard meets it inside the op's wait.
        const r = await runTask([step], states);
        expect(r.result.reason).toBe('fletch: made 15 Arrow Shafts');
        expect(r.sends).toEqual(['use Knife on Logs', 'continue dialog', 'fletch 15 Arrow Shafts', 'continue dialog']);
        expect(r.result.stepRuns).toEqual({ fletch: 1, 'interrupt:dialog': 2 });
    });

    test("a menu left open is not the guard's: it never fires on it", async () => {
        const r = await runTask([step], [kit.tick(0).build(), ...menu(kit).series(40)]);
        expect(r.result.reason).toBe('fletch: Fletching timed out');
        expect(r.sends).toEqual(['use Knife on Logs', 'fletch 15 Arrow Shafts']);
        expect(r.result.stepRuns['interrupt:dialog']).toBeUndefined();
    });
});
