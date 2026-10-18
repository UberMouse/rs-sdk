// What an op reads besides its arguments. A task step passes its TaskContext; a test or an
// integration test passes its driver.
import type { BotWorldState } from '../../sdk/types';
import type { WalkWorld } from '../lib/walk-graph';
import type { Pathfinder } from './paths';

export interface ActionContext {
    /** The latest state. Ops read the game through it, never through the SDK. */
    state(): BotWorldState;
    /** Where walkTo gets its routes; omitted, the SDK's collision data (`collisionPaths`). Tests pass their own. */
    readonly pathfinder?: Pathfinder;
    /** Where walkTo plans its way (lib/walk-graph.ts); omitted, the world index's. Tests pass their own. */
    readonly walkWorld?: WalkWorld;
    /**
     * Ticks the running step has left before the engine ends the run for overrunning its budget
     * (`stepTimeoutMs` as ticks): waiting this many more is still within it, one more is not. Undefined
     * outside a generator step, and where there is no engine (a test, an op run on its own).
     */
    stepTicksLeft?(): number | undefined;
    /**
     * The bank's count of an item (by name, as the bank names it) as last seen open: the plan's record before this
     * run (lib/plan.ts PlanView.bank), then what the run itself has seen (lib/bank-memory.ts); undefined when not
     * known. walkTo plans a bank detour on it.
     */
    bank?(item: string): number | undefined;
}
