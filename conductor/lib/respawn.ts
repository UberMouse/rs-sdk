// The wait of a gathering task with no target in reach: stay put (returnToAreaStep keeps the bot inside) until one
// respawns, failing once there has been none for the give-up. The caller clears its "none since" tick when it
// finds a target again; until then repeated calls share one give-up.
import type { BotWorldState } from '../../sdk/types';
import { log, type Op, wait } from '../core/op';
import type { Area } from './area';
import { type AreaWatch, type Sighting, trackIdle } from './area-watch';
import type { Outcome } from './task';
import { ticksToSeconds } from './util';

export interface RespawnWait {
    /** The task's memory field for the tick the wait for a target began; null when not waiting. */
    since: { get(): number | null; set(tick: number): void };
    /** Ticks with no target before the run fails; the task lists them in `silent`. */
    giveUpTicks: number;
    /** The wait's label and the state that ends it. */
    label: string;
    until: (state: BotWorldState) => boolean;
    /** Logged when the wait begins, not on a repeated call. */
    log: string;
    watch: AreaWatch;
    /** A target in view outside the area, for `trackIdle`. */
    seen: (state: BotWorldState) => Sighting | undefined;
    /** Waits at most this many ticks per call, returning to the caller between chunks until the give-up. */
    chunkTicks?: number;
    /** What the failure names: "no reachable <target> ...". */
    target: string;
    area: Area | undefined;
    /** Appended to the failure with an area, from the state the wait ended on. */
    areaSuffix?: (state: BotWorldState) => string;
}

/** Waits for a target; undefined once one is in reach (or a chunk ended before the give-up), else the failure. */
export function* waitForRespawn(ctx: { state(): BotWorldState }, opts: RespawnWait): Op<Outcome> {
    const now = ctx.state().tick;
    let since = opts.since.get();
    if (since === null) {
        since = now;
        opts.since.set(now);
        yield* log(opts.log);
    }
    const left = Math.max(0, since + opts.giveUpTicks - now);
    const ticks = opts.chunkTicks === undefined ? left : Math.min(left, opts.chunkTicks);
    const r = yield* trackIdle(ctx, opts.watch, opts.seen, wait(opts.label, opts.until, ticks));
    if (r.kind === 'met') return;
    const elapsed = r.state.tick - since;
    if (opts.chunkTicks !== undefined && elapsed < opts.giveUpTicks) return;
    const seconds = ticksToSeconds(elapsed);
    const { area, target } = opts;
    return {
        fail: area
            ? `area depleted: no reachable ${target} in radius ${area.radius} for ${seconds}s${opts.areaSuffix?.(r.state) ?? ''}`
            : `no reachable ${target} nearby for ${seconds}s`,
    };
}
