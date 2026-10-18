// Stealing from a market stall: skill_thieving/scripts/stalls/stealing.rs2 and ~steal_from_stall
// (skill_thieving/scripts/thieving.rs2:53-122), on the stealing rows (configs/stalls/stealing.dbrow). A steal has
// no roll: it fails only when the stall's owner or a guard sees it (~stealing_check_for_guard and _owner,
// thieving.rs2:98-121), a hazard of the spot and the player's timing, not a rate, so it is not modelled.
import { ModelError, type ActionModel } from '../family';
import {
    clickTicks,
    dbIndex,
    int,
    lootExpectation,
    requireLevel,
    scaleByPlayercount,
    stringParams,
    targetFeatures,
    type FamilyFactory,
} from './common';

/** `stall`: the stall's loc config (`tea_stall`), omitted when the site has one kind of stall. */
export interface StallParams {
    stall?: string;
}

export const stall: FamilyFactory = data => {
    const rows = dbIndex(data.dbrows, 'stealing', 'loc');
    return {
        id: 'stall',
        skills: ['thieving'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'stall', ['stall']);
            const { subtype } = targetFeatures(site, world, 'stall', p.stall);
            const row = rows.get(subtype);
            if (!row) throw new ModelError(`no stealing row lists stall ${subtype}`);
            requireLevel(profile, 'thieving', int(row, 'level'), `stealing from ${subtype}`);
            const loot = (row.data.loot ?? []).map(([obj, min, max, weight]) => ({
                obj: obj!,
                min: Number(min),
                max: Number(max),
                weight: Number(weight),
            }));
            return {
                // The steal's p_delay(0) (thieving.rs2:70) holds the player before the loot.
                ticksPerAttempt: clickTicks(0),
                success: 1,
                xpTenths: { thieving: int(row, 'experience') },
                products: lootExpectation(loot, int(row, 'loot_total'), 'first'),
                consumes: [],
                // Every steal swaps the stall for its empty loc for ~scale_by_playercount(respawn_ticks)
                // (thieving.rs2:64, :116).
                deplete: { chance: 1, respawnTicks: scaleByPlayercount(int(row, 'respawn_ticks')) },
            };
        },
    };
};
