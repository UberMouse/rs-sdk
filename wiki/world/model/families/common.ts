// What the formula families share: the game data they read, how a family finds its target at a site and checks
// its params, and the engine timings and rolls more than one skill script is built from.
import { readConfigs, type Config } from '../../sources/configs';
import { readConstants, type Constant } from '../../sources/constants';
import { readDbrows, type DbRow } from '../../sources/dbrows';
import { readScripts } from '../../sources/triggers';
import type { Feature, FeatureKind, Site, World } from '../../types';
import { cmp } from '../../util';
import { ModelError, ProfileError, type Family } from '../family';
import type { Profile } from '../profile';
import type { Skill } from '../server';

/** The game data the families read, gathered once: the build reads the real files, a test hands in a few rows. */
export interface GameData {
    dbrows: DbRow[];
    objs: ReadonlyMap<string, Config>;
    locs: ReadonlyMap<string, Config>;
    structs: ReadonlyMap<string, Config>;
    npcs: ReadonlyMap<string, Config>;
    /** The `.param` configs, whose `default=` a config without the param gets. */
    params: ReadonlyMap<string, Config>;
    constants: ReadonlyMap<string, Constant>;
    /** The .rs2 files, by path relative to server/content/scripts, for values a script writes inline (fishing). */
    scripts: [file: string, text: string][];
}

export const readGameData = (): GameData => ({
    dbrows: readDbrows(),
    objs: readConfigs('obj'),
    locs: readConfigs('loc'),
    structs: readConfigs('struct'),
    npcs: readConfigs('npc'),
    params: readConfigs('param'),
    constants: readConstants(),
    scripts: readScripts(),
});

/** A family module: built once from the game data, then asked for any number of models. */
export type FamilyFactory = (data: GameData) => Family;

/**
 * A family's params as strings, by key: `undefined` and `{}` are no params, and anything else that is not an
 * object of string values from `keys` fails, so a misspelt key is not silently ignored.
 */
export function stringParams<K extends string>(
    params: unknown,
    family: string,
    keys: readonly K[],
): Partial<Record<K, string>> {
    if (params === undefined) return {};
    if (typeof params !== 'object' || params === null || Array.isArray(params))
        throw new ModelError(`${family} params must be an object, not ${JSON.stringify(params)}`);
    for (const [k, v] of Object.entries(params)) {
        if (!(keys as readonly string[]).includes(k))
            throw new ModelError(`${family} has no param ${k} (it takes ${keys.join(', ')})`);
        if (typeof v !== 'string')
            throw new ModelError(`${family} param ${k} must be a string, not ${JSON.stringify(v)}`);
    }
    return params as Partial<Record<K, string>>;
}

/**
 * The features of one subtype at a site of `kind`: the one `subtype` names, or, when it names none, the site's
 * only subtype. Fails when the site is of another kind, has no such subtype, or has several and none is named.
 */
export function targetFeatures(
    site: Site,
    world: Pick<World, 'features'>,
    kind: FeatureKind,
    subtype: string | undefined,
): { subtype: string; features: Feature[] } {
    if (site.kind !== kind) throw new ModelError(`site ${site.id} is a ${site.kind} site, not a ${kind} site`);
    const all = site.features.map(i => world.features[i]!);
    const subtypes = [...new Set(all.map(f => f.subtype))].sort(cmp);
    const chosen = subtype ?? (subtypes.length === 1 ? subtypes[0]! : undefined);
    if (chosen === undefined)
        throw new ModelError(`site ${site.id} has several ${kind} subtypes (${subtypes.join(', ')}): name one`);
    const features = all.filter(f => f.subtype === chosen);
    if (!features.length)
        throw new ModelError(`site ${site.id} has no ${kind} ${chosen} (it has ${subtypes.join(', ')})`);
    return { subtype: chosen, features };
}

/** Fails with a ProfileError unless the profile's `skill` is at least `level`, naming what needs it. */
export function requireLevel(profile: Profile, skill: Skill, level: number, what: string): void {
    if (profile.levels[skill] < level)
        throw new ProfileError(`${what} needs ${skill} ${level}; the profile has ${profile.levels[skill]}`);
}

/** The rows of a dbtable by one value of `column` (its first field on each data line); a value in two rows throws. */
export function dbIndex(rows: readonly DbRow[], table: string, column: string): Map<string, DbRow> {
    const out = new Map<string, DbRow>();
    for (const row of rows.filter(r => r.table === table)) {
        for (const [v] of row.data[column] ?? []) {
            const prior = out.get(v!);
            if (prior) throw new Error(`${table}.${column} lists ${v} in both ${prior.row} and ${row.row}`);
            out.set(v!, row);
        }
    }
    return out;
}

/** Field `index` of a dbrow column's first value as a number; throws when it is missing or not a number. */
export function int(row: DbRow, column: string, index = 0): number {
    const v = Number(row.data[column]?.[0]?.[index]);
    if (row.data[column]?.[0]?.[index] === undefined || !Number.isFinite(v))
        throw new Error(`${row.row} has no number in ${column}[${index}]`);
    return v;
}

/** The `param=key,value` value of a config, or undefined. */
export function param(cfg: Config | undefined, key: string): string | undefined {
    const p = cfg?.param?.find(x => x.startsWith(`${key},`));
    return p === undefined ? undefined : p.slice(key.length + 1);
}

/** A config's `key` param; throws a ModelError naming `what` (`smelting struct bronze_bar`) when it has none. */
export function paramStr(cfg: Config, key: string, what: string): string {
    const v = param(cfg, key);
    if (v === undefined) throw new ModelError(`${what} has no ${key}`);
    return v;
}

/** A config's `key` param as a number; throws a ModelError naming `what` when it is missing or not a number. */
export function paramNum(cfg: Config, key: string, what: string): number {
    const v = Number(paramStr(cfg, key, what));
    if (!Number.isFinite(v)) throw new ModelError(`${what} has no number in ${key}`);
    return v;
}

/**
 * `~scale_by_playercount(base)` (general/scripts/player_count.rs2:1-4): `scale(4000 - min(players, 2000), 4000,
 * base)`, which the engine computes as `a * c / b` truncated to an int (NumberOps.ts SCALE, ScriptState.pushInt's
 * toInt32). At one player that is base - 1 for any base from 1 to 4000.
 */
export function scaleByPlayercount(base: number, players = 1): number {
    return Math.trunc(((4000 - Math.min(players, 2000)) * base) / 4000);
}

/**
 * Ticks between rolls of a skill loop that sets `%action_delay = map_clock + n` on the tick after a roll and rolls
 * on the tick `%action_delay = map_clock`: n + 1. The op re-runs once a tick, as `p_oploc` and `p_opnpc` set the
 * interaction for the next cycle (server/engine/src/engine/entity/Player.ts:1350).
 */
export const rollInterval = (n: number): number => n + 1;

/**
 * Ticks from the tick a click's op runs (T) to the tick the next click's op can, when the op holds the player with
 * `p_delay(k)`: the delay lasts to tick T + 1 + k (PlayerOps.ts:376-380), a click is refused while it does
 * (OpLocHandler.ts:14, OpNpcHandler.ts:16), and clicks are read before the delay is cleared each tick (World.ts:402
 * processClientsIn, then :425 processPlayers, which clears it at :776). So the next op runs at T + 2 + k.
 */
export const clickTicks = (k: number): number => k + 2;

/**
 * Ticks from a `weakqueue(d)` call to its script running: d when it is called from a click or dialog (before the
 * tick's queue pass), d + 1 when it is called from inside a queue script, as the player's queue list is walked
 * (Player.ts:966-976; enqueueScript puts the new entry on the tail with addTail, Player.ts:897). That holds when the
 * running entry is the list's tail, as the walk's cursor is saved before the script runs and restored after
 * (LinkList.ts:97-111), so the new entry is not reached until the next tick. It assumes the player has one weak-queue
 * entry in these loops: with another entry pending behind the running one, a new tail would be reached in the same
 * walk and d = 0 would run that tick.
 */
export const queueTicks = (d: number, fromQueue: boolean): number => (fromQueue ? d + 1 : d);

/** One row of a weighted loot table: `weight` out of the table's total, `min`..`max` of `obj`. */
export interface LootRow {
    obj: string;
    min: number;
    max: number;
    weight: number;
}

/** A dbrow's `loot` column (obj, min, max, weight, ...) as rows; throws naming the row when a number is not one. */
export function lootRows(row: DbRow): LootRow[] {
    return (row.data.loot ?? []).map((f, i) => {
        const [min, max, weight] = [1, 2, 3].map(j => Number(f[j]));
        if (!f[0] || [1, 2, 3].some(j => !f[j]?.trim()) || ![min, max, weight].every(n => Number.isFinite(n)))
            throw new Error(`${row.row} has a malformed loot[${i}]: ${f.join(',')}`);
        return { obj: f[0], min: min!, max: max!, weight: weight! };
    });
}

/**
 * The expected count of each obj from a loot table the thieving procs roll (skill_thieving/scripts/thieving.rs2):
 * from its last row up, each row rolls `random(remaining)` and wins when the roll is `>= remaining - weight`, then
 * `remaining` drops by `weight`. A row with `remaining` > 0 wins with min(weight, remaining)/remaining; at 0 or
 * below `random` gives 0 or a negative the test still passes, so it always wins. `each`: every row rolls
 * (pickpocket, :167-186); `first`: the first win ends it (stalls, :188-214). A win gives `~random_range(min, max)`,
 * `min + randominc(max - min)` (general/scripts/misc/random_range.rs2:1-2), (min + max)/2 on average. Objs are in
 * table order, one entry each.
 */
export function lootExpectation(
    rows: readonly LootRow[],
    total: number,
    mode: 'each' | 'first',
): { obj: string; count: number }[] {
    const count = new Map<string, number>(rows.map(r => [r.obj, 0]));
    let remaining = total;
    let reached = 1;
    for (const r of rows.toReversed()) {
        const win = remaining > 0 ? Math.min(r.weight, remaining) / remaining : 1;
        count.set(r.obj, count.get(r.obj)! + (mode === 'first' ? reached : 1) * win * ((r.min + r.max) / 2));
        if (mode === 'first') reached *= 1 - win;
        remaining -= r.weight;
    }
    return [...count].filter(([, c]) => c > 0).map(([obj, c]) => ({ obj, count: c }));
}
