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
import { ModelError, ProfileError, type ActionModel } from '../model/family';
import { INVENTORY_SLOTS, readItems } from '../model/items';
import { TICKS_PER_HOUR, USER_EVENTS_PER_TICK, XP_RATE } from '../model/server';
import { parseConfigs } from '../sources/configs';

// Synthetic objs: a worn pick, a carried rod, stackable feathers and coins (coins with no cost: the engine's 1); for
// the process chains a carried hammer and knife, stackable natures and runes, non-stackable bow strings and coal, a
// wearable ring.
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
[bar]
cost=40
[plate]
cost=500
[hammer]
[nature]
stackable=yes
cost=4
[essence]
cost=2
[rune]
stackable=yes
cost=5
[log]
cost=8
[knife]
[unstrung]
cost=10
[string]
cost=15
[bow]
cost=60
[coal]
cost=1
[ring]
wearpos=ring
cost=800
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

describe('process sink, one step then bank', () => {
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
        const r = run({
            gather: spot,
            sink: { mode: 'process', steps: [[cook]], end: 'bank', legs: [10, 50, 40], here: [false] },
        });
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
            run({
                gather: spot,
                sink: { mode: 'process', steps: [[jug]], end: 'bank', legs: [10, 50, 40], here: [false] },
            }).trip,
        ).toMatchObject({
            successes: 25,
            total: 425,
        });
        const rod: ActionModel = { ...cook, tools: ['rod'] };
        expect(
            run({
                gather: spot,
                sink: { mode: 'process', steps: [[rod]], end: 'bank', legs: [10, 50, 40], here: [false] },
            }).trip.successes,
        ).toBe(26);
    });

    test('a step whose input the gather does not give does nothing; the raw fish is banked as caught', () => {
        const other: ActionModel = { ...cook, consumes: [{ obj: 'ore', count: 1 }] };
        const r = run({
            gather: spot,
            sink: { mode: 'process', steps: [[other]], end: 'bank', legs: [10, 50, 40], here: [false] },
        });
        expect(r.trip).toMatchObject({ process: 0, total: 360 });
        expect(r.itemsPerHour.map(x => x.obj)).toEqual(['raw']);
        // Nor does its tool take a slot: still 26 fish, 260 + 100 = 360 (with the jug carried, 25 and 350).
        const jugged: ActionModel = { ...other, tools: ['jug'] };
        expect(
            run({
                gather: spot,
                sink: { mode: 'process', steps: [[jugged]], end: 'bank', legs: [10, 50, 40], here: [false] },
            }).trip,
        ).toMatchObject({ successes: 26, total: 360 });
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

describe('process sink, chained steps', () => {
    // A vein that never runs out: an ore every 4 ticks with the worn pick, 35 XP.
    const vein: ActionModel = {
        ticksPerAttempt: 4,
        success: 1,
        xpTenths: { mining: 350 },
        products: [{ obj: 'ore', count: 1 }],
        consumes: [],
        tools: ['pick'],
    };
    // Smelting a bar from an ore: 5 ticks, 12.5 XP.
    const smelt: ActionModel = {
        ticksPerAttempt: 5,
        success: 1,
        xpTenths: { smithing: 125 },
        products: [{ obj: 'bar', count: 1 }],
        consumes: [{ obj: 'ore', count: 1 }],
    };
    // Smithing a plate from 5 bars with the carried hammer: 5 ticks, 125 XP.
    const smith: ActionModel = {
        ticksPerAttempt: 5,
        success: 1,
        xpTenths: { smithing: 1250 },
        products: [{ obj: 'plate', count: 1 }],
        consumes: [{ obj: 'bar', count: 5 }],
        batch: 5,
        tools: ['hammer'],
    };

    test('two steps, each taking the one before it, then the bank: the load rounds down to whole plates', () => {
        // The hammer takes a slot: 27 ore, rounded down to 25 (5 plates of 5 bars). 25 x 4 = 100 ticks mining; 25 x 5 =
        // 125 smelting; 5 plates x 5 = 25 smithing; legs 20 + 10 + 30 + 40 = 100: 350 a trip. 9000 / 350 x 25 = 642.86
        // ore an hour: Mining 35 x 25 each = 562,500; Smithing (12.5 + 125 / 5) x 25 = 937.5 each = 602,678.6. 128.57
        // plates banked at 500: 64,285.7 gp.
        const r = run({
            gather: vein,
            sink: {
                mode: 'process',
                steps: [[smelt], [smith]],
                end: 'bank',
                legs: [20, 10, 30, 40],
                here: [false, false],
            },
        });
        const ore = (9000 / 350) * 25;
        expect(r.trip).toEqual({
            successes: 25,
            gather: 100,
            process: 150,
            travel: 100,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 350,
        });
        expect(r.binding).toBe('player');
        expect(r.xpPerHour.mining).toBeCloseTo(562_500, 6);
        expect(r.xpPerHour.smithing).toBeCloseTo(ore * 937.5, 6);
        expect(r.itemsPerHour).toEqual([{ obj: 'plate', count: expect.closeTo(ore / 5, 9) }]);
        expect(r.gpPerHour).toBeCloseTo((ore / 5) * 500, 6);
    });

    test('dropped at the last step: the plates go in whole ticks with the click away, and keep no value', () => {
        // As above with no bank leg (20 + 10 + 30 = 60) and 5 plates dropped: ceil((5 + 2) / 5) = 2 ticks. 100 + 150 +
        // 60 + 2 = 312 a trip.
        const r = run({
            gather: vein,
            sink: { mode: 'process', steps: [[smelt], [smith]], end: 'drop', legs: [20, 10, 30], here: [false, false] },
        });
        expect(r.trip).toMatchObject({ successes: 25, process: 150, travel: 60, bank: 0, drop: 2, total: 312 });
        expect(r.xpPerHour.smithing).toBeCloseTo((9000 / 312) * 25 * 937.5, 6);
        expect(r.gpPerHour).toBe(0);
    });

    test('kept: a stackable end product takes a slot and is never banked', () => {
        // Essence every 3 ticks (5 XP) made into 3 runes at the altar, 1 tick and 6.5 XP an essence. The rune stack
        // takes a slot: 27 essence; 81 + 27 + legs 30 + 30 = 168 a trip. 9000 / 168 x 27 = 1,446.43 essence an hour:
        // Mining 5 x 25 = 125 each, 180,803.6; Runecraft 6.5 x 25 = 162.5 each, 235,044.6; 4,339.3 runes at 5 gp.
        const ess: ActionModel = {
            ...vein,
            ticksPerAttempt: 3,
            xpTenths: { mining: 50 },
            products: [{ obj: 'essence', count: 1 }],
        };
        const craft: ActionModel = {
            ticksPerAttempt: 1,
            success: 1,
            xpTenths: { runecraft: 65 },
            products: [{ obj: 'rune', count: 3 }],
            consumes: [{ obj: 'essence', count: 1 }],
        };
        const r = run({
            gather: ess,
            sink: { mode: 'process', steps: [[craft]], end: 'keep', legs: [30, 30], here: [false] },
        });
        const n = (9000 / 168) * 27;
        expect(r.trip).toMatchObject({
            successes: 27,
            gather: 81,
            process: 27,
            travel: 60,
            bank: 0,
            drop: 0,
            total: 168,
        });
        expect(r.xpPerHour.mining).toBeCloseTo(n * 125, 6);
        expect(r.xpPerHour.runecraft).toBeCloseTo(n * 162.5, 6);
        expect(r.itemsPerHour).toEqual([{ obj: 'rune', count: expect.closeTo(n * 3, 9) }]);
        expect(r.gpPerHour).toBeCloseTo(n * 3 * 5, 6);
        // A kept product that fills a slot would fill the inventory for good. A step the gather gives no input for at
        // a profile leaves its input kept, so the profile is refused (ProfileError), not the record.
        const bars: ActionModel = { ...craft, products: [{ obj: 'bar', count: 1 }] };
        fails(
            { gather: ess, sink: { mode: 'process', steps: [[bars]], end: 'keep', legs: [30, 30], here: [false] } },
            /kept products fill the inventory: bar/,
        );
        expect(() =>
            run({
                gather: ess,
                sink: { mode: 'process', steps: [[bars]], end: 'keep', legs: [30, 30], here: [false] },
            }),
        ).toThrow(ProfileError);
    });

    test('withdrawn from the bank: no gathering, the load is the free slots over the ore, a stackable supply one slot', () => {
        // Superheat (3 ticks, 53 Magic and 12.5 Smithing XP, a nature a cast) then smith at an anvil and back. The hammer
        // and the nature stack take 2 slots: 26 ore, 25 in whole plates. 25 x 3 + 5 x 5 = 100 ticks; legs 15 + 15: 130.
        // 9000 / 130 x 25 = 1,730.77 ore an hour: Magic 53 x 25 = 1,325 each, 2,293,269.2; Smithing 937.5 each,
        // 1,622,596.2. The ore (10 gp) and natures (4 gp) used: 24,230.8 gp; 346.15 plates banked, 173,076.9 gp.
        const superheat: ActionModel = {
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { magic: 530, smithing: 125 },
            products: [{ obj: 'bar', count: 1 }],
            consumes: [
                { obj: 'ore', count: 1 },
                { obj: 'nature', count: 1 },
            ],
        };
        const r = run({
            gather: { withdraw: 'ore' },
            sink: { mode: 'process', steps: [[superheat], [smith]], end: 'bank', legs: [15, 15], here: [false, false] },
        });
        const ore = (9000 / 130) * 25;
        expect(r.trip).toEqual({
            successes: 25,
            gather: 0,
            process: 100,
            travel: 30,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 130,
        });
        expect(r.xpPerHour.magic).toBeCloseTo(ore * 1325, 6);
        expect(r.xpPerHour.smithing).toBeCloseTo(ore * 937.5, 6);
        expect(r.suppliesPerHour).toEqual([
            { obj: 'ore', count: expect.closeTo(ore, 9) },
            { obj: 'nature', count: expect.closeTo(ore, 9) },
        ]);
        expect(r.suppliesGpPerHour).toBeCloseTo(ore * 14, 6);
        expect(r.gpPerHour).toBeCloseTo((ore / 5) * 500, 6);
    });

    describe('a non-stackable supply', () => {
        // Logs every 8 ticks (4 at 1/2) with a worn axe (the pick), cut into a bow with the carried knife (3 ticks,
        // 5 XP), strung with a bow string (2 ticks, 41.5 XP). The knife leaves 27 free slots.
        const chop: ActionModel = {
            ...spot,
            ticksPerAttempt: 4,
            xpTenths: { woodcutting: 675 },
            products: [{ obj: 'log', count: 1 }],
            consumes: [],
            tools: ['pick'],
        };
        const cut: ActionModel = {
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { fletching: 50 },
            products: [{ obj: 'unstrung', count: 1 }],
            consumes: [{ obj: 'log', count: 1 }],
            tools: ['knife'],
        };
        const string: ActionModel = {
            ticksPerAttempt: 2,
            success: 1,
            xpTenths: { fletching: 415 },
            products: [{ obj: 'bow', count: 1 }],
            consumes: [
                { obj: 'unstrung', count: 1 },
                { obj: 'string', count: 1 },
            ],
        };

        test("used 'here' as each log comes: the bow takes the log's slot, the string's comes free", () => {
            // Chop, cut and string one log at a time: strings and bows together hold the slots the trip started with
            // in strings, and the log being chopped one more: 27 - 1 = 26 strings, so 26 bows a trip. 26 x 8 = 208
            // chopping, 26 x (3 + 2) = 130 fletching, legs 20 + 20: 378. 9000 / 378 x 26 = 619.05 logs an hour:
            // Fletching 46.5 x 25 = 1,162.5 each, 719,642.9; as many strings used.
            const r = run({
                gather: chop,
                sink: { mode: 'process', steps: [[cut], [string]], end: 'bank', legs: [20, 20], here: [true, true] },
            });
            const logs = (9000 / 378) * 26;
            expect(r.trip).toMatchObject({ successes: 26, gather: 208, process: 130, travel: 40, total: 378 });
            expect(r.xpPerHour.fletching).toBeCloseTo(logs * 1162.5, 6);
            expect(r.itemsPerHour).toEqual([{ obj: 'bow', count: expect.closeTo(logs, 9) }]);
            expect(r.suppliesPerHour).toEqual([{ obj: 'string', count: expect.closeTo(logs, 9) }]);
        });

        test('used away from the stand: carried all trip, a slot per unit beside the logs', () => {
            // Cut 'here', strung at another site: the strings are carried while the unstrung bows pile up, a log's and
            // a string's slot a success: 27 / 2 = 13.5 a trip. 13.5 x 8 = 108 chopping, 13.5 x (3 + 2) = 67.5
            // fletching, legs 40: 215.5. 9000 / 215.5 x 13.5 = 563.81 logs an hour: Fletching 1,162.5 each, 655,423.4.
            const r = run({
                gather: chop,
                sink: { mode: 'process', steps: [[cut], [string]], end: 'bank', legs: [20, 20], here: [true, false] },
            });
            const logs = (9000 / 215.5) * 13.5;
            expect(r.trip).toMatchObject({ successes: 13.5, gather: 108, process: 67.5, travel: 40, total: 215.5 });
            expect(r.xpPerHour.fletching).toBeCloseTo(logs * 1162.5, 6);
            expect(r.suppliesPerHour).toEqual([{ obj: 'string', count: expect.closeTo(logs, 9) }]);
            // No step 'here' at all: the same.
            expect(
                run({
                    gather: chop,
                    sink: {
                        mode: 'process',
                        steps: [[cut], [string]],
                        end: 'bank',
                        legs: [20, 20],
                        here: [false, false],
                    },
                }).trip.successes,
            ).toBe(13.5);
        });
    });

    test('fails with a reason where it is not modelled', () => {
        const legs = [10, 10];
        fails({ gather: { withdraw: 'ore' }, sink: { mode: 'bank', legs } }, /withdrawing ore needs a process sink/);
        fails(
            { gather: vein, sink: { mode: 'process', steps: [[smelt], [smelt]], end: 'bank', legs, here: [false] } },
            /1 'here' flags for 2 steps/,
        );
        fails(
            {
                gather: { withdraw: 'nature' },
                sink: { mode: 'process', steps: [[smelt]], end: 'bank', legs, here: [false] },
            },
            /withdrawing the stackable nature is not modelled/,
        );
        const none: ActionModel = { ...smelt, consumes: [] };
        fails(
            { gather: vein, sink: { mode: 'process', steps: [[none]], end: 'bank', legs, here: [false] } },
            /must take one chained input/,
        );
        const odd: ActionModel = { ...smith, consumes: [{ obj: 'bar', count: 1 }] };
        fails(
            {
                gather: vein,
                sink: { mode: 'process', steps: [[smelt], [odd]], end: 'bank', legs, here: [false, false] },
            },
            /takes 1 bar an action, but its batch is 5/,
        );
        // Rounding the load to whole batches of a second batched step could leave the first at a part batch.
        const pairs: ActionModel = { ...smelt, consumes: [{ obj: 'ore', count: 2 }], batch: 2 };
        fails(
            {
                gather: vein,
                sink: { mode: 'process', steps: [[pairs], [smith]], end: 'bank', legs, here: [false, false] },
            },
            /more than one batched step is not modelled/,
        );
        // 27 ore (the hammer takes a slot) is no whole batch of 30 bars: refused at the profile, whose tools set it.
        const huge: ActionModel = { ...smith, consumes: [{ obj: 'bar', count: 30 }], batch: 30 };
        const input: Omit<CycleInput, 'items'> = {
            gather: vein,
            sink: { mode: 'process', steps: [[smelt], [huge]], end: 'bank', legs, here: [false, false] },
        };
        expect(() => run(input)).toThrow(ProfileError);
        expect(() => run(input)).toThrow(/the load holds no whole batch/);
    });
});

describe('food with damage', () => {
    test('a success that costs hitpoints: food covers the damage, eaten in no ticks', () => {
        // A lap every 60 ticks, 571 XP, 1.5 hitpoints of falls a lap. A food healing 6 covers 4 laps; 28 slots of it
        // cover 112. 112 x 60 = 6,720 + legs 50 = 6,770 a trip, no eat ticks. 9000 / 6770 x 112 = 148.89 laps an hour:
        // 571 x 25 = 14,275 XP each, 2,125,435.7; 37.22 food.
        const lap: ActionModel = {
            ticksPerAttempt: 60,
            success: 1,
            xpTenths: { agility: 5710 },
            products: [],
            consumes: [],
            damage: 1.5,
        };
        const r = run({ gather: lap, sink: { mode: 'bank', legs: [25, 25] }, food: { obj: 'food', heal: 6 } });
        const laps = (9000 / 6770) * 112;
        expect(r.trip).toEqual({
            successes: 112,
            gather: 6720,
            process: 0,
            travel: 50,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 6770,
        });
        expect(r.xpPerHour.agility).toBeCloseTo(laps * 14_275, 6);
        expect(r.suppliesPerHour).toEqual([{ obj: 'food', count: expect.closeTo(laps / 4, 9) }]);
        fails({ gather: lap, sink: { mode: 'bank', legs: [25, 25] } }, /costs 1.5 hitpoints a success: name a food/);
        fails(
            {
                gather: lap,
                sink: { mode: 'process', steps: [], end: 'keep', legs: [], here: [] },
                food: { obj: 'food', heal: 6 },
            },
            /nothing restocks it/,
        );
    });

    test('damage beside failDamage: both eaten, only the stuns cost eat ticks', () => {
        // p 1/2, 2 hitpoints a fail, 1 a success, a heal of 2: (2 x 1 + 1) / 2 = 1.5 food a success, 27 / 1.5 = 18 a
        // trip (coins take a slot). Eat ticks are the fails' alone: eatTicksPerFail(2 / 2, 1/2) = 0.25 + 3 x 0.5 =
        // 1.75 a fail, a fail a success: 18 x 1.75 = 31.5.
        const pocket: ActionModel = {
            ticksPerAttempt: 2,
            success: 0.5,
            xpTenths: { thieving: 400 },
            products: [{ obj: 'coins', count: 30 }],
            consumes: [],
            failTicks: 9,
            failDamage: 2,
            damage: 1,
        };
        const r = run({ gather: pocket, sink: { mode: 'bank', legs: [20, 20] }, food: { obj: 'food', heal: 2 } });
        expect(r.trip.successes).toBe(18);
        expect(r.trip.eat).toBeCloseTo(31.5, 9);
    });
});

describe('restarts', () => {
    // Withdrawn from the bank, worked at a furnace or anvil, banked: legs 10 + 10.
    const legs = [10, 10];
    const withdraw = (obj: string, ...steps: ActionModel[]) =>
        run({
            gather: { withdraw: obj },
            sink: { mode: 'process', steps: steps.map(s => [s]), end: 'bank', legs, here: steps.map(() => false) },
        });
    // An anvil's buttons make at most 10 a click, each further 10 2 ticks more; a furnace's Make X costs 1 tick a trip.
    const anvil = { upTo: 10, ticks: 2, repeat: true };
    const furnace = { upTo: 10, ticks: 1 };
    const smith1: ActionModel = {
        ticksPerAttempt: 5,
        success: 1,
        xpTenths: { smithing: 250 },
        products: [{ obj: 'plate', count: 1 }],
        consumes: [{ obj: 'bar', count: 1 }],
        tools: ['hammer'],
        restart: anvil,
    };
    const smith5: ActionModel = {
        ...smith1,
        xpTenths: { smithing: 1250 },
        consumes: [{ obj: 'bar', count: 5 }],
        batch: 5,
    };
    const smelt: ActionModel = {
        ticksPerAttempt: 5,
        success: 1,
        xpTenths: { smithing: 125 },
        products: [{ obj: 'bar', count: 1 }],
        consumes: [{ obj: 'ore', count: 1 }],
        restart: furnace,
    };

    test('a 1-bar product: 27 bars a trip take three clicks of Make 10, two restarts of 2 ticks', () => {
        // The hammer takes a slot: 27 bars. ceil(27 / 10) - 1 = 2 restarts: 27 x 5 + 4 = 139, legs 20: 159.
        expect(withdraw('bar', smith1).trip).toMatchObject({ successes: 27, process: 139, travel: 20, total: 159 });
    });

    test('a 5-bar product: 25 bars make 5, one click, no restart', () => {
        // 27 bars round down to 25, 5 platebodies: ceil(5 / 10) - 1 = 0. 5 x 5 = 25, legs 20: 45.
        expect(withdraw('bar', smith5).trip).toMatchObject({ successes: 25, process: 25, total: 45 });
    });

    test("a furnace load over 10 pays Make X's count dialog once; 10 or fewer pay nothing", () => {
        // 28 ore, no tool: 28 x 5 + 1 = 141, legs 20: 161.
        expect(withdraw('ore', smelt).trip).toMatchObject({ successes: 28, process: 141, total: 161 });
        // Two coal a bar beside the ore: 28 / 3 = 9.33 bars, under 10: 9.33 x 5 = 46.67.
        const steel: ActionModel = { ...smelt, consumes: [...smelt.consumes, { obj: 'coal', count: 2 }] };
        const r = withdraw('ore', steel);
        expect(r.trip.successes).toBeCloseTo(28 / 3, 9);
        expect(r.trip.process).toBeCloseTo((28 / 3) * 5, 9);
    });

    test('a part batch: iron at half a bar an ore, smithed into 5-bar plates with no rounding', () => {
        // 27 ore (the hammer): 27 x 5 + 1 (Make X) = 136 smelting; 13.5 bars make 2.7 plates, 2.7 x 5 = 13.5, under
        // 10 plates so no restart: 149.5, legs 10 + 5 + 15 = 30: 179.5. Smithing a ore: 12.5 / 2 + 125 x 0.1 = 18.75.
        const half: ActionModel = { ...smelt, xpTenths: { smithing: 62.5 }, products: [{ obj: 'bar', count: 0.5 }] };
        const r = run({
            gather: { withdraw: 'ore' },
            sink: {
                mode: 'process',
                steps: [[half], [smith5]],
                end: 'bank',
                legs: [10, 5, 15],
                here: [false, false],
            },
        });
        expect(r.trip).toMatchObject({ successes: 27, process: 149.5, travel: 30, total: 179.5 });
        const ore = (TICKS_PER_HOUR / 179.5) * 27;
        expect(r.xpPerHour.smithing).toBeCloseTo(ore * 18.75 * XP_RATE, 6);
        expect(r.itemsPerHour).toEqual([{ obj: 'plate', count: expect.closeTo(ore * 0.1, 9) }]);
    });

    test("a worn supply takes no slot: the ring's wear is counted, 28 ore still fill the trip", () => {
        // 28 ore, a ring per 140: 28 x 5 = 140, legs 20: 160. Rings an hour: ore / 140.
        const ring: ActionModel = {
            ...smelt,
            consumes: [...smelt.consumes, { obj: 'ring', count: 1 / 140 }],
            restart: undefined,
        };
        const r = withdraw('ore', ring);
        const ore = (TICKS_PER_HOUR / 160) * 28;
        expect(r.trip).toMatchObject({ successes: 28, total: 160 });
        expect(r.suppliesPerHour).toEqual([
            { obj: 'ore', count: expect.closeTo(ore, 9) },
            { obj: 'ring', count: expect.closeTo(ore / 140, 9) },
        ]);
    });

    test('a start is paid once a trip, beside the restarts', () => {
        // 28 ore, start 1 and Make X 1: 28 x 5 + 1 + 1 = 142, legs 20: 162.
        expect(withdraw('ore', { ...smelt, start: 1 }).trip).toMatchObject({ process: 142, total: 162 });
        fails(
            {
                gather: { withdraw: 'ore' },
                sink: { mode: 'process', steps: [[{ ...smelt, start: -1 }]], end: 'bank', legs, here: [false] },
            },
            /start -1 is not >= 0/,
        );
    });

    test('fails where it is not modelled', () => {
        fails(
            { gather: { ...smelt, consumes: [] }, sink: { mode: 'bank', legs } },
            /a gather with a restart or a start/,
        );
        fails(
            { gather: { ...smelt, consumes: [], restart: undefined, start: 1 }, sink: { mode: 'bank', legs } },
            /a gather with a restart or a start/,
        );
        // Stackable feathers made into stackable runes: the trip never ends.
        const vein: ActionModel = {
            ticksPerAttempt: 4,
            success: 1,
            xpTenths: {},
            products: [{ obj: 'feather', count: 1 }],
            consumes: [],
        };
        const craft: ActionModel = {
            ...smelt,
            consumes: [{ obj: 'feather', count: 1 }],
            products: [{ obj: 'rune', count: 1 }],
        };
        fails(
            { gather: vein, sink: { mode: 'process', steps: [[craft]], end: 'keep', legs, here: [false] } },
            /restarts on a trip that never ends/,
        );
        fails(
            {
                gather: vein,
                sink: {
                    mode: 'process',
                    steps: [[{ ...craft, restart: undefined, start: 1 }]],
                    end: 'keep',
                    legs,
                    here: [false],
                },
            },
            /a start on a trip that never ends/,
        );
    });
});
