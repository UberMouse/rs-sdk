import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { isSkillMenu } from '../../actions/dismiss';
import { SPIN_CLOSE_TICKS, SPIN_MENU_TICKS, SPIN_START_TICKS, SPIN_STALL_TICKS, spin } from '../../actions/spin';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { type Guard, interpret } from '../../core/interpret';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

/** The wheel's menu: Wool then Flax, each Make X, Make 10, Make 5 and the product's own button (label after a literal "\n\n\n\n"). */
const MENU = ['Wool', 'Flax'].flatMap(p => ['Make X', 'Make 10', 'Make 5', `\\n\\n\\n\\n${p}`]);
const wheel = world().loc('Spinning wheel', 3209, 3213, { id: 2644, options: ['Spin', 'Examine'] });
const target = wheel.build().nearbyLocs[0]!;
const kit = wheel.skill('Crafting', 35, 0).inv('Flax', 10).tick(1);
const menu = (w: World) => w.dialog({ options: MENU });
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });

const spinSend: BotAction = {
    type: 'interactLoc',
    x: 3209,
    z: 3213,
    locId: 2644,
    optionIndex: 1,
    reason: 'Spin Spinning wheel',
};
const click = (optionIndex: number, reason: string): BotAction => ({ type: 'clickDialogOption', optionIndex, reason });
const count = (value: number): BotAction => ({ type: 'submitCountDialog', value, reason: `spin ${value} flax` });
const closeMenu: BotAction = { type: 'closeModal', reason: 'close spinning menu' };

/**
 * Spin sent at tick 1, menu at ticks 2-3, the queue starting at tick 6 and spinning one every 2 ticks,
 * `n` of them at most (the strings are Bow strings, 375 xp each).
 */
const timeline = (n: number, held = 10, extra: (w: World, i: number) => World = w => w) =>
    Array.from({ length: 60 }, (_, k) => {
        const i = k;
        const done = i < 6 ? 0 : Math.min(Math.floor((i - 6) / 2) + 1, n);
        const w = kit
            .tick(i)
            .inv('Flax', held - done)
            .skill('Crafting', 35, 375 * done);
        return extra(i === 2 || i === 3 ? menu(w) : w, i).build();
    });

/** The result of a spin when the server answers the Spin click with `text` instead of the menu. */
const said = async (text: string) =>
    (
        await runOp([kit.build(), kit.tick(2).message(text).build(), kit.tick(3).message(text).build()], ctx =>
            spin(ctx, target, 'flax'),
        )
    ).result;

describe('spin', () => {
    test('Make X on the flax group, then the count, waits until all are spun', async () => {
        const { result, sends, driver } = await runOp(timeline(10), ctx => spin(ctx, target, 'flax'));
        expect(result).toEqual({ ok: true, spun: 10, xpGained: 3750 });
        // Flax is the second product: its group starts at option 4, so Make X is option 4 and its own button 7.
        expect(sends).toEqual([spinSend, click(4, 'spin flax (Make X)'), count(10)]);
        // The tenth lands at tick 6 + 2 * 9.
        expect(driver.state().tick).toBe(24);
    });

    test('one item clicks the product button and sends no count', async () => {
        const { result, sends } = await runOp(timeline(1, 1), ctx => spin(ctx, target, 'flax', 1));
        expect(result).toMatchObject({ ok: true, spun: 1 });
        expect(sends).toEqual([spinSend, click(7, 'spin flax')]);
    });

    test('the amount is capped by what is held', async () => {
        const { sends } = await runOp(timeline(10), ctx => spin(ctx, target, 'flax', 50));
        expect(sends.at(-1)).toEqual(count(10));
    });

    test('a batch that stops early ends after SPIN_STALL_TICKS with the xp so far', async () => {
        const { result, driver } = await runOp(timeline(3), ctx => spin(ctx, target, 'flax'));
        expect(result).toEqual({ ok: true, spun: 3, xpGained: 1125 });
        expect(driver.state().tick).toBe(10 + SPIN_STALL_TICKS);
    });

    test('a level-up ends the batch at once', async () => {
        const { result, driver } = await runOp(
            timeline(10, 10, (w, i) => (i >= 9 ? levelUp(w.skill('Crafting', 36, 1000 + 375 * 2)) : w)),
            ctx => spin(ctx, target, 'flax'),
        );
        expect(result).toMatchObject({ ok: true });
        expect(driver.state().tick).toBe(9);
    });

    test('no material, no Spin option and a refused send fail at once', async () => {
        const none = await runOp(world().skill('Crafting', 35, 0).inv('Wool', 3).series(1), ctx =>
            spin(ctx, target, 'flax'),
        );
        expect(none.result).toEqual({ ok: false, reason: 'no-material', message: 'No flax in inventory' });
        expect(none.sends).toEqual([]);
        const bare = world()
            .loc('Spinning wheel', 3209, 3213, { id: 2644, options: ['Examine'] })
            .build().nearbyLocs[0]!;
        const noOption = await runOp(kit.series(1), ctx => spin(ctx, bare, 'flax'));
        expect(noOption.result).toMatchObject({ ok: false, reason: 'no-menu' });
        const refused = await runOp(kit.series(1), ctx => spin(ctx, target, 'flax'), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('no menu within its wait is no-menu', async () => {
        const { result, driver } = await runOp(kit.series(1), ctx => spin(ctx, target, 'flax'));
        expect(result).toEqual({ ok: false, reason: 'no-menu', message: 'Spinning menu did not open' });
        expect(driver.state().tick).toBe(1 + SPIN_MENU_TICKS);
    });

    test('"I can\'t reach that!" is cant-reach, and the members and Fremennik refusals their own reasons', async () => {
        expect(await said("I can't reach that!")).toEqual({
            ok: false,
            reason: 'cant-reach',
            message: 'Cannot reach Spinning wheel',
        });
        expect(await said('This is a members feature.')).toMatchObject({ ok: false, reason: 'members' });
        expect(await said('Only Fremenniks may use this spinning wheel.')).toMatchObject({
            ok: false,
            reason: 'not-allowed',
        });
    });

    test('no xp after the click is a timeout; the level box is level-too-low', async () => {
        const stalled = await runOp(timeline(0), ctx => spin(ctx, target, 'flax'));
        expect(stalled.result).toEqual({ ok: false, reason: 'timeout', message: 'Spinning timed out' });
        expect(stalled.driver.state().tick).toBe(2 + SPIN_START_TICKS);
        const box = 'You need level 10 Crafting to make that.';
        const states = timeline(0, 10, (w, i) => (i >= 4 ? w.recentDialog([box]) : w));
        const low = await runOp(states, ctx => spin(ctx, target, 'flax'));
        expect(low.result).toMatchObject({ ok: false, reason: 'level-too-low' });
        // A free world refuses flax only after the menu click.
        const free = timeline(0, 10, (w, i) => (i >= 4 ? w.recentDialog(['This is a members feature.']) : w));
        const members = await runOp(free, ctx => spin(ctx, target, 'flax'));
        expect(members.result).toMatchObject({ ok: false, reason: 'members' });
    });
});

/** A closeModal takes an open dialog away from the next tick on, as the server's does. */
const react: TimelineOptions['react'] = action =>
    action.type === 'closeModal'
        ? s => (s.dialog.isOpen ? { ...s, dialog: { isOpen: false, options: [], isWaiting: false } } : s)
        : undefined;
const openFrom = (tick: number) =>
    Array.from({ length: 12 }, (_, i) => (i >= tick ? menu(kit.tick(i)) : kit.tick(i)).build());

describe('spin owns its menu', () => {
    test('a menu without the material closes the menu it opened', async () => {
        const woolOnly = Array.from({ length: 8 }, (_, i) =>
            (i >= 2 ? kit.tick(i).dialog({ options: MENU.slice(0, 4) }) : kit.tick(i)).build(),
        );
        const { result, sends, driver } = await runOp(woolOnly, ctx => spin(ctx, target, 'flax'), { react });
        expect(result).toMatchObject({ ok: false, reason: 'no-product' });
        expect(sends).toEqual([spinSend, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test('a refused click leaves no menu behind either', async () => {
        const { result, sends } = await runOp(openFrom(2), ctx => spin(ctx, target, 'flax'), {
            react,
            respond: a => (a.type === 'clickDialogOption' ? refuse() : undefined),
        });
        expect(result).toMatchObject({ ok: false, reason: 'send-failed' });
        expect(sends.at(-1)).toEqual(closeMenu);
    });

    test('a stale menu that will not close fails without sending Spin', async () => {
        const { result, sends, driver } = await runOp(menu(kit).series(40), ctx => spin(ctx, target, 'flax'));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'A make menu was already open and would not close',
        });
        expect(sends).toEqual([closeMenu]);
        expect(driver.state().tick).toBe(1 + SPIN_CLOSE_TICKS);
    });

    test('cancelled between the menu opening and the click, it closes the menu in cleanup', async () => {
        const states = [kit, kit.tick(1), kit.tick(2), menu(kit.tick(3)), menu(kit.tick(4))].map(w => w.build());
        const driver = new TimelineDriver(states, { react });
        const abort: Guard = { name: 'abort', policy: 'abort', when: s => s.tick >= 3, run: () => ({ fail: 'x' }) };
        const r = await interpret(spin(driver, target, 'flax'), { driver, guards: [abort] });
        expect(r.kind).toBe('aborted');
        const sent = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
        expect(sent).toEqual([spinSend, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });
});
