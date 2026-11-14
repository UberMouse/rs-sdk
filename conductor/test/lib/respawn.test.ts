import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { ticks } from '../../core/op';
import { newAreaWatch } from '../../lib/area-watch';
import { type RespawnWait, waitForRespawn } from '../../lib/respawn';
import type { Step } from '../../lib/task';
import { ticksToSeconds } from '../../lib/util';
import { runTask } from '../engine/harness';
import type { Simulation } from '../simulate';
import { world } from '../world';

const GIVE_UP = 20;
const AREA = { x: 3222, z: 3218, radius: 5 };
const base = world();
const withTree = base.loc('Tree', 3224, 3220, { options: ['Chop down'] });
const hasTree = (s: BotWorldState) => s.nearbyLocs.some(l => l.name === 'Tree');

/**
 * A task that ends done at `endAt`, gathers (clearing "none since", as the tasks do) while a tree is in view, and
 * otherwise waits for one with `opts` over the defaults.
 */
function run(states: BotWorldState[], opts: Partial<RespawnWait> = {}, endAt = Infinity, since0: number | null = null) {
    const mem = { since: since0 };
    const waitStarts: number[] = [];
    const steps: Step[] = [
        { name: 'end', when: ctx => ctx.state().tick >= endAt, run: () => ({ done: 'end' }) },
        {
            name: 'gather',
            when: ctx => hasTree(ctx.state()),
            *run() {
                mem.since = null;
                yield* ticks(1);
            },
        },
        {
            name: 'wait',
            when: () => true,
            *run(ctx) {
                waitStarts.push(ctx.state().tick);
                return yield* waitForRespawn(ctx, {
                    since: { get: () => mem.since, set: t => (mem.since = t) },
                    giveUpTicks: GIVE_UP,
                    label: 'tree respawn',
                    until: hasTree,
                    log: 'no tree, waiting',
                    watch: newAreaWatch(),
                    seen: () => undefined,
                    target: 'tree',
                    area: undefined,
                    ...opts,
                });
            },
        },
    ];
    return runTask(steps, states).then(r => ({ ...r, mem, waitStarts }));
}

const logged = (r: Simulation) => r.events.flatMap(e => (e.type === 'log' ? [e.msg] : []));

describe('waitForRespawn', () => {
    test('a target before the give-up ends the wait, with no failure', async () => {
        const r = await run(
            base.series(12, (w, i) => (i >= 5 ? withTree.tick(i) : w)),
            {},
            10,
        );
        expect(r.result.status).toBe('done');
        expect(r.steps).toEqual(['wait', 'gather', 'end']);
        expect(logged(r)).toEqual(['no tree, waiting']);
    });

    test('without an area, the give-up fails "nearby"', async () => {
        const r = await run(base.series(1));
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
        expect(r.driver.state().tick).toBe(GIVE_UP);
    });

    test('with an area, the give-up fails "area depleted", with the suffix built from the last state', async () => {
        const plain = await run(base.series(1), { area: AREA });
        expect(plain.result.reason).toBe(
            `wait: area depleted: no reachable tree in radius 5 for ${ticksToSeconds(GIVE_UP)}s`,
        );
        const suffixed = await run(base.series(1), { area: AREA, areaSuffix: s => `; at tick ${s.tick}` });
        expect(suffixed.result.reason).toBe(
            `wait: area depleted: no reachable tree in radius 5 for ${ticksToSeconds(GIVE_UP)}s; at tick ${GIVE_UP}`,
        );
        // The suffix is for the area text only.
        const noArea = await run(base.series(1), { areaSuffix: () => '; never' });
        expect(noArea.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
    });

    test('chunked waits log once and add up to the same give-up', async () => {
        const r = await run(base.series(1), { chunkTicks: 8 });
        expect(r.waitStarts).toEqual([0, 8, 16]);
        expect(r.steps).toEqual(['wait']);
        expect(logged(r)).toEqual(['no tree, waiting']);
        expect(r.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
        expect(r.driver.state().tick).toBe(GIVE_UP);
    });

    test('the caller clearing "none since" starts a new give-up, logged again', async () => {
        // No tree for ticks 0-4, a tree for 5-9, none after.
        const r = await run(base.series(11, (w, i) => (i >= 5 && i < 10 ? withTree.tick(i) : w)));
        expect(logged(r)).toEqual(['no tree, waiting', 'no tree, waiting']);
        expect(r.mem.since).toBe(10);
        expect(r.driver.state().tick).toBe(10 + GIVE_UP);
        expect(r.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
    });

    test('a chunk larger than what remains still fails at the give-up', async () => {
        const r = await run(base.series(1), { chunkTicks: 50 });
        expect(r.waitStarts).toEqual([0]);
        expect(r.driver.state().tick).toBe(GIVE_UP);
        expect(r.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
    });

    test('a chunk dividing the give-up fails on the chunk ending at it, with no extra wait', async () => {
        const r = await run(base.series(1), { chunkTicks: 10 });
        expect(r.waitStarts).toEqual([0, 10]);
        expect(r.driver.state().tick).toBe(GIVE_UP);
        expect(r.result.status).toBe('failed');
    });

    test('the give-up is measured from "since" across re-entered calls, unchunked too', async () => {
        const r = await run(base.series(1), {}, Infinity, -5);
        expect(r.waitStarts).toEqual([0]);
        expect(logged(r)).toEqual([]);
        expect(r.driver.state().tick).toBe(GIVE_UP - 5);
        expect(r.result.reason).toBe(`wait: no reachable tree nearby for ${ticksToSeconds(GIVE_UP)}s`);
    });

    test('areaSuffix receives the state the wait ended on, not the first', async () => {
        const rock = base.loc('Rock', 3223, 3219, { options: ['Mine'] });
        const r = await run(
            base.series(30, (w, i) => (i >= 3 ? rock.tick(i) : w)),
            { area: AREA, areaSuffix: s => `; ${s.nearbyLocs.map(l => l.name).join(',')}` },
        );
        expect(r.result.reason).toBe(
            `wait: area depleted: no reachable tree in radius 5 for ${ticksToSeconds(GIVE_UP)}s; Rock`,
        );
    });
});
