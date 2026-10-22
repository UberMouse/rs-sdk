// What a rate depends on about the player: skill levels, and the tools and worn items that change a roll. It is all a
// family reads about the player, so a page column, a bot's live state and a query all go through one shape.
import type { Config } from '../sources/configs';
import { SKILLS, type Skill } from './server';

export interface Profile {
    /** Current levels (a boost counts: `stat_random` and the pickaxe check read the current level). */
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
    /** Objs worn that a family reads (a staff of fire, a ring of forging), by obj config name; none by default. */
    worn: string[];
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
}

/** The profile at `levels`, with the best axe and pickaxe usable there and `worn`. */
export function profileOf(levels: Record<Skill, number>, opts: Omit<ProfileOptions, 'atLeast'>): Profile {
    const best = (kind: keyof Tools): string | null => bestTool(opts.tools[kind], levels[TOOL_SKILL[kind]]);
    return {
        levels,
        axe: best('axe'),
        pickaxe: best('pickaxe'),
        glory: opts.glory ?? false,
        worn: [...(opts.worn ?? [])],
    };
}

/**
 * The profile a training page's level column models: `skill` at `level`, every other skill at the same level
 * raised to its `atLeast` floor, the best axe and pickaxe usable at those levels, and `worn`.
 */
export function profileAt(skill: Skill, level: number, opts: ProfileOptions): Profile {
    const levels = Object.fromEntries(
        SKILLS.map(s => [s, s === skill ? level : Math.max(level, opts.atLeast?.[s] ?? 0)]),
    ) as Record<Skill, number>;
    return profileOf(levels, opts);
}
