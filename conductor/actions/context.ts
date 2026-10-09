// What an op reads besides its arguments. A task step passes its TaskContext; a test or an
// integration test passes its driver.
import type { BotWorldState } from '../../sdk/types';
import type { Pathfinder } from './paths';

export interface ActionContext {
    /** The latest state. Ops read the game through it, never through the SDK. */
    state(): BotWorldState;
    /** Where walkTo gets its routes; omitted, the SDK's collision data (`collisionPaths`). Tests pass their own. */
    readonly pathfinder?: Pathfinder;
}
