// A Driver over a scripted list of tick states, for unit tests: no server, no timers. Every tick
// resolves in a microtask, so a test runs as fast as the op's logic.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import { TICK_MS } from '../../lib/util';
import type { Driver } from '../interpret';
import type { Command } from '../op';

export interface TimelineOptions {
    /** Answer a send; undefined (or no `respond`) answers success. */
    respond?: (action: BotAction) => ActionResult | undefined;
    /** What `scan` returns; default none. */
    scan?: (radius?: number) => NearbyLoc[];
    /** Reject `nextTick` past the last state instead of repeating it with the tick advanced. */
    strict?: boolean;
}

export class TimelineDriver implements Driver {
    /** Every command the interpreter forwarded, in order (waits are not forwarded, only their ticks). */
    readonly commands: Command[] = [];
    private readonly states: BotWorldState[];
    private index = 0;
    private current: BotWorldState;
    private pending: Promise<BotWorldState> | null = null;

    constructor(
        states: BotWorldState[],
        private readonly opts: TimelineOptions = {},
    ) {
        const [first] = states;
        if (!first) throw new Error('TimelineDriver needs at least one state');
        this.states = states;
        this.current = first;
    }

    state(): BotWorldState {
        return this.current;
    }

    /** Ticks consumed so far (index into the scripted states, counting repeats past the end). */
    get ticksElapsed(): number {
        return this.index;
    }

    /** Overlapping requests share one tick, as every listener of a live client gets the same next state. */
    nextTick(): Promise<BotWorldState> {
        this.pending ??= Promise.resolve().then(() => {
            this.pending = null;
            return this.advance();
        });
        return this.pending;
    }

    private advance(): BotWorldState {
        this.index++;
        const scripted = this.states[this.index];
        if (scripted) this.current = scripted;
        else if (this.opts.strict) throw new Error(`timeline ended at tick ${this.current.tick}`);
        else this.current = { ...this.current, tick: this.current.tick + 1 };
        return this.current;
    }

    async send(action: BotAction): Promise<ActionResult> {
        this.commands.push({ type: 'send', action });
        return this.opts.respond?.(action) ?? { success: true, message: 'ok' };
    }

    async scan(radius?: number): Promise<NearbyLoc[]> {
        this.commands.push({ type: 'scan', radius });
        return this.opts.scan?.(radius) ?? [];
    }

    call(label: string, run: () => Promise<unknown>): Promise<unknown> {
        this.commands.push({ type: 'call', label, run });
        return run();
    }

    log(msg: string, data?: Record<string, unknown>): void {
        this.commands.push({ type: 'log', msg, data });
    }

    async screenshot(label: string): Promise<string | null> {
        this.commands.push({ type: 'screenshot', label });
        return null;
    }

    now(): number {
        return this.current.tick * TICK_MS;
    }
}
