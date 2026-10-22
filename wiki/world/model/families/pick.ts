// Picking flax: [oploc2,flax] in general_use/scripts/pickables.rs2 (:56-74). One flax a click, no roll and no XP;
// a picked plant vanishes for a while at random. The player stands among the plants and picks the next one in reach
// when one vanishes: a walk to a further plant is left out.
import { ModelError, type ActionModel } from '../family';
import { clickTicks, stringParams, targetFeatures, type FamilyFactory } from './common';

/** `plant`: the flax subtype (`flax`), omitted when the site has one. */
export interface PickParams {
    plant?: string;
}

/** What a pick adds (pickables.rs2:69). */
const FLAX = 'flax';
/** `random(16) < 3` after a pick (pickables.rs2:71). */
const VANISH = 3 / 16;
/** `loc_del(10)` (pickables.rs2:72): the plant is gone 10 ticks, at any player count. */
const VANISH_TICKS = 10;

export const pick: FamilyFactory = () => ({
    id: 'pick',
    skills: [],
    kinds: ['flax'],
    model(site, params, _profile, world): ActionModel {
        const p = stringParams(params, 'pick', ['plant']);
        const { subtype, features } = targetFeatures(site, world, 'flax', p.plant);
        if (subtype !== FLAX) throw new ModelError(`pick models flax, not ${subtype}`);
        return {
            // anim, then p_delay(0) before the flax (:65-69) holds the player: the next click runs 2 ticks on.
            ticksPerAttempt: clickTicks(0),
            success: 1,
            xpTenths: {},
            products: [{ obj: FLAX, count: 1 }],
            consumes: [],
            deplete: { chance: VANISH, respawnTicks: VANISH_TICKS },
            features: features.length,
        };
    },
});
