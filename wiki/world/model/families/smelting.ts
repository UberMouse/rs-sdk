// Smelting a bar at a furnace from the smelting menu (oploc2 -> [label,smelting_interface] -> a Make button):
// skill_smithing/scripts/smelting/smelting.rs2, on the bar's smelting struct (configs/smelting/smelting.struct,
// `oc_param(<bar>, smelting_struct)`). A process step: every bar takes its ores whether it comes out or not, so the
// model's success is 1 and its products and XP are the expected ones per bar. Superheat reads the same struct.
import type { GameData } from './common';
import { ModelError, type ActionModel } from '../family';
import type { Profile } from '../profile';
import { param, queueTicks, requireLevel, stringParams, type FamilyFactory } from './common';

/** `bar`: the bar's obj config (`iron_bar`). */
export interface SmeltingParams {
    bar?: string;
}

/** A bar's smelting struct, as the smelting and superheat scripts read it. */
export interface BarStruct {
    product: string;
    levelrequired: number;
    productexp: number;
    ingredient: string;
    /** The primary ore a bar takes. */
    barCount: number;
    /** The secondary ore and how many a bar takes (tin, coal), or null. */
    secondary: { obj: string; count: number } | null;
}

/** The smelting struct `oc_param(bar, smelting_struct)` names; throws a ModelError when there is none. */
export function barStruct(data: GameData, bar: string): BarStruct {
    const name = param(data.objs.get(bar), 'smelting_struct');
    const struct = name === undefined ? undefined : data.structs.get(name);
    if (!struct) throw new ModelError(`${bar} has no smelting struct`);
    const str = (key: string): string => {
        const v = param(struct, key);
        if (v === undefined) throw new ModelError(`smelting struct ${name} has no ${key}`);
        return v;
    };
    const num = (key: string): number => {
        const v = Number(str(key));
        if (!Number.isFinite(v)) throw new ModelError(`smelting struct ${name} has no number in ${key}`);
        return v;
    };
    const secondary = param(struct, 'ingredient_secondary');
    return {
        product: str('product'),
        levelrequired: num('levelrequired'),
        productexp: num('productexp'),
        ingredient: str('ingredient'),
        barCount: num('bar_count'),
        secondary: secondary ? { obj: secondary, count: num('ingredient_secondary_count') } : null,
    };
}

/** The obj smelting.rs2 and superheat.rs2 test for, worn, to give 2.5x XP on a gold bar. */
const GOLDSMITH = 'gauntlets_of_goldsmithing';

/**
 * A bar's Smithing XP in tenths: the struct's productexp, `scale(5, 2, xp)` (xp * 5 / 2, truncated) for a gold bar
 * with goldsmith gauntlets worn (smelting.rs2:216-217, superheat.rs2:57-58).
 */
export function barXp(s: BarStruct, profile: Profile): number {
    return s.product === 'gold_bar' && profile.worn.includes(GOLDSMITH)
        ? Math.trunc((s.productexp * 5) / 2)
        : s.productexp;
}

/** Worn, it stops the iron bar's fail roll on a members world (smelting.rs2:200-202). */
const RING_OF_FORGING = 'ring_of_forging';

export const smelting: FamilyFactory = data => ({
    id: 'smelting',
    skills: ['smithing'],
    kinds: ['furnace'],
    model(site, params, profile): ActionModel {
        const p = stringParams(params, 'smelting', ['bar']);
        if (site.kind !== 'furnace') throw new ModelError(`site ${site.id} is a ${site.kind} site, not a furnace`);
        if (!p.bar) throw new ModelError('smelting needs a bar param (the bar obj)');
        const s = barStruct(data, p.bar);
        // ~validate_first_smelt (smelting.rs2:117-135).
        requireLevel(profile, 'smithing', s.levelrequired, `smelting ${p.bar}`);
        // An iron bar fails on randominc(1) = 1, half the time, unless a ring of forging is worn; a fail still takes
        // the ore (smelting.rs2:198-209).
        const made = s.product === 'iron_bar' && !profile.worn.includes(RING_OF_FORGING) ? 0.5 : 1;
        return {
            // After a bar, %action_delay = clock + 1 and [label,smelt_ore_weakqueue] queues start_smelt_ore with
            // delay 0, which queues smelting_ore with delay 3, both from inside a queue (smelting.rs2:157-164,
            // 184-188, 225-228): 1 + 4 = 5 ticks a bar. The first bar is 4 ticks after the Make button (:137-144,
            // 162), which is the tick after the furnace op opens the menu: 5 from the arrival too.
            ticksPerAttempt: queueTicks(0, true) + queueTicks(3, true),
            success: 1,
            xpTenths: { smithing: barXp(s, profile) * made },
            products: [{ obj: s.product, count: made }],
            consumes: [{ obj: s.ingredient, count: s.barCount }, ...(s.secondary ? [s.secondary] : [])],
            ...(s.barCount > 1 ? { batch: s.barCount } : {}),
        };
    },
});
