// What the cycle model reads about objs: how many slots they take, what they are worth, whether a tool can be worn
// instead of carried, how much a food heals, and how many slots the inventory has. All from the game data.
import { readFileSync } from 'fs';
import { join } from 'path';
import { SCRIPTS } from '../paths';
import { parseConfigs, first, type Config } from '../sources/configs';
import type { DbRow } from '../sources/dbrows';
import { ModelError } from './family';

export interface Item {
    /** `stackable=yes`: any number of it takes one slot. */
    stackable: boolean;
    /** The obj's `cost`, or the engine's default of 1 when the config sets none (ObjType.ts `cost = 1`): coins. */
    cost: number;
    /** It has a `wearpos`: ideal play wields a tool like it (an axe, a pickaxe) rather than carry it. */
    wearable: boolean;
}

/** An obj's Item; throws a ModelError naming it when the game has no such obj. */
export type Items = (obj: string) => Item;

/** ObjType.ts's default `cost` (server/engine/src/cache/config/ObjType.ts:147), for a config with no `cost=` line. */
const DEFAULT_COST = 1;

export function readItems(objs: ReadonlyMap<string, Config>): Items {
    return obj => {
        const cfg = objs.get(obj);
        if (!cfg) throw new ModelError(`no obj ${obj}`);
        const cost = first(cfg, 'cost');
        return {
            stackable: first(cfg, 'stackable') === 'yes',
            cost: cost === undefined ? DEFAULT_COST : Number(cost),
            wearable: first(cfg, 'wearpos') !== undefined,
        };
    };
}

/**
 * Hitpoints each food heals, by obj: the `stat_heal` of its consume_table row (player/configs/consumption/
 * consume_normal.dbrow), which ~consume_effect_apply heals (player/scripts/consumption/effects/scripts/
 * consume_effects.rs2:70-74). A row whose hitpoints heal has a percent part (`stat_heal,hitpoints,<n>,<percent>`
 * with percent > 0) heals by the player's level too, which is not read here, so that food is left out.
 */
export function readFoods(dbrows: readonly DbRow[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const row of dbrows.filter(r => r.table === 'consume_table')) {
        const heal = (row.data.stat_heal ?? []).find(([stat]) => stat === 'hitpoints');
        if (!heal || Number(heal[2] ?? 0) !== 0) continue;
        for (const [obj] of row.data.consumable ?? []) out.set(obj!, Number(heal[1]));
    }
    return out;
}

/** The player's inventory (`[inv]` in player/configs/player.inv) and the line its size is read from. */
export const INVENTORY_SOURCE = 'player/configs/player.inv';

/** The size of the player's inventory, `size=` of `[inv]` in `text` (player.inv); throws when it has none. */
export function readInventorySize(text: string): number {
    const size = Number(first(parseConfigs(text).get('inv'), 'size'));
    if (!Number.isInteger(size) || size < 1) throw new Error(`${INVENTORY_SOURCE} has no [inv] size`);
    return size;
}

/** 28 slots, read from the content when the module loads. */
export const INVENTORY_SLOTS = readInventorySize(readFileSync(join(SCRIPTS, INVENTORY_SOURCE), 'utf8'));
