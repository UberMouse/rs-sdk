// Not ported: sdk/actions.ts has no combination-lock method; closest upstream is smithAtAnvil @ df3d8888a
// (an op that works inside an interface it owns, clicking its buttons by component id).
// The two combination doors, Peer the Seer's riddle door (`combolockdoor`, The Fremennik Trials) and the Tribal
// Totem door (`tribal_door2`), share one interface layout and one wheel rule (calc_tribaldoor_value in
// quest_totem.rs2: +1 / -1 on a 0-25 wheel, A..Z, wrapping Z->A and A->Z). Unlike the smith op's interface, the
// lock is opened by the loc interaction, so this op starts on an open lock and only sets the wheels and
// confirms. It reads each wheel from the letters the client shows (the interface's `debugInfo` component dump in the
// published state), not from a count of its own clicks, so a click that was lost, doubled or made before a
// cut-off leaves the next call correct: it takes the shorter way round from wherever the wheel stands.
// It sends the lock's own confirm and judges the answer from the game's message ("You have solved the riddle!" /
// "The combination seems correct!" against "You have failed to solve the riddle." / "This combination is
// incorrect."). A step cut off after the confirm resumes from `progress.confirmCursor` and reads the verdict
// without clicking again. The lock hides the inventory, so the work runs under withModal: a cancel (a guard, a stop)
// or a failure closes the lock before anything else runs, and a cut-off step starts over by reopening the door (the
// wheels restart at A). Nothing else is handled here: the dialogs before the lock are the task's.
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { configId } from '../lib/packs';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';
import { interfaceTexts } from './press';
import { closeModalUntil, type ModalOps, withModal } from './modal';

/** Wheels on the lock. */
export const WHEELS = 4;
/** Letters on a wheel, A..Z. */
export const ALPHABET = 26;
/** The most arrow clicks one wheel needs: the shorter way round a 26-letter wheel. */
export const MAX_CLICKS_PER_WHEEL = ALPHABET / 2;
/** Ticks one arrow click gets to change its letter. */
export const WHEEL_WAIT_TICKS = 5;
/** Consecutive arrow clicks that change nothing before the op gives up (the first is retried once). */
export const WHEEL_STALL_LIMIT = 2;
/** Ticks a close of the lock gets to land (when withModal gives none). */
export const CLOSE_WAIT_TICKS = 5;
/** Ticks the confirm gets to close the lock and say its verdict. */
export const CONFIRM_WAIT_TICKS = 5;
/** The worst case of one call, in ticks, for a step that reserves it: every wheel at its farthest, then the confirm. */
export const COMBOLOCK_MAX_TICKS = WHEELS * MAX_CLICKS_PER_WHEEL * WHEEL_WAIT_TICKS + CONFIRM_WAIT_TICKS;

/** The `interface.pack` names of the two locks. Their component numbers are the same (see LAYOUT). */
const LOCK_NAMES = { 10051: 'combolockdoor', 716: 'tribal_door2' } as const;
/** The interface ids of the combination locks (combolockdoor, tribal_door2 in server/content/pack/interface.pack). */
export const COMBOLOCK_INTERFACES: ReadonlySet<number> = new Set(Object.keys(LOCK_NAMES).map(Number));

/** Component numbers inside both locks (viking_peer.rs2, quest_totem.rs2): the letter labels, the arrows, the confirm. */
const LAYOUT = {
    letters: [43, 44, 45, 46],
    up: [48, 50, 52, 54],
    down: [47, 49, 51, 53],
    confirm: 57,
} as const;

/** The game's verdicts on the confirm. */
const SOLVED = /solved the riddle|combination seems correct/i;
const WRONG = /failed to solve the riddle|combination is incorrect/i;

/** True while one of the combination locks is the open main modal. */
export const lockOpen = (s: BotWorldState): boolean =>
    s.interface.isOpen && COMBOLOCK_INTERFACES.has(s.interface.interfaceId);

/** A word's wheel values: A=0 ... Z=25, or undefined when it is not four letters. */
export function wordValues(word: string): number[] | undefined {
    if (!/^[A-Za-z]{4}$/.test(word)) return undefined;
    return [...word.toUpperCase()].map(c => c.charCodeAt(0) - 65);
}

/** The pack id of component `n` of the open lock. */
function componentId(interfaceId: number, n: number): number {
    const name = LOCK_NAMES[interfaceId as keyof typeof LOCK_NAMES];
    const id = configId('interface', `${name}:com_${n}`);
    if (id === undefined) throw new Error(`no component ${name}:com_${n} in interface.pack`);
    return id;
}

/**
 * The four letters the open lock shows, as 0-25, or undefined for a wheel it shows nothing readable on (no
 * component dump in the state, or a label that is not one capital letter).
 */
export function readWheels(s: BotWorldState): (number | undefined)[] {
    const texts = interfaceTexts(s);
    return LAYOUT.letters.map(n => {
        const text = texts.get(componentId(s.interface.interfaceId, n));
        return text !== undefined && /^[A-Z]$/.test(text) ? text.charCodeAt(0) - 65 : undefined;
    });
}

/** Signed clicks from `from` to `to` the short way round: positive = up arrow (+1), negative = down. */
export function wheelClicks(from: number, to: number): number {
    const up = (((to - from) % ALPHABET) + ALPHABET) % ALPHABET;
    return up <= MAX_CLICKS_PER_WHEEL ? up : up - ALPHABET;
}

/** How far a confirm has got, kept by the caller so a cut-off call resumes where the verdict is read. */
export interface LockProgress {
    /** The message cursor taken before the confirm was sent, or null while it has not been. */
    confirmCursor: number | null;
}

export type CombolockResult =
    | { ok: true; message: string }
    | {
          ok: false;
          reason: 'not-open' | 'bad-word' | 'unreadable' | 'send-failed' | 'no-effect' | 'closed' | 'wrong';
          message: string;
      };

/** The verdict message after `cursor`, if any: solved (true) or wrong (false). */
function verdictSince(s: BotWorldState, cursor: number): { solved: boolean; text: string } | null {
    const solved = messageSince(s, cursor, SOLVED);
    if (solved) return { solved: true, text: solved };
    const wrong = messageSince(s, cursor, WRONG);
    return wrong ? { solved: false, text: wrong } : null;
}

function judge(s: BotWorldState, cursor: number, word: string): CombolockResult {
    const v = verdictSince(s, cursor);
    if (v?.solved) return { ok: true, message: `${word.toUpperCase()}: ${v.text}` };
    if (v) return { ok: false, reason: 'wrong', message: `${word.toUpperCase()} was refused: ${v.text}` };
    return {
        ok: false,
        reason: 'no-effect',
        message: lockOpen(s) ? 'the lock stayed open after the confirm' : 'the lock closed with no verdict message',
    };
}

/**
 * Sets the open lock's four wheels to `word` and confirms. Each wheel is read, then clicked the short way
 * round one click at a time, each waited for until its letter changes (WHEEL_WAIT_TICKS; a click that does nothing
 * is retried once). `ok` once the game says the combination is right. `not-open` is no lock showing (and no confirm
 * pending), `bad-word` a word that is not four letters, `unreadable` a wheel whose letter the state does not show,
 * `no-effect` a click or confirm the game ignored, `closed` the lock closing mid-way, `wrong` the game refusing the
 * word. `progress` is updated before the confirm is sent, so a cancelled call that comes back finds it.
 */
export function* solveCombolock(ctx: ActionContext, word: string, progress: LockProgress): Op<CombolockResult> {
    const target = wordValues(word);
    if (!target) return { ok: false, reason: 'bad-word', message: `${JSON.stringify(word)} is not a four-letter word` };
    if (!lockOpen(ctx.state())) {
        if (progress.confirmCursor !== null) return judge(ctx.state(), progress.confirmCursor, word);
        return { ok: false, reason: 'not-open', message: 'no combination lock is open' };
    }
    const ran = yield* withModal(ctx, lockModal(ctx), setAndConfirm(ctx, word, target, progress));
    return ran.ok ? ran.value : ran;
}

/** The lock as withModal's modal: opened by the door interaction already, so its open only checks. */
function lockModal(ctx: ActionContext): ModalOps<{ ok: false; reason: 'not-open'; message: string }> {
    return {
        name: 'combination lock',
        *open() {
            const w = yield* wait('combination lock open', lockOpen, 0);
            return w.kind === 'met'
                ? { ok: true, message: 'combination lock open' }
                : { ok: false, reason: 'not-open', message: 'no combination lock is open' };
        },
        close: waitTicks => closeModalUntil(ctx, 'combination lock', s => !lockOpen(s), waitTicks ?? CLOSE_WAIT_TICKS),
        isOpen: lockOpen,
        isClosed: s => !lockOpen(s),
        closeAction: reason => ({ type: 'closeModal', reason }),
    };
}

function* setAndConfirm(
    ctx: ActionContext,
    word: string,
    target: number[],
    progress: LockProgress,
): Op<CombolockResult> {
    const interfaceId = ctx.state().interface.interfaceId;
    for (let wheel = 0; wheel < WHEELS; wheel++) {
        let stalls = 0;
        while (true) {
            const s = ctx.state();
            if (!lockOpen(s))
                return { ok: false, reason: 'closed', message: 'the lock closed while setting the wheels' };
            const here = readWheels(s)[wheel];
            if (here === undefined)
                return { ok: false, reason: 'unreadable', message: `wheel ${wheel + 1} shows no readable letter` };
            const clicks = wheelClicks(here, target[wheel]!);
            if (clicks === 0) break;
            const arrow = clicks > 0 ? LAYOUT.up[wheel]! : LAYOUT.down[wheel]!;
            const sent = yield* send({
                type: 'clickComponent',
                componentId: componentId(interfaceId, arrow),
                reason: `lock wheel ${wheel + 1} ${clicks > 0 ? 'up' : 'down'}`,
            });
            if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
            const w = yield* wait(
                `lock wheel ${wheel + 1} changes`,
                st => !lockOpen(st) || readWheels(st)[wheel] !== here,
                WHEEL_WAIT_TICKS,
            );
            if (w.kind === 'met') {
                stalls = 0;
                continue;
            }
            if (++stalls >= WHEEL_STALL_LIMIT)
                return {
                    ok: false,
                    reason: 'no-effect',
                    message: `wheel ${wheel + 1} stayed on ${String.fromCharCode(65 + here)} through ${stalls} arrow clicks`,
                };
        }
    }
    progress.confirmCursor ??= messageCursor(ctx.state());
    const cursor = progress.confirmCursor;
    const sent = yield* send({
        type: 'clickComponent',
        componentId: componentId(interfaceId, LAYOUT.confirm),
        reason: 'lock confirm',
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait('lock verdict', st => !lockOpen(st) && verdictSince(st, cursor) !== null, CONFIRM_WAIT_TICKS);
    return judge(w.state, cursor, word);
}
