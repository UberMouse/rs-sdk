// Mining a rock: skill_mining/scripts/mining.rs2 on the mining_table rows (configs/mine.dbrow), the pickaxe's
// `mining_rate` and `levelrequire` (configs/pickaxes.obj).
import { first } from '../../sources/configs';
import type { DbRow } from '../../sources/dbrows';
import { ModelError, ProfileError, type ActionModel } from '../family';
import { statRandomChance } from '../../roll';
import {
    clickTicks,
    dbIndex,
    int,
    param,
    requireLevel,
    rollInterval,
    scaleByPlayercount,
    stringParams,
    targetFeatures,
    type FamilyFactory,
} from './common';

/** `rock`: the rock subtype, its ore name (`iron`), omitted when the site has one kind of rock. The pickaxe is the profile's. */
export interface MiningParams {
    rock?: string;
}

/**
 * The label a rock's op runs, by its loc config (the essence rock) or category (mining.rs2:1-15). Gem rocks
 * (`get_ore_gem_rock`, a drop table) and the random event's gas rocks are not modelled.
 */
type Label = 'normal' | 'fast' | 'essence';
const LABEL_BY_CATEGORY: Record<string, Label> = { mining_rock_normal: 'normal', mining_rock_fast: 'fast' };
const ESSENCE_ROCK = 'blankrunestone';

/**
 * ~mining_gem_table (mining.rs2:268-274): random(128) below 2 a diamond, 10 a ruby, 26 an emerald, 58 a
 * sapphire, else nothing; as [gem, the rolls out of 128 that give it].
 */
const GEM_TABLE: [string, number][] = [
    ['uncut_diamond', 2],
    ['uncut_ruby', 8],
    ['uncut_emerald', 16],
    ['uncut_sapphire', 32],
];

export const mining: FamilyFactory = data => {
    const rows = dbIndex(data.dbrows, 'mining_table', 'rock');
    /** The label a rock config runs and its mining_table row. */
    const rockOf = (config: string): { label: Label; row: DbRow } => {
        const row = rows.get(config);
        if (!row) throw new ModelError(`no mining_table row lists rock ${config}`);
        if (config === ESSENCE_ROCK) return { label: 'essence', row };
        const category = first(data.locs.get(config), 'category') ?? '';
        const label = LABEL_BY_CATEGORY[category];
        if (!label) throw new ModelError(`rock ${config} (category ${category || 'none'}) is not modelled`);
        return { label, row };
    };
    return {
        id: 'mining',
        skills: ['mining'],
        kinds: ['rock'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'mining', ['rock']);
            const { subtype, features } = targetFeatures(site, world, 'rock', p.rock);
            // Rows sharing an ore name (limestone) differ in respawn, and iron rocks run either label: a site's
            // rocks of the subtype must agree on both.
            const rocks = features.map(f => rockOf(f.config));
            const { label, row } = rocks[0]!;
            if (rocks.some(r => r.label !== label || r.row !== row))
                throw new ModelError(`site ${site.id}'s ${subtype} rocks differ in label or mining_table row`);
            // Both labels check the rock's level, then ~pickaxe_checker (mining.rs2:57-74); the pickaxe's
            // mining_rate sets the swing (:75-80, :112-123).
            requireLevel(profile, 'mining', int(row, 'rock_level'), `a ${subtype} rock`);
            const pickaxe = profile.pickaxe;
            if (!pickaxe) throw new ProfileError(`mining a ${subtype} rock needs a pickaxe`);
            const pick = data.objs.get(pickaxe);
            const rate = Number(param(pick, 'mining_rate'));
            if (!pick || !Number.isFinite(rate)) throw new ModelError(`${pickaxe} has no mining_rate`);
            requireLevel(profile, 'mining', Number(param(pick, 'levelrequire') ?? 0), `a ${pickaxe}`);
            // A roll's next tick sets %action_delay to map_clock + mining_rate, whether it continues on the rock or
            // a click on the next rock lands then (:76-80, :118-123): one roll per mining_rate + 1 ticks.
            const ticksPerAttempt = rollInterval(rate);
            const xpTenths = { mining: int(row, 'rock_exp') };
            const ore = row.data.rock_output![0]![0]!;
            // ~get_ore_essence (:217-227): an essence every swing, no roll, no depletion.
            if (label === 'essence')
                return {
                    ticksPerAttempt,
                    success: 1,
                    xpTenths,
                    products: [{ obj: ore, count: 1 }],
                    consumes: [],
                    tools: [pickaxe],
                };
            // A gem roll first, random(256) = 1, or random(86) wearing a charged glory on a members world
            // (:133-139, :188-194); it takes the swing whether or not ~mining_gem_table gives a gem. Else the ore
            // roll, whose success always depletes the rock for ~scale_by_playercount(rock_respawnrate) (:155-161,
            // :202-206).
            const gem = 1 / (profile.glory ? 86 : 256);
            const ores = statRandomChance(
                profile.levels.mining,
                int(row, 'rock_successchance', 0),
                int(row, 'rock_successchance', 1),
            );
            const success = (1 - gem) * ores;
            return {
                ticksPerAttempt,
                success,
                xpTenths,
                // Gems per attempt, over the ore successes per attempt: gems per ore.
                products: [
                    { obj: ore, count: 1 },
                    ...GEM_TABLE.map(([obj, of128]) => ({ obj, count: (gem * of128) / 128 / success })),
                ],
                consumes: [],
                // After a fast rock's ore the next rock's click lands the tick after the roll; get_ore_normal's
                // p_delay(0) (:157) holds it to clickTicks(0) ticks after: one tick more per ore.
                ...(label === 'normal' ? { successTicks: clickTicks(0) - 1 } : {}),
                deplete: { chance: 1, respawnTicks: scaleByPlayercount(int(row, 'rock_respawnrate')) },
                features: features.length,
                tools: [pickaxe],
            };
        },
    };
};
