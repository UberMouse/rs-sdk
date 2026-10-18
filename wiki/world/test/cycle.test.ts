import { describe, expect, test } from 'bun:test';
import {
    BANK_TICKS,
    cycle,
    dropTicks,
    EAT_DELAY,
    eatTicksPerFail,
    RECLICK_PACKETS,
    type CycleInput,
} from '../model/cycle';
import { ModelError, type ActionModel } from '../model/family';
import { INVENTORY_SLOTS, readItems } from '../model/items';
import { TICKS_PER_HOUR, USER_EVENTS_PER_TICK, XP_RATE } from '../model/server';
import { parseConfigs } from '../sources/configs';

// Synthetic objs: a worn pick, a carried rod, stackable feathers and coins (coins with no cost: the engine's 1).
const items = readItems(
    parseConfigs(`
[ore]
cost=10
[pick]
wearpos=righthand
[rod]
cost=5
[feather]
stackable=yes
cost=2
[coins]
stackable=yes
[raw]
cost=20
[cooked]
cost=30
[burnt]
cost=1
[food]
cost=50
[jug]
cost=3
`),
);

/** A rock: one roll every 4 ticks that always succeeds and depletes it for `respawn` ticks. */
const rock = (features: number, respawn: number): ActionModel => ({
    ticksPerAttempt: 4,
    success: 1,
    xpTenths: { mining: 350 },
    products: [{ obj: 'ore', count: 1 }],
    consumes: [],
    deplete: { chance: 1, respawnTicks: respawn },
    features,
    tools: ['pick'],
});

/** A fishing spot: a roll every 5 ticks at 1/2, a feather a catch, the rod carried. */
const spot: ActionModel = {
    ticksPerAttempt: 5,
    success: 0.5,
    xpTenths: { fishing: 500 },
    products: [{ obj: 'raw', count: 1 }],
    consumes: [{ obj: 'feather', count: 1 }],
    tools: ['rod'],
};

const run = (input: Omit<CycleInput, 'items'>) => cycle({ ...input, items });

/** Runs the cycle, expecting a ModelError whose message matches `re`. */
function fails(input: Omit<CycleInput, 'items'>, re: RegExp): void {
    expect(() => run(input)).toThrow(ModelError);
    expect(() => run(input)).toThrow(re);
}

describe('constants', () => {
    test('drops go five a tick with the re-click in the pool, a bank visit adds none, an eat 3 ticks', () => {
        // USER_EVENT.limit 5 (ClientGameProtCategory.ts:6); bank.rs2 @openbank has no delay; consume.rs2:3 `2, 3`.
        // The re-click is MOVE_OPCLICK + OPLOC1, both USER_EVENT.
        expect(USER_EVENTS_PER_TICK).toBe(5);
        expect(RECLICK_PACKETS).toBe(2);
        expect(dropTicks(28)).toBe(6); // ceil(30 / 5)
        expect(dropTicks(26)).toBe(6); // 28 / 5 = 5.6, ceil 6
        expect(dropTicks(23)).toBe(5); // 25 / 5
        expect(BANK_TICKS).toBe(0);
        expect(EAT_DELAY).toBe(3);
        expect(INVENTORY_SLOTS).toBe(28);
    });
});

describe('drop sink', () => {
    test('a spot that never depletes: a full inventory of fish dropped in whole ticks with the re-click', () => {
        // The rod and a feather stack leave 28 - 1 - 1 = 26 slots: 26 catches of 5 / 0.5 = 10 ticks, 260. Dropping 26
        // fish and re-clicking is 28 packets, ceil(28 / 5) = 6 ticks: a trip of 266 for 26 fish. 9000 / 266 x 26 =
        // 879.7 fish an hour, 50 XP x 25 each: 1,099,624.1 Fishing XP. A dropped fish keeps no value; a feather each,
        // 2 gp: 1,759.4 gp of supplies.
        const r = run({ gather: spot, sink: { mode: 'drop' } });
        expect(r.trip).toEqual({
            successes: 26,
            gather: 260,
            process: 0,
            travel: 0,
            bank: 0,
            drop: 6,
            eat: 0,
            wait: 0,
            total: 266,
        });
        expect(r.binding).toBe('player');
        const fish = (9000 / 266) * 26;
        expect(r.xpPerHour.fishing).toBeCloseTo(fish * 50 * 25, 6);
        expect(r.itemsPerHour[0]!.count).toBeCloseTo(fish, 9);
        expect(r.gpPerHour).toBe(0);
        expect(r.suppliesGpPerHour).toBeCloseTo(fish * 2, 9);
    });

    test('a model that depletes but names no features is refused, not run at one feature', () => {
        const { features: _, ...noFeatures } = rock(2, 10);
        fails({ gather: noFeatures, sink: { mode: 'drop' } }, /depletes but names no features/);
    });

    test('a rock that depletes every ore drops as it goes, and two rocks respawning in 10 cap it', () => {
        // Each rock gives 1 ore per 4 + 10 ticks, so two give 2/14 = 1/7 an ore a tick: 7 ticks an ore against the
        // player's 4, 3 of them waiting. No drop ticks: the drop rides on the next rock's click. 9000 / 7 = 1,285.7
        // ore an hour at 35 XP x 25 = 875 each: 1,125,000 Mining XP.
        const r = run({ gather: rock(2, 10), sink: { mode: 'drop' } });
        expect(r.trip).toMatchObject({ successes: 1, gather: 4, drop: 0, wait: 3, total: 7 });
        expect(r.binding).toBe('resource');
        expect(r.xpPerHour.mining).toBeCloseTo(1_125_000, 6);
    });
});

describe('bank sink', () => {
    test('a worn pick leaves 28 slots: 28 ore, then 30 ticks each way', () => {
        // Three rocks cap at 3/14 an ore a tick, 28 ore in 130.7 ticks; the trip takes 28 x 4 = 112 + 60 = 172, so the
        // cap does not bind. 9000 / 172 x 28 = 1,465.1 ore an hour: 1,281,976.7 Mining XP, 14,651.2 gp at 10 each.
        const r = run({ gather: rock(3, 10), sink: { mode: 'bank', legs: [30, 30] } });
        expect(r.trip).toEqual({
            successes: 28,
            gather: 112,
            process: 0,
            travel: 60,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 172,
        });
        expect(r.binding).toBe('player');
        expect(r.xpPerHour.mining).toBeCloseTo((9000 / 172) * 28 * 875, 6);
        expect(r.gpPerHour).toBeCloseTo((9000 / 172) * 28 * 10, 6);
    });

    test('the resource cap holds over the whole trip: the rocks respawn while the player banks', () => {
        // Two rocks respawning in 20: 2/24 = 1/12 an ore a tick, so 28 ore take at least 336 ticks; the trip's own
        // 112 + 60 = 172 leaves 164 of waiting. 9000 / 336 x 28 = 750 ore an hour.
        const r = run({ gather: rock(2, 20), sink: { mode: 'bank', legs: [30, 30] } });
        expect(r.trip).toMatchObject({ successes: 28, gather: 112, travel: 60, wait: 164, total: 336 });
        expect(r.binding).toBe('resource');
        expect(r.xpPerHour.mining).toBeCloseTo(750 * 875, 6);
    });

    test('travel binds when the legs outweigh the gathering', () => {
        // 112 ticks of mining against 200 of walking.
        const r = run({ gather: rock(3, 10), sink: { mode: 'bank', legs: [100, 100] } });
        expect(r.trip.total).toBe(312);
        expect(r.binding).toBe('travel');
    });

    test('a carried tool, a stackable supply and a stackable product each take a slot', () => {
        // The rod (no wearpos) and the feathers take 2 slots: 26 fish a trip.
        expect(run({ gather: spot, sink: { mode: 'bank', legs: [1, 1] } }).trip.successes).toBe(26);
        // A loot of coins (stackable) and a jug per success: 28 - 1 = 27 jugs.
        const loot: ActionModel = {
            ...spot,
            consumes: [],
            tools: [],
            products: [
                { obj: 'coins', count: 5 },
                { obj: 'jug', count: 1 },
            ],
        };
        expect(run({ gather: loot, sink: { mode: 'bank', legs: [1, 1] } }).trip.successes).toBe(27);
    });

    test('with only stackable products the inventory never fills: no trips', () => {
        const coins: ActionModel = { ...spot, consumes: [], tools: [], products: [{ obj: 'coins', count: 5 }] };
        const r = run({ gather: coins, sink: { mode: 'bank', legs: [30, 30] } });
        expect(r.trip).toMatchObject({ successes: 1, gather: 10, travel: 0, bank: 0, total: 10 });
        // Coins carry no cost: the engine's default of 1 each.
        expect(r.gpPerHour).toBeCloseTo((9000 / 10) * 5, 9);
    });
});

describe('process-bank sink', () => {
    // A cooking step: 3 ticks an item, 3/4 cooked at 80 XP, 1/4 burnt (expected XP 60 an item).
    const cook: ActionModel = {
        ticksPerAttempt: 3,
        success: 1,
        xpTenths: { cooking: 600 },
        products: [
            { obj: 'cooked', count: 0.75 },
            { obj: 'burnt', count: 0.25 },
        ],
        consumes: [{ obj: 'raw', count: 1 }],
    };

    test('fish, cook each one (burnt ones too take their ticks), bank, come back', () => {
        // 26 fish (rod and feathers take 2 slots) x 10 = 260 ticks; 26 x 3 = 78 cooking; legs 10 + 50 + 40 = 100;
        // 438 a trip. 9000 / 438 x 26 = 534.25 fish an hour: 667,808.2 Fishing XP (1,250 each), 801,369.9 Cooking
        // (60 x 25 = 1,500 each); 400.68 cooked (30 gp) and 133.56 burnt (1 gp) banked, 12,154.1 gp.
        const r = run({ gather: spot, sink: { mode: 'process-bank', process: [cook], legs: [10, 50, 40] } });
        const fish = (9000 / 438) * 26;
        expect(r.trip).toEqual({
            successes: 26,
            gather: 260,
            process: 78,
            travel: 100,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 438,
        });
        expect(r.binding).toBe('player');
        expect(r.xpPerHour.fishing).toBeCloseTo(fish * 1250, 6);
        expect(r.xpPerHour.cooking).toBeCloseTo(fish * 1500, 6);
        expect(r.itemsPerHour).toEqual([
            { obj: 'cooked', count: fish * 0.75 },
            { obj: 'burnt', count: fish * 0.25 },
        ]);
        expect(r.gpPerHour).toBeCloseTo(fish * (0.75 * 30 + 0.25 * 1), 6);
    });

    test("a process step's carried tool takes a slot too, once when the gather carries it as well", () => {
        // The jug (no wearpos) as the step's tool: 25 fish a trip, 250 + 75 + 100 = 425 ticks. The rod again: no extra
        // slot.
        const jug: ActionModel = { ...cook, tools: ['jug'] };
        expect(
            run({ gather: spot, sink: { mode: 'process-bank', process: [jug], legs: [10, 50, 40] } }).trip,
        ).toMatchObject({
            successes: 25,
            total: 425,
        });
        const rod: ActionModel = { ...cook, tools: ['rod'] };
        expect(
            run({ gather: spot, sink: { mode: 'process-bank', process: [rod], legs: [10, 50, 40] } }).trip.successes,
        ).toBe(26);
    });

    test('a step whose input the gather does not give does nothing; the raw fish is banked as caught', () => {
        const other: ActionModel = { ...cook, consumes: [{ obj: 'ore', count: 1 }] };
        const r = run({ gather: spot, sink: { mode: 'process-bank', process: [other], legs: [10, 50, 40] } });
        expect(r.trip).toMatchObject({ process: 0, total: 360 });
        expect(r.itemsPerHour.map(x => x.obj)).toEqual(['raw']);
    });
});

describe('food', () => {
    // A pickpocket: an attempt every 2 ticks at 3/4, a fail 9 ticks more and 2 hitpoints, 30 coins a success.
    const pocket: ActionModel = {
        ticksPerAttempt: 2,
        success: 0.75,
        xpTenths: { thieving: 400 },
        products: [{ obj: 'coins', count: 30 }],
        consumes: [],
        failTicks: 9,
        failDamage: 2,
    };

    test('every free slot holds food, and the trip lasts as long as it does', () => {
        // ticksPerItem (2 + 1/4 x 9) / (3/4) = 17/3. A success costs 1/3 of a fail, 2/3 hitpoints: a food healing 6
        // covers 9 successes, and the 27 slots coins leave cover 243. 243 x 17/3 = 1,377 ticks + 40 of legs = 1,417.
        // Eats are free: 2/6 = 1/3 an eat a fail, under the 9/16 of stuns followed by two successes. 9000 / 1417 x 243
        // = 1,543.4 picks an hour: 1,543,401.6 Thieving XP (40 x 25 each), 46,302 gp of coins, 171.5 food (50 gp).
        const r = run({ gather: pocket, sink: { mode: 'bank', legs: [20, 20] }, food: { obj: 'food', heal: 6 } });
        const picks = (9000 / 1417) * 243;
        expect(r.trip.successes).toBeCloseTo(243, 9);
        expect(r.trip.gather).toBeCloseTo(1377, 9);
        expect(r.trip).toMatchObject({ travel: 40, eat: 0, wait: 0 });
        expect(r.xpPerHour.thieving).toBeCloseTo(picks * 1000, 4);
        expect(r.gpPerHour).toBeCloseTo(picks * 30, 4);
        expect(r.suppliesPerHour).toEqual([{ obj: 'food', count: expect.closeTo(picks / 9, 6) }]);
        expect(r.suppliesGpPerHour).toBeCloseTo((picks / 9) * 50, 4);
    });

    test('an eat is free from the third attempt after a stun, 1 tick at the second, 3 at the first', () => {
        // At p 1/2: a stun is followed by two successes 1/4 of the time (free), by one then a fail 1/4 (1 tick).
        expect(eatTicksPerFail(0.2, 0.5)).toBe(0);
        // 0.4 eats a fail: 0.25 free, 0.15 at 1 tick.
        expect(eatTicksPerFail(0.4, 0.5)).toBeCloseTo(0.15, 12);
        // 0.9: 0.25 free, 0.25 at 1 tick, 0.4 at 3 ticks: 0.25 + 1.2.
        expect(eatTicksPerFail(0.9, 0.5)).toBeCloseTo(1.45, 12);
    });

    test('the eat ticks enter the trip', () => {
        // p 1/2, 2 damage a fail and a heal of 2: 1 eat a fail, 0.25 + 3 x 0.5 = 1.75 ticks a fail. A success costs a
        // fail (1/2 / 1/2), so 1.75 eat ticks a success; food covers 1 success a slot: 27 a trip, 47.25 eat ticks.
        const weak: ActionModel = { ...pocket, success: 0.5 };
        const r = run({ gather: weak, sink: { mode: 'bank', legs: [20, 20] }, food: { obj: 'food', heal: 2 } });
        expect(r.trip.successes).toBe(27);
        expect(r.trip.eat).toBeCloseTo(27 * 1.75, 9);
    });

    test('fails with a reason where it is not modelled', () => {
        const food = { obj: 'food', heal: 6 };
        fails({ gather: pocket, sink: { mode: 'bank', legs: [1, 1] } }, /costs 2 hitpoints a fail: name a food/);
        fails({ gather: pocket, sink: { mode: 'drop' }, food }, /nothing restocks it/);
        fails({ gather: spot, sink: { mode: 'bank', legs: [1, 1] }, food }, /costs no hitpoints/);
        const jugs: ActionModel = { ...pocket, products: [{ obj: 'jug', count: 1 }] };
        fails({ gather: jugs, sink: { mode: 'bank', legs: [1, 1] }, food }, /fills the inventory is not modelled/);
        const rawBait: ActionModel = { ...spot, consumes: [{ obj: 'raw', count: 1 }] };
        fails({ gather: rawBait, sink: { mode: 'drop' } }, /supply raw is not stackable/);
    });
});

test('XP is the script tenths over 10 times the server rate', () => {
    // One success a tick, 100 tenths: 10 XP x XP_RATE x 9000.
    const once: ActionModel = { ticksPerAttempt: 1, success: 1, xpTenths: { magic: 100 }, products: [], consumes: [] };
    expect(run({ gather: once, sink: { mode: 'drop' } }).xpPerHour.magic).toBe(10 * XP_RATE * TICKS_PER_HOUR);
});
