// The bank as last seen open, read from the states a driver hands out: the plan keeps one across its phases
// (lib/plan.ts, PlanView.bank and each phase's record) and the engine one per run, from that record on
// (lib/engine.ts, TaskContext.bank), so a walk plans its bank detours on what the run has seen since.
import type { BotWorldState } from '../../sdk/types';
import type { Driver } from '../core/interpret';

export interface BankMemory {
    /** Notes `s` if it shows the bank open, and returns it. */
    observe(s: BotWorldState): BotWorldState;
    /** Item name -> count as last seen open; null before the bank has been seen open (or a record given). */
    counts(): ReadonlyMap<string, number> | null;
}

/** A bank memory, starting from `record` (the counts as last seen open before), or from nothing. */
export function bankMemory(record: ReadonlyMap<string, number> | null = null): BankMemory {
    let counts = record;
    let seen: BotWorldState | null = null;
    /**
     * The client empties the bank's item list for the tick before it reports the bank closed, so the last
     * state seen open is empty whatever the bank holds. An empty list after a listed one is therefore
     * taken only once a second open tick confirms it (a bank emptied on purpose stays open at least that
     * long under withBank's close wait; one closed straight after its last withdrawal reads as before).
     */
    let sessionListed = false;
    let emptyOpenTicks = 0;
    let lastOpenTick = -1;
    const observe = (s: BotWorldState): BotWorldState => {
        if (s === seen) return s;
        seen = s;
        if (!s.bank.isOpen) {
            sessionListed = false;
            emptyOpenTicks = 0;
            return s;
        }
        if (s.tick === lastOpenTick && s.bank.items.length === 0) return s;
        lastOpenTick = s.tick;
        if (s.bank.items.length > 0) {
            sessionListed = true;
            emptyOpenTicks = 0;
        } else if (sessionListed && ++emptyOpenTicks < 2) {
            return s;
        }
        const next = new Map<string, number>();
        for (const i of s.bank.items) next.set(i.name, (next.get(i.name) ?? 0) + i.count);
        counts = next;
        return s;
    };
    return { observe, counts: () => counts };
}

/** `d` with every state it hands out observed by `memory`. */
export const watchBank = (d: Driver, memory: BankMemory): Driver => ({
    state: () => memory.observe(d.state()),
    nextTick: () => d.nextTick().then(memory.observe),
    send: action => d.send(action),
    scan: radius => d.scan(radius),
    log: (msg, data) => d.log(msg, data),
    screenshot: label => d.screenshot(label),
    now: () => d.now(),
});
