// What an op reads besides its arguments. A task step passes its TaskContext; a test or an
// integration test passes its driver.
import type { BotWorldState } from '../../sdk/types';

export interface ActionContext {
    /** The latest state. Ops read the game through it, never through the SDK. */
    state(): BotWorldState;
}
