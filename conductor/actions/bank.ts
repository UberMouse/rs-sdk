// Ported from sdk/actions.ts openBank, closeBank, depositItem, withdrawItem @ 4c2069cc0
// Differences from the bot.* methods:
// - openBank does not walk to the booth or retry through a door (withDoorRetry): the client's own
//   pathing covers the last tiles, and a task walks first when it must. It does not click through a
//   dialog the interaction opens either: the booth's Bank option and the banker's Bank option open the
//   interface directly, so a dialog here is a level-up, which the dialog guard clears.
// - "Open" means the bank state (bank.isOpen: the component link that gates item sends and fills
//   bank.items), not any open interface, so a leftover book is not "already open".
// - A send the client refuses is `send-failed` (upstream ignores it and waits out the timeout), and
//   "I can't reach that!" from the client or the server is `cant-reach`.
// - deposit and withdraw take an item or a pattern (and withdraw a bank slot); amounts are a positive
//   integer or 'all', not -1. Each decides from the state its wait ended on.
// withBank has no upstream method: it pairs openBank with closeBank so an abort cannot leave the bank
// open (see withBank).
import {
    classifyQuantity,
    MAX_BANK_ACTION_QUANTITY,
    shortestNameMatch,
    validateActionQuantity,
} from '../../sdk/action-quantity';
import type { BankItem, BotAction, BotWorldState, InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { type Op, send, ticks, wait } from '../core/op';
import { countItemId, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

/** bot.openBank's 10s timeout, in ticks. */
export const OPEN_BANK_WAIT_TICKS = Math.ceil(10_000 / TICK_MS);
/** bot.closeBank's 5s wait for each close attempt, in ticks. */
export const CLOSE_BANK_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** depositItem's and withdrawItem's 5s wait for the items to move, in ticks. */
export const BANK_TRANSFER_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** withdrawItem's 3s wait for the note/item toggle to register, in ticks. */
export const NOTE_TOGGLE_WAIT_TICKS = Math.ceil(3000 / TICK_MS);

/** bank_main:com_93 (withdraw as notes) and bank_main:com_94 (withdraw as items). */
export const NOTE_COMPONENT = 5386;
export const ITEM_COMPONENT = 5387;
const CANT_REACH = /can't reach|cannot reach/i;

type Failure<R extends string> = { ok: false; reason: R; message: string };

export type OpenBankResult =
    | { ok: true; message: string }
    | Failure<'no-bank-found' | 'cant-reach' | 'send-failed' | 'timeout'>;
export type CloseBankResult = { ok: true; message: string } | Failure<'send-failed' | 'timeout'>;

type TransferFailure =
    | 'invalid-amount'
    | 'bank-not-open'
    | 'item-not-found'
    | 'partial-fill'
    | 'send-failed'
    | 'timeout';
export type DepositResult =
    | { ok: true; amountDeposited: number; message: string }
    | (Failure<TransferFailure> & { amountDeposited: number });
export type WithdrawResult =
    | { ok: true; amountWithdrawn: number; item: InventoryItem | undefined; message: string }
    | (Failure<TransferFailure> & { amountWithdrawn: number });

/**
 * The nearest booth or chest that can open the bank: not a 'Closed bank booth' (Fishing Guild), which
 * matches the name and may publish options but no bank op.
 */
function findUsableBooth(s: BotWorldState): NearbyLoc | null {
    const booths = s.nearbyLocs
        .filter(l => /bank booth|bank chest/i.test(l.name) && !/^closed/i.test(l.name) && l.optionsWithIndex.length > 0)
        .sort((a, b) => a.distance - b.distance);
    return booths.find(l => l.optionsWithIndex.some(o => /bank|use/i.test(o.text))) ?? booths[0] ?? null;
}

/** The option that opens the bank, in upstream's order: Bank, Use-quickly, then any Use. */
const boothOption = (booth: NearbyLoc) =>
    booth.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ??
    booth.optionsWithIndex.find(o => /use.quickly/i.test(o.text)) ??
    booth.optionsWithIndex.find(o => /use/i.test(o.text));

/**
 * Opens the bank by its booth (preferred: stationary) or a banker, and waits for the bank to open.
 * `no-bank-found` is no booth or banker in view with a usable option (bank booths only publish within
 * a few tiles: walk to the bank first); `cant-reach` the client finding no route or the server's "I
 * can't reach that!". Already open is success without sending anything.
 */
export function* openBank(ctx: ActionContext): Op<OpenBankResult> {
    const before = ctx.state();
    if (before.bank.isOpen) return { ok: true, message: 'Bank already open' };
    const booth = findUsableBooth(before);
    const boothOp = booth && boothOption(booth);
    const banker: NearbyNpc | null = shortestNameMatch(before.nearbyNpcs, /banker/i);
    const bankerOp = banker?.optionsWithIndex.find(o => /^bank$/i.test(o.text));
    const cursor = messageCursor(before);

    let action: BotAction;
    if (booth && boothOp) {
        action = {
            type: 'interactLoc',
            x: booth.x,
            z: booth.z,
            locId: booth.id,
            optionIndex: boothOp.opIndex,
            reason: `${boothOp.text} ${booth.name}`,
        };
    } else if (banker && bankerOp) {
        action = {
            type: 'interactNpc',
            npcIndex: banker.index,
            optionIndex: bankerOp.opIndex,
            reason: `${bankerOp.text} ${banker.name}`,
        };
    } else {
        return { ok: false, reason: 'no-bank-found', message: 'No banker NPC or bank booth found nearby' };
    }
    const sent = yield* send(action);
    if (!sent.success) {
        const cant = sent.reason === 'cant_reach';
        return { ok: false, reason: cant ? 'cant-reach' : 'send-failed', message: sent.message };
    }

    const cantReach = (s: BotWorldState) => messageSince(s, cursor, CANT_REACH) !== null;
    const w = yield* wait('bank open', s => s.bank.isOpen || cantReach(s), OPEN_BANK_WAIT_TICKS);
    // The interface may have opened on a retry even after a can't-reach message, so it is checked first.
    if (w.state.bank.isOpen)
        return { ok: true, message: `Bank opened (interfaceId: ${w.state.interface.interfaceId})` };
    if (cantReach(w.state)) return { ok: false, reason: 'cant-reach', message: "Can't reach bank" };
    return { ok: false, reason: 'timeout', message: 'Timeout waiting for bank interface to open' };
}

/** bank.isOpen can read true for a frame after interface.isOpen drops, so both must be clear. */
const bankClosed = (s: BotWorldState) => !s.interface.isOpen && !s.bank.isOpen;

/** Closes the bank, with a second try if the first shows no effect; already closed is success. */
export function* closeBank(ctx: ActionContext): Op<CloseBankResult> {
    if (bankClosed(ctx.state())) return { ok: true, message: 'Bank already closed' };
    const sent = yield* send({ type: 'closeModal', reason: 'close bank' });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait('bank closed', bankClosed, CLOSE_BANK_WAIT_TICKS);
    if (w.kind === 'met') return { ok: true, message: 'Bank closed' };
    const again = yield* send({ type: 'closeModal', reason: 'close bank (second attempt)' });
    if (!again.success) return { ok: false, reason: 'send-failed', message: again.message };
    const last = yield* ticks(1);
    if (bankClosed(last)) return { ok: true, message: 'Bank closed (second attempt)' };
    return {
        ok: false,
        reason: 'timeout',
        message: `Bank close timeout - interface.isOpen=${last.interface.isOpen}, bank.isOpen=${last.bank.isOpen}`,
    };
}

export type WithBankResult<T> =
    | { ok: true; value: T; closed: CloseBankResult }
    | Extract<OpenBankResult, { ok: false }>;

/**
 * Runs `body` with the bank open and closes it afterwards, however `body` ends: the close is in a
 * `finally`, so an abort (a guard, a stop, the step budget throws `Cancelled` into the op) closes the
 * bank first, under the interpreter's bounded cleanup, before the guard's own work runs. That matters
 * because an open bank hides the inventory: the low-HP guard's eat would be refused server-side. The
 * interface guard leaves a bank alone by design, so this pairing is the only thing that closes it.
 *
 * Opening is inside the `try` too, as an open that timed out can still land. `closed` is the close
 * attempt's own result for the normal path; a failed open skips `body`.
 */
export function* withBank<T>(ctx: ActionContext, body: Op<T>): Op<WithBankResult<T>> {
    let value: T;
    let closed: CloseBankResult;
    try {
        const opened = yield* openBank(ctx);
        if (!opened.ok) return opened;
        value = yield* body;
    } finally {
        closed = yield* closeBank(ctx);
    }
    return { ok: true, value, closed };
}

const asDispatch = (amount: number | 'all') => (amount === 'all' ? -1 : amount);

function* depositSlot(
    s: BotWorldState,
    item: InventoryItem,
    dispatch: number,
): Op<{ result: DepositResult; state: BotWorldState }> {
    const countBefore = countItemId(s, item.id);
    const requested = dispatch === -1 ? countBefore : dispatch;
    const sent = yield* send({
        type: 'bankDeposit',
        slot: item.slot,
        amount: dispatch,
        reason: `deposit ${item.name}`,
    });
    if (!sent.success)
        return { result: { ok: false, reason: 'send-failed', amountDeposited: 0, message: sent.message }, state: s };
    const w = yield* wait(
        `deposit ${item.name}`,
        st => countItemId(st, item.id) < countBefore,
        BANK_TRANSFER_WAIT_TICKS,
    );
    if (w.kind === 'timeout')
        return {
            result: {
                ok: false,
                reason: 'timeout',
                amountDeposited: 0,
                message: `Timeout waiting for ${item.name} to be deposited`,
            },
            state: w.state,
        };
    const amountDeposited = Math.max(0, countBefore - countItemId(w.state, item.id));
    if (classifyQuantity(requested, amountDeposited).complete)
        return {
            result: { ok: true, amountDeposited, message: `Deposited ${item.name} x${amountDeposited}` },
            state: w.state,
        };
    return {
        result: {
            ok: false,
            reason: 'partial-fill',
            amountDeposited,
            message: `Deposited ${item.name} x${amountDeposited} of ${requested} requested`,
        },
        state: w.state,
    };
}

/**
 * Deposits `amount` of `item` (an inventory item, or the shortest-named match of a pattern), or all
 * of it. `'all'` with a pattern deposits every distinct matching item id, so an alternation like
 * /^(shark|burnt shark)$/ covers both; one failing does not stop the rest, and the result reports the
 * total and the last failure. Success needs the full amount: a short fill is `partial-fill`.
 */
export function* deposit(
    ctx: ActionContext,
    item: RegExp | InventoryItem,
    amount: number | 'all' = 'all',
): Op<DepositResult> {
    const dispatch = asDispatch(amount);
    const valid = validateActionQuantity(dispatch, { allowAll: true, max: MAX_BANK_ACTION_QUANTITY });
    if (!valid.valid) return { ok: false, reason: 'invalid-amount', amountDeposited: 0, message: valid.message };
    let s = ctx.state();
    if (!s.bank.isOpen) return { ok: false, reason: 'bank-not-open', amountDeposited: 0, message: 'Bank is not open' };

    if (dispatch === -1 && item instanceof RegExp) {
        // The first slot of each distinct matching item id: a deposit of all of one id moves every slot.
        const firstOfEach = s.inventory.filter(
            (i, n, inv) => item.test(i.name) && inv.findIndex(j => j.id === i.id) === n,
        );
        if (firstOfEach.length > 1) {
            let total = 0;
            const failures: string[] = [];
            let lastFailure: Extract<DepositResult, { ok: false }> | null = null;
            for (const slotItem of firstOfEach) {
                const one = yield* depositSlot(s, slotItem, -1);
                s = one.state;
                total += one.result.amountDeposited;
                if (!one.result.ok) {
                    failures.push(`${slotItem.name}: ${one.result.message}`);
                    lastFailure = one.result;
                }
            }
            const names = firstOfEach.map(i => i.name).join(', ');
            if (lastFailure)
                return {
                    ok: false,
                    reason: lastFailure.reason,
                    amountDeposited: total,
                    message: `Deposited ${total} across ${names}; failed: ${failures.join('; ')}`,
                };
            return { ok: true, amountDeposited: total, message: `Deposited ${total} across ${names}` };
        }
    }

    const slotItem = item instanceof RegExp ? shortestNameMatch(s.inventory, item) : item;
    if (!slotItem)
        return {
            ok: false,
            reason: 'item-not-found',
            amountDeposited: 0,
            message: `Item not found in inventory: ${item}`,
        };
    return (yield* depositSlot(s, slotItem, dispatch)).result;
}

/** A withdraw target as a message names it: a bank item by name, a pattern or slot as written. */
const targetLabel = (item: RegExp | BankItem | number) =>
    typeof item === 'number' || item instanceof RegExp ? String(item) : item.name;

/**
 * Withdraws `amount` of a bank item (a bank item, a bank slot, or the shortest-named match of a
 * pattern), or all of it. `asNote` withdraws banknotes: the note/item toggle is synced first, as it
 * is sticky server-side, and the arrival is counted by name since a note has its own item id. Success
 * needs the full amount: a short fill is `partial-fill`.
 */
export function* withdraw(
    ctx: ActionContext,
    item: RegExp | BankItem | number,
    amount: number | 'all' = 1,
    opts: { asNote?: boolean } = {},
): Op<WithdrawResult> {
    const dispatch = asDispatch(amount);
    const valid = validateActionQuantity(dispatch, { allowAll: true, max: MAX_BANK_ACTION_QUANTITY });
    if (!valid.valid) return { ok: false, reason: 'invalid-amount', amountWithdrawn: 0, message: valid.message };
    let s = ctx.state();
    if (!s.bank.isOpen) return { ok: false, reason: 'bank-not-open', amountWithdrawn: 0, message: 'Bank is not open' };

    let bankItem: BankItem | null | undefined;
    if (typeof item === 'number') bankItem = s.bank.items.find(i => i.slot === item);
    else if (item instanceof RegExp) bankItem = shortestNameMatch(s.bank.items, item);
    else
        bankItem =
            s.bank.items.find(i => i.slot === item.slot && i.id === item.id) ??
            s.bank.items.find(i => i.id === item.id);
    if (!bankItem)
        return {
            ok: false,
            reason: 'item-not-found',
            amountWithdrawn: 0,
            message: `Bank item not found: ${targetLabel(item)}`,
        };
    const { id: itemId, name: itemName } = bankItem;
    const asNote = opts.asNote ?? false;
    const requested = dispatch === -1 ? bankItem.count : dispatch;

    if (s.bank.noteMode !== asNote) {
        const toggled = yield* send({
            type: 'clickComponent',
            componentId: asNote ? NOTE_COMPONENT : ITEM_COMPONENT,
            reason: `withdraw as ${asNote ? 'note' : 'item'}`,
        });
        if (!toggled.success) return { ok: false, reason: 'send-failed', amountWithdrawn: 0, message: toggled.message };
        const t = yield* wait('bank note mode', st => st.bank.noteMode === asNote, NOTE_TOGGLE_WAIT_TICKS);
        if (t.kind === 'timeout')
            return {
                ok: false,
                reason: 'timeout',
                amountWithdrawn: 0,
                message: `Bank ${asNote ? 'note' : 'item'} withdrawal toggle did not register`,
            };
        s = t.state;
    }

    // A noted withdrawal arrives as the cert obj: a different id with the same name. The engine
    // withdraws un-notable items unnoted (with a game message), which the name check still sees.
    const held = (st: BotWorldState) =>
        asNote
            ? st.inventory.filter(i => i.name === itemName).reduce((n, i) => n + i.count, 0)
            : countItemId(st, itemId);
    const countBefore = held(s);
    const sent = yield* send({
        type: 'bankWithdraw',
        slot: bankItem.slot,
        amount: dispatch,
        reason: `withdraw ${itemName}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', amountWithdrawn: 0, message: sent.message };
    const w = yield* wait(`withdraw ${itemName}`, st => held(st) > countBefore, BANK_TRANSFER_WAIT_TICKS);
    if (w.kind === 'timeout')
        return {
            ok: false,
            reason: 'timeout',
            amountWithdrawn: 0,
            message: `Timeout waiting for ${itemName} to be withdrawn`,
        };
    const amountWithdrawn = Math.max(0, held(w.state) - countBefore);
    if (!classifyQuantity(requested, amountWithdrawn).complete)
        return {
            ok: false,
            reason: 'partial-fill',
            amountWithdrawn,
            message: `Withdrew ${itemName} x${amountWithdrawn} of ${requested} requested`,
        };
    const arrived = asNote
        ? (w.state.inventory.find(i => i.name === itemName && i.id !== itemId) ??
          w.state.inventory.find(i => i.name === itemName))
        : w.state.inventory.find(i => i.id === itemId);
    return { ok: true, amountWithdrawn, item: arrived, message: `Withdrew ${itemName} x${amountWithdrawn}` };
}
