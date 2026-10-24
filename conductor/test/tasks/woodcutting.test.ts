import { describe, expect, test } from 'bun:test';
import type { StopCondition } from '../../lib/stop';
import woodcutting from '../../tasks/woodcutting';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';

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
        expect(r.sends).toEqual([CHOP, 'Eat Shrimps', CHOP]);
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
        // The logs are all gone the tick after the first drop.
        expect(r.sends).toEqual(['drop Logs', CHOP]);
        expect(r.steps).toEqual(['drop-logs', 'chop']);
        // 27 logs start, none after the drop, one chopped later: the drop must not eat that one.
        expect(r.result.inventoryDelta).toEqual({ Logs: -26 });
    });

    test('onFull drop fails when the drop leaves the inventory full', async () => {
        // The world ignores the drop.
        const r = await simulate(woodcutting, {
            params: { onFull: 'drop' },
            timeline: full.series(5),
            react: () => undefined,
        });
        expect(r.result.reason).toBe(
            'drop-logs: inventory still full after dropping logs (Drop of Logs (slot 1) was not observed)',
        );
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
        expect(r.sends).toEqual(['Eat Shrimps']);
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
        expect(r.result.reason).toBe(
            'interrupt:under-attack: attacked by Goblin (level 2) with auto-retaliate off at (3222,3218)',
        );
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

    test('a long winnable fight that makes progress is waited out with no tick cap, then the task resumes', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .autoRetaliate(true)
                .series(200, (w, i) =>
                    chopped(
                        attackedFrom(w, i, 120, 2, { healthPercent: 100 - Math.floor(i / 30) * 10 }),
                        i >= 125 ? 1 : 0,
                    ),
                ),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Woodcutting xp');
        expect(r.result.stepRuns['interrupt:under-attack']).toBe(117);
    });

    test("an attacker above the bot's combat level fails the run, naming it", async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(10, (w, i) => attackedFrom(w, i, Infinity, 5)),
        });
        expect(r.result.reason).toBe(
            "interrupt:under-attack: attacked by Goblin (level 5), above the bot's combat level 3, at (3222,3218)",
        );
    });

    test('only facing a target is not an attack', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(10, (w, i) => w.player({ inCombat: i >= 3 })),
        });
        expect(r.result.stepRuns['interrupt:under-attack']).toBeUndefined();
    });

    test('a hit from an attacker the state does not name is waited out for 40 ticks at most', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .autoRetaliate(true)
                .series(60, (w, i) => w.player({ inCombat: i >= 3, lastDamageTick: i >= 3 ? i : -1 })),
        });
        expect(r.result.reason).toBe(
            'interrupt:under-attack: under attack by an unknown attacker for 40 ticks at (3222,3218)',
        );
        expect(r.driver.state().tick).toBe(43);
    });

    test('a foe flipping between named and unnamed with flat hp still fails', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(120, (w, i) => {
                if (i < 3) return w;
                const named = Math.floor(i / 5) % 2 === 0;
                const hit = w.player({ inCombat: true, lastDamageTick: named ? Math.floor(i / 5) * 5 - 1 : i });
                return named ? hit.npcBeside('Goblin', { attacking: true, combatLevel: 2 }) : hit;
            }),
        });
        expect(r.result.reason).toMatch(/^interrupt:under-attack: (fight with Goblin|under attack by an unknown)/);
        expect(r.driver.state().tick).toBeLessThan(70);
    });

    test('a named foe missing for single ticks while hits land is waited out, not read as unknown', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest.autoRetaliate(true).series(130, (w, i) => {
                if (i < 3 || i >= 120) return w;
                const hit = w.player({ inCombat: true, lastDamageTick: i - (i % 4), hp: 10 });
                return i % 10 === 0
                    ? hit
                    : hit.npcBeside('Goblin', { attacking: true, combatLevel: 2, healthPercent: 100 - i });
            }),
        });
        expect(r.result.reason ?? '').not.toContain('unknown attacker');
        expect(r.result.reason ?? '').not.toContain('under-attack');
    });

    test('a hit from an unknown attacker that costs 3 hp fails at once', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .autoRetaliate(true)
                .series(30, (w, i) =>
                    w.player({ inCombat: i >= 3, lastDamageTick: i >= 3 ? i : -1, hp: i >= 6 ? 7 : 10 }),
                ),
        });
        expect(r.result.reason).toBe(
            'interrupt:under-attack: attacked by an unknown attacker at (3222,3218): hp 7/10, down from 10',
        );
    });

    test('a fight where neither side loses hp for 60 ticks fails, naming the attacker', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .autoRetaliate(true)
                .series(100, (w, i) => attackedFrom(w, i, Infinity, 2, { healthPercent: 100 })),
        });
        expect(r.result.reason).toBe(
            'interrupt:under-attack: fight with Goblin (level 2) not finished: no hp change for 60 ticks at (3222,3218)',
        );
        expect(r.driver.state().tick).toBe(63);
    });

    test("low hp during a named fight is the low-HP guard's: it eats, then the fight is waited out", async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .inv('Shrimps', 1)
                .autoRetaliate(true)
                .series(30, (w, i) =>
                    attackedFrom(w, i, 15, 2, { healthPercent: 100 - i * 3 }).player({ hp: i === 3 ? 4 : 10 }),
                ),
        });
        expect(r.sends).toContain('Eat Shrimps');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
        expect(r.result.stepRuns['interrupt:under-attack']).toBeGreaterThan(0);
    });

    test('low hp during a named fight with no food fails in the low-HP guard', async () => {
        const r = await simulate(woodcutting, {
            timeline: forest
                .autoRetaliate(true)
                .series(30, (w, i) =>
                    attackedFrom(w, i, Infinity, 2, { healthPercent: 100 - i * 3 }).player({ hp: i >= 3 ? 4 : 10 }),
                ),
        });
        expect(r.result.reason).toBe('interrupt:low-hp: hp 4/10 at (3222,3218), no food');
    });
});

describe('woodcutting: seenOutsideArea diagnostic', () => {
    const AREA = { x: 3222, z: 3218, radius: 5 };

    test('a tree in view outside the area while waiting warns, naming its tile', async () => {
        const r = await simulate(woodcutting, {
            params: { area: AREA },
            timeline: stumps.loc('Tree', 3240, 3218, { options: ['Chop down'] }).series(1),
        });
        expect(r.result.reason).toBe('chop: area depleted: no reachable tree in radius 5 for 120s');
        expect(r.result.diagnostics).toEqual({
            idleTicks: 300,
            seenOutsideAreaTicks: 300,
            nearestOutsideArea: { name: 'Tree', x: 3240, z: 3218 },
        });
        expect(r.result.warnings?.[0]).toContain('seenOutsideArea');
        expect(r.result.warnings?.[0]).toContain('(3240,3218)');
    });

    test('only stumps in view: idle ticks, no warning', async () => {
        const r = await simulate(woodcutting, { params: { area: AREA }, timeline: stumps.series(1) });
        expect(r.result.diagnostics).toEqual({ idleTicks: 300, seenOutsideAreaTicks: 0 });
        expect(r.result.warnings).toBeUndefined();
    });

    test('a stop that cancels the wait still counts the ticks it idled', async () => {
        const r = await simulate(woodcutting, {
            params: { area: AREA },
            timeline: stumps.loc('Tree', 3240, 3218, { options: ['Chop down'] }).series(1),
            stops: [{ kind: 'minutes', minutes: (50 * 400) / 60_000 }],
        });
        expect(r.result.status).toBe('done');
        expect(r.result.diagnostics).toMatchObject({ idleTicks: 50, seenOutsideAreaTicks: 50 });
        expect(r.result.warnings).toHaveLength(1);
    });

    test('without an area nothing is outside it', async () => {
        const r = await simulate(woodcutting, { timeline: stumps.series(1) });
        expect(r.result.warnings).toBeUndefined();
    });

    test('a tree at the Wilderness edge outside the area is not counted', async () => {
        const area = { x: 3100, z: 3490, radius: 4 };
        const edge = base
            .player({ at: { x: 3100, z: 3490 } })
            .loc('Tree stump', 3100, 3490, { id: 1342 })
            .loc('Tree', 3100, 3518, { options: ['Chop down'] });
        const r = await simulate(woodcutting, { params: { area }, timeline: edge.series(1) });
        expect(r.result.diagnostics).toMatchObject({ idleTicks: expect.any(Number), seenOutsideAreaTicks: 0 });
        expect(r.result.warnings).toBeUndefined();
    });
});
