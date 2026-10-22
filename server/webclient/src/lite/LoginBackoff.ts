/** Bounded jitter shared by initial remote logins and fleet retry loops. */
export function loginJitterMs(maxMs: number, random = Math.random): number {
    const bounded = Number.isFinite(maxMs) ? Math.max(0, Math.min(60_000, maxMs)) : 5000;
    return Math.floor(random() * bounded);
}
