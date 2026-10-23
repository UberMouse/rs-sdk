import { describe, expect, test } from 'bun:test';
import {
    BURY_DELAY,
    BURY_SWING_GAP,
    checkNormalFood,
    cycle,
    EAT_DELAY,
    EAT_DELAYS,
    normalEatDelay,
    readBuryDelay,
    readEatDelays,
    type CycleInput,
    type CycleSink,
    type Loot,
} from '../model/cycle';
import { ModelError, type ActionModel } from '../model/family';
import { readItems } from '../model/items';
import { XP_RATE } from '../model/server';
import { parseConfigs } from '../sources/configs';

// Synthetic objs: stackable coins (cost 1, the engine's default), non-stackable bones and a hide, a normal food (its
// category's trigger, consume.rs2:3, passes skill delay 3) and a gnome batta (consume.rs2:31 passes null).
const items = readItems(
    parseConfigs(`
[coins]
stackable=yes
[bones]
cost=10
[hide]
cost=100
[food]
cost=50
category=meat
[batta]
category=gnome_batta
`),
);
/** bone_exp in tenths: the game's bones (bones.obj:12). */
const boneXp = (obj: string) => (obj === 'bones' ? 45 : 0);

/** A kill every 20 ticks at attackrate 4: 100 Strength XP, a bones, 15 coins, and a hide 3 kills in 4. */
const kill: ActionModel = {
    ticksPerAttempt: 20,
    success: 1,
    xpTenths: { strength: 1000 },
    products: [
        { obj: 'bones', count: 1 },
        { obj: 'coins', count: 15 },
        { obj: 'hide', count: 0.75 },
    ],
    consumes: [],
    attackRate: 4,
};

const bank: CycleSink = { mode: 'bank', legs: [10, 10] };
const run = (input: Omit<CycleInput, 'items' | 'boneXp'>) => cycle({ ...input, items, boneXp });
const looted = (loot: Loot, gather: ActionModel = kill) => run({ gather, sink: bank, loot });

function fails(input: Omit<CycleInput, 'items'>, re: RegExp): void {
    expect(() => cycle({ ...input, items })).toThrow(ModelError);
    expect(() => cycle({ ...input, items })).toThrow(re);
}

describe('bury constants', () => {
    test('a bury holds p_delay(0), so the swing after it comes 3 ticks after the one before', () => {
        // bury_bone.rs2:10 `p_delay(0)`. Swing at P; the bury at P + 1 (its p_stopaction would end the swing at P);
        // delayedUntil = P + 1 + 1 + 0 = P + 2, still delayed in P + 2's packets; the re-click at P + 3.
        expect(BURY_DELAY).toEqual({ value: 0, at: 'skill_prayer/scripts/bury_bone.rs2:10' });
        expect(BURY_SWING_GAP).toBe(3);
        expect(readBuryDelay('p_stopaction;\n    p_delay(2);\n').value).toBe(2);
        expect(() => readBuryDelay('p_stopaction;')).toThrow(/has the default moved/);
    });
});

/** A line of consume.rs2, as an EatDelay's `at`. */
const at = (line: number) => `player/scripts/consumption/consume.rs2:${line}`;

describe('eat delay', () => {
    test("normal food's skill delay, read from every food trigger of consume.rs2", () => {
        // consume.rs2:3 `[opheld1,_meat] @player_consume_item(consume_effect_stat, 2, 3)`, the first of the triggers
        // passing 3; every other trigger passes 3 or null.
        expect(normalEatDelay(EAT_DELAYS)).toEqual({ value: 3, at: at(3) });
        expect(EAT_DELAY).toBe(3);
        // :31 passes null; :70-75 passes 3 beside a $eat_delay variable; :54-57's switch passes 3 in both cases.
        expect(EAT_DELAYS.get('_gnome_batta')).toEqual({ value: null, at: at(31) });
        expect(EAT_DELAYS.get('_category_129')).toEqual({ value: 3, at: at(70) });
        expect(EAT_DELAYS.get('_gnome_cocktail')?.value).toBe(3);
    });

    test('a trigger with differing delays has none; triggers that differ have no normal one', () => {
        const delays = readEatDelays(`[opheld1,a] @player_consume_item(x, 2, 3);
[opheld1,b]
switch_int (1) {
    case 1 : @player_consume_item(x, 2, 3);
    case default : @player_consume_item(x, null, null);
}
[opheld1,c] ~displaymessage(^dm_default);
[opheld3,d] @player_consume_item(x, 2, 5);
[opheld1,e] @player_consume_item(x, 2, 4);
`);
        expect([...delays]).toEqual([
            ['a', { value: 3, at: at(1) }],
            ['b', { value: null, at: at(2) }],
            ['e', { value: 4, at: at(9) }],
        ]);
        expect(() => normalEatDelay(delays)).toThrow(/found 2/);
    });

    test("a food's trigger: its own obj's, else its category's", () => {
        const delays = new Map([
            ['batta', { value: 3, at: at(1) }],
            ['_meat', { value: 3, at: at(2) }],
        ]);
        expect(() => checkNormalFood('batta', items, delays)).not.toThrow();
        expect(() => checkNormalFood('food', items, delays)).not.toThrow();
        expect(() => checkNormalFood('hide', items, delays)).toThrow(/no .* trigger eats hide/);
        expect(() => checkNormalFood('batta', items)).toThrow(/passes skill delay null/);
    });
});

describe('loot policy', () => {
    test('leave: only the coins are kept, nothing fills a slot, no trip ends', () => {
        // Bones and the unlisted hide are left. A kill of 20 ticks, no bank visit: 9000 / 20 = 450 kills an hour,
        // 100 x 25 = 2,500 XP each: 1,125,000 Strength XP; 15 x 450 = 6,750 coins at 1 gp.
        const r = looted({ bones: 'leave' });
        expect(r.trip).toEqual({
            successes: 1,
            gather: 20,
            process: 0,
            bury: 0,
            travel: 0,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 20,
        });
        expect(r.xpPerHour).toEqual({ strength: 450 * 100 * XP_RATE });
        expect(r.itemsPerHour).toEqual([{ obj: 'coins', count: 6750 }]);
        expect(r.gpPerHour).toBe(6750);
    });

    test('bury: Prayer XP and no slot, the bury free between swings 4 ticks apart', () => {
        // BURY_SWING_GAP 3 <= attackrate 4: max(0, 3 - 4) = 0 ticks. 450 kills an hour as left; 4.5 x 25 = 112.5
        // Prayer XP each: 50,625. The buried bones are not a product.
        const r = looted({ bones: 'bury' });
        expect(r.trip.total).toBe(20);
        expect(r.trip.process).toBe(0);
        expect(r.xpPerHour).toEqual({ strength: 450 * 100 * XP_RATE, prayer: 450 * 4.5 * XP_RATE });
        expect(r.itemsPerHour).toEqual([{ obj: 'coins', count: 6750 }]);
    });

    test('bury at an attack rate of 2: the re-click holds the next swing 1 tick', () => {
        // max(0, 3 - 2) = 1 tick a bury, its own share of the trip: 21 a kill, 9000 / 21 = 428.57 kills an hour.
        const r = looted({ bones: 'bury' }, { ...kill, attackRate: 2 });
        expect(r.trip).toMatchObject({ process: 0, bury: 1, total: 21 });
        expect(r.binding).toBe('player');
        expect(r.xpPerHour.prayer).toBeCloseTo((9000 / 21) * 4.5 * XP_RATE, 6);
    });

    test('bank: the bones fill a slot a kill, so a trip ends at a full inventory', () => {
        // The coins take a slot: 27 free, a bones a kill (the hide left): 27 kills. 27 x 20 = 540 + legs 20 = 560 a
        // trip. 9000 / 560 x 27 = 433.93 kills an hour: that many bones at 10 gp and 15 x as many coins at 1.
        const r = looted({ bones: 'bank' });
        expect(r.trip).toEqual({
            successes: 27,
            gather: 540,
            process: 0,
            bury: 0,
            travel: 20,
            bank: 0,
            drop: 0,
            eat: 0,
            wait: 0,
            total: 560,
        });
        const kills = (9000 / 560) * 27;
        expect(r.itemsPerHour.map(x => x.obj)).toEqual(['bones', 'coins']);
        expect(r.gpPerHour).toBeCloseTo(kills * (10 + 15), 6);
        expect(r.xpPerHour.prayer).toBeUndefined();
    });

    test('keep lists a non-stackable: the hide is kept, 3/4 of a slot a kill', () => {
        // 27 free / 0.75 = 36 kills: 720 + 20 = 740 a trip; 9000 / 740 x 36 = 437.84 kills; gp 15 + 0.75 x 100 each.
        const r = looted({ bones: 'leave', keep: ['hide'] });
        expect(r.trip.successes).toBe(36);
        expect(r.trip.total).toBe(740);
        expect(r.gpPerHour).toBeCloseTo((9000 / 740) * 36 * (15 + 75), 6);
    });

    test('no policy: every product is kept, as before', () => {
        // Bones 1 + hide 0.75 = 1.75 slots a kill: 27 / 1.75 = 15.43 kills a trip.
        const r = run({ gather: kill, sink: bank });
        expect(r.trip.successes).toBeCloseTo(27 / 1.75, 9);
        expect(r.xpPerHour.prayer).toBeUndefined();
    });

    test('fails where it is not modelled', () => {
        fails(
            {
                gather: kill,
                sink: { mode: 'process', steps: [], end: 'keep', legs: [], here: [] },
                loot: { bones: 'bury' },
                boneXp,
            },
            /loot policy with a process sink/,
        );
        fails({ gather: kill, sink: bank, loot: { bones: 'bury' } }, /needs the bones Prayer XP/);
        const { attackRate: _, ...noRate } = kill;
        fails(
            { gather: noRate, sink: bank, loot: { bones: 'bury' }, boneXp },
            /needs the gather to have an attackRate/,
        );
        // Leaving or banking the bones needs no attackRate.
        expect(looted({ bones: 'leave' }, noRate).trip.total).toBe(20);
        // A kill of 8 ticks at attackrate 4 is 2 swings: 2 bones fit a gap each, 3 do not.
        const quick = { ...kill, ticksPerAttempt: 8 };
        const bones = (count: number) => ({ ...quick, products: [{ obj: 'bones', count }] });
        expect(looted({ bones: 'bury' }, bones(2)).trip.bury).toBe(0);
        fails(
            { gather: bones(3), sink: bank, loot: { bones: 'bury' }, boneXp },
            /3 bones a kill but 2 swings: at most one bury a swing/,
        );
    });

    test("a kill's free and pickup ticks are not swings: the bury guard counts only the swings", () => {
        // 12 ticks with 4 free is 2 swings at attackrate 4; the 4-tick pickup adds none. 2 bones fit, 3 do not.
        const slow = { ...kill, ticksPerAttempt: 12, freeTicks: 4, pickupTicks: 4, pAnyOf: () => 1 };
        const bones = (count: number) => ({ ...slow, products: [{ obj: 'bones', count }] });
        expect(looted({ bones: 'bury' }, bones(2)).trip.bury).toBe(0);
        fails(
            { gather: bones(3), sink: bank, loot: { bones: 'bury' }, boneXp },
            /3 bones a kill but 2 swings: at most one bury a swing/,
        );
    });
});

describe('food with kept loot', () => {
    test('loot fills faster than food empties: the trip ends at a full inventory, the food just gone', () => {
        // Damage 6 a kill, a food heals 12: 0.5 food a kill; the hide kept, 0.75 slots a kill. 27 free / max(0.5,
        // 0.75) = 36 kills; it starts with 36 x 0.5 = 18 food and ends with 27 hides. Each food holds the swings
        // EAT_DELAY = 3: 36 x 0.5 x 3 = 54 eat ticks. 720 + 20 + 54 = 794 a trip; 9000 / 794 x 18 food an hour.
        const r = run({
            gather: { ...kill, damage: 6 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'bury', keep: ['hide'] },
        });
        expect(r.trip).toEqual({
            successes: 36,
            gather: 720,
            process: 0,
            bury: 0,
            travel: 20,
            bank: 0,
            drop: 0,
            eat: 54,
            wait: 0,
            total: 794,
        });
        expect(r.suppliesPerHour).toEqual([{ obj: 'food', count: expect.closeTo((9000 / 794) * 18, 9) }]);
        expect(r.xpPerHour.prayer).toBeCloseTo((9000 / 794) * 36 * 4.5 * XP_RATE, 6);
    });

    test('food empties faster than loot fills: the trip ends when the food runs out', () => {
        // Damage 12, heal 12: a food a kill, more than the hide's 0.75 slot: 27 / 1 = 27 kills on 27 food, the
        // inventory 27 x 0.75 = 20.25 hides at the end. 27 x 3 = 81 eat ticks; 540 + 20 + 81 = 641 a trip.
        const r = run({
            gather: { ...kill, damage: 12 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'leave', keep: ['hide'] },
        });
        expect(r.trip.successes).toBe(27);
        expect(r.trip.eat).toBe(81);
        expect(r.trip.total).toBe(641);
        expect(EAT_DELAY).toBe(3);
    });

    test('two foods a kill hold the swings EAT_DELAY each', () => {
        // Damage 24, heal 12: 2 food a kill, more than the 0.75 hide slot: 27 / 2 = 13.5 kills on 27 food. Each eat
        // adds 3 to %action_delay: 13.5 x 2 x 3 = 81 eat ticks; 13.5 x 20 = 270 + 20 + 81 = 371 a trip.
        const r = run({
            gather: { ...kill, damage: 24 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'leave', keep: ['hide'] },
        });
        expect(r.trip).toMatchObject({ successes: 13.5, gather: 270, eat: 81, total: 371 });
    });

    test('a food whose trigger adds another skill delay is not modelled', () => {
        // consume.rs2:31 `[opheld1,_gnome_batta] @player_consume_item(consume_effect_stat, null, null)`.
        fails(
            {
                gather: { ...kill, damage: 6 },
                sink: bank,
                food: { obj: 'batta', heal: 12 },
                loot: { bones: 'leave', keep: ['hide'] },
                boneXp,
            },
            /batta's trigger \(player\/scripts\/consumption\/consume.rs2:31\) passes skill delay null/,
        );
    });

    test('without a loot policy, food with a non-stackable product is still refused', () => {
        fails(
            { gather: { ...kill, damage: 6 }, sink: bank, food: { obj: 'food', heal: 12 } },
            /fills the inventory is not modelled/,
        );
    });
});

describe('uncalibrated damage', () => {
    test('no food in the cycle: none eaten, no eat ticks, the trip ends at a full inventory', () => {
        // The bones banked fill a slot a kill: 27 kills, 540 + 20 = 560 a trip, as with no damage at all.
        const hurt = { ...kill, damage: 6 };
        const r = run({
            gather: hurt,
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'bank' },
            uncalibrated: true,
        });
        expect(r.trip.successes).toBe(27);
        expect(r.trip.eat).toBe(0);
        expect(r.trip.total).toBe(560);
        expect(r.suppliesPerHour).toEqual([]);
        // Nothing kept fills a slot: no trip ends.
        const never = run({ gather: hurt, sink: bank, loot: { bones: 'bury' }, uncalibrated: true });
        expect(never.trip.successes).toBe(1);
        expect(never.trip.travel).toBe(0);
        // A fail's damage is not under the gate: it still eats the named food. Fails 1 in 2 at 4 damage, heal 12:
        // 1/3 food a kill, the hide's 0.75 slot more: 27 / 0.75 = 36 kills on 12 food. The stun's eats cost
        // eatTicksPerFail(1/3, 1/2) = min(max(1/3 - 1/4, 0), 1/4) + 3 x max(1/3 - 1/2, 0) = 1/12 a fail, a fail a
        // kill: 36 / 12 = 3 eat ticks; the uncalibrated damage eats none.
        const stung = run({
            gather: { ...hurt, success: 0.5, ticksPerAttempt: 10, failDamage: 4 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'leave', keep: ['hide'] },
            uncalibrated: true,
        });
        expect(stung.trip.successes).toBe(36);
        expect(stung.trip.eat).toBeCloseTo(3, 9);
        expect(stung.suppliesPerHour).toEqual([
            { obj: 'food', count: expect.closeTo((9000 / stung.trip.total) * 12, 9) },
        ]);
        // Calibrated, the same damage needs its food.
        fails(
            { gather: hurt, sink: bank, loot: { bones: 'bank' }, boneXp },
            /costs 6 hitpoints a success: name a food/,
        );
    });
});

/** The kill's drops: bones and coins every kill, the hide 3 kills in 4. */
const pAnyOf = (objs: ReadonlySet<string>) =>
    objs.has('bones') || objs.has('coins') ? 1 : objs.has('hide') ? 0.75 : 0;

describe("a kill's free and pickup ticks", () => {
    /** Bones every kill and 16 coins 1 kill in 8 (2 a kill), picked up in 8 ticks. */
    const rare: ActionModel = {
        ...kill,
        products: [
            { obj: 'bones', count: 1 },
            { obj: 'coins', count: 2 },
        ],
        pickupTicks: 8,
        pAnyOf: objs => (objs.has('bones') ? 1 : objs.has('coins') ? 1 / 8 : 0),
    };

    test('a pickup is charged on the kills that drop a product taken: the coins under a leave policy, every kill', () => {
        // pickupTicks 5 on the 20-tick kill: 25 a kill, 9000 / 25 = 360 kills an hour.
        const r = looted({ bones: 'leave' }, { ...kill, pickupTicks: 5, pAnyOf });
        expect(r.trip).toMatchObject({ successes: 1, gather: 25, total: 25 });
        expect(r.itemsPerHour).toEqual([{ obj: 'coins', count: 360 * 15 }]);
    });

    test('a rare kept drop pays the pickup on its share of the kills', () => {
        // The coins drop 1 kill in 8: 8 / 8 = 1 tick a kill, 21; 9000 / 21 kills an hour, 2 coins each.
        const r = looted({ bones: 'leave' }, rare);
        expect(r.trip).toMatchObject({ successes: 1, gather: 21, total: 21 });
        expect(r.itemsPerHour).toEqual([{ obj: 'coins', count: (9000 / 21) * 2 }]);
    });

    test('buried bones drop every kill: the pickup every kill', () => {
        // The bones (death_drop) on every kill: P 1, 20 + 8 = 28, and the bury's swing gap past the attackrate.
        const r = looted({ bones: 'bury' }, rare);
        expect(r.trip.gather).toBe(28);
        expect(r.trip.total).toBe(28 + Math.max(0, BURY_SWING_GAP - 4));
    });

    test('nothing taken, no pickup', () => {
        // Only the bones (left) and the unlisted hide (left): no product is kept or buried, so the kill stays 20, and
        // needs no pAnyOf.
        const gather = { ...kill, products: kill.products.filter(x => x.obj !== 'coins'), pickupTicks: 5 };
        expect(looted({ bones: 'leave' }, gather).trip.total).toBe(20);
        // Buried bones are taken: the pickup is charged, which needs pAnyOf.
        expect(looted({ bones: 'bury' }, { ...gather, pAnyOf }).trip.total).toBe(25);
        fails({ gather, sink: bank, loot: { bones: 'bury' }, boneXp }, /pickupTicks needs pAnyOf/);
    });

    test("the eats spend the kill's free ticks and the pickup's before they hold a swing", () => {
        // Damage 24, heal 12: 2 food a kill, 6 eat ticks back to back. The coins' pickup of 8 on 1 kill in 8 is 1 a
        // kill, so freeTicks 2 + 1 = 3 free: max(0, 6 - 3) = 3 eat ticks a kill. 27 slots (the coins take one) / 2 =
        // 13.5 kills, each 20 + 1 = 21: 283.5 + 20 travel + 40.5 eat = 344.
        const r = run({
            gather: { ...rare, damage: 24, freeTicks: 2 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'leave' },
        });
        expect(r.trip).toMatchObject({ successes: 13.5, gather: 283.5, eat: 40.5, travel: 20, total: 344 });
        // Free ticks past the eats' leave none to charge: 5 + 1 = 6.
        const spare = run({
            gather: { ...rare, damage: 24, freeTicks: 5 },
            sink: bank,
            food: { obj: 'food', heal: 12 },
            loot: { bones: 'leave' },
        });
        expect(spare.trip.eat).toBe(0);
    });

    test("the pickup comes off the respawn: the target's cycle is unchanged", () => {
        // One spawn down 30 ticks after a 20-tick kill: a kill every 50. With a 5-tick pickup the kill is 25 and the
        // respawn 25: still 50, so the trip waits 25 a kill (1 / cap = 50, less the 25 active).
        const r = looted(
            { bones: 'leave' },
            { ...kill, pickupTicks: 5, pAnyOf, deplete: { chance: 1, respawnTicks: 30 }, features: 1 },
        );
        expect(r.trip).toMatchObject({ gather: 25, wait: 25, total: 50 });
        expect(r.binding).toBe('resource');
        // The rare coins' pickup, 1 a kill: the kill 21, the respawn 29, still 50.
        const few = looted({ bones: 'leave' }, { ...rare, deplete: { chance: 1, respawnTicks: 30 }, features: 1 });
        expect(few.trip).toMatchObject({ gather: 21, wait: 29, total: 50 });
    });
});

describe('noted drops', () => {
    test("a cert_ obj is stackable at its obj's cost (ObjType.ts:295-320)", () => {
        expect(items('cert_hide')).toEqual({ stackable: true, cost: 100, wearable: false });
        // The engine's default cost of 1 for an obj with no cost line.
        expect(items('cert_coins').cost).toBe(1);
        expect(() => items('cert_nothing')).toThrow(/no obj cert_nothing/);
        // Kept as a stackable under any policy, valued at the hide's 100: 450 kills x 0.5 x 100.
        const r = looted({ bones: 'leave' }, { ...kill, products: [{ obj: 'cert_hide', count: 0.5 }] });
        expect(r.gpPerHour).toBe(450 * 0.5 * 100);
    });
});
