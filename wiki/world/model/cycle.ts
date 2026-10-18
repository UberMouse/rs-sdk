// The cycle a method repeats, as the tick-perfect floor: gather a load at the site, sink it (drop it, bank it, or
// process it on the way to the bank), and come back, with no tick wasted and every leg run. The rate it gives is
// the best ideal play can do; a measured rate sits at or below it.
//
// The load. A trip lasts until the inventory is full or, for a method that eats, until the food is gone:
// - Slots: INVENTORY_SLOTS less the tools carried (a tool with a `wearpos` is wielded instead, as ideal play does;
//   its wield level is not checked), one slot per supply the gather uses (bait, feathers: a non-stackable supply is
//   not modelled), and one per stackable product (coins never fill the inventory).
// - Without food, the load is the free slots over the non-stackable products a success gives (fractional: gems).
//   No non-stackable product means the inventory never fills: the sink is never visited.
// - With food, every free slot holds food, and the load is the successes that food covers: free x heal over the
//   damage a success costs (failDamage x fails per success). Food with a non-stackable product (both filling the
//   inventory) is not modelled. The hitpoints pool and regeneration are left out, which only lowers the floor a
//   little (a trip lasts somewhat longer than its food).
// - A drop sink never travels: a full inventory of non-stackable items is dropped in dropTicks(free slots), unless every
//   success depletes the feature
//   (mining, a stall): the next item needs a fresh click on another feature anyway, and the drop goes out in that
//   tick ahead of the click, free. Food with a drop sink is not modelled (nothing restocks it).
import { ModelError, type ActionModel } from './family';
import { INVENTORY_SLOTS, type Items } from './items';
import { resourceCap, ticksPerItem } from './rate';
import { TICKS_PER_HOUR, USER_EVENTS_PER_TICK, XP_RATE, type Skill } from './server';

/**
 * Packets the re-click after a full drop carries: a MOVE_OPCLICK, then the op (OPLOC1) it pairs with. The client
 * routes before every op (server/webclient/src/bot/reach.ts:4-7) and MoveClickHandler expects the op packet to follow
 * (MoveClickHandler.ts:27-29); both decode to the USER_EVENT category (model/MoveClick.ts:5, model/OpLoc.ts:5), so
 * both count against the tick's USER_EVENTS_PER_TICK.
 */
export const RECLICK_PACKETS = 2;

/**
 * Ticks dropping `drops` items and re-clicking the feature takes: a drop is an OpHeld op5 (player/scripts/drop.rs2:1,
 * ~dropslot with no delay), which OpHeldHandler runs as it reads it, and the server reads at most
 * USER_EVENTS_PER_TICK user-event packets a tick (5), whole ticks only: the drops and the re-click's RECLICK_PACKETS
 * share the pool, so 28 drops take ceil(30 / 5) = 6 ticks.
 */
export function dropTicks(drops: number): number {
    return Math.ceil((drops + RECLICK_PACKETS) / USER_EVENTS_PER_TICK);
}

/**
 * Ticks a bank visit adds to the legs that reach and leave it: none. The booth's Bank op (oploc2,bankbooth,
 * interface_bank/scripts/bank_booth.rs2:7) or a banker's (apnpc3,_bank_teller, banker.rs2:14) opens the bank with no
 * delay (@openbank, bank.rs2:18-23) on the tick the walk arrives, as Player.processInteraction tries the op after the
 * move in the same cycle (engine/entity/Player.ts:1297). The next tick's packets, read before that tick's move, carry
 * a Deposit-All per kind of item (inv_button4,bank_side:inv, bank_deposit.rs2:4, run at once by InvButtonHandler) and
 * the move click home, which needs no close (MoveClickHandler's clearPendingAction closes the modal,
 * engine/entity/Player.ts:1020); that tick is the walk back's first. Up to
 * USER_EVENTS_PER_TICK - 1 kinds fit beside the move; a visit with more would spill a tick, not modelled.
 */
export const BANK_TICKS = 0;

/**
 * The ticks an eat adds to `%action_delay` (consume.rs2:129-131, `$skill_delay` 3 for every normal food, :3-6), which
 * the pickpocket op waits on (pickpocket.rs2:134-137).
 */
export const EAT_DELAY = 3;

/** How the products leave: dropped, or banked over the legs' run ticks, with a process step on the way. */
export type CycleSink =
    | { mode: 'drop' }
    /** Run ticks of site -> bank and bank -> site. */
    | { mode: 'bank'; legs: number[] }
    /** Each process step (one per input it takes from the gather), and the run ticks of site -> processor -> bank -> site. */
    | { mode: 'process-bank'; process: ActionModel[]; legs: number[] };

export interface CycleInput {
    gather: ActionModel;
    sink: CycleSink;
    items: Items;
    /** The food eaten to cover the gather's failDamage, and how much one heals. */
    food?: { obj: string; heal: number };
}

/** One trip's ticks by what they are spent on. */
export interface Trip {
    /** Successes (gather items taken) per trip: the load, or 1 when the inventory never sends the player away. */
    successes: number;
    gather: number;
    process: number;
    travel: number;
    bank: number;
    drop: number;
    eat: number;
    /** Ticks spent waiting for features to respawn, when the resource cap binds. */
    wait: number;
    total: number;
}

/**
 * Why the floor is what it is: the player's own actions (gather, process, eat) are the larger share of a trip
 * (`player`), the sink's (travel, bank, drops) are (`travel`), or the features can't respawn fast enough
 * (`resource`).
 */
export type Binding = 'player' | 'resource' | 'travel';

export interface CycleRates {
    trip: Trip;
    binding: Binding;
    /** Game XP per hour, XP_RATE included. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** The products the method ends with per hour: the gather's, with process inputs replaced by what they make. */
    itemsPerHour: { obj: string; count: number }[];
    /** The products kept, at item value (`cost`): all banked; with a drop sink only the stackable ones stay. */
    gpPerHour: number;
    /** Supplies used per hour (bait, feathers, food) and their value. */
    suppliesPerHour: { obj: string; count: number }[];
    suppliesGpPerHour: number;
}

/** Adds `count` of `obj` into `into`, keeping first-seen order. */
function add(into: Map<string, number>, obj: string, count: number): void {
    into.set(obj, (into.get(obj) ?? 0) + count);
}

/**
 * The ticks eating adds per failed pickpocket, eating `perFail` foods per fail with success chance `p`. A fail sets
 * %action_delay to the stun's end (thieving.rs2:49), and an eat adds EAT_DELAY to it, not to the clock: from the third
 * attempt after the stun (two successes on, 4 ticks past its end, chance p^2) an eat leaves it in the past and costs
 * nothing; at the second (chance p - p^2) it holds the next attempt 1 tick; at the first, or during the stun, 3. Ideal
 * play spends the cheapest windows first, counted at one eat each: the eats per fail past p are charged EAT_DELAY
 * each (a second eat late in a long window could be free, so this charges a little more than ideal play needs).
 */
export function eatTicksPerFail(perFail: number, p: number): number {
    const free = p * p;
    const oneTick = p - free;
    return Math.min(Math.max(perFail - free, 0), oneTick) + EAT_DELAY * Math.max(perFail - p, 0);
}

/** The floor's rates for one method: its gather and sink, at the profile its models were built for. */
export function cycle({ gather, sink, items, food }: CycleInput): CycleRates {
    const tpi = ticksPerItem(gather);
    const p = gather.success;
    const failsPerSuccess = (1 - p) / p;

    // Slots the trip can't fill: tools not worn, a slot per supply, a slot per stackable product.
    const toolSlots = new Set((gather.tools ?? []).filter(t => !items(t).wearable)).size;
    for (const c of gather.consumes)
        if (!items(c.obj).stackable) throw new ModelError(`the supply ${c.obj} is not stackable: not modelled`);
    const supplySlots = new Set(gather.consumes.map(c => c.obj)).size;
    const stackable = gather.products.filter(x => items(x.obj).stackable);
    const filling = gather.products.filter(x => !items(x.obj).stackable);
    const free = INVENTORY_SLOTS - toolSlots - supplySlots - new Set(stackable.map(x => x.obj)).size;
    if (free < 1) throw new ModelError(`no free inventory slot (${toolSlots} tools, ${supplySlots} supplies)`);
    const slotsPerSuccess = filling.reduce((n, x) => n + x.count, 0);

    // The process steps, each paired with the gather product it takes, as many per success as the gather gives. A
    // step whose input the gather does not give at this profile (salmon under Fishing 30) does nothing.
    const steps = (sink.mode === 'process-bank' ? sink.process : []).flatMap(m => {
        if (m.consumes.length !== 1) throw new ModelError('a process step must take one input');
        const input = m.consumes[0]!.obj;
        const per = gather.products.find(x => x.obj === input)?.count;
        return per === undefined ? [] : [{ m, input, per }];
    });

    // A drop sink with a feature every success depletes (mining, a stall) drops ahead of the next click, free.
    const dropsAsItGoes = sink.mode === 'drop' && gather.deplete?.chance === 1;
    let successes: number;
    let foodPerSuccess = 0;
    if (food) {
        if (!gather.failDamage) throw new ModelError(`food ${food.obj} is named but the action costs no hitpoints`);
        if (sink.mode === 'drop') throw new ModelError('food with a drop sink is not modelled: nothing restocks it');
        if (slotsPerSuccess > 0) throw new ModelError('food with a product that fills the inventory is not modelled');
        // At a success chance of 1 nothing fails: no food is eaten and the trip never ends.
        foodPerSuccess = (gather.failDamage * failsPerSuccess) / food.heal;
        successes = foodPerSuccess > 0 ? free / foodPerSuccess : Infinity;
    } else if (slotsPerSuccess === 0 || dropsAsItGoes) successes = Infinity;
    else successes = free / slotsPerSuccess;
    if (gather.failDamage && p < 1 && !food)
        throw new ModelError(`the action costs ${gather.failDamage} hitpoints a fail: name a food`);
    // A trip that never ends is counted one success at a time, with no travel.
    const trips = Number.isFinite(successes);
    const n = trips ? successes : 1;

    const gatherTicks = n * tpi;
    const process = steps.reduce((t, s) => t + n * s.per * ticksPerItem(s.m), 0);
    const travel = trips && sink.mode !== 'drop' ? sink.legs.reduce((a, b) => a + b, 0) : 0;
    const bank = trips && sink.mode !== 'drop' ? BANK_TICKS : 0;
    const drop = sink.mode === 'drop' && trips ? dropTicks(free) : 0;
    const eat = food ? n * failsPerSuccess * eatTicksPerFail((gather.failDamage ?? 0) / food.heal, p) : 0;
    const active = gatherTicks + process + travel + bank + drop + eat;
    // The features respawn all trip long, so the cap holds over the whole trip: n items take at least n / cap.
    if (gather.deplete && gather.features === undefined)
        throw new ModelError('the model depletes but names no features: the resource cap needs them');
    const cap = resourceCap(gather, gather.features ?? 1);
    const wait = Math.max(0, n / cap - active);
    const total = active + wait;
    const binding: Binding =
        wait > 0 ? 'resource' : travel + bank + drop > gatherTicks + process + eat ? 'travel' : 'player';

    const perHour = (TICKS_PER_HOUR / total) * n;
    const xp = new Map<Skill, number>();
    const tenths = (skill: Skill, t: number) => xp.set(skill, (xp.get(skill) ?? 0) + t);
    for (const [skill, t] of Object.entries(gather.xpTenths) as [Skill, number][]) tenths(skill, t);
    for (const s of steps)
        for (const [skill, t] of Object.entries(s.m.xpTenths) as [Skill, number][]) tenths(skill, t * s.per);
    const made = new Map<string, number>();
    for (const x of gather.products) if (!steps.some(s => s.input === x.obj)) add(made, x.obj, x.count);
    for (const s of steps) for (const x of s.m.products) add(made, x.obj, x.count * s.per);
    const supplies = new Map<string, number>();
    for (const c of gather.consumes) add(supplies, c.obj, c.count);
    if (food) add(supplies, food.obj, foodPerSuccess);

    const hourly = (m: Map<string, number>) => [...m].map(([obj, count]) => ({ obj, count: count * perHour }));
    const itemsPerHour = hourly(made);
    const suppliesPerHour = hourly(supplies);
    const value = (xs: { obj: string; count: number }[]) => xs.reduce((v, x) => v + x.count * items(x.obj).cost, 0);
    return {
        trip: { successes: n, gather: gatherTicks, process, travel, bank, drop, eat, wait, total },
        binding,
        xpPerHour: Object.fromEntries([...xp].map(([skill, t]) => [skill, (t / 10) * XP_RATE * perHour])),
        itemsPerHour,
        gpPerHour: value(sink.mode === 'drop' ? itemsPerHour.filter(x => items(x.obj).stackable) : itemsPerHour),
        suppliesPerHour,
        suppliesGpPerHour: value(suppliesPerHour),
    };
}
