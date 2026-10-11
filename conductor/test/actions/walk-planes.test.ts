// walkTo to another plane (a floor above or below, an underground area): through lib/connectors.ts.
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { CLIMB_MAX_TICKS } from '../../actions/climb';
import { type WalkOptions, type WalkResult, walkTo, timedOutAdvancing } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { straightPaths } from '../paths';
import { walking } from '../react';
import { castle, floorLocs, LANDING } from '../stairs';
import { world } from '../world';

interface Run extends WalkOptions {
    react?: (action: BotAction, state: BotWorldState) => Effect | undefined;
    stepBudget?: number;
    /** Steps the bot cannot take (walls), as `walking` takes them. */
    blocked?: Parameters<typeof walking>[1];
}

/** Walks from `first` to (x, z), the world reacting as `react` (default Lumbridge castle). */
async function walk(first: BotWorldState, x: number, z: number, opts: Run = {}, tolerance = 2) {
    const driver = new TimelineDriver([first], { react: walking(opts.react ?? castle(), opts.blocked) });
    const startTick = driver.state().tick;
    const paths = straightPaths();
    const ctx = {
        state: () => driver.state(),
        pathfinder: paths,
        stepTicksLeft: () =>
            opts.stepBudget === undefined ? undefined : startTick + opts.stepBudget - driver.state().tick,
    };
    const { level, maxTicks, reserveTicks } = opts;
    const run = await interpret(walkTo(ctx, x, z, tolerance, { level, maxTicks, reserveTicks }), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    const options = sends.flatMap(s => (s.type === 'interactLoc' ? [s.optionIndex] : []));
    const p = driver.state().player!;
    return {
        result: run.value as WalkResult,
        sends,
        options,
        paths,
        driver,
        at: { level: p.level, x: p.worldX, z: p.worldZ },
    };
}

const ground = world().player({ at: { x: 3222, z: 3222, level: 0 } });
const onFloor = (level: number, x = LANDING.x, z = LANDING.z) => ({
    ...world().player({ at: { x, z, level } }).build(),
    nearbyLocs: floorLocs(level),
});
const castleGround = () => ({ ...ground.build(), nearbyLocs: floorLocs(0) });

describe('walkTo across levels: Lumbridge castle', () => {
    test('to the first floor: walks to the stairs, climbs once, walks on up there', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1 });
        expect(w.result).toEqual({ ok: true, message: 'Arrived' });
        expect(w.options).toEqual([1]);
        expect(w.at.level).toBe(1);
        expect(w.paths.queries[0]).toMatchObject({ to: LANDING });
        expect(w.driver.commands.some(c => c.type === 'log' && /climbed up/.test(c.msg))).toBe(true);
    });

    test('to the top floor: two climbs, the middle floor by its Climb-up option', async () => {
        const w = await walk(castleGround(), 3207, 3212, { level: 2 });
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([1, 2]);
        expect(w.at.level).toBe(2);
    });

    test('down from the top floor to the ground: Climb-down on the top, op 3 in the middle', async () => {
        const w = await walk(onFloor(2), 3222, 3222, { level: 0 });
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([1, 3]);
        expect(w.at.level).toBe(0);
        expect(Math.abs(w.at.x - 3222)).toBeLessThanOrEqual(2);
    });

    test("a destination on the bot's own level walks as before: no climb", async () => {
        const w = await walk(onFloor(1), 3205, 3228);
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([]);
    });

    test('a destination tile on the same x and z but another level is not "already there"', async () => {
        const w = await walk(onFloor(0), LANDING.x, LANDING.z, { level: 1 });
        expect(w.result.ok).toBe(true);
        expect(w.at.level).toBe(1);
        expect(w.options).toEqual([1]);
    });
});

describe('walkTo across levels: failures', () => {
    test('a level no connector leads to is no-connector, nothing sent', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 3 });
        expect(w.result).toMatchObject({ ok: false, reason: 'no-connector' });
        expect(w.result.message).toContain('level 3');
        expect(w.sends).toEqual([]);
    });

    test('a staircase the server refuses is climb-failed', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1, react: castle({ stuck: true }) });
        expect(w.result).toMatchObject({ ok: false, reason: 'climb-failed' });
        expect(w.result.message).toContain('Lumbridge castle stairs');
        expect(w.options).toEqual([1]);
    });

    test('a staircase out of sight is climb-failed, saying no loc', async () => {
        const w = await walk({ ...castleGround(), nearbyLocs: [] }, 3205, 3228, { level: 1 });
        expect(w.result).toMatchObject({ ok: false, reason: 'climb-failed' });
        expect(w.result.message).toContain('in sight');
    });

    test('a step with no ticks left is no-time; running out on the way is an advancing timeout', async () => {
        const none = await walk(castleGround(), 3205, 3228, { level: 1, stepBudget: 3 });
        expect(none.result).toMatchObject({ ok: false, reason: 'no-time' });
        expect(none.sends).toEqual([]);
        // Room for the leg to the stairs but not for the climb: the walk keeps CLIMB_MAX_TICKS back.
        const short = await walk(castleGround(), 3205, 3228, { level: 1, maxTicks: 4 });
        expect(short.result).toMatchObject({ ok: false, reason: 'timeout', advancing: true });
        expect(timedOutAdvancing(short.result, 1, 2)).toBe(true);
        expect(short.options).toEqual([]);
    });

    test('the climb is reserved out of the walk to the stairs, not of the last leg', async () => {
        // A step budget covering the leg to the stairs plus the climb and the last leg.
        const w = await walk(castleGround(), 3205, 3228, { level: 1, stepBudget: 200, reserveTicks: 3 });
        expect(w.result.ok).toBe(true);
        expect(CLIMB_MAX_TICKS).toBeGreaterThan(10);
    });
});

const stairsDown = (s: BotWorldState) => ({
    ...s,
    nearbyLocs: world(s)
        .loc('Staircase', 3059, 3376, { options: ['Climb-down'] })
        .build().nearbyLocs,
});
const intoMine: Run['react'] = action =>
    action.type === 'interactLoc'
        ? s => ({
              ...world(s)
                  .player({ at: { x: 3058, z: 9776, level: 0 } })
                  .build(),
              nearbyLocs: [],
          })
        : undefined;

describe('walkTo into and out of underground areas', () => {
    test('Nurmof from the surface: to the Falador stairs, down, then along the mine (no level given)', async () => {
        const start = stairsDown(
            world()
                .player({ at: { x: 3070, z: 3380, level: 0 } })
                .build(),
        );
        const w = await walk(start, 2998, 9844, { react: intoMine });
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([1]);
        expect(w.at.z).toBeGreaterThan(9000);
        expect(w.paths.queries[0]).toMatchObject({ to: { x: 3062, z: 3376 } });
    });

    test('a floor of some other building has no stairs to the mine: no-connector', async () => {
        const start = world()
            .player({ at: { x: 3070, z: 3380, level: 1 } })
            .build();
        const w = await walk(start, 2998, 9844, { level: 0, react: intoMine });
        expect(w.result).toMatchObject({ ok: false, reason: 'no-connector' });
    });

    test('going down the mine stairs logs the scorpion warning before the climb', async () => {
        const start = stairsDown(
            world()
                .player({ at: { x: 3070, z: 3380, level: 0 } })
                .build(),
        );
        const w = await walk(start, 2998, 9844, { react: intoMine });
        const logs = w.driver.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
        const warn = logs.findIndex(m => /WARNING.*Falador mine stairs.*scorpions/.test(m));
        expect(warn).toBeGreaterThanOrEqual(0);
        expect(logs.findIndex(m => /climbed down/.test(m))).toBeGreaterThan(warn);
    });

    test('the lowest-risk stairs log nothing: Lumbridge castle has no hazard', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1 });
        expect(w.driver.commands.some(c => c.type === 'log' && /WARNING/.test(c.msg))).toBe(false);
    });

    test('inside the mine to a tile in the mine is an ordinary walk', async () => {
        const start = world()
            .player({ at: { x: 3058, z: 9776, level: 0 } })
            .build();
        const w = await walk(start, 2998, 9844);
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([]);
    });
});

// The way back out of the mine, and from the mine to the tower basement: up the stairs, then on the surface.
const SURFACE_LANDING = { x: 3062, z: 3376 };
const BASEMENT_LANDING = { x: 3104, z: 9576 };
const mineStairsUp = { x: 3059, z: 9776 };
const towerLadder = { x: 3104, z: 3162 };
const surfaceLocs = (at: { x: number; z: number }) =>
    world()
        .player({ at: { ...at, level: 0 } })
        .loc('Ladder', towerLadder.x, towerLadder.z, { options: ['Climb-down'] })
        .build().nearbyLocs;
/** The mine stairs up lead to the Falador surface, the tower ladder down to the basement. */
const mineAndTower: Run['react'] = action => {
    if (action.type !== 'interactLoc') return undefined;
    if (action.x === mineStairsUp.x && action.z === mineStairsUp.z)
        return s => ({
            ...world(s)
                .player({ at: { ...SURFACE_LANDING, level: 0 } })
                .build(),
            nearbyLocs: surfaceLocs(SURFACE_LANDING),
        });
    if (action.x === towerLadder.x && action.z === towerLadder.z)
        return s => ({
            ...world(s)
                .player({ at: { ...BASEMENT_LANDING, level: 0 } })
                .build(),
            nearbyLocs: [],
        });
    return undefined;
};
const inMine = (x = 3058, z = 9776) => ({
    ...world()
        .player({ at: { x, z, level: 0 } })
        .loc('Staircase', mineStairsUp.x, mineStairsUp.z, { options: ['Climb-up'] })
        .build(),
});

describe('walkTo out of the mine and to the tower basement', () => {
    test('mine to Falador: to the stairs, up, then along the surface', async () => {
        const w = await walk(inMine(3050, 9780), 3000, 3376, { react: mineAndTower });
        expect(w.result.ok).toBe(true);
        expect(w.options).toEqual([1]);
        expect(w.at.z).toBeLessThan(6400);
        expect(w.paths.queries[0]).toMatchObject({ to: { x: 3058, z: 9776 } });
    });

    test('mine to the basement: up the stairs, across the surface, down the ladder', async () => {
        const w = await walk(inMine(), 3104, 9577, { react: mineAndTower });
        expect(w.result).toEqual({ ok: true, message: expect.any(String) });
        expect(w.options).toEqual([1, 1]);
        expect(w.paths.queries.some(q => q.to.x === 3105 && q.to.z === 3162)).toBe(true);
        expect(w.at).toMatchObject({ level: 0, x: 3104 });
        expect(w.at.z).toBeGreaterThan(9000);
    });

    test('a leg to the next stand tile that runs out of steps after a climb is an advancing timeout, not no-time', async () => {
        // Budget: the walk keeps the climb's ticks back, so after the first climb little is left.
        const w = await walk(inMine(), 3104, 9577, { react: mineAndTower, stepBudget: 3 + CLIMB_MAX_TICKS });
        expect(w.result).toMatchObject({ ok: false, reason: 'timeout', advancing: true });
        expect(w.options).toEqual([1]);
        expect(w.result.message).toMatch(/No time to walk/);
        expect(timedOutAdvancing(w.result, 100, 100)).toBe(true);
    });
});

describe('a timeout on the way to the stairs: advancing only when it made progress', () => {
    test('closing in on the stand tile is advancing', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1, maxTicks: 4 });
        expect(w.result).toMatchObject({ ok: false, reason: 'timeout', advancing: true });
    });

    test('a bot that cannot move leaves it unset, so callers count the failure', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1, maxTicks: 4, blocked: () => true });
        expect(w.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect((w.result as { advancing?: boolean }).advancing).toBeUndefined();
        expect(timedOutAdvancing(w.result, 17, 17)).toBe(false);
        expect(w.options).toEqual([]);
    });

    test('after a climb, a timeout on the next leg is advancing even without closing in', async () => {
        const w = await walk(inMine(), 3104, 9577, { react: mineAndTower, maxTicks: 8 });
        expect(w.result).toMatchObject({ ok: false, reason: 'timeout', advancing: true });
        expect(w.options).toEqual([1]);
    });

    test('a timeout that made no progress and no-time at the start stay as they are', async () => {
        const w = await walk(castleGround(), 3205, 3228, { level: 1, stepBudget: 3 });
        expect(w.result).toMatchObject({ ok: false, reason: 'no-time' });
    });
});
