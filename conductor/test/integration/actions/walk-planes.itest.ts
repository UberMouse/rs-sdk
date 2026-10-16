import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import type { ActionResult, BotAction } from '../../../../sdk/types';
import { WALK_MAX_TICKS, type WalkResult, walkTo } from '../../../actions/walk';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

/** A live driver that keeps the reason of every send. */
class Recording extends LiveDriver {
    readonly sent: string[] = [];
    override async send(a: BotAction): Promise<ActionResult> {
        this.sent.push(a.reason);
        return super.send(a);
    }
}

async function walk(sdk: BotSDK, x: number, z: number, level: number) {
    const driver = new Recording(sdk, SINKS, TICK_STALL_MS);
    try {
        const r = await interpret(walkTo(driver, x, z, 1, { level }), { driver });
        if (r.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(r)}`);
        return { result: r.value as WalkResult, sent: driver.sent };
    } finally {
        driver.close();
    }
}

const here = (sdk: BotSDK) => {
    const p = sdk.getState()!.player!;
    return { level: p.level, x: p.worldX, z: p.worldZ };
};

// Lumbridge castle's south-west staircase (3204,3207): ground floor, first floor (its Climb-up and
// Climb-down), top floor. The start is inside the castle, west of the front doors the walk test shuts
// and opens, so the two do not meet.
const START = { x: 3208, z: 3210 };
const TOP_FLOOR = { x: 3207, z: 3212 };
const CLIMBS = /^Climb-(up|down) Staircase$/;
/** Walks a leg of a floor may take to carry on after a timeout. */
const MAX_WALKS = 3;

/** Walks to the destination, carrying on after a `timeout` as a task would. */
async function arrive(sdk: BotSDK, x: number, z: number, level: number) {
    const sent: string[] = [];
    let result: WalkResult | undefined;
    for (let i = 0; i < MAX_WALKS; i++) {
        const w = await walk(sdk, x, z, level);
        sent.push(...w.sent);
        result = w.result;
        if (result.ok || result.reason !== 'timeout') break;
    }
    return { result: result!, sent };
}

test(
    'walkTo climbs the Lumbridge castle stairs to the top floor and back down',
    async () => {
        await withFixtureBot({ position: START }, async ({ sdk }) => {
            const up = await arrive(sdk, TOP_FLOOR.x, TOP_FLOOR.z, 2);
            expect(up.result, JSON.stringify(up.sent)).toMatchObject({ ok: true });
            expect(here(sdk).level).toBe(2);
            expect(up.sent.filter(r => CLIMBS.test(r))).toEqual(['Climb-up Staircase', 'Climb-up Staircase']);

            const down = await arrive(sdk, START.x, START.z, 0);
            expect(down.result, JSON.stringify(down.sent)).toMatchObject({ ok: true });
            expect(here(sdk)).toMatchObject({ level: 0 });
            expect(down.sent.filter(r => CLIMBS.test(r))).toEqual(['Climb-down Staircase', 'Climb-down Staircase']);
        });
    },
    itestTimeout({ extraMs: 2 * MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);

// The Wizards' Tower: the small ground-floor room with the spiral stairs (3103,3159) and the ladder down
// to the basement (3104,3162). The start is inside it: its door (3107,3162) is a diagonal one the SDK's
// collision data does not list, so the pathfinder finds no route into the room from outside.
const TOWER_ROOM = { x: 3106, z: 3160 };
const BASEMENT = { x: 3104, z: 9577 };
const TOWER_TOP = { x: 3104, z: 3161 };
const LADDER = /^Climb-(up|down) Ladder$/;

test(
    "walkTo takes the Wizards' Tower ladder down to the basement and back up",
    async () => {
        await withFixtureBot({ position: TOWER_ROOM }, async ({ sdk }) => {
            const down = await arrive(sdk, BASEMENT.x, BASEMENT.z, 0);
            expect(down.result, JSON.stringify(down.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeGreaterThan(9000);
            expect(down.sent.filter(r => LADDER.test(r))).toEqual(['Climb-down Ladder']);

            const up = await arrive(sdk, TOWER_ROOM.x, TOWER_ROOM.z, 0);
            expect(up.result, JSON.stringify(up.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeLessThan(6400);
            expect(up.sent.filter(r => LADDER.test(r))).toEqual(['Climb-up Ladder']);
        });
    },
    itestTimeout({ extraMs: 2 * MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);

test(
    "walkTo climbs the Wizards' Tower stairs to the top floor and back",
    async () => {
        await withFixtureBot({ position: TOWER_ROOM }, async ({ sdk }) => {
            const up = await arrive(sdk, TOWER_TOP.x, TOWER_TOP.z, 2);
            expect(up.result, JSON.stringify(up.sent)).toMatchObject({ ok: true });
            expect(here(sdk)).toMatchObject({ level: 2 });
            expect(up.sent.filter(r => CLIMBS.test(r))).toHaveLength(2);

            const down = await arrive(sdk, TOWER_ROOM.x, TOWER_ROOM.z, 0);
            expect(down.result, JSON.stringify(down.sent)).toMatchObject({ ok: true });
            expect(here(sdk)).toMatchObject({ level: 0 });
            expect(down.sent.filter(r => CLIMBS.test(r))).toHaveLength(2);
        });
    },
    itestTimeout({ extraMs: 2 * MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);

// Falador, north-east: the stairs down into the Dwarven Mine and back. The fixture's combat level is above
// the scorpions' reach (twice their level, 28), so the walk to the landing is not hunted.
const FALADOR_STREET = { x: 3066, z: 3380 };
const MINE_LANDING = { x: 3058, z: 9778 };
const STAIRS = /^Climb-(up|down) Staircase$/;
const MINE_SKILLS = { Attack: 40, Strength: 40, Defence: 40, Hitpoints: 40 };

test(
    'walkTo takes the Falador stairs into the Dwarven Mine and out again',
    async () => {
        await withFixtureBot({ position: FALADOR_STREET, skills: MINE_SKILLS }, async ({ sdk }) => {
            const down = await arrive(sdk, MINE_LANDING.x, MINE_LANDING.z, 0);
            expect(down.result, JSON.stringify(down.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeGreaterThan(9000);
            expect(down.sent.filter(r => STAIRS.test(r))).toEqual(['Climb-down Staircase']);

            const up = await arrive(sdk, FALADOR_STREET.x, FALADOR_STREET.z, 0);
            expect(up.result, JSON.stringify(up.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeLessThan(6400);
            expect(up.sent.filter(r => STAIRS.test(r))).toEqual(['Climb-up Staircase']);
        });
    },
    itestTimeout({ extraMs: 2 * MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);

// Edgeville: the trapdoor in the ruined house south-west of the bank (closed: opened first, then Climb-down)
// into the Edgeville Dungeon, and the ladder back, which lands on the tile it was climbed from, inside the house. The fixture's
// combat level is above what the dungeon's spiders and skeletons hunt near the ladder.
const EDGEVILLE_BANK = { x: 3094, z: 3490 };
const DUNGEON_LANDING = { x: 3097, z: 9869 };
const TRAPDOOR_STEPS = /^(Open|Climb-down) Trapdoor$/;
const DUNGEON_SKILLS = { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 60 };

test(
    'walkTo opens the Edgeville trapdoor, climbs into the dungeon and back out by the ladder',
    async () => {
        await withFixtureBot({ position: EDGEVILLE_BANK, skills: DUNGEON_SKILLS }, async ({ sdk }) => {
            const down = await arrive(sdk, DUNGEON_LANDING.x, DUNGEON_LANDING.z, 0);
            expect(down.result, JSON.stringify(down.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeGreaterThan(9000);
            expect(down.sent.filter(r => TRAPDOOR_STEPS.test(r))).toEqual(['Open Trapdoor', 'Climb-down Trapdoor']);

            const up = await arrive(sdk, EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 0);
            expect(up.result, JSON.stringify(up.sent)).toMatchObject({ ok: true });
            expect(here(sdk).z).toBeLessThan(6400);
            expect(up.sent.filter(r => r === 'Climb-up Ladder')).toEqual(['Climb-up Ladder']);
        });
    },
    itestTimeout({ extraMs: 2 * MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);
