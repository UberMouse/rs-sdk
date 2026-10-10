import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { ATTACK_OPTION, ATTACK_WAIT_TICKS, attack } from '../actions/attack';
import { CAST_DELAY_TICKS, CAST_WAIT_TICKS, cast } from '../actions/cast';
import { eat } from '../actions/eat';
import { equip } from '../actions/equip';
import { PICKUP_GRACE_TICKS, PICKUP_WAIT_TICKS, pickup } from '../actions/pickup';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op, send, ticks, wait } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { COMBAT_SPELL_NAMES, COMBAT_SPELLS, STAFF_RUNES } from '../lib/spells';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill, TICK_MS } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

const SKILLS = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic'] as const;

/** An NPC may be this many levels above the bot's combat level before the task refuses to fight it. */
const DEFAULT_MAX_LEVEL_GAP = 5;
const DEFAULT_EAT_BELOW = 0.6;
/** How long one fight may last before it counts as stuck (a chicken dies in a handful of ticks). */
const FIGHT_TIMEOUT_MS = 90_000;
const FIGHT_TIMEOUT_TICKS = Math.ceil(FIGHT_TIMEOUT_MS / TICK_MS);
/** Each wait for the kill is this long (6 s); the fight timeout is checked between them. */
const FIGHT_SLICE_TICKS = Math.ceil(6_000 / TICK_MS);
/**
 * How long a Ranged fight may go on with no ammo left (the last arrow is fired mid-fight; the kill may
 * still land, so the fallen arrows can be looted) before the run fails as out of ammo, not as a stuck fight.
 */
const NO_AMMO_GRACE_TICKS = 20;
/** How long the combat tab gets to show a style change (3 s). */
const STYLE_WAIT_TICKS = Math.ceil(3_000 / TICK_MS);
const STYLE_LIST_WAIT_TICKS = 3;
/** How long a bone gets to leave the inventory after Bury (5 s). */
const BURY_WAIT_TICKS = Math.ceil(5_000 / TICK_MS);
/** The wait for player state to appear, in ticks. */
const NO_PLAYER_WAIT_TICKS = 1;
const NO_TARGET_LIMIT = 20;
const NO_TARGET_WAIT_TICKS = 3;
const ATTACK_FAIL_LIMIT = 6;
export const ATTACK_RETRY_TICKS = 1;
/** The attack's own send takes a tick; walkTo's reserveTicks must count it (WALK_RESERVE_TICKS). */
const SEND_TICKS = 1;
/** What the fight step does after its walk to an NPC: the attack's send, its wait, then the retry wait on a failure. */
export const AFTER_WALK_TICKS = SEND_TICKS + ATTACK_WAIT_TICKS + ATTACK_RETRY_TICKS;
/**
 * An NPC further than this is walked to first, to within this: the walkTo op opens the doors and gates
 * on the way, which the client's own pathing for the attack does not.
 */
const ATTACK_WALK_BEYOND = 2;
const STYLE_FAIL_LIMIT = 3;
const EQUIP_FAIL_LIMIT = 3;
const BURY_FAIL_LIMIT = 3;
const CAST_FAIL_LIMIT = 6;
/** Casts at one target before the run gives up on it: a chicken takes two or three, a level-gap cow ten. */
const CASTS_PER_TARGET_LIMIT = 40;
const LOOT_FAIL_LIMIT = 9;
/**
 * How long a ground item a pickup failed on is left alone (20 s): long enough not to retry in a tight
 * loop, short enough that a transient failure (another player's fight in the way, a momentary block)
 * does not skip every later drop of the same item on that tile (feathers at a chicken spot) for the run.
 */
const LOOT_SKIP_TICKS = Math.ceil(20_000 / TICK_MS);
/** The longest a fight wait can run past the timeout: the check happens between kill slices. */
const FIGHT_GIVE_UP_TICKS = FIGHT_TIMEOUT_TICKS + FIGHT_SLICE_TICKS;
/** The loot give-up: LOOT_FAIL_LIMIT pickups each waiting out a full timeout and grace. */
const LOOT_GIVE_UP_TICKS = LOOT_FAIL_LIMIT * (PICKUP_WAIT_TICKS + PICKUP_GRACE_TICKS);
/**
 * The watchdog (static) waits for the longest of the specific failures, so each can report its reason:
 * the fight and loot give-ups, the walks back to the area (WALK_FAIL_LIMIT of them, each up to
 * WALK_MAX_TICKS without moving the bot) and the attacks (ATTACK_FAIL_LIMIT of them, each a failed walk
 * to a far NPC and then the attack's wait).
 */
export const SILENT_STREAK_TICKS = [
    FIGHT_GIVE_UP_TICKS,
    LOOT_GIVE_UP_TICKS,
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(ATTACK_FAIL_LIMIT, WALK_MAX_TICKS + AFTER_WALK_TICKS),
    failStreakTicks(CAST_FAIL_LIMIT, CAST_WAIT_TICKS + 1),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** Ground items further than this are not worth leaving the fight spot for. */
const LOOT_RADIUS = 6;
const EAT_FAIL_LIMIT = 3;
const STEP_TIMEOUT_MS = 300_000;
/** Without food, preflight refuses NPCs above this combat level (chickens are 1, cows 2). */
const NO_FOOD_MAX_NPC_LEVEL = 5;

const Params = z.object({
    /** Exact NPC name (case-insensitive), e.g. "Chicken", "Cow". */
    target: z.string().trim().min(1),
    /**
     * The skill to train. Attack/Strength/Defence pick the melee style that trains it; Ranged needs a bow
     * as `weapon` and `ammo`; Magic needs a `spell`.
     */
    skill: z.enum(SKILLS).default('Attack'),
    /** Where to fight. Required: the bot never wanders beyond `radius` of this centre. */
    area: AreaSchema,
    /** Inventory item names to wield if not already worn, e.g. "Bronze sword". The bot must meet the item's wield requirement. */
    weapon: z.string().trim().optional(),
    shield: z.string().trim().optional(),
    /** Ranged: the ammunition item name to wield (e.g. "Bronze arrow"); also what `loot` should list to reuse fallen arrows. */
    ammo: z.string().trim().optional(),
    /** Magic: the combat spell cast on each target; its runes come from the inventory; a worn Staff of air/water/earth/fire covers only its own rune. */
    spell: z.enum(COMBAT_SPELL_NAMES).optional(),
    /** Food item names to eat when HP falls below `eatBelow` of max. The engine also eats any food below 50%. */
    food: z.array(z.string().trim()).default([]),
    eatBelow: z.number().min(0.1).max(0.9).default(DEFAULT_EAT_BELOW),
    /** Bury bones for Prayer XP (also picks bones up). */
    buryBones: z.boolean().default(false),
    /** Ground item names to pick up after a kill (exact, case-insensitive), e.g. ["Feather", "Cowhide"]. */
    loot: z.array(z.string().trim()).default([]),
    /** Refuse (and never attack) NPCs with combat level above the bot's combat level plus this. */
    maxLevelGap: z.number().min(0).default(DEFAULT_MAX_LEVEL_GAP),
});

type CombatParams = z.infer<typeof Params>;
interface CombatMemory {
    /** The tick the fight being waited out was first seen, until the bot is out of combat. */
    fightStartedAtTick: number | null;
    /** The tick a fight was first seen with no ammo left (Ranged), or null while ammo remains. */
    noAmmoSinceTick: number | null;
    /** Ground items (`lootKey`) a pickup failed on, with the tick they are skippable until. */
    lootSkipped: Map<string, number>;
    /** The NPC the Magic step is casting at, and the casts so far. */
    castTarget: { index: number; casts: number } | null;
}
type Ctx = TaskContext<CombatParams, CombatMemory>;

const BONES_NAME = 'Bones';
const BONES = new RegExp(`^${BONES_NAME}$`, 'i');
const BURY_OPTION = /^bury$/i;
const isBones = (i: { name: string }) => BONES.test(i.name);
const countBones = (s: BotWorldState) => s.inventory.filter(isBones).length;

const worn = (s: BotWorldState, name: string) => s.equipment.some(i => exactName(name).test(i.name));
const carried = (s: BotWorldState, name: string) => s.inventory.some(i => exactName(name).test(i.name));
const wornOrCarried = (s: BotWorldState, name: string) => worn(s, name) || carried(s, name);

/** Ammunition left, worn plus carried (a stack counts as its size). */
const ammoLeft = (s: BotWorldState, name: string) =>
    [...s.inventory, ...s.equipment].filter(i => exactName(name).test(i.name)).reduce((n, i) => n + i.count, 0);

/** The style that trains `skill`, preferring one that trains only it (not a controlled style). */
function styleFor(s: BotWorldState, skill: string) {
    const styles = s.combatStyle?.styles.filter(o => o.trainsSkills.includes(skill)) ?? [];
    return styles.find(o => o.trainsSkills.length === 1) ?? styles[0];
}

/** Why the spell cannot be cast from this state (level, or a rune short that no worn staff covers), or null. */
function refuseSpell(s: BotWorldState, p: CombatParams): string | null {
    if (!p.spell) return 'Magic needs `spell` (e.g. "Wind Strike")';
    const spell = COMBAT_SPELLS[p.spell];
    const level = findSkill(s, 'Magic')?.level ?? 0;
    if (level < spell.level) return `${p.spell} needs Magic ${spell.level}, the bot has ${level}`;
    // Only a worn staff counts, and only for its own element's rune.
    const supplied = s.equipment.map(i => STAFF_RUNES[i.name]).find(Boolean);
    for (const [rune, n] of Object.entries(spell.runes)) {
        if (rune === supplied) continue;
        const have = countItems(s, exactName(rune));
        if (have < n) return `${p.spell} needs ${n} ${rune}, the bot has ${have}`;
    }
    return null;
}

/** Highest NPC combat level to fight; without food the engine can only wait out low HP, so it is capped. */
function levelLimit(s: BotWorldState, p: CombatParams) {
    const limit = (s.player?.combatLevel ?? 0) + p.maxLevelGap;
    return foodInInventory(s, p) ? limit : Math.min(limit, NO_FOOD_MAX_NPC_LEVEL);
}

/** The first inventory item that is configured food. */
const foodInInventory = (s: BotWorldState, p: CombatParams) =>
    s.inventory.find(i => p.food.some(f => exactName(f).test(i.name)));

/**
 * HP is under the configured eat threshold and there is configured food: the eat step's case. Below
 * half HP the low-HP guard (lib/interrupts.ts) fires first, at any wait and between steps, and eats
 * any Eat item; this step tops HP up from there to `eatBelow`, so with `eatBelow` at or under one half
 * it seldom runs.
 */
const wantsToEat = (s: BotWorldState, p: CombatParams) =>
    !!s.player && s.player.maxHp > 0 && s.player.hp < s.player.maxHp * p.eatBelow && !!foodInInventory(s, p);

const matches = (npc: NearbyNpc, p: CombatParams) => exactName(p.target).test(npc.name);

const lootKey = (i: { id: number; x: number; z: number }) => `${i.id}@${i.x},${i.z}`;

/** Reachable wanted ground items near the fight spot, nearest first. */
function wantedGroundItems(ctx: Ctx) {
    const names = ctx.params.buryBones ? [...ctx.params.loot, BONES_NAME] : ctx.params.loot;
    if (names.length === 0 || ctx.inventoryFull()) return [];
    return ctx
        .state()
        .groundItems.filter(i => names.some(n => exactName(n).test(i.name)))
        .filter(i => i.reachable !== false && i.distance <= LOOT_RADIUS && inArea(ctx.params.area, i))
        .filter(i => (ctx.memory.lootSkipped.get(lootKey(i)) ?? -Infinity) <= ctx.state().tick)
        .sort((a, b) => a.distance - b.distance);
}

/** The nearest free in-limit target, or else a free matching NPC that is too strong. */
function pickTarget(state: BotWorldState, p: CombatParams) {
    const limit = levelLimit(state, p);
    const candidates = state.nearbyNpcs.filter(
        n =>
            matches(n, p) &&
            n.reachable !== false &&
            !n.inCombat &&
            n.options.some(o => ATTACK_OPTION.test(o)) &&
            inArea(p.area, n),
    );
    const target = candidates.filter(n => n.combatLevel <= limit).sort((a, b) => a.distance - b.distance)[0];
    return { target, tooStrong: candidates.find(n => n.combatLevel > limit), limit };
}

/**
 * Wait one slice for the kill, waking early for the eat step. The guards stay on: the low-HP guard
 * cancels the wait and eats, death ends the run, and the fight's clock survives into the next slice.
 */
function* waitForKill(ctx: Ctx): Op<Outcome> {
    const state = ctx.state();
    const now = state.tick;
    const startedAt = ctx.memory.fightStartedAtTick ?? now;
    ctx.memory.fightStartedAtTick = startedAt;
    const { skill, ammo } = ctx.params;
    if (skill === 'Ranged' && ammo && ammoLeft(state, ammo) === 0) {
        // `out-of-ammo`'s `when` is false mid-fight with the arrow on the loot list, so this is its bound.
        const since = ctx.memory.noAmmoSinceTick ?? now;
        ctx.memory.noAmmoSinceTick = since;
        if (now - since > NO_AMMO_GRACE_TICKS) return { fail: `out of ${ammo}` };
    } else ctx.memory.noAmmoSinceTick = null;
    if (now - startedAt > FIGHT_TIMEOUT_TICKS) {
        const p = state.player;
        return { fail: `fight lasted over ${FIGHT_TIMEOUT_MS / 1000}s at (${p?.worldX},${p?.worldZ})` };
    }
    const w = yield* wait('kill', s => !s.player?.combat.inCombat || wantsToEat(s, ctx.params), FIGHT_SLICE_TICKS);
    // The fight being timed is over; a later fight starts a fresh clock.
    if (!w.state.player?.combat.inCombat) ctx.memory.fightStartedAtTick = null;
}

/** bot.attack's walk to a far NPC, then the attack op; a failed walk reads as upstream's out-of-reach. */
function* walkAndAttack(ctx: Ctx, npc: NearbyNpc): Op<{ ok: true } | { ok: false; message: string }> {
    if (npc.distance > ATTACK_WALK_BEYOND) {
        const walked = yield* walkTo(ctx, npc.x, npc.z, ATTACK_WALK_BEYOND, { reserveTicks: AFTER_WALK_TICKS });
        if (!walked.ok) return { ok: false, message: `Cannot reach ${npc.name}: ${walked.message}` };
    }
    return yield* attack(ctx, npc);
}

/**
 * The NPC to act on: `engaged` if given, else the nearest free in-limit one. With none, `outcome` is what
 * the step returns: a fail (only too-strong targets, or none for NO_TARGET_LIMIT looks) or nothing after a
 * short wait.
 */
function* chooseTarget(ctx: Ctx, engaged?: NearbyNpc): Op<{ target: NearbyNpc } | { outcome: Outcome }> {
    const picked = engaged ? undefined : pickTarget(ctx.state(), ctx.params);
    const target = engaged ?? picked?.target;
    const noTarget = ctx.streak('noTarget');
    if (target) {
        noTarget.reset();
        return { target };
    }
    if (picked?.tooStrong)
        return {
            outcome: {
                fail: `${picked.tooStrong.name} is level ${picked.tooStrong.combatLevel}, above limit ${picked.limit}`,
            },
        };
    if (noTarget.add() >= NO_TARGET_LIMIT)
        return { outcome: { fail: `no free reachable ${ctx.params.target} in the area` } };
    yield* ticks(NO_TARGET_WAIT_TICKS);
    return { outcome: undefined };
}

/** Drops the cast count once the NPC it counts is gone, so a respawn reusing its index starts afresh. */
function forgetGoneCastTarget(ctx: Ctx, state: BotWorldState) {
    const tracked = ctx.memory.castTarget;
    if (tracked && !state.nearbyNpcs.some(n => n.index === tracked.index)) ctx.memory.castTarget = null;
}

/** Counts one more cast at `target` and returns the casts so far at it. */
function countCast(ctx: Ctx, target: NearbyNpc) {
    const prev = ctx.memory.castTarget;
    const casts = prev?.index === target.index ? prev.casts + 1 : 1;
    ctx.memory.castTarget = { index: target.index, casts };
    return casts;
}

export default defineTask({
    name: 'combat',
    description:
        'Train a combat skill on one kind of NPC inside an area: wields the given weapon/shield, sets the attack ' +
        'style for `skill` (Attack/Strength/Defence/Ranged), attacks the nearest reachable matching NPC that is not ' +
        'fighting someone else, waits for the kill, repeats. Ranged: `weapon` is a bow and `ammo` its arrows (wielded; ' +
        'fails "out of <ammo>" when none are left; list the arrow in `loot` to pick fallen ones up and re-wield them). ' +
        'Magic: casts `spell` (free-to-play Strike/Bolt/Blast, e.g. "Wind Strike", 1 Mind + 1 Air rune per cast) at ' +
        "each target with runes from the inventory (a worn Staff of <element> replaces just that element's rune); fails when runes run out or the " +
        'Magic level is too low. Optional food (eaten below `eatBelow`), bone burying and a loot list. ' +
        'Refuses areas reaching the Wilderness and NPCs more than `maxLevelGap` (default 5) levels above the bot. ' +
        'The engine waits out low HP when there is no food, so without food it refuses NPCs above combat level 5. ' +
        'Weapon/shield need the bot to meet their wield requirement. Spots: Lumbridge chickens (3231,3295, ' +
        'radius 8; fenced coop with a gate; verified); Lumbridge cows (3253,3290, radius 12; south gate at ' +
        '3253,3266; unverified).',
    params: Params,
    memory: (): CombatMemory => ({
        fightStartedAtTick: null,
        noAmmoSinceTick: null,
        lootSkipped: new Map(),
        castTarget: null,
    }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const p = ctx.params;
        for (const item of [p.weapon, p.shield, p.ammo]) {
            if (item && !wornOrCarried(s, item)) return `${item} is neither worn nor in the inventory`;
        }
        if (!s.player) return 'no player state';
        if (p.skill === 'Ranged' && (!p.weapon || !p.ammo)) return 'Ranged needs `weapon` (a bow) and `ammo`';
        if (p.skill === 'Magic') {
            const refusal = refuseSpell(s, p);
            if (refusal) return refusal;
        }
        const seen = s.nearbyNpcs.filter(n => matches(n, p));
        const lowest = Math.min(...seen.map(n => n.combatLevel));
        const limit = levelLimit(s, p);
        if (seen.length > 0 && lowest > limit)
            return `${p.target} is level ${lowest}, above the limit ${limit} (combat ${s.player.combatLevel} + ${p.maxLevelGap}${foodInInventory(s, p) ? '' : `, capped at ${NO_FOOD_MAX_NPC_LEVEL} without food`})`;
        return refuseArea(p.area);
    },

    steps: [
        {
            name: 'equip',
            when: ctx => {
                const s = ctx.state();
                const { weapon, shield, ammo } = ctx.params;
                const pending = (n?: string) => !!n && !worn(s, n) && carried(s, n);
                // Carried ammo is wielded even with some already worn: arrows picked up land in the inventory.
                return pending(weapon) || pending(shield) || (!!ammo && carried(s, ammo));
            },
            *run(ctx) {
                const equipFails = ctx.streak('equipFails');
                for (const n of [ctx.params.weapon, ctx.params.shield, ctx.params.ammo]) {
                    // Fresh state per item: equipping the weapon may have moved the shield's slot.
                    const s = ctx.state();
                    if (!n || (worn(s, n) && n !== ctx.params.ammo)) continue;
                    const item = s.inventory.find(i => exactName(n).test(i.name));
                    if (!item) continue;
                    const r = yield* equip(ctx, item);
                    if (!r.ok && equipFails.add() >= EQUIP_FAIL_LIMIT)
                        return { fail: `cannot equip ${n}: ${r.message}` };
                }
            },
        },
        {
            name: 'set-style',
            when: ctx => {
                // A manual cast ignores the combat style.
                if (ctx.params.skill === 'Magic') return false;
                const s = ctx.state();
                const style = styleFor(s, ctx.params.skill);
                // No style for `skill` (wrong weapon, or a style list not loaded yet) also runs the step.
                return style ? s.combatStyle?.currentStyle !== style.index : !!s.combatStyle;
            },
            *run(ctx) {
                const s = ctx.state();
                const cs = s.combatStyle;
                const style = styleFor(s, ctx.params.skill);
                const styleFails = ctx.streak('styleFails');
                if (!style) {
                    if (cs?.known && cs.styles.length > 0)
                        return {
                            fail: `no combat style trains ${ctx.params.skill} with ${ctx.params.weapon ?? 'current weapon'}`,
                        };
                    // The client has not published a real style list yet (login, or lagging the equip step).
                    if (styleFails.add() >= STYLE_FAIL_LIMIT) return { fail: 'combat style list never loaded' };
                    yield* ticks(STYLE_LIST_WAIT_TICKS);
                    return;
                }
                // No op sets the combat style: one send, and the effect is checked on the combat tab below.
                const sent = yield* send({
                    type: 'setCombatStyle',
                    style: style.index,
                    reason: `combat style ${style.name}`,
                });
                const set = sent.success
                    ? yield* wait(
                          `combat style ${style.name}`,
                          st => st.combatStyle?.currentStyle === style.index,
                          STYLE_WAIT_TICKS,
                      )
                    : null;
                if (set?.kind === 'met') {
                    yield* log(`combat style ${style.name} (${style.type}) for ${ctx.params.skill}`);
                } else if (styleFails.add() >= STYLE_FAIL_LIMIT) {
                    return { fail: `could not set combat style ${style.name} for ${ctx.params.skill}` };
                }
            },
        },
        returnToAreaStep<CombatParams>(params => params.area),
        {
            name: 'eat',
            when: ctx => wantsToEat(ctx.state(), ctx.params),
            *run(ctx) {
                const food = foodInInventory(ctx.state(), ctx.params);
                if (!food) return;
                const eatFails = ctx.streak('eatFails');
                const r = yield* eat(ctx, food);
                if (r.ok) {
                    eatFails.reset();
                    return;
                }
                if (eatFails.add() >= EAT_FAIL_LIMIT) return { fail: `could not eat ${food.name}: ${r.message}` };
            },
        },
        {
            name: 'bury-bones',
            when: ctx => ctx.params.buryBones && countBones(ctx.state()) > 0,
            *run(ctx) {
                const s = ctx.state();
                const bones = s.inventory.find(isBones);
                const opt = bones?.optionsWithIndex.find(o => BURY_OPTION.test(o.text));
                if (!bones || !opt) return { fail: 'bones have no Bury option' };
                const before = countBones(s);
                const buryFails = ctx.streak('buryFails');
                // No op buries: one send, and the effect (one bone fewer) is checked below.
                const sent = yield* send({
                    type: 'useInventoryItem',
                    slot: bones.slot,
                    optionIndex: opt.opIndex,
                    reason: `${opt.text} ${bones.name}`,
                });
                const buried = sent.success
                    ? yield* wait('bury bones', st => countBones(st) < before, BURY_WAIT_TICKS)
                    : null;
                if (buried?.kind !== 'met') {
                    if (buryFails.add() >= BURY_FAIL_LIMIT) return { fail: 'bones did not bury' };
                    return;
                }
                buryFails.reset();
            },
        },
        {
            name: 'loot',
            // Never walk off to loot while something is hitting the bot.
            when: ctx => !ctx.state().player?.combat.inCombat && wantedGroundItems(ctx).length > 0,
            *run(ctx) {
                // Expired skips are dropped here, not in `when`/wantedGroundItems, which stay pure.
                const tick = ctx.state().tick;
                for (const [key, until] of ctx.memory.lootSkipped)
                    if (until <= tick) ctx.memory.lootSkipped.delete(key);
                const item = wantedGroundItems(ctx)[0];
                if (!item) return;
                // Run-scoped, not a streak: loot stops applying between failures (skipped items), which
                // would reset a streak; only a successful pickup clears it.
                const lootFails = ctx.counter('lootFails');
                const r = yield* pickup(ctx, item);
                if (r.ok) {
                    lootFails.reset();
                    return;
                }
                ctx.memory.lootSkipped.set(lootKey(item), ctx.state().tick + LOOT_SKIP_TICKS);
                yield* log(`loot ${item.name} failed: ${r.message}`);
                if (lootFails.add() >= LOOT_FAIL_LIMIT) return { fail: `looting keeps failing (last: ${r.message})` };
            },
        },
        {
            name: 'out-of-ammo',
            // Fallen arrows that `loot` would collect are worth a kill and a pickup first: mid-fight the step
            // waits for the kill (the fight timeout bounds it) when the arrow is on the loot list.
            when: ctx => {
                const { skill, ammo, loot } = ctx.params;
                if (skill !== 'Ranged' || !ammo || ammoLeft(ctx.state(), ammo) > 0) return false;
                if (ctx.state().player?.combat.inCombat) return !loot.some(n => exactName(n).test(ammo));
                return wantedGroundItems(ctx).length === 0;
            },
            run: ctx => ({ fail: `out of ${ctx.params.ammo}` }),
        },
        {
            name: 'cast',
            when: ctx => ctx.params.skill === 'Magic',
            *run(ctx) {
                const { spell: name } = ctx.params;
                // Unreachable: preflight refuses Magic without a spell. Kept to narrow the type.
                if (!name) return { fail: 'no spell to cast' };
                const state = ctx.state();
                const p = state.player;
                if (!p) {
                    yield* ticks(NO_PLAYER_WAIT_TICKS);
                    return;
                }
                forgetGoneCastTarget(ctx, state);
                // Keep casting at the NPC the bot is already fighting; else pick a free one.
                const engaged =
                    p.combat.targetType === 'npc'
                        ? state.nearbyNpcs.find(n => n.index === p.combat.targetIndex && matches(n, ctx.params))
                        : undefined;
                const chosen = yield* chooseTarget(ctx, engaged);
                if (!('target' in chosen)) return chosen.outcome;
                const { target } = chosen;

                const castFails = ctx.streak('castFails');
                const r = yield* cast(ctx, target, COMBAT_SPELLS[name].component, name);
                if (r.ok) {
                    castFails.reset();
                    const casts = countCast(ctx, target);
                    if (casts >= CASTS_PER_TARGET_LIMIT)
                        return { fail: `${casts} casts did not kill ${target.name} at (${target.x},${target.z})` };
                    // The server holds the next cast back this long; waking early when the target is gone.
                    yield* wait('cast delay', s => !s.nearbyNpcs.some(n => n.index === target.index), CAST_DELAY_TICKS);
                    return;
                }
                if (r.reason === 'no-runes') return { fail: `out of runes for ${name}: ${r.message}` };
                if (r.reason === 'level') return { fail: r.message };
                yield* log(`cast ${name} on ${target.name} failed: ${r.message}`);
                if (castFails.add() >= CAST_FAIL_LIMIT)
                    return { fail: `${CAST_FAIL_LIMIT} casts in a row failed (last: ${r.message})` };
                yield* ticks(ATTACK_RETRY_TICKS);
            },
        },
        {
            name: 'fight',
            when: () => true,
            *run(ctx) {
                const state = ctx.state();
                const p = state.player;
                if (!p) {
                    yield* ticks(NO_PLAYER_WAIT_TICKS);
                    return;
                }
                if (p.combat.inCombat) return yield* waitForKill(ctx);
                ctx.memory.fightStartedAtTick = null;

                const chosen = yield* chooseTarget(ctx);
                if (!('target' in chosen)) return chosen.outcome;
                const { target } = chosen;

                const attackFails = ctx.streak('attackFails');
                const result = yield* walkAndAttack(ctx, target);
                if (result.ok) {
                    attackFails.reset();
                    return;
                }
                yield* log(`attack ${target.name} failed: ${result.message}`);
                if (attackFails.add() >= ATTACK_FAIL_LIMIT)
                    return { fail: `${ATTACK_FAIL_LIMIT} attacks in a row failed (last: ${result.message})` };
                yield* ticks(ATTACK_RETRY_TICKS);
            },
        },
    ],
});
