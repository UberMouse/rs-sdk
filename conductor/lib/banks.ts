// Banks, for tasks that bank "at the nearest bank" when given no area: the bank sites of lib/bank-sites.ts (the world
// index's, with the curated facts laid over them), and the walk that picks the nearest.
import type { Area } from './area';
import { type Account, meetsOneOf, NO_ACCOUNT } from './account';
import { BANKS, type BankSite } from './bank-sites';
import { CONNECTORS, MAX_HOPS } from './connectors';
import { nearestWay } from './walk-graph';

export { BANKS, type BankSite, OVERRIDES, overridesById } from './bank-sites';

/** Radius of the area a bank walk aims for; `walkToArea` walks to within radius - 1 tiles of `stand`. */
export const BANK_STAND_RADIUS = 3;

/**
 * The bank a task may pick on its own nearest to the point: of the banks not curated out whose `reach` the account
 * meets, the one the fewest run ticks away over the world index's graph, walking as the walker does
 * (lib/walk-graph.ts: through the doors and tolls the account opens and pays and the moves it makes, climbing at
 * most MAX_HOPS of the connectors lib/connectors.ts lists). Undefined when none is reached.
 */
export function nearestBank(
    from: { level?: number; x: number; z: number },
    account: Account = NO_ACCOUNT,
): BankSite | undefined {
    const candidates = BANKS.filter(b => b.auto && meetsOneOf(account, b.reach));
    const way = nearestWay(
        { level: from.level ?? 0, x: from.x, z: from.z },
        candidates.map(b => b.stand),
        { account, connectors: CONNECTORS, maxHops: MAX_HOPS },
    );
    return way && candidates[way.target];
}

export const bankArea = (b: BankSite): Area => ({
    x: b.stand.x,
    z: b.stand.z,
    radius: BANK_STAND_RADIUS,
    level: b.stand.level,
});
