import type { RsOpsIdle } from '../types'

/**
 * The initial value of the `rs-ops.idle` atom, which idle.tsx and autocompact.tsx each declare
 * (the validator rejects a shared atom module), so the two copies agree on it.
 */
export const INITIAL_IDLE: Readonly<RsOpsIdle> = { running: false, idleSince: null, queued: 0, pendingSubmits: 0 }
