// A run's walks to one target end `no-progress` when the best distance to it has not improved for NO_PROGRESS_TICKS
// (the gnome maze railing / Ent bounce: every walk and hop ends differently, so nothing else stops it); a plane change,
// a made move or a closer tile is progress.
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { NO_PROGRESS_TICKS, type WalkOptions, type WalkResult, walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { send, ticks } from '../../core/op';
import { onlyConnectors, straightPaths } from '../paths';
import { walking } from '../react';
import { castle, floorLocs } from '../stairs';
import { world } from '../world';

type React = (a: BotAction, s: BotWorldState) => Effect | undefined;
type Tile = { x: number; z: number };
const TARGET = { x: 3200, z: 3200 };
const start = (at: { x: number; z: number }, level = 0): BotWorldState => ({
    ...world()
        .player({ at: { ...at, level } })
        .build(),
    nearbyLocs: floorLocs(level),
});

/** Every walk the bot sends puts it on the next tile of `route` (the last repeats): a world that moves the bot by script. */
const scripted = (route: { x: number; z: number }[]): React => {
    let i = 0;
    return () => {
        const at = route[Math.min(++i, route.length - 1)]!;
        return s => world(s).player({ at }).build();
    };
};

async function walkAll(first: BotWorldState, react: React, maxWalks: number, to = TARGET) {
    const driver = new TimelineDriver([first], { react });
    const ctx = { state: () => driver.state(), pathfinder: straightPaths(), walkWorld: onlyConnectors() };
    const results: WalkResult[] = [];
    for (let i = 0; i < maxWalks; i++) {
        const run = await interpret(walkTo(ctx, to.x, to.z, 1), { driver });
        if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
        results.push(run.value as WalkResult);
        const r = results[i]!;
        if (r.ok || r.reason === 'no-progress') break;
    }
    return { results, driver };
}

/** One bot to walk several times, with idle ticks between the walks. */
function rig(react: React, first = start(A)) {
    const driver = new TimelineDriver([first], { react });
    const ctx = { state: () => driver.state(), pathfinder: straightPaths(), walkWorld: onlyConnectors() };
    return {
        driver,
        async walk(to = TARGET, opts: WalkOptions = {}): Promise<WalkResult> {
            const run = await interpret(walkTo(ctx, to.x, to.z, 1, opts), { driver });
            if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
            return run.value as WalkResult;
        },
        async idle(n: number) {
            await interpret(ticks(n), { driver });
        },
    };
}

/** Moves one tile each walk the bot sends, between A and B: no net progress, a walk of a few ticks. */
const bouncing = (jump = 0, at: [Tile, Tile] = [A, B]): React => {
    let n = 0;
    return () => {
        n++;
        return s => ({
            ...world(s)
                .player({ at: n % 2 ? at[1] : at[0] })
                .build(),
            tick: s.tick + jump,
        });
    };
};

const isNoProgress = (r: WalkResult) => !r.ok && r.reason === 'no-progress';

/** Ticks past NO_PROGRESS_TICKS a failure may come: the walk in progress and the one before it finish first. */
const SLACK_TICKS = 200;
const HOME = { x: 3240, z: 3222 };
const A = { x: 3260, z: 3200 };
const B = { x: 3262, z: 3200 };

/** Legs moving away from the target from `from`, and legs back toward `to` two tiles at a time. */
const away = (from: number) => Array.from({ length: 90 }, (_, i) => ({ x: from + i, z: 3200 }));
const back = (from: number, to: number) =>
    Array.from({ length: (from - to) / 2 }, (_, i) => ({ x: from - 2 * (i + 1), z: 3200 }));

describe('a walk with no net progress', () => {
    test('bouncing between two tiles ends no-progress within the bound, naming the target, best distance and hops', async () => {
        const route = Array.from({ length: 400 }, (_, i) => (i % 2 ? B : A));
        const { results, driver } = await walkAll(start(A), scripted(route), 300);
        const last = results[results.length - 1]!;
        expect(last.ok).toBe(false);
        if (last.ok) return;
        expect(last.reason).toBe('no-progress');
        expect(last.message).toContain('(3200, 3200)');
        expect(last.message).toContain('best distance 60 tiles');
        // It fails once the bound has passed, not much later (a walk is a few ticks).
        expect(driver.state().tick).toBeLessThan(NO_PROGRESS_TICKS + SLACK_TICKS);
        expect(driver.state().tick).toBeGreaterThan(NO_PROGRESS_TICKS);
    });

    test('detours that each end closer than the last pass, though together they outlast the bound', async () => {
        // Away from the target, then back past the best so far, twice: each return is progress and restarts the clock.
        const route = [...away(3260), ...back(3349, 3230), ...away(3230), ...back(3319, 3200)];
        const { results, driver } = await walkAll(start(A), scripted(route), 400);
        expect(results[results.length - 1]!.ok).toBe(true);
        expect(driver.state().tick).toBeGreaterThan(NO_PROGRESS_TICKS);
    }, 30_000);

    test('a route that changes plane is progress, however far the stairs lead from the target', async () => {
        // The castle's stairs to the first floor, the bot far from the target and stalled on the ground floor for
        // nearly the bound: the climb must restart the clock, or the next hop would fail.
        let climbing = false;
        const stairs = walking(castle());
        const bounce = bouncing(0, [HOME, { x: 3241, z: 3222 }]);
        const react: React = (a, s) => (climbing ? stairs(a, s) : bounce(a, s));
        const t = rig(react, start(HOME));
        const to = { x: 3207, z: 3212 };
        const walk = () => t.walk(to, { level: 1 });
        // Stall: walks that go nowhere, 98 idle ticks apart (inside the gap that restarts the record).
        let stalled = 0;
        while (t.driver.state().tick < NO_PROGRESS_TICKS - 20) {
            const r = await walk();
            expect(r && !r.ok && r.reason).not.toBe('no-progress');
            stalled++;
            await t.idle(98);
        }
        expect(stalled).toBeGreaterThan(2);
        climbing = true;
        const last = await walk();
        expect(last?.ok).toBe(true);
        expect(t.driver.state().tick).toBeGreaterThan(NO_PROGRESS_TICKS);
    });

    test('a second walk right after a no-progress failure fails at once', async () => {
        const t = rig(bouncing(120));
        const first = await t.walk();
        expect(first.ok).toBe(false);
        let r = first;
        for (let i = 0; i < 10 && !isNoProgress(r); i++) r = await t.walk();
        expect(isNoProgress(r)).toBe(true);
        const at = t.driver.state().tick;
        const again = await t.walk();
        expect(isNoProgress(again)).toBe(true);
        expect(t.driver.state().tick).toBe(at);
    });

    test('long legs (each walk over the idle gap) bouncing still fail', async () => {
        // Each walk lasts 240 ticks, more than the 100-tick gap: the gap is idle time between walks, not walk time.
        const t = rig(bouncing(120));
        const results: WalkResult[] = [];
        for (let i = 0; i < 6 && !results.some(isNoProgress); i++) results.push(await t.walk());
        const last = results[results.length - 1]!;
        expect(isNoProgress(last)).toBe(true);
        expect(t.driver.state().tick).toBeLessThan(NO_PROGRESS_TICKS + 2 * 250);
    });

    test('walks to one target 99 idle ticks apart add up; 101 apart each start afresh', async () => {
        const close = rig(bouncing());
        let r: WalkResult | undefined;
        for (let i = 0; i < 12 && !(r && isNoProgress(r)); i++) {
            r = await close.walk();
            await close.idle(99);
        }
        expect(r && isNoProgress(r)).toBe(true);

        const far = rig(bouncing());
        for (let i = 0; i < 12; i++) {
            expect(isNoProgress(await far.walk())).toBe(false);
            await far.idle(101);
        }
        expect(far.driver.state().tick).toBeGreaterThan(NO_PROGRESS_TICKS);
    });

    test('a new target restarts the record', async () => {
        const t = rig(bouncing(120));
        let r = await t.walk();
        for (let i = 0; i < 10 && !isNoProgress(r); i++) r = await t.walk();
        expect(isNoProgress(r)).toBe(true);
        expect(isNoProgress(await t.walk({ x: 3201, z: 3200 }))).toBe(false);
    });

    test('arriving clears the record', async () => {
        let mode: 'bounce' | 'arrive' | 'reset' = 'bounce';
        const bounce = bouncing();
        const react: React = (a, s) => {
            if (mode === 'bounce') return bounce(a, s);
            const at = mode === 'arrive' ? TARGET : A;
            return st => world(st).player({ at }).build();
        };
        const t = rig(react);
        // 3 stalled walks 90 idle ticks apart: well into the bound, not past it.
        for (let i = 0; i < 3; i++) {
            expect(isNoProgress(await t.walk())).toBe(false);
            await t.idle(90);
        }
        mode = 'arrive';
        expect((await t.walk()).ok).toBe(true);
        mode = 'reset';
        await interpret(send({ type: 'walkTo', x: A.x, z: A.z, reason: 'test' }), { driver: t.driver });
        mode = 'bounce';
        // Another 4 stalled walks: together with the first 3 they pass the bound, so only a cleared record lets them by.
        for (let i = 0; i < 4; i++) {
            expect(isNoProgress(await t.walk())).toBe(false);
            await t.idle(90);
        }
        expect(t.driver.state().tick).toBeGreaterThan(NO_PROGRESS_TICKS);
    });

    test('the message names the target, and says it never reached the plane', async () => {
        const t = rig(bouncing(0, [HOME, { x: 3241, z: 3222 }]), start(HOME));
        let r = await t.walk({ x: 3207, z: 3212 }, { level: 1 });
        for (let i = 0; i < 20 && !isNoProgress(r); i++) {
            await t.idle(90);
            r = await t.walk({ x: 3207, z: 3212 }, { level: 1 });
        }
        expect(isNoProgress(r)).toBe(true);
        if (r.ok) return;
        expect(r.message).toContain('(3207, 3212) level 1');
        expect(r.message).toContain('never on its plane');
    });
});
