// walkTo from where the ground pathfinder has no route out: a raised agility course section, and the
// inside of the Gnome Stronghold's fence (the way in is the travel task's gnome-gate step).
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { LEAVE_ATTEMPT_TICKS } from '../../actions/course';
import { GATE_OUT_TICKS, walkTo, type WalkResult } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { world } from '../world';

/** The Stronghold's fence in the test world: everything north of the gate row z 3385, within the flood's box. */
const fenced = (x: number, z: number) => z >= 3385 && z <= 3500 && x >= 2400 && x <= 2500;
const fence = (blocked?: { x: number; z: number }) =>
    fakePaths(
        (from, to) => ({ success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] }),
        [],
        (x, z) => x === blocked?.x && z === blocked.z,
        (x, z, dx, dz) => fenced(x, z) !== fenced(x + dx, z + dz),
    );

const AGILITY = 'Agility';
const OUTSIDE = { x: 2500, z: 3370 };
const THROUGH = { x: 2461, z: 3382 };
const onCourse = (at: { x: number; z: number; level: number }) =>
    world()
        .skill(AGILITY, 1, 0)
        .loc('Gate', 2459, 3383, { options: ['Open'] })
        .loc('Tree branch', 2486, 3419, { level: 2, options: ['Climb-down'] })
        .loc('Tree branch', 2473, 3422, { level: 1, options: ['Climb'] })
        .loc('Balancing rope', 2478, 3420, { level: 2, options: ['Walk-on'] })
        .player({ at });

/**
 * The world as the course and the gate answer: the rope carries the bot east on plane 2, the branches change plane
 * (and pay Agility XP), the gate puts it south of the fence.
 */
function react(opts: { fail?: boolean; gate?: boolean } = {}) {
    const stroll = walking();
    let xp = 0;
    return (a: BotAction, s: BotWorldState): Effect | undefined => {
        if (a.type !== 'interactLoc') return stroll(a, s);
        if (a.x === 2459) return opts.gate === false ? undefined : t => world(t).player({ at: THROUGH }).build();
        if (opts.fail) return undefined;
        const to =
            a.x === 2473
                ? { x: 2473, z: 3420, level: 2 }
                : a.x === 2478
                  ? { x: 2483, z: 3420, level: 2 }
                  : { x: 2487, z: 3420, level: 0 };
        xp += 125;
        const total = xp;
        return t => world(t).player({ at: to }).skill(AGILITY, 1, total).build();
    };
}

async function walk(
    first: BotWorldState,
    to: { x: number; z: number },
    opts: { react?: ReturnType<typeof react>; stepBudget?: number; blocked?: { x: number; z: number } } = {},
) {
    const driver = new TimelineDriver([first], { react: opts.react ?? react() });
    const startTick = driver.state().tick;
    const paths = fence(opts.blocked);
    const ctx = {
        state: () => driver.state(),
        pathfinder: paths,
        stepTicksLeft: () =>
            opts.stepBudget === undefined ? undefined : startTick + opts.stepBudget - driver.state().tick,
    };
    const run = await interpret(walkTo(ctx, to.x, to.z, 3), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    const names = sends.map(a => (a.type === 'interactLoc' ? a.reason : `${a.type}`));
    const p = driver.state().player!;
    return { result: run.value as WalkResult, sends, names, paths, at: { x: p.worldX, z: p.worldZ, level: p.level } };
}

describe('walkTo off an agility course section', () => {
    test('from plane 2 it crosses the branch down, then leaves the fence by the gate and walks on', async () => {
        const w = await walk(onCourse({ x: 2483, z: 3420, level: 2 }).build(), OUTSIDE);
        expect(w.result.ok).toBe(true);
        expect(w.names.filter(n => n !== 'walkTo')).toEqual([
            expect.stringContaining('Climb-down'),
            expect.stringContaining('Open'),
        ]);
        expect(w.at).toMatchObject({ level: 0 });
        expect(Math.abs(w.at.x - OUTSIDE.x)).toBeLessThanOrEqual(3);
    });

    test('from the rope start it crosses the rope, then the branch', async () => {
        const w = await walk(onCourse({ x: 2473, z: 3420, level: 2 }).build(), OUTSIDE);
        expect(w.result.ok).toBe(true);
        const crossed = w.names.filter(n => /Walk-on|Climb-down/.test(n));
        expect(crossed).toEqual([expect.stringContaining('Walk-on'), expect.stringContaining('Climb-down')]);
    });

    test('an obstacle that does nothing fails the walk `stuck` after the attempts, nothing walked', async () => {
        const w = await walk(onCourse({ x: 2483, z: 3420, level: 2 }).build(), OUTSIDE, {
            react: react({ fail: true }),
        });
        expect(w.result).toMatchObject({ ok: false, reason: 'stuck' });
        expect(w.result.ok === false && w.result.message).toContain('course');
        expect(w.names.some(n => n === 'walkTo')).toBe(false);
    });

    test('with too few ticks left for an obstacle it is no-time and sends nothing', async () => {
        const w = await walk(onCourse({ x: 2483, z: 3420, level: 2 }).build(), OUTSIDE, {
            stepBudget: LEAVE_ATTEMPT_TICKS,
        });
        expect(w.result).toMatchObject({ ok: false, reason: 'no-time' });
        expect(w.sends).toEqual([]);
    });
});

const inside = (at = { x: 2484, z: 3437 }) => onCourse({ ...at, level: 0 }).build();

describe('walkTo out of the Gnome Stronghold fence', () => {
    test('to a destination outside it walks to the gate, opens it, then walks on', async () => {
        const w = await walk(inside(), OUTSIDE);
        expect(w.result.ok).toBe(true);
        const first = w.sends[0];
        expect(first).toMatchObject({ type: 'walkTo' });
        const open = w.names.findIndex(n => /Open/.test(n));
        expect(open).toBeGreaterThan(0);
        expect(w.paths.queries[0]?.to).toEqual({ x: 2461, z: 3385 });
        expect(w.paths.queries.at(-1)?.to).toEqual(OUTSIDE);
    });

    test('to a destination inside the fence it does not touch the gate', async () => {
        const w = await walk(inside(), { x: 2474, z: 3440 });
        expect(w.result.ok).toBe(true);
        expect(w.names.some(n => /Open/.test(n))).toBe(false);
    });

    test('to a blocked tile inside the fence (a booth or tree) it does not touch the gate', async () => {
        const blocked = { x: 2480, z: 3440 };
        const w = await walk(inside(), blocked, { blocked });
        expect(w.result.ok).toBe(true);
        expect(w.names.some(n => /Open/.test(n))).toBe(false);
    });

    test('a bot outside the fence walks as before', async () => {
        const w = await walk(inside({ x: 2480, z: 3380 }), OUTSIDE);
        expect(w.result.ok).toBe(true);
        expect(w.names.some(n => /Open/.test(n))).toBe(false);
        expect(w.paths.queries).toHaveLength(1);
    });

    test('a gate that stays shut fails the walk `stuck` with the gate in the message', async () => {
        const w = await walk(inside(), OUTSIDE, { react: react({ gate: false }) });
        expect(w.result).toMatchObject({ ok: false, reason: 'stuck' });
        expect(w.result.ok === false && w.result.message).toContain('Gnome Stronghold gate');
    });

    test('with too few ticks left for the gate it is no-time before opening it', async () => {
        const w = await walk(inside({ x: 2462, z: 3386 }), OUTSIDE, { stepBudget: GATE_OUT_TICKS + 2 });
        expect(w.result).toMatchObject({ ok: false, reason: 'no-time' });
        expect(w.names.some(n => /Open/.test(n))).toBe(false);
    });
});
