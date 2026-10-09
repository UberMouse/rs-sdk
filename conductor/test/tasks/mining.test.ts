import { describe, expect, test } from 'bun:test';
import type { StopCondition } from '../../lib/stop';
import mining from '../../tasks/mining';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const ROCK = { x: 3224, z: 3220 };
const COPPER = 2090;
const TIN = 2094;
/** A mined-out rock: plainrock (another loc id) keeps its Mine option. */
const DEPLETED = 450;
const base = world().skill('Mining', 1, 0).inv('Bronze pickaxe', 1);
const rocks = (w: World, id: number, x = ROCK.x, z = ROCK.z) =>
    w.loc('Rocks', x, z, { id, options: ['Mine', 'Prospect'] });
const quarry = rocks(base, COPPER);
const mined = rocks(base, DEPLETED);
const PARAMS = { rock: 'copper' };
/** `n` copper ore mined since the start: the ore, and 25 xp each. */
const ore = (w: World, n: number) => w.inv('Copper ore', n).skill('Mining', 1, 25 * n);
const xp = (amount: number): StopCondition[] => [{ kind: 'xp', skill: 'Mining', amount }];
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const MINE = 'Mine Rocks';
/** In combat from tick 3 (the engine refuses to start a run in combat) until tick `until`. */
const attackedFrom = (w: World, i: number, until = Infinity) => w.player({ inCombat: i >= 3 && i < until });

describe('mining: mining', () => {
    test('mines the nearest rock of the listed type, and again after each ore', async () => {
        const nearer = rocks(rocks(base, TIN, ROCK.x - 1, ROCK.z), COPPER, ROCK.x + 3, ROCK.z);
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: nearer.series(20, (w, i) => ore(w, i >= 8 ? 2 : i >= 4 ? 1 : 0)),
            stops: xp(50),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +50 Mining xp');
        expect(r.sends).toEqual([MINE, MINE]);
        // The tin rock is nearer but not listed.
        const targets = r.driver.commands.flatMap(c => (c.type === 'send' && 'x' in c.action ? [c.action.x] : []));
        expect(targets).toEqual([ROCK.x + 3, ROCK.x + 3]);
        expect(r.result.inventoryDelta).toEqual({ 'Copper ore': 2 });
        expect(logged(r)).toEqual([]);
    });

    test('a list of rock types mines any of them', async () => {
        const r = await simulate(mining, {
            params: { rock: ['copper', 'tin'] },
            timeline: rocks(base, TIN).series(20, (w, i) => (i >= 4 ? w.inv('Tin ore', 1).skill('Mining', 1, 25) : w)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(r.sends).toEqual([MINE]);
    });

    test('a rock mined out by another player is a failed attempt; the bot waits for the respawn', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.series(20, (w, i) => ore(i >= 3 && i < 10 ? mined.tick(i) : w, i >= 14 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(logged(r)).toEqual([
            'mine failed: rock at (3224,3220) was mined out by someone else',
            'no copper rock available, waiting for a respawn',
        ]);
        expect(r.sends).toEqual([MINE, MINE]);
    });

    test('eight timed-out attempts in a row fail the run with the last reason, before the watchdog', async () => {
        const r = await simulate(mining, { params: PARAMS, timeline: quarry.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('mine: 8 attempts in a row failed (last: timed out waiting for ore from rock)');
        expect(r.sends).toHaveLength(8);
        expect(r.driver.state().tick).toBe(8 * 75);
    });

    test('eight refused sends in a row fail the run with the last reason', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.reason).toBe('mine: 8 attempts in a row failed (last: not connected)');
        expect(r.sends).toHaveLength(8);
    });

    test('a success in between resets the count', async () => {
        // Sends 1-7 and 9-15 are refused, 8 and 16 go through: 14 failures, never 8 in a row.
        let sent = 0;
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.series(10, (w, i) => ore(w, i >= 4 ? 2 : i >= 2 ? 1 : 0)),
            respond: () => {
                sent++;
                return sent % 8 === 0 ? undefined : { success: false, message: 'not connected' };
            },
            stops: xp(50),
        });
        expect(r.result.reason).toBe('reached +50 Mining xp');
        expect(sent).toBe(16);
    });

    test('low HP mid-mine aborts the mine and eats, then mining resumes', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry
                .inv('Shrimps', 1)
                .series(20, (w, i) => ore(w.player({ hp: i === 3 ? 4 : 10 }), i >= 8 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(r.sends).toEqual([MINE, 'Eat Shrimps', MINE]);
        expect(r.result.stepRuns).toEqual({ mine: 2, 'interrupt:low-hp': 1 });
    });

    test('a level-up dialog mid-mine is cleared and the ore still counts', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.series(20, (w, i) => {
                if (i >= 6) return ore(w, 1);
                return i === 3 ? w.dialog({ options: ['Click here to continue'] }) : w;
            }),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(r.sends).toEqual([MINE, 'continue dialog']);
        expect(logged(r)).toEqual([]);
    });
});

describe('mining: a full inventory', () => {
    const full = quarry.inv('Copper ore', 27);

    test('onFull drop drops the ore and keeps mining', async () => {
        const r = await simulate(mining, {
            params: { ...PARAMS, onFull: 'drop' },
            timeline: [full.build(), ...quarry.series(20, (w, i) => ore(w, i >= 5 ? 1 : 0)).slice(1)],
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(r.sends).toEqual(['drop Copper ore', MINE]);
        expect(r.steps).toEqual(['drop-ores', 'mine']);
        expect(r.result.inventoryDelta).toEqual({ 'Copper ore': -26 });
    });

    test('onFull drop drops every listed ore, one item type at a time', async () => {
        const both = quarry.inv('Copper ore', 14).inv('Tin ore', 13);
        const r = await simulate(mining, {
            params: { rock: ['copper', 'tin'] },
            // The copper is gone the tick after its drop, the tin the tick after its own.
            timeline: quarry.series(20, (w, i) => {
                if (i === 0) return both;
                return i === 1 ? w.inv('Tin ore', 13) : ore(w, i >= 6 ? 1 : 0);
            }),
            stops: xp(25),
        });
        expect(r.sends).toEqual(['drop Copper ore', 'drop Tin ore', MINE]);
    });

    test('onFull drop fails when the inventory is full of other items', async () => {
        const junk = quarry.inv('Logs', 27);
        const r = await simulate(mining, { params: PARAMS, timeline: junk.series(2) });
        // Every slot is named: only a stacked slot reads "xN".
        expect(r.result.reason).toBe(
            `drop-ores: inventory full of non-ore items: ${['Bronze pickaxe', ...Array<string>(27).fill('Logs')].join(', ')}`,
        );
        expect(r.sends).toEqual([]);
    });

    test('onFull drop reports the drop errors when the drop leaves the ore in place', async () => {
        const r = await simulate(mining, { params: PARAMS, timeline: full.series(5), react: () => undefined });
        expect(r.result.reason).toBe(
            'drop-ores: inventory full of non-ore items: Bronze pickaxe; drop errors: Drop of Copper ore (slot 1) was not observed',
        );
    });

    test('onFull stop ends the run done, holding the ore', async () => {
        const r = await simulate(mining, { params: { ...PARAMS, onFull: 'stop' }, timeline: full.series(1) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-full: inventory full: 27 ores');
        expect(r.sends).toEqual([]);
    });

    test('a full inventory without the ore fails', async () => {
        const r = await simulate(mining, {
            params: { rock: ['copper', 'tin'], onFull: 'stop' },
            timeline: quarry.inv('Logs', 27).series(1),
        });
        expect(r.result.reason).toBe('stop-full: inventory full with no Copper ore/Tin ore');
    });
});

describe('mining: no rock', () => {
    test('with an area, fails "area depleted" once the give-up budget is spent; rocks outside do not count', async () => {
        const r = await simulate(mining, {
            params: { ...PARAMS, area: { x: 3222, z: 3218, radius: 5 } },
            timeline: rocks(mined, COPPER, 3240, 3218).series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('mine: area depleted: no reachable copper rock in radius 5 for 120s');
        expect(r.driver.state().tick).toBe(300);
        expect(r.sends).toEqual([]);
    });

    test('without an area the reason says nearby, and names every listed rock', async () => {
        const r = await simulate(mining, { params: { rock: ['copper', 'tin'] }, timeline: mined.series(1) });
        expect(r.result.reason).toBe('mine: no reachable copper/tin rock nearby for 120s');
    });

    test('the budget follows the slowest listed rock', async () => {
        const r = await simulate(mining, {
            params: { rock: ['copper', 'mithril'] },
            timeline: mined.skill('Mining', 55, 0).series(1),
        });
        expect(r.result.reason).toBe('mine: no reachable copper/mithril rock nearby for 270s');
        expect(r.driver.state().tick).toBe(675);
    });

    test('rocks that cannot be reached or mined do not count', async () => {
        const stuck = mined.loc('Rocks', 3225, 3220, { id: COPPER, options: ['Mine'], reachable: false });
        const r = await simulate(mining, { params: PARAMS, timeline: stuck.series(1) });
        expect(r.result.reason).toBe('mine: no reachable copper rock nearby for 120s');
        expect(r.sends).toEqual([]);
    });

    test('the budget runs from the first tick with no rock, across an interrupted wait', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: mined.inv('Shrimps', 1).series(150, (w, i) => w.player({ hp: i === 100 ? 4 : 10 })),
        });
        expect(r.sends).toEqual(['Eat Shrimps']);
        expect(r.result.reason).toBe('mine: no reachable copper rock nearby for 120s');
        expect(r.driver.state().tick).toBe(300);
    });

    test('a rock that respawns ends the wait', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: mined.series(30, (w, i) => (i >= 10 ? ore(quarry.tick(i), i >= 14 ? 1 : 0) : w)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(logged(r)).toEqual(['no copper rock available, waiting for a respawn']);
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(mining, { params, timeline: w.series(1) })).result.reason;

describe('mining: preflight', () => {
    test('refuses runite', async () => {
        expect(await refusal(quarry, { rock: ['copper', 'runite'] })).toBe(
            "preflight: runite respawns too slowly for this task's progress watchdog",
        );
    });

    test('needs a usable pickaxe', async () => {
        expect(await refusal(quarry.inv('Bronze pickaxe', 0))).toBe('preflight: no pickaxe in inventory or equipped');
        expect(await refusal(quarry.inv('Bronze pickaxe', 0).inv('Steel pickaxe', 1, { id: 1269 }))).toBe(
            'preflight: no usable pickaxe at mining 1: found Steel pickaxe',
        );
    });

    test('needs the level for every listed rock', async () => {
        expect(await refusal(quarry, { rock: ['copper', 'iron'] })).toBe('preflight: iron needs mining 15, bot has 1');
    });

    test('needs the Mining skill in state', async () => {
        expect(await refusal(world().inv('Bronze pickaxe', 1))).toBe('preflight: no Mining skill in state');
    });

    test('refuses an area reaching the Wilderness', async () => {
        expect(await refusal(quarry, { ...PARAMS, area: { x: 3100, z: 3530, radius: 5 } })).toBe(
            'preflight: area (3100,3530) radius 5 reaches the Wilderness',
        );
    });
});

describe('mining: return to area', () => {
    test('too far from the area walks back before mining', async () => {
        const r = await simulate(mining, {
            params: { ...PARAMS, area: { x: 3300, z: 3300, radius: 4 } },
            timeline: quarry.series(3),
            bot: { walkTo: async () => ({ success: false, message: 'no path' }) as never },
        });
        expect(r.steps[0]).toBe('return-to-area');
        expect(r.sends).toEqual([]);
    });
});

describe('mining: under attack', () => {
    test('with auto-retaliate off, fails as soon as the bot is attacked', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.autoRetaliate(false).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interrupt:under-attack: attacked with auto-retaliate off at (3222,3218)');
        expect(r.sends).toEqual([MINE]);
    });

    test('with auto-retaliate on, stops mining until the fight is over', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.autoRetaliate(true).series(30, (w, i) => ore(attackedFrom(w, i, 10), i >= 15 ? 1 : 0)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Mining xp');
        expect(r.sends).toEqual([MINE, MINE]);
        // One run a tick, ticks 3 to 9.
        expect(r.result.stepRuns).toEqual({ mine: 2, 'interrupt:under-attack': 7 });
    });

    test('a fight auto-retaliate does not end within the limit fails the run', async () => {
        const r = await simulate(mining, {
            params: PARAMS,
            timeline: quarry.autoRetaliate(true).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.reason).toBe('interrupt:under-attack: under attack for 40 ticks at (3222,3218)');
        expect(r.driver.state().tick).toBe(43);
    });
});
