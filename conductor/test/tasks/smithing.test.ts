import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { SMITHING_INTERFACE } from '../../actions/dismiss';
import { TICK_MS } from '../../lib/util';
import { SMELT_MAX_TICKS, SMITH_MAX_TICKS, type SmithingProduct, smithingProduct } from '../../actions/smith';
import { WALK_MAX_TICKS, walkBudgetTicks } from '../../actions/walk';
import { stepBudgetTicks } from '../../lib/task';
import smithing, {
    ATTEMPT_SILENT_TICKS,
    FAIL_LIMIT,
    OP_MAX_TICKS,
    PRODUCTS,
    STATION_WALK_TICKS,
} from '../../tasks/smithing';
import { fakePaths } from '../paths';
import { smithyReact, walking } from '../react';
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
/** No route anywhere; each walk asks it twice (a retry a tick later). */
const blocked = () => fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' }));
/** The run's result when preflight refuses `params` on `w`. */
const refusal = async (params: unknown, w: World) =>
    (await simulate(smithing, { params, timeline: w.series(1) })).result;
/** `xs` `n` times over, in order. */
const times = <T>(n: number, ...xs: T[]): T[] => Array.from({ length: n }, () => xs).flat();
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });
/** A bot that walks one tile a tick, where `walking` runs it two: each tick's second step is refused. */
const crawl = () => {
    let movedAt = -1;
    return (_from: unknown, _to: unknown, s: { tick: number }) => {
        if (s.tick === movedAt) return true;
        movedAt = s.tick;
        return false;
    };
};

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

    test('a furnace further than 2 tiles is walked to first', async () => {
        const far = ores(1).player({ at: { x: FURNACE.x + 12, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: far.series(1),
            react: walking(smithyReact(BRONZE, MENU)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends[0]).toBe(`walk to (${FURNACE.x}, ${FURNACE.z})`);
    });

    test('a reachable furnace within 8 tiles is used directly: no walk to the wrong side of a wall', async () => {
        const near = ores(1).player({ at: { x: FURNACE.x + 5, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: near.series(1),
            react: walking(smithyReact(BRONZE, MENU)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends[0]).toBe(OPEN_MENU);
        expect(r.sends.some(m => m.startsWith('walk to'))).toBe(false);
    });

    test('a furnace at +5 that is not reachable is still walked to', async () => {
        const near = world()
            .player({ at: { x: FURNACE.x + 5, z: FURNACE.z } })
            .skill('Smithing', 1, 0)
            .loc('Furnace', FURNACE.x, FURNACE.z, { id: 2781, options: ['Smelt'], reachable: false })
            .inv('Copper ore', 1)
            .inv('Tin ore', 1);
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: near.series(1),
            react: walking(smithyReact(BRONZE, MENU)),
        });
        expect(r.sends[0]).toBe(`walk to (${FURNACE.x}, ${FURNACE.z})`);
    });

    test('a reachable furnace at +9 is walked to', async () => {
        const far = ores(1).player({ at: { x: FURNACE.x + 9, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: far.series(1),
            react: walking(smithyReact(BRONZE, MENU)),
        });
        expect(r.sends[0]).toBe(`walk to (${FURNACE.x}, ${FURNACE.z})`);
    });

    test('a direct attempt that failed is retried after a walk, and the shortcut returns after a success', async () => {
        let opens = 0;
        const near = ores(2).player({ at: { x: FURNACE.x + 5, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: near.series(1),
            react: walking(smithyReact(BRONZE, MENU)),
            respond: a =>
                a.type === 'interactLoc' && ++opens === 1 ? { success: false, message: 'blocked' } : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.slice(0, 3)).toEqual([OPEN_MENU, `walk to (${FURNACE.x}, ${FURNACE.z})`, OPEN_MENU]);
        expect(r.sends.filter(m => m.startsWith('walk to'))).toHaveLength(1);
        expect(r.result.inventoryDelta['Bronze bar']).toBe(2);
    });

    test('a retry walk that fails sends the next attempt direct again', async () => {
        let opens = 0;
        const near = ores(1).player({ at: { x: FURNACE.x + 5, z: FURNACE.z } });
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: near.series(1),
            pathfinder: blocked(),
            react: smithyReact(BRONZE, MENU),
            respond: a =>
                a.type === 'interactLoc' && ++opens === 1 ? { success: false, message: 'blocked' } : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(m => m === OPEN_MENU)).toHaveLength(2);
        expect(r.sends.some(m => m.startsWith('walk to'))).toBe(false);
    });

    test('four walks to the furnace that fail in a row fail the run', async () => {
        const paths = blocked();
        const far = ores(1).player({ at: { x: FURNACE.x + 12, z: FURNACE.z } });
        const r = await simulate(smithing, { params: SMELT_PARAMS, timeline: far.series(1), pathfinder: paths });
        expect(r.result.reason).toBe(
            `smelt: 4 smelts in a row failed (last: Cannot reach Furnace: No path to (${FURNACE.x}, ${FURNACE.z}) from (${FURNACE.x + 12}, ${FURNACE.z}): blocked)`,
        );
        expect(paths.queries).toHaveLength(4 * 2);
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
            react: walking(smithyReact(null, MENU)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('smelt: 4 smelts in a row used no ore (last: Smelting timed out)');
        // The first failure sends the next attempt to the furnace's side, one walk.
        expect(r.sends).toEqual([
            OPEN_MENU,
            CLICK_BRONZE,
            `walk to (${FURNACE.x}, ${FURNACE.z})`,
            ...times(3, OPEN_MENU, CLICK_BRONZE),
        ]);
        expect(logged(r)).toEqual(times(4, 'smelt failed: Smelting timed out'));
    });

    test('a smelt in between resets the failure count', async () => {
        // The first three Smelt options and the fifth to seventh are refused: never four in a row.
        let opens = 0;
        const refused = new Set([1, 2, 3, 5, 6, 7]);
        const r = await simulate(smithing, {
            params: SMELT_PARAMS,
            timeline: ores(2).series(1),
            react: walking(smithyReact(BRONZE, MENU)),
            respond: a =>
                a.type === 'interactLoc' && refused.has(++opens) ? { success: false, message: 'blocked' } : undefined,
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

describe('smithing: the step budget', () => {
    const budget = stepBudgetTicks(smithing.stepTimeoutMs ?? 0);

    test('the walk to a station leaves the step room for the longest op, and still crosses the view', () => {
        expect(OP_MAX_TICKS).toBe(Math.max(SMELT_MAX_TICKS, SMITH_MAX_TICKS));
        expect(STATION_WALK_TICKS + OP_MAX_TICKS).toBeLessThanOrEqual(budget);
        expect(STATION_WALK_TICKS).toBeLessThan(WALK_MAX_TICKS);
        // A station 15 tiles off (the edge of the client's view) gets its full walk budget.
        expect(STATION_WALK_TICKS).toBeGreaterThanOrEqual(walkBudgetTicks(15));
    });

    test('the watchdog outlasts FAIL_LIMIT attempts that change nothing, a walk that never moves included', () => {
        expect(smithing.stuckAfterMs).toBeGreaterThan(FAIL_LIMIT * ATTEMPT_SILENT_TICKS * TICK_MS);
        expect(ATTEMPT_SILENT_TICKS).toBeGreaterThan(STATION_WALK_TICKS);
    });

    test('a walk that would arrive too late to smith in the step is cut short, and the next run finishes it', async () => {
        // 202 tiles at a tile a tick: uncapped (WALK_MAX_TICKS) the walk arrives at tick 200 and the
        // smith runs the step past its 225 ticks (stuck). Capped, it stops at STATION_WALK_TICKS, the step
        // counts a failed attempt, and the next run walks the rest and smiths.
        const start = { x: ANVIL.x + 202, z: ANVIL.z };
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(1).player({ at: start }).series(1),
            react: walking(smithyReact(null), crawl()),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('smith: 4 smiths in a row failed (last: Smithing timed out)');
        const stoppedAt = start.x - STATION_WALK_TICKS;
        expect(logged(r)).toEqual([
            `walk to the anvil failed: Walk to (${ANVIL.x}, ${ANVIL.z}) ran out of its ${STATION_WALK_TICKS} ticks at (${stoppedAt}, ${ANVIL.z})`,
            ...times(3, 'smith failed: Smithing timed out'),
        ]);
        expect(r.result.stepRuns.smith).toBe(4);
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
        const far = bars(1).player({ at: { x: ANVIL.x + 12, z: ANVIL.z } });
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: far.series(1),
            react: walking(smithyReact(DAGGER)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends[0]).toBe(`walk to (${ANVIL.x}, ${ANVIL.z})`);
        const paths = blocked();
        const stuck = await simulate(smithing, { params: SMITH_PARAMS, timeline: far.series(1), pathfinder: paths });
        expect(stuck.result.reason).toBe(
            `smith: can't reach the anvil (No path to (${ANVIL.x}, ${ANVIL.z}) from (${ANVIL.x + 12}, ${ANVIL.z}): blocked)`,
        );
        expect(paths.queries).toHaveLength(4 * 2);
    });

    test('a reachable anvil at +5 is used directly: no walk', async () => {
        const near = bars(1).player({ at: { x: ANVIL.x + 5, z: ANVIL.z } });
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: near.series(1),
            react: walking(smithyReact(DAGGER)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends[0]).toBe(USE_BAR);
        expect(r.sends.some(m => m.startsWith('walk to'))).toBe(false);
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

const dropped = (r: Simulation) => r.sends.filter(x => x.startsWith('drop'));

describe('smithing: onDone', () => {
    const WORK = {
        takes: [{ name: 'Bronze bar', count: 1 }],
        gives: { name: 'Bronze dagger', id: 1205 },
        xp: 125,
    };
    const DROP_PARAMS = { ...SMITH_PARAMS, onDone: 'drop' };

    test('keep (the default) leaves the products in the inventory', async () => {
        const r = await simulate(smithing, {
            params: SMITH_PARAMS,
            timeline: bars(2).series(1),
            react: smithyReact(WORK),
        });
        expect(dropped(r)).toEqual([]);
        expect(r.result.inventoryDelta).toEqual({ 'Bronze bar': -2, 'Bronze dagger': 2 });
    });

    test('drop drops each product once the bars are used up, then is done', async () => {
        const r = await simulate(smithing, {
            params: DROP_PARAMS,
            timeline: bars(2).series(1),
            react: smithyReact(WORK),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: out of Bronze bars for dagger');
        expect(r.sends).toEqual([
            USE_BAR,
            CLICK_DAGGER,
            USE_BAR,
            CLICK_DAGGER,
            'drop Bronze dagger',
            'drop Bronze dagger',
        ]);
        expect(r.result.inventoryDelta).toEqual({ 'Bronze bar': -2 });
    });

    test('drop leaves bars, hammer, runes and other items alone, and does not drop while bars remain', async () => {
        const r = await simulate(smithing, {
            params: { ...DROP_PARAMS, product: 'platebody' },
            timeline: bars(7).skill('Smithing', 18, 0).inv('Nature rune', 50).inv('Bronze dagger', 1).series(1),
            react: smithyReact({
                takes: [{ name: 'Bronze bar', count: 5 }],
                gives: { name: 'Bronze platebody', id: PLATEBODY },
                xp: 625,
            }),
        });
        expect(dropped(r)).toEqual(['drop Bronze platebody']);
        const inv = r.driver.state().inventory.map(i => i.name);
        expect(inv).toContain('Bronze bar');
        expect(inv).toContain('Hammer');
        expect(inv).toContain('Nature rune');
        expect(inv).toContain('Bronze dagger');
        expect(inv).not.toContain('Bronze platebody');
    });

    test('three failed drops in a row retry, and a fourth that works finishes the run', async () => {
        const react = smithyReact(WORK);
        let drops = 0;
        const r = await simulate(smithing, {
            params: DROP_PARAMS,
            timeline: bars(1).series(1),
            react: (a, s) => (a.type === 'dropItem' && ++drops <= 3 ? undefined : react(a, s)),
        });
        expect(r.result.status).toBe('done');
        expect(dropped(r)).toEqual(Array(4).fill('drop Bronze dagger'));
    });

    test('four failed drops in a row fail the run, naming the last one', async () => {
        const react = smithyReact(WORK);
        const r = await simulate(smithing, {
            params: DROP_PARAMS,
            timeline: bars(1).series(1),
            react: (a, s) => (a.type === 'dropItem' ? undefined : react(a, s)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('4 drops of the products in a row failed (last: Drop of Bronze dagger');
        expect(dropped(r)).toHaveLength(4);
    });

    test('drops the game-named Adamnt warhammer', async () => {
        const r = await simulate(smithing, {
            params: { ...DROP_PARAMS, bar: 'adamant', product: 'warhammer' },
            timeline: smithy(world()).skill('Smithing', 99, 0).inv('Adamantite bar', 3, { id: 2361 }).series(1),
            react: smithyReact({
                takes: [{ name: 'Adamantite bar', count: 3 }],
                gives: { name: 'Adamnt warhammer', id: 1345 },
                xp: 1000,
            }),
        });
        expect(r.result.status).toBe('done');
        expect(dropped(r)).toEqual(['drop Adamnt warhammer']);
    });

    test('preflight refuses drop in smelt mode and a product already in the inventory', async () => {
        const smelt = await refusal(
            { ...SMELT_PARAMS, onDone: 'drop' },
            smelter(world()).inv('Copper ore', 1).inv('Tin ore', 1),
        );
        expect(smelt.reason).toBe(`preflight: onDone 'drop' only applies to mode 'smith'`);
        const held = await refusal(DROP_PARAMS, bars(1).inv('Bronze dagger', 1));
        expect(held.reason).toBe(
            `preflight: onDone 'drop' would also drop the Bronze dagger already in the inventory: bank it first`,
        );
    });
});
