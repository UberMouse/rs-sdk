import { describe, expect, test } from 'bun:test';
import spellItems from '../../tasks/spell-items';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const base = world().skill('Magic', 43, 0).inv('Nature rune', 30);
const CAST = 'cast Superheat Item on Iron ore';
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
/** `n` ores held at the start, the first cast landing on tick 2 and one more every 3 ticks (cast, XP two ticks later, a hold). */
const castsDone = (n: number, i: number) => (i < 2 ? 0 : Math.min(n, 1 + Math.floor((i - 2) / 3)));
const atTick = (n: number, w: World, i: number) => {
    const done = castsDone(n, i);
    return w
        .inv('Iron ore', n - done, { id: 440 })
        .inv('Iron bar', done, { id: 2351 })
        .skill('Magic', 43, 1325 * done);
};
const casting = (n: number, ticks = 20, extra: (w: World, i: number) => World = w => w) =>
    base.inv('Iron ore', n, { id: 440 }).series(ticks, (w, i) => extra(atTick(n, w, i), i));
const params = { spell: 'superheat', item: '^iron ore$' } as const;

describe('spell-items: casting', () => {
    test('casts on every matching item and ends done when none are left', async () => {
        const r = await simulate(spellItems, { params, timeline: casting(3) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-none: no /^iron ore$/i left after 3 casts of Superheat Item');
        expect(r.sends).toEqual([CAST, CAST, CAST]);
        expect(r.result.inventoryDelta).toEqual({ 'Iron ore': -3, 'Iron bar': 3 });
        expect(logged(r)).toEqual([]);
    });

    test('count stops the run after that many casts', async () => {
        const r = await simulate(spellItems, { params: { ...params, count: 2 }, timeline: casting(5) });
        expect(r.result.reason).toBe('stop-count: cast Superheat Item 2 times');
        expect(r.sends).toEqual([CAST, CAST]);
    });

    test('the other spells send their own component and name', async () => {
        const r = await simulate(spellItems, {
            params: { spell: 'high-alchemy', item: 'dragon', count: 1 },
            timeline: world()
                .skill('Magic', 60, 0)
                .inv('Dragon dagger', 1, { id: 1215 })
                .series(10, (w, i) => (i >= 2 ? w.skill('Magic', 60, 650) : w)),
        });
        expect(r.sends).toEqual(['cast High Level Alchemy on Dragon dagger']);
        expect(r.result.status).toBe('done');
    });
});

describe('spell-items: failures', () => {
    test('a server refusal fails the run at once with its message', async () => {
        const msg = 'You do not have enough Fire Runes to cast this spell.';
        const r = await simulate(spellItems, {
            params,
            timeline: casting(3, 6, (w, i) => (i === 4 ? w.message(msg) : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`cast: ${msg}`);
        expect(r.sends).toEqual([CAST, CAST]);
    });

    test('three casts in a row with no effect fail the run', async () => {
        const dead = await simulate(spellItems, { params, timeline: base.inv('Iron ore', 3, { id: 440 }).series(1) });
        expect(dead.result.reason).toBe(
            'cast: 3 casts in a row failed (last: Timeout waiting for Superheat Item on Iron ore)',
        );
        expect(dead.sends).toHaveLength(3);
    });

    test('a send the client refuses counts as a failed cast', async () => {
        const r = await simulate(spellItems, {
            params,
            timeline: base.inv('Iron ore', 3, { id: 440 }).series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.reason).toBe('cast: 3 casts in a row failed (last: not connected)');
    });
});

describe('spell-items: preflight', () => {
    test('refuses a Magic level below the spell', async () => {
        const r = await simulate(spellItems, {
            params,
            timeline: world().skill('Magic', 42, 0).inv('Iron ore', 1, { id: 440 }).series(1),
        });
        expect(r.result.reason).toBe('preflight: Superheat Item needs magic 43, bot has 42');
        expect(r.sends).toEqual([]);
    });

    test('refuses when no item matches', async () => {
        const r = await simulate(spellItems, { params, timeline: base.series(1) });
        expect(r.result.reason).toBe('preflight: no inventory item matches /^iron ore$/i');
    });

    test('a catch-all pattern never targets coins or runes', async () => {
        const r = await simulate(spellItems, {
            params: { spell: 'high-alchemy', item: '.' },
            timeline: world().skill('Magic', 60, 0).inv('Nature rune', 30).inv('Coins', 500).series(1),
        });
        expect(r.result.reason).toBe('preflight: no inventory item matches /./i');
        expect(r.sends).toEqual([]);
    });

    test('rejects a pattern that is not a regular expression', () => {
        expect(spellItems.params.safeParse({ spell: 'superheat', item: '(' }).success).toBe(false);
        expect(spellItems.params.safeParse({ spell: 'nope', item: 'x' }).success).toBe(false);
    });
});

describe('spell-items: guards', () => {
    test('a level-up dialog mid-wait is cleared and the casting carries on', async () => {
        const r = await simulate(spellItems, {
            params,
            timeline: casting(2, 12, (w, i) =>
                i === 3
                    ? w.dialog({
                          text: 'Congratulations, you just advanced a Magic level.',
                          options: ['Click here to continue'],
                      })
                    : w,
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s === CAST)).toHaveLength(2);
    });

    test('low HP mid-wait eats, then casting resumes', async () => {
        const r = await simulate(spellItems, {
            params,
            timeline: casting(2, 20, (w, i) => w.inv('Shrimps', 1).player({ hp: i === 3 ? 3 : 10 })),
        });
        expect(r.sends).toContain('Eat Shrimps');
        expect(r.result.status).toBe('done');
    });
});
