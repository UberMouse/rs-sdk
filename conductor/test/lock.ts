// A scripted combination lock for tests: the interface the client publishes (its `debugInfo` component dump
// carries the four letters), and a react that moves the wheels as the arrows are clicked and answers the confirm.
import type { BotAction, BotWorldState } from '../../sdk/types';
import type { Effect } from '../core/drivers/timeline';
import { configId } from '../lib/packs';
import { world } from './world';

export const PEER_LOCK = { id: 10051, name: 'combolockdoor' } as const;
export const TRIBAL_LOCK = { id: 716, name: 'tribal_door2' } as const;
export type LockKind = typeof PEER_LOCK | typeof TRIBAL_LOCK;

const WHEELS = 4;
const COMPONENTS = {
    letters: [43, 44, 45, 46],
    down: [47, 49, 51, 53],
    up: [48, 50, 52, 54],
    confirm: 57,
} as const;

const id = (lock: LockKind, n: number): number => {
    const found = configId('interface', `${lock.name}:com_${n}`);
    if (found === undefined) throw new Error(`no component ${lock.name}:com_${n}`);
    return found;
};

export const letter = (v: number): string => String.fromCharCode(65 + v);

/** The component dump a client with the lock open publishes: the interface root, then its labels. */
export function lockDump(lock: LockKind, letters: (number | string)[]): string[] {
    return [
        `#${lock.id} type=0 btn=0 text=""`,
        ...letters.map(
            (v, i) =>
                `  #${id(lock, COMPONENTS.letters[i]!)} type=4 btn=0 text=${JSON.stringify(typeof v === 'number' ? letter(v) : v)}`,
        ),
    ];
}

/** `s` with `lock` open showing `letters` (0-25, or any label text). */
export function withLock(s: BotWorldState, lock: LockKind, letters: (number | string)[]): BotWorldState {
    const open = world(s).modal(lock.id).build();
    return { ...open, interface: { ...open.interface, debugInfo: lockDump(lock, letters) } as typeof open.interface };
}

/** `s` with its lock closed. */
export const withoutLock = (s: BotWorldState): BotWorldState => world(s).modal(false).build();

export interface LockReactOptions {
    lock: LockKind;
    /** The letters (0-25) the wheels show when the lock opens. */
    start?: number[];
    /** The word the confirm accepts, as four letters. */
    answer: string;
    /** Arrow clicks (by wheel) that do nothing, to script a lock that ignores them. */
    deadWheels?: number[];
    /** Clicks to ignore before the wheels work. */
    ignoreFirst?: number;
    /** The confirm does nothing. */
    deadConfirm?: boolean;
}

export const SOLVED_MESSAGE = {
    combolockdoor: 'You have solved the riddle!',
    tribal_door2: 'The combination seems correct!',
};
export const WRONG_MESSAGE = {
    combolockdoor: 'You have failed to solve the riddle.',
    tribal_door2: 'This combination is incorrect.',
};

/** A lock the bot works: remembers the wheels, applies arrow clicks and the confirm. */
export function lockReact(opts: LockReactOptions) {
    const wheels = [...(opts.start ?? [0, 0, 0, 0])];
    let ignore = opts.ignoreFirst ?? 0;
    const clicks: string[] = [];
    const react = (action: BotAction): Effect | undefined => {
        if (action.type === 'closeModal') {
            clicks.push('close');
            return s => (s.interface.isOpen ? withoutLock(s) : s);
        }
        if (action.type !== 'clickComponent') return undefined;
        const up = COMPONENTS.up.findIndex(n => id(opts.lock, n) === action.componentId);
        const down = COMPONENTS.down.findIndex(n => id(opts.lock, n) === action.componentId);
        if (up >= 0 || down >= 0) {
            const wheel = up >= 0 ? up : down;
            clicks.push(`${up >= 0 ? 'up' : 'down'}${wheel}`);
            if (ignore > 0) {
                ignore--;
                return undefined;
            }
            if (opts.deadWheels?.includes(wheel)) return undefined;
            wheels[wheel] = (wheels[wheel]! + (up >= 0 ? 1 : 25)) % 26;
            const snapshot = [...wheels];
            return s => (s.interface.isOpen ? withLock(s, opts.lock, snapshot) : s);
        }
        if (action.componentId === id(opts.lock, COMPONENTS.confirm)) {
            clicks.push('confirm');
            if (opts.deadConfirm) return undefined;
            const right = wheels.map(letter).join('') === opts.answer.toUpperCase();
            const text = (right ? SOLVED_MESSAGE : WRONG_MESSAGE)[opts.lock.name];
            return s => {
                const closed = withoutLock(s);
                return closed.gameMessages.some(m => m.text === text) ? closed : world(closed).message(text).build();
            };
        }
        return undefined;
    };
    /** The door was opened again: the wheels are back where the lock starts them. */
    const reset = () => wheels.splice(0, WHEELS, ...(opts.start ?? [0, 0, 0, 0]));
    return { react, wheels, clicks, reset };
}
