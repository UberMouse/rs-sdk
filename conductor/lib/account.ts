// What an account meets of the world index's requirement tokens (wiki/world/requirements.ts): a site's `reach` sets,
// and the requirement of each door and connector a walk crosses (lib/walk-graph.ts). Read from the bot's own state,
// which has its skills and items but not its quests: a token the state cannot settle counts as not met, so a walk
// is never planned through a door or to a bank that may refuse the bot.
import type { BotWorldState } from '../../sdk/types';
import { countItems } from './util';

export interface Account {
    /** Base levels by skill name in lower case, as the tokens name them (`skill:fishing:68`). */
    levels: Readonly<Record<string, number>>;
    /** Coins carried. A walk pays a toll from them, so `coins:<n>` is met with n or more. */
    coins: number;
    /**
     * Other tokens the caller has checked and the account meets: a quest done (`quest:<id>`, which meets every stage
     * of it too), an item worn (`item:<obj>:worn`). A token neither here nor a skill, coins or `members` is not met.
     */
    met?: ReadonlySet<string>;
}

/** An account that meets nothing but `members`: the ways and banks open to any account. */
export const NO_ACCOUNT: Account = { levels: {}, coins: 0 };

/**
 * The account as a bot's state shows it: its base levels and the coins it carries. Quests, worn and held items and
 * the rest are not read (the state names items by display name, the tokens by config name), so they are not met.
 */
export function accountOf(state: BotWorldState): Account {
    const levels: Record<string, number> = {};
    for (const s of state.skills) levels[s.name.toLowerCase()] = s.baseLevel;
    return { levels, coins: countItems(state, /^coins$/i) };
}

/** Whether the account meets one requirement token. */
export function meetsToken(account: Account, token: string): boolean {
    // Bots always play on members worlds.
    if (token === 'members') return true;
    const skill = /^skill:([a-z0-9_]+):(\d+)$/.exec(token);
    if (skill) return (account.levels[skill[1]!] ?? 1) >= Number(skill[2]);
    const coins = /^coins:(\d+)$/.exec(token);
    if (coins) return account.coins >= Number(coins[1]);
    if (account.met?.has(token)) return true;
    // A quest done meets every stage gate of it.
    const stage = /^(quest:[a-z0-9_]+)>=\d+$/.exec(token);
    return !!stage && !!account.met?.has(stage[1]!);
}

/** Whether the account meets every token of a requirement set (`[]` is met by any account). */
export const meetsSet = (account: Account, set: readonly string[]): boolean => set.every(t => meetsToken(account, t));

/** Whether the account meets one of a site's `reach` sets (`[]`, no set, is met by none). */
export const meetsOneOf = (account: Account, sets: readonly (readonly string[])[]): boolean =>
    sets.some(s => meetsSet(account, s));
