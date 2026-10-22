// Killing an npc with melee, one kill a success: the player's swings (skill_combat/scripts/player/player_melee.rs2), the
// npc's default melee AI hitting back (skill_combat/scripts/npc/npc_combat.rs2:1-4, npc_combat_melee.rs2), its death
// (npc_death.rs2) and respawn, and its drop table (sources/droptables.ts). Paths are under server/content/scripts/
// unless they name the engine (server/engine/src/engine). One bot fights: the hero of every kill, never out of a
// single-way lockout. Left out of the floor, as they only slow a kill or cut the damage taken: the npc's retreat
// (ActionModel.retreat) and its wandering off its spawn. An aggressive npc's swings before the player's first are a
// hazard, not modelled damage.
import { readDropTables, type DropTable, type DropTables } from '../../sources/droptables';
import type { Site, Tile, World } from '../../types';
import {
    combatRoll,
    effectiveLevel,
    expectedSwings,
    hitChance,
    hitpointsXpPerKill,
    MELEE_STYLE_BONUS,
    maxHit,
    npcEffectiveLevel,
    styleXpPerKill,
    swingDamage,
    type MeleeStyle,
    type Swing,
} from '../combat';
import { ModelError, ProfileError, type ActionModel } from '../family';
import { readCombatStyles, readEquipment, type Bonus, type CombatStyles, type Equipments } from '../items';
import { readNpcCombat, type DamageType, type NpcCombat, type NpcCombats } from '../npcs';
import { paramValue } from '../params';
import { gearOf, readPrayers, type Prayers } from '../profile';
import { readDefault, type ServerDefault } from '../server';
import { scaleByPlayercount, stringParams, targetFeatures, type FamilyFactory, type GameData } from './common';

/**
 * `npc`: the npc config (`giant`), omitted when the site has one kind of npc; `style`: the melee style swung
 * (`accurate`, `aggressive`, `defensive`, `controlled`), which the method resolves from the skill it trains.
 */
export interface CombatParams {
    npc?: string;
    style: MeleeStyle;
}

/** The npc's death: `[proc,npc_death]`, which every death script runs before its drops. */
export const DEATH_SOURCE = 'skill_combat/scripts/npc/npc_death.rs2';

/**
 * Ticks from the killing swing to the npc's `npc_del`, when its drop lands. The swing queues the damage
 * (`npc_queue(2, $damage, 0)`, player_melee.rs2:50), which runs in the npc's turn the next tick (Npc.processQueue,
 * entity/Npc.ts:561-580; the npcs' turns come before the players', World.ts:414,425): +1. Its 0 HP queues the death
 * (`npc_queue(3, 0, 0)`, npc_combat.rs2:93) on the tail of the list being walked, which the walk does not reach
 * (datastruct/LinkList.ts:97-111 restores the cursor past the old tail): the next turn, +1. `npc_death` then waits
 * `npc_arrivedelay` (none for an npc that has not moved in two ticks, script/handlers/NpcOps.ts:580-593: one standing
 * in melee range) and `npc_delay(n)`, which resumes the script n + 1 turns on (NpcOps.ts:120-124, Npc.ts:112-117),
 * then `npc_del` (npc_death.rs2:23-24) and the drop's obj_add (npc_combat.rs2:96-101). So 2 + n + 1, from the one
 * `npc_delay(n)` line of `text` (npc_death.rs2:23, n = 1: 4 ticks).
 */
export function readDeathTicks(text: string): ServerDefault {
    const d = readDefault(DEATH_SOURCE, text, /^\s*npc_delay\((\d+)\);/);
    return { value: 2 + d.value + 1, at: d.at };
}

/**
 * The expected npc swings at the player during a kill that takes the player `swing`'s swings, `playerRate` ticks
 * apart, from `hp`. The first swing queues the retaliation (`~npc_retaliate(0)`, player_melee.rs2:49), which runs in
 * the npc's next turn, T0 + 1, and as the npc is not yet fighting sets `%npc_action_delay = map_clock + attackrate/2`
 * (npc_combat.rs2:16-24, `~npc_retal_ready` :318-322); later swings' retaliations find it fighting and change nothing.
 * Its attack waits on that delay (npc_combat.rs2:62) and each swing sets it `attackrate` on
 * (npc_combat_melee.rs2:28,32,39), so swing j comes at T0 + 1 + h + j * npcRate, h = trunc(npcRate / 2). The killing
 * swing at T0 + (S - 1) * playerRate takes the npc to 0 HP in its next turn, before that turn's attack (the queue runs
 * first, Npc.ts:179-181), and a melee npc at 0 HP deals nothing (npc_combat_melee.rs2:40-42); an npc swing in the
 * killing swing's own tick lands, as the npc's turn comes first. So swing j lands when (S - 1) * playerRate >= 1 + h
 * + j * npcRate, that is when S > ceil((1 + h + j * npcRate) / playerRate), and the expectation is the sum over j of
 * P(S > that). Infinity when no swing can damage the npc.
 */
export function npcSwingsPerKill(swing: Swing, hp: number, playerRate: number, npcRate: number): number {
    const survival = swingSurvival(swing, hp);
    if (!survival) return Infinity;
    const h = Math.trunc(npcRate / 2);
    let sum = 0;
    for (let j = 0; ; j++) {
        const s = Math.ceil((1 + h + j * npcRate) / playerRate);
        if (s >= survival.length) return sum;
        sum += survival[s]!;
    }
}

/** P(S > s) below which the tail of the swings to a kill is dropped. */
const TAIL = 1e-12;

/**
 * P(S > s), the chance the npc is still alive after s swings, for s from 0 until it falls below TAIL; undefined when
 * no swing can damage (swingDamage's distribution, the HP left carried from swing to swing).
 */
function swingSurvival(swing: Swing, hp: number): number[] | undefined {
    if (!(swing.hit > 0 && swing.max >= 1)) return undefined;
    const dists = Array.from({ length: hp + 1 }, (_, h) => (h ? swingDamage(swing, h) : []));
    let alive: number[] = Array.from({ length: hp + 1 }, (_, h) => (h === hp ? 1 : 0));
    const out = [1];
    while (out[out.length - 1]! >= TAIL) {
        const next = Array.from({ length: hp + 1 }, () => 0);
        for (let h = 1; h <= hp; h++) {
            if (!alive[h]) continue;
            dists[h]!.forEach((p, d) => {
                next[h - d]! += alive[h]! * p;
            });
        }
        next[0] = 0;
        alive = next;
        out.push(alive.reduce((a, b) => a + b, 0));
    }
    return out;
}

/**
 * Ticks of a kill's gap past the player's swing cooldown, as the mean over the spawns (`walks`: each spawn's run
 * ticks to its nearest other spawn), and the ticks a pickup of the drop adds to it. The next kill starts the tick after
 * the killing swing (its damage and XP show the kill that tick: player_melee.rs2:31-33): the click is read at the start
 * of T + 1 (World.ts:402) and a run of w ticks lands the op at T + max(1, w), as the op runs in the tick the walk
 * arrives (processInteraction tries the op after the move, entity/Player.ts:1343-1347); the swing waits for `%action_delay` (player_melee.rs2:8-11), so it comes at
 * T + max(attackRate, w), w at least 1. A pickup waits for the drop, `deathTicks` after the swing; the take is the
 * next tick's click, the step onto the npc's tile and `obj_takeitem` with no delay (player/scripts/pickup.rs2:1-16),
 * and the walk on is clicked the tick after: T + max(attackRate, deathTicks + 1 + w).
 */
export function killGaps(
    walks: readonly number[],
    attackRate: number,
    deathTicks: number,
): { free: number; pickup: number } {
    const mean = (f: (w: number) => number) => walks.reduce((t, w) => t + f(Math.max(1, w)), 0) / walks.length;
    return {
        free: mean(w => Math.max(attackRate, w) - attackRate),
        pickup: mean(w => Math.max(attackRate, deathTicks + 1 + w) - Math.max(attackRate, w)),
    };
}

/** The npcs whose melee scripts take a special case (player_combat.rs2:56-64, player_melee.rs2:22-30), not modelled. */
const SPECIAL_NPCS = ['tbwt_beast', 'count_draynor'];
/** Worn objs that change a melee roll against an npc with a param (player_combat.rs2:62-64, player_melee.rs2:25-30). */
const SPECIAL_WORN: [obj: string, npcParam: string][] = [
    ['crystalshard_necklace', 'undead'],
    ['silverlight', 'demonbane_vulnerable'],
];
/** The values those params are on with: `undead` is an int set to `^true`, `demonbane_vulnerable` a boolean. */
const TRUE = ['^true', '1', 'yes'];

/** The worn-bonus param a damage type attacks or defends with (player_combat_stat.rs2:83-92). */
const ATTACK_BONUS: Partial<Record<DamageType, Bonus>> = {
    stab: 'stabattack',
    slash: 'slashattack',
    crush: 'crushattack',
};
const DEFENCE_BONUS: Partial<Record<DamageType, Bonus>> = {
    stab: 'stabdefence',
    slash: 'slashdefence',
    crush: 'crushdefence',
    ranged: 'rangedefence',
};

/**
 * Legends' Quest counts as not complete: the jewel table reads `%legendsquest` (drop
 * tables/scripts/shared_droptables.rs2:68) and a Profile holds no quest state, so the drops are the smaller set.
 */
const DROP_VARPS = { legendsquest: 0 };

/** The readers a model takes from the game data, built on its first use (a test's GameData may lack their scripts). */
interface Readers {
    npcs: NpcCombats;
    equipment: Equipments;
    styles: CombatStyles;
    prayers: Prayers;
    drops: DropTables;
    deathTicks: number;
}

function readers(data: GameData): Readers {
    const death = data.scripts.find(([f]) => f === DEATH_SOURCE)?.[1];
    if (death === undefined) throw new ModelError(`no ${DEATH_SOURCE}`);
    return {
        npcs: readNpcCombat(data),
        equipment: readEquipment(data),
        styles: readCombatStyles(data),
        prayers: readPrayers(data),
        drops: readDropTables(data),
        deathTicks: readDeathTicks(death).value,
    };
}

const STYLES = Object.keys(MELEE_STYLE_BONUS) as MeleeStyle[];

/** Each spawn's tile to every other's, in spawn order: the pairs `walks` asks method.ts to price. */
const pairsOf = (tiles: Tile[]) =>
    tiles.flatMap((from, i) => tiles.flatMap((to, j) => (i === j ? [] : [{ from, to }])));

/** The params' style and the site's spawns of the npc. */
function target(site: Site, params: unknown, world: Pick<World, 'features'>) {
    const p = stringParams(params, 'combat', ['npc', 'style']);
    if (!STYLES.includes(p.style as MeleeStyle))
        throw new ModelError(`combat needs a style param, one of ${STYLES.join(', ')}, not ${p.style}`);
    return { style: p.style as MeleeStyle, ...targetFeatures(site, world, 'npc', p.npc) };
}

export const combat: FamilyFactory = data => {
    let read: Readers | undefined;
    /** Drop tables by npc, worn objs and spawn tile, as a page asks for many profiles of one kill. */
    const drops = new Map<string, DropTable>();
    return {
        id: 'combat',
        skills: ['attack', 'strength', 'defence', 'hitpoints'],
        kinds: ['npc'],
        walks(site, params, world) {
            return pairsOf(target(site, params, world).features.map(f => f.tile));
        },
        model(site, params, profile, world, walks): ActionModel {
            const { style, subtype, features } = target(site, params, world);
            read ??= readers(data);
            const npc: NpcCombat = read.npcs(subtype);
            if (npc.aiOverrides.length)
                throw new ModelError(
                    `npc ${subtype}'s melee AI is overridden: ${npc.aiOverrides.map(o => `[${o.trigger}] at ${o.at}`).join(', ')}`,
                );
            if (SPECIAL_NPCS.includes(subtype))
                throw new ModelError(`npc ${subtype} takes a special case in the melee scripts: not modelled`);
            for (const [obj, key] of SPECIAL_WORN)
                if (
                    profile.worn.includes(obj) &&
                    TRUE.includes(paramValue(data.npcs.get(subtype)!, key, data, subtype))
                )
                    throw new ModelError(`${obj} worn against npc ${subtype} (${key}) is not modelled`);
            const gear = gearOf(profile, read);
            const chosen = gear.styles.styles.filter(s => s.kind === 'melee' && s.style === style);
            if (!chosen.length)
                throw new ProfileError(
                    `${gear.weapon?.obj ?? 'no weapon'} has no ${style} melee style (${gear.styles.table})`,
                );
            const prayer = profile.prayers ?? {};
            const bonus = MELEE_STYLE_BONUS[style];
            // The player's swing (player_combat_stat.rs2:63-99): of the style's damage types (a weapon may list the
            // style twice), the one that kills fastest. The damage roll is capped by the npc's max_dealt
            // (`~npc_max_dealt`, npc_combat.rs2:438, player_melee.rs2:31).
            const max = Math.min(
                maxHit(
                    effectiveLevel(profile.levels.strength, bonus.strength, prayer.strength),
                    gear.bonuses.strengthbonus,
                ),
                npc.maxDealt,
            );
            const attack = effectiveLevel(profile.levels.attack, bonus.attack, prayer.attack);
            const hp = npc.levels.hitpoints;
            const swings = chosen.map(s => {
                const key = ATTACK_BONUS[s.damageType];
                if (!key) throw new ModelError(`a ${s.damageType} melee style is not modelled`);
                const npcDefence = combatRoll(npcEffectiveLevel(npc.levels.defence), npc.defenceBonus[s.damageType]);
                const swing: Swing = { hit: hitChance(combatRoll(attack, gear.bonuses[key]), npcDefence), max };
                return { swing, n: expectedSwings(swing, hp) };
            });
            const { swing, n } = swings.reduce((a, b) => (b.n < a.n ? b : a));
            if (!Number.isFinite(n))
                throw new ProfileError(
                    `the profile's ${style} swing can't damage npc ${subtype} (hit ${swing.hit}, max ${max})`,
                );

            // The npc's default melee swing at the player's defence (npc_combat_melee.rs2:20-32,
            // player_combat_stat.rs2:65,73,84-92): a hit deals randominc(max), max/2 on average.
            const defenceKey = DEFENCE_BONUS[npc.damageType];
            if (!defenceKey) throw new ModelError(`npc ${subtype} deals ${npc.damageType} damage: not modelled`);
            const npcMax = maxHit(npcEffectiveLevel(npc.levels.strength), npc.strengthBonus);
            const npcHit = hitChance(
                combatRoll(npcEffectiveLevel(npc.levels.attack), npc.attackBonus),
                combatRoll(
                    effectiveLevel(profile.levels.defence, bonus.defence, prayer.defence),
                    gear.bonuses[defenceKey],
                ),
            );
            const damage = npcSwingsPerKill(swing, hp, gear.attackRate, npc.attackRate) * npcHit * (npcMax / 2);

            // Each spawn's run to its nearest other spawn; a lone spawn's next kill is its own respawn, which the
            // resource cap times.
            let nearest = [1];
            if (features.length > 1) {
                const pairs = pairsOf(features.map(f => f.tile));
                if (!walks || walks.length !== pairs.length)
                    throw new ModelError(
                        `a kill at ${site.id} needs its ${pairs.length} spawn walks priced (Family.walks)`,
                    );
                nearest = features.map((f, i) => {
                    const own = walks.slice(i * (features.length - 1), (i + 1) * (features.length - 1));
                    const best = Math.min(...own.filter((w): w is number => w !== null));
                    if (!Number.isFinite(best))
                        throw new ModelError(`the ${subtype} spawn at ${f.tile.x},${f.tile.z} walks to no other spawn`);
                    return best;
                });
            }
            const gaps = killGaps(nearest, gear.attackRate, read.deathTicks);

            // Drops by spawn tile (the jewel table reads the coord), averaged over the spawns.
            const sums = new Map<string, number>();
            for (const f of features) {
                const key = `${subtype} ${profile.worn.join(',')} ${f.tile.level},${f.tile.x},${f.tile.z}`;
                let table = drops.get(key);
                if (!table)
                    drops.set(
                        key,
                        (table = read.drops(subtype, { worn: profile.worn, varps: DROP_VARPS, coord: f.tile })),
                    );
                for (const [obj, c] of table.counts) sums.set(obj, (sums.get(obj) ?? 0) + c);
            }

            // npc_del's removeNpc counts the scaled respawnrate down from that turn (World.ts:1525-1551,
            // 2061-2065; Npc.ts:121), so the npc is back deathTicks + R - 1 after the killing swing. The kill's
            // success ends attackRate + free after it, so that leaves deathTicks + R - 1 - attackRate - free.
            const respawn = scaleByPlayercount(npc.respawnRate);
            return {
                ticksPerAttempt: n * gear.attackRate + gaps.free,
                success: 1,
                xpTenths: {
                    ...styleXpPerKill(style, swing, hp, npc.xpMultiplier),
                    hitpoints: hitpointsXpPerKill(swing, hp, npc.xpMultiplier),
                },
                products: [...sums].map(([obj, sum]) => ({ obj, count: sum / features.length })),
                consumes: [],
                // An npc whose max hit is 0 can't hurt any profile: no damage, so no food.
                ...(npcMax > 0 ? { damage } : {}),
                attackRate: gear.attackRate,
                freeTicks: gaps.free,
                pickupTicks: gaps.pickup,
                deplete: {
                    chance: 1,
                    respawnTicks: Math.max(0, read.deathTicks + respawn - 1 - gear.attackRate - gaps.free),
                },
                features: features.length,
                ...(npc.retreat !== undefined ? { retreat: npc.retreat } : {}),
            };
        },
    };
};
