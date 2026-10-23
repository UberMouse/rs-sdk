// Casting Superheat Item on an ore in the inventory: [opheldt,magic:superheat_item] in
// skill_magic/scripts/spells/superheat.rs2, on the spell's magic_spell_table row (configs/magic_spells.dbrow) and the
// ore's bar's smelting struct. A process step in place, one cast a click, with no fail roll. Iron with 2 coal at
// Smithing 30 makes steel (:27-30); the model assumes no coal is carried.
import { ModelError, type ActionModel } from '../family';
import { clickTicks, int, param, requireLevel, stringParams, type FamilyFactory } from './common';
import { barStruct, barXp, GOLDSMITH } from './smelting';

/** `ore`: the ore's obj config (`iron_ore`). */
export interface SuperheatParams {
    ore?: string;
}

/** The spell's value in magic_spell_table's `spell` column. */
const SPELL = '^superheat_item';

export const superheat: FamilyFactory = data => {
    const spell = data.dbrows.find(r => r.table === 'magic_spell_table' && r.data.spell?.[0]?.[0] === SPELL);
    // runesrequired: three (rune, count) pairs, null for none.
    const fields = spell?.data.runesrequired?.[0] ?? [];
    const runes: { obj: string; count: number }[] = [];
    for (let i = 0; i < fields.length; i += 2)
        if (fields[i] && fields[i] !== 'null') runes.push({ obj: fields[i]!, count: Number(fields[i + 1]) });
    // The rune each staff stands in for: a staff in two magic_staff_table rows (lava) stands in for both.
    const staffRunes = new Map<string, string[]>();
    for (const row of data.dbrows.filter(r => r.table === 'magic_staff_table')) {
        const rune = row.data.rune?.[0]?.[0];
        if (!rune) continue;
        for (const [staff] of row.data.staff ?? []) staffRunes.set(staff!, [...(staffRunes.get(staff!) ?? []), rune]);
    }
    return {
        id: 'superheat',
        skills: ['magic', 'smithing'],
        kinds: [],
        worn: [...staffRunes.keys(), GOLDSMITH],
        model(_site, params, profile): ActionModel {
            const p = stringParams(params, 'superheat', ['ore']);
            if (!spell) throw new ModelError(`no magic_spell_table row for ${SPELL}`);
            if (runes.some(r => !Number.isInteger(r.count) || r.count < 1))
                throw new ModelError(`${spell.row} has a malformed runesrequired: ${fields.join(',')}`);
            if (!p.ore) throw new ModelError('superheat needs an ore param (the ore obj)');
            const bar = param(data.objs.get(p.ore), 'smeltsto');
            if (!bar) throw new ModelError(`${p.ore} has no smeltsto: superheat makes nothing of it`);
            const s = barStruct(data, bar);
            // ~check_spell_requirements (magic.rs2:22), then the bar's level (superheat.rs2:37-40).
            requireLevel(profile, 'magic', int(spell, 'levelrequired'), 'superheat item');
            requireLevel(profile, 'smithing', s.levelrequired, `superheating ${bar}`);
            // ~staff_runes (magic.rs2:53-88): the worn staff's runes cost nothing.
            const free = new Set(profile.worn.flatMap(o => staffRunes.get(o) ?? []));
            return {
                // p_delay(1) (superheat.rs2:67) holds the player: the next cast's click lands 3 ticks on, as
                // OpHeldT is refused while delayed (OpHeldTHandler.ts:16).
                ticksPerAttempt: clickTicks(1),
                success: 1,
                // ~give_spell_xp (magic.rs2:108-109) and the bar's productexp (superheat.rs2:56-60).
                xpTenths: { magic: int(spell, 'experience'), smithing: barXp(s, profile) },
                products: [{ obj: bar, count: 1 }],
                // The struct's primary ore, one a cast, and its secondary ores (superheat.rs2:35, 61-65), then the
                // runes ~delete_spell_runes takes (magic.rs2:90-106).
                consumes: [
                    { obj: s.ingredient, count: 1 },
                    ...(s.secondary ? [s.secondary] : []),
                    ...runes.filter(r => !free.has(r.obj)),
                ],
            };
        },
    };
};
