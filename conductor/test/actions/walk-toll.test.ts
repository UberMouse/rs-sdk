// walkTo through the Al Kharid toll gate (toll.ts): pays the 10 coins when it can, routes round when it cannot.
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { TOLL_FEE } from '../../actions/toll';
import { walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { door, fakePaths } from '../paths';
import { walking } from '../react';
import { world } from '../world';

type Tile = { x: number; z: number };
const WEST = { x: 3262, z: 3228 };
const EAST = { x: 3274, z: 3228 };
const GATES = [door(3268, 3227), door(3268, 3228)];
const CHOICE = ["No thank you, I'll walk around.", 'Who does my money go to?', 'Yes, ok.'];
const route = (...tiles: Tile[]) => tiles.map(t => ({ ...t, level: 0 }));
/** The fence line between x 3267 and 3268 from z 3200 to 3260 is shut; the detour north of it is open. */
const wall = (from: Tile, to: Tile) => from.x < 3268 !== to.x < 3268 && to.z < 3260;
/** Straight through the gate, or the detour north when the gate doors are avoided. */
const paths = () =>
    fakePaths(
        (from, to, avoid) => ({
            success: true,
            reachedDestination: true,
            waypoints: route(
                ...(avoid.length && from.x < 3268 !== to.x < 3268
                    ? [{ x: from.x, z: 3300 }, { x: to.x, z: 3300 }, to]
                    : [to]),
            ),
        }),
        GATES,
    );

function setup(at: Tile, coins: number) {
    let w = world()
        .player({ at })
        .loc('Gate', 3268, 3227, { options: ['Open'] })
        .loc('Gate', 3268, 3228, { options: ['Open'] });
    if (coins) w = w.inv('Coins', coins);
    return w.series(1);
}

const dest = (s: BotWorldState) => ({ x: s.player!.worldX < 3268 ? 3268 : 3267, z: s.player!.worldZ });

async function walk(
    at: Tile,
    to: Tile,
    coins: number,
    opts: { free?: boolean; choice?: string[]; pathfinder?: ReturnType<typeof paths> } = {},
) {
    const pf = opts.pathfinder ?? paths();
    let toll = 0;
    const stroll = walking(
        (a: BotAction, s: BotWorldState): Effect | undefined => {
            if (a.type === 'interactLoc') {
                if (opts.free)
                    return t =>
                        world(t)
                            .player({ at: dest(s) })
                            .build();
                return t =>
                    world(t)
                        .dialog({ options: opts.choice ?? CHOICE })
                        .build();
            }
            if (a.type === 'clickDialogOption') {
                toll++;
                return t =>
                    world(t)
                        .dialog(false)
                        .player({ at: dest(s) })
                        .inv('Coins', Math.max(0, coins - TOLL_FEE))
                        .build();
            }
            return undefined;
        },
        (f, t) => wall(f, t),
    );
    const driver = new TimelineDriver(setup(at, coins), { react: stroll });
    const ctx = { state: () => driver.state(), pathfinder: pf };
    const run = await interpret(walkTo(ctx, to.x, to.z, 0), { driver });
    if (run.kind !== 'returned') throw new Error(JSON.stringify(run));
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    const p = driver.state().player!;
    return { result: run.value, sends, pf, tolls: () => toll, at: { x: p.worldX, z: p.worldZ }, state: driver.state() };
}

describe('walkTo through the Al Kharid toll gate', () => {
    test('west to east: pays the toll, clicking "Yes, ok." and nothing else', async () => {
        const r = await walk(WEST, EAST, 100);
        expect(r.result.ok).toBe(true);
        expect(r.at).toEqual(EAST);
        expect(r.tolls()).toBe(1);
        const clicks = r.sends.filter(a => a.type === 'clickDialogOption');
        expect(clicks).toEqual([{ type: 'clickDialogOption', optionIndex: 2, reason: 'pay the toll' }]);
        expect(r.state.inventory.find(i => /coins/i.test(i.name))?.count).toBe(90);
    });

    test('east to west pays too', async () => {
        const r = await walk(EAST, WEST, 10);
        expect(r.result.ok).toBe(true);
        expect(r.at).toEqual(WEST);
        expect(r.tolls()).toBe(1);
    });

    test('a bot that is let through free (no choice) just arrives', async () => {
        const r = await walk(WEST, EAST, 50, { free: true });
        expect(r.result.ok).toBe(true);
        expect(r.tolls()).toBe(0);
    });

    test('with under 10 coins the route avoids the gate and no Open is sent', async () => {
        const r = await walk(WEST, EAST, 9);
        expect(r.result.ok).toBe(true);
        expect(r.at).toEqual(EAST);
        expect(r.sends.some(a => a.type === 'interactLoc')).toBe(false);
        expect(r.pf.queries[0]!.avoid.map(d => d.z).sort()).toEqual([3227, 3228]);
    });

    test('with no coins at all it also goes round', async () => {
        const r = await walk(EAST, WEST, 0);
        expect(r.result.ok).toBe(true);
        expect(r.sends.some(a => a.type === 'interactLoc')).toBe(false);
    });

    test('with enough coins the first route does not avoid the gate', async () => {
        const r = await walk(WEST, EAST, 10);
        expect(r.pf.queries[0]!.avoid).toEqual([]);
    });
});

describe('walkTo beside the toll gate', () => {
    test('pays once: the second gate loc on the route is not paid after passing', async () => {
        const r = await walk(WEST, EAST, 100);
        expect(r.sends.filter(a => a.type === 'clickDialogOption')).toHaveLength(1);
        expect(r.sends.filter(a => a.type === 'interactLoc')).toHaveLength(1);
    });

    test('a bot already on its destination side opens nothing', async () => {
        const r = await walk(WEST, { x: 3250, z: 3228 }, 100);
        expect(r.sends.some(a => a.type === 'interactLoc')).toBe(false);
    });
});

describe('walkTo a destination on the bot own side whose route goes through the gate', () => {
    // Al Kharid's north is only reachable round the west side: the route crosses the gate and comes back
    // east north of the wall (the replay of 2026-10-16T07-20-11 travel, which stood stuck at the gate).
    const NORTH_EAST = { x: 3274, z: 3330 };
    const loop = () =>
        fakePaths(
            () => ({
                success: true,
                reachedDestination: true,
                waypoints: route({ x: 3268, z: 3227 }, { x: 3267, z: 3227 }, { x: 3265, z: 3265 }, NORTH_EAST),
            }),
            GATES,
        );

    test('pays the toll on the way out and arrives', async () => {
        const r = await walk(EAST, NORTH_EAST, 100, { pathfinder: loop() });
        expect(r.result.ok).toBe(true);
        expect(r.tolls()).toBe(1);
        expect(r.sends.filter(a => a.type === 'interactLoc')).toHaveLength(1);
    });

    test('with no coins it asks for a route round the gate instead', async () => {
        const r = await walk(EAST, NORTH_EAST, 5, { pathfinder: loop() });
        expect(r.sends.some(a => a.type === 'interactLoc')).toBe(false);
        expect(r.pf.queries[0]!.avoid.map(d => d.z).sort()).toEqual([3227, 3228]);
    });
});
