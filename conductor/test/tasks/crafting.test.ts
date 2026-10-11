import { describe, expect, test } from 'bun:test';
import { SHAPE_MENU_TICKS } from '../../actions/pottery';
import crafting, { ATTEMPT_SILENT_TICKS, FAIL_LIMIT, OP_MAX_TICKS, STATION_WALK_TICKS } from '../../tasks/crafting';
import { stepBudgetTicks } from '../../lib/task';
import { consume } from '../react';
import { fakePaths } from '../paths';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { isSkillMenu } from '../../actions/dismiss';
import type { Effect } from '../../core/drivers/timeline';

const ID: Record<string, number> = {
    Clay: 434,
    'Soft clay': 1761,
    'Unfired pot': 1787,
    'Unfired pie dish': 1789,
    'Unfired bowl': 1791,
    'Bucket of water': 1929,
    Bucket: 1925,
    Pot: 1931,
    'Pie dish': 2313,
    Bowl: 1923,
};
const WHEEL = { x: 3087, z: 3409 };
const OVEN = { x: 3084, z: 3407 };
const MENU = ['Pot', 'Pie Dish', 'Bowl'].flatMap(p => ['Make X', 'Make 10', 'Make 5', `\\n\\n\\n\\n${p}`]);
const SHAPE_XP = 157;
const FIRE_XP = 157;
const SHAPES_AT = 2;
const FIRES_AT = 4;

const sent = (r: Simulation, prefix: string) => r.sends.filter(s => s.startsWith(prefix));

const station = world()
    .player({ at: { x: 3086, z: 3408 } })
    .skill('Crafting', 1, 0)
    .loc("Potter's Wheel", WHEEL.x, WHEEL.z)
    .loc('Pottery Oven', OVEN.x, OVEN.z, { options: ['Fire'] });

const count = (s: BotWorldState, name: string) =>
    s.inventory.filter(i => i.name.toLowerCase() === name.toLowerCase()).reduce((n, i) => n + i.count, 0);
/** `s` with `delta` more of `name`, as a new object so the effect never retires. */
const bump = (s: BotWorldState, name: string, delta: number) =>
    world(s)
        .inv(name, Math.max(0, count(s, name) + delta), { id: ID[name] })
        .build();
const gain = (s: BotWorldState, xp: number) => {
    const have = s.skills.find(k => k.name === 'Crafting')?.experience ?? 0;
    return world(s)
        .skill('Crafting', 1, have + xp)
        .build();
};

/** The make menu closed by a click; a level-up the script shows stays. */
const closed = (s: BotWorldState) => (isSkillMenu(s.dialog) ? world(s).dialog(false).build() : { ...s });

/**
 * The engine's pottery as the bot's sends change a static world: a soften swaps clay and a full
 * container for soft clay and an empty one; soft clay on the wheel opens the make menu, a click closes it
 * and SHAPES_AT ticks later the clay is an unfired item; an unfired item on the oven is fired (or
 * cracks, per `outcomes`) FIRES_AT ticks later. Every effect is relative to the scripted base, so they stack.
 */
function pottery(outcomes: boolean[] = []) {
    const queue = [...outcomes];
    return (action: BotAction, state: BotWorldState): Effect | undefined => {
        const tick = state.tick;
        const name = (slot: number) => state.inventory.find(i => i.slot === slot)?.name ?? '';
        if (action.type === 'useItemOnItem') {
            const water = /of water$/i.test(name(action.sourceSlot))
                ? name(action.sourceSlot)
                : name(action.targetSlot);
            return s =>
                world(bump(bump(bump(bump(s, 'Clay', -1), 'Soft clay', 1), water, -1), water.split(' ')[0] ?? '', 1))
                    .message('You now have some soft workable clay.')
                    .build();
        }
        if (action.type === 'useItemOnLoc' && name(action.itemSlot) === 'Soft clay')
            return s => (s.dialog.isOpen ? s : world(s).dialog({ options: MENU }).build());
        if (action.type === 'clickDialogOption' && [3, 7, 11].includes(action.optionIndex)) {
            const unfired = { 3: 'Unfired pot', 7: 'Unfired pie dish', 11: 'Unfired bowl' }[action.optionIndex] ?? '';
            return s =>
                tick + SHAPES_AT > s.tick
                    ? closed(s)
                    : gain(bump(bump(closed(s), 'Soft clay', -1), unfired, 1), SHAPE_XP);
        }
        if (action.type === 'useItemOnLoc' && /^unfired /i.test(name(action.itemSlot))) {
            const unfired = name(action.itemSlot);
            const cracks = queue.shift() ?? false;
            const fired = unfired.replace(/^unfired /i, '').replace(/^./, c => c.toUpperCase());
            return s => {
                if (tick + FIRES_AT > s.tick) return { ...s };
                const gone = bump(s, unfired, -1);
                return cracks ? gone : gain(bump(gone, fired, 1), FIRE_XP);
            };
        }
        if (action.type === 'closeModal') return s => (isSkillMenu(s.dialog) ? world(s).dialog(false).build() : s);
        return consume(action, state);
    };
}

const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const run = (w: World, params: object = {}, outcomes: boolean[] = []) =>
    simulate(crafting, { params, timeline: w.series(1), react: pottery(outcomes) });

const AREA = { area: { x: WHEEL.x, z: WHEEL.z, radius: 10 } };
const SOFT = station.inv('Soft clay', 2, { id: ID['Soft clay'] });
const SHAPE = ["use Soft clay on Potter's Wheel", 'shape Pot'];
const FIRE = 'fire Unfired pot in Pottery Oven';

describe('crafting: pottery', () => {
    test('shapes each soft clay and fires each unfired pot, then finishes', async () => {
        const r = await run(SOFT, { product: 'pot' });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: nothing left to craft');
        expect(r.sends).toEqual([...SHAPE, ...SHAPE, FIRE, FIRE]);
        expect(r.result.inventoryDelta).toEqual({ 'Soft clay': -2, Pot: 2 });
        expect(r.result.xpGained).toEqual({ Crafting: 2 * (SHAPE_XP + FIRE_XP) });
        expect(logged(r)).toEqual([]);
    });

    test('softens clay with a bucket of water first, one per clay', async () => {
        const r = await run(
            station.inv('Clay', 2, { id: ID['Clay'] }).inv('Bucket of water', 2, { id: ID['Bucket of water'] }),
            { fire: false },
        );
        expect(r.result.reason).toBe('finish: nothing left to craft');
        expect(r.sends).toEqual(['use Bucket of water on Clay', 'use Bucket of water on Clay', ...SHAPE, ...SHAPE]);
        expect(r.result.inventoryDelta).toEqual({ Clay: -2, 'Bucket of water': -2, Bucket: 2, 'Unfired pot': 2 });
        expect(logged(r)).toEqual([]);
    });

    test('fire false stops at the unfired product; an unfired one already held is not fired', async () => {
        const r = await run(SOFT.inv('Unfired pot', 1, { id: ID['Unfired pot'] }), { fire: false });
        expect(r.sends).toEqual([...SHAPE, ...SHAPE]);
        expect(r.result.inventoryDelta).toEqual({ 'Soft clay': -2, 'Unfired pot': 2 });
    });

    test('fires only: an unfired product in the inventory is enough', async () => {
        const r = await run(station.inv('Unfired pot', 1, { id: ID['Unfired pot'] }));
        expect(r.sends).toEqual([FIRE]);
        expect(r.result.inventoryDelta).toEqual({ 'Unfired pot': -1, Pot: 1 });
    });

    test('a cracked pot is not a failure', async () => {
        const r = await run(station.inv('Unfired pot', 2, { id: ID['Unfired pot'] }), {}, [true, false]);
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([FIRE, FIRE]);
        expect(r.result.inventoryDelta).toEqual({ 'Unfired pot': -2, Pot: 1 });
        expect(logged(r)).toEqual([]);
    });

    test('a product param picks its menu button and the unfired name', async () => {
        const r = await run(station.skill('Crafting', 8, 0).inv('Soft clay', 1, { id: ID['Soft clay'] }), {
            product: 'pie dish',
            fire: false,
        });
        expect(r.sends).toEqual(["use Soft clay on Potter's Wheel", 'shape Pie Dish']);
        expect(r.result.inventoryDelta).toEqual({ 'Soft clay': -1, 'Unfired pie dish': 1 });
    });

    test('clay with no water left is reported when the rest is done', async () => {
        const r = await run(station.inv('Soft clay', 1, { id: ID['Soft clay'] }).inv('Clay', 3, { id: ID['Clay'] }), {
            fire: false,
        });
        expect(r.result.reason).toBe('finish: nothing left to craft; 3 clay left, no water to soften it');
        expect(r.events.some(e => e.type === 'log' && JSON.stringify(e.data) === '{"leftoverClay":3}')).toBe(true);
    });
});

describe('crafting: walking and areas', () => {
    test('walks to a wheel in sight but out of reach before using it', async () => {
        const far = world()
            .player({ at: { x: 3075, z: 3409 } })
            .skill('Crafting', 1, 0)
            .loc("Potter's Wheel", WHEEL.x, WHEEL.z)
            .inv('Soft clay', 1, { id: ID['Soft clay'] });
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: far.series(1),
            react: (a, s) => {
                if (a.type === 'walkTo')
                    return w =>
                        world(w)
                            .player({ at: { x: a.x, z: a.z } })
                            .build();
                return pottery()(a, s);
            },
        });
        expect(r.sends[0]).toMatch(/^walk/);
        expect(r.sends.slice(-2)).toEqual(SHAPE);
        expect(r.result.reason).toBe('finish: nothing left to craft');
    });

    test('an area refuses a spot that reaches the Wilderness', async () => {
        const r = await run(SOFT, { area: { x: 3087, z: 3600, radius: 10 } });
        expect(r.result.reason).toMatch(/^preflight: area .* reaches the Wilderness/);
    });
});

describe('crafting: failures', () => {
    test('no wheel in sight fails after the limit, with advice', async () => {
        const noWheel = world()
            .player({ at: WHEEL })
            .skill('Crafting', 1, 0)
            .inv('Soft clay', 1, { id: ID['Soft clay'] });
        const r = await run(noWheel, AREA);
        expect(r.result.reason).toBe("shape: no reachable potter's wheel nearby (pass `area` at the wheel)");
    });

    test('a station missing for a tick does not fail the run', async () => {
        // The wheel drops out of the loc list for one tick, then is back: the missing-station wait covers it.
        const base = station.inv('Soft clay', 1, { id: ID['Soft clay'] });
        const gap = world()
            .player({ at: { x: 3086, z: 3408 } })
            .skill('Crafting', 1, 0)
            .inv('Soft clay', 1, { id: ID['Soft clay'] });
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: [base.tick(0).build(), gap.tick(1).build(), gap.tick(2).build(), base.tick(3).build()],
            react: consume,
        });
        expect(sent(r, 'use Soft clay').length).toBeGreaterThan(0);
        expect(r.result.reason).not.toContain('no reachable');
    });

    test('no oven in sight fails after the limit', async () => {
        const noOven = world()
            .player({ at: WHEEL })
            .skill('Crafting', 1, 0)
            .inv('Unfired pot', 1, { id: ID['Unfired pot'] });
        const r = await run(noOven, AREA);
        expect(r.result.reason).toBe('fire: no reachable pottery oven nearby (pass `area` at the oven)');
    });

    test('a menu that never opens fails the run after FAIL_LIMIT attempts', async () => {
        const r = await simulate(crafting, { params: {}, timeline: SOFT.series(1), react: consume });
        expect(r.result.reason).toBe(`shape: ${FAIL_LIMIT} shapes in a row failed (last: Pottery menu did not open)`);
        expect(r.sends.filter(s => s.startsWith('use Soft clay'))).toHaveLength(FAIL_LIMIT);
        expect(r.driver.state().tick).toBe(FAIL_LIMIT * SHAPE_MENU_TICKS);
    });

    test("the game's level box fails at once, without retrying", async () => {
        const box = 'You need a Crafting level of 7 to make a pie dish.';
        const r = await simulate(crafting, {
            params: { product: 'pie dish' },
            timeline: station
                .skill('Crafting', 7, 0)
                .inv('Soft clay', 1, { id: ID['Soft clay'] })
                .series(30, (w, i) =>
                    i >= 4 ? w.recentDialog([box]) : i >= 1 && i <= 3 ? w.dialog({ options: MENU }) : w,
                ),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`shape: ${box}`);
        expect(r.sends.filter(s => s.startsWith('use Soft clay'))).toHaveLength(1);
    });

    test('a failed shape followed by a success resets the count', async () => {
        // FAIL_LIMIT - 1 attempts with no menu (a menu wait each), then the model takes over.
        let sends = 0;
        const model = pottery();
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: SOFT.series(1),
            react: (a, s) => {
                if (a.type === 'useItemOnLoc' && ++sends <= FAIL_LIMIT - 1) return undefined;
                return model(a, s);
            },
        });
        expect(r.result.status).toBe('done');
        expect(logged(r).filter(m => String(m).startsWith('shape failed'))).toHaveLength(FAIL_LIMIT - 1);
    });

    const FREMENNIK = 'Only Fremenniks may use this pottery wheel.';
    const MENU_NO_POT = ['Pie Dish', 'Bowl'].flatMap(p => ['Make X', 'Make 10', 'Make 5', `\\n\\n\\n\\n${p}`]);

    test('softens that keep failing end the run after FAIL_LIMIT', async () => {
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: station
                .inv('Clay', 1, { id: ID['Clay'] })
                .inv('Bucket of water', 1, { id: ID['Bucket of water'] })
                .series(1),
            react: consume,
        });
        expect(r.result.reason).toBe(
            `soften: ${FAIL_LIMIT} softens in a row failed (last: No soft clay from Bucket of water)`,
        );
        expect(sent(r, 'use Bucket')).toHaveLength(FAIL_LIMIT);
    });

    test('a walk to the wheel that fails fails the run after FAIL_LIMIT', async () => {
        const far = world()
            .player({ at: { x: 3075, z: 3409 } })
            .skill('Crafting', 1, 0)
            .loc("Potter's Wheel", WHEEL.x, WHEEL.z)
            .inv('Soft clay', 1, { id: ID['Soft clay'] });
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: far.series(1),
            react: consume,
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.reason).toStartWith("shape: can't reach the wheel (");
        expect(r.sends).toEqual([]);
        expect(logged(r).filter(m => String(m).startsWith('walk to the wheel failed'))).toHaveLength(FAIL_LIMIT);
    });

    test('a walk to the oven that fails fails the run after FAIL_LIMIT', async () => {
        const far = world()
            .player({ at: { x: 3075, z: 3407 } })
            .skill('Crafting', 1, 0)
            .loc('Pottery Oven', OVEN.x, OVEN.z, { options: ['Fire'] })
            .inv('Unfired pot', 1, { id: ID['Unfired pot'] });
        const r = await simulate(crafting, {
            params: {},
            timeline: far.series(1),
            react: consume,
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.reason).toStartWith("fire: can't reach the oven (");
        expect(logged(r).filter(m => String(m).startsWith('walk to the oven failed'))).toHaveLength(FAIL_LIMIT);
    });

    test('firings that keep failing end the run after FAIL_LIMIT', async () => {
        const r = await simulate(crafting, {
            params: {},
            timeline: station.inv('Unfired pot', 1, { id: ID['Unfired pot'] }).series(1),
            react: consume,
        });
        expect(r.result.reason).toBe(
            `fire: ${FAIL_LIMIT} firings in a row failed (last: Timed out firing Unfired pot in Pottery Oven)`,
        );
        expect(sent(r, 'fire ')).toHaveLength(FAIL_LIMIT);
    });

    test('a wheel that is not allowed fails at once, with one use', async () => {
        const r = await simulate(crafting, {
            params: {},
            timeline: SOFT.series(1),
            react: (a, s) => (a.type === 'useItemOnLoc' ? w => world(w).message(FREMENNIK).build() : consume(a, s)),
        });
        expect(r.result.reason).toBe(`shape: ${FREMENNIK}`);
        expect(sent(r, 'use Soft clay')).toHaveLength(1);
    });

    test('an oven that is not allowed fails at once, with one use', async () => {
        const text = 'Only Fremenniks may use this pottery oven.';
        const r = await simulate(crafting, {
            params: {},
            timeline: station.inv('Unfired pot', 1, { id: ID['Unfired pot'] }).series(1),
            react: (a, s) => (a.type === 'useItemOnLoc' ? w => world(w).message(text).build() : consume(a, s)),
        });
        expect(r.result.reason).toBe(`fire: ${text}`);
        expect(sent(r, 'fire ')).toHaveLength(1);
    });

    test('a make menu without the product fails at once', async () => {
        const r = await simulate(crafting, {
            params: {},
            timeline: SOFT.series(1),
            react: (a, s) =>
                a.type === 'useItemOnLoc' ? w => world(w).dialog({ options: MENU_NO_POT }).build() : pottery()(a, s),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('shape: No pottery product matched "pot". Available: "Pie Dish", "Bowl"');
        expect(sent(r, 'use Soft clay')).toHaveLength(1);
    });

    test('the under-attack guard ends the run when auto-retaliate is off', async () => {
        const r = await simulate(crafting, {
            params: {},
            timeline: SOFT.autoRetaliate(false).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.reason).toBe(
            'interrupt:under-attack: attacked by Goblin (level 2) with auto-retaliate off at (3086,3408)',
        );
    });
});

const refusal = async (w: World, params: object = {}) => (await run(w, params)).result.reason;

describe('crafting: preflight', () => {
    test('needs something to craft', async () => {
        expect(await refusal(station)).toBe(
            'preflight: nothing to craft: no soft clay, no clay with a bucket/jug/bowl of water, no Unfired pot',
        );
        expect(await refusal(station.inv('Clay', 3, { id: ID['Clay'] }))).toMatch(/^preflight: nothing to craft/);
        expect(await refusal(station.inv('Unfired pot', 1, { id: ID['Unfired pot'] }), { fire: false })).toBe(
            'preflight: nothing to craft: no soft clay, and no clay with a bucket/jug/bowl of water',
        );
    });

    test('refuses an unknown product and a level too low', async () => {
        expect((await run(SOFT, { product: 'urn' })).result.reason).toBe(
            'invalid params: product: Invalid option: expected one of "pot"|"pie dish"|"bowl"',
        );
        expect(await refusal(SOFT, { product: 'bowl' })).toBe('preflight: bowl needs crafting 8, bot has 1');
    });

    test('without an area, a wheel in sight is needed before the water is spent', async () => {
        const bare = world()
            .player({ at: { x: 3086, z: 3408 } })
            .skill('Crafting', 1, 0)
            .inv('Clay', 1, { id: ID['Clay'] })
            .inv('Bucket of water', 1, { id: ID['Bucket of water'] });
        expect(await refusal(bare)).toBe("preflight: no reachable potter's wheel nearby (pass `area` at the wheel)");
    });

    test('without an area, an oven in sight is needed to fire, and not when fire is off', async () => {
        const wheelOnly = world()
            .player({ at: { x: 3086, z: 3408 } })
            .skill('Crafting', 1, 0)
            .loc("Potter's Wheel", WHEEL.x, WHEEL.z)
            .inv('Soft clay', 1, { id: ID['Soft clay'] });
        expect(await refusal(wheelOnly)).toBe('preflight: no reachable pottery oven nearby (pass `area` at the oven)');
        expect((await run(wheelOnly, { fire: false })).result.status).toBe('done');
    });

    test('firing needs no level', async () => {
        const r = await run(station.inv('Unfired bowl', 1, { id: ID['Unfired bowl'] }), { product: 'bowl' });
        expect(r.result.status).toBe('done');
    });
});

describe('crafting: guards', () => {
    test('low HP while waiting for the shape aborts the step and eats, and the run still finishes', async () => {
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: station
                .inv('Soft clay', 1, { id: ID['Soft clay'] })
                .inv('Shrimps', 1)
                .series(12, (w, i) => w.player({ hp: i === 2 ? 4 : 10 })),
            react: pottery(),
        });
        expect(r.result.reason).toBe('finish: nothing left to craft');
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('a level-up dialog mid-shape is cleared', async () => {
        const r = await simulate(crafting, {
            params: { fire: false },
            timeline: SOFT.series(12, (w, i) => (i === 2 ? w.dialog({ options: ['Click here to continue'] }) : w)),
            react: pottery(),
        });
        expect(r.result.reason).toBe('finish: nothing left to craft');
        expect(r.sends).toContain('continue dialog');
    });
});

describe('crafting: the step budget', () => {
    test('covers the capped walk plus the longest op after it', () => {
        expect(STATION_WALK_TICKS + OP_MAX_TICKS).toBeLessThanOrEqual(stepBudgetTicks(90_000));
        expect(ATTEMPT_SILENT_TICKS).toBe(STATION_WALK_TICKS + OP_MAX_TICKS);
    });
});
