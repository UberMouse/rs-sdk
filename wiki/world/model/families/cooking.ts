// Cooking a raw item on a range or fire: [label,attempt_cook_item] and [label,cook_item] in
// skill_cooking/scripts/cooking.rs2, on the cooking_generic rows (configs/cooking_source/cooking_generic.dbrow). A
// process step: every attempt uses one raw item and gives a cooked or a burnt one, so the model's success is 1 and
// its products and XP are the expected ones per item. Cooking gauntlets (:135-137) are not in the profile, so their
// chances are not used.
import { first } from '../../sources/configs';
import type { DbRow } from '../../sources/dbrows';
import { ModelError, type ActionModel } from '../family';
import { statRandomChance } from '../roll';
import { clickTicks, int, requireLevel, stringParams, type FamilyFactory } from './common';

/** `food`: the raw item's obj config (`raw_salmon`). */
export interface CookingParams {
    food?: string;
}

/** The loc category of each cooking site kind (classify.ts STATIONS), whose oplocu trigger cooks (cooking.rs2:1-15). */
const SOURCES = { range: 'cooking_oven', fire: 'cooking_fire' } as const;

/** The Lumbridge castle range, which uses a row's successchance_cookomatic (cooking.rs2:138-140). */
const COOKOMATIC = 'cooksquestrange';

/** A two-int column, or the engine's default for a missing one: -1, -1 (ScriptVarType.getDefault, `null`). */
function pair(row: DbRow, column: string): [number, number] {
    const v = row.data[column]?.[0];
    return v ? [Number(v[0]), Number(v[1])] : [-1, -1];
}

/** The chance a roll cooks: the row's chances for this loc, with 0,0 never and 1,1 always (cooking.rs2:103-150). */
function cookChance(row: DbRow, category: string, loc: string, level: number): number {
    let [low, high] = pair(row, 'successchance');
    const range = pair(row, 'successchance_range');
    if (category === SOURCES.range && (range[0] > -1 || range[1] > -1)) [low, high] = range;
    const cookomatic = pair(row, 'successchance_cookomatic');
    if (loc === COOKOMATIC && (cookomatic[0] > -1 || cookomatic[1] > -1)) [low, high] = cookomatic;
    if (low === 0 && high === 0) return 0;
    if (low === 1 && high === 1) return 1;
    return statRandomChance(level, low, high);
}

export const cooking: FamilyFactory = data => {
    // By raw item; null for one several rows list, whose row is picked by the cooked product the player chooses
    // (raw karambwan, cooking.rs2:36-51).
    const rows = new Map<string, DbRow | null>();
    for (const row of data.dbrows.filter(r => r.table === 'cooking_generic'))
        for (const [raw] of row.data.uncooked ?? []) rows.set(raw!, rows.has(raw!) ? null : row);
    return {
        id: 'cooking',
        skills: ['cooking'],
        kinds: ['range', 'fire'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'cooking', ['food']);
            if (site.kind !== 'range' && site.kind !== 'fire')
                throw new ModelError(`site ${site.id} is a ${site.kind} site, not a range or fire`);
            if (!p.food) throw new ModelError('cooking needs a food param (the raw item)');
            const row = rows.get(p.food);
            if (row === null) throw new ModelError(`${p.food}'s cooking row is a choice of product: not modelled`);
            if (!row) throw new ModelError(`no cooking_generic row cooks ${p.food}`);
            requireLevel(profile, 'cooking', int(row, 'levelrequired'), `cooking ${p.food}`);
            // A row may refuse one kind of source with a cantcookmessage (cooking.rs2:57-64). Ideal play cooks on
            // the site's best loc.
            const refuses = (row.data[`cantcookmessage_${site.kind}`]?.[0]?.[0] ?? '').length > 0;
            const chances = site.features.flatMap(i => {
                const loc = world.features[i]!.config;
                const category = first(data.locs.get(loc), 'category') ?? '';
                return category === SOURCES[site.kind as keyof typeof SOURCES]
                    ? [cookChance(row, category, loc, profile.levels.cooking)]
                    : [];
            });
            if (refuses || !chances.length) throw new ModelError(`${p.food} can't be cooked on site ${site.id}`);
            const cooks = Math.max(...chances);
            const additional = row.data.additional?.[0]?.[0];
            const products = [
                { obj: row.data.cooked![0]![0]!, count: cooks },
                { obj: row.data.burnt?.[0]?.[0] ?? '', count: 1 - cooks },
                // Given whether it cooks or burns (:185-194).
                ...(additional ? [{ obj: additional, count: 1 }] : []),
            ].filter(x => x.obj && x.count > 0);
            return {
                // [label,cook_item] holds the player with p_delay(1) (:172).
                ticksPerAttempt: clickTicks(1),
                success: 1,
                xpTenths: { cooking: int(row, 'experience') * cooks },
                products,
                consumes: [{ obj: p.food, count: 1 }],
            };
        },
    };
};
