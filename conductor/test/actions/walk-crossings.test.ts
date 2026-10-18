// walkTo through the moves of the walk graph (cross.ts) and a bank detour, over a scripted walk world: the island of
// the walk-graph tests, everything east of a blocked column at x 3216, reached by a talisman teleport straight
// across at z 3220 or by a free log balance far north at z 3231.
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { locSizes } from '../../../wiki/world/place';
import { at, Grid } from '../../../wiki/world/test/grid';
import type { Crossing } from '../../../wiki/world/types';
import { type WalkResult, walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { configId } from '../../lib/packs';
import { walkGraph, type WalkWorld } from '../../lib/walk-graph';
import { straightPaths } from '../paths';
import { bankReact, walking } from '../react';
import { world } from '../world';

const START = { x: 3210, z: 3220 };
const EAST = { x: 3225, z: 3220 };
const BANK = at(0, 3211, 3220);
const RUINS_ID = configId('loc', 'airtemple_ruined')!;
const LOG_ID = configId('loc', 'gnome_log_balance1')!;

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

/** The walk world over the island with these crossings, and the bank south of the start. */
function island(crossings: Crossing[]): WalkWorld {
    const grid = new Grid();
    for (let z = 3200; z < 3232; z++) grid.block(at(0, 3216, z));
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

/** The game's answers: the ruins teleport (to `landing`), the log balance, the bank (holding `banked`). */
function game(opts: {
    landing?: { x: number; z: number };
    refuse?: boolean;
    banked?: { name: string; count: number }[];
}) {
    const bank = bankReact(opts.banked ?? []);
    return walking((a: BotAction, s: BotWorldState): Effect | undefined => {
        if (a.type === 'useItemOnLoc' && a.locId === RUINS_ID)
            return opts.refuse
                ? t => world(t).message('Nothing interesting happens.').build()
                : moveTo(opts.landing ?? EAST);
        if (a.type === 'interactLoc' && a.locId === LOG_ID) return moveTo({ x: 3217, z: 3231 });
        return bank(a, s);
    });
}

async function walk(
    first: BotWorldState,
    walkWorld: WalkWorld,
    react: ReturnType<typeof game>,
    bank?: (item: string) => number | undefined,
) {
    const driver = new TimelineDriver([first], { react });
    const ctx = { state: () => driver.state(), pathfinder: straightPaths(), walkWorld, ...(bank && { bank }) };
    const run = await interpret(walkTo(ctx, EAST.x, EAST.z, 0), { driver });
    if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
    const sends = driver.commands.flatMap(c =>
        c.type === 'send' && c.action.type !== 'walkTo' ? [c.action.reason] : [],
    );
    const logs = driver.commands.flatMap(c => (c.type === 'log' ? [c.msg] : []));
    const p = driver.state().player!;
    return { result: run.value as WalkResult, sends, logs, at: { x: p.worldX, z: p.worldZ } };
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

describe('walkTo with a bank detour', () => {
    const TALISMAN = [{ name: 'Air talisman', count: 1 }];

    test('the bank holds the talisman: to the bank, withdraw it, then the teleport', async () => {
        const w = await walk(base.build(), island([talisman(), logBalance]), game({ banked: TALISMAN }), item =>
            item === 'Air talisman' ? 1 : 0,
        );
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
        const w = await walk(base.build(), island([talisman(), logBalance]), game({ banked: [] }), () => 1);
        expect(w.result.ok).toBe(true);
        expect(w.sends.at(-1)).toBe('Walk-across Log balance');
        expect(w.sends).not.toContain('use Air talisman on Mysterious ruins');
        expect(w.logs.some(l => /holds no air_talisman/.test(l))).toBe(true);
    });
});
