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
//   filling the inventory) is not modelled, except under a `loot` policy (below). The hitpoints pool and regeneration
//   are left out, which only lowers the floor a little (a trip lasts somewhat longer than its food).
// - A `loot` policy (a kill's drops, see Loot) picks which of the gather's products are kept before anything else
//   reads them. Kept loot and food then share the free slots: each eat frees a slot the loot can take, so a trip that
//   starts with f food ends when the food runs out (f / food a success) or the inventory fills (free - f over the
//   slots a success fills less the food it eats). Ideal play starts with the f that makes both come at once:
//   free / max(food a success, slots a success) successes. That assumes a bank visit withdraws exactly that f
//   (free x food / slots, when the loot fills faster), or fills every slot with food when the food runs out first.
//   Picking the loot up is not counted here.
// - `uncalibrated`: the gather's `damage` is not yet checked against a run (the food gate), so no food goes for it
//   (none eaten, no swing eats) and, with no failDamage, a trip ends only when the inventory fills. A fail's damage
//   (failDamage) is not under the gate: it still eats the named food.
// - A drop sink never travels: a full inventory of non-stackable items is dropped in dropTicks(free slots), unless every
//   success depletes the feature (mining, a stall): the next item needs a fresh click on another feature anyway, and
//   the drop goes out in that tick ahead of the click, free, so the inventory never fills. Food with a drop sink is
//   not modelled (nothing restocks it).
// - `damage` (see ActionModel) needs a food. Its eats cost no ticks, except on an action with an `attackRate` (a
//   kill), where each costs EAT_DELAY; a stun's eats cost eatTicksPerFail. Only foods whose trigger adds EAT_DELAY
//   (normal food) are modelled.
//
// The steps. A process step's `restart`, `start` and `perTick` (see ActionModel) add to its ticks over a trip, so
// they need a trip that ends; `batch` is the inputs an action takes (the whole-batch rounding above). A gather with a
// restart, a start or a perTick is not modelled.
import { readFileSync } from 'fs';
import { join } from 'path';
import { SCRIPTS } from '../paths';
import { ModelError, ProfileError, type ActionModel } from './family';
import { INVENTORY_SLOTS, type Items } from './items';
import { resourceCap, ticksPerItem } from './rate';
import { readDefault, TICKS_PER_HOUR, USER_EVENTS_PER_TICK, XP_RATE, type ServerDefault, type Skill } from './server';

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

/** The food triggers: each `[opheld1,<obj or _category>]` calls @player_consume_item. */
export const CONSUME_SOURCE = 'player/scripts/consumption/consume.rs2';

/** A food trigger's `$skill_delay`, and the trigger's line; null when it passes none (or differing ones). */
export interface EatDelay {
    value: number | null;
    at: string;
}

/**
 * The `$skill_delay` (third argument) each `[opheld1,<subject>]` trigger of `text` (consume.rs2) passes to
 * @player_consume_item, by subject: an obj, or `_<category>` for the objs of a category. The label adds it to
 * `%action_delay` (consume.rs2:129-131). Normal food passes 3; gnome food, karambwan and potions pass null.
 */
export function readEatDelays(text: string): Map<string, EatDelay> {
    const found = new Map<string, { values: Set<string>; at: string }>();
    let subject: string | undefined;
    text.split('\n').forEach((line, i) => {
        const header = line.match(/^\[([^,\]]+),([^\]]+)\]/);
        if (header) {
            subject = header[1] === 'opheld1' ? header[2] : undefined;
            if (subject !== undefined) found.set(subject, { values: new Set(), at: `${CONSUME_SOURCE}:${i + 1}` });
        }
        const call = line.match(/@player_consume_item\([^,]+,[^,]+,\s*([^)\s]+)\s*\)/);
        if (call && subject !== undefined) found.get(subject)!.values.add(call[1]!);
    });
    const out = new Map<string, EatDelay>();
    for (const [s, { values, at }] of found) {
        if (values.size === 0) continue;
        const [only] = values;
        out.set(s, { value: values.size === 1 && /^\d+$/.test(only!) ? Number(only) : null, at });
    }
    return out;
}

/** Every food trigger's skill delay, read from the content when the module loads. */
export const EAT_DELAYS = readEatDelays(readFileSync(join(SCRIPTS, CONSUME_SOURCE), 'utf8'));

/** The one skill delay every food trigger that passes one passes (normal food); throws when they differ. */
export function normalEatDelay(delays: ReadonlyMap<string, EatDelay>): ServerDefault {
    const fixed = [...delays.values()].filter(d => d.value !== null);
    const values = new Set(fixed.map(d => d.value));
    if (values.size !== 1)
        throw new Error(`Expected one skill delay among ${CONSUME_SOURCE}'s food triggers, found ${values.size}`);
    return { value: fixed[0]!.value!, at: fixed[0]!.at };
}

/**
 * The ticks a normal food's eat adds to `%action_delay` (consume.rs2:129-131), which the pickpocket op
 * (pickpocket.rs2:134-137) and a swing (player_melee.rs2:8-11) wait on.
 */
export const EAT_DELAY = normalEatDelay(EAT_DELAYS).value;

/**
 * Throws a ModelError unless `obj`'s trigger (its own, else its category's) passes EAT_DELAY: the model covers
 * normal food only.
 */
export function checkNormalFood(obj: string, items: Items, delays: ReadonlyMap<string, EatDelay> = EAT_DELAYS): void {
    const category = items(obj).category;
    const d = delays.get(obj) ?? (category === undefined ? undefined : delays.get(`_${category}`));
    if (!d) throw new ModelError(`no ${CONSUME_SOURCE} trigger eats ${obj}`);
    if (d.value !== EAT_DELAY)
        throw new ModelError(
            `${obj}'s trigger (${d.at}) passes skill delay ${d.value}, not normal food's: not modelled`,
        );
}

/** Where a bury's delay is read: the bones' Bury op. */
export const BURY_SOURCE = 'skill_prayer/scripts/bury_bone.rs2';

/** The `p_delay` a bury holds the player for: the one `p_delay(n)` line of `text` (bury_bone.rs2). */
export function readBuryDelay(text: string): ServerDefault {
    return readDefault(BURY_SOURCE, text, /^\s*p_delay\((\d+)\);/);
}

/** Read from the content when the module loads. */
export const BURY_DELAY = readBuryDelay(readFileSync(join(SCRIPTS, BURY_SOURCE), 'utf8'));

/**
 * The fewest ticks from one swing to the next with a bury between them: 1 + n + 2 at `p_delay(n)`. The bury's
 * `p_stopaction` (bury_bone.rs2:8) ends the attack, so it goes the tick after the swing (1); `p_delay(n)`
 * (bury_bone.rs2:10) holds the player n ticks, and the re-click's OpNpc is refused while delayed
 * (OpNpcHandler.ts:16-20) through the tick the delay clears in (World.ts:776), so it goes 2 ticks later. A bury costs
 * max(0, BURY_SWING_GAP - attackRate). Each takes a swing gap of its own (a second would end the re-clicked attack):
 * at most one bones per swing.
 */
export const BURY_SWING_GAP = 1 + BURY_DELAY.value + 2;

/**
 * What happens to a kill's drops (a method record's `loot`): stackable products are kept (coins, runes, noted
 * drops); bones (an obj with a `bone_exp`) are buried in place, banked or left; any other non-stackable product is
 * left unless `keep` names it. A left product is not picked up: it fills no slot and is not among the products, so
 * it drops out of gp/hr. A buried one is not either, and gives its `bone_exp` Prayer XP (bury_bone.rs2:15) and a bury
 * each (BURY_SWING_GAP).
 */
export interface Loot {
    bones: 'bury' | 'bank' | 'leave';
    keep?: string[];
}

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
    /**
     * The record's loot policy for the gather's products (a kill's drops), with a bank or drop sink. These three sit
     * here, beside `food`, rather than on the ActionModel: they are the method record's choices and state (its
     * `loot`, its calibration), not the family's model of the action.
     */
    loot?: Loot;
    /** With `loot`: an obj's `bone_exp` in tenths (readBoneXp), which says which products are bones. */
    boneXp?: (obj: string) => number;
    /** The gather's `damage` is uncalibrated: it eats no `food` and needs none; failDamage still eats it (header). */
    uncalibrated?: boolean;
}

/** One trip's ticks by what they are spent on. */
export interface Trip {
    /** Successes (gather items taken) per trip: the load, or 1 when the inventory never sends the player away. */
    successes: number;
    gather: number;
    process: number;
    /** Ticks the buries hold the next swing (BURY_SWING_GAP). */
    bury: number;
    travel: number;
    bank: number;
    drop: number;
    eat: number;
    /** Ticks spent waiting for features to respawn, when the resource cap binds. */
    wait: number;
    total: number;
}

/**
 * Why the floor is what it is: the player's own actions (gather, process, bury, eat) are the larger share of a trip
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

/** A product buried, per success, and its `bone_exp` in tenths. */
interface Buried {
    obj: string;
    count: number;
    boneXp: number;
}

/** The products `loot` keeps, and the bones it buries. */
function sortLoot(
    products: { obj: string; count: number }[],
    loot: Loot,
    boneXp: (obj: string) => number,
    items: Items,
): { kept: { obj: string; count: number }[]; buried: Buried[] } {
    const kept: { obj: string; count: number }[] = [];
    const buried: Buried[] = [];
    for (const x of products) {
        if (items(x.obj).stackable) kept.push(x);
        else if (boneXp(x.obj) > 0) {
            if (loot.bones === 'bank') kept.push(x);
            else if (loot.bones === 'bury') buried.push({ ...x, boneXp: boneXp(x.obj) });
        } else if (loot.keep?.includes(x.obj)) kept.push(x);
    }
    return { kept, buried };
}

/** The floor's rates for one method: its gather and sink, at the profile its models were built for. */
export function cycle({ gather, sink, items, food: named, loot, boneXp, uncalibrated }: CycleInput): CycleRates {
    const withdraw = 'withdraw' in gather ? gather.withdraw : undefined;
    if (withdraw !== undefined && sink.mode !== 'process')
        throw new ModelError(`withdrawing ${withdraw} needs a process sink`);
    // The withdraw source as an action: one item a success, its ticks none.
    const raw: ActionModel =
        'withdraw' in gather
            ? {
                  ticksPerAttempt: 1,
                  success: 1,
                  xpTenths: {},
                  products: [{ obj: gather.withdraw, count: 1 }],
                  consumes: [],
              }
            : gather;
    // Under a loot policy the gather's products are those kept; the bones buried go in place, a bury each.
    let source = raw;
    let buried: Buried[] = [];
    if (loot) {
        if (sink.mode === 'process') throw new ModelError('a loot policy with a process sink is not modelled');
        if (!boneXp) throw new ModelError('a loot policy needs the bones Prayer XP (boneXp)');
        const sorted = sortLoot(raw.products, loot, boneXp, items);
        source = { ...raw, products: sorted.kept };
        buried = sorted.buried;
    }
    const buries = buried.reduce((n, x) => n + x.count, 0);
    if (buries > 0 && source.attackRate === undefined)
        throw new ModelError('burying between swings needs the gather to have an attackRate');
    const buryTicks = buries * Math.max(0, BURY_SWING_GAP - (source.attackRate ?? 0));
    // An uncalibrated `damage` eats nothing; a fail's damage still eats the named food (see the header).
    const damage = uncalibrated ? 0 : (source.damage ?? 0);
    const food = uncalibrated && source.failDamage === undefined ? undefined : named;
    if (source.restart || source.start || source.perTick !== undefined)
        throw new ModelError('a gather with a restart, a start or a perTick is not modelled');
    const tpi = withdraw === undefined ? ticksPerItem(source) : 0;
    // A bury takes a swing gap of its own (BURY_SWING_GAP).
    if (buries > 0 && buries > tpi / source.attackRate!)
        throw new ModelError(
            `${buries} bones a kill but ${tpi / source.attackRate!} swings: at most one bury a swing is modelled`,
        );
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
    let successes: number;
    let foodPerSuccess = 0;
    if (food) {
        if (source.failDamage === undefined && source.damage === undefined)
            throw new ModelError(`food ${food.obj} is named but the action costs no hitpoints`);
        checkNormalFood(food.obj, items);
        if (!banks) throw new ModelError('food with no bank visit is not modelled: nothing restocks it');
        if (slotsPerSuccess > 0 && !loot)
            throw new ProfileError('food with a product that fills the inventory is not modelled');
        // At a success chance of 1 with no `damage` nothing hurts: no food is eaten and the trip never ends.
        foodPerSuccess = (failDamage * failsPerSuccess + damage) / food.heal;
        // Food and kept loot share the free slots (see the header); with no loot slot this is the food alone.
        const perSuccess = Math.max(foodPerSuccess, slotsPerSuccess);
        successes = perSuccess > 0 ? free / perSuccess : Infinity;
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
    const bury = n * buryTicks;
    const travel = trips && sink.mode !== 'drop' ? sink.legs.reduce((a, b) => a + b, 0) : 0;
    const bank = trips && banks ? BANK_TICKS : 0;
    // A process sink that drops drops what is left that fills a slot, at the last step, with the click away.
    const left = [...held].filter(([o]) => !items(o).stackable).reduce((t, [, c]) => t + c, 0);
    const drop = !trips ? 0 : sink.mode === 'drop' ? dropTicks(free) : end === 'drop' ? dropTicks(n * left) : 0;
    // An eat has no p_delay (player/scripts/consumption/consume.rs2:115-131) but adds EAT_DELAY to %action_delay
    // (:129-131), so it costs ticks only where the next action waits on that. A stun's eats cost eatTicksPerFail. On a
    // kill (an attackRate) each food for `damage` holds the next swing EAT_DELAY ticks (player_melee.rs2:8-11), however
    // many a kill takes: each adds its own, and the %eat_delay gate (:122-126) lets the next in 3 ticks on, before the
    // pushed swing. Off a kill the food for `damage` costs no ticks. The swing eats and the buries are charged as if
    // the swings ran back to back; a between-kill gap (a walk to the next target, a respawn wait) absorbs an eat after
    // the killing swing, which then costs max(0, attackRate + EAT_DELAY - gap), and a bury likewise, so a caller with
    // such a gap must net them against it.
    const swingEats = food && source.attackRate !== undefined ? (EAT_DELAY * damage) / food.heal : 0;
    const eat = food ? n * (failsPerSuccess * eatTicksPerFail(failDamage / food.heal, p) + swingEats) : 0;
    const active = gatherTicks + process + bury + travel + bank + drop + eat;
    // The features respawn all trip long, so the cap holds over the whole trip: n items take at least n / cap.
    if (source.deplete && source.features === undefined)
        throw new ModelError('the model depletes but names no features: the resource cap needs them');
    const cap = resourceCap(source, source.features ?? 1);
    const wait = Math.max(0, n / cap - active);
    const total = active + wait;
    const binding: Binding =
        wait > 0 ? 'resource' : travel + bank + drop > gatherTicks + process + bury + eat ? 'travel' : 'player';

    const perHour = (TICKS_PER_HOUR / total) * n;
    const xp = new Map<Skill, number>();
    const tenths = (skill: Skill, t: number) => xp.set(skill, (xp.get(skill) ?? 0) + t);
    for (const [skill, t] of Object.entries(source.xpTenths) as [Skill, number][]) tenths(skill, t);
    for (const x of buried) tenths('prayer', x.boneXp * x.count);
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
        trip: { successes: n, gather: gatherTicks, process, bury, travel, bank, drop, eat, wait, total },
        binding,
        xpPerHour: Object.fromEntries([...xp].map(([skill, t]) => [skill, (t / 10) * XP_RATE * perHour])),
        itemsPerHour,
        gpPerHour: value(dropped ? itemsPerHour.filter(x => items(x.obj).stackable) : itemsPerHour),
        suppliesPerHour,
        suppliesGpPerHour: value(suppliesPerHour),
    };
}
