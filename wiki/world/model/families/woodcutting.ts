// Chopping a tree: skill_woodcutting/scripts/woodcut.rs2 on the woodcutting_trees rows (configs/trees.dbrow).
import { treeSubtype } from '../../classify';
import { ModelError, ProfileError, type ActionModel } from '../family';
import { statRandomChance } from '../../roll';
import {
    int,
    requireLevel,
    rollInterval,
    scaleByPlayercount,
    stringParams,
    targetFeatures,
    type FamilyFactory,
} from './common';

/** `tree`: the tree subtype (`yew`), omitted when the site has one kind of tree. The axe is the profile's. */
export interface WoodcuttingParams {
    tree?: string;
}

/** A normal tree (`respawnrate` 0) stays down `120 + random(80)` ticks before scaling (woodcut.rs2:171-174). */
const NORMAL_RESPAWN = { base: 120, spread: 80 };

export const woodcutting: FamilyFactory = data => {
    const rows = new Map(data.dbrows.filter(r => r.table === 'woodcutting_trees').map(r => [treeSubtype(r), r]));
    return {
        id: 'woodcutting',
        skills: ['woodcutting'],
        kinds: ['tree'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'woodcutting', ['tree']);
            const { subtype, features } = targetFeatures(site, world, 'tree', p.tree);
            const row = rows.get(subtype);
            if (!row) throw new ModelError(`no woodcutting_trees row for tree ${subtype}`);
            // The level check (woodcut.rs2:34-39), then an axe: ~woodcutting_axe_checker returns null with none
            // (:64-67, :194-247), and the axe's successchance row gives the roll (:249-262).
            requireLevel(profile, 'woodcutting', int(row, 'levelrequired'), `a ${subtype} tree`);
            if (!profile.axe) throw new ProfileError(`chopping a ${subtype} tree needs an axe`);
            const chance = row.data.successchance?.find(([axe]) => axe === profile.axe);
            if (!chance) throw new ModelError(`${row.row} has no successchance for ${profile.axe}`);
            // ~get_logs (:162-191): one stat_random roll; a log and productexp on a success, then the tree falls
            // with random(8) = 0, or always for a normal tree (respawnrate 0 sets $deplete_chance to 0, and
            // random(0) is 0). It stays down ~scale_by_playercount($respawnrate) (:185-186).
            const respawnrate = int(row, 'respawnrate');
            const normal = respawnrate === 0;
            const spread = Array.from({ length: NORMAL_RESPAWN.spread }, (_, i) => NORMAL_RESPAWN.base + i);
            const respawnTicks = normal
                ? spread.reduce((sum, base) => sum + scaleByPlayercount(base), 0) / spread.length
                : scaleByPlayercount(respawnrate);
            return {
                // The first swing and every tick after a roll set %action_delay to map_clock + 3, and the roll
                // comes when it equals map_clock (:55-59, :153-158).
                ticksPerAttempt: rollInterval(3),
                success: statRandomChance(profile.levels.woodcutting, Number(chance[1]), Number(chance[2])),
                xpTenths: { woodcutting: int(row, 'productexp') },
                products: [{ obj: row.data.product![0]![0]!, count: 1 }],
                consumes: [],
                deplete: { chance: normal ? 1 : 1 / 8, respawnTicks },
                features: features.length,
                tools: [profile.axe],
            };
        },
    };
};
