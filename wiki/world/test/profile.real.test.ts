import { describe, expect, test } from 'bun:test';
import { ProfileError } from '../model/family';
import { readGameData } from '../model/families/index';
import { readCombatStyles, readEquipment } from '../model/items';
import { gearOf, profileOf, readPrayers, readTools, type Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';

const game = readGameData();
const data = { equipment: readEquipment(game), styles: readCombatStyles(game), prayers: readPrayers(game) };
const tools = readTools(game.objs);
const wearing = (level: number, worn: string[]): Profile =>
    profileOf(Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>, { tools, worn });

describe('gearOf on the game data (paths under server/content/scripts/skill_combat/configs/melee/)', () => {
    test('a rune scimitar, full helm, platebody, platelegs and kiteshield and an amulet of strength', () => {
        const g = gearOf(
            wearing(40, [
                'rune_scimitar',
                'rune_full_helm',
                'rune_platebody',
                'rune_platelegs',
                'rune_kiteshield',
                'amulet_of_strength',
            ]),
            data,
        );
        // The params, scimitar / helm / body / legs / shield / amulet (scimitars.obj:193-197, fullhelms.obj:184-190,
        // platebodies.obj:213-219, platelegs.obj:186-192, kiteshields.obj:199-205,
        // skill_magic/configs/enchanted_jewelry.obj:460):
        // stab attack 7; slash attack 45; crush attack -2; magic attack -6-30-21-8 = -65; range attack
        // -2-10-7-2 = -21; stab defence 30+82+51+44 = 207; slash defence 1+32+80+49+48 = 210; crush defence
        // 27+72+47+46 = 192; magic defence -1-6-4-1 = -12; range defence 30+80+49+46 = 205; strength 44+10 = 54.
        expect(g.bonuses).toEqual({
            stabattack: 7,
            slashattack: 45,
            crushattack: -2,
            magicattack: -65,
            rangeattack: -21,
            stabdefence: 207,
            slashdefence: 210,
            crushdefence: 192,
            magicdefence: -12,
            rangedefence: 205,
            strengthbonus: 54,
            prayerbonus: 0,
            rangebonus: 0,
        });
        expect(g.weapon?.obj).toBe('rune_scimitar');
        // attackrate is the .param default, 4: scimitars.obj sets none for the rune scimitar.
        expect(g.attackRate).toBe(4);
        expect(g.styles.table).toBe('weapon_slash_table');
        // The platebody's wield check reads %dragonquest (levelrequire/scripts/tier40.rs2:26): returned, not checked.
        expect(g.quests).toEqual(['dragonquest']);
    });

    test('a rune 2h sword and a kiteshield clash in lefthand (2hswords.obj:210-211, kiteshields.obj:194)', () => {
        expect(() => gearOf(wearing(40, ['rune_2h_sword', 'rune_kiteshield']), data)).toThrow(
            new ProfileError('rune_2h_sword and rune_kiteshield are both worn in lefthand'),
        );
    });

    test('a rune scimitar needs Attack 40 (levelrequire/scripts/tier40.rs2:8)', () => {
        expect(() => gearOf(wearing(39, ['rune_scimitar']), data)).toThrow(
            new ProfileError(
                'rune_scimitar needs attack 40 to wield (levelrequire/scripts/tier40.rs2:8); the profile has 39',
            ),
        );
    });

    test('no weapon: 4 ticks a swing (player_melee.rs2:57), the unarmed style table (combat.rs2:16-17)', () => {
        const g = gearOf(wearing(1, []), data);
        expect(g.attackRate).toBe(4);
        expect(g.styles.table).toBe('weapon_unarmed_table');
    });

    test("3b's worn objs read: a staff of fire is the weapon", () => {
        expect(gearOf(wearing(43, ['staff_of_fire']), data).weapon?.obj).toBe('staff_of_fire');
    });
});

const praying = (prayer: number, prayers: Profile['prayers']): Profile =>
    profileOf({ ...Object.fromEntries(SKILLS.map(s => [s, 1])), prayer } as Record<Skill, number>, {
        tools,
        prayers,
    });

describe('prayers on the game data', () => {
    test('the tiers come from the check procs and prayers.dbrow (player_combat_stat.rs2:214-230)', () => {
        expect(data.prayers('strength', 115)).toMatchObject({ level: 31 });
        expect(data.prayers('attack', 105)).toMatchObject({ name: 'Clarity of Thought', level: 7 });
        expect(data.prayers('defence', 115)).toMatchObject({ name: 'Steel Skin', level: 28 });
    });
    test('strength 115 (Ultimate Strength, level 31, prayers.dbrow) errors at Prayer 30 and passes at 31', () => {
        expect(() => gearOf(praying(30, { strength: 115 }), data)).toThrow(ProfileError);
        expect(() => gearOf(praying(31, { strength: 115 }), data)).not.toThrow();
    });
});
