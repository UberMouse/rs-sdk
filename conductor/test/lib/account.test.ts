// What an account meets of the world index's requirement tokens, and the account a bot's state shows.
import { describe, expect, test } from 'bun:test';
import { type Account, accountOf, meetsOneOf, meetsSet, meetsToken, NO_ACCOUNT } from '../../lib/account';
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

describe('accountOf', () => {
    test("a bot's base levels by lower-case name, and the coins it carries", () => {
        const built = world().skill('Fishing', 68).skill('Mining', 30).inv('Coins', 25).inv('Bronze axe').build();
        // A boosted level is not the base level the tokens ask for.
        const state = { ...built, skills: built.skills.map(s => (s.name === 'Mining' ? { ...s, level: 35 } : s)) };
        expect(accountOf(state)).toEqual({ levels: { fishing: 68, mining: 30 }, coins: 25 });
    });

    test('no coins carried is 0', () => {
        expect(accountOf(world().build()).coins).toBe(0);
    });
});
