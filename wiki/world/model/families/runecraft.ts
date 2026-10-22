// Crafting runes at an altar (oploc1 -> [label,runecraft_runes]): skill_runecraft/scripts/runecraft.rs2, on the altar's
// runecraft_table row (configs/runecraft.dbrow), found by the loc's rune_type param (~get_runecraft_data, :173-176). A
// process step at an rc-altar site: one op binds every essence held, so the step's actions take one op a trip. The
// talisman is held all trip, as the ruins outside take it to let the player in (:19-45); the altar sites' reach asks
// for it, so a method's legs walk in through the ruins.
import { ModelError, type ActionModel } from '../family';
import { INVENTORY_SLOTS } from '../items';
import { clickTicks, dbIndex, int, param, requireLevel, stringParams, type FamilyFactory } from './common';

/** The essence an altar binds (runecraft.rs2:68, :94). */
const ESSENCE = 'blankrune';

/** The craft's `p_delay(3)` after the runes are added (runecraft.rs2:99). */
const CRAFT_DELAY = 3;

/**
 * Runes an essence makes at `level`: `level / multiplier + 1` in integers with the row's multiplier, 1 without one
 * (runecraft.rs2:80-83).
 */
export const runesPerEssence = (level: number, multiplier: number | undefined): number =>
    multiplier === undefined ? 1 : Math.trunc(level / multiplier) + 1;

export const runecraft: FamilyFactory = data => {
    const rows = dbIndex(data.dbrows, 'runecraft_table', 'type');
    return {
        id: 'runecraft',
        skills: ['runecraft'],
        kinds: ['rc-altar'],
        model(site, params, profile, world): ActionModel {
            stringParams(params, 'runecraft', []);
            if (site.kind !== 'rc-altar')
                throw new ModelError(`site ${site.id} is a ${site.kind} site, not an rc-altar`);
            const configs = [...new Set(site.features.map(i => world.features[i]!.config))];
            if (configs.length !== 1) throw new ModelError(`site ${site.id} has altars of ${configs.join(', ')}`);
            const type = param(data.locs.get(configs[0]!), 'rune_type');
            const row = type === undefined ? undefined : rows.get(type);
            if (!row) throw new ModelError(`altar ${configs[0]} has no runecraft_table row (rune_type ${type})`);
            const field = (column: string): string => {
                const v = row.data[column]?.[0]?.[0];
                if (!v) throw new ModelError(`${row.row} has no ${column}`);
                return v;
            };
            // The level check (:54, :62-66).
            requireLevel(profile, 'runecraft', int(row, 'level'), `crafting at ${configs[0]}`);
            const multiplier = row.data.multiplier?.length ? int(row, 'multiplier') : undefined;
            return {
                // The op binds and gives the runes, then p_delay(3) holds the player (:94-99): the next click, the
                // walk out, runs clickTicks(3) after the op, which runs on the tick the walk in arrives.
                ticksPerAttempt: clickTicks(CRAFT_DELAY),
                // Every essence held in one op (:68, :84, :94): no load holds more than the inventory.
                perTick: INVENTORY_SLOTS,
                success: 1,
                // XP per essence, not per rune (:95).
                xpTenths: { runecraft: int(row, 'experience') },
                products: [{ obj: field('rune'), count: runesPerEssence(profile.levels.runecraft, multiplier) }],
                consumes: [{ obj: ESSENCE, count: 1 }],
                tools: [field('talisman')],
            };
        },
    };
};
