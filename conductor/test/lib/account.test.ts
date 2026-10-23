// What an account meets of the world index's requirement tokens, and the account a bot's state shows.
import { describe, expect, test } from 'bun:test';
import { type Account, accountOf, meetsOneOf, meetsSet, meetsToken, NO_ACCOUNT } from '../../lib/account';
import { ANY_CAME_FROM } from '../../../wiki/world/requirements';
import { world } from '../world';

const account = (a: Partial<Account> = {}): Account => ({ levels: {}, coins: 0, ...a });

describe('meetsToken', () => {
    test('members is met by any account (bots play on members worlds)', () => {
        expect(meetsToken(NO_ACCOUNT, 'members')).toBe(true);
    });

    test('a skill level is met at and above it, not below', () => {
        const fisher = account({ levels: { fishing: 68 } });
        expect(meetsToken(fisher, 'skill:fishing:68')).toBe(true);
        expect(meetsToken(fisher, 'skill:fishing:67')).toBe(true);
        expect(meetsToken(fisher, 'skill:fishing:69')).toBe(false);
    });

    test('a skill absent from the levels counts as level 1', () => {
        expect(meetsToken(NO_ACCOUNT, 'skill:mining:1')).toBe(true);
        expect(meetsToken(NO_ACCOUNT, 'skill:mining:2')).toBe(false);
    });

    test('coins are met with that many carried or more', () => {
        expect(meetsToken(account({ coins: 10 }), 'coins:10')).toBe(true);
        expect(meetsToken(account({ coins: 9 }), 'coins:10')).toBe(false);
    });

    test('a token the caller checked is met', () => {
        const worn = account({ met: new Set(['item:dramen_staff:worn']) });
        expect(meetsToken(worn, 'item:dramen_staff:worn')).toBe(true);
        expect(meetsToken(NO_ACCOUNT, 'item:dramen_staff:worn')).toBe(false);
    });

    test('a quest done meets every stage gate of it, and only of it', () => {
        const done = account({ met: new Set(['quest:legends']) });
        expect(meetsToken(done, 'quest:legends')).toBe(true);
        expect(meetsToken(done, 'quest:legends>=3')).toBe(true);
        expect(meetsToken(done, 'quest:heroes>=3')).toBe(false);
        expect(meetsToken(NO_ACCOUNT, 'quest:legends>=3')).toBe(false);
    });

    test('a stage listed in met meets every lower stage of the same quest, not a higher one or another quest', () => {
        const a = account({ met: new Set(['quest:priestperil>=5']) });
        expect(meetsToken(a, 'quest:priestperil>=5')).toBe(true);
        expect(meetsToken(a, 'quest:priestperil>=4')).toBe(true);
        expect(meetsToken(a, 'quest:priestperil>=1')).toBe(true);
        expect(meetsToken(a, 'quest:priestperil>=6')).toBe(false);
        expect(meetsToken(a, 'quest:priestperil>=61')).toBe(false);
        expect(meetsToken(a, 'quest:priest>=4')).toBe(false);
        expect(meetsToken(a, 'quest:priestperil')).toBe(false);
    });

    test('a quest done does not meet a stage above its completion value unless that stage is listed', () => {
        const done = account({ met: new Set(['quest:priestperil']) });
        expect(meetsToken(done, 'quest:priestperil>=60')).toBe(true);
        expect(meetsToken(done, 'quest:priestperil>=61')).toBe(false);
        const listed = account({ met: new Set(['quest:priestperil', 'quest:priestperil>=61']) });
        expect(meetsToken(listed, 'quest:priestperil>=61')).toBe(true);
        expect(meetsToken(listed, 'quest:priestperil>=8')).toBe(true);
    });

    test('a quest id missing from QUESTS keeps done-meets-every-stage; mm completes at 9', () => {
        const unknown = account({ met: new Set(['quest:notaquest']) });
        expect(meetsToken(unknown, 'quest:notaquest>=99')).toBe(true);
        expect(meetsToken(unknown, 'quest:other>=1')).toBe(false);
        const mm = account({ met: new Set(['quest:mm']) });
        expect(meetsToken(mm, 'quest:mm>=9')).toBe(true);
        expect(meetsToken(mm, 'quest:mm>=10')).toBe(false);
    });

    test('a token the account cannot settle is not met', () => {
        expect(meetsToken(account({ levels: { fishing: 99 }, coins: 1000 }), 'unknown:thing')).toBe(false);
    });
});

describe('meetsSet and meetsOneOf', () => {
    test('the empty set is met by any account; a set needs every token', () => {
        expect(meetsSet(NO_ACCOUNT, [])).toBe(true);
        expect(meetsSet(account({ levels: { fishing: 68 } }), ['members', 'skill:fishing:68'])).toBe(true);
        expect(meetsSet(account({ levels: { fishing: 68 } }), ['skill:fishing:68', 'coins:10'])).toBe(false);
    });

    test('no set at all is met by none; one met set is enough', () => {
        expect(meetsOneOf(NO_ACCOUNT, [])).toBe(false);
        expect(meetsOneOf(NO_ACCOUNT, [['coins:10'], []])).toBe(true);
        expect(meetsOneOf(NO_ACCOUNT, [['coins:10'], ['skill:fishing:68']])).toBe(false);
    });
});

describe('meetsToken: objs carried and worn, and the wizard on record', () => {
    const carrying = account({
        held: new Map([
            ['air_talisman', 1],
            ['shantay_pass', 2],
        ]),
        worn: new Set(['dramen_staff']),
    });

    test('an obj carried meets item:<obj>:held; one worn meets item:<obj>:worn, not :held', () => {
        expect(meetsToken(carrying, 'item:air_talisman:held')).toBe(true);
        expect(meetsToken(carrying, 'item:water_talisman:held')).toBe(false);
        expect(meetsToken(carrying, 'item:dramen_staff:worn')).toBe(true);
        expect(meetsToken(carrying, 'item:dramen_staff:held')).toBe(false);
    });

    test('consume:<obj>:<n> is met with n or more carried', () => {
        expect(meetsToken(carrying, 'consume:shantay_pass:2')).toBe(true);
        expect(meetsToken(carrying, 'consume:shantay_pass:3')).toBe(false);
    });

    test('a came-from requirement is met only for the wizard on record; with none, only inside the mine', () => {
        const aubury = account({ met: new Set(['other:came from aubury']) });
        expect(meetsToken(aubury, 'other:came from aubury')).toBe(true);
        expect(meetsToken(aubury, 'other:came from wizard_sedridor')).toBe(false);
        // None on record and not known to be in the mine (a bot outside): no way out is met.
        expect(meetsToken(NO_ACCOUNT, 'other:came from wizard_sedridor')).toBe(false);
        // Inside the mine with none on record: any wizard's.
        const inside = account({ met: new Set([ANY_CAME_FROM]) });
        expect(meetsToken(inside, 'other:came from wizard_sedridor')).toBe(true);
        expect(meetsToken(inside, 'other:came from aubury')).toBe(true);
        // A wizard on record beats the wildcard.
        const both = account({ met: new Set([ANY_CAME_FROM, 'other:came from aubury']) });
        expect(meetsToken(both, 'other:came from aubury')).toBe(true);
        expect(meetsToken(both, 'other:came from wizard_sedridor')).toBe(false);
    });
});

describe('quests from the quest tab', () => {
    test('a quest done meets its token and every stage; one started meets stage 1 only', () => {
        const a = accountOf(world().quests({ runemysteries: 'done', imp: 'started' }).build());
        expect(meetsToken(a, 'quest:runemysteries')).toBe(true);
        expect(meetsToken(a, 'quest:runemysteries>=4')).toBe(true);
        expect(meetsToken(a, 'quest:imp')).toBe(false);
        expect(meetsToken(a, 'quest:imp>=1')).toBe(true);
        expect(meetsToken(a, 'quest:imp>=2')).toBe(false);
        expect(meetsToken(a, 'quest:priest')).toBe(false);
        expect(meetsToken(a, 'quest:priest>=1')).toBe(false);
    });

    test('a state with no quest tab meets no quest', () => {
        expect(meetsToken(accountOf(world().build()), 'quest:runemysteries')).toBe(false);
    });
});

describe('accountOf', () => {
    test("a bot's base and current levels by lower-case name, the coins and objs it carries, what it wears", () => {
        const built = world()
            .skill('Fishing', 68)
            .skill('Mining', 30)
            .inv('Coins', 25)
            .inv('Bronze axe')
            .equipment({ name: 'Bronze pickaxe' })
            .build();
        // A boosted level is not the base level the tokens ask for, but it is what a roll reads.
        const state = { ...built, skills: built.skills.map(s => (s.name === 'Mining' ? { ...s, level: 35 } : s)) };
        const a = accountOf(state);
        expect(a.levels).toEqual({ fishing: 68, mining: 30 });
        expect(a.current).toEqual({ fishing: 68, mining: 35, hitpoints: 10 });
        expect(a.coins).toBe(25);
        expect(a.held).toEqual(
            new Map([
                ['coins', 25],
                ['bronze_axe', 1],
            ]),
        );
        expect(a.worn).toEqual(new Set(['bronze_pickaxe']));
        expect(a.met).toEqual(new Set(['category:weapon_axe:held', 'category:weapon_pickaxe:worn']));
    });

    test('inside the essence mine it meets the any-wizard way out; outside it does not', () => {
        const inside = accountOf(
            world()
                .player({ at: { x: 2910, z: 4830 } })
                .build(),
        );
        expect(inside.met?.has(ANY_CAME_FROM)).toBe(true);
        expect(meetsToken(inside, 'other:came from aubury')).toBe(true);
        const outside = accountOf(world().build());
        expect(outside.met?.has(ANY_CAME_FROM)).toBe(false);
        expect(meetsToken(outside, 'other:came from aubury')).toBe(false);
    });

    test('no coins carried is 0', () => {
        expect(accountOf(world().build()).coins).toBe(0);
    });
});
