import { describe, expect, test } from 'bun:test';
import { Spells } from '../../../sdk/spells';
import { CAST_ITEM_WAIT_TICKS, castOnItem } from '../../actions/cast-item';
import { world } from '../world';
import { refuse, runOp } from './harness';

const base = world().skill('Magic', 43, 0).inv('Iron ore', 2, { id: 440 }).inv('Nature rune', 5);
const ore = base.build().inventory[0]!;
const run = (states: ReturnType<typeof base.series>, hold = 0, opts = {}) =>
    runOp(states, ctx => castOnItem(ctx, ore, Spells.SUPERHEAT, 'Superheat Item', hold), opts);

describe('castOnItem', () => {
    test('sends the spell on the item slot and succeeds on the Magic XP the cast pays', async () => {
        const { result, sends, driver } = await run(
            base.series(10, (w, i) => (i >= 2 ? w.skill('Magic', 43, 1325) : w)),
        );
        expect(result).toEqual({ ok: true, xpGained: 1325 });
        expect(sends).toEqual([
            { type: 'spellOnItem', slot: 0, spellComponent: 1173, reason: 'cast Superheat Item on Iron ore' },
        ]);
        expect(driver.state().tick).toBe(2);
    });

    test('holdTicks keeps the op going after the XP, for the spell delay', async () => {
        const { driver } = await run(
            base.series(10, (w, i) => (i >= 2 ? w.skill('Magic', 43, 1325) : w)),
            1,
        );
        expect(driver.state().tick).toBe(3);
    });

    test('Magic XP from before the cast is no evidence: a timeout after the wait budget', async () => {
        const { result, driver } = await run(base.skill('Magic', 43, 1325).series(1));
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(driver.state().tick).toBe(CAST_ITEM_WAIT_TICKS);
    });

    test("the server's refusals are told apart, and an old message is ignored", async () => {
        const cases: [string, string][] = [
            ['You do not have enough Fire Runes to cast this spell.', 'no-runes'],
            ['Your Magic level is not high enough for this spell.', 'level'],
            ['You need to cast superheat item on ore.', 'refused'],
            ['You need a smithing level of at least 30 to smelt steel.', 'refused'],
            ['Even this spell is not hot enough to heat this item.', 'refused'],
            ['Coins are already made of gold.', 'refused'],
            ['Ugly parasites have feelings too!', 'refused'],
            ['The magic of the monkeys defies alchemy.', 'refused'],
            ['This spell can only be cast on Emerald Amulets and Rings.', 'refused'],
        ];
        for (const [msg, reason] of cases) {
            const { result } = await run([base.build(), base.tick(2).message(msg).build()]);
            expect(result).toEqual({ ok: false, reason, message: msg } as typeof result);
        }
        const stale = await run(base.message('You need to cast superheat item on ore.').tick(1).series(1));
        expect(stale.result).toMatchObject({ ok: false, reason: 'timeout' });
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(base.series(1), 0, { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});
