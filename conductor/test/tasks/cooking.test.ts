import { describe, expect, test } from 'bun:test';
import { COOK_WAIT_TICKS } from '../../actions/cook';
import cooking from '../../tasks/cooking';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const RANGE = { x: 3230, z: 3196 };
const AREA = { ...RANGE, radius: 6 };
const PARAMS = { food: 'Raw shrimps', area: AREA, dropBurnt: false };
const COOK = 'cook Raw shrimps on Range';
/** Beside the Range with 3 raw shrimps and 3 raw anchovies (another food, never touched), Cooking 1. */
const kit = world()
    .player({ at: { x: 3229, z: 3197 } })
    .skill('Cooking', 1, 0)
    .inv('Raw shrimps', 3)
    .inv('Raw anchovies', 3, { id: 321 })
    .loc('Range', RANGE.x, RANGE.z);
/** After `n` cooks of which `burnt` burnt (the first ones, for the test's sake). */
const after = (w: World, n: number, burnt = 0) =>
    w
        .inv('Raw shrimps', 3 - n)
        .inv('Shrimps', n - burnt)
        .inv('Burnt fish', burnt, { id: 323 })
        .skill('Cooking', 1, 30 * (n - burnt));
/** Each cook lands 4 ticks after the last, `outcomes[i]` true for burnt. */
const cooks = (w: World, outcomes: boolean[], ticks = 30) =>
    w.series(ticks, (s, i) => {
        const done = Math.min(outcomes.length, Math.floor(i / 4));
        return after(s, done, outcomes.slice(0, done).filter(Boolean).length);
    });
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

describe('cooking: the run', () => {
    test('cooks every raw food, one use each, and counts cooked and burnt', async () => {
        const r = await simulate(cooking, { params: PARAMS, timeline: cooks(kit, [false, true, false]) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Raw shrimps left: 2 cooked, 1 burnt');
        expect(r.sends).toEqual([COOK, COOK, COOK]);
        expect(r.result.inventoryDelta).toEqual({ 'Raw shrimps': -3, Shrimps: 2, 'Burnt fish': 1 });
        expect(r.result.xpGained).toEqual({ Cooking: 60 });
    });

    test('a burn is never a failure: all burnt still ends done', async () => {
        const r = await simulate(cooking, { params: PARAMS, timeline: cooks(kit, [true, true, true]) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: no Raw shrimps left: 0 cooked, 3 burnt');
        expect(logged(r)).toEqual([]);
    });

    test('works without an area, on a source in sight', async () => {
        const r = await simulate(cooking, {
            params: { food: 'Raw shrimps', dropBurnt: false },
            timeline: cooks(kit, [false, false, false]),
        });
        expect(r.result.reason).toBe('finish: no Raw shrimps left: 3 cooked, 0 burnt');
    });

    test('cooks on the nearest of several sources and never on the quest-gated Cooking range', async () => {
        const w = kit.loc('Cooking range', 3229, 3198).loc('Fire', 3240, 3200);
        const r = await simulate(cooking, { params: PARAMS, timeline: cooks(w, [false, false, false]) });
        expect(r.sends).toEqual([COOK, COOK, COOK]);
    });

    test('a Fire or Fireplace counts as a source', async () => {
        const w = world()
            .player({ at: { x: 3240, z: 3200 } })
            .skill('Cooking', 1, 0)
            .inv('Raw shrimps', 3)
            .loc('Fire', 3241, 3200);
        const r = await simulate(cooking, {
            params: { food: 'Raw shrimps', dropBurnt: false },
            timeline: cooks(w, [false, false, false]),
        });
        expect(r.sends[0]).toBe('cook Raw shrimps on Fire');
    });
});

describe('cooking: dropBurnt', () => {
    test('drops the burnt food at the end, and only then finishes', async () => {
        const r = await simulate(cooking, {
            params: { ...PARAMS, dropBurnt: true },
            timeline: cooks(kit, [true, false, true], 40),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([COOK, COOK, COOK, 'drop Burnt fish', 'drop Burnt fish']);
        expect(r.result.inventoryDelta).toEqual({ 'Raw shrimps': -3, Shrimps: 1 });
        expect(r.steps.slice(-2)).toEqual(['drop-burnt', 'finish']);
    });

    test('leaves it held by default', async () => {
        const r = await simulate(cooking, { params: PARAMS, timeline: cooks(kit, [true, true, true]) });
        expect(r.sends).not.toContain('drop Burnt fish');
        expect(r.result.inventoryDelta['Burnt fish']).toBe(3);
    });
});

describe('cooking: failures', () => {
    test('no source in sight fails clearly', async () => {
        const w = world().skill('Cooking', 1, 0).inv('Raw shrimps', 3);
        const r = await simulate(cooking, { params: { food: 'Raw shrimps', dropBurnt: false }, timeline: w.series(5) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('cook: no Range, Fire, Fireplace or Cooking pot in sight (pass `area`)');
    });

    test('only the quest-gated Cooking range around fails', async () => {
        const w = world().skill('Cooking', 1, 0).inv('Raw shrimps', 3).loc('Cooking range', 3212, 3215);
        const r = await simulate(cooking, { params: { food: 'Raw shrimps', dropBurnt: false }, timeline: w.series(5) });
        expect(r.result.reason).toBe('cook: no Range, Fire, Fireplace or Cooking pot in sight (pass `area`)');
    });

    test('a source outside the area does not count', async () => {
        const r = await simulate(cooking, {
            params: { ...PARAMS, area: { x: 3200, z: 3200, radius: 3 } },
            timeline: kit.player({ at: { x: 3200, z: 3200 } }).series(5),
        });
        expect(r.result.reason).toBe('cook: no Range, Fire, Fireplace or Cooking pot within 3 tiles of (3200,3200)');
    });

    test('a level the game refuses fails at once with its text', async () => {
        const msg = 'You need a Cooking level of 15 to cook trout.';
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit.series(10, (w, i) => (i >= 1 ? w.recentDialog([msg]) : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`cook: ${msg}`);
        expect(r.sends).toEqual([COOK]);
    });

    test('four cooks in a row that do nothing fail the run', async () => {
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit.series(4 * COOK_WAIT_TICKS + 20),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('cook: 4 cooks in a row failed (last: Timed out cooking Raw shrimps on Range)');
        expect(r.sends).toEqual([COOK, COOK, COOK, COOK]);
    });

    test('a cook that works in between resets the count', async () => {
        const gap = COOK_WAIT_TICKS + 2;
        // Three timeouts, a cook, three more timeouts, the rest: no four in a row.
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit.series(8 * gap, (w, i) => {
                const n = i >= 6 * gap ? 3 : i >= 3 * gap ? 1 : 0;
                return after(w, n, 0);
            }),
        });
        expect(r.result.status).toBe('done');
    });

    test('a source the game refuses to let the bot use fails naming it', async () => {
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit.series(10, (w, i) => (i >= 1 ? w.message('Who said you could use that?') : w)),
        });
        expect(r.result.reason).toBe(
            `cook: Range at (${RANGE.x},${RANGE.z}) is not usable: Who said you could use that?`,
        );
    });
});

describe('cooking: Wilderness sources', () => {
    test('a Fire in the Wilderness is ignored', async () => {
        const edge = world()
            .player({ at: { x: 3200, z: 3515 } })
            .skill('Cooking', 1, 0)
            .inv('Raw shrimps', 3)
            .loc('Fire', 3200, 3522);
        const r = await simulate(cooking, {
            params: { food: 'Raw shrimps', dropBurnt: false },
            timeline: edge.series(3),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('cook: no Range, Fire, Fireplace or Cooking pot in sight (pass `area`)');
        expect(r.sends).toEqual([]);
    });
});

describe('cooking: walking to the source', () => {
    test('walks to a source further than a couple of tiles, then cooks', async () => {
        const walks: [number, number][] = [];
        const pathfinder = fakePaths((from, to) => {
            walks.push([to.x, to.z]);
            return { success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] };
        });
        const far = kit.player({ at: { x: 3225, z: 3205 } });
        const r = await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: walking(),
            timeline: far.series(40, (w, i) => (i >= 18 ? after(w, 3) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(walks[0]).toEqual([RANGE.x, RANGE.z]);
        expect(r.sends[0]).toStartWith('walk to');
        expect(r.sends).toContain(COOK);
    });

    test('walks back to the area when the bot has strayed from it', async () => {
        const away = kit.player({ at: { x: RANGE.x + 30, z: RANGE.z } });
        const pathfinder = fakePaths((from, to) => ({
            success: true,
            reachedDestination: true,
            waypoints: [{ ...to, level: from.level }],
        }));
        const r = await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: walking(),
            timeline: away.series(40, (w, i) => (i >= 20 ? after(w, 3) : w)),
        });
        expect(r.steps[0]).toBe('return-to-area');
        expect(r.result.status).toBe('done');
    });
});

/**
 * The Range at (3230,3196) is open from its east side only: it reads reachable once the bot stands at
 * x >= `eastOf` (never, with Infinity). Wraps `walking` so every walk's new position updates the reading.
 */
const reachFromEast = (eastOf: number) => {
    const walk = walking();
    const judge = (s: BotWorldState): BotWorldState => {
        const x = s.player?.worldX ?? 0;
        return { ...s, nearbyLocs: s.nearbyLocs.map(l => ({ ...l, reachable: x >= eastOf })) };
    };
    return (action: BotAction, state: BotWorldState) => {
        const effect = walk(action, state);
        return effect && ((s: BotWorldState) => judge(effect(s)));
    };
};
const west = world()
    .player({ at: { x: 3225, z: 3196 } })
    .skill('Cooking', 1, 0)
    .inv('Raw shrimps', 3)
    .loc('Range', RANGE.x, RANGE.z, { reachable: false });
const straight = (blocked?: (x: number, z: number) => boolean) =>
    fakePaths(
        (from, to) => ({ success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] }),
        [],
        blocked,
    );

describe('cooking: a source reachable from one side only', () => {
    test('walks round to a tile that reaches it, then cooks', async () => {
        const pathfinder = straight();
        const r = await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: reachFromEast(3231),
            timeline: west.series(80, (w, i) => (i >= 40 ? after(w, 3) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toStartWith('finish: no Raw shrimps left');
        const walks = pathfinder.queries.map(q => `${q.to.x},${q.to.z}`);
        // The tiles west of the Range come first (nearer the bot) and fail; an east tile ends it.
        expect(walks[0]).toBe('3229,3196');
        expect(walks.at(-1)).toMatch(/^3231,/);
        expect(r.sends.at(-1)).toBe(COOK);
        expect(r.sends.indexOf(COOK)).toBeGreaterThan(r.sends.findLastIndex(x => x.startsWith('walk to')));
    });

    test('a walk that ends where a reachable-looking source no longer reaches approaches it', async () => {
        const pathfinder = straight();
        const r = await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: reachFromEast(3231),
            timeline: west
                .loc('Range', RANGE.x, RANGE.z, { reachable: true })
                .series(80, (w, i) => (i >= 40 ? after(w, 3) : w)),
        });
        expect(r.result.status).toBe('done');
        const walks = pathfinder.queries.map(q => `${q.to.x},${q.to.z}`);
        // The first walk closes in on the Range and ends west of it; the approach then walks to a ring tile.
        expect(walks.length).toBeGreaterThan(1);
        expect(walks.slice(1).some(w => /^32(29|31),/.test(w))).toBe(true);
    });

    test('never walks to a tile outside the area or a blocked one', async () => {
        const pathfinder = straight((x, z) => x === 3229 && z === 3196);
        await simulate(cooking, {
            params: { ...PARAMS, area: { ...RANGE, radius: 2 } },
            pathfinder,
            react: reachFromEast(3231),
            timeline: west.player({ at: { x: 3228, z: 3196 } }).series(80, (w, i) => (i >= 40 ? after(w, 3) : w)),
        });
        const walks = pathfinder.queries.map(q => [q.to.x, q.to.z] as [number, number]);
        expect(walks.length).toBeGreaterThan(0);
        for (const [x, z] of walks) {
            expect(Math.max(Math.abs(x - RANGE.x), Math.abs(z - RANGE.z))).toBeLessThanOrEqual(2);
            expect([x, z]).not.toEqual([3229, 3196]);
        }
    });

    test('fails clearly when no tile around it reaches it', async () => {
        const r = await simulate(cooking, {
            params: PARAMS,
            // Only the Range's east neighbour is open ground, and it does not reach it either.
            pathfinder: straight((x, z) => !(x === 3231 && z === 3196)),
            react: reachFromEast(Infinity),
            timeline: west.series(80),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'cook: Range at (3230,3196) is in sight but cannot be reached from the tiles around it inside the area (tried 1)',
        );
        expect(r.sends.filter(x => x === COOK)).toEqual([]);
    });

    test('an unreachable source alone is not a cook failure that counts', async () => {
        // Many tiles to try (only the last ring's east side reaches): far more than COOK_FAIL_LIMIT walks, and none
        // ends the run `4 cooks in a row failed`; the cooks that follow end it done.
        const pathfinder = straight();
        const r = await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: reachFromEast(3232),
            timeline: west.series(160, (w, i) => (i >= 130 ? after(w, 3) : w)),
        });
        expect(pathfinder.queries.length).toBeGreaterThan(4);
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toStartWith('finish: no Raw shrimps left');
        expect(r.sends).toContain(COOK);
    });

    test('a different source starts the tiles tried afresh', async () => {
        const next = world()
            .player({ at: { x: 3225, z: 3196 } })
            .skill('Cooking', 1, 0)
            .inv('Raw shrimps', 3)
            .loc('Range', RANGE.x - 2, RANGE.z, { reachable: false });
        const pathfinder = straight();
        await simulate(cooking, {
            params: PARAMS,
            pathfinder,
            react: reachFromEast(Infinity),
            timeline: west.series(60, (w, i) => (i >= 20 ? next : w)),
        });
        const walks = pathfinder.queries.map(q => `${q.to.x},${q.to.z}`);
        // The tiles beside the first Range were spent; the second one's ring shares some, and they are tried again.
        expect(new Set(walks).size).toBeLessThan(walks.length);
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(cooking, { params, timeline: w.series(1) })).result.reason;

describe('cooking: preflight', () => {
    test('needs the food, a known free-world food and the level', async () => {
        expect(await refusal(kit.inv('Raw shrimps', 0))).toBe('preflight: no "Raw shrimps" in inventory');
        expect(await refusal(kit.inv('Raw trout', 1, { id: 335 }), { ...PARAMS, food: 'Raw trout' })).toBe(
            'preflight: Raw trout needs cooking 15, bot has 1',
        );
        expect(await refusal(kit.inv('Raw shark', 1, { id: 383 }), { ...PARAMS, food: 'Raw shark' })).toStartWith(
            'preflight: unknown or members-only food "Raw shark" (known: raw shrimps,',
        );
    });

    test('a high enough level passes', async () => {
        const r = await simulate(cooking, {
            params: { ...PARAMS, food: 'Raw trout' },
            timeline: kit.skill('Cooking', 15, 0).inv('Raw trout', 1, { id: 335 }).inv('Raw shrimps', 0).series(1),
        });
        expect(r.result.reason).not.toStartWith('preflight');
    });

    test('refuses an area reaching the Wilderness', async () => {
        expect(await refusal(kit, { ...PARAMS, area: { x: 3200, z: 3600, radius: 5 } })).toBe(
            'preflight: area (3200,3600) radius 5 reaches the Wilderness',
        );
    });
});

describe('cooking: guards', () => {
    test('low HP mid-cook aborts it and eats, then cooking resumes', async () => {
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit
                .inv('Bread', 1)
                .series(40, (w, i) => after(w.player({ hp: i === 2 ? 4 : 10 }), i >= 14 ? 3 : 0)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.some(s => s === 'Eat Bread')).toBe(true);
    });

    test('a level-up dialog with the result is cleared and the cook counts', async () => {
        const r = await simulate(cooking, {
            params: PARAMS,
            timeline: kit.series(30, (w, i) => {
                const s = after(w, i >= 4 ? 3 : 0);
                return i >= 4 && i < 6 ? s.dialog({ text: 'Congratulations, you just advanced a Cooking level.' }) : s;
            }),
        });
        expect(r.result.status).toBe('done');
    });
});
