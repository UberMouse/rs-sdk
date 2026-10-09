import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { SMITHING_INTERFACE } from '../../actions/dismiss';
import { TICK_MS } from '../../lib/util';
import { type SmithingProduct, smithingProduct } from '../../actions/smith';
import smithing, { PRODUCTS } from '../../tasks/smithing';
import { smithyReact } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const FURNACE = { x: 3226, z: 3255 };
const ANVIL = { x: 3188, z: 3421 };
const IRON_ORE = 440;
const COAL = 453;
const PLATEBODY = 1117;

/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const failed = { success: false, message: 'blocked' };
/** A walkTo fake that records its calls and answers `result`. */
const walker = (result = { success: true, message: 'ok' }) => {
    const walks: unknown[][] = [];
    const walkTo = async (...args: unknown[]) => {
        walks.push(args);
        return result;
    };
    return { walks, bot: { walkTo } };
};
/** The run's result when preflight refuses `params` on `w`. */
const refusal = async (params: unknown, w: World) =>
    (await simulate(smithing, { params, timeline: w.series(1) })).result;
/** `xs` `n` times over, in order. */
const times = <T>(n: number, ...xs: T[]): T[] => Array.from({ length: n }, () => xs).flat();
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });

// The furnace's smelting menu as the client publishes it (see the smith op tests).
const BAR_LABELS = ['Bronze', 'Iron', 'Silver', 'Steel', 'Gold', 'Mithril', 'Adamant', 'Rune'];
const MENU = BAR_LABELS.flatMap(b => [`Smelt X ${b}`, `Smelt 10 ${b}`, `Smelt 5 ${b}`, `\\n\\n\\n\\n${b}`]);
const BRONZE = {
    takes: [
        { name: 'Copper ore', count: 1 },
        { name: 'Tin ore', count: 1 },
    ],
    gives: { name: 'Bronze bar', id: 2349 },
    xp: 62,
};
const smelter = (w: World) =>
    w
        .player({ at: { x: FURNACE.x + 2, z: FURNACE.z } })
        .skill('Smithing', 1, 0)
        .loc('Furnace', FURNACE.x - 1, FURNACE.z + 1, { id: 2785 })
        .loc('Furnace', FURNACE.x, FURNACE.z, { id: 2781, options: ['Smelt'] });
const ores = (n: number) => smelter(world()).inv('Copper ore', n).inv('Tin ore', n);
const SMELT_PARAMS = { mode: 'smelt', bar: 'bronze' };
const OPEN_MENU = 'Smelt Furnace';
const CLICK_BRONZE = 'smelt Bronze';
const CLOSE_MENU = 'close smelting menu';

const DAGGER = { takes: [{ name: 'Bronze bar', count: 1 }], gives: { name: 'Bronze dagger', id: 1205 }, xp: 125 };
const smithy = (w: World) =>
    w
        .player({ at: { x: ANVIL.x + 1, z: ANVIL.z } })
        .skill('Smithing', 1, 0)
        .inv('Hammer', 1)
        .loc('Anvil', ANVIL.x, ANVIL.z, { id: 2783 });
const bars = (n: number) => smithy(world()).inv('Bronze bar', n);
const SMITH_PARAMS = { mode: 'smith', bar: 'bronze', product: 'dagger' };
const USE_BAR = 'use Bronze bar on Anvil';
const CLICK_DAGGER = 'smith dagger';
const CLOSE_ANVIL = 'close smithing interface';

describe('smithing: smelt', () => {
    test('smelts one bar per action until the ore runs out, then is done', async () => {
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: ores(2).series(1),
            react: smithyReact(BRONZE, MENU),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: out of ore for Bronze bars');
        expect(r.sends).toEqual([OPEN_MENU, CLICK_BRONZE, OPEN_MENU, CLICK_BRONZE]);
        expect(r.steps).toEqual(['smelt', 'finish']);
        expect(r.result.inventoryDelta).toEqual({ 'Copper ore': -2, 'Tin ore': -2, 'Bronze bar': 2 });
        expect(r.result.xpGained.Smithing).toBe(124);
        // Only failures are logged; the bars made are in the result.
        expect(logged(r)).toEqual([]);
    });

    test('a furnace further than 2 tiles is walked to first (a bot.walkTo stopgap)', async () => {
        const { walks, bot } = walker();
        const far = ores(1).player({ at: { x: FURNACE.x + 6, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: far.series(1),
            react: smithyReact(BRONZE, MENU),
            bot,
        });
        expect(r.result.status).toBe('done');
        expect(walks).toEqual([[FURNACE.x, FURNACE.z, 2]]);
    });

    test('four walks to the furnace that fail in a row fail the run', async () => {
        const { walks, bot } = walker(failed);
        const far = ores(1).player({ at: { x: FURNACE.x + 6, z: FURNACE.z } });
        const r = await simulate(smithing, { params: SMELT_PARAMS, timeline: far.series(1), bot });
        expect(r.result.reason).toBe('smelt: 4 smelts in a row failed (last: Cannot reach Furnace: blocked)');
        expect(walks).toHaveLength(4);
        expect(r.sends).toEqual([]);
    });

    test('only an option-less decoy furnace in view fails the run on the fourth look', async () => {
        const decoy = world()
            .skill('Smithing', 1, 0)
            .inv('Copper ore', 1)
            .inv('Tin ore', 1)
            .loc('Furnace', FURNACE.x, FURNACE.z, { id: 2785 });
        const r = await simulate(smithing, { params: SMELT_PARAMS, timeline: decoy.series(1) });
        expect(r.result.reason).toBe('smelt: no furnace with a Smelt option nearby (pass `area` at the furnace)');
        expect(r.sends).toEqual([]);
    });

    test('four smelts in a row the furnace never acts on fail the run as "used no ore", before the watchdog', async () => {
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: ores(1).series(1),
            react: smithyReact(null, MENU),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('smelt: 4 smelts in a row used no ore (last: Smelting timed out)');
        expect(r.sends).toEqual(times(4, OPEN_MENU, CLICK_BRONZE));
        expect(logged(r)).toEqual(times(4, 'smelt failed: Smelting timed out'));
    });

    test('a smelt in between resets the failure count', async () => {
        // The first three Smelt options and the fifth to seventh are refused: never four in a row.
        let opens = 0;
        const refused = new Set([1, 2, 3, 5, 6, 7]);
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: ores(2).series(1),
            react: smithyReact(BRONZE, MENU),
            respond: a => (a.type === 'interactLoc' && refused.has(++opens) ? failed : undefined),
        });
        expect(r.result.reason).toBe('finish: out of ore for Bronze bars');
        expect(r.result.inventoryDelta['Bronze bar']).toBe(2);
        expect(logged(r).filter(m => String(m).startsWith('smelt failed'))).toHaveLength(6);
    });

    test('iron ore with coal at Smithing 30 smelts iron: the menu names the bar, so the coal is kept', async () => {
        const iron = smelter(world())
            .skill('Smithing', 30, 13_363)
            .inv('Iron ore', 1, { id: IRON_ORE })
            .inv('Coal', 2, { id: COAL });
        const work = { takes: [{ name: 'Iron ore', count: 1 }], gives: { name: 'Iron bar', id: 2351 }, xp: 125 };
        const r = await simulate(smithing, {
            params: { mode: 'smelt', bar: 'iron' },
            timeline: iron.series(1),
            react: smithyReact(work, MENU),
        });
        expect(r.result.reason).toBe('finish: out of ore for Iron bars');
        expect(r.sends).toEqual([OPEN_MENU, 'smelt Iron']);
        expect(r.result.inventoryDelta).toEqual({ 'Iron ore': -1, 'Iron bar': 1 });
    });

    test('preflight refuses a bar above the level and too little ore', async () => {
        const iron = await refusal(
            { mode: 'smelt', bar: 'iron' },
            smelter(world()).inv('Iron ore', 1, { id: IRON_ORE }),
        );
        expect(iron.status).toBe('failed');
        expect(iron.reason).toBe('preflight: Iron bar needs smithing 15, bot has 1');
        const tinless = await refusal(SMELT_PARAMS, smelter(world()).inv('Copper ore', 2));
        expect(tinless.reason).toBe(
            'preflight: need at least 1 Copper ore and 1 Tin ore in inventory to smelt a Bronze bar',
        );
    });

    test('low HP with the menu open: the menu is closed, the bot eats, and the smelt starts again', async () => {
        // The menu shows at tick 1, the tick HP drops.
        const hurt = ores(1)
            .inv('Shrimps', 1)
            .series(30, (w, i) => w.player({ hp: i >= 1 && i < 3 ? 3 : 10 }));
        const r = await simulate(smithing, { params: SMELT_PARAMS, timeline: hurt, react: smithyReact(BRONZE, MENU) });
        expect(r.result.reason).toBe('finish: out of ore for Bronze bars');
        expect(r.sends).toEqual([OPEN_MENU, CLOSE_MENU, 'Eat Shrimps', OPEN_MENU, CLICK_BRONZE]);
        expect(r.result.inventoryDelta).toEqual({ 'Copper ore': -1, 'Tin ore': -1, 'Bronze bar': 1, Shrimps: -1 });
    });

    test('a level-up after a bar is cleared by the dialog guard and smelting goes on', async () => {
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: ores(2).series(30, (w, i) => (i === 2 || i === 3 ? levelUp(w) : w)),
            react: smithyReact(BRONZE, MENU),
        });
        expect(r.result.reason).toBe('finish: out of ore for Bronze bars');
        expect(r.sends).toEqual([OPEN_MENU, CLICK_BRONZE, 'continue dialog', OPEN_MENU, CLICK_BRONZE]);
        expect(r.result.stepRuns['interrupt:dialog']).toBe(1);
    });
});

describe('smithing: smith', () => {
    test("every product the task knows is one the smith op offers, keyed by the op's own name", () => {
        for (const name of Object.keys(PRODUCTS)) expect(smithingProduct(name)).toBe(name as SmithingProduct);
    });

    test('a product in another spelling passes preflight and is forged by the name the op knows', async () => {
        const work = {
            takes: [{ name: 'Bronze bar', count: 2 }],
            gives: { name: 'Bronze sq shield', id: 1173 },
            xp: 250,
        };
        const r = await simulate(smithing, {
            params: { ...SMITH_PARAMS, product: 'Square-shield' },
            timeline: bars(2).skill('Smithing', 8, 801).series(1),
            react: smithyReact(work),
        });
        expect(r.result.reason).toBe('finish: out of Bronze bars for Square-shield');
        expect(r.sends).toEqual([USE_BAR, 'smith sq shield']);
    });

    test('forges the product from the bars until they run out, then is done', async () => {
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(2).series(1),
            react: smithyReact(DAGGER),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: out of Bronze bars for dagger');
        expect(r.sends).toEqual([USE_BAR, CLICK_DAGGER, USE_BAR, CLICK_DAGGER]);
        expect(r.result.inventoryDelta).toEqual({ 'Bronze bar': -2, 'Bronze dagger': 2 });
        expect(r.result.xpGained.Smithing).toBe(250);
    });

    test('a product of several bars uses that many per item and stops when too few are left', async () => {
        const work = {
            takes: [{ name: 'Bronze bar', count: 5 }],
            gives: { name: 'Bronze platebody', id: PLATEBODY },
            xp: 625,
        };
        const r = await simulate(smithing, {
            params: { ...SMITH_PARAMS, product: 'platebody' },
            timeline: bars(7).skill('Smithing', 18, 7842).series(1),
            react: smithyReact(work),
        });
        expect(r.result.reason).toBe('finish: out of Bronze bars for platebody');
        expect(r.sends).toEqual([USE_BAR, 'smith platebody']);
        expect(r.result.inventoryDelta).toEqual({ 'Bronze bar': -5, 'Bronze platebody': 1 });
    });

    test('an anvil further than 2 tiles is walked to first; four failed walks fail the run', async () => {
        const far = bars(1).player({ at: { x: ANVIL.x + 6, z: ANVIL.z } });
        const ok = walker();
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: far.series(1),
            react: smithyReact(DAGGER),
            bot: ok.bot,
        });
        expect(r.result.status).toBe('done');
        expect(ok.walks).toEqual([[ANVIL.x, ANVIL.z, 2]]);
        const blocked = walker(failed);
        const stuck = await simulate(smithing, { params: SMITH_PARAMS, timeline: far.series(1), bot: blocked.bot });
        expect(stuck.result.reason).toBe("smith: can't reach the anvil (blocked)");
        expect(blocked.walks).toHaveLength(4);
    });

    test('no reachable anvil fails the run on the fourth look', async () => {
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: world()
                .skill('Smithing', 1, 0)
                .inv('Hammer', 1)
                .inv('Bronze bar', 1)
                .loc('Anvil', ANVIL.x, ANVIL.z, { id: 2783, reachable: false })
                .series(1),
        });
        expect(r.result.reason).toBe('smith: no reachable anvil nearby (pass `area` at the anvil)');
        expect(r.sends).toEqual([]);
    });

    test('four smiths in a row with no xp fail the run with the last reason, before the watchdog', async () => {
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(1).series(1),
            react: smithyReact(null),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('smith: 4 smiths in a row failed (last: Smithing timed out)');
        expect(r.sends).toEqual(times(4, USE_BAR, CLICK_DAGGER));
        expect(logged(r)).toEqual(times(4, 'smith failed: Smithing timed out'));
    });

    test('four interfaces that never open fail the run, each followed by a close in case it lands late', async () => {
        const r = await simulate(smithing, { params: SMITH_PARAMS, timeline: bars(1).series(1) });
        expect(r.result.reason).toBe('smith: 4 smiths in a row failed (last: Smithing interface did not open)');
        expect(r.sends).toEqual(times(4, USE_BAR, `${CLOSE_ANVIL} (open not confirmed)`));
    });

    test('the hammer gone mid-run fails at once', async () => {
        // The first smith checks for the hammer at tick 0; it is gone for the second.
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: [bars(2).build(), ...bars(2).inv('Hammer', 0).tick(1).series(5)],
            react: smithyReact(DAGGER),
        });
        expect(r.result.reason).toBe('smith: no hammer in inventory');
        expect(r.sends).toEqual([USE_BAR, CLICK_DAGGER]);
    });

    test('preflight refuses an unknown product, a product above the level, no hammer and too few bars', async () => {
        expect((await refusal({ ...SMITH_PARAMS, product: 'claws' }, bars(1))).reason).toStartWith(
            'preflight: unknown product "claws" (known: dagger, axe,',
        );
        expect((await refusal({ ...SMITH_PARAMS, product: 'platebody' }, bars(5))).reason).toBe(
            'preflight: bronze platebody needs smithing 18, bot has 1',
        );
        expect((await refusal(SMITH_PARAMS, bars(1).inv('Hammer', 0))).reason).toBe(
            'preflight: no hammer in inventory',
        );
        expect(
            (await refusal({ ...SMITH_PARAMS, product: 'scimitar' }, bars(1).skill('Smithing', 5, 388))).reason,
        ).toBe('preflight: scimitar needs 2 Bronze bar(s), bot has 1');
    });

    test('low HP with the anvil interface open: the interface is closed, the bot eats, and the smith starts again', async () => {
        const hurt = bars(1)
            .inv('Shrimps', 1)
            .series(30, (w, i) => w.player({ hp: i >= 1 && i < 3 ? 3 : 10 }));
        const r = await simulate(smithing, { params: SMITH_PARAMS, timeline: hurt, react: smithyReact(DAGGER) });
        expect(r.result.reason).toBe('finish: out of Bronze bars for dagger');
        expect(r.sends).toEqual([USE_BAR, CLOSE_ANVIL, 'Eat Shrimps', USE_BAR, CLICK_DAGGER]);
        // The interface guard never fired on the anvil's own interface.
        expect(r.result.stepRuns['interrupt:interface']).toBeUndefined();
    });

    test('a level-up after a dagger is cleared by the dialog guard and smithing goes on', async () => {
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(2).series(30, (w, i) => (i === 2 || i === 3 ? levelUp(w) : w)),
            react: smithyReact(DAGGER),
        });
        expect(r.result.reason).toBe('finish: out of Bronze bars for dagger');
        expect(r.sends).toEqual([USE_BAR, CLICK_DAGGER, 'continue dialog', USE_BAR, CLICK_DAGGER]);
    });

    test('a stop with the anvil interface open closes it on the way out', async () => {
        // The click is never acted on, so the interface stays open until the stop at tick 3.
        const ignored: BotAction['type'][] = ['clickComponentWithOption'];
        const react = smithyReact(DAGGER);
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(1).series(1),
            react: (a, s) => (ignored.includes(a.type) ? undefined : react(a, s)),
            stops: [{ kind: 'minutes', minutes: (3 * TICK_MS) / 60_000 }],
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([USE_BAR, CLICK_DAGGER, CLOSE_ANVIL]);
        const s = r.driver.state();
        expect(s.interface.isOpen && s.interface.interfaceId === SMITHING_INTERFACE).toBe(false);
    });
});
