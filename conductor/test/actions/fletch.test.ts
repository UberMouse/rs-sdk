import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { isSkillMenu } from '../../actions/dismiss';
import {
    FLETCH_CLOSE_TICKS,
    FLETCH_MAKE_TICKS,
    FLETCH_MENU_TICKS,
    FLETCH_STALL_TICKS,
    fletch,
} from '../../actions/fletch';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { type Guard, interpret } from '../../core/interpret';
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
/** The same menu without its Make 10 buttons. */
const noTen = (w: World) => w.dialog({ options: MENU.filter(o => o !== 'Make 10') });
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
        // It closes the menu it opened: a menu left open freezes the player.
        expect(sends).toEqual([useKnife, closeMenu]);
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

describe('fletch batches', () => {
    const big = world().skill('Fletching', 1, 0).inv('Knife', 1).inv('Logs', 12).tick(1);
    /** Make menu from tick 2, one log cut every 2 ticks from tick 5, `n` of them at most. */
    const run = (n: number, extra: (w: World, i: number) => World = w => w) =>
        Array.from({ length: 40 }, (_, k) => {
            const i = k + 1;
            const done = i < 5 ? 0 : Math.min(Math.floor((i - 5) / 2) + 1, n);
            const w = big
                .tick(i)
                .inv('Logs', 12 - done)
                .skill('Fletching', 1, 75 * done);
            return extra(i === 2 || i === 3 ? menu(w) : w, i).build();
        });

    test('Make 10 clicks the button before the product and waits until ten logs are cut', async () => {
        const { result, sends, driver } = await runOp(run(10), ctx => fletch(ctx, LOGS, 'arrow shaft', 10));
        expect(result).toEqual({ ok: true, xpGained: 750, product: '15 Arrow Shafts' });
        expect(sends).toEqual([useKnife, choose(1, '15 Arrow Shafts x10')]);
        // Tick 5 the first log, tick 23 the tenth.
        expect(driver.state().tick).toBe(23);
    });

    test('Make 5 and the second product group (short bow) pick their own buttons', async () => {
        const five = await runOp(run(5), ctx => fletch(ctx, LOGS, 'arrow shaft', 5));
        expect(five.sends[1]).toEqual(choose(2, '15 Arrow Shafts x5'));
        const bow = await runOp(run(10), ctx => fletch(ctx, LOGS, 'short bow', 10));
        expect(bow.sends[1]).toEqual(choose(5, 'Short Bow x10'));
    });

    test('a batch that stops early ends after FLETCH_STALL_TICKS with the xp so far', async () => {
        const { result, driver } = await runOp(run(3), ctx => fletch(ctx, LOGS, 'arrow shaft', 10));
        expect(result).toEqual({ ok: true, xpGained: 225, product: '15 Arrow Shafts' });
        expect(driver.state().tick).toBe(9 + FLETCH_STALL_TICKS);
    });

    test('a level-up ends the batch at once', async () => {
        const { result, driver } = await runOp(
            run(10, (w, i) => (i >= 7 ? w.skill('Fletching', 2, 200) : w)),
            ctx => fletch(ctx, LOGS, 'arrow shaft', 10),
        );
        expect(result).toMatchObject({ ok: true });
        expect(driver.state().tick).toBe(7);
    });

    test('the batch is capped by the logs held', async () => {
        const few = Array.from({ length: 30 }, (_, k) => {
            const i = k + 1;
            const done = i < 5 ? 0 : Math.min(Math.floor((i - 5) / 2) + 1, 2);
            const w = kit
                .tick(i)
                .inv('Logs', 2 - done)
                .skill('Fletching', 1, 75 * done);
            return (i === 2 || i === 3 ? menu(w) : w).build();
        });
        const { result, driver } = await runOp(few, ctx => fletch(ctx, LOGS, 'arrow shaft', 10));
        expect(result).toMatchObject({ ok: true, xpGained: 150 });
        expect(driver.state().tick).toBe(7);
    });
});

const closeMenu: BotAction = { type: 'closeModal', reason: 'close make menu' };
/** A closeModal takes an open dialog away from the next tick on, as the server's does, then is spent. */
const react: TimelineOptions['react'] = action =>
    action.type === 'closeModal'
        ? s => (s.dialog.isOpen ? { ...s, dialog: { isOpen: false, options: [], isWaiting: false } } : s)
        : undefined;
/** The knife is used at tick 1 and the menu is open from `tick` on. */
const openFrom = (tick: number) =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (i >= tick ? menu(kit.tick(i)) : kit.tick(i)).build());

/** Refuses only the click on a product. */
const refuseClick = (a: BotAction) => (a.type === 'clickDialogOption' ? refuse() : undefined);

describe('fletch owns its make menu', () => {
    test('no-product closes the menu it opened before returning', async () => {
        const { result, sends, driver } = await runOp(openFrom(2), ctx => fletch(ctx, LOGS, 'crossbow'), { react });
        expect(result).toMatchObject({ ok: false, reason: 'no-product' });
        expect(sends).toEqual([useKnife, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test('a batch whose Make button the group lacks is no-product, and the menu is closed', async () => {
        const timeline = [0, 1, 2, 3, 4, 5].map(i => (i >= 2 ? noTen(kit.tick(i)) : kit.tick(i)).build());
        const { result, sends, driver } = await runOp(timeline, ctx => fletch(ctx, LOGS, 'arrow shaft', 10), {
            react,
        });
        expect(result).toEqual({
            ok: false,
            reason: 'no-product',
            message: 'No "Make 10" button for "15 Arrow Shafts"',
        });
        expect(sends).toEqual([useKnife, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test('a refused click leaves no menu behind either', async () => {
        const { result, sends } = await runOp(openFrom(2), ctx => fletch(ctx, LOGS, 'arrow shaft'), {
            react,
            respond: refuseClick,
        });
        expect(result).toMatchObject({ ok: false, reason: 'send-failed' });
        expect(sends.at(-1)).toEqual(closeMenu);
    });

    test('a menu already open is closed before the knife is used, not mistaken for the new one', async () => {
        // Open from the start, gone once closed, open again from tick 4 when the knife has opened the real one.
        const states = [
            menu(kit.tick(0)),
            menu(kit.tick(1)),
            kit.tick(2),
            kit.tick(3),
            ...[4, 5, 6].map(i => menu(kit.tick(i))),
            cut(kit.tick(7)),
        ].map(w => w.build());
        const { result, sends } = await runOp(states, ctx => fletch(ctx, LOGS, 'arrow shaft'), { react });
        expect(result).toMatchObject({ ok: true });
        expect(sends).toEqual([closeMenu, useKnife, choose(3, '15 Arrow Shafts')]);
    });

    test('a stale menu that will not close fails without using the knife', async () => {
        const { result, sends, driver } = await runOp(menu(kit).series(40), ctx => fletch(ctx, LOGS, 'arrow shaft'));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'A make menu was already open and would not close',
        });
        expect(sends).toEqual([closeMenu]);
        expect(driver.state().tick).toBe(1 + FLETCH_CLOSE_TICKS);
    });

    test('cancelled after the menu opened and before the click, it closes the menu in cleanup', async () => {
        // The menu opens at tick 3, the tick the guard fires on, so the op is cancelled inside its wait.
        const states = [kit, kit.tick(1), kit.tick(2), menu(kit.tick(3)), menu(kit.tick(4))].map(w => w.build());
        const driver = new TimelineDriver(states, { react });
        const abort: Guard = { name: 'abort', policy: 'abort', when: s => s.tick >= 3, run: () => ({ fail: 'x' }) };
        const r = await interpret(fletch(driver, LOGS, 'arrow shaft'), { driver, guards: [abort] });
        expect(r.kind).toBe('aborted');
        const sent = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
        expect(sent).toEqual([useKnife, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test('the members refusal is its own reason, whether the server or the client says it', async () => {
        const server = "You need to be on a members' world to gain experience in Fletching.";
        const client = "To use this item please login to a members' server.";
        for (const text of [server, client]) {
            const states = [kit.build(), kit.tick(2).message(text).build(), kit.tick(3).message(text).build()];
            const { result, sends } = await runOp(states, ctx => fletch(ctx, LOGS, 'arrow shaft'));
            expect(result).toEqual({ ok: false, reason: 'members', message: text });
            expect(sends).toEqual([useKnife]);
        }
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
