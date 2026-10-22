// What the cycle model reads about objs: how many slots they take, what they are worth, whether a tool can be worn
// instead of carried, how much a food heals, and how many slots the inventory has; and what the combat model reads:
// a worn obj's bonuses, slots, speed and wield levels, a weapon's styles, a bone's Prayer XP. All from the game data.
import { readFileSync } from 'fs';
import { join } from 'path';
import { SCRIPTS } from '../paths';
import { parseConfigs, first, type Config } from '../sources/configs';
import type { Constant } from '../sources/constants';
import type { DbRow } from '../sources/dbrows';
import { readWieldRequirements, type WieldRequirement } from '../sources/levelrequire';
import { blocks } from '../sources/triggers';
import { readStyleSkills } from './combat';
import { ModelError } from './family';
import { damageType, type DamageType } from './npcs';
import { paramInt, type ParamData } from './params';
import type { ServerDefault, Skill } from './server';

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

/** The worn-bonus params `~equip_get_bonuses` sums over the worn inventory (player/scripts/equip.rs2:244-285). */
export const BONUSES = [
    'stabattack',
    'slashattack',
    'crushattack',
    'magicattack',
    'rangeattack',
    'stabdefence',
    'slashdefence',
    'crushdefence',
    'magicdefence',
    'rangedefence',
    'strengthbonus',
    'prayerbonus',
    'rangebonus',
] as const;
export type Bonus = (typeof BONUSES)[number];

/** What the combat model reads about a wearable obj (phase 4 survey §1.10). */
export interface Equipment {
    obj: string;
    /**
     * Config `wearpos`, then `wearpos2` and `wearpos3` when set: the slot it goes in first. `~wearpos_conflicts`
     * (equip.rs2:474-488) counts any slot two objs share in these as a clash (a two-handed sword's `lefthand`).
     */
    wearpos: string[];
    /** Each bonus param, its `.param` default (0) when the obj sets none. */
    bonuses: Record<Bonus, number>;
    /**
     * `attackrate` (default 4): a weapon's ticks between swings (skill_combat/scripts/player/player_melee.rs2:59). No
     * weapon swings at UNARMED_ATTACK_RATE, not by this param.
     */
    attackRate: number;
    attackRange: number;
    /** Config `category`, which picks the weapon's style table. */
    category: string | undefined;
    /** What the levelrequire scripts need to wield it, undefined when they do not gate it. */
    wield: WieldRequirement | undefined;
}

/** The player's melee swing, whose delay for no weapon is a literal: `if ($weapon = null) { %action_delay = ...`. */
export const MELEE_SOURCE = 'skill_combat/scripts/player/player_melee.rs2';

/**
 * The ticks between a player's swings with no weapon: `%action_delay = add(map_clock, <n>)` under `if ($weapon =
 * null)` in `text` (player_melee.rs2:56-57). Throws when the script has no such line.
 */
export function readUnarmedAttackRate(text: string): ServerDefault {
    const m = text.match(/if \(\$weapon = null\) \{\s*%action_delay = add\(map_clock, (\d+)\);/);
    if (!m) throw new Error(`Expected the unarmed swing delay in ${MELEE_SOURCE}: has it moved?`);
    const line = text.slice(0, m.index! + m[0].indexOf('%action_delay')).split('\n').length;
    return { value: Number(m[1]), at: `${MELEE_SOURCE}:${line}` };
}

/** 4 ticks, read from the content when the module loads. */
export const UNARMED_ATTACK_RATE = readUnarmedAttackRate(readFileSync(join(SCRIPTS, MELEE_SOURCE), 'utf8'));

/** An obj's Equipment; throws a ModelError naming it when the game has no such obj or it has no `wearpos`. */
export type Equipments = (obj: string) => Equipment;

export function readEquipment(
    data: ParamData & { objs: ReadonlyMap<string, Config>; scripts: readonly [file: string, text: string][] },
): Equipments {
    const wield = readWieldRequirements(data.scripts);
    return obj => {
        const cfg = data.objs.get(obj);
        if (!cfg) throw new ModelError(`no obj ${obj}`);
        const wearpos = (['wearpos', 'wearpos2', 'wearpos3'] as const).flatMap(k => cfg[k] ?? []);
        if (!wearpos.length) throw new ModelError(`obj ${obj} cannot be worn: it has no wearpos`);
        const what = `obj ${obj}`;
        return {
            obj,
            wearpos,
            bonuses: Object.fromEntries(BONUSES.map(b => [b, paramInt(cfg, b, data, what)])) as Record<Bonus, number>,
            attackRate: paramInt(cfg, 'attackrate', data, what),
            attackRange: paramInt(cfg, 'attackrange', data, what),
            category: first(cfg, 'category'),
            wield: wield.get(obj),
        };
    };
}

/**
 * One attack style of a weapon's style table: its damage style (`^style_<kind>_<style>`), damage type, and the skills
 * its hits train.
 */
export interface CombatStyle {
    kind: 'melee' | 'ranged' | 'magic';
    /** For melee, a MeleeStyle (`accurate`, `aggressive`, `defensive`, `controlled`). */
    style: string;
    damageType: DamageType;
    /** The skills `~give_combat_experience` pays for it, Hitpoints apart (readStyleSkills). */
    skills: Skill[];
}

/** The style table a weapon of a category (undefined for no weapon or no category) uses, by the dbrow's name. */
export type CombatStyles = (category: string | undefined) => { table: string; styles: CombatStyle[] };

/** The script that picks a weapon's style table, and its proc. */
export const STYLE_SOURCE = { file: 'skill_combat/scripts/combat.rs2', proc: '[proc,combat_get_weapon_style_data]' };

/**
 * The style tables `~combat_get_weapon_style_data` picks (combat.rs2:15-39): no weapon is the `if ($weapon = null
 * ...)` table, each `case <category>` its table, and any other category the `case default` one. A table is a
 * combat_style_table dbrow (skill_combat/configs/combat.dbrow) whose `damagestyle` and `damagetype` lists are in the
 * order of the weapon interface's style buttons (`db_getfield(..., $attackstyle)`, combat.rs2:43-47). Members-only
 * weapons count as worlds are members (`map_members`).
 */
export function readCombatStyles(data: {
    dbrows: readonly DbRow[];
    constants: ReadonlyMap<string, Constant>;
    scripts: readonly [file: string, text: string][];
}): CombatStyles {
    const text = data.scripts.find(([f]) => f === STYLE_SOURCE.file)?.[1];
    const proc = text && blocks(STYLE_SOURCE.file, text).find(b => b.header === STYLE_SOURCE.proc);
    if (!proc) throw new Error(`${STYLE_SOURCE.file} has no ${STYLE_SOURCE.proc}`);
    const body = proc.body.replace(/\/\/[^\n]*/g, '');
    const unarmed = body.match(/\$weapon = null[^{]*\{\s*return\((\w+)\);/)?.[1];
    const cases = new Map([...body.matchAll(/case (\w+) : return\((\w+)\);/g)].map(m => [m[1]!, m[2]!]));
    const fallback = cases.get('default');
    if (!unarmed || !fallback) throw new Error(`${STYLE_SOURCE.file}:${proc.line}: no unarmed or default style table`);
    const trains = readStyleSkills(text);
    const rows = new Map(data.dbrows.filter(r => r.table === 'combat_style_table').map(r => [r.row, r]));
    const table = (name: string): CombatStyle[] => {
        const row = rows.get(name);
        if (!row) throw new ModelError(`no combat_style_table row ${name}`);
        const types = row.data.damagetype ?? [];
        return (row.data.damagestyle ?? []).map(([s], i) => {
            const m = s?.match(/^\^style_(melee|ranged|magic)_(\w+)$/);
            const t = types[i]?.[0];
            if (!m || t === undefined) throw new ModelError(`${name} has a malformed style ${i}: ${s}, ${t}`);
            const skills = trains.get(s!);
            if (!skills?.length) throw new ModelError(`${name} style ${i}: ${STYLE_SOURCE.file} gives ${s} no XP`);
            return {
                kind: m[1] as CombatStyle['kind'],
                style: m[2]!,
                damageType: damageType(t, data.constants, `${name} style ${i}`),
                skills,
            };
        });
    };
    return category => {
        const name = category === undefined ? unarmed : (cases.get(category) ?? fallback);
        return { table: name, styles: table(name) };
    };
}

/**
 * The Prayer XP for burying an obj, in tenths: its `bone_exp` param, which `stat_advance(prayer, ...)` grants
 * (skill_prayer/scripts/bury_bone.rs2:15), or the param's default (0) for an obj that sets none.
 */
export function readBoneXp(data: ParamData & { objs: ReadonlyMap<string, Config> }): (obj: string) => number {
    return obj => {
        const cfg = data.objs.get(obj);
        if (!cfg) throw new ModelError(`no obj ${obj}`);
        return paramInt(cfg, 'bone_exp', data, `obj ${obj}`);
    };
}
