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

/** The best tool of a tier usable at `level`, or null when none is. */
export function bestTool(tier: readonly Tool[], level: number): string | null {
    return tier.find(t => level >= t.level)?.obj ?? null;
}

export interface ProfileOptions {
    tools: Tools;
    /** Floors for the other skills: a method's requirements, so a column is not blocked by a second skill. */
    atLeast?: Partial<Record<Skill, number>>;
    glory?: boolean;
}

/** The profile at `levels`, with the best axe and pickaxe usable there. */
export function profileOf(levels: Record<Skill, number>, opts: Omit<ProfileOptions, 'atLeast'>): Profile {
    return {
        levels,
        axe: bestTool(opts.tools.axe, levels.woodcutting),
        pickaxe: bestTool(opts.tools.pickaxe, levels.mining),
        glory: opts.glory ?? false,
    };
}

/**
 * The profile a training page's level column models: `skill` at `level`, every other skill at the same level
 * raised to its `atLeast` floor, and the best axe and pickaxe usable at those levels.
 */
export function profileAt(skill: Skill, level: number, opts: ProfileOptions): Profile {
    const levels = Object.fromEntries(
        SKILLS.map(s => [s, s === skill ? level : Math.max(level, opts.atLeast?.[s] ?? 0)]),
    ) as Record<Skill, number>;
    return profileOf(levels, opts);
}
