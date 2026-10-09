import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import {
    BANK_TRANSFER_WAIT_TICKS,
    CLEANUP_CLOSE_WAIT_TICKS,
    CLOSE_BANK_WAIT_TICKS,
    closeBank,
    deposit,
    ITEM_COMPONENT,
    NOTE_COMPONENT,
    NOTE_TOGGLE_WAIT_TICKS,
    OPEN_BANK_WAIT_TICKS,
    openBank,
    withBank,
    withdraw,
} from '../../actions/bank';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { CLEANUP_TICKS, type Guard, interpret } from '../../core/interpret';
import { send } from '../../core/op';
import { bankWorld } from '../react';
import { BANK_INTERFACE, type World, world } from '../world';
import { refuse, runOp } from './harness';

const BOOTH = { x: 3185, z: 3433 };
const idle = world().loc('Bank booth', BOOTH.x, BOOTH.z, { options: ['Bank', 'Collect'] });
const opened = idle.bank([
    { name: 'Bones', count: 5 },
    { name: 'Copper ore', count: 20 },
]);
const BANK = { slot: 0, id: 526, name: 'Bones', count: 5 };
const cantReach = () => ({ success: false, message: 'no route', reason: 'cant_reach' });

const got = (w: World, n: number) => w.inv('Bones', n).tick(1).build();
const asDriver = (states: BotWorldState[]) => new TimelineDriver(states, { react: bankWorld });
const sendsOf = (d: TimelineDriver) => d.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
const logsOf = (d: TimelineDriver) => d.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
const hurt = (w: World) => w.player({ hp: 3 });
/** Fires below 5 HP: aborts the op, then sends a marker 'eat' (the eat it stands for needs the bank shut). */
const lowHp: Guard = {
    name: 'low-hp',
    policy: 'abort',
    when: s => (s.player?.hp ?? 10) < 5,
    *run() {
        yield* send({ type: 'none', reason: 'eat' });
        return { fail: 'ate' };
    },
};
/** The bank world, but a deposit never lands: its wait is still running when an abort comes. */
const ignoresDeposits: TimelineOptions['react'] = (a, s) => (a.type === 'bankDeposit' ? undefined : bankWorld(a, s));

describe('openBank', () => {
    test('uses the booth Bank option and succeeds once the bank is open', async () => {
        const { result, sends } = await runOp([idle.build(), idle.tick(1).build(), opened.tick(2).build()], openBank);
        expect(result).toEqual({ ok: true, message: `Bank opened (interfaceId: ${BANK_INTERFACE})` });
        expect(sends).toEqual([
            {
                type: 'interactLoc',
                x: BOOTH.x,
                z: BOOTH.z,
                locId: idle.build().nearbyLocs[0]!.id,
                optionIndex: 1,
                reason: 'Bank Bank booth',
            },
        ]);
    });

    test('an open bank is success without sending anything', async () => {
        const { result, sends, driver } = await runOp(opened.series(1), openBank);
        expect(result).toEqual({ ok: true, message: 'Bank already open' });
        expect(sends).toEqual([]);
        expect(driver.ticksElapsed).toBe(0);
    });

    test('Use-quickly, then any Use option, when the booth has no Bank option', async () => {
        for (const [options, index] of [
            [['Use-quickly', 'Collect'], 1],
            [['Collect', 'Use'], 2],
        ] as const) {
            const booth = world().loc('Bank booth', BOOTH.x, BOOTH.z, { options: [...options] });
            const { sends } = await runOp([booth.build(), opened.tick(1).build()], openBank);
            expect(sends[0]).toMatchObject({ type: 'interactLoc', optionIndex: index });
        }
    });

    test('a closed booth is ignored, and a banker is used when no booth offers a bank option', async () => {
        const w = world()
            .loc('Closed bank booth', BOOTH.x, BOOTH.z, { options: ['Bank'] })
            .loc('Bank booth', BOOTH.x + 1, BOOTH.z, { options: ['Collect'] })
            .npc('Banker', BOOTH.x, BOOTH.z + 2, { index: 7, options: ['Talk-to', 'Bank'] });
        const { result, sends } = await runOp([w.build(), opened.tick(1).build()], openBank);
        expect(result.ok).toBe(true);
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: 7, optionIndex: 2, reason: 'Bank Banker' }]);
    });

    test('a booth is preferred over a banker', async () => {
        const w = idle.npc('Banker', BOOTH.x, BOOTH.z + 1, { index: 7, options: ['Bank'] });
        const { sends } = await runOp([w.build(), opened.tick(1).build()], openBank);
        expect(sends[0]).toMatchObject({ type: 'interactLoc' });
    });

    test('no booth or banker, or none with a bank option, is no-bank-found and sends nothing', async () => {
        const none = await runOp(world().series(1), openBank);
        expect(none.result).toEqual({
            ok: false,
            reason: 'no-bank-found',
            message: 'No banker NPC or bank booth found nearby',
        });
        expect(none.sends).toEqual([]);
        const talkOnly = world().npc('Banker', BOOTH.x, BOOTH.z, { options: ['Talk-to'] });
        expect((await runOp(talkOnly.series(1), openBank)).result).toMatchObject({ reason: 'no-bank-found' });
    });

    test("the client finding no route, and the server's can't reach, are cant-reach", async () => {
        const client = await runOp(idle.series(1), openBank, { respond: cantReach });
        expect(client.result).toEqual({ ok: false, reason: 'cant-reach', message: 'no route' });
        expect(client.driver.ticksElapsed).toBe(0);

        const server = await runOp([idle.build(), idle.tick(1).message("I can't reach that!").build()], openBank);
        expect(server.result).toEqual({ ok: false, reason: 'cant-reach', message: "Can't reach bank" });
    });

    test("a can't-reach message from before the send is not an answer to it", async () => {
        const old = idle.message("I can't reach that!");
        const { result, driver } = await runOp(old.series(1), openBank);
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(driver.state().tick).toBe(OPEN_BANK_WAIT_TICKS);
    });

    test("the bank opening on the tick of a can't-reach message wins", async () => {
        const both = opened.tick(1).message("I can't reach that!");
        const { result } = await runOp([idle.build(), both.build()], openBank);
        expect(result.ok).toBe(true);
    });

    test('a bank that never opens is a timeout after OPEN_BANK_WAIT_TICKS', async () => {
        const { result, driver } = await runOp(idle.series(1), openBank);
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Timeout waiting for bank interface to open' });
        expect(driver.state().tick).toBe(OPEN_BANK_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(idle.series(1), openBank, { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

describe('closeBank', () => {
    test('sends a close and succeeds once the interface and bank are both closed', async () => {
        const { result, sends } = await runOp(
            [opened.build(), opened.tick(1).build(), idle.tick(2).build()],
            closeBank,
        );
        expect(result).toEqual({ ok: true, message: 'Bank closed' });
        expect(sends).toEqual([{ type: 'closeModal', reason: 'close bank' }]);
    });

    test('bank.isOpen outlasting interface.isOpen by a frame is not closed yet', async () => {
        const lagging = { ...idle.tick(1).build(), bank: opened.build().bank } satisfies BotWorldState;
        const { result, driver } = await runOp([opened.build(), lagging, idle.tick(2).build()], closeBank);
        expect(result.ok).toBe(true);
        expect(driver.state().tick).toBe(2);
    });

    test('already closed is success without sending', async () => {
        const { result, sends } = await runOp(idle.series(1), closeBank);
        expect(result).toEqual({ ok: true, message: 'Bank already closed' });
        expect(sends).toEqual([]);
    });

    test('a close that shows no effect is sent again once, and counts if the second takes', async () => {
        const states = opened.series(CLOSE_BANK_WAIT_TICKS + 2, (w, i) =>
            i > CLOSE_BANK_WAIT_TICKS ? w.bank(false) : w,
        );
        const { result, sends } = await runOp(states, closeBank);
        expect(result).toEqual({ ok: true, message: 'Bank closed (second attempt)' });
        expect(sends.map(s => s.reason)).toEqual(['close bank', 'close bank (second attempt)']);
    });

    test('a bank that stays open is a timeout naming both flags', async () => {
        const { result, sends } = await runOp(opened.series(1), closeBank);
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Bank close timeout - interface.isOpen=true, bank.isOpen=true',
        });
        expect(sends).toHaveLength(2);
    });

    test('a refused send is send-failed, first or second', async () => {
        const first = await runOp(opened.series(1), closeBank, { respond: refuse });
        expect(first.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        let n = 0;
        const second = await runOp(opened.series(1), closeBank, { respond: () => (++n > 1 ? refuse() : undefined) });
        expect(second.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

const carrying = opened.inv('Logs', 3).inv('Oak logs', 1).inv('Coins', 100);
const LOGS = /^logs$/i;

describe('deposit', () => {
    test("'all' deposits every slot of the item and reports the amount", async () => {
        const { result, sends } = await runOp([carrying.build(), carrying.inv('Logs', 0).tick(1).build()], ctx =>
            deposit(ctx, LOGS),
        );
        expect(result).toEqual({ ok: true, amountDeposited: 3, message: 'Deposited Logs x3' });
        expect(sends).toEqual([{ type: 'bankDeposit', slot: 0, amount: -1, reason: 'deposit Logs' }]);
    });

    test('a number deposits that many, and a stack counts by size', async () => {
        const { result, sends } = await runOp(
            [carrying.build(), carrying.inv('Coins', 40).tick(1).build()],
            ctx => deposit(ctx, /^coins$/i, 60),
            {},
        );
        expect(result).toEqual({ ok: true, amountDeposited: 60, message: 'Deposited Coins x60' });
        expect(sends[0]).toMatchObject({ amount: 60 });
    });

    test('an inventory item is deposited as given', async () => {
        const oak = carrying.build().inventory.find(i => i.name === 'Oak logs')!;
        const { sends } = await runOp([carrying.build(), carrying.inv('Oak logs', 0).tick(1).build()], ctx =>
            deposit(ctx, oak, 1),
        );
        expect(sends).toEqual([{ type: 'bankDeposit', slot: oak.slot, amount: 1, reason: 'deposit Oak logs' }]);
    });

    test('fewer than asked leaving the inventory is partial-fill', async () => {
        const { result } = await runOp([carrying.build(), carrying.inv('Logs', 1).tick(1).build()], ctx =>
            deposit(ctx, LOGS, 3),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'partial-fill',
            amountDeposited: 2,
            message: 'Deposited Logs x2 of 3 requested',
        });
        const more = await runOp([carrying.build(), carrying.inv('Logs', 1).tick(1).build()], ctx =>
            deposit(ctx, LOGS, 5),
        );
        expect(more.result).toMatchObject({ reason: 'partial-fill', message: 'Deposited Logs x2 of 5 requested' });
    });

    test('a pattern matching several items with all deposits each, and reports the total', async () => {
        const { result, sends } = await runOp(
            [
                carrying.build(),
                carrying.inv('Logs', 0).tick(1).build(),
                carrying.inv('Logs', 0).inv('Oak logs', 0).tick(2).build(),
            ],
            ctx => deposit(ctx, /logs/i),
        );
        expect(result).toEqual({ ok: true, amountDeposited: 4, message: 'Deposited 4 across Logs, Oak logs' });
        expect(sends.map(s => s.reason)).toEqual(['deposit Logs', 'deposit Oak logs']);
    });

    test('one id failing does not stop the rest, and the total and failures are reported', async () => {
        const stuck = carrying.inv('Logs', 0).inv('Oak logs', 0);
        const { result, sends } = await runOp(
            [carrying.build(), carrying.tick(1).build()],
            ctx => deposit(ctx, /logs/i),
            {
                react: (a, s) =>
                    a.type === 'bankDeposit' && s.inventory[a.slot]?.name === 'Oak logs'
                        ? () => stuck.tick(2).build()
                        : undefined,
            },
        );
        expect(sends).toHaveLength(2);
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            amountDeposited: 1,
            message: 'Deposited 1 across Logs, Oak logs; failed: Logs: Timeout waiting for Logs to be deposited',
        });
    });

    test('no match is item-not-found, a bad amount invalid-amount, a closed bank bank-not-open: nothing sent', async () => {
        const none = await runOp(carrying.series(1), ctx => deposit(ctx, /^gold$/i));
        expect(none.result).toEqual({
            ok: false,
            reason: 'item-not-found',
            amountDeposited: 0,
            message: 'Item not found in inventory: /^gold$/i',
        });
        for (const amount of [0, -2, 1.5]) {
            const bad = await runOp(carrying.series(1), ctx => deposit(ctx, LOGS, amount));
            expect(bad.result).toMatchObject({ reason: 'invalid-amount' });
        }
        const closed = await runOp(carrying.bank(false).series(1), ctx => deposit(ctx, LOGS));
        expect(closed.result).toEqual({
            ok: false,
            reason: 'bank-not-open',
            amountDeposited: 0,
            message: 'Bank is not open',
        });
        expect(none.sends.concat(closed.sends)).toEqual([]);
    });

    test('items that never leave the inventory are a timeout after the wait', async () => {
        const { result, driver } = await runOp(carrying.series(1), ctx => deposit(ctx, LOGS));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            amountDeposited: 0,
            message: 'Timeout waiting for Logs to be deposited',
        });
        expect(driver.state().tick).toBe(BANK_TRANSFER_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result, driver } = await runOp(carrying.series(1), ctx => deposit(ctx, LOGS), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', amountDeposited: 0, message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});

describe('withdraw', () => {
    test('sends the bank slot and succeeds once the item arrives', async () => {
        const { result, sends } = await runOp([opened.build(), got(opened, 3)], ctx => withdraw(ctx, /^bones$/i, 3));
        expect(result).toMatchObject({ ok: true, amountWithdrawn: 3, message: 'Withdrew Bones x3' });
        expect(result.ok && result.item?.name).toBe('Bones');
        expect(sends).toEqual([{ type: 'bankWithdraw', slot: 0, amount: 3, reason: 'withdraw Bones' }]);
    });

    test("'all' asks for the whole stack; a slot number and a bank item work as targets", async () => {
        const byPattern = await runOp([opened.build(), got(opened, 5)], ctx => withdraw(ctx, /bones/i, 'all'));
        expect(byPattern.result).toMatchObject({ ok: true, amountWithdrawn: 5 });
        expect(byPattern.sends[0]).toMatchObject({ amount: -1 });
        const bySlot = await runOp([opened.build(), got(opened, 1)], ctx => withdraw(ctx, 0));
        expect(bySlot.sends[0]).toMatchObject({ slot: 0, amount: 1 });
        const byItem = await runOp([opened.build(), got(opened, 1)], ctx => withdraw(ctx, BANK, 1));
        expect(byItem.result.ok).toBe(true);
    });

    test('fewer than asked arriving is partial-fill', async () => {
        const { result } = await runOp([opened.build(), got(opened, 2)], ctx => withdraw(ctx, /bones/i, 4));
        expect(result).toEqual({
            ok: false,
            reason: 'partial-fill',
            amountWithdrawn: 2,
            message: 'Withdrew Bones x2 of 4 requested',
        });
    });

    test('an item that never arrives is a timeout after the wait', async () => {
        const { result, driver } = await runOp(opened.series(1), ctx => withdraw(ctx, /bones/i));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            amountWithdrawn: 0,
            message: 'Timeout waiting for Bones to be withdrawn',
        });
        expect(driver.state().tick).toBe(BANK_TRANSFER_WAIT_TICKS);
    });

    test('a note withdrawal flips the toggle first and counts the note by name', async () => {
        const note = opened.bank([{ name: 'Bones', count: 5 }], true);
        const arrived = note.inv('Bones', 3, { id: 527 }).tick(2).build();
        const { result, sends } = await runOp([opened.build(), note.tick(1).build(), arrived], ctx =>
            withdraw(ctx, /bones/i, 3, { asNote: true }),
        );
        expect(result).toMatchObject({ ok: true, amountWithdrawn: 3 });
        expect(sends.map(s => s.type)).toEqual(['clickComponent', 'bankWithdraw']);
        expect(sends[0]).toMatchObject({ componentId: NOTE_COMPONENT });
    });

    test('an item withdrawal turns note mode back off first', async () => {
        const noted = opened.bank([{ name: 'Bones', count: 5 }], true);
        const { sends } = await runOp([noted.build(), opened.tick(1).build(), got(opened, 1)], ctx =>
            withdraw(ctx, /bones/i),
        );
        expect(sends[0]).toMatchObject({ type: 'clickComponent', componentId: ITEM_COMPONENT });
    });

    test('a toggle that never registers is a timeout, and a refused one send-failed', async () => {
        const { result, driver, sends } = await runOp(opened.series(1), ctx =>
            withdraw(ctx, /bones/i, 1, { asNote: true }),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            amountWithdrawn: 0,
            message: 'Bank note withdrawal toggle did not register',
        });
        expect(driver.state().tick).toBe(NOTE_TOGGLE_WAIT_TICKS);
        expect(sends).toHaveLength(1);
        const refused = await runOp(opened.series(1), ctx => withdraw(ctx, /bones/i, 1, { asNote: true }), {
            respond: refuse,
        });
        expect(refused.result).toMatchObject({ reason: 'send-failed' });
    });

    test('no match, a bad amount and a closed bank fail before any send', async () => {
        const none = await runOp(opened.series(1), ctx => withdraw(ctx, /gold/i));
        expect(none.result).toEqual({
            ok: false,
            reason: 'item-not-found',
            amountWithdrawn: 0,
            message: 'Bank item not found: /gold/i',
        });
        expect((await runOp(opened.series(1), ctx => withdraw(ctx, 9))).result).toMatchObject({
            reason: 'item-not-found',
        });
        expect((await runOp(opened.series(1), ctx => withdraw(ctx, /bones/i, 0))).result).toMatchObject({
            reason: 'invalid-amount',
        });
        const closed = await runOp(idle.series(1), ctx => withdraw(ctx, /bones/i));
        expect(closed.result).toEqual({
            ok: false,
            reason: 'bank-not-open',
            amountWithdrawn: 0,
            message: 'Bank is not open',
        });
        expect(none.sends.concat(closed.sends)).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(opened.series(1), ctx => withdraw(ctx, /bones/i), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', amountWithdrawn: 0, message: 'not connected' });
    });
});

describe('withBank', () => {
    test('opens, runs the body with the bank open, then closes and reports the close', async () => {
        const driver = asDriver([idle.build(), opened.tick(1).build()]);
        const r = await interpret(
            withBank(
                driver,
                (function* () {
                    yield* send({ type: 'none', reason: 'body' });
                    return 7;
                })(),
            ),
            { driver },
        );
        expect(r).toEqual({
            kind: 'returned',
            value: { ok: true, value: 7, closed: { ok: true, message: 'Bank closed' } },
        });
        expect(sendsOf(driver)).toEqual(['Bank Bank booth', 'body', 'close bank']);
    });

    test('a failed open skips the body and returns the failure', async () => {
        const driver = asDriver(world().series(1));
        const body = (function* () {
            yield* send({ type: 'none', reason: 'body' });
        })();
        const r = await interpret(withBank(driver, body), { driver });
        expect(r).toMatchObject({ kind: 'returned', value: { ok: false, reason: 'no-bank-found' } });
        expect(sendsOf(driver)).toEqual([]);
    });

    test('an abort while the deposit is still waiting closes the bank first, then the guard runs', async () => {
        // The deposit never lands, so HP drops while its wait is mid-flight: only withBank's finally can
        // close the bank. The guard's work (an eat, here a marker send) must come after the close, as the
        // open bank hides the inventory it would eat from.
        const driver = new TimelineDriver(
            [carrying.build(), carrying.tick(1).build(), hurt(carrying).tick(2).build()],
            {
                react: ignoresDeposits,
            },
        );
        const r = await interpret(withBank(driver, deposit(driver, LOGS)), { driver, guards: [lowHp] });
        expect(r).toEqual({ kind: 'aborted', by: 'low-hp', outcome: { fail: 'ate' } });
        expect(sendsOf(driver)).toEqual(['deposit Logs', 'close bank', 'eat']);
        expect(driver.state().bank.isOpen).toBe(false);
        expect(driver.state().inventory.some(i => i.name === 'Logs')).toBe(true);
    });

    test('a stop while the deposit is still waiting closes the bank too', async () => {
        const driver = new TimelineDriver([carrying.build()], { react: ignoresDeposits });
        const r = await interpret(withBank(driver, deposit(driver, LOGS)), {
            driver,
            onTick: s => (s.tick >= 2 ? 'time up' : null),
        });
        expect(r).toEqual({ kind: 'cancelled', reason: 'time up' });
        expect(sendsOf(driver)).toEqual(['deposit Logs', 'close bank']);
        expect(driver.state().bank.isOpen).toBe(false);
    });

    test('cancelled, a first close with no effect is sent again and lands inside the cleanup cap', async () => {
        expect(2 * CLEANUP_CLOSE_WAIT_TICKS + 1).toBeLessThanOrEqual(CLEANUP_TICKS);
        let closes = 0;
        const sentAt: [string, number][] = [];
        const driver: TimelineDriver = new TimelineDriver(
            [carrying.build(), carrying.tick(1).build(), hurt(carrying).tick(2).build()],
            {
                react: (a, s) =>
                    a.type === 'bankDeposit' || (a.type === 'closeModal' && ++closes === 1)
                        ? undefined
                        : bankWorld(a, s),
                respond: a => {
                    sentAt.push([a.reason, driver.state().tick]);
                    return undefined;
                },
            },
        );
        const r = await interpret(withBank(driver, deposit(driver, LOGS)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sentAt).toEqual([
            ['deposit Logs', 0],
            ['close bank', 2],
            ['close bank (second attempt)', 2 + CLEANUP_CLOSE_WAIT_TICKS],
            ['eat', 3 + CLEANUP_CLOSE_WAIT_TICKS],
        ]);
        expect(driver.state().bank.isOpen).toBe(false);
        expect(logsOf(driver).filter(m => m.startsWith('cleanup'))).toEqual([]);
    });

    test('cancelled mid-open, a bank that opens late is closed before the guard runs', async () => {
        const states = idle.series(6, (w, i) => (i >= 3 ? hurt(w).bank([]) : i >= 1 ? hurt(w) : w));
        const driver = asDriver(states);
        const r = await interpret(withBank(driver, deposit(driver, LOGS)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sendsOf(driver)).toEqual(['Bank Bank booth', 'close bank', 'eat']);
        expect(driver.state().bank.isOpen).toBe(false);
    });

    test('cancelled mid-open with no bank showing, one close is still sent', async () => {
        const driver = asDriver([idle.build(), hurt(idle).tick(1).build()]);
        const r = await interpret(withBank(driver, deposit(driver, LOGS)), { driver, guards: [lowHp] });
        expect(r).toMatchObject({ kind: 'aborted', by: 'low-hp' });
        expect(sendsOf(driver)).toEqual(['Bank Bank booth', 'close bank (open not confirmed)', 'eat']);
        expect(driver.state().tick).toBe(1 + CLEANUP_CLOSE_WAIT_TICKS);
    });

    test('a body that throws still closes the bank, and the error propagates', async () => {
        const driver = asDriver([opened.build()]);
        const body = (function* () {
            yield* send({ type: 'none', reason: 'body' });
            throw new Error('boom');
        })();
        await expect(interpret(withBank(driver, body), { driver })).rejects.toThrow('boom');
        expect(sendsOf(driver)).toEqual(['body', 'close bank']);
    });

    test('an open that timed out but landed late is still closed', async () => {
        // The bank shows two ticks after openBank gave up, inside the wait for a late open.
        const late = idle.series(OPEN_BANK_WAIT_TICKS + 3, (w, i) => (i > OPEN_BANK_WAIT_TICKS + 1 ? w.bank([]) : w));
        const driver = asDriver(late);
        const body = (function* () {})();
        const r = await interpret(withBank(driver, body), { driver });
        expect(r).toMatchObject({ kind: 'returned', value: { ok: false, reason: 'timeout' } });
        expect(sendsOf(driver)).toEqual(['Bank Bank booth', 'close bank']);
        expect(driver.state().bank.isOpen).toBe(false);
    });
});
