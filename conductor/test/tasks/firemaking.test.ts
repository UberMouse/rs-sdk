import { describe, expect, test } from 'bun:test';
import { BURN_WAIT_TICKS } from '../../actions/burn';
import { TimelineDriver } from '../../core/drivers/timeline';
import firemaking, { pickLine } from '../../tasks/firemaking';
import { fakePaths } from '../paths';
import { walking } from '../react';
import type { Outcome } from '../../lib/task';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const CENTRE = { x: 3230, z: 3240 };
const AREA = { ...CENTRE, radius: 6 };
const PARAMS = { logs: 'Logs', area: AREA };
const LIGHT = 'light Logs';
const REFUSED = "You can't light a fire here.";
/** At the area's centre with a tinderbox and three logs, the Firemaking XP 40 a log. */
const kit = world().player({ at: CENTRE }).skill('Firemaking', 1, 0).inv('Tinderbox', 1).inv('Logs', 3);
/** `n` logs lit so far, the bot stepped west along the first line (which starts where it stands). */
const lit = (w: World, n: number) =>
    w
        .inv('Logs', 3 - n)
        .skill('Firemaking', 1, 40 * n)
        .player({ at: { x: CENTRE.x - n, z: CENTRE.z } });
/** `n` logs lit, the bot not moved: for runs where `walking` does the moving. */
const litInPlace = (w: World, n: number) => w.inv('Logs', 3 - n).skill('Firemaking', 1, 40 * n);
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/**
 * Routes straight to any tile but the `blocked` ones, which have none, and walks that move the bot
 * (`walking`): `sim` goes into simulate. `walks` holds each walk's destination once; a walk with no
 * route asks for one twice, a tick apart.
 */
function walker(
    blocked: (x: number, z: number) => boolean = () => false,
    unroutable: (x: number, z: number) => boolean = () => false,
) {
    const walks: [number, number][] = [];
    const pathfinder = fakePaths(
        (from, to) => {
            const last = walks.at(-1);
            if (!last || last[0] !== to.x || last[1] !== to.z) walks.push([to.x, to.z]);
            return blocked(to.x, to.z) || unroutable(to.x, to.z)
                ? { success: true, waypoints: [] }
                : { success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] };
        },
        [],
        blocked,
    );
    return { walks, sim: { pathfinder, react: walking() } };
}
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
        expect(r.result.reason).toBe('finish: no Logs left to burn (lit 3)');
        expect(r.sends).toEqual([LIGHT, LIGHT, LIGHT]);
        expect(r.result.inventoryDelta).toEqual({ Logs: -3 });
        expect(r.result.xpGained).toEqual({ Firemaking: 120 });
        expect(walks).toEqual([]);
        expect(logged(r)).toEqual(['line: (3230,3240) west to (3227,3240)']);
    });

    test('burns only the exact log type asked for', async () => {
        const oak = kit.inv('Oak logs', 1, { id: 1521 }).inv('Logs', 0).inv('Logs', 1).skill('Firemaking', 15, 0);
        const r = await simulate(firemaking, {
            params: { ...PARAMS, logs: 'Oak logs' },
            timeline: oak.series(20, (w, i) => (i >= 4 ? w.inv('Oak logs', 0).skill('Firemaking', 15, 60) : w)),
        });
        expect(r.result.reason).toBe('finish: no Oak logs left to burn (lit 1)');
        expect(r.sends).toEqual(['light Oak logs']);
    });
});

describe('firemaking: a refused light', () => {
    test('five in a row fail the run with the game message, each on a tile of its own', async () => {
        const { sim, walks } = walker();
        const r = await simulate(firemaking, { params: PARAMS, ...sim, timeline: refusedUntil(60) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe("burn: 5 lights in a row failed (last: You can't light a fire here.)");
        expect(r.sends.filter(m => m === LIGHT)).toHaveLength(5);
        expect(logged(r).filter(m => String(m).startsWith('light failed'))).toHaveLength(5);
        // A refused tile is never lit on again: every fresh line starts somewhere new.
        expect(new Set(walks.map(([x, z]) => `${x},${z}`)).size).toBe(walks.length);
        expect(walks).toEqual([
            [3231, 3239],
            [3232, 3238],
            [3233, 3237],
            [3234, 3236],
        ]);
    });

    test('a success in between resets the count', async () => {
        const { sim } = walker();
        // Four refusals, a light (tick 7), four more refusals, a light (tick 14): ten lights, no fifth in a row.
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(40, (w, i) => {
                if (i >= 14) return litInPlace(w, 3);
                if (i >= 7) return litInPlace(i >= 8 && i <= 11 ? w.message(REFUSED) : w, 1);
                return i >= 1 && i <= 4 ? w.message(REFUSED) : w;
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([
            LIGHT,
            'walk to (3231, 3239)',
            LIGHT,
            'walk to (3232, 3238)',
            LIGHT,
            'walk to (3231, 3238)',
            LIGHT,
        ]);
    });

    test('picks a fresh line after a refusal, away from the refused tile', async () => {
        const { sim, walks } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(40, (w, i) => (i === 2 ? w.message(REFUSED) : i >= 12 ? litInPlace(w, 3) : w)),
        });
        expect(r.result.status).toBe('done');
        const lines = logged(r).filter(m => String(m).startsWith('line:'));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('line: (3230,3240) west to (3227,3240)');
        expect(lines[1]).not.toBe(lines[0]);
        expect(lines[1]).toBe('line: (3231,3239) west to (3228,3239)');
        expect(walks).toEqual([[3231, 3239]]);

        expect(walks.some(([x, z]) => x === 3230 && z === 3240)).toBe(false);
    });

    test('lights along a line of clear tiles and skips rows with fires on them', async () => {
        // Fires across z 3238..3240: the nearest row with room is z 3241.
        let w = kit;
        for (let x = CENTRE.x - 6; x <= CENTRE.x + 6; x++)
            for (const z of [3238, 3239, 3240]) w = w.loc('Fire', x, z, { options: [] });
        const { sim } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: w.series(8, (x, i) => (i >= 6 ? x.skill('Firemaking', 1, 40) : x)),
            stops: [{ kind: 'xp', skill: 'Firemaking', amount: 1 }],
        });
        const line = logged(r).find(m => String(m).startsWith('line:'));
        expect(line).toBe('line: (3231,3241) west to (3228,3241)');
        expect(r.sends[0]).toBe('walk to (3231, 3241)');
    });

    test('fails cleanly when no clear line is left in the area', async () => {
        const { sim } = walker(() => true);
        const r = await simulate(firemaking, { params: PARAMS, ...sim, timeline: kit.series(5) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('burn: no clear east-west line left in the area for 3 more logs');
        expect(r.sends).toEqual([]);
    });

    test('a line too short for the logs is still burned, with every light on it', async () => {
        // Only z 3240, x 3229..3231 is clear: three tiles, so two lights.
        const { sim } = walker((x, z) => z !== 3240 || x < 3229 || x > 3231);
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(8),
            stops: [{ kind: 'xp', skill: 'Firemaking', amount: 1 }],
        });
        expect(logged(r)[0]).toBe('line: (3231,3240) west to (3229,3240)');
    });
});

describe('firemaking: a light that never catches', () => {
    test('is a failed light: the bot leaves the tile and lights the next log on a fresh line', async () => {
        const { sim, walks } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            // The server drops the log on the tile before the first roll, so the inventory loses it at once.
            timeline: kit.series(BURN_WAIT_TICKS + 30, (w, i) => {
                if (i >= BURN_WAIT_TICKS + 12) return litInPlace(w, 3).inv('Logs', 0).skill('Firemaking', 1, 40);
                return i >= 1 ? w.inv('Logs', 2) : w;
            }),
        });
        expect(r.result.reason).toBe('finish: no Logs left to burn (lit 1)');
        expect(logged(r).filter(m => String(m).startsWith('light failed'))).toEqual([
            'light failed: Timed out waiting for fire',
        ]);
        expect(r.sends[1]).toMatch(/^walk to /);
        expect(walks.some(([x, z]) => x === 3230 && z === 3240)).toBe(false);
    });

    test('with the last log on the ground the run still ends by what the inventory holds', async () => {
        const { sim } = walker();
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.inv('Logs', 1).series(BURN_WAIT_TICKS + 5, (w, i) => (i >= 1 ? w.inv('Logs', 0) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Logs left to burn (lit 0)');
        expect(logged(r).filter(m => String(m).startsWith('light failed'))).toEqual([
            'light failed: Timed out waiting for fire',
        ]);
    });

    test('a level the game refuses fails the run at once', async () => {
        const { sim } = walker();
        const msg = 'You need a Firemaking level of 15 to burn Logs.';
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: kit.series(30, (w, i) => (i >= 1 ? w.message(msg) : w)),
        });
        expect(r.result.reason).toBe(`burn: ${msg}`);
        expect(r.sends.filter(m => m === LIGHT)).toHaveLength(1);
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
        expect(r.result.reason).toBe('finish: no Logs left to burn (lit 1)');
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
        expect(r.result.reason).toBe('finish: no Logs left to burn (lit 1)');
        expect(r.sends).toEqual([LIGHT, 'continue dialog']);
        expect(logged(r)).toEqual(['line: (3230,3240) west to (3227,3240)']);
    });
});

/** Starts west of the first line's start, so each line needs a walk. */
const away = kit.player({ at: { x: CENTRE.x - 5, z: CENTRE.z } });
const failedWalks = (r: Simulation) => logged(r).filter(m => String(m).startsWith('walk to line start'));
const lineLogs = (r: Simulation) => logged(r).filter(m => String(m).startsWith('line:'));
/** Unroutable for the destinations whose 1-based order of first asking `bad` holds. */
function unroutableNth(bad: number[]) {
    const seen: string[] = [];
    return (x: number, z: number) => {
        const k = `${x},${z}`;
        if (!seen.includes(k)) seen.push(k);
        return bad.includes(seen.indexOf(k) + 1);
    };
}

describe('firemaking: a line start that cannot be reached', () => {
    test('one failed walk marks the start bad and another line is logged next', async () => {
        const { sim, walks } = walker(undefined, unroutableNth([1]));
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: away.series(40, (w, i) => (i >= 20 ? litInPlace(w, 1) : w)),
            stops: [{ kind: 'xp', skill: 'Firemaking', amount: 1 }],
        });
        expect(failedWalks(r)).toHaveLength(1);
        const lines = lineLogs(r);
        expect(lines).toEqual(['line: (3227,3240) west to (3224,3240)', 'line: (3228,3237) west to (3225,3237)']);
        expect(walks).toEqual([
            [3227, 3240],
            [3228, 3237],
        ]);
        expect(lines[1]).not.toBe(lines[0]);
        const first = walks[0]!;
        expect(walks.filter(([x, z]) => x === first[0] && z === first[1])).toHaveLength(1);
        expect(r.sends).toContain(LIGHT);
    });

    test('three in a row fail the run with the last walk message', async () => {
        const { sim } = walker(undefined, () => true);
        const r = await simulate(firemaking, { params: PARAMS, ...sim, timeline: away.series(60) });
        expect(r.result.status).toBe('failed');
        const fails = failedWalks(r);
        expect(fails).toHaveLength(3);
        const message = String(fails[2]).replace(/^walk to line start \(\d+,\d+\) failed: /, '');
        expect(r.result.reason).toBe(`burn: 3 line starts in a row unreachable (last: ${message})`);
        expect(new Set(lineLogs(r)).size).toBe(3);
    });

    test('a successful walk resets the count', async () => {
        // Walks 1 and 2 fail, 3 arrives and the light is refused, 4 and 5 fail, 6 arrives: no third in a row.
        const { sim } = walker(undefined, unroutableNth([1, 2, 4, 5]));
        const r = await simulate(firemaking, {
            params: PARAMS,
            ...sim,
            timeline: away.series(120, (w, i) => (i >= 60 ? litInPlace(w, 3) : i === 30 ? w.message(REFUSED) : w)),
        });
        expect(failedWalks(r)).toHaveLength(4);
        expect(r.result.status).toBe('done');
    });

    test('a walk with no time left is not counted and marks nothing', async () => {
        // A 3-tick step budget leaves the walk none after its reserve. Nothing waits then, so the loop is cut by hand.
        const { sim, walks } = walker();
        let runs = 0;
        type Step = (typeof firemaking.steps)[number];
        const steps: Step[] = firemaking.steps.map(st =>
            st.name === 'burn'
                ? {
                      ...st,
                      *run(ctx) {
                          if (++runs > 4) return { fail: 'cut' };
                          return yield* st.run(ctx) as Generator<never, Outcome>;
                      },
                  }
                : st,
        );
        const r = await simulate(
            { ...firemaking, steps, stepTimeoutMs: 1200 },
            { params: PARAMS, ...sim, timeline: away.series(30) },
        );
        expect(r.result.reason).toBe('burn: cut');
        expect(failedWalks(r)).toHaveLength(4);
        expect(lineLogs(r)).toHaveLength(1);
        expect(walks).toEqual([]);
    });

    test('a timeout that closes in is not counted; one that does not marks the start bad', async () => {
        // 5 ticks of budget, 3 reserved: a 2-tick walk. Running 2 tiles a tick it closes in on the 5 tiles.
        const closing = walker();
        const a = await simulate(
            { ...firemaking, stepTimeoutMs: 2000 },
            { params: PARAMS, ...closing.sim, timeline: away.series(40) },
        );
        expect(a.result.reason).not.toMatch(/unreachable/);
        expect(lineLogs(a)).toHaveLength(1);
        // The same walk where the bot never moves: the start is dropped for another line.
        const still = walker();
        const b = await simulate(
            { ...firemaking, stepTimeoutMs: 2000 },
            {
                params: PARAMS,
                pathfinder: still.sim.pathfinder,
                react: walking(undefined, () => true),
                timeline: away.series(40),
            },
        );
        expect(lineLogs(b)).toEqual([
            'line: (3227,3240) west to (3224,3240)',
            'line: (3228,3237) west to (3225,3237)',
            'line: (3228,3238) west to (3225,3238)',
        ]);
    });
});

type PickCtx = Parameters<typeof pickLine>[0];
const pick = (
    w: World,
    logs: number,
    bad: string[] = [],
    blocked: (x: number, z: number) => boolean = () => false,
    area = AREA,
) => {
    const ctx: Pick<PickCtx, 'state' | 'params' | 'memory' | 'pathfinder'> = {
        state: () => w.build(),
        params: { logs: 'Logs', area },
        memory: { line: null, bad: new Set(bad), lit: 0 },
        pathfinder: fakePaths(() => ({ success: false, waypoints: [] }), [], blocked),
    };
    return pickLine(ctx as unknown as PickCtx, logs);
};

/** Only z 3240, x 3228..3232 is clear: five tiles. */
const onlyRow = (x: number, z: number) => z !== 3240 || x < 3228 || x > 3232;

describe('firemaking: pickLine', () => {
    test('prefers the longest run, capped at the logs held', () => {
        // Only z 3240 has 5 clear tiles (3228..3232); everything else is blocked.
        expect(pick(kit, 10, [], onlyRow)).toEqual({ z: 3240, x: 3232, endX: 3229 });
        // Three logs: three lights, not four. Two logs: two lights, from the start nearest the bot.
        expect(pick(kit, 3, [], onlyRow)).toEqual({ z: 3240, x: 3231, endX: 3229 });
        expect(pick(kit, 2, [], onlyRow)).toEqual({ z: 3240, x: 3230, endX: 3229 });
    });

    test('among equal lines takes the one nearest the bot', () => {
        const far = kit.player({ at: { x: CENTRE.x, z: CENTRE.z + 4 } });
        expect(pick(far, 3)?.z).toBe(CENTRE.z + 4);
    });

    test('ignores tiles further than 15 from the bot, where a fire would go unseen', () => {
        // A 41-wide row: only x 3221..3250 (area edge), within 15 of the bot, can be used: 30 tiles, 29 lights.
        const east = kit.player({ at: { x: 3236, z: CENTRE.z } });
        const wide = { ...AREA, radius: 20 };
        const line = pick(east, 40, [], (_x, z) => z !== 3240, wide);
        expect(line).toEqual({ z: 3240, x: 3250, endX: 3222 });
    });

    test('skips bad tiles and returns null with none left', () => {
        expect(pick(kit, 3, ['3230,3240'])?.x).not.toBe(3230);
        expect(pick(kit, 3, [], () => true)).toBeNull();
    });
});
