import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import herblore, { herbKey, HERBS, RECIPES, SECONDARIES } from '../../tasks/herblore';
import { consume } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const GUAM = 199;
const HARRALANDER = 205;
const IRIT = 209;
const VIAL = 227;
const NEWT = 221;
const CHOCOLATE = 1975;
const ATTACK_UNF = 91;
const IRIT_UNF = 101;
const IDENTIFY = [{ text: 'Identify', opIndex: 1 }];
/** What the fake game pays, so a test can read it back. */
const CLEAN_XP = 100;
const FINISH_XP = 1000;

type Item = BotWorldState['inventory'][number];
const herb = (key: string) => HERBS.find(h => h.key === key)!;
const NAMES = new Map<number, string>([
    [VIAL, 'Vial of water'],
    [NEWT, 'Eye of newt'],
    [CHOCOLATE, 'Chocolate dust'],
]);
for (const h of HERBS) {
    NAMES.set(h.grimy, 'Herb');
    NAMES.set(h.clean, `Clean ${h.key}`);
    NAMES.set(h.unf, 'Unfinished potion');
}
for (const r of RECIPES) NAMES.set(r.product, r.potion);
const item = (id: number, slot: number): Item => ({
    slot,
    id,
    name: NAMES.get(id) ?? `item ${id}`,
    count: 1,
    optionsWithIndex: HERBS.some(h => h.grimy === id) ? IDENTIFY : [],
});
/** A pack of unstackable items (one slot each), at Herblore `level`. */
const pack = (ids: number[], level = 57): World => {
    const base = world().skill('Herblore', level, 0).build();
    return world({ ...base, inventory: ids.map(item) });
};

const withInventory = (s: BotWorldState, inventory: Item[], xp: number): BotWorldState => {
    const skills = s.skills.map(k => (k.name === 'Herblore' ? { ...k, experience: k.experience + xp } : k));
    return { ...s, skills, inventory: inventory.map((i, slot) => ({ ...i, slot })) };
};
const firstOf = (inv: Item[], id: number) => inv.findIndex(i => i.id === id);

/** The game's reaction to a herblore send: the herb cleaned in place, the pair swapped for the product. */
function game(action: BotAction, state: BotWorldState) {
    if (action.type === 'useInventoryItem') {
        const grimy = state.inventory.find(i => i.slot === action.slot);
        const h = HERBS.find(x => x.grimy === grimy?.id);
        if (!grimy || !h) return consume(action, state);
        const effect: Effect = s => {
            const at = firstOf(s.inventory, h.grimy);
            if (at < 0) return s;
            return withInventory(
                s,
                s.inventory.map((i, n) => (n === at ? item(h.clean, i.slot) : i)),
                CLEAN_XP,
            );
        };
        return effect;
    }
    if (action.type === 'useItemOnItem') {
        const a = state.inventory.find(i => i.slot === action.sourceSlot)!;
        const b = state.inventory.find(i => i.slot === action.targetSlot)!;
        const unf = HERBS.find(h => h.clean === a.id || h.clean === b.id);
        const product =
            unf && (a.id === VIAL || b.id === VIAL)
                ? { id: unf.unf, xp: 0 }
                : RECIPES.map(r => ({ r, h: herb(r.herb) }))
                      .filter(
                          ({ r, h }) =>
                              [a.id, b.id].includes(h.unf) && [a.id, b.id].includes(SECONDARIES[r.secondary].id),
                      )
                      .map(({ r }) => ({ id: r.product, xp: FINISH_XP }))[0];
        if (!product) return undefined;
        const effect: Effect = s => {
            const x = firstOf(s.inventory, a.id);
            const y = firstOf(s.inventory, b.id);
            if (x < 0 || y < 0) return s;
            return withInventory(
                s,
                [...s.inventory.filter((_, n) => n !== x && n !== y), item(product.id, 0)],
                product.xp,
            );
        };
        return effect;
    }
    return consume(action, state);
}

const run = (p: World, params: object = {}, ticks = 400, tweak: (w: World, i: number) => World = w => w) =>
    simulate(herblore, { params, timeline: p.series(ticks, tweak), react: game });
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const CLEAN = 'Identify Herb';
const UNF = 'use Clean guam on Vial of water';
const FINISH = 'use Eye of newt on Unfinished potion';

describe('herblore: modes', () => {
    test('all: cleans, then puts on vials, then finishes, and ends done with what was made', async () => {
        const r = await run(pack([GUAM, IRIT, VIAL, VIAL, NEWT, NEWT]));
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finished: nothing left to do: cleaned 2, unfinished 2, finished 2');
        expect(r.sends).toEqual([
            CLEAN,
            CLEAN,
            'use Clean guam on Vial of water',
            'use Clean irit on Vial of water',
            FINISH,
            FINISH,
        ]);
        expect(r.result.xpGained).toEqual({ Herblore: 2 * CLEAN_XP + 2 * FINISH_XP });
        expect(r.result.inventoryDelta).toEqual({
            Herb: -2,
            'Vial of water': -2,
            'Eye of newt': -2,
            'Attack potion': 1,
            'Super attack': 1,
        });
    });

    test('clean touches only the herbs, and the reason lists what is left', async () => {
        const r = await run(pack([GUAM, VIAL, NEWT]), { mode: 'clean' });
        expect(r.sends).toEqual([CLEAN]);
        expect(r.result.reason).toBe(
            'finished: nothing left to do: cleaned 1, unfinished 0, finished 0; left: 1 clean herbs',
        );
    });

    test('unfinished puts clean herbs on vials and nothing else', async () => {
        const r = await run(pack([herb('guam').clean, GUAM, VIAL, NEWT]), { mode: 'unfinished' });
        expect(r.sends).toEqual([UNF]);
        expect(r.result.xpGained).toEqual({});
        expect(r.result.reason).toBe(
            'finished: nothing left to do: cleaned 0, unfinished 1, finished 0; left: 1 grimy herbs, 1 unfinished potions',
        );
    });

    test('finish makes only the potions pairs name', async () => {
        const w = pack([ATTACK_UNF, IRIT_UNF, NEWT, NEWT]);
        const r = await run(w, { mode: 'finish', pairs: [{ unf: 'Guam potion (unf)', secondary: 'Eye of newt' }] });
        expect(r.sends).toEqual([FINISH]);
        expect(r.result.inventoryDelta).toEqual({ 'Attack potion': 1, 'Unfinished potion': -1, 'Eye of newt': -1 });
        expect(r.result.reason).toBe(
            'finished: nothing left to do: cleaned 0, unfinished 0, finished 1; left: 1 unfinished potions',
        );
    });

    test('finish without pairs makes every recipe the pack can, in the table order', async () => {
        const r = await run(pack([IRIT_UNF, herb('harralander').unf, NEWT, CHOCOLATE]), { mode: 'finish' });
        expect(r.result.inventoryDelta).toEqual({
            'Super attack': 1,
            'Energy potion': 1,
            'Unfinished potion': -2,
            'Eye of newt': -1,
            'Chocolate dust': -1,
        });
    });

    test('finish honours herbs: other herbs unfinished potions are left', async () => {
        const w = pack([IRIT_UNF, ATTACK_UNF, NEWT, NEWT]);
        const r = await run(w, { mode: 'finish', herbs: ['irit'] });
        expect(r.result.inventoryDelta).toEqual({ 'Super attack': 1, 'Unfinished potion': -1, 'Eye of newt': -1 });
        const p = await run(w, {
            mode: 'finish',
            pairs: [{ unf: 'Guam potion (unf)', secondary: 'Eye of newt' }],
        });
        expect(p.result.inventoryDelta).toEqual({ 'Attack potion': 1, 'Unfinished potion': -1, 'Eye of newt': -1 });
    });

    test('finish without pairs resolves competing secondaries in table order: defence before prayer', async () => {
        const r = await run(pack([herb('ranarr').unf, 239, 231], 60), { mode: 'finish' });
        expect(r.result.inventoryDelta).toEqual({
            'Defence potion': 1,
            'Unfinished potion': -1,
            'item 239': -1,
        });
    });

    test('all with pairs works only the pairs herbs: others are left grimy', async () => {
        const r = await run(pack([GUAM, HARRALANDER, VIAL, VIAL, NEWT]), {
            pairs: [{ unf: 'guam', secondary: 'eye of newt' }],
        });
        expect(r.sends).toEqual([CLEAN, UNF, FINISH]);
        expect(r.result.reason).toBe(
            'finished: nothing left to do: cleaned 1, unfinished 1, finished 1; left: 1 grimy herbs',
        );
    });

    test('herbs limits clean and unfinished', async () => {
        const r = await run(pack([GUAM, IRIT, VIAL, VIAL]), { mode: 'unfinished', herbs: ['Irit leaf'] });
        // no clean irit in the pack: nothing to do, refused at the start
        expect(r.result.status).toBe('failed');
        const c = await run(pack([GUAM, IRIT, VIAL]), { mode: 'clean', herbs: ['Irit leaf'] });
        expect(c.sends).toEqual([CLEAN]);
        expect(c.result.inventoryDelta).toEqual({ Herb: -1, 'Clean irit': 1 });
    });
});

describe('herblore: levels', () => {
    test('a herb above the level is left alone', async () => {
        const r = await run(pack([GUAM, IRIT], 39));
        expect(r.sends).toEqual([CLEAN]);
        expect(r.result.reason).toBe(
            'finished: nothing left to do: cleaned 1, unfinished 0, finished 0; left: 1 grimy herbs, 1 clean herbs',
        );
    });

    test('an unfinished potion needs its own level, one above the clean level for irit', async () => {
        const r = await run(pack([herb('irit').clean, VIAL], 44), { mode: 'unfinished' });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: nothing to do in the pack for mode "unfinished" at Herblore 44');
    });

    test('a recipe above the level is skipped', async () => {
        // irit + newt needs 45; guam + newt needs 3
        const r = await run(pack([IRIT_UNF, ATTACK_UNF, NEWT], 44));
        expect(r.result.inventoryDelta).toEqual({ 'Attack potion': 1, 'Unfinished potion': -1, 'Eye of newt': -1 });
    });
});

describe('herblore: preflight', () => {
    test.each([
        [{ herbs: ['pumpkin'] }, 'unknown herb "pumpkin"'],
        [{ pairs: [{ unf: 'guam', secondary: 'Chocolate dust' }] }, 'no potion from unf "guam" + "Chocolate dust"'],
    ])('%j is refused', async (params, start) => {
        const r = await run(pack([GUAM, VIAL, NEWT]), params);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason.startsWith(`preflight: ${start}`)).toBe(true);
        expect(r.sends).toEqual([]);
    });

    test('an empty pack has nothing to do', async () => {
        const r = await run(pack([]));
        expect(r.result.reason).toBe('preflight: nothing to do in the pack for mode "all" at Herblore 57');
    });

    test('pairs with mode clean is a bad param', () => {
        expect(herblore.params.safeParse({ mode: 'clean', pairs: [] }).success).toBe(false);
    });
});

/** A world that ignores every send. */
const never = (): undefined => undefined;

describe('herblore: failures and guards', () => {
    test('three cleans in a row that never land fail the run with the last reason', async () => {
        const r = await simulate(herblore, {
            timeline: pack([GUAM]).series(60),
            react: never,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('clean: 3 cleans in a row failed (timeout: Timed out cleaning Herb)');
        expect(r.sends).toHaveLength(3);
        expect(logged(r)).toHaveLength(3);
    });

    test('a success between failures resets the streak', async () => {
        let n = 0;
        // Only the third send lands.
        const react = (a: BotAction, s: BotWorldState) => (++n === 3 ? game(a, s) : undefined);
        const r = await simulate(herblore, {
            params: { mode: 'clean' },
            timeline: pack([GUAM, GUAM]).series(200),
            react,
        });
        // 2 failures, a success that resets the count, then 3 more failures: 6 sends, not 3.
        expect(r.result.status).toBe('failed');
        expect(r.sends).toHaveLength(6);
    });

    test('low HP mid-clean eats, then the clean goes on', async () => {
        const r = await run(pack([GUAM, GUAM]).inv('Shrimps', 1), { mode: 'clean' }, 100, (w, i) =>
            w.player({ hp: i === 1 ? 4 : 10 }),
        );
        expect(r.sends).toEqual([CLEAN, 'Eat Shrimps', CLEAN]);
        expect(r.result.status).toBe('done');
    });

    test('a level-up dialog after a use is clicked away before the next one', async () => {
        const r = await run(pack([GUAM, GUAM]), { mode: 'clean' }, 100, (w, i) =>
            i >= 2 && i < 4 ? w.dialog({ text: 'Congratulations, you just advanced a Herblore level.' }) : w,
        );
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s === CLEAN)).toHaveLength(2);
        expect(r.sends).toEqual([CLEAN, CLEAN, 'continue dialog']);
        expect(r.result.stepRuns['interrupt:dialog']).toBe(1);
    });
});

describe('herblore: tables and names', () => {
    test.each([
        ['Guam leaf', 'guam'],
        ['Guam potion (unf)', 'guam'],
        ['Marentill', 'marrentill'],
        ['Unfinished marrentill potion', 'marrentill'],
        ['Grimy ranarr weed', 'ranarr'],
        ['Dwarf weed', 'dwarf weed'],
        ['IRIT', 'irit'],
    ])('herbKey(%s) = %s', (name, key) => {
        expect(herbKey(name)).toBe(key);
    });

    test('an unknown name has no key', () => {
        expect(herbKey('Rune scimitar')).toBeUndefined();
    });

    test('every recipe names a known herb', () => {
        for (const r of RECIPES) expect(HERBS.some(h => h.key === r.herb)).toBe(true);
    });
});
