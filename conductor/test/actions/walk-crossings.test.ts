// walkTo through the moves of the walk graph (cross.ts) and a bank detour, over a scripted walk world: the island of
// the walk-graph tests, everything east of a blocked column at x 3216, reached by a talisman teleport straight
// across at z 3220 or by a free log balance far north at z 3231.
import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { locSizes } from '../../../wiki/world/place';
import { at, Grid } from '../../../wiki/world/test/grid';
import type { Crossing } from '../../../wiki/world/types';
import type { Pathfinder } from '../../actions/paths';
import { WALK_RESERVE_TICKS, type WalkOptions, type WalkResult, walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { configId } from '../../lib/packs';
import { defineTask } from '../../lib/task';
import { walkGraph, type WalkWorld } from '../../lib/walk-graph';
import { fakePaths, straightPaths } from '../paths';
import { bankReact, walking } from '../react';
import { simulate } from '../simulate';
import { world } from '../world';

const START = { x: 3210, z: 3220 };
const EAST = { x: 3225, z: 3220 };
const BANK = at(0, 3211, 3220);
const RUINS_ID = configId('loc', 'airtemple_ruined')!;
const LOG_ID = configId('loc', 'gnome_log_balance1')!;
const PORTAL_ID = configId('loc', 'blankrunestone_exit_portal')!;
const MAN_ID = configId('npc', 'man')!;

const talisman = (landings: Crossing['landings'] = [{ tile: at(0, EAST.x, EAST.z), spread: 0 }]): Crossing => ({
    via: 'teleport',
    act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
    at: at(0, 3214, 3220),
    from: [at(0, 3215, 3220)],
    landings,
    requires: [['item:air_talisman:held']],
    source: 'runecraft.rs2:45',
});
const logBalance: Crossing = {
    via: 'scripted',
    act: { kind: 'loc-op', loc: 'gnome_log_balance1', op: 1 },
    at: at(0, 3214, 3231),
    from: [at(0, 3215, 3231)],
    landings: [{ tile: at(0, 3217, 3231), spread: 0 }],
    requires: [[]],
    source: 'a.rs2:1',
};

/** The walk world over the island (blocked columns at `columns`) with these crossings, and the bank south of the start. */
function island(crossings: Crossing[], columns = [3216]): WalkWorld {
    const grid = new Grid();
    for (const x of columns) for (let tz = 3200; tz < 3232; tz++) grid.block(at(0, x, tz));
    const graph = walkGraph({
        world: { features: [], connectors: [], gates: [], transports: [], crossings },
        collision: grid,
        size: locSizes(new Map()),
        opName: () => undefined,
    });
    return { graph, connectors: [], banks: [{ stand: BANK, reach: [[]] }] };
}

const base = world()
    .player({ at: START })
    .loc('Mysterious ruins', 3214, 3220, { id: RUINS_ID, options: ['Enter'] })
    .loc('Log balance', 3214, 3231, { id: LOG_ID, options: ['Walk-across'] })
    .loc('Bank booth', 3211, 3221, { options: ['Use'] });

/** Moves the player to `to` from the next tick on. */
const moveTo =
    (to: { x: number; z: number }): Effect =>
    s =>
        world(s).player({ at: to }).build();

/**
 * The game's answers: the ruins teleport (to `landing`, taking the talisman when it is `spent`), the log balance (or a
 * fall off it, `slip`), the bank (holding `banked`), and `also`'s own.
 */
function game(opts: {
    landing?: { x: number; z: number };
    spent?: boolean;
    refuse?: boolean;
    slip?: boolean;
    banked?: { name: string; count: number }[];
    also?: (a: BotAction) => Effect | undefined;
}) {
    const bank = bankReact(opts.banked ?? []);
    return walking((a: BotAction, s: BotWorldState): Effect | undefined => {
        if (a.type === 'useItemOnLoc' && a.locId === RUINS_ID)
            return opts.refuse
                ? t => world(t).message('Nothing interesting happens.').build()
                : opts.spent
                  ? t =>
                        world(t)
                            .player({ at: opts.landing ?? EAST })
                            .inv('Air talisman', 0)
                            .build()
                  : moveTo(opts.landing ?? EAST);
        if (a.type === 'interactLoc' && a.locId === LOG_ID)
            return opts.slip ? t => world(t).message('You slip and fall.').build() : moveTo({ x: 3217, z: 3231 });
        return opts.also?.(a) ?? bank(a, s);
    });
}

interface WalkSetup {
    /** The plan's bank record (ActionContext.bank). */
    bank?: (item: string) => number | undefined;
    paths?: Pathfinder;
    opts?: WalkOptions;
    /** The step's ticks: the walk runs as a step with this many ticks left at its start (ActionContext.stepTicksLeft). */
    stepTicks?: number;
}

async function walk(first: BotWorldState, walkWorld: WalkWorld, react: ReturnType<typeof game>, setup: WalkSetup = {}) {
    const driver = new TimelineDriver([first], { react });
    const end = first.tick + (setup.stepTicks ?? 0);
    const ctx = {
        state: () => driver.state(),
        pathfinder: setup.paths ?? straightPaths(),
        walkWorld,
        ...(setup.bank && { bank: setup.bank }),
        ...(setup.stepTicks !== undefined && { stepTicksLeft: () => end - driver.state().tick }),
    };
    const run = await interpret(walkTo(ctx, EAST.x, EAST.z, 0, setup.opts), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const sends = driver.commands.flatMap(c =>
        c.type === 'send' && c.action.type !== 'walkTo' ? [c.action.reason] : [],
    );
    const logs = driver.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
    const p = driver.state().player!;
    return { result: run.value as WalkResult, sends, logs, at: { x: p.worldX, z: p.worldZ }, end, driver };
}

describe('walkTo through moves', () => {
    test('a teleport the bot can use: it walks to the approach, uses the talisman, walks on from the landing', async () => {
        const w = await walk(base.inv('Air talisman').build(), island([talisman(), logBalance]), game({}));
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual(['use Air talisman on Mysterious ruins']);
        expect(w.at).toEqual(EAST);
    });

    test('without the talisman it takes the free way round: the log balance', async () => {
        const w = await walk(base.build(), island([talisman(), logBalance]), game({}));
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual(['Walk-across Log balance']);
    });

    test('a random landing: the walk plans again from the landing it got', async () => {
        const landings = [
            { tile: at(0, 3220, 3228), spread: 8 },
            { tile: at(0, 3220, 3212), spread: 8 },
        ];
        const w = await walk(
            base.inv('Air talisman').build(),
            island([talisman(landings)]),
            game({ landing: { x: 3220, z: 3212 } }),
        );
        expect(w.result.ok).toBe(true);
        expect(w.at).toEqual(EAST);
    });

    test('a move the game refuses is given up on, and the walk plans the other way', async () => {
        const w = await walk(
            base.inv('Air talisman').build(),
            island([talisman(), logBalance]),
            game({ refuse: true }),
        );
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual(['use Air talisman on Mysterious ruins', 'Walk-across Log balance']);
        expect(w.logs.some(l => /refused: .*Nothing interesting happens/.test(l))).toBe(true);
    });

    test('with no other way left it is cross-failed, saying why', async () => {
        const w = await walk(base.inv('Air talisman').build(), island([talisman()]), game({ refuse: true }));
        expect(w.result).toMatchObject({ ok: false, reason: 'cross-failed' });
        expect(w.result.message).toContain('Nothing interesting happens');
    });
});

describe("a move's stand the walk cannot walk to", () => {
    // The pathfinder has no route to the ruins' approach tile (3215, 3220): the graph's way there is not the collision's.
    const paths = fakePaths((from, to) =>
        to.x === 3215 && to.z === 3220
            ? { success: false, waypoints: [], error: 'no route' }
            : { success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] },
    );

    test('the move is given up on and the walk plans the other way', async () => {
        const w = await walk(base.inv('Air talisman').build(), island([talisman(), logBalance]), game({}), { paths });
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual(['Walk-across Log balance']);
        expect(w.logs.some(l => /walking to the .* at \(3214, 3220\): .*planning without it/.test(l))).toBe(true);
    });

    test('with no other way in the graph, the walk is walked on the plane, as without the graph', async () => {
        const w = await walk(base.inv('Air talisman').build(), island([talisman()]), game({}), { paths });
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual([]);
        expect(w.at).toEqual(EAST);
    });

    test('a walk on the plane that then fails says why the move was given up', async () => {
        const nowhere = fakePaths((from, to) =>
            to.x === 3215 && to.z === 3220
                ? { success: false, waypoints: [], error: 'no route to the ruins' }
                : to.x === EAST.x && to.z === EAST.z
                  ? { success: false, waypoints: [], error: 'no route east' }
                  : { success: true, reachedDestination: true, waypoints: [{ ...to, level: from.level }] },
        );
        const w = await walk(base.inv('Air talisman').build(), island([talisman()]), game({}), { paths: nowhere });
        expect(w.result.ok).toBe(false);
        expect(w.result).not.toMatchObject({ reason: 'cross-failed' });
        expect(w.result.message).toMatch(/no route east.*; no way left to .*: walking to the .*no route to the ruins/);
    });
});

describe('a rolled move that keeps failing', () => {
    const rolled: Crossing = {
        ...logBalance,
        roll: { stat: 'agility', low: 50, high: 250, source: 'a.rs2:2', fail: { ticks: 5, damage: 0 } },
    };

    test("is tried again only while another attempt fits the walk's budget: the step never overruns", async () => {
        const stepTicks = 80;
        const w = await walk(base.build(), island([rolled]), game({ slip: true }), { stepTicks });
        const attempts = w.sends.filter(s => s === 'Walk-across Log balance').length;
        expect(attempts).toBeGreaterThan(1);
        expect(w.result).toMatchObject({ ok: false, reason: 'timeout', advancing: true });
        expect(w.driver.state().tick).toBeLessThanOrEqual(w.end - WALK_RESERVE_TICKS);
    });
});

describe('the wizard on record', () => {
    // Three shores: west of x 3216, the middle (3217-3221), east of x 3222. A man's teleport takes the bot from the
    // west to the middle; a portal that asks the wizard Aubury on record takes it on east.
    const man: Crossing = {
        via: 'teleport',
        act: { kind: 'npc-op', npc: 'man', op: 1 },
        at: at(0, 3214, 3220),
        from: [at(0, 3215, 3220)],
        landings: [{ tile: at(0, 3219, 3220), spread: 0 }],
        requires: [[]],
        source: 'm.rs2:1',
    };
    const portal: Crossing = {
        via: 'teleport',
        act: { kind: 'loc-op', loc: 'blankrunestone_exit_portal', op: 1 },
        at: at(0, 3220, 3226),
        from: [at(0, 3220, 3225)],
        landings: [{ tile: at(0, 3224, 3220), spread: 0 }],
        requires: [['other:came from aubury']],
        source: 'essence_mine.rs2:41',
    };
    const shores = base
        .npc('Man', 3214, 3220, { id: MAN_ID, options: ['Teleport'] })
        .loc('Portal', 3220, 3226, { id: PORTAL_ID, options: ['Enter'] });
    const also = (a: BotAction): Effect | undefined => {
        if (a.type === 'interactNpc') return moveTo({ x: 3219, z: 3220 });
        if (a.type === 'interactLoc' && a.locId === PORTAL_ID) return moveTo({ x: 3224, z: 3220 });
        return undefined;
    };

    test('an npc move no came-from requirement names does not replace it', async () => {
        const w = await walk(shores.build(), island([man, portal], [3216, 3222]), game({ also }), {
            opts: { met: ['other:came from aubury'] },
        });
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual(['Teleport Man', 'Enter Portal']);
    });
});

describe('walkTo with a bank detour', () => {
    const TALISMAN = [{ name: 'Air talisman', count: 1 }];
    /** East, back west, east again: three walks in one run. */
    const walks = defineTask({
        name: 'walks',
        description: 'east, back west, east again',
        params: z.object({}),
        steps: [
            {
                name: 'walks',
                when: () => true,
                *run(ctx) {
                    for (const to of [EAST, START, EAST]) {
                        const r = yield* walkTo(ctx, to.x, to.z, 0);
                        if (!r.ok) return { fail: r.message };
                    }
                    return { done: 'walked' };
                },
            },
        ],
    });

    test('the bank holds the talisman: to the bank, withdraw it, then the teleport', async () => {
        const w = await walk(base.build(), island([talisman(), logBalance]), game({ banked: TALISMAN }), {
            bank: item => (item === 'Air talisman' ? 1 : 0),
        });
        expect(w.result.ok).toBe(true);
        expect(w.sends).toEqual([
            'Use Bank booth',
            'withdraw Air talisman',
            'close bank',
            'use Air talisman on Mysterious ruins',
        ]);
    });

    test('no bank record: no detour, the way round', async () => {
        const w = await walk(base.build(), island([talisman(), logBalance]), game({ banked: TALISMAN }));
        expect(w.sends).toEqual(['Walk-across Log balance']);
    });

    test('the record says one, the bank holds none: the walk plans again without it', async () => {
        const w = await walk(base.build(), island([talisman(), logBalance]), game({ banked: [] }), { bank: () => 1 });
        expect(w.result.ok).toBe(true);
        expect(w.sends.at(-1)).toBe('Walk-across Log balance');
        expect(w.sends).not.toContain('use Air talisman on Mysterious ruins');
        expect(w.logs.some(l => /holds no air_talisman/.test(l))).toBe(true);
    });

    test("a later walk in the same run plans on what the run saw in the bank, not the plan's record", async () => {
        const sim = await simulate(walks, {
            timeline: [base.build()],
            react: game({ banked: [] }),
            walkWorld: island([talisman(), logBalance]),
            bank: { 'Air talisman': 1 },
        });
        expect(sim.result.status).toBe('done');
        expect(sim.sends.filter(s => s === 'Use Bank booth')).toHaveLength(1);
        expect(sim.sends.filter(s => s === 'Walk-across Log balance')).toHaveLength(2);
    });

    test('a later walk in the same run plans on the count the withdraw left: the one spent talisman, none', async () => {
        const spent = talisman();
        spent.requires = [['consume:air_talisman:1']];
        const sim = await simulate(walks, {
            timeline: [base.build()],
            react: game({ banked: [...TALISMAN, { name: 'Logs', count: 5 }], spent: true }),
            walkWorld: island([spent, logBalance]),
            bank: { 'Air talisman': 1 },
        });
        expect(sim.result.status).toBe('done');
        expect(sim.sends.filter(s => s === 'Use Bank booth')).toHaveLength(1);
        expect(sim.sends.filter(s => s === 'withdraw Air talisman')).toHaveLength(1);
        expect(sim.sends.filter(s => s === 'use Air talisman on Mysterious ruins')).toHaveLength(1);
        expect(sim.sends.filter(s => s === 'Walk-across Log balance')).toHaveLength(1);
    });
});
