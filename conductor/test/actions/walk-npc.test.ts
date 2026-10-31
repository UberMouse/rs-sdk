import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { type WalkResult, npcTiles, walkTo } from '../../actions/walk';
import { TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { type Router, fakePaths } from '../paths';
import { walking } from '../react';
import { world } from '../world';

// The Varrock lumber yard: the ladder's stand tile is north-east of the bot, and a "Crate" NPC (blockwalk)
// stands on the straight way (3307, 3507). The server's walk does not pass through an NPC, so a route through
// its tile leaves the bot where it stands ("Stuck at (3307, 3506)").
type Tile = { x: number; z: number };
const START = { x: 3307, z: 3506 };
const DEST = { x: 3309, z: 3509 };
const CRATE = { x: 3307, z: 3507 };
const lv = (t: Tile) => ({ ...t, level: 0 });

const crateWorld = () => world().player({ at: START }).npc('Crate', CRATE.x, CRATE.z).series(1);
/** An NPC's tile refuses the step, as the server does. */
const blockedByNpc = (_from: Tile, to: Tile, s: BotWorldState) => s.nearbyNpcs.some(n => n.x === to.x && n.z === to.z);

/** North through the crate's tile, or the way round it by (3306, 3507) when it is masked. */
const router: Router = (_from, to, _avoid, occupied = []) => {
    const through = occupied.some(t => t.x === CRATE.x && t.z === CRATE.z) ? [{ x: 3306, z: 3507 }] : [CRATE];
    return { success: true, reachedDestination: true, waypoints: [...through, to].map(lv) };
};

async function walk(paths: ReturnType<typeof fakePaths>) {
    const driver = new TimelineDriver(crateWorld(), { react: walking(undefined, blockedByNpc) });
    const ctx = { state: () => driver.state(), pathfinder: paths };
    const run = await interpret(walkTo(ctx, DEST.x, DEST.z, 0), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const result: WalkResult = run.value;
    const p = driver.state().player!;
    return { result, at: { x: p.worldX, z: p.worldZ } };
}

describe('walkTo: blockwalk NPCs on the route', () => {
    test('routes round the NPC standing on the way, asking the pathfinder to wall its tile', async () => {
        const paths = fakePaths(router);
        const w = await walk(paths);
        expect(w.result).toEqual({ ok: true, message: 'Arrived' });
        expect(w.at).toEqual(DEST);
        expect(paths.queries[0]!.occupied).toEqual([CRATE]);
        expect(paths.queries[0]!.occupied).not.toContainEqual(START);
    });

    test('with no route round the NPC, the plain route is walked (it moves when the NPC does)', async () => {
        const plain = fakePaths((_from, to, _avoid, occupied = []) =>
            occupied.length
                ? { success: true, reachedDestination: false, waypoints: [lv(START)] }
                : { success: true, reachedDestination: true, waypoints: [CRATE, to].map(lv) },
        );
        // The crate leaves at tick 4.
        const driver = new TimelineDriver(
            world()
                .player({ at: START })
                .series(40, (w, i) => (i < 4 ? w.npc('Crate', CRATE.x, CRATE.z) : w)),
            { react: walking(undefined, blockedByNpc) },
        );
        const ctx = { state: () => driver.state(), pathfinder: plain };
        const run = await interpret(walkTo(ctx, DEST.x, DEST.z, 0), { driver });
        expect(run.kind).toBe('returned');
        expect(plain.queries.some(q => q.occupied.length === 0 && q.from.x === START.x)).toBe(true);
    });

    test('no NPCs: the pathfinder is asked once without occupied tiles', async () => {
        const paths = fakePaths(router);
        const driver = new TimelineDriver(world().player({ at: START }).series(1), { react: walking() });
        const ctx = { state: () => driver.state(), pathfinder: paths };
        const run = await interpret(walkTo(ctx, DEST.x, DEST.z, 0), { driver });
        expect(run.kind).toBe('returned');
        expect(paths.queries.every(q => q.occupied.length === 0)).toBe(true);
    });
});

describe('npcTiles', () => {
    test('uses the route tile, not the render position, and a larger NPC covers its footprint', () => {
        const state = world().player({ at: START }).npc('Crate', 3300, 3500).npc('Giant', 3310, 3510).build();
        const [crate, giant] = state.nearbyNpcs;
        // A moving NPC's render position trails its route tile; a 2x2 one is offset by floor(size/2).
        Object.assign(crate!, { x: 3299, tileX: 3300, tileZ: 3500 });
        Object.assign(giant!, { x: 3311, z: 3511, tileX: 3310, tileZ: 3510, size: 2 });
        expect(npcTiles(state)).toEqual([
            { x: 3300, z: 3500 },
            { x: 3310, z: 3510 },
            { x: 3310, z: 3511 },
            { x: 3311, z: 3510 },
            { x: 3311, z: 3511 },
        ]);
    });
});
