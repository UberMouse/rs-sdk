import { describe, expect, test } from 'bun:test';
import { FLETCH_MENU_TICKS } from '../../actions/fletch';
import fletching from '../../tasks/fletching';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const SHAFT = 52;
/** Normal logs' make menu as the live client publishes it (see actions/fletch.test.ts). */
const MENU = ['15 Arrow Shafts', 'Short Bow', 'Long Bow'].flatMap(p => [
    'Make X',
    'Make 10',
    'Make 5',
    `\\n\\n\\n\\n${p}`,
]);
const USE = 'use Knife on Logs';
const MAKE = 'fletch 15 Arrow Shafts';
const MEMBERS = "You need to be on a members' world to gain experience in Fletching.";
const PARAMS = { product: 'arrow shaft', logs: 'Logs' };
const kit = world().skill('Fletching', 1, 0).inv('Knife', 1).inv('Logs', 2);
const menu = (w: World) => w.dialog({ options: MENU });
/** `n` batches done: `logs` left, a slot of shafts per batch, 75 xp each. */
const made = (w: World, n: number, logs = 2 - n) =>
    w
        .inv('Logs', logs)
        .inv('Arrow shaft', n, { id: SHAFT })
        .skill('Fletching', 1, 75 * n);
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/**
 * Batches of five ticks from tick 0: the knife is used on the first, the menu is open on the second and
 * third (the click answers it), and the batch is made on the fifth, which is also when the next knife use is sent.
 */
function batches(n: number, base: World = kit): World[] {
    return Array.from({ length: n * 4 + 1 }, (_, t) => {
        const w = base.tick(t);
        const done = Math.floor(t / 4);
        const phase = t % 4;
        const state = made(w, done);
        return phase === 1 || phase === 2 ? menu(state) : state;
    });
}
const build = (ws: World[]) => ws.map(w => w.build());

/** A message arriving afresh on each tick from 1, so every attempt sees its own. */
const freshMessages = (text: string) => kit.series(60, (w, i) => (i >= 1 ? w.message(text) : w));

describe('fletching: cutting', () => {
    test('cuts each log into the product and finishes when none are left', async () => {
        const r = await simulate(fletching, { params: PARAMS, timeline: build(batches(2)) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE, USE, MAKE]);
        expect(r.result.inventoryDelta).toEqual({ Logs: -2, 'Arrow shaft': 2 });
        expect(r.result.xpGained).toEqual({ Fletching: 150 });
        expect(logged(r)).toEqual([]);
    });

    test('normalizes the product to the dialog label: "shortbow (u)" picks Short Bow', async () => {
        const r = await simulate(fletching, {
            params: { ...PARAMS, product: 'shortbow (u)' },
            timeline: build(batches(2)).map(st => ({
                ...st,
                skills: st.skills.map(k => (k.name === 'Fletching' ? { ...k, level: 5, baseLevel: 5 } : k)),
            })),
            stops: [{ kind: 'xp', skill: 'Fletching', amount: 75 }],
        });
        expect(r.sends).toEqual([USE, 'fletch Short Bow']);
    });
});

describe('fletching: failed attempts', () => {
    test('three attempts in a row fail the run with the last message', async () => {
        const r = await simulate(fletching, { params: PARAMS, timeline: freshMessages(MEMBERS) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`cut: 3 fletch attempts in a row failed (last: ${MEMBERS})`);
        expect(r.sends).toEqual([USE, USE, USE]);
        expect(logged(r)).toEqual(Array(3).fill(`fletch failed: ${MEMBERS}`));
    });

    test('a make menu that never opens is a failed attempt after its wait', async () => {
        const r = await simulate(fletching, { params: PARAMS, timeline: kit.series(1) });
        expect(r.result.reason).toBe('cut: 3 fletch attempts in a row failed (last: Fletching dialog did not open)');
        expect(r.driver.state().tick).toBe(3 * FLETCH_MENU_TICKS);
    });

    test('a success in between resets the count', async () => {
        // Two refusals (ticks 1-2), a batch from tick 2 (made 6), two more (7-8), a batch from tick 8 (made 12).
        const r = await simulate(fletching, {
            params: PARAMS,
            timeline: kit.series(14, (w, i) => {
                if (i >= 12) return made(w, 2);
                if (i >= 9) return i <= 10 ? menu(made(w, 1)) : made(w, 1);
                if (i >= 6) return i >= 7 && i <= 8 ? made(w, 1).message(MEMBERS) : made(w, 1);
                if (i >= 3) return i <= 4 ? menu(w) : w;
                return i >= 1 ? w.message(MEMBERS) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends.filter(s => s === USE)).toHaveLength(6);
    });

    test("the game's level box and a batch that is never made are failed attempts, then it carries on", async () => {
        const box = 'You need a Fletching level of at least 5 to make a shortbow.';
        const r = await simulate(fletching, {
            params: PARAMS,
            timeline: kit.series(40, (w, i) => {
                // First batch: menu 1-2, the level box at 3. Second: menu 4-5, nothing made for 30 ticks.
                // Third: menu 36-37, made at 39.
                if (i === 3) return w.recentDialog([box]);
                if (i === 1 || i === 2 || i === 4 || i === 5 || i === 36 || i === 37) return menu(w);
                return i >= 39 ? made(w, 2) : w;
            }),
        });
        expect(logged(r)).toEqual(['fletch failed: Fletching level too low', 'fletch failed: Fletching timed out']);
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
    });

    test('a knife lost mid-run fails the run', async () => {
        const r = await simulate(fletching, {
            params: PARAMS,
            timeline: kit.series(30, (w, i) => (i >= 3 ? w.inv('Knife', 0).message(MEMBERS) : w)),
        });
        expect(r.result.reason).toBe('cut: no knife in inventory');
    });
});

describe('fletching: attaching feathers', () => {
    const feathered = { ...PARAMS, attachFeathers: true };
    const withFeathers = kit.inv('Logs', 1).inv('Feathers', 15, { id: 314 });
    const ATTACH = 'use Feathers on Arrow shaft';

    test('uses the feathers on the shafts and finishes when they are gone', async () => {
        const r = await simulate(fletching, {
            params: feathered,
            timeline: withFeathers.series(20, (w, i) => {
                // Batch made at tick 4 (two shaft slots), the headless arrows at 7.
                if (i >= 7) return w.inv('Logs', 0).inv('Feathers', 0).inv('Headless arrow', 15, { id: 53 });
                if (i >= 4) return made(w, 2, 0);
                return i === 1 || i === 2 ? menu(w) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE, ATTACH]);
    });

    test('says how many shafts are left when the feathers run out first', async () => {
        const r = await simulate(fletching, {
            params: feathered,
            timeline: withFeathers.series(20, (w, i) => {
                if (i >= 7) return made(w, 1, 0).inv('Feathers', 0).inv('Headless arrow', 15, { id: 53 });
                if (i >= 4) return made(w, 2, 0);
                return i === 1 || i === 2 ? menu(w) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch; 1 Arrow shafts left, no Feathers');
    });

    test('three attempts the game answers with nothing happening fail the run with the last game message', async () => {
        const nothing = 'Nothing interesting happens.';
        const r = await simulate(fletching, {
            params: feathered,
            timeline: withFeathers.series(60, (w, i) => {
                if (i >= 5) return made(w, 2, 0).message(nothing);
                if (i >= 4) return made(w, 2, 0);
                return i === 1 || i === 2 ? menu(w) : w;
            }),
        });
        expect(r.result.reason).toBe(`attach-feathers: 3 feather attempts failed (last game message: ${nothing})`);
        expect(r.sends.filter(s => s === ATTACH)).toHaveLength(3);
        expect(logged(r)).toEqual(Array(3).fill(`attaching feathers failed: ${nothing}`));
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(fletching, { params, timeline: w.series(1) })).result.reason;

describe('fletching: preflight', () => {
    test('needs a knife, the logs and, for the product, the level', async () => {
        expect(await refusal(kit.inv('Knife', 0))).toBe('preflight: no knife in inventory');
        expect(await refusal(kit.inv('Logs', 0))).toBe('preflight: no "Logs" in inventory');
        expect(await refusal(kit, { ...PARAMS, product: 'short bow' })).toBe(
            'preflight: short bow from Logs needs fletching 5, bot has 1',
        );
    });

    test('refuses a product the logs cannot make', async () => {
        const oak = kit.inv('Logs', 0).inv('Oak logs', 1, { id: 1521 });
        expect(await refusal(oak, { product: 'arrow shaft', logs: 'Oak logs' })).toBe(
            'preflight: arrow shafts need normal "Logs"',
        );
        expect(await refusal(kit, { ...PARAMS, product: 'crossbow' })).toBe(
            'preflight: unknown product "crossbow" (arrow shaft, short bow, long bow)',
        );
    });

    test('refuses a different log type in the inventory', async () => {
        const mixed = kit.inv('Oak logs', 1, { id: 1521 });
        expect(await refusal(mixed)).toBe(
            'preflight: inventory also holds other logs than "Logs"; the task works one log type at a time',
        );
    });

    test('attachFeathers needs the arrow shaft product and feathers', async () => {
        expect(
            await refusal(kit.skill('Fletching', 5, 0), { ...PARAMS, product: 'short bow', attachFeathers: true }),
        ).toBe('preflight: attachFeathers only works with product "arrow shaft"');
        expect(await refusal(kit, { ...PARAMS, attachFeathers: true })).toBe(
            'preflight: attachFeathers set but no Feathers in inventory',
        );
    });
});

describe('fletching: guards', () => {
    test('fails at once when attacked', async () => {
        const r = await simulate(fletching, {
            params: PARAMS,
            timeline: kit.series(10, (w, i) => w.player({ inCombat: i >= 3 })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('attacked: attacked while fletching at (3222,3218)');
    });

    test('low HP mid-batch aborts it and eats, then the batch is made again', async () => {
        const r = await simulate(fletching, {
            params: PARAMS,
            // The menu answered at tick 1 and HP low at 2, mid-wait for the xp; the eat takes tick 3, the second
            // batch's menu is open at 5-7 and it is made at 8.
            timeline: kit
                .inv('Logs', 1)
                .inv('Shrimps', 1)
                .series(14, (w, i) => {
                    const hurt = w.player({ hp: i === 2 ? 4 : 10 });
                    if (i >= 8) return made(hurt, 1, 0);
                    return [1, 2, 5, 6, 7].includes(i) ? menu(hurt) : hurt;
                }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE, 'Eat Shrimps', USE, MAKE]);
    });

    test('a level-up dialog mid-batch is cleared and the batch still counts', async () => {
        const r = await simulate(fletching, {
            params: PARAMS,
            timeline: kit.inv('Logs', 1).series(20, (w, i) => {
                const level = w.dialog({ options: ['Click here to continue'] });
                if (i >= 4) return i <= 5 ? level.inv('Logs', 0) : made(w, 1, 0);
                return i === 1 || i === 2 ? menu(w) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE, 'continue dialog']);
        expect(logged(r)).toEqual([]);
    });
});
