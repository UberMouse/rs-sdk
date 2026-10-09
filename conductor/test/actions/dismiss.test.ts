import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import {
    closableInterface,
    DISMISS_MAX_ACTIONS,
    DISMISS_WAIT_TICKS,
    dismiss,
    isSkillMenu,
    NEVER_CLOSE_INTERFACES,
} from '../../actions/dismiss';
import { world } from '../world';
import { refuse, runOp } from './harness';

/** A main modal outside NEVER_CLOSE_INTERFACES, standing in for a book or quest scroll. */
const BOOK = 1234;
const TRADE = 3323;
const levelUp = world().dialog({ text: 'Congratulations', options: ['Click here to continue'] });
const closed = world();
const click = (optionIndex: number): BotAction => ({
    type: 'clickDialogOption',
    optionIndex,
    reason: 'continue dialog',
});

describe('dismiss', () => {
    test('clicks a continue dialog by its first option index and waits for it to close', async () => {
        // The live client publishes "Click here to continue" at index 1.
        const page = levelUp.build();
        const open = { ...page, dialog: { ...page.dialog, options: [{ index: 1, text: 'Click here to continue' }] } };
        const { result, sends, driver } = await runOp([open, { ...open, tick: 1 }, closed.tick(2).build()], dismiss);
        expect(result).toEqual({ ok: true, actions: 1 });
        expect(sends).toEqual([click(1)]);
        expect(driver.state().tick).toBe(2);
    });

    test('clicks through each page of a multi-page dialog', async () => {
        const second = world().dialog({ text: 'Your level is now 2', options: ['Click here to continue'] });
        const states = [levelUp.build(), second.tick(1).build(), closed.tick(2).build()];
        const { result, sends } = await runOp(states, dismiss);
        expect(result).toEqual({ ok: true, actions: 2 });
        expect(sends).toEqual([click(0), click(0)]);
    });

    test('a page that publishes no option is clicked with 0', async () => {
        const bare = world().dialog();
        const { result, sends } = await runOp([bare.build(), closed.build()], dismiss);
        expect(result).toEqual({ ok: true, actions: 1 });
        expect(sends).toEqual([click(0)]);
    });

    test('a choice is left unanswered, with nothing sent', async () => {
        const choice = world().dialog({ options: ['Yes', 'No'] });
        const { result, sends } = await runOp([choice.build()], dismiss);
        expect(result).toEqual({ ok: false, reason: 'choice', message: 'a choice is open: Yes | No' });
        expect(sends).toEqual([]);
    });

    test('a skill make menu is left to the op that opened it, also when a level-up click reveals it', async () => {
        const menu = world().dialog({ options: ['Make X', 'Make 10', 'Make 5', 'Short Bow'] });
        const alone = await runOp(menu.series(1), dismiss);
        expect(alone.result).toEqual({ ok: true, actions: 0 });
        expect(alone.sends).toEqual([]);

        const revealed = await runOp([levelUp.build(), menu.tick(1).build()], dismiss);
        expect(revealed.result).toEqual({ ok: true, actions: 1 });
        expect(revealed.sends).toEqual([click(0)]);
    });

    test('a page that does not move on within its wait is stuck', async () => {
        const { result, driver } = await runOp(levelUp.series(1), dismiss);
        expect(result).toEqual({
            ok: false,
            reason: 'stuck',
            message: 'dialog still on the same page: Click here to continue',
        });
        expect(driver.state().tick).toBe(DISMISS_WAIT_TICKS);
    });

    test('a dialog that keeps changing page is stuck after the click cap', async () => {
        const states = Array.from({ length: 30 }, (_, t) =>
            world()
                .tick(t)
                .dialog({ text: `page ${t}` })
                .build(),
        );
        const { result, sends } = await runOp(states, dismiss);
        expect(result).toEqual({
            ok: false,
            reason: 'stuck',
            message: `still blocked after ${DISMISS_MAX_ACTIONS} clicks or closes`,
        });
        expect(sends).toHaveLength(DISMISS_MAX_ACTIONS);
    });

    test('closes an informational modal, after the dialogs', async () => {
        const both = levelUp.modal(BOOK);
        const states = [both.build(), world().modal(BOOK).tick(1).build(), closed.tick(2).build()];
        const { result, sends } = await runOp(states, dismiss);
        expect(result).toEqual({ ok: true, actions: 2 });
        const close: BotAction = { type: 'closeModal', reason: `close interface ${BOOK}` };
        expect(sends).toEqual([click(0), close]);
    });

    test('a modal that stays open is stuck', async () => {
        const { result } = await runOp(world().modal(BOOK).series(1), dismiss);
        expect(result).toEqual({ ok: false, reason: 'stuck', message: `interface ${BOOK} still open` });
    });

    test('leaves a trade screen, a shop and a bank alone', async () => {
        const trade = world().modal(TRADE).build();
        const shop = { ...world().modal(300).build(), shop: { ...trade.shop, isOpen: true } };
        for (const s of [trade, shop]) {
            const { result, sends } = await runOp([s], dismiss);
            expect(result).toEqual({ ok: true, actions: 0 });
            expect(sends).toEqual([]);
        }
    });

    test('dialogs: false leaves a dialog open; modals: false leaves a modal open', async () => {
        const both = levelUp.modal(BOOK);
        const modalsOnly = await runOp([both.build(), levelUp.tick(1).build()], ctx =>
            dismiss(ctx, { dialogs: false }),
        );
        expect(modalsOnly.result).toEqual({ ok: true, actions: 1 });
        expect(modalsOnly.sends.map(a => a.type)).toEqual(['closeModal']);

        const dialogsOnly = await runOp([both.build(), world().modal(BOOK).tick(1).build()], ctx =>
            dismiss(ctx, { modals: false }),
        );
        expect(dialogsOnly.result).toEqual({ ok: true, actions: 1 });
        expect(dialogsOnly.sends.map(a => a.type)).toEqual(['clickDialogOption']);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await runOp(levelUp.series(1), dismiss, { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('nothing open is ok at once', async () => {
        const { result, sends } = await runOp(closed.series(1), dismiss);
        expect(result).toEqual({ ok: true, actions: 0 });
        expect(sends).toEqual([]);
    });
});

describe('isSkillMenu', () => {
    test('a make menu has Make X / Make 10 / Make 5 buttons; a level-up or a choice does not', () => {
        const menu = world()
            .dialog({ options: ['Make X', 'Make 10', 'Make 5', '15 Arrow Shafts'] })
            .build();
        expect(isSkillMenu(menu.dialog)).toBe(true);
        expect(isSkillMenu(levelUp.build().dialog)).toBe(false);
        expect(
            isSkillMenu(
                world()
                    .dialog({ options: ['Yes', 'No'] })
                    .build().dialog,
            ),
        ).toBe(false);
        expect(isSkillMenu({ ...menu.dialog, isOpen: false })).toBe(false);
    });
});

describe('closableInterface', () => {
    test('never closes exactly the ids sdk/actions.ts NEVER_AUTO_CLOSE lists', () => {
        const source = readFileSync(new URL('../../../sdk/actions.ts', import.meta.url), 'utf8');
        const body = /NEVER_AUTO_CLOSE = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1];
        expect(body, 'NEVER_AUTO_CLOSE not found in sdk/actions.ts').toBeDefined();
        const sdkIds = [...(body ?? '').replace(/\/\/.*$/gm, '').matchAll(/\d+/g)].map(m => Number(m[0]));
        expect(sdkIds.length).toBeGreaterThan(0);
        expect([...NEVER_CLOSE_INTERFACES].sort()).toEqual(sdkIds.sort());
    });

    test('closes only what bot.dismissBlockingUI would: no shop, bank, GE or never-close modal', () => {
        const book = world().modal(BOOK).build();
        expect(closableInterface(book)).toBe(true);
        expect(closableInterface(world().build())).toBe(false);
        expect(closableInterface({ ...book, shop: { ...book.shop, isOpen: true } })).toBe(false);
        expect(closableInterface({ ...book, bank: { ...book.bank, isOpen: true } })).toBe(false);
        // Only isOpen matters here; the rest of the exchange's state is irrelevant.
        expect(closableInterface({ ...book, ge: { isOpen: true } as BotWorldState['ge'] })).toBe(false);
        for (const id of NEVER_CLOSE_INTERFACES)
            expect(closableInterface(world().modal(id).build()), `${id}`).toBe(false);
    });
});
