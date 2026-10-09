import { describe, expect, test } from 'bun:test';
import { TimelineDriver } from '../../core/drivers/timeline';
import pickup from '../../tasks/pickup';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const AREA = { x: 3224, z: 3202, radius: 4 };
const KNIFE = { x: 3224, z: 3202 };
const PARAMS = { area: AREA, items: [{ item: 'Knife', count: 1 }] };
const TAKE = 'take Knife';
const CANT_REACH = "I can't reach that!";
const NO_SPACE = "You don't have enough inventory space to hold that item.";
/** The bot stands in the area. */
const inside = world().player({ at: KNIFE });
const spawn = inside.ground('Knife', KNIFE.x, KNIFE.z);
/** The knife is in the inventory (the test removes it from the ground by building from `inside`). */
const taken = (w: World) => w.inv('Knife', 1);
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
/** A game message that arrives afresh every tick from tick 1, so each pickup sees its own. */
const refusedWith = (text: string) => spawn.series(40, (w, i) => (i >= 1 ? w.message(text) : w));

describe('pickup: picking up', () => {
    test('takes the ground item and finishes holding it', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: spawn.series(10, (w, i) => (i >= 4 ? taken(inside.tick(i)) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toEqual([TAKE]);
        expect(r.result.inventoryDelta).toEqual({ Knife: 1 });
        expect(logged(r)).toEqual([]);
    });

    test('takes each wanted item in turn, the nearest of a kind first', async () => {
        const two = spawn.ground('Knife', 3224, 3200);
        const r = await simulate(pickup, {
            params: { area: AREA, items: [{ item: 'Knife', count: 2 }] },
            timeline: two.series(20, (w, i) =>
                i >= 8
                    ? inside.tick(i).inv('Knife', 2)
                    : i >= 4
                      ? inside.tick(i).ground('Knife', 3224, 3200).inv('Knife', 1)
                      : w,
            ),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toEqual([TAKE, TAKE]);
        expect(r.result.inventoryDelta).toEqual({ Knife: 2 });
    });

    test('ignores items outside the area and unreachable ones', async () => {
        const r = await simulate(pickup, {
            params: { ...PARAMS, maxWaitSeconds: 10 },
            timeline: inside.ground('Knife', 3224, 3207).ground('Knife', 3225, 3202, 1, { reachable: false }).series(1),
        });
        expect(r.sends).toEqual([]);
        expect(r.result.reason).toBe('pickup: Knife is present in the area but unreachable (waited 10s)');
    });
});

describe('pickup: failed pickups', () => {
    test('three refused pickups in a row fail the run with the last message', async () => {
        const r = await simulate(pickup, { params: PARAMS, timeline: refusedWith(CANT_REACH) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('pickup: 3 pickups in a row failed (last: Cannot reach Knife - path blocked)');
        expect(r.sends).toEqual([TAKE, TAKE, TAKE]);
        expect(logged(r)).toEqual(
            Array(3).fill('pickup of Knife at (3224,3202) failed: Cannot reach Knife - path blocked'),
        );
    });

    test('a full inventory is its own message', async () => {
        const r = await simulate(pickup, { params: PARAMS, timeline: refusedWith(NO_SPACE) });
        expect(r.result.reason).toBe('pickup: 3 pickups in a row failed (last: Inventory is full)');
    });

    test('no pickup within the wait is a timeout', async () => {
        const r = await simulate(pickup, { params: PARAMS, timeline: spawn.series(1) });
        expect(r.result.reason).toBe('pickup: 3 pickups in a row failed (last: Timed out waiting for pickup)');
        expect(r.sends).toHaveLength(3);
        expect(r.driver.state().tick).toBe(75);
    });

    test('a success in between resets the count', async () => {
        const second = spawn.ground('Knife', 3224, 3200);
        // Two refusals, a take (tick 3), two more refusals, a take (tick 6): four refusals in all.
        const r = await simulate(pickup, {
            params: { area: AREA, items: [{ item: 'Knife', count: 2 }] },
            timeline: second.series(20, (w, i) => {
                if (i >= 6) return inside.tick(i).inv('Knife', 2);
                if (i >= 3) {
                    const one = inside.tick(i).ground('Knife', 3224, 3200).inv('Knife', 1);
                    return i === 3 ? one : one.message(CANT_REACH);
                }
                return i >= 1 ? w.message(CANT_REACH) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toHaveLength(6);
    });

    test('an item taken by someone else is a failed pickup; the bot then waits for a respawn', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: spawn.series(30, (w, i) =>
                i >= 12 ? taken(inside.tick(i)) : i >= 2 && i < 8 ? inside.tick(i) : w,
            ),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(logged(r)).toEqual([
            'pickup of Knife at (3224,3202) failed: Knife was taken by someone else',
            'no Knife in the area, waiting for a respawn',
        ]);
        // The spawn is back at tick 8 and taken at 12.
        expect(r.sends).toEqual([TAKE, TAKE]);
    });
});

describe('pickup: nothing to pick up', () => {
    test('fails after maxWaitSeconds with no item, logging the wait once', async () => {
        const r = await simulate(pickup, { params: { ...PARAMS, maxWaitSeconds: 10 }, timeline: inside.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('pickup: no Knife appeared in the area within 10s');
        expect(logged(r)).toEqual(['no Knife in the area, waiting for a respawn']);
        // 10 s is 25 ticks, checked every 5.
        expect(r.driver.state().tick).toBe(25);
    });

    test('a respawn inside the wait is picked up', async () => {
        const r = await simulate(pickup, {
            params: { ...PARAMS, maxWaitSeconds: 10 },
            timeline: inside.series(30, (w, i) => (i >= 16 ? taken(inside.tick(i)) : i >= 12 ? spawn.tick(i) : w)),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toEqual([TAKE]);
    });

    test('a full inventory with nothing to take fails at once', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: inside.series(5, (w, i) => w.inv('Logs', i >= 2 ? 28 : 27)),
        });
        expect(r.result.reason).toBe('pickup: inventory is full');
    });

    test('just outside the area, walks in rather than waiting', async () => {
        const outside = world().player({ at: { x: 3224, z: 3207 } });
        const driver = new TimelineDriver([
            outside.build(),
            ...inside.series(40).map((st, i) => ({ ...st, tick: i + 1 })),
        ]);
        const walks: unknown[][] = [];
        const r = await simulate(pickup, {
            params: { ...PARAMS, maxWaitSeconds: 10 },
            driver,
            bot: {
                walkTo: async (...args) => {
                    walks.push(args);
                    await driver.nextTick();
                    return { success: true, message: 'ok' };
                },
            },
        });
        // The walk tolerance is radius - 1.
        expect(walks).toEqual([[3224, 3202, 3]]);
        expect(r.result.reason).toBe('pickup: no Knife appeared in the area within 10s');
    });

    test('three failed walks in a row fail the run', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            bot: { walkTo: async () => ({ success: false, message: 'blocked' }) },
            timeline: world()
                .player({ at: { x: 3224, z: 3207 } })
                .series(1),
        });
        expect(r.result.reason).toBe("pickup: can't walk to area (blocked)");
    });
});

describe('pickup: preflight', () => {
    test('refuses without a free slot per wanted item', async () => {
        const r = await simulate(pickup, { params: PARAMS, timeline: spawn.inv('Logs', 28).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: 0 free inventory slots, need up to 1 for new items');
    });

    test('refuses an area reaching the Wilderness', async () => {
        const r = await simulate(pickup, {
            params: { area: { x: 3200, z: 3600, radius: 5 }, items: PARAMS.items },
            timeline: spawn.series(1),
        });
        expect(r.result.reason).toBe('preflight: area (3200,3600) radius 5 reaches the Wilderness');
    });
});

describe('pickup: guards', () => {
    test('fails at once when attacked', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: spawn.series(10, (w, i) => w.player({ inCombat: i >= 3 })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('attacked: attacked while picking up at (3224,3202)');
    });

    test('low HP mid-pickup aborts it and eats, then picking up resumes', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: spawn.inv('Shrimps', 1).series(20, (w, i) => {
                const hp = i === 3 ? 4 : 10;
                return i >= 9 ? inside.tick(i).inv('Shrimps', 1).inv('Knife', 1).player({ hp }) : w.player({ hp });
            }),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toEqual([TAKE, 'Eat Shrimps', TAKE]);
    });

    test('a level-up dialog mid-pickup is cleared and the pickup completes', async () => {
        const r = await simulate(pickup, {
            params: PARAMS,
            timeline: spawn.series(20, (w, i) => {
                if (i >= 8) return taken(inside.tick(i));
                return i === 3 ? w.dialog({ options: ['Click here to continue'] }) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: holding every requested item');
        expect(r.sends).toEqual([TAKE, 'continue dialog']);
    });
});
