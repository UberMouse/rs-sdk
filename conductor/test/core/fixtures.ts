// Guards, ops and helpers shared by the core interpreter tests.
import type { ActionResult, BotAction, BotWorldState } from '../../../sdk/types';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import type { Guard, GuardOutcome } from '../../core/interpret';
import { log, type Op, send, ticks, wait } from '../../core/op';

export const act = (reason: string): BotAction => ({ type: 'none', reason });

/** The driver's command log as short strings, for order assertions. */
export const trace = (d: TimelineDriver): string[] =>
    d.commands.map(c => {
        switch (c.type) {
            case 'send':
                return `send ${c.action.reason}`;
            case 'log':
                return `log ${c.msg}`;
            default:
                return c.type;
        }
    });

export const guardLogs = (d: TimelineDriver): Record<string, unknown>[] =>
    d.commands.flatMap(c => (c.type === 'log' && /^guard \S+ \(/.test(c.msg) ? [{ msg: c.msg, ...c.data }] : []));

/**
 * A TimelineDriver whose send of a gated reason settles only once that gate (made when the send is)
 * has, so the send stays pending across ticks, as a slow live one does; a gate that rejects fails it.
 */
export class GatedSends extends TimelineDriver {
    constructor(
        states: BotWorldState[],
        private readonly gates: Record<string, () => Promise<unknown>>,
        opts?: TimelineOptions,
    ) {
        super(states, opts);
    }

    override async send(action: BotAction): Promise<ActionResult> {
        const result = await super.send(action);
        await this.gates[action.reason]?.();
        return result;
    }
}

/** A promise that never settles: a send gated on it is never answered. */
export const never = () => new Promise<never>(() => {});

/** A promise that `onTick` settles at `tick`, so a send gated on it stays pending across ticks. */
export function gateAt<T>(tick: number, value: T) {
    let release!: (v: T) => void;
    const promise = new Promise<T>(r => {
        release = r;
    });
    const onTick = (s: BotWorldState): string | null => {
        if (s.tick === tick) release(value);
        return null;
    };
    return { promise, onTick };
}

/** onTick that stops the run at `tick`. */
export const stopAt =
    (tick: number, reason = 'stop') =>
    (s: BotWorldState): string | null =>
        s.tick === tick ? reason : null;

export const lowHp: Guard = {
    name: 'low-hp',
    policy: 'abort',
    when: s => (s.player?.hp ?? 0) < 5,
    *run() {
        yield* send(act('eat'));
    },
};

export const death: Guard = {
    name: 'death',
    policy: 'abort',
    critical: true,
    when: s => (s.player?.hp ?? 0) <= 0,
    *run(): Op<GuardOutcome> {
        yield* log('died');
        return { fail: 'died' };
    },
};

export const dialog: Guard = {
    name: 'dialog',
    policy: 'suspend',
    when: s => s.dialog.isOpen,
    *run() {
        yield* send(act('continue'));
    },
};

/** A dialog guard whose handler takes `n` ticks after clicking continue. */
export const slowDialog = (n: number): Guard => ({
    ...dialog,
    *run() {
        yield* send(act('continue'));
        yield* ticks(n);
    },
});

/** Sends, then waits for something that never comes; its finally sends a cleanup. */
export function* busy(): Op<string> {
    try {
        yield* send(act('chop'));
        yield* wait('logs', () => false, 50);
        return 'unreachable';
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Sends `walk` (gate it to keep it pending); its finally sends `cleanup`. */
export function* walks(): Op<void> {
    try {
        yield* send(act('walk'));
    } finally {
        yield* send(act('cleanup'));
    }
}

/** Waits forever; its finally sends `cleanup`, then runs `more`. */
export function* waitsThenCleansUp(more: () => Op<void>): Op<void> {
    try {
        yield* wait('forever', () => false, 1000);
    } finally {
        yield* send(act('cleanup'));
        yield* more();
    }
}
