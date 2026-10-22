// Pickpocketing an npc: skill_thieving/scripts/pickpocketing/pickpocket.rs2 and the procs in
// skill_thieving/scripts/thieving.rs2, on the pickpocket rows (configs/pickpocking/pickpocket.dbrow). The Fremennik
// npcs (attempt_pick_viking_pocket, pickpocket.rs2:145-151) also need The Fremennik Trials, which this does not check.
import { ModelError, type ActionModel } from '../family';
import { statRandomChance } from '../../roll';
import {
    clickTicks,
    dbIndex,
    int,
    lootExpectation,
    lootRows,
    requireLevel,
    stringParams,
    targetFeatures,
    type FamilyFactory,
} from './common';

/** `npc`: the npc config (`guard1`), omitted when the site has one kind of npc to pickpocket. */
export interface PickpocketParams {
    npc?: string;
}

/** ~pick_pocket_check_for_reward's denominator (thieving.rs2:169). */
const LOOT_TOTAL = 128;

export const pickpocket: FamilyFactory = data => {
    const rows = dbIndex(data.dbrows, 'pickpocket', 'npc');
    return {
        id: 'pickpocket',
        skills: ['thieving'],
        kinds: ['pickpocket'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'pickpocket', ['npc']);
            const { subtype } = targetFeatures(site, world, 'pickpocket', p.npc);
            const row = rows.get(subtype);
            if (!row) throw new ModelError(`no pickpocket row lists npc ${subtype}`);
            requireLevel(profile, 'thieving', int(row, 'level'), `pickpocketing ${subtype}`);
            const loot = lootRows(row);
            // A stun of 0 or less never blocks the next attempt (the %stunned > map_clock check), so the fail
            // cadence below would be wrong; every row has 8 or 10.
            const stun = int(row, 'stun_ticks');
            if (stun < 1) throw new ModelError(`${row.row} has stun_ticks ${stun}: a fail's cadence needs at least 1`);
            // A stun that hits for 0 costs no hitpoints: no failDamage, so a record naming food for it is refused
            // (cycle.ts).
            const hit = int(row, 'stun_damage');
            return {
                // The attempt's p_delay(0) (thieving.rs2:5) holds the player a tick before the roll (:12), so the
                // next click's op runs clickTicks(0) ticks after this one's.
                ticksPerAttempt: clickTicks(0),
                success: statRandomChance(
                    profile.levels.thieving,
                    int(row, 'success_chance', 0),
                    int(row, 'success_chance', 1),
                ),
                xpTenths: { thieving: int(row, 'experience') },
                products: lootExpectation(loot, LOOT_TOTAL, 'each'),
                consumes: [],
                // ~fail_pick_pocket (thieving.rs2:29-51) holds the player two more ticks (p_delay(0) at :34 and
                // :43), then sets %stunned to map_clock + stun_ticks, and an attempt while %stunned > map_clock
                // does nothing (pickpocket.rs2:130-132): the next op runs 3 + stun_ticks after the click, against
                // a success's clickTicks(0).
                failTicks: 3 + stun - clickTicks(0),
                ...(hit > 0 ? { failDamage: hit } : {}),
            };
        },
    };
};
