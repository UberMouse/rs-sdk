import { describe, expect, test } from 'bun:test';
import type { StopCondition } from '../../lib/stop';
import woodcutting from '../../tasks/woodcutting';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const TREE = { x: 3224, z: 3220 };
const base = world().skill('Woodcutting', 1, 0).inv('Bronze axe', 1);
const forest = base.loc('Tree', TREE.x, TREE.z, { options: ['Chop down'] });
/** The tree has fallen: its stump (another loc id) stands on the tile. */
const stumps = base.loc('Tree stump', TREE.x, TREE.z, { id: 1342 });
/** `n` logs chopped since the start: the logs, and 25 xp each. */
const chopped = (w: World, n: number) => w.inv('Logs', n).skill('Woodcutting', 1, 25 * n);
const xp = (amount: number): StopCondition[] => [{ kind: 'xp', skill: 'Woodcutting', amount }];
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const CHOP = 'Chop down Tree';
/** In combat from tick 3 (the engine refuses to start a run in combat) until tick `until`. */
const attackedFrom = (w: World, i: number, until = Infinity) => w.player({ inCombat: i >= 3 && i < until });

describe('woodcutting: chopping', () => {
    test('chops the nearest tree, and again after each log', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.series(20, (w, i) => chopped(w, i >= 8 ? 2 : i >= 4 ? 1 : 0)),
            stops: xp(50),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +50 Woodcutting xp');
        expect(r.sends).toEqual([CHOP, CHOP]);
        expect(r.result.inventoryDelta).toEqual({ Logs: 2 });
        expect(logged(r)).toEqual([]);
    });

    test('a tree felled by another player is a failed chop; the bot waits for the respawn', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.series(20, (w, i) => chopped(i >= 3 && i < 10 ? stumps.tick(i) : w, i >= 14 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Woodcutting xp');
        expect(logged(r)).toEqual([
            'chop failed: Tree was felled by someone else',
            'no tree available, waiting for a respawn',
        ]);
        expect(r.sends).toEqual([CHOP, CHOP]);
    });

    test('eight chops failing in a row fail the run with the last reason', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('chop: 8 chops in a row failed (last: not connected)');
        expect(r.sends).toHaveLength(8);
    });

    test('low HP mid-chop aborts the chop and eats, then chopping resumes', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .inv('Shrimps', 1)
                .series(20, (w, i) => chopped(w.player({ hp: i === 3 ? 4 : 10 }), i >= 8 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Woodcutting xp');
        expect(r.legacy).toEqual(['eat Shrimps']);
        expect(r.sends).toEqual([CHOP, CHOP]);
        expect(r.result.stepRuns).toEqual({ chop: 2, 'interrupt:low-hp': 1 });
    });
});

describe('woodcutting: a full inventory', () => {
    const full = forest.inv('Logs', 27);

    test('onFull drop drops the logs and keeps chopping', async () => {
        const r = await simulate(woodcutting, {
            params: { onFull: 'drop' },
            timeline: [full.build(), ...forest.series(20, (w, i) => chopped(w, i >= 5 ? 1 : 0)).slice(1)],
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Woodcutting xp');
        expect(r.legacy).toEqual(['drop /^Logs$/i all']);
        expect(r.steps).toEqual(['drop-logs', 'chop']);
    });

    test('onFull drop fails when the drop leaves the inventory full', async () => {
        const r = await simulate(woodcutting, { params: { onFull: 'drop' }, timeline: full.series(5) });
        expect(r.result.reason).toBe('drop-logs: inventory still full after dropping logs (dropped)');
    });

    test('onFull stop ends the run done, holding the logs', async () => {
        const r = await simulate(woodcutting, { params: { onFull: 'stop' }, timeline: full.series(1) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-full: inventory full: 27 logs');
        expect(r.sends).toEqual([]);
    });

    test('a full inventory without logs of the tree fails', async () => {
        const r = await simulate(woodcutting, {
            params: { onFull: 'stop' },
            timeline: forest.inv('Tinderbox', 27).series(1),
        });
        expect(r.result.reason).toBe('stop-full: inventory full with no tree logs');
    });
});

describe('woodcutting: no tree', () => {
    test('with an area, fails "area depleted" once the give-up budget is spent; trees outside do not count', async () => {
        const r = await simulate(woodcutting, {
            params: { area: { x: 3222, z: 3218, radius: 5 } },
            timeline: stumps.loc('Tree', 3240, 3218, { options: ['Chop down'] }).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('chop: area depleted: no reachable tree in radius 5 for 120s');
        expect(r.driver.state().tick).toBe(300);
        expect(r.sends).toEqual([]);
    });

    test('without an area the reason says nearby', async () => {
        const r = await simulate(woodcutting, { timeline: stumps.series(1) });
        expect(r.result.reason).toBe('chop: no reachable tree nearby for 120s');
    });

    test('the budget runs from the first tick with no tree, across an interrupted wait', async () => {
        const r = await simulate(woodcutting, {
            timeline: stumps.inv('Shrimps', 1).series(150, (w, i) => w.player({ hp: i === 100 ? 4 : 10 })),
        });
        expect(r.legacy).toEqual(['eat Shrimps']);
        expect(r.result.reason).toBe('chop: no reachable tree nearby for 120s');
        expect(r.driver.state().tick).toBe(300);
    });
});

describe('woodcutting: under attack', () => {
    test('with auto-retaliate off, fails as soon as the bot is attacked', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(false).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interrupt:under-attack: attacked with auto-retaliate off at (3222,3218)');
        expect(r.sends).toEqual([CHOP]);
    });

    test('with auto-retaliate on, stops chopping until the fight is over', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(30, (w, i) => chopped(attackedFrom(w, i, 10), i >= 15 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Woodcutting xp');
        expect(r.sends).toEqual([CHOP, CHOP]);
        // One run a tick, ticks 3 to 9.
        expect(r.result.stepRuns).toEqual({ chop: 2, 'interrupt:under-attack': 7 });
    });

    test('a fight auto-retaliate does not end within the limit fails the run', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.reason).toBe('interrupt:under-attack: under attack for 40 ticks at (3222,3218)');
        expect(r.driver.state().tick).toBe(43);
    });
});
