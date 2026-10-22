// What a rate depends on about the player: skill levels, and the tools and worn items that change a roll, the prayers
// on and the boosts. It is all a family reads about the player, so a page column, a bot's live state and a query all go
// through one shape. The gear a combat model reads (summed bonuses, swing speed, style table) is derived from it by
// gearOf, so a Profile stays plain data.
import type { Config } from '../sources/configs';
import { combatLevel } from './combat';
import { ProfileError } from './family';
import { BONUSES, UNARMED_ATTACK_RATE, type Bonus, type CombatStyles, type Equipment, type Equipments } from './items';
import { SKILLS, type Skill } from './server';

/** A skill an attack, strength or defence prayer raises (player_combat_stat.rs2:214-230). */
export type PrayedSkill = 'attack' | 'strength' | 'defence';

/** The percentage each tier of those prayers gives (player_combat_stat.rs2:214-230). */
export type PrayerPercent = 105 | 110 | 115;

export interface Profile {
    /**
     * Current levels, any boost included (`stat_random`, the pickaxe check and the combat effective levels read the
     * current level).
     */
    levels: Record<Skill, number>;
    /** The axe the woodcutting checker would pick (an obj config name), or null for none. */
    axe: string | null;
    /** The pickaxe the mining checker would pick, or null for none. */
    pickaxe: string | null;
    /**
     * A charged amulet of glory worn: a neck item of `category_557` (only `amulet_of_glory_1`..`4`) makes the
     * mining gem roll `random(86)` instead of `random(256)` on a members world (skill_mining/scripts/mining.rs2:134-139).
     */
    glory: boolean;
    /**
     * Objs worn, by obj config name: what a family reads (a staff of fire, a ring of forging) and the gear gearOf
     * sums; none by default.
     */
    worn: string[];
    /** The attack, strength and defence prayers on, by the percentage each gives; none by default. */
    prayers?: Partial<Record<PrayedSkill, PrayerPercent>>;
    /**
     * How far each current level is above its base (a potion's boost); none by default. `levels` already counts it;
     * baseLevels takes it off for what reads `stat_base` (the combat level, the wield levels).
     */
    boosts?: Partial<Record<Skill, number>>;
}

/** A tool and the level its checker asks for (0: none). */
export interface Tool {
    obj: string;
    level: number;
}

/** Each kind of tool, best first, in the order its checker tries them. */
export interface Tools {
    axe: Tool[];
    pickaxe: Tool[];
}

/**
 * The axes `woodcutting_axe_checker` tries, best first (skill_woodcutting/scripts/woodcut.rs2:220-240). It asks no
 * Woodcutting level ("no wc req in 2004", :197): any axe held works from level 1.
 */
export const AXES = ['rune_axe', 'adamant_axe', 'mithril_axe', 'black_axe', 'steel_axe', 'iron_axe', 'bronze_axe'];

/**
 * The pickaxes `pickaxe_checker` tries, best first, each only at Mining `>= oc_param(<pickaxe>, levelrequire)`
 * (skill_mining/scripts/pickaxe_checker.rs2:4-21).
 */
export const PICKAXES = [
    'rune_pickaxe',
    'adamant_pickaxe',
    'mithril_pickaxe',
    'steel_pickaxe',
    'iron_pickaxe',
    'bronze_pickaxe',
];

/** The tool tiers, the pickaxes' levels read from their obj configs (`param=levelrequire,<n>`, pickaxes.obj). */
export function readTools(objs: ReadonlyMap<string, Config>): Tools {
    const pickaxe = PICKAXES.map(obj => {
        const param = objs.get(obj)?.param?.find(p => p.startsWith('levelrequire,'));
        if (param === undefined) throw new Error(`No levelrequire param on obj ${obj}`);
        return { obj, level: Number(param.slice('levelrequire,'.length)) };
    });
    return { axe: AXES.map(obj => ({ obj, level: 0 })), pickaxe };
}

/** The skill whose level picks each kind of tool: the woodcutting checker reads the axe, the mining one the pickaxe. */
export const TOOL_SKILL: Record<keyof Tools, Skill> = { axe: 'woodcutting', pickaxe: 'mining' };

const TOOL_KINDS = Object.keys(TOOL_SKILL) as (keyof Tools)[];

/** The kind of tool `skill` reads from the profile, or null for a skill that reads none. */
export function toolKindOfSkill(skill: Skill): keyof Tools | null {
    return TOOL_KINDS.find(k => TOOL_SKILL[k] === skill) ?? null;
}

/** The kind of tool `obj` is, by its tier in `tools`, or null for an obj in neither. */
export function toolKindOfObj(tools: Tools, obj: string): keyof Tools | null {
    return TOOL_KINDS.find(k => tools[k].some(t => t.obj === obj)) ?? null;
}

/** The best tool of a tier usable at `level`, or null when none is. */
export function bestTool(tier: readonly Tool[], level: number): string | null {
    return tier.find(t => level >= t.level)?.obj ?? null;
}

export interface ProfileOptions {
    tools: Tools;
    /** Floors for the other skills: a method's requirements, so a column is not blocked by a second skill. */
    atLeast?: Partial<Record<Skill, number>>;
    glory?: boolean;
    worn?: readonly string[];
    prayers?: Profile['prayers'];
    /** Added to the base levels the profile is built from. */
    boosts?: Profile['boosts'];
}

/**
 * The profile at base `levels` raised by `boosts`, with the best axe and pickaxe usable at the boosted levels, `worn`
 * and `prayers`.
 */
export function profileOf(base: Record<Skill, number>, opts: Omit<ProfileOptions, 'atLeast'>): Profile {
    const boosts = opts.boosts;
    const levels = boosts
        ? (Object.fromEntries(SKILLS.map(s => [s, base[s] + (boosts[s] ?? 0)])) as Record<Skill, number>)
        : base;
    const best = (kind: keyof Tools): string | null => bestTool(opts.tools[kind], levels[TOOL_SKILL[kind]]);
    return {
        levels,
        axe: best('axe'),
        pickaxe: best('pickaxe'),
        glory: opts.glory ?? false,
        worn: [...(opts.worn ?? [])],
        ...(opts.prayers ? { prayers: { ...opts.prayers } } : {}),
        ...(boosts ? { boosts: { ...boosts } } : {}),
    };
}

/** The base levels under a profile's current ones: each level less its boost. */
export function baseLevels(profile: Profile): Record<Skill, number> {
    const boosts = profile.boosts ?? {};
    return Object.fromEntries(SKILLS.map(s => [s, profile.levels[s] - (boosts[s] ?? 0)])) as Record<Skill, number>;
}

/** The profile's combat level, from its base levels: `~player_combat_level` reads `stat_base` (combat_level.rs2:1-10). */
export function combatLevelOf(profile: Profile): number {
    return combatLevel(baseLevels(profile));
}

/** What a combat model reads of the profile's worn objs. */
export interface Gear {
    /** Each worn-bonus param summed over the worn objs (`~equip_get_bonuses`, player/scripts/equip.rs2:244-285). */
    bonuses: Record<Bonus, number>;
    /** The obj in the weapon slot, null for none. */
    weapon: Equipment | null;
    /** Ticks between swings: the weapon's `attackrate`, UNARMED_ATTACK_RATE with none (player_melee.rs2:56-59). */
    attackRate: number;
    /** The weapon's style table (readCombatStyles), the unarmed one with no weapon. */
    styles: ReturnType<CombatStyles>;
    /** The quest varps the worn objs' wield checks read: not checked here, as a Profile holds no quest state. */
    quests: string[];
}

/**
 * The slot the weapon is in: player_melee.rs2:37 reads `inv_getobj(worn, ^wearpos_rhand)`, `^wearpos_rhand = 3`
 * (player/configs/equip.constant:5), the slot ObjType.getWearPosId gives `wearpos=righthand`
 * (server/engine/src/cache/config/ObjType.ts:106-107). An obj goes in the slot of its first wearpos
 * (`oc_wearpos`, equip.rs2:376).
 */
const WEAPON_SLOT = 'righthand';

/**
 * The gear of `profile.worn`. Throws a ProfileError when two worn objs share a slot (`~wearpos_conflicts` compares
 * every `wearpos`, `wearpos2` and `wearpos3` of the two, player/scripts/equip.rs2:474-488) or one needs a higher base
 * level to wield than the profile has (the levelrequire labels check `stat_base`, levelrequire/scripts/
 * levelrequire.rs2:6-12). A wield check's quest varps are returned in `quests`, not checked.
 */
export function gearOf(profile: Profile, data: { equipment: Equipments; styles: CombatStyles }): Gear {
    const worn = profile.worn.map(data.equipment);
    const held = new Map<string, string>();
    for (const e of worn) {
        for (const slot of e.wearpos) {
            const other = held.get(slot);
            if (other !== undefined) throw new ProfileError(`${other} and ${e.obj} are both worn in ${slot}`);
        }
        for (const slot of e.wearpos) held.set(slot, e.obj);
    }
    const base = baseLevels(profile);
    for (const e of worn) {
        for (const [skill, level] of Object.entries(e.wield?.levels ?? {}) as [Skill, number][]) {
            if (base[skill] < level)
                throw new ProfileError(
                    `${e.obj} needs ${skill} ${level} to wield (${e.wield!.at}); the profile has ${base[skill]}`,
                );
        }
    }
    const bonuses = Object.fromEntries(BONUSES.map(b => [b, worn.reduce((sum, e) => sum + e.bonuses[b], 0)])) as Record<
        Bonus,
        number
    >;
    const weapon = worn.find(e => e.wearpos[0] === WEAPON_SLOT) ?? null;
    return {
        bonuses,
        weapon,
        attackRate: weapon ? weapon.attackRate : UNARMED_ATTACK_RATE.value,
        // A weapon with no category takes switch_category's `case default` table (combat.rs2:21), which readCombatStyles
        // gives any category it has no case for; undefined asks it for the no-weapon table (:16-18).
        styles: data.styles(weapon ? (weapon.category ?? '') : undefined),
        quests: [...new Set(worn.flatMap(e => e.wield?.quests ?? []))],
    };
}

/**
 * The profile a training page's level column models: `skill` at `level`, every other skill at the same level
 * raised to its `atLeast` floor, those as base levels under `boosts`, the best axe and pickaxe usable at the boosted
 * levels, `worn` and `prayers`.
 */
export function profileAt(skill: Skill, level: number, opts: ProfileOptions): Profile {
    const levels = Object.fromEntries(
        SKILLS.map(s => [s, s === skill ? level : Math.max(level, opts.atLeast?.[s] ?? 0)]),
    ) as Record<Skill, number>;
    return profileOf(levels, opts);
}
