import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const MAKE10 = 'fletch 15 Arrow Shafts x10';
const MEMBERS = "You need to be on a members' world to gain experience in Fletching.";
const PARAMS = { product: 'arrow shaft', logs: 'Logs', batch: 1 as const };
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

const UNSTRUNG = 58;
const STRUNG = 847;
const STRING = 1777;
const OAK_LONGBOW_U = 56;
const WILLOW_LOGS = 1519;

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(fletching, { params, timeline: w.series(1) })).result.reason;

describe('fletching: stringing', () => {
    const WILLOW = { product: 'long bow', logs: 'Willow logs', batch: 1 as const, string: true };
    const USE_STRING = 'use Bow string on Willow longbow';
    /** Unstrung and strung bows share a name in the game; the builder cannot hold both, so they get stand-in names. */
    const NAMES: Record<string, string> = { Unstrung: 'Willow longbow', Strung: 'Willow longbow' };
    /** The built state at tick `t`, the stand-in names given their real one. */
    const snap = (w: World, t: number) => {
        const r = w.tick(t).build();
        return { ...r, inventory: r.inventory.map(i => ({ ...i, name: NAMES[i.name] ?? i.name })) };
    };
    const base = world().skill('Fletching', 40, 0).inv('Knife', 1);
    /** `unstrung` bows and `strings` held, `strung` bows done (each worth 1,037 xp). */
    const held = (unstrung: number, strings: number, strung = 0) =>
        base
            .inv('Unstrung', unstrung, { id: UNSTRUNG })
            .inv('Strung', strung, { id: STRUNG })
            .inv('Bow string', strings, { id: STRING })
            .skill('Fletching', 40, 1037 * strung);
    /** One bow strung every 2 ticks from tick 1, up to `max`. */
    const stringing = (unstrung: number, strings: number, max = unstrung, edit = (w: World, _t: number) => w) =>
        Array.from({ length: 40 }, (_, t) => {
            const n = Math.min(Math.floor((t + 1) / 2), max);
            return snap(edit(held(unstrung - n, strings - n, n), t), t);
        });

    test('uses a bow string on each unstrung bow, with no logs or knife needed', async () => {
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: stringing(3, 3, 3, w => w.inv('Knife', 0)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Willow logs left to fletch');
        expect(r.sends).toEqual([USE_STRING, USE_STRING, USE_STRING]);
        expect(r.result.xpGained).toEqual({ Fletching: 3111 });
        expect(logged(r)).toEqual([]);
    });

    test('stops when the strings run out and says how many bows are left', async () => {
        const r = await simulate(fletching, { params: WILLOW, timeline: stringing(3, 1, 1) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Willow logs left to fletch; 2 unstrung bows left, no Bow string');
        expect(r.sends).toEqual([USE_STRING]);
    });

    test('stops when the bows run out with strings left over', async () => {
        const r = await simulate(fletching, { params: WILLOW, timeline: stringing(1, 4, 1) });
        expect(r.result.reason).toBe('finish: no Willow logs left to fletch');
        expect(r.sends).toEqual([USE_STRING]);
    });

    test('strings only the product bows: a strung bow of the same name and other unstrung bows are left alone', async () => {
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: stringing(1, 2, 1, w => w.inv('Oak longbow', 1, { id: OAK_LONGBOW_U })),
        });
        expect(r.sends).toEqual([USE_STRING]);
    });

    test('cuts every log first, then strings them', async () => {
        const cutAt = 4;
        const timeline = Array.from({ length: 40 }, (_, t) => {
            const cutDone = t >= cutAt;
            const n = cutDone ? Math.min(Math.floor((t - cutAt + 1) / 2), 1) : 0;
            let w = base
                .inv('Willow logs', cutDone ? 0 : 1, { id: WILLOW_LOGS })
                .inv('Bow string', 1 - n, { id: STRING });
            if (cutDone) w = w.inv('Unstrung', 1 - n, { id: UNSTRUNG }).inv('Strung', n, { id: STRUNG });
            w = w.skill('Fletching', 40, (cutDone ? 1037 : 0) + n * 1037);
            if (t === 1 || t === 2) w = w.dialog({ options: MENU });
            return snap(w, t);
        });
        const r = await simulate(fletching, { params: WILLOW, timeline });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['use Knife on Willow logs', 'fletch Long Bow', USE_STRING]);
        expect(r.result.xpGained).toEqual({ Fletching: 2074 });
    });

    test('three attempts the game answers with nothing happening fail the run with the last game message', async () => {
        const nothing = 'Nothing interesting happens.';
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: Array.from({ length: 60 }, (_, t) =>
                snap(t >= 1 ? held(2, 2).tick(t).message(nothing) : held(2, 2), t),
            ),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`string: 3 stringing attempts failed (last game message: ${nothing})`);
        expect(r.sends.filter(s => s === USE_STRING)).toHaveLength(3);
        expect(logged(r)).toEqual(Array(3).fill(`stringing failed: ${nothing}`));
    });

    test('a success in between resets the count', async () => {
        const nothing = 'Nothing interesting happens.';
        // Two refusals, a bow strung, two more refusals, a bow strung: never three in a row.
        const state = (t: number) => {
            const n = t >= 12 ? 2 : t >= 6 ? 1 : 0;
            const refused = (t >= 1 && t <= 2) || (t >= 7 && t <= 8);
            return snap(
                refused
                    ? held(2 - n, 2 - n, n)
                          .tick(t)
                          .message(nothing)
                    : held(2 - n, 2 - n, n),
                t,
            );
        };
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: Array.from({ length: 30 }, (_, t) => state(t)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s === USE_STRING).length).toBeGreaterThanOrEqual(4);
    });

    test('a level-up dialog while stringing is cleared and the bow still counts', async () => {
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: stringing(2, 2, 2, (w, t) => (t === 2 ? w.dialog({ options: ['Click here to continue'] }) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('continue dialog');
    });

    test('low HP while stringing eats, then carries on', async () => {
        const r = await simulate(fletching, {
            params: WILLOW,
            timeline: stringing(2, 2, 2, (w, t) => w.inv('Shrimps', t >= 3 ? 0 : 1).player({ hp: t === 1 ? 4 : 10 })),
        });
        expect(r.sends).toContain('Eat Shrimps');
        expect(r.result.status).toBe('done');
    });
});

describe('fletching: preflight', () => {
    test('string needs a bow product, strings and the level', async () => {
        const hold = kit
            .skill('Fletching', 40, 0)
            .inv('Willow logs', 1, { id: WILLOW_LOGS })
            .inv('Bow string', 1, { id: STRING });
        const p = { product: 'long bow', logs: 'Willow logs', string: true };
        expect(await refusal(hold, p)).not.toStartWith('preflight');
        expect(await refusal(hold.inv('Bow string', 0), p)).toBe(
            'preflight: string set but no Bow string in inventory',
        );
        expect(await refusal(hold, { ...p, product: 'arrow shaft' })).toBe(
            'preflight: arrow shafts need normal "Logs"',
        );
        expect(await refusal(hold.skill('Fletching', 39, 0), p)).toBe(
            'preflight: long bow from Willow logs needs fletching 40, bot has 39',
        );
        expect(await refusal(kit.inv('Bow string', 1, { id: STRING }), { ...PARAMS, string: true })).toBe(
            'preflight: string only works with product "short bow" or "long bow"',
        );
    });

    test('with string and unstrung bows held, no logs and no knife are needed; with neither, the logs are the refusal', async () => {
        const bows = world()
            .skill('Fletching', 40, 0)
            .inv('Bow string', 1, { id: STRING })
            .inv('Unstrung', 1, { id: UNSTRUNG });
        const p = { product: 'long bow', logs: 'Willow logs', string: true };
        expect(await refusal(bows, p)).not.toStartWith('preflight');
        expect(await refusal(bows.inv('Unstrung', 0), p)).toBe('preflight: no knife in inventory');
        expect(await refusal(bows.inv('Unstrung', 0).inv('Knife', 1), p)).toBe(
            'preflight: no "Willow logs" in inventory',
        );
    });

    test('the unstrung bow ids match the server item pack', () => {
        const pack = readFileSync(join(import.meta.dir, '../../../server/content/pack/obj.pack'), 'utf8');
        const ids = Object.fromEntries(
            pack.split('\n').flatMap(l => (l.includes('=') ? [l.split('=').toReversed() as [string, string]] : [])),
        );
        expect(ids.unstrung_willow_longbow).toBe('58');
        expect(ids.willow_longbow).toBe('847');
        expect(ids.bow_string).toBe('1777');
        expect(ids.unstrung_longbow).toBe('48');
        expect(ids.unstrung_oak_longbow).toBe('56');
    });

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

    test('other log types in the inventory are not a refusal', async () => {
        const mixed = kit.inv('Oak logs', 1, { id: 1521 });
        expect(await refusal(mixed)).not.toStartWith('preflight');
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

describe('fletching: mixed logs', () => {
    test('uses the knife on the named logs only and finishes when they are gone, oak untouched', async () => {
        // The Oak logs sit in slot 1, ahead of the Logs: a first-log-of-any-type pick would use them.
        const oakFirst = world()
            .skill('Fletching', 1, 0)
            .inv('Knife', 1)
            .inv('Oak logs', 1, { id: 1521 })
            .inv('Logs', 2);
        const r = await simulate(fletching, { params: PARAMS, timeline: build(batches(2, oakFirst)) });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE, USE, MAKE]);
        const used = r.driver.commands.flatMap(c =>
            c.type === 'send' && c.action.type === 'useItemOnItem' ? [c.action.targetSlot] : [],
        );
        expect(used).toHaveLength(2);
        expect(used).not.toContain(1);
        expect(r.result.inventoryDelta['Oak logs']).toBeUndefined();
    });

    test('with only other logs held, the named type is a preflight refusal', async () => {
        const oakOnly = kit.inv('Logs', 0).inv('Oak logs', 2, { id: 1521 });
        expect(await refusal(oakOnly)).toBe('preflight: no "Logs" in inventory');
    });
});

describe('fletching: batches', () => {
    const BATCH = { ...PARAMS, batch: 10 as const };
    const five = kit.inv('Logs', 12);
    /** Ticks 1-2 menu, then one log cut every 2 ticks from tick 4; `stop` ticks of progress at most. */
    const cutting = (stop: number, level?: (w: World, i: number) => World) =>
        five.series(60, (w, i) => {
            const n = i < 4 ? 0 : Math.min(Math.floor((i - 4) / 2) + 1, stop);
            const state = i === 1 || i === 2 ? menu(w) : w;
            const cutW = state
                .inv('Logs', 12 - n)
                .inv('Arrow shaft', n, { id: SHAFT })
                .skill('Fletching', 1, 75 * n);
            return level ? level(cutW, i) : cutW;
        });

    test('one Make 10 click cuts ten logs; the batch is waited out and the rest is cut next', async () => {
        const r = await simulate(fletching, {
            params: BATCH,
            timeline: cutting(10),
            stops: [{ kind: 'xp', skill: 'Fletching', amount: 750 }],
        });
        expect(r.sends.slice(0, 2)).toEqual([USE, MAKE10]);
        expect(r.result.xpGained).toEqual({ Fletching: 750 });
        expect(r.result.inventoryDelta.Logs).toBe(-10);
    });

    test('a batch that stops early without a level-up ends after the stall and the next one resumes', async () => {
        const r = await simulate(fletching, {
            params: BATCH,
            timeline: cutting(3),
            stops: [{ kind: 'xp', skill: 'Fletching', amount: 225 }],
        });
        expect(r.sends.slice(0, 2)).toEqual([USE, MAKE10]);
        expect(r.result.xpGained).toEqual({ Fletching: 225 });
        expect(r.sends.filter(s => s === USE).length).toBeGreaterThanOrEqual(1);
    });

    test('low HP mid-batch aborts it and eats, then the next cut step finishes the remaining logs', async () => {
        const r = await simulate(fletching, {
            params: BATCH,
            // Menu at 1-2, the first log cut at 4, HP low at 5 (mid-batch); the eat takes tick 6, the second
            // click's menu is open at 8-9 and the last log is cut at 11.
            timeline: kit
                .inv('Logs', 2)
                .inv('Shrimps', 1)
                .series(30, (w, i) => {
                    const hurt = w.player({ hp: i === 5 ? 4 : 10 });
                    if (i >= 11) return made(hurt, 2, 0);
                    if (i >= 4) return [8, 9].includes(i) ? menu(made(hurt, 1, 1)) : made(hurt, 1, 1);
                    return i === 1 || i === 2 ? menu(hurt) : hurt;
                }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        expect(r.sends).toEqual([USE, MAKE10, 'Eat Shrimps', USE, MAKE10]);
    });

    test('a level-up ends the batch at once and the dialog is cleared', async () => {
        const r = await simulate(fletching, {
            params: BATCH,
            timeline: cutting(2, (w, i) =>
                i >= 6 ? w.skill('Fletching', 2, 200).dialog({ options: ['Click here to continue'] }) : w,
            ),
            stops: [{ kind: 'xp', skill: 'Fletching', amount: 150 }],
        });
        expect(r.sends.slice(0, 2)).toEqual([USE, MAKE10]);
    });

    test('with fewer logs than the batch, it ends when the logs are gone', async () => {
        const r = await simulate(fletching, { params: BATCH, timeline: build(batches(2)) });
        expect(r.result.reason).toBe('finish: no Logs left to fletch');
        // One click covers both logs: the second is cut while the batch is waited out.
        expect(r.sends).toEqual([USE, MAKE10]);
    });
});
