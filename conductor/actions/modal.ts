// Not ported: sdk/actions.ts has no open-run-close method; closest upstream is openBank @ 4c2069cc0.
// withModal pairs a modal's open op with its close op so an abort closes the modal before the guard's
// work runs: withBank and withShop are it with the bank's and the shop's ops. Upstream leaves the close
// to the caller, which a cancelled step never reaches.
import type { BotAction, BotWorldState } from '../../sdk/types';
import { CLEANUP_TICKS } from '../core/interpret';
import { type Op, type Pred, send, ticks, wait } from '../core/op';
import type { ActionContext } from './context';

/**
 * Each wait of withModal's close when it is cancelled (see closeAfterAbort): a late open's, then the
 * first close attempt's. Two of them plus the second attempt's tick fit inside the interpreter's
 * cleanup cap, so a cancelled step's close is never abandoned at the cap.
 */
export const CLEANUP_CLOSE_WAIT_TICKS = Math.floor((CLEANUP_TICKS - 1) / 2);

type Failure<R extends string> = { ok: false; reason: R; message: string };
export type CloseModalResult = { ok: true; message: string } | Failure<'send-failed' | 'timeout'>;
/**
 * Closes what `isClosed` is false for with a closeModal, and a second one if the first shows no effect
 * within `waitTicks`; already closed is success. `what` names it in labels and messages. At most
 * `waitTicks + 1` ticks and two sends.
 */
export function* closeModalUntil(
    ctx: ActionContext,
    what: string,
    isClosed: Pred,
    waitTicks: number,
): Op<CloseModalResult> {
    if (isClosed(ctx.state())) return { ok: true, message: `${what} already closed` };
    const sent = yield* send({ type: 'closeModal', reason: `close ${what}` });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(`${what} closed`, isClosed, waitTicks);
    if (w.kind === 'met') return { ok: true, message: `${what} closed` };
    const again = yield* send({ type: 'closeModal', reason: `close ${what} (second attempt)` });
    if (!again.success) return { ok: false, reason: 'send-failed', message: again.message };
    const last = yield* ticks(1);
    if (isClosed(last)) return { ok: true, message: `${what} closed (second attempt)` };
    return { ok: false, reason: 'timeout', message: `${what} still open after two closes` };
}

/** An open op's failure: only `timeout` means an open was sent that can still land. */
type OpenFailure = Failure<string>;

/** The ops and state one modal (the bank, a shop) is opened and closed with. */
export interface ModalOps<F extends OpenFailure> {
    /** Names the modal in wait labels and messages: "bank", "shop". */
    name: string;
    /** Opens it and waits for it to show; already open is success. */
    open: () => Op<{ ok: true; message: string } | F>;
    /** Closes it, waiting `waitTicks` for each of at most two attempts (the second gets one tick). */
    close: (waitTicks?: number) => Op<CloseModalResult>;
    /** True once the modal shows open: what a late open is waited for by. */
    isOpen: (s: BotWorldState) => boolean;
    /** True when nothing of it shows any more. */
    isClosed: (s: BotWorldState) => boolean;
    /** The close packet `close` sends, labelled `reason`. */
    closeAction: (reason: string) => BotAction;
}

export type WithModalResult<T, F extends OpenFailure> = { ok: true; value: T; closed: CloseModalResult } | F;

/**
 * withModal's close when it did not finish normally (cancelled, a failed open, a body that threw), sized
 * to fit the interpreter's cleanup cap (at most 2 * CLEANUP_CLOSE_WAIT_TICKS + 1 ticks). With an open
 * still pending (sent, never confirmed) and nothing showing, it waits for a late open and closes that;
 * if none shows, it still sends one close, for a modal the server opened that the client has not
 * published yet. A close the server takes before the open lands does not stop the open (the engine's
 * close does not clear the pending interaction), hence the wait.
 */
function* closeAfterAbort<F extends OpenFailure>(
    ctx: ActionContext,
    modal: ModalOps<F>,
    openPending: boolean,
): Op<CloseModalResult> {
    const { name } = modal;
    if (openPending && modal.isClosed(ctx.state())) {
        const late = yield* wait(`late ${name} open`, modal.isOpen, CLEANUP_CLOSE_WAIT_TICKS);
        if (late.kind === 'timeout') {
            const sent = yield* send(modal.closeAction(`close ${name} (open not confirmed)`));
            if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
            return { ok: true, message: `No ${name} opened; sent a close in case it was about to` };
        }
    }
    return yield* modal.close(CLEANUP_CLOSE_WAIT_TICKS);
}

/**
 * Runs `body` with the modal open and closes it afterwards, however `body` ends: the close is in a
 * `finally`, so an abort (a guard, a stop, the step budget throws `Cancelled` into the op) closes the
 * modal first, under the interpreter's bounded cleanup, before the guard's own work runs. That matters
 * because an open bank or shop hides the inventory: the low-HP guard's eat would be refused
 * server-side. The interface guard leaves a bank or shop alone by design, so this pairing is the only
 * thing that closes it.
 *
 * What is guaranteed: the normal path's close is `modal.close`'s full one, and `closed` is its result.
 * Any other ending (a cancel, a failed open, a throw) gets closeAfterAbort, which fits CLEANUP_TICKS: it
 * sends a close within the cap whenever the modal shows open, or an open was sent and not confirmed
 * (waiting CLEANUP_CLOSE_WAIT_TICKS for a late open to show first), and a second close if the first
 * shows no effect. A modal that ignores both closes, or an open landing after that wait, stays open.
 */
export function* withModal<T, F extends OpenFailure>(
    ctx: ActionContext,
    modal: ModalOps<F>,
    body: Op<T>,
): Op<WithModalResult<T, F>> {
    let value: T;
    let closed: CloseModalResult;
    // Until the open answers, its interaction may be on the way (cancelled mid-open). Of its failures
    // only a timeout sent an open that can still land; the others sent nothing or were refused.
    let openPending = true;
    let finished = false;
    try {
        const opened = yield* modal.open();
        openPending = !opened.ok && opened.reason === 'timeout';
        if (!opened.ok) return opened;
        value = yield* body;
        finished = true;
    } finally {
        closed = finished ? yield* modal.close() : yield* closeAfterAbort(ctx, modal, openPending);
    }
    return { ok: true, value, closed };
}
