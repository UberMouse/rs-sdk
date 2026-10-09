// A Driver over a scripted list of tick states, for unit tests: no server, no timers. Every tick
// resolves in a microtask, so a test runs as fast as the op's logic.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import { TICK_MS } from '../../lib/util';
import type { Driver } from '../interpret';
import type { Command } from '../op';

/**
 * A change a send makes to the world: applied to every state from the next tick on, until it no longer
 * applies. An effect that finds nothing to change returns the very state it was given, which retires it:
 * the script has caught up with the send (the dropped item is gone from it), and applying the effect on
 * would remove what the script adds later.
 */
export type Effect = (state: BotWorldState) => BotWorldState;

export interface TimelineOptions {
    /** Answer a send; undefined (or no `respond`) answers success. */
    respond?: (action: BotAction) => ActionResult | undefined;
    /**
     * What a successful send changes in the world (food eaten, an item dropped), on top of the script:
     * the scripted states say what the world does by itself, this what the bot's sends do to it.
     * Given the state the send was made on.
     */
    react?: (action: BotAction, state: BotWorldState) => Effect | undefined;
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
    /** The scripted (or repeated) state of this tick, before the sends' effects. */
    private scripted: BotWorldState;
    private current: BotWorldState;
    /** Effects queued by this tick's sends, applied from the next tick on. */
    private readonly queued: Effect[] = [];
    private effects: Effect[] = [];
    private pending: Promise<BotWorldState> | null = null;

    constructor(
        states: BotWorldState[],
        private readonly opts: TimelineOptions = {},
    ) {
        const [first] = states;
        if (!first) throw new Error('TimelineDriver needs at least one state');
        this.states = states;
        this.scripted = first;
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
        if (scripted) this.scripted = scripted;
        else if (this.opts.strict) throw new Error(`timeline ended at tick ${this.current.tick}`);
        else this.scripted = { ...this.scripted, tick: this.scripted.tick + 1 };
        this.effects.push(...this.queued.splice(0));
        let state = this.scripted;
        this.effects = this.effects.filter(effect => {
            const next = effect(state);
            const applies = next !== state;
            state = next;
            return applies;
        });
        this.current = state;
        return this.current;
    }

    async send(action: BotAction): Promise<ActionResult> {
        this.commands.push({ type: 'send', action });
        const result = this.opts.respond?.(action) ?? { success: true, message: 'ok' };
        const effect = result.success ? this.opts.react?.(action, this.current) : undefined;
        if (effect) this.queued.push(effect);
        return result;
    }

    async scan(radius?: number): Promise<NearbyLoc[]> {
        this.commands.push({ type: 'scan', radius });
        return this.opts.scan?.(radius) ?? [];
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
