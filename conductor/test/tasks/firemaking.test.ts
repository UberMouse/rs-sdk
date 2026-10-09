import { describe, expect, test } from 'bun:test';
import { BURN_WAIT_TICKS } from '../../actions/burn';
import { TimelineDriver } from '../../core/drivers/timeline';
import firemaking from '../../tasks/firemaking';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const CENTRE = { x: 3230, z: 3240 };
const AREA = { ...CENTRE, radius: 6 };
const PARAMS = { logs: 'Logs', area: AREA };
const LIGHT = 'light Logs';
const REFUSED = "You can't light a fire here.";
/** At the area's centre with a tinderbox and three logs, the Firemaking XP 40 a log. */
const kit = world().player({ at: CENTRE }).skill('Firemaking', 1, 0).inv('Tinderbox', 1).inv('Logs', 3);
/** `n` logs lit so far. */
const lit = (w: World, n: number) => w.inv('Logs', 3 - n).skill('Firemaking', 1, 40 * n);
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/**
 * Routes straight to any tile but the `blocked` ones, which have none, and walks that move the bot
 * (`walking`): `sim` goes into simulate. `walks` holds each walk's destination once; a walk with no
 * route asks for one twice, a tick apart.
 */
function walker(blocked: (x: number, z: number) => boolean = () => false) {
    const walks: [number, number][] = [];
    const pathfinder = fakePaths(
        (from, to) => {
            const last = walks.at(-1);
            if (!last || last[0] !== to.x || last[1] !== to.z) walks.push([to.x, to.z]);
            return blocked(to.x, to.z)
                ? { success: true, waypoints: [] }
                : { success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] };
        },
        [],
        blocked,
    );
    return { walks, sim: { pathfinder, react: walking() } };
}
/** How the walk reports a tile with no route. */
const noRoute = (x: number, z: number) =>
    `No path to (${x}, ${z}) from (${CENTRE.x}, ${CENTRE.z}): destination tile is blocked`;

/** A refusal arrives afresh on each tick from 1 until `to`. */
const refusedUntil = (to: number) => kit.series(60, (w, i) => (i >= 1 && i < to ? w.message(REFUSED) : w));

describe('firemaking: lighting', () => {
    test('lights each log in turn and finishes when none are left', async () => {
        const { sim, walks } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(30, (w, i) => lit(w, i >= 14 ? 3 : i >= 8 ? 2 : i >= 4 ? 1 : 0)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Logs left to burn');
        expect(r.sends).toEqual([LIGHT, LIGHT, LIGHT]);
        expect(r.result.inventoryDelta).toEqual({ Logs: -3 });
        expect(r.result.xpGained).toEqual({ Firemaking: 120 });
        expect(walks).toEqual([]);
        expect(logged(r)).toEqual([]);
    });

    test('burns only the exact log type asked for', async () => {
        const oak = kit.inv('Oak logs', 1, { id: 1521 }).inv('Logs', 0).inv('Logs', 1).skill('Firemaking', 15, 0);
        const r = await simulate(firemaking, {
            params: { ...PARAMS, logs: 'Oak logs' },
            timeline: oak.series(20, (w, i) => (i >= 4 ? w.inv('Oak logs', 0).skill('Firemaking', 15, 60) : w)),
        });
        expect(r.result.reason).toBe('finish: no Oak logs left to burn');
        expect(r.sends).toEqual(['light Oak logs']);
    });
});

describe('firemaking: a refused light', () => {
    test('five in a row fail the run with the game message', async () => {
        const { sim } = walker();
        const r = await simulate(firemaking, { params: PARAMS, ...sim, timeline: refusedUntil(60) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe("burn: 5 lights in a row failed (last: You can't light a fire here.)");
        // Each refused light steps north of where the bot then stands.
        expect(r.sends).toEqual([
            LIGHT,
            'walk to (3230, 3241)',
            LIGHT,
            'walk to (3230, 3242)',
            LIGHT,
            'walk to (3230, 3243)',
            LIGHT,
            'walk to (3230, 3244)',
            LIGHT,
        ]);
        expect(logged(r).filter(m => String(m).startsWith('light failed'))).toHaveLength(5);
    });

    test('a success in between resets the count', async () => {
        const { sim } = walker();
        // Four refusals, a light (tick 7), four more refusals, a light (tick 14): ten lights, no fifth in a row.
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(30, (w, i) => {
                if (i >= 14) return lit(w, 3);
                if (i >= 7) return lit(i >= 8 && i <= 11 ? w.message(REFUSED) : w, 1);
                return i >= 1 && i <= 4 ? w.message(REFUSED) : w;
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toHaveLength(10);
    });

    test('steps to a neighbouring tile and, when that is blocked, tries the next', async () => {
        const { sim, walks } = walker((x, z) => x === 3230 && z === 3241);
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(20, (w, i) => (i === 2 ? w.message(REFUSED) : i >= 7 ? lit(w, 1) : w)),
            stops: [{ kind: 'xp', skill: 'Firemaking', amount: 40 }],
        });
        expect(r.result.reason).toBe('reached +40 Firemaking xp');
        // North first, then south; the tile just east is the last resort (the fire it lit).
        expect(walks).toEqual([
            [3230, 3241],
            [3230, 3239],
        ]);
        expect(r.sends).toEqual([LIGHT, 'walk to (3230, 3239)', LIGHT]);
        expect(logged(r)).toEqual([
            `light failed: ${REFUSED}`,
            `sidestep to (3230,3241) failed: ${noRoute(3230, 3241)}`,
        ]);
    });

    test('tries tiles further out when every neighbour is blocked, never leaving the area', async () => {
        const small = { ...CENTRE, radius: 2 };
        const { sim, walks } = walker(() => true);
        const r = await simulate(firemaking, {
            params: { ...PARAMS, area: small },
            ...sim,
            // Each walk with no route takes a tick (its retry): the eight are over by tick 10.
            timeline: kit.series(20, (w, i) => (i >= 12 ? lit(w, 1) : i === 1 ? w.message(REFUSED) : w)),
            stops: [{ kind: 'xp', skill: 'Firemaking', amount: 40 }],
        });
        expect(r.result.status).toBe('done');
        // Radius 2 holds two rings of four directions; the third ring is outside.
        expect(walks).toHaveLength(8);
        expect(walks.every(([x, z]) => Math.max(Math.abs(x - CENTRE.x), Math.abs(z - CENTRE.z)) <= 2)).toBe(true);
        expect(logged(r).at(-1)).toBe('sidestep: no candidate tile reachable');
    });
});

describe('firemaking: a light that never catches', () => {
    test('is a failed light: the bot leaves the tile and lights the next log', async () => {
        const { sim, walks } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            // The server drops the log on the tile before the first roll, so the inventory loses it at once.
            timeline: kit.series(BURN_WAIT_TICKS + 20, (w, i) => {
                if (i >= BURN_WAIT_TICKS + 8) return lit(w, 3).inv('Logs', 0).skill('Firemaking', 1, 40);
                return i >= 1 ? w.inv('Logs', 2) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to burn');
        expect(logged(r)).toEqual(['light failed: Timed out waiting for fire']);
        expect(r.sends).toEqual([LIGHT, 'walk to (3230, 3241)', LIGHT]);
        expect(walks).toHaveLength(1);
    });

    test('with the last log on the ground the run still ends by what the inventory holds', async () => {
        const { sim } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.inv('Logs', 1).series(BURN_WAIT_TICKS + 5, (w, i) => (i >= 1 ? w.inv('Logs', 0) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Logs left to burn');
        expect(logged(r)).toEqual(['light failed: Timed out waiting for fire']);
    });

    test('a level the game refuses is a failure that does not move the bot', async () => {
        const { sim, walks } = walker();
        const msg = 'You need a Firemaking level of 15 to burn Logs.';
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(30, (w, i) => (i >= 1 ? w.message(msg) : w)),
        });
        expect(r.result.reason).toBe(`burn: 5 lights in a row failed (last: ${msg})`);
        expect(walks).toEqual([]);
    });
});

describe('firemaking: other steps', () => {
    test('walks back to the area when the bot has strayed from it', async () => {
        const far = world().player({ at: { x: CENTRE.x + 20, z: CENTRE.z } });
        const away = far.skill('Firemaking', 1, 0).inv('Tinderbox', 1).inv('Logs', 1);
        const { sim, walks } = walker();
        const litFrom: number[] = [];
        const driver: TimelineDriver = new TimelineDriver(
            away.series(30, (w, i) => (i >= 16 ? lit(w, 3) : w)),
            {
                ...sim,
                respond: a => {
                    if (a.reason === LIGHT) litFrom.push(driver.state().player?.worldX ?? NaN);
                    return undefined;
                },
            },
        );
        const r = await simulate(firemaking, { params: PARAMS, pathfinder: sim.pathfinder, driver });
        expect(r.steps[0]).toBe('return-to-area');
        expect(walks[0]).toEqual([CENTRE.x, CENTRE.z]);
        // The tolerance is capped at 3: running 2 tiles a tick, the walk is done 2 short.
        expect(litFrom[0]).toBe(CENTRE.x + 2);
        expect(r.result.status).toBe('done');
    });

    test('a tinderbox lost mid-run fails the run', async () => {
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...walker().sim,
            timeline: kit.series(BURN_WAIT_TICKS + 10, (w, i) => (i >= 2 ? w.inv('Tinderbox', 0) : w)),
        });
        expect(r.result.status).toBe('failed');
        // The wait for the fire runs out first, then the no-tinderbox step decides.
        expect(r.result.reason).toBe('no-tinderbox: no tinderbox in inventory');
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(firemaking, { params, timeline: w.series(1) })).result.reason;

describe('firemaking: preflight', () => {
    test('needs a tinderbox, the logs, a known log type and the level', async () => {
        expect(await refusal(kit.inv('Tinderbox', 0))).toBe('preflight: no tinderbox in inventory');
        expect(await refusal(kit.inv('Logs', 0))).toBe('preflight: no "Logs" in inventory');
        expect(await refusal(kit.inv('Teak logs', 1, { id: 6333 }), { ...PARAMS, logs: 'Teak logs' })).toBe(
            'preflight: unknown log type "Teak logs" (known: logs, oak logs, willow logs, maple logs, yew logs, magic logs)',
        );
        expect(await refusal(kit.inv('Oak logs', 1), { ...PARAMS, logs: 'Oak logs' })).toBe(
            'preflight: Oak logs needs firemaking 15, bot has 1',
        );
    });

    test('refuses an area reaching the Wilderness', async () => {
        const reason = await refusal(kit, { logs: 'Logs', area: { x: 3200, z: 3600, radius: 5 } });
        expect(reason).toBe('preflight: area (3200,3600) radius 5 reaches the Wilderness');
    });
});

describe('firemaking: guards', () => {
    test('low HP mid-light aborts it and eats, then lighting resumes', async () => {
        const r = await simulate(firemaking, {
            params: PARAMS,
            timeline: kit
                .inv('Shrimps', 1)
                .series(30, (w, i) => lit(w.player({ hp: i === 3 ? 4 : 10 }), i >= 9 ? 3 : 0)),
        });
        expect(r.result.reason).toBe('finish: no Logs left to burn');
        expect(r.sends).toEqual([LIGHT, 'Eat Shrimps', LIGHT]);
    });

    test('a level-up dialog mid-light is cleared and the light still counts', async () => {
        const r = await simulate(firemaking, {
            params: PARAMS,
            timeline: kit.series(20, (w, i) => {
                const open = i >= 3 && i < 5 ? w.dialog({ options: ['Click here to continue'] }) : w;
                return i >= 6 ? lit(open, 3) : open;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to burn');
        expect(r.sends).toEqual([LIGHT, 'continue dialog']);
        expect(logged(r)).toEqual([]);
    });
});
