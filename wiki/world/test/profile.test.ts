import { describe, expect, test } from 'bun:test';
import { combatLevel } from '../model/combat';
import { ProfileError } from '../model/family';
import { BONUSES, UNARMED_ATTACK_RATE, type Bonus, type CombatStyles, type Equipment } from '../model/items';
import { baseLevels, combatLevelOf, gearOf, profileAt, profileOf, type Tools } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';

const tools: Tools = { axe: [], pickaxe: [{ obj: 'mithril_pickaxe', level: 21 }] };
const at = (level: number): Record<Skill, number> =>
    Object.fromEntries(SKILLS.map(s => [s, level])) as Record<Skill, number>;

const zero = Object.fromEntries(BONUSES.map(b => [b, 0])) as Record<Bonus, number>;
/** Scripted worn objs: a sword, a two-hander, a shield, a helm on three slots, a categoryless right-hand obj. */
const OBJS: Equipment[] = [
    {
        obj: 'sword',
        wearpos: ['righthand'],
        bonuses: { ...zero, slashattack: 10, strengthbonus: 8 },
        attackRate: 4,
        attackRange: 1,
        category: 'weapon_slash',
        wield: { levels: { attack: 20 }, quests: [], at: 'tier20.rs2:1' },
    },
    {
        obj: 'twohander',
        wearpos: ['righthand', 'lefthand'],
        bonuses: { ...zero, slashattack: 30 },
        attackRate: 7,
        attackRange: 1,
        category: 'weapon_2h_sword',
        wield: undefined,
    },
    {
        obj: 'shield',
        wearpos: ['lefthand'],
        bonuses: { ...zero, slashdefence: 5, magicattack: -3 },
        attackRate: 4,
        attackRange: 1,
        category: undefined,
        wield: { levels: { defence: 10 }, quests: ['dragonquest'], at: 'tier10.rs2:2' },
    },
    {
        obj: 'helm',
        wearpos: ['hat', 'head', 'jaw'],
        bonuses: { ...zero, slashdefence: 2 },
        attackRate: 4,
        attackRange: 1,
        category: undefined,
        wield: undefined,
    },
    {
        obj: 'mask',
        wearpos: ['jaw'],
        bonuses: zero,
        attackRate: 4,
        attackRange: 1,
        category: undefined,
        wield: undefined,
    },
    {
        obj: 'lyre',
        wearpos: ['righthand'],
        bonuses: zero,
        attackRate: 5,
        attackRange: 1,
        category: undefined,
        wield: undefined,
    },
];
const equipment = (obj: string): Equipment => OBJS.find(e => e.obj === obj)!;
/** The style table by category, as readCombatStyles names it: `unarmed` for undefined, `default` for no case. */
const styles: CombatStyles = category => ({
    table: category === undefined ? 'unarmed' : category.startsWith('weapon_') ? category : 'default',
    styles: [],
});
const data = { equipment, styles };
/** gearOf of a profile at 30 wearing `worn`, deferred for toThrow. */
const clash = (worn: string[]) => () => gearOf(profileOf(at(30), { tools, worn }), data);

describe('profileOf: boosts and prayers', () => {
    test('no boosts or prayers: the levels as given, no prayers or boosts keys (3b profiles unchanged)', () => {
        const p = profileOf(at(30), { tools });
        expect(p.levels).toEqual(at(30));
        expect('boosts' in p || 'prayers' in p).toBe(false);
    });

    test('a boost raises the current level, which picks the tool; baseLevels takes it back off', () => {
        const p = profileOf(at(20), { tools, boosts: { mining: 2, attack: 5 }, prayers: { strength: 110 } });
        expect(p.levels.mining).toBe(22);
        expect(p.levels.attack).toBe(25);
        expect(p.levels.defence).toBe(20);
        // The mithril pickaxe asks Mining 21: the boosted 22 lets it in.
        expect(p.pickaxe).toBe('mithril_pickaxe');
        expect(baseLevels(p)).toEqual(at(20));
        expect(p.prayers).toEqual({ strength: 110 });
    });

    test('profileAt carries worn, prayers and boosts', () => {
        const p = profileAt('attack', 40, { tools, worn: ['sword'], prayers: { attack: 115 }, boosts: { attack: 3 } });
        expect(p.worn).toEqual(['sword']);
        expect(p.prayers).toEqual({ attack: 115 });
        expect(p.levels.attack).toBe(43);
        expect(baseLevels(p).attack).toBe(40);
    });
});

describe('combatLevelOf (combat_level.rs2:1-10, stat_base)', () => {
    test('Att 40, Str 62, Def 40, HP 50, Prayer 31 is 59, the hill giant trainer of combat.test.ts', () => {
        // 10*(40+50+15) = 1050, melee 13*102 = 1326: 2376/40 = 59.4 -> 59.
        const base = { ...at(1), attack: 40, strength: 62, defence: 40, hitpoints: 50, prayer: 31 };
        expect(combatLevelOf(profileOf(base, { tools }))).toBe(59);
        expect(combatLevelOf(profileOf(base, { tools }))).toBe(combatLevel(base));
    });

    test('boosts do not count: the script reads stat_base', () => {
        const base = { ...at(1), attack: 40, strength: 62, defence: 40, hitpoints: 50, prayer: 31 };
        // A boosted Strength 75 would give 10*105 + 13*115 = 2545, /40 -> 63; the base gives 59.
        const p = profileOf(base, { tools, boosts: { strength: 13 } });
        expect(combatLevelOf(p)).toBe(59);
    });
});

describe('gearOf', () => {
    test('sums each bonus over the worn objs; the right-hand obj is the weapon', () => {
        const g = gearOf(profileOf(at(30), { tools, worn: ['sword', 'shield', 'helm'] }), data);
        // slash attack 10; strength 8; slash defence 5 + 2 = 7; magic attack -3; the rest 0.
        expect(g.bonuses).toEqual({ ...zero, slashattack: 10, strengthbonus: 8, slashdefence: 7, magicattack: -3 });
        expect(g.weapon?.obj).toBe('sword');
        expect(g.attackRate).toBe(4);
        expect(g.styles.table).toBe('weapon_slash');
        expect(g.quests).toEqual(['dragonquest']);
    });

    test('no weapon: the unarmed swing rate and style table', () => {
        const g = gearOf(profileOf(at(30), { tools, worn: ['helm'] }), data);
        expect(g.weapon).toBeNull();
        expect(g.attackRate).toBe(UNARMED_ATTACK_RATE.value);
        expect(g.styles.table).toBe('unarmed');
    });

    test("a weapon with no category takes switch_category's default table, not the unarmed one", () => {
        const g = gearOf(profileOf(at(30), { tools, worn: ['lyre'] }), data);
        expect(g.attackRate).toBe(5);
        expect(g.styles.table).toBe('default');
    });

    test('two objs in one slot are a ProfileError, by any of their wearpos', () => {
        expect(clash(['twohander', 'shield'])).toThrow(
            new ProfileError('twohander and shield are both worn in lefthand'),
        );
        expect(clash(['helm', 'mask'])).toThrow(new ProfileError('helm and mask are both worn in jaw'));
        expect(clash(['sword', 'sword'])).toThrow(ProfileError);
        expect(clash(['twohander', 'helm'])).not.toThrow();
    });

    test('a wield level over the base level is a ProfileError; a boost does not lift it', () => {
        const worn = ['sword'];
        expect(() => gearOf(profileOf(at(19), { tools, worn }), data)).toThrow(
            new ProfileError('sword needs attack 20 to wield (tier20.rs2:1); the profile has 19'),
        );
        expect(() => gearOf(profileOf(at(19), { tools, worn, boosts: { attack: 5 } }), data)).toThrow(ProfileError);
        expect(gearOf(profileOf(at(20), { tools, worn }), data).weapon?.obj).toBe('sword');
    });
});
