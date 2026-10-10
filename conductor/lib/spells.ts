// Combat spells a task can cast on an NPC. Component ids are sdk/spells.ts (server pack interface.pack);
// level and runes are server/content/scripts/skill_combat/configs/magic/magic_combat_spells.dbrow
// (`levelrequired`, `runesrequired`), which test/lib/spells.test.ts compares this table with.
// Only the free-to-play strike, bolt and blast spells: the wave spells need a members' world.
import { Spells } from '../../sdk/spells';

export interface CombatSpell {
    /** Component id the spell packet addresses. */
    component: number;
    /** Magic level needed to cast it. */
    level: number;
    /** Runes one cast uses from the inventory (a staff of that element stands in for its rune). */
    runes: Record<string, number>;
}

const spell = (component: number, level: number, runes: Record<string, number>): CombatSpell => ({
    component,
    level,
    runes,
});

export const COMBAT_SPELLS = {
    'Wind Strike': spell(Spells.WIND_STRIKE, 1, { 'Mind rune': 1, 'Air rune': 1 }),
    'Water Strike': spell(Spells.WATER_STRIKE, 5, { 'Mind rune': 1, 'Water rune': 1, 'Air rune': 1 }),
    'Earth Strike': spell(Spells.EARTH_STRIKE, 9, { 'Mind rune': 1, 'Earth rune': 2, 'Air rune': 1 }),
    'Fire Strike': spell(Spells.FIRE_STRIKE, 13, { 'Mind rune': 1, 'Fire rune': 3, 'Air rune': 2 }),
    'Wind Bolt': spell(Spells.WIND_BOLT, 17, { 'Chaos rune': 1, 'Air rune': 2 }),
    'Water Bolt': spell(Spells.WATER_BOLT, 23, { 'Chaos rune': 1, 'Water rune': 2, 'Air rune': 2 }),
    'Earth Bolt': spell(Spells.EARTH_BOLT, 29, { 'Chaos rune': 1, 'Earth rune': 3, 'Air rune': 2 }),
    'Fire Bolt': spell(Spells.FIRE_BOLT, 35, { 'Chaos rune': 1, 'Fire rune': 4, 'Air rune': 3 }),
    'Wind Blast': spell(Spells.WIND_BLAST, 41, { 'Death rune': 1, 'Air rune': 3 }),
    'Water Blast': spell(Spells.WATER_BLAST, 47, { 'Death rune': 1, 'Water rune': 3, 'Air rune': 3 }),
    'Earth Blast': spell(Spells.EARTH_BLAST, 53, { 'Death rune': 1, 'Earth rune': 4, 'Air rune': 3 }),
    'Fire Blast': spell(Spells.FIRE_BLAST, 59, { 'Death rune': 1, 'Fire rune': 5, 'Air rune': 4 }),
} as const satisfies Record<string, CombatSpell>;

export type CombatSpellName = keyof typeof COMBAT_SPELLS;
export const COMBAT_SPELL_NAMES = Object.keys(COMBAT_SPELLS) as [CombatSpellName, ...CombatSpellName[]];

/**
 * The rune a worn staff stands in for (server/content/scripts/skill_magic/configs/magic_staff.dbrow). Only the
 * free-to-play staves: the battlestaves are members' items, which supply nothing on a free-to-play world.
 */
export const STAFF_RUNES: Record<string, string> = {
    'Staff of air': 'Air rune',
    'Staff of water': 'Water rune',
    'Staff of earth': 'Earth rune',
    'Staff of fire': 'Fire rune',
};
