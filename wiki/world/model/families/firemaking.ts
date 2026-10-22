// Lighting logs from the inventory with a tinderbox (opheldu -> @light_logs_inv): skill_firemaking/scripts/
// firemaking.rs2, on the log's obj params. A process step in place or at a tile of its own: it has no site kind, as
// any open tile outside a bank zone takes a fire (:133-143). The fire pushes the player a tile west (else east,
// south, north) (:145-174), so a run burns along a line; the walk back when a line runs into a wall is left out.
import { first } from '../../sources/configs';
import { statRandomChance } from '../../roll';
import { ModelError, type ActionModel } from '../family';
import { paramNum, requireLevel, stringParams, type FamilyFactory } from './common';

/** `log`: the log's obj config (`willow_logs`). */
export interface FiremakingParams {
    log?: string;
}

/** The tool the light needs in the inventory (firemaking.rs2:93-96). */
const TINDERBOX = 'tinderbox';
/** The logs' category: `[opheldu,_category_22]` (skill_fletching/scripts/cut_logs.rs2:2-5) lights them. */
const LOGS = 'category_22';
/** `stat_random(firemaking, 64, 512)`, the light roll (firemaking.rs2:105). */
const ROLL = { low: 64, high: 512 };
/** `%action_delay = calc(map_clock + 4)` after a roll, lit or not (firemaking.rs2:106, :114). */
const ROLL_EVERY = 4;

export const firemaking: FamilyFactory = data => ({
    id: 'firemaking',
    skills: ['firemaking'],
    kinds: [],
    model(_site, params, profile): ActionModel {
        const p = stringParams(params, 'firemaking', ['log']);
        if (!p.log) throw new ModelError('firemaking needs a log param (the log obj)');
        const cfg = data.objs.get(p.log);
        if (!cfg || first(cfg, 'category') !== LOGS) throw new ModelError(`${p.log} is not a log a tinderbox lights`);
        const level = paramNum(cfg, 'levelrequire', p.log);
        const xp = paramNum(cfg, 'productexp', p.log);
        // The level check (:81-86).
        requireLevel(profile, 'firemaking', level, `lighting ${p.log}`);
        return {
            // The click drops the log and sets %action_delay to the clock + 3 (:97-103); p_opobj(4) re-runs the op
            // each tick, and it rolls when %action_delay comes round, every ROLL_EVERY ticks (:104-117). A light's
            // push holds the player (p_delay(0), :160-173), so the next click runs 2 ticks after it with
            // %action_delay 2 ahead: it rolls ROLL_EVERY after the light too. The first click of a run comes the tick
            // after the walk arrives, as a click read on the arrival tick runs before that tick's step: ROLL_EVERY
            // from the arrival as well.
            ticksPerAttempt: ROLL_EVERY,
            success: statRandomChance(profile.levels.firemaking, ROLL.low, ROLL.high),
            // The log's productexp (:121); the fire's ashes stay on the ground (:131).
            xpTenths: { firemaking: xp },
            products: [],
            consumes: [{ obj: p.log, count: 1 }],
            tools: [TINDERBOX],
        };
    },
});
