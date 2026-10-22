// The cycle a method repeats, as the tick-perfect floor: gather a load at the site (or withdraw it from a bank), sink it
// (drop it, bank it, or run it through process steps and then bank, drop or keep what they make), and come back,
// with no tick wasted and every leg run. The rate it gives is the best ideal play can do; a measured rate sits at or
// below it.
//
// The load. A trip lasts until the inventory is full or, for a method that eats, until the food is gone:
// - Slots: INVENTORY_SLOTS less the tools carried, the gather's and the process steps' (a tool with a `wearpos` is
//   wielded instead, as ideal play does; its wield level is not checked), one slot per stackable supply (bait,
//   feathers, a step's nature runes; a non-stackable supply of the gather is not modelled; a wearable one is worn),
//   and one per stackable product of the gather or a step (coins and runes never fill the inventory).
// - Without food, the load is the free slots over the slots a success fills: the gather's non-stackable products
//   (fractional: gems), or the withdrawn obj, plus a slot per unit of a step's non-stackable supply (bow strings,
//   carried from the start of the trip), unless a step 'here' uses it (see `asItGoes`). No such slot means the
//   inventory never fills: the sink is never visited. Where a step takes `batch` inputs a product and its input per
//   success is whole, the load rounds down to whole batches; a chain with more than one batched step is not modelled.
// - With food, every free slot holds food, and the load is the successes that food covers: free x heal over the
//   damage a success costs (failDamage x fails per success, plus `damage`). Food with a non-stackable product (both
//   filling the inventory) is not modelled. The hitpoints pool and regeneration are left out, which only lowers the
//   floor a little (a trip lasts somewhat longer than its food).
// - A drop sink never travels: a full inventory of non-stackable items is dropped in dropTicks(free slots), unless every
//   success depletes the feature
//   (mining, a stall): the next item needs a fresh click on another feature anyway, and the drop goes out in that
//   tick ahead of the click, free. Food with a drop sink is not modelled (nothing restocks it).
import { ModelError, ProfileError, type ActionModel } from './family';
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

/** What a process sink leaves the end products to: the bank, a drop at the last step, or the inventory (runes). */
export type ProcessEnd = 'bank' | 'drop' | 'keep';

/** How the products leave: dropped, banked over the legs' run ticks, or through process steps. */
export type CycleSink =
    | { mode: 'drop' }
    /** Run ticks of site -> bank and bank -> site. */
    | { mode: 'bank'; legs: number[] }
    /**
     * The process steps in order, each a model per input kind it takes; what the end products are left to; the run
     * ticks of the tour: site -> each step site not 'here' -> the bank when it banks -> site; and whether each step is
     * 'here' (one per step).
     */
    | { mode: 'process'; steps: ActionModel[][]; end: ProcessEnd; legs: number[]; here: boolean[] };

/**
 * The `withdraw` source: one `withdraw` obj from the bank a success, in no ticks of its own. Withdraw-All
 * (inv_button4,bank_main:inv -> @bank_withdraw, interface_bank/scripts/bank.rs2:4,37-51) runs with no delay, one more
 * USER_EVENT in the visit's deposit tick, so the visit still costs BANK_TICKS.
 */
export interface Withdraw {
    withdraw: string;
}

export interface CycleInput {
    /** The action at the site, or the obj withdrawn (a process sink then starts and ends at the bank). */
    gather: ActionModel | Withdraw;
    sink: CycleSink;
    items: Items;
    /** The food eaten to cover the gather's failDamage and damage, and how much one heals. */
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
    /** The products kept, at item value (`cost`): all banked or kept; dropped, only the stackable ones stay. */
    gpPerHour: number;
    /** Supplies used per hour (bait, feathers, a step's runes, the withdrawn obj, food) and their value. */
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

/**
 * A process step's model at work: its step's index, the input it takes per gather success, and its actions per gather
 * success.
 */
interface Run {
    m: ActionModel;
    step: number;
    per: number;
    actions: number;
}

/** The floor's rates for one method: its gather and sink, at the profile its models were built for. */
export function cycle({ gather, sink, items, food }: CycleInput): CycleRates {
    const withdraw = 'withdraw' in gather ? gather.withdraw : undefined;
    if (withdraw !== undefined && sink.mode !== 'process')
        throw new ModelError(`withdrawing ${withdraw} needs a process sink`);
    // The withdraw source as an action: one item a success, its ticks none.
    const source: ActionModel =
        'withdraw' in gather
            ? {
                  ticksPerAttempt: 1,
                  success: 1,
                  xpTenths: {},
                  products: [{ obj: gather.withdraw, count: 1 }],
                  consumes: [],
              }
            : gather;
    if (source.restart || source.start || source.perTick !== undefined)
        throw new ModelError('a gather with a restart, a start or a perTick is not modelled');
    const tpi = withdraw === undefined ? ticksPerItem(source) : 0;
    const p = source.success;
    const failsPerSuccess = (1 - p) / p;
    const stepModels = sink.mode === 'process' ? sink.steps : [];
    // A trip visits a bank (BANK_TICKS, a food restock) with a bank sink, a process sink that banks, or a withdrawal.
    const banks = sink.mode === 'bank' || (sink.mode === 'process' && (sink.end === 'bank' || withdraw !== undefined));

    // The whole-batch rounding below takes one batched step; a second could leave the first at a part batch.
    if (stepModels.filter(s => s.some(m => (m.batch ?? 1) > 1)).length > 1)
        throw new ModelError('a chain with more than one batched step is not modelled');
    // The chain, per success: `held` starts as the gather's products; each step's model takes all of its input (its
    // first `consumes`) in actions of `batch` and adds its products. A model whose input nothing gives at this profile
    // (salmon under Fishing 30) does nothing. Its other `consumes` are supplies, per action.
    const held = new Map<string, number>();
    for (const x of source.products) add(held, x.obj, x.count);
    // The leading steps 'here' (at the gather's stand), and what is held per success once they are done.
    const here = sink.mode === 'process' ? sink.here : [];
    if (sink.mode === 'process' && here.length !== stepModels.length)
        throw new ModelError(`the sink names ${here.length} 'here' flags for ${stepModels.length} steps`);
    let atSite = 0;
    while (atSite < stepModels.length && here[atSite]) atSite++;
    let heldAtSite = new Map(held);
    const runs: Run[] = [];
    stepModels.forEach((models, step) => {
        for (const m of models) {
            const input = m.consumes[0];
            if (!input) throw new ModelError('a process step must take one chained input (its first consumes)');
            const batch = m.batch ?? 1;
            if (input.count !== batch)
                throw new ModelError(
                    `a process step takes ${input.count} ${input.obj} an action, but its batch is ${batch}`,
                );
            const per = held.get(input.obj);
            if (per === undefined) continue;
            const actions = per / batch;
            held.delete(input.obj);
            for (const x of m.products) add(held, x.obj, x.count * actions);
            runs.push({ m, step, per, actions });
        }
        if (step + 1 === atSite) heldAtSite = new Map(held);
    });
    const suppliesOf = (r: Run) => r.m.consumes.slice(1).map(c => ({ obj: c.obj, count: c.count * r.actions }));
    const stepSupplies = runs.flatMap(suppliesOf);

    // Slots the trip can't fill: tools not worn (the gather's and the steps' that run at this profile, each once), a
    // slot per stackable supply, a slot per stackable product.
    const toolSlots = new Set(
        [source, ...runs.map(r => r.m)].flatMap(a => a.tools ?? []).filter(t => !items(t).wearable),
    ).size;
    for (const c of source.consumes)
        if (!items(c.obj).stackable) throw new ModelError(`the supply ${c.obj} is not stackable: not modelled`);
    if (withdraw !== undefined && items(withdraw).stackable)
        throw new ModelError(`withdrawing the stackable ${withdraw} is not modelled`);
    const supplySlots = new Set([...source.consumes, ...stepSupplies].map(c => c.obj).filter(o => items(o).stackable))
        .size;
    const stackable = new Set(
        [...source.products, ...runs.flatMap(r => r.m.products)].map(x => x.obj).filter(o => items(o).stackable),
    );
    const free = INVENTORY_SLOTS - toolSlots - supplySlots - stackable.size;
    if (free < 1) throw new ProfileError(`no free inventory slot (${toolSlots} tools, ${supplySlots} supplies)`);
    const slots = (xs: Iterable<{ obj: string; count: number }>) =>
        [...xs].filter(x => !items(x.obj).stackable).reduce((n, x) => n + x.count, 0);
    // A wearable supply is worn, as a tool is: its count is wear (a ring of forging's charges), in no slot.
    const carried = (xs: { obj: string; count: number }[]) => slots(xs.filter(x => !items(x.obj).wearable));
    // A step 'here' that uses a non-stackable supply (bow strings) is done as each item is gathered: chop a log, cut
    // it, string it, then chop the next (steps run in the record's order, each on the product of the one before). The
    // strung bow takes the log's slot and the string's comes free, so the strings and bows together hold the slots
    // the trip started with in strings, and only the log being gathered needs one more: the load is the free slots
    // less one over the slots a success holds once the steps 'here' are done, or over its strings if they hold more.
    // Supplies of steps away from the stand are carried all trip beside what accumulates.
    const inline = runs.filter(r => r.step < atSite);
    const away = runs.filter(r => r.step >= atSite);
    const asItGoes = withdraw === undefined && inline.some(r => carried(suppliesOf(r)) > 0);
    const room = asItGoes ? free - 1 : free;
    if (room < 1) throw new ProfileError(`no free inventory slot to gather into beside the supplies`);
    const slotsPerSuccess = asItGoes
        ? Math.max(
              slots([...heldAtSite].map(([obj, count]) => ({ obj, count }))),
              carried(inline.flatMap(suppliesOf)),
          ) + carried(away.flatMap(suppliesOf))
        : slots(source.products) + carried(stepSupplies);
    const end = sink.mode === 'process' ? sink.end : undefined;
    if (end === 'keep') {
        // Profile-dependent: a step whose input the gather gives only at some levels is skipped below them.
        const left = [...held.keys()].filter(o => !items(o).stackable);
        if (left.length) throw new ProfileError(`kept products fill the inventory: ${left.join(', ')}`);
    }

    // A drop sink with a feature every success depletes (mining, a stall) drops ahead of the next click, free.
    const dropsAsItGoes = sink.mode === 'drop' && source.deplete?.chance === 1;
    const failDamage = source.failDamage ?? 0;
    const damage = source.damage ?? 0;
    let successes: number;
    let foodPerSuccess = 0;
    if (food) {
        if (source.failDamage === undefined && source.damage === undefined)
            throw new ModelError(`food ${food.obj} is named but the action costs no hitpoints`);
        if (!banks) throw new ModelError('food with no bank visit is not modelled: nothing restocks it');
        if (slotsPerSuccess > 0) throw new ProfileError('food with a product that fills the inventory is not modelled');
        // At a success chance of 1 with no `damage` nothing hurts: no food is eaten and the trip never ends.
        foodPerSuccess = (failDamage * failsPerSuccess + damage) / food.heal;
        successes = foodPerSuccess > 0 ? free / foodPerSuccess : Infinity;
    } else if (slotsPerSuccess === 0 || dropsAsItGoes) successes = Infinity;
    else successes = room / slotsPerSuccess;
    if (failDamage && p < 1 && !food)
        throw new ModelError(`the action costs ${failDamage} hitpoints a fail: name a food`);
    if (damage && !food) throw new ModelError(`the action costs ${damage} hitpoints a success: name a food`);
    // Whole batches: a step whose input per success is whole leaves no part batch in the load.
    if (Number.isFinite(successes))
        for (const r of runs) {
            const batch = r.m.batch ?? 1;
            if (batch > 1 && Number.isInteger(r.per))
                successes = (Math.floor((successes * r.per) / batch) * batch) / r.per;
        }
    // Profile-dependent: the free slots depend on the tools carried at the profile.
    if (successes === 0) throw new ProfileError('the load holds no whole batch');
    // A trip that never ends is counted one success at a time, with no travel.
    const trips = Number.isFinite(successes);
    const n = trips ? successes : 1;

    const gatherTicks = n * tpi;
    // A step's restarts over the trip's actions of it (ActionModel.restart). The epsilon keeps a whole count whole.
    const restarts = ({ m, actions }: Run): number => {
        if (!m.restart) return 0;
        if (!trips) throw new ModelError('a process step that restarts on a trip that never ends is not modelled');
        const { upTo, ticks, repeat } = m.restart;
        const menus = Math.ceil((n * actions) / upTo - 1e-9);
        return menus < 2 ? 0 : repeat ? (menus - 1) * ticks : ticks;
    };
    // A step's start (ActionModel.start), once a trip.
    const starts = ({ m }: Run): number => {
        const start = m.start ?? 0;
        if (!Number.isFinite(start) || start < 0) throw new ModelError(`a process step's start ${start} is not >= 0`);
        if (start && !trips)
            throw new ModelError('a process step with a start on a trip that never ends is not modelled');
        return start;
    };
    // A step's actions over the trip: ticksPerItem each, or whole ticks of perTick (ActionModel.perTick).
    const acts = ({ m, actions }: Run): number => {
        if (m.perTick === undefined) return n * actions * ticksPerItem(m);
        if (!Number.isInteger(m.perTick) || m.perTick < 1)
            throw new ModelError(`a process step's perTick ${m.perTick} is not a whole number >= 1`);
        if (!trips) throw new ModelError('a process step with a perTick on a trip that never ends is not modelled');
        return Math.ceil((n * actions) / m.perTick - 1e-9) * ticksPerItem(m);
    };
    const process = runs.reduce((t, r) => t + acts(r) + restarts(r) + starts(r), 0);
    const travel = trips && sink.mode !== 'drop' ? sink.legs.reduce((a, b) => a + b, 0) : 0;
    const bank = trips && banks ? BANK_TICKS : 0;
    // A process sink that drops drops what is left that fills a slot, at the last step, with the click away.
    const left = [...held].filter(([o]) => !items(o).stackable).reduce((t, [, c]) => t + c, 0);
    const drop = !trips ? 0 : sink.mode === 'drop' ? dropTicks(free) : end === 'drop' ? dropTicks(n * left) : 0;
    // Only a stun's eats cost ticks (eatTicksPerFail); the food for `damage` goes in no ticks of its own: an eat has no
    // p_delay (player/scripts/consumption/consume.rs2:115-131). That assumes at most one food a success: the
    // %eat_delay gate (consume.rs2:122-126) refuses another eat for the 2 ticks after one ($eat_delay 2, $skill_delay 3
    // for normal food; consume.rs2:3), so two foods never go in one tick.
    const eat = food ? n * failsPerSuccess * eatTicksPerFail(failDamage / food.heal, p) : 0;
    const active = gatherTicks + process + travel + bank + drop + eat;
    // The features respawn all trip long, so the cap holds over the whole trip: n items take at least n / cap.
    if (source.deplete && source.features === undefined)
        throw new ModelError('the model depletes but names no features: the resource cap needs them');
    const cap = resourceCap(source, source.features ?? 1);
    const wait = Math.max(0, n / cap - active);
    const total = active + wait;
    const binding: Binding =
        wait > 0 ? 'resource' : travel + bank + drop > gatherTicks + process + eat ? 'travel' : 'player';

    const perHour = (TICKS_PER_HOUR / total) * n;
    const xp = new Map<Skill, number>();
    const tenths = (skill: Skill, t: number) => xp.set(skill, (xp.get(skill) ?? 0) + t);
    for (const [skill, t] of Object.entries(source.xpTenths) as [Skill, number][]) tenths(skill, t);
    for (const r of runs)
        for (const [skill, t] of Object.entries(r.m.xpTenths) as [Skill, number][]) tenths(skill, t * r.actions);
    const supplies = new Map<string, number>();
    for (const c of source.consumes) add(supplies, c.obj, c.count);
    if (withdraw !== undefined) add(supplies, withdraw, 1);
    for (const c of stepSupplies) add(supplies, c.obj, c.count);
    if (food && foodPerSuccess > 0) add(supplies, food.obj, foodPerSuccess);

    const hourly = (m: Map<string, number>) => [...m].map(([obj, count]) => ({ obj, count: count * perHour }));
    const itemsPerHour = hourly(held);
    const suppliesPerHour = hourly(supplies);
    const value = (xs: { obj: string; count: number }[]) => xs.reduce((v, x) => v + x.count * items(x.obj).cost, 0);
    const dropped = sink.mode === 'drop' || end === 'drop';
    return {
        trip: { successes: n, gather: gatherTicks, process, travel, bank, drop, eat, wait, total },
        binding,
        xpPerHour: Object.fromEntries([...xp].map(([skill, t]) => [skill, (t / 10) * XP_RATE * perHour])),
        itemsPerHour,
        gpPerHour: value(dropped ? itemsPerHour.filter(x => items(x.obj).stackable) : itemsPerHour),
        suppliesPerHour,
        suppliesGpPerHour: value(suppliesPerHour),
    };
}
