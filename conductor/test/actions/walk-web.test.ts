import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { collisionPaths, withDoorStops } from '../../actions/paths';
import { DOOR_OPEN_TICKS, WEB_SLASH_ATTEMPTS, type WalkResult, walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { door, fakePaths } from '../paths';
import { walking } from '../react';
import { world } from '../world';

// A web across a corridor at (3210, 3205), the way a slashable web fills a Varrock Sewers corridor: its
// tile is a wall while the web stands (Slash option), open once slashed (a loc with no option).
type Tile = { x: number; z: number };
const START = { x: 3210, z: 3200 };
const DEST = { x: 3210, z: 3215 };
const WEB = door(3210, 3205);
const WEB_ID = 733;
const SLASHED_ID = 734;

const webWorld = () =>
    world()
        .player({ at: START })
        .loc('Web', WEB.x, WEB.z, { id: WEB_ID, options: ['Slash'] })
        .series(1);
const standing = (s: BotWorldState) =>
    s.nearbyLocs.some(l => l.x === WEB.x && l.z === WEB.z && l.optionsWithIndex.some(o => o.text === 'Slash'));
/** Crossing z 3205 is blocked while the web stands. */
const blocked = (from: Tile, to: Tile, s: BotWorldState) => from.z < WEB.z !== to.z < WEB.z && standing(s);
const route = fakePaths(
    () => ({
        success: true,
        reachedDestination: true,
        waypoints: [WEB, DEST].map(t => ({ x: t.x, z: t.z, level: 0 })),
    }),
    [WEB],
);
const slashed = world().loc('Slashed web', WEB.x, WEB.z, { id: SLASHED_ID, options: [] }).build().nearbyLocs[0]!;

/** Each Slash is answered in turn (the last repeats): 'cut' opens the web, 'fail' says so, 'blade' refuses, 'ignore' does nothing. */
type Answer = 'cut' | 'fail' | 'blade' | 'cant-reach' | 'ignore';
function slashAnswers(...answers: Answer[]) {
    let n = 0;
    return (action: BotAction): Effect | undefined => {
        if (action.type !== 'interactLoc' || action.reason !== 'Slash Web') return undefined;
        const answer = answers[Math.min(n++, answers.length - 1)]!;
        if (answer === 'ignore') return undefined;
        if (answer === 'cut')
            return s => ({
                ...s,
                nearbyLocs: s.nearbyLocs.map(l =>
                    l.x === WEB.x && l.z === WEB.z ? { ...slashed, distance: l.distance } : l,
                ),
            });
        const text = {
            fail: 'You fail to cut through it.',
            blade: 'Only a sharp blade can cut through this sticky web.',
            'cant-reach': "I can't reach that!",
        }[answer];
        let said = false;
        return s => {
            if (said) return s;
            said = true;
            return world(s).message(text).build();
        };
    };
}

async function walk(react: (a: BotAction) => Effect | undefined) {
    const driver = new TimelineDriver(webWorld(), { react: walking((a, _s) => react(a), blocked) });
    const ctx = { state: () => driver.state(), pathfinder: route };
    const run = await interpret(walkTo(ctx, DEST.x, DEST.z, 0), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const result: WalkResult = run.value;
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
    const logs = driver.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
    const p = driver.state().player!;
    return { result, sends, logs, at: { x: p.worldX, z: p.worldZ }, driver };
}

describe('walkTo: slashable webs', () => {
    test('a web on the route is slashed open, then walked through', async () => {
        const w = await walk(slashAnswers('cut'));
        expect(w.result).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends).toEqual(['Slash Web', 'walk to (3210, 3205)', 'walk to (3210, 3215)']);
        expect(w.logs).toContain('walk: slashed the Web at (3210, 3205)');
        expect(w.at).toEqual(DEST);
    });

    test('"You fail to cut through it." slashes again until the web opens', async () => {
        const w = await walk(slashAnswers('fail', 'fail', 'cut'));
        expect(w.result).toEqual({ ok: true, message: 'Arrived' });
        expect(w.sends.filter(s => s === 'Slash Web')).toHaveLength(3);
        expect(w.logs).toContain('walk: slashed the Web at (3210, 3205) in 3 attempts');
        expect(w.at).toEqual(DEST);
    });

    test('no slash weapon ends the walk no-blade after one slash, saying so', async () => {
        const w = await walk(slashAnswers('blade'));
        expect(w.result.ok).toBe(false);
        if (w.result.ok) return;
        expect(w.result.reason).toBe('no-blade');
        expect(w.result.message).toContain('No slash weapon');
        expect(w.result.message).toContain('(3210, 3205)');
        expect(w.sends.filter(s => s === 'Slash Web')).toHaveLength(1);
        expect(w.at).toEqual(START);
    });

    test('a web that never gives is slashed WEB_SLASH_ATTEMPTS times, then routed around (no other route: stuck)', async () => {
        const w = await walk(slashAnswers('fail'));
        expect(w.result.ok).toBe(false);
        expect(w.sends.filter(s => s === 'Slash Web').length).toBeGreaterThanOrEqual(WEB_SLASH_ATTEMPTS);
        expect(w.logs).toContain(
            `walk: web at (3210, 3205) not cut in ${WEB_SLASH_ATTEMPTS} slashes; routing around it`,
        );
    });

    test('a slash the server says it cannot reach is out of reach, not retried as a failed cut', async () => {
        const w = await walk(slashAnswers('cant-reach', 'cut'));
        expect(w.result.ok).toBe(true);
        expect(w.logs).toContain('walk: door at (3210, 3205) out of reach (attempt 1/3)');
    });

    test('a slash that nothing answers waits DOOR_OPEN_TICKS, then counts as out of reach', async () => {
        const w = await walk(slashAnswers('ignore'));
        expect(w.result.ok).toBe(false);
        expect(w.logs).toContain('walk: door at (3210, 3205) out of reach (attempt 1/3)');
        expect(w.driver.state().tick).toBeGreaterThanOrEqual(DOOR_OPEN_TICKS);
    });

    test('an unarmed stuck-fallback beside a web ends no-blade, not stuck or dead-end', async () => {
        const short = { x: 3210, z: 3202 };
        const partial = fakePaths(
            () => ({
                success: true,
                reachedDestination: false,
                waypoints: [{ ...short, level: 0 }],
            }),
            [WEB],
        );
        const driver = new TimelineDriver(webWorld(), { react: walking(slashAnswers('blade'), blocked) });
        const ctx = { state: () => driver.state(), pathfinder: partial };
        const run = await interpret(walkTo(ctx, DEST.x, DEST.z, 0), { driver });
        if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
        expect(run.value.ok).toBe(false);
        if (run.value.ok) return;
        expect(run.value.reason).toBe('no-blade');
        expect(run.value.message).toContain('(3210, 3205)');
    });

    test('a route crossing a Wilderness web from outside to outside is no-path, and nothing is slashed', async () => {
        const wildWeb = door(3147, 3727);
        const from = { x: 3147, z: 3500 };
        const to = { x: 3147, z: 3510 };
        const wild = fakePaths(
            () => ({
                success: true,
                reachedDestination: true,
                waypoints: [from, wildWeb, to].map(t => ({ x: t.x, z: t.z, level: 0 })),
            }),
            [wildWeb],
        );
        const driver = new TimelineDriver(
            world()
                .player({ at: from })
                .loc('Web', wildWeb.x, wildWeb.z, { id: WEB_ID, options: ['Slash'] })
                .series(1),
            { react: walking(slashAnswers('cut')) },
        );
        const run = await interpret(walkTo({ state: () => driver.state(), pathfinder: wild }, to.x, to.z, 0), {
            driver,
        });
        if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
        expect(run.value.ok).toBe(false);
        if (run.value.ok) return;
        expect(run.value.reason).toBe('no-path');
        expect(run.value.message).toContain('crosses the Wilderness');
        const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []));
        expect(sends).not.toContain('Slash Web');
    });

    test('a web already slashed is walked through with no Slash sent', async () => {
        const driver = new TimelineDriver(
            world().player({ at: START }).loc('Slashed web', WEB.x, WEB.z, { id: SLASHED_ID, options: [] }).series(1),
            { react: walking(() => undefined, blocked) },
        );
        const run = await interpret(walkTo({ state: () => driver.state(), pathfinder: route }, DEST.x, DEST.z, 0), {
            driver,
        });
        expect(run.kind === 'returned' && run.value.ok).toBe(true);
        expect(driver.commands.flatMap(c => (c.type === 'send' ? [c.action.reason] : []))).not.toContain('Slash Web');
    });
});

const at = (x: number, z: number) => ({ x, z, level: 0 });

describe('withDoorStops', () => {
    // The Varrock Sewers web at (3210, 9898) is in SLASH_WEBS.
    test('a web in the middle of a straight run gets a waypoint before it and one on it', () => {
        expect(withDoorStops([at(3210, 9902), at(3210, 9894)])).toEqual([
            at(3210, 9902),
            at(3210, 9899),
            at(3210, 9898),
            at(3210, 9894),
        ]);
    });

    test('a web at the end of a run gets the waypoint before it', () => {
        expect(withDoorStops([at(3210, 9902), at(3210, 9898)])).toEqual([
            at(3210, 9902),
            at(3210, 9899),
            at(3210, 9898),
        ]);
    });

    test('a web right after a waypoint needs no extra stop before it', () => {
        expect(withDoorStops([at(3210, 9899), at(3210, 9890)])).toEqual([
            at(3210, 9899),
            at(3210, 9898),
            at(3210, 9890),
        ]);
    });

    test('a route that misses every web is unchanged', () => {
        const missing = [at(3200, 9890), at(3205, 9895), at(3205, 9899)];
        expect(withDoorStops(missing)).toEqual(missing);
    });
});

describe('withDoorStops over the SDK door index', () => {
    // The Varrock west square alley (x 3213) ends in a double door at (3212, 3470) and (3213, 3470).
    test('the planned route from the alley mouth stops before the double door and on it', () => {
        const r = collisionPaths.findPath({ x: 3213, z: 3438, level: 0 }, { x: 3222, z: 3476 }, []);
        expect(r.reachedDestination).toBe(true);
        const stops = r.waypoints.filter(w => w.x === 3213 && w.z >= 3438 && w.z <= 3472).map(w => w.z);
        expect(stops).toContain(3469);
        expect(stops).toContain(3470);
        // The walk opens the door when a waypoint is beside it.
        expect(collisionPaths.doorsAlong(r.waypoints).some(d => d.x === 3213 && d.z === 3470)).toBe(true);
    });

    test('a route that crosses no door is unchanged', () => {
        const run = [at(3213, 3438), at(3213, 3456)];
        expect(withDoorStops(run)).toEqual(run);
    });
});
