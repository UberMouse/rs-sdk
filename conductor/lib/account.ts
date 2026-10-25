// What an account meets of the world index's requirement tokens (wiki/world/requirements.ts): a site's `reach` sets,
// and the requirement of each door, connector and crossing a walk takes (lib/walk-graph.ts). Read from the bot's own
// state, which has its skills and items and, from the quest tab, which quests are done or started (not their stage):
// a token the state cannot settle counts as not met, so a walk is never planned through a door or to a bank that may
// refuse the bot. The caller adds what it has checked to `met`.
import type { BotWorldState } from '../../sdk/types';
import { ANY_CAME_FROM, CAME_FROM } from '../../wiki/world/requirements';
import { configName, objInfo } from './packs';
import { QUESTS, questProgress } from './quests';
import { inEssenceMine } from './runecraft';
import { countItems } from './util';

export interface Account {
    /** Base levels by skill name in lower case, as the tokens name them (`skill:fishing:68`). */
    levels: Readonly<Record<string, number>>;
    /** Coins carried. A walk pays a toll from them, so `coins:<n>` is met with n or more. */
    coins: number;
    /**
     * Current levels (boosted or drained) by the same names, as a stat_random roll reads them
     * (server/engine/src/engine/script/handlers/PlayerOps.ts STAT_RANDOM); `hitpoints` is the hitpoints left. Absent:
     * the base levels.
     */
    current?: Readonly<Record<string, number>>;
    /** Objs carried, by config name, with their counts: `item:<obj>:held` and `consume:<obj>:<n>`. */
    held?: ReadonlyMap<string, number>;
    /** Objs worn, by config name: `item:<obj>:worn`. */
    worn?: ReadonlySet<string>;
    /**
     * Other tokens the caller has checked and the account meets: a quest done (`quest:<id>`, which meets its stages up
     * to its completion value, lib/quests.ts; a gate above that is met only when listed), a category of obj carried or
     * worn (`category:<category>:held`), the wizard the way came in by
     * (`other:came from <npc>`). A token neither here nor a skill, coins, an obj or `members` is not met.
     */
    met?: ReadonlySet<string>;
}

/** An account that meets nothing but `members`: the ways and banks open to any account. */
export const NO_ACCOUNT: Account = { levels: {}, coins: 0 };

/**
 * The account as a bot's state shows it: its base and current levels, the coins it carries, the objs it carries and
 * wears (by config name, with their categories in `met`). Quests are read from the quest tab (done, or started for `>=1`); the rest is not read, so it is not met.
 */
export function accountOf(state: BotWorldState): Account {
    const levels: Record<string, number> = {};
    const current: Record<string, number> = {};
    for (const s of state.skills) {
        levels[s.name.toLowerCase()] = s.baseLevel;
        current[s.name.toLowerCase()] = s.level;
    }
    if (state.player) current.hitpoints = state.player.hp;
    const held = new Map<string, number>();
    const worn = new Set<string>();
    const met = new Set<string>();
    const categories = (obj: string, how: 'held' | 'worn') => {
        const category = objInfo(obj)?.category;
        if (category) met.add(`category:${category}:${how}`);
    };
    for (const i of state.inventory) {
        const obj = configName('obj', i.id);
        if (!obj) continue;
        held.set(obj, (held.get(obj) ?? 0) + i.count);
        categories(obj, 'held');
    }
    for (const i of state.equipment) {
        const obj = configName('obj', i.id);
        if (!obj) continue;
        worn.add(obj);
        categories(obj, 'worn');
    }
    // The quest tab's colours: a quest done meets `quest:<id>` and its stages up to its completion value (a gate above
    // it is met only when listed), one started meets `quest:<id>>=1`.
    for (const id of Object.keys(QUESTS)) {
        const progress = questProgress(state, id);
        if (progress === 'done') met.add(`quest:${id}`);
        else if (progress === 'started') met.add(`quest:${id}>=1`);
    }
    // Inside the essence mine any wizard's way out is open until the caller knows the one the bot came in by.
    if (inEssenceMine(state)) met.add(ANY_CAME_FROM);
    return { levels, current, coins: countItems(state, /^coins$/i), held, worn, met };
}

/** The current level of a skill: `current`'s, else the base level, else 1. */
export const currentLevel = (account: Account, skill: string): number =>
    account.current?.[skill] ?? account.levels[skill] ?? 1;

/** Whether the account meets one requirement token. */
export function meetsToken(account: Account, token: string): boolean {
    // Bots always play on members worlds; a token the caller checked is met.
    if (token === 'members' || account.met?.has(token)) return true;
    const skill = /^skill:([a-z0-9_]+):(\d+)$/.exec(token);
    if (skill) return (account.levels[skill[1]!] ?? 1) >= Number(skill[2]);
    const coins = /^coins:(\d+)$/.exec(token);
    if (coins) return account.coins >= Number(coins[1]);
    const item = /^item:([a-z0-9_]+):(held|worn)$/.exec(token);
    if (item) return item[2] === 'held' ? (account.held?.get(item[1]!) ?? 0) > 0 : !!account.worn?.has(item[1]!);
    const consume = /^consume:([a-z0-9_]+):(\d+)$/.exec(token);
    if (consume) return (account.held?.get(consume[1]!) ?? 0) >= Number(consume[2]);
    // The way out of the essence mine returns to the wizard the way came in by: met by the wizard on record, or, with
    // none on record, by `ANY_CAME_FROM` (a bot already inside the mine, which the caller checked). Never otherwise: a
    // plan that went in by one wizard and out by another's portal cannot be walked.
    if (token.startsWith(CAME_FROM)) {
        const record = [...(account.met ?? [])].filter(t => t.startsWith(CAME_FROM) && t !== ANY_CAME_FROM);
        return record.length === 0 && !!account.met?.has(ANY_CAME_FROM);
    }
    // A quest stage meets every lower stage of it, and a quest done meets every stage up to its completion value. A
    // gate above that value (Priest in Peril's holy barrier needs 61, the tab is green from 60) is a step after
    // completion that the tab cannot show, so it is met only when the caller lists that token.
    const stage = /^quest:([a-z0-9_]+)>=(\d+)$/.exec(token);
    if (!stage) return false;
    const [, id, n] = stage;
    if (account.met?.has(`quest:${id}`) && Number(n) <= (QUESTS[id!]?.complete ?? Infinity)) return true;
    for (const t of account.met ?? []) {
        const m = /^quest:([a-z0-9_]+)>=(\d+)$/.exec(t);
        if (m && m[1] === id && Number(m[2]) >= Number(n)) return true;
    }
    return false;
}

/** Whether the account meets every token of a requirement set (`[]` is met by any account). */
export const meetsSet = (account: Account, set: readonly string[]): boolean => set.every(t => meetsToken(account, t));

/** Whether the account meets one of a site's `reach` sets (`[]`, no set, is met by none). */
export const meetsOneOf = (account: Account, sets: readonly (readonly string[])[]): boolean =>
    sets.some(s => meetsSet(account, s));
