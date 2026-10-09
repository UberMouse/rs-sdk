import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { ATTACK_OPTION, attack } from '../actions/attack';
import { eat } from '../actions/eat';
import { equip } from '../actions/equip';
import { PICKUP_GRACE_TICKS, PICKUP_WAIT_TICKS, pickup } from '../actions/pickup';
import { walkTo } from '../actions/walk';
import { log, type Op, send, ticks, wait } from '../core/op';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type Outcome, type TaskContext } from '../lib/task';
import { TICK_MS } from '../lib/util';

const SKILLS = ['Attack', 'Strength', 'Defence'] as const;

/** An NPC may be this many levels above the bot's combat level before the task refuses to fight it. */
const DEFAULT_MAX_LEVEL_GAP = 5;
const DEFAULT_EAT_BELOW = 0.6;
/** How long one fight may last before it counts as stuck (a chicken dies in a handful of ticks). */
const FIGHT_TIMEOUT_MS = 90_000;
const FIGHT_TIMEOUT_TICKS = Math.ceil(FIGHT_TIMEOUT_MS / TICK_MS);
/** Each wait for the kill is this long (6 s); the fight timeout is checked between them. */
const FIGHT_SLICE_TICKS = Math.ceil(6_000 / TICK_MS);
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
const ATTACK_RETRY_TICKS = 1;
/**
 * An NPC further than this is walked to first, to within this: the walkTo op opens the doors and gates
 * on the way, which the client's own pathing for the attack does not.
 */
const ATTACK_WALK_BEYOND = 2;
const STYLE_FAIL_LIMIT = 3;
const EQUIP_FAIL_LIMIT = 3;
const BURY_FAIL_LIMIT = 3;
const LOOT_FAIL_LIMIT = 9;
/**
 * How long a ground item a pickup failed on is left alone (20 s): long enough not to retry in a tight
 * loop, short enough that a transient failure (another player's fight in the way, a momentary block)
 * does not skip every later drop of the same item on that tile (feathers at a chicken spot) for the run.
 */
const LOOT_SKIP_TICKS = Math.ceil(20_000 / TICK_MS);
/** Margin on the watchdog window, beyond the slowest specific give-up it must let fire first. */
const STUCK_MARGIN_MS = 30_000;
/** The longest a fight wait can run past the timeout: the check happens between kill slices. */
const FIGHT_GIVE_UP_MS = FIGHT_TIMEOUT_MS + FIGHT_SLICE_TICKS * TICK_MS;
/** The loot give-up: LOOT_FAIL_LIMIT pickups each waiting out a full timeout and grace. */
const LOOT_GIVE_UP_MS = LOOT_FAIL_LIMIT * (PICKUP_WAIT_TICKS + PICKUP_GRACE_TICKS) * TICK_MS;
/** The watchdog (static) waits for the later of the two specific failures, so each can report its reason. */
const STUCK_AFTER_MS = Math.max(FIGHT_GIVE_UP_MS, LOOT_GIVE_UP_MS) + STUCK_MARGIN_MS;
/** Ground items further than this are not worth leaving the fight spot for. */
const LOOT_RADIUS = 6;
const EAT_FAIL_LIMIT = 3;
const STEP_TIMEOUT_MS = 300_000;
/** Without food, preflight refuses NPCs above this combat level (chickens are 1, cows 2). */
const NO_FOOD_MAX_NPC_LEVEL = 5;

const Params = z.object({
    /** Exact NPC name (case-insensitive), e.g. "Chicken", "Cow". */
    target: z.string().min(1),
    /** The melee skill to train; picks the combat style that trains it. */
    skill: z.enum(SKILLS).default('Attack'),
    /** Where to fight. Required: the bot never wanders beyond `radius` of this centre. */
    area: AreaSchema,
    /** Inventory item names to wield if not already worn, e.g. "Bronze sword". The bot must meet the item's wield requirement. */
    weapon: z.string().optional(),
    shield: z.string().optional(),
    /** Food item names to eat when HP falls below `eatBelow` of max. The engine also eats any food below 50%. */
    food: z.array(z.string()).default([]),
    eatBelow: z.number().min(0.1).max(0.9).default(DEFAULT_EAT_BELOW),
    /** Bury bones for Prayer XP (also picks bones up). */
    buryBones: z.boolean().default(false),
    /** Ground item names to pick up after a kill (exact, case-insensitive), e.g. ["Feather", "Cowhide"]. */
    loot: z.array(z.string()).default([]),
    /** Refuse (and never attack) NPCs with combat level above the bot's combat level plus this. */
    maxLevelGap: z.number().min(0).default(DEFAULT_MAX_LEVEL_GAP),
});

type CombatParams = z.infer<typeof Params>;
interface CombatMemory {
    /** The tick the fight being waited out was first seen, until the bot is out of combat. */
    fightStartedAtTick: number | null;
    /** Ground items (`lootKey`) a pickup failed on, with the tick they are skippable until. */
    lootSkipped: Map<string, number>;
}
type Ctx = TaskContext<CombatParams, CombatMemory>;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const BONES_NAME = 'Bones';
const BONES = new RegExp(`^${BONES_NAME}$`, 'i');
const BURY_OPTION = /^bury$/i;
const isBones = (i: { name: string }) => BONES.test(i.name);
const countBones = (s: BotWorldState) => s.inventory.filter(isBones).length;

const wornOrCarried = (s: BotWorldState, name: string) =>
    [...s.inventory, ...s.equipment].some(i => sameName(i.name, name));
const worn = (s: BotWorldState, name: string) => s.equipment.some(i => sameName(i.name, name));
const carried = (s: BotWorldState, name: string) => s.inventory.some(i => sameName(i.name, name));

/** The style that trains `skill`, preferring one that trains only it (not a controlled style). */
function styleFor(s: BotWorldState, skill: string) {
    const styles = s.combatStyle?.styles.filter(o => o.trainsSkills.includes(skill)) ?? [];
    return styles.find(o => o.trainsSkills.length === 1) ?? styles[0];
}

/** Highest NPC combat level to fight; without food the engine can only wait out low HP, so it is capped. */
function levelLimit(s: BotWorldState, p: CombatParams) {
    const limit = (s.player?.combatLevel ?? 0) + p.maxLevelGap;
    return foodInInventory(s, p) ? limit : Math.min(limit, NO_FOOD_MAX_NPC_LEVEL);
}

/** The first inventory item that is configured food. */
const foodInInventory = (s: BotWorldState, p: CombatParams) =>
    s.inventory.find(i => p.food.some(f => sameName(f, i.name)));

/**
 * HP is under the configured eat threshold and there is configured food: the eat step's case. Below
 * half HP the low-HP guard (lib/interrupts.ts) fires first, at any wait and between steps, and eats
 * any Eat item; this step tops HP up from there to `eatBelow`, so with `eatBelow` at or under one half
 * it seldom runs.
 */
const wantsToEat = (s: BotWorldState, p: CombatParams) =>
    !!s.player && s.player.maxHp > 0 && s.player.hp < s.player.maxHp * p.eatBelow && !!foodInInventory(s, p);

const matches = (npc: NearbyNpc, p: CombatParams) => sameName(npc.name, p.target);

const lootKey = (i: { id: number; x: number; z: number }) => `${i.id}@${i.x},${i.z}`;

/** Reachable wanted ground items near the fight spot, nearest first. */
function wantedGroundItems(ctx: Ctx) {
    const names = ctx.params.buryBones ? [...ctx.params.loot, BONES_NAME] : ctx.params.loot;
    if (names.length === 0 || ctx.inventoryFull()) return [];
    return ctx
        .state()
        .groundItems.filter(i => names.some(n => sameName(n, i.name)))
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
        // The walk opens the doors and gates on the way, which the client's pathing for the attack does not.
        const walked = yield* walkTo(ctx, npc.x, npc.z, ATTACK_WALK_BEYOND);
        if (!walked.ok) return { ok: false, message: `Cannot reach ${npc.name}: ${walked.message}` };
    }
    return yield* attack(ctx, npc);
}

export default defineTask({
    name: 'combat',
    description:
        'Train melee on one kind of NPC inside an area: wields the given weapon/shield, sets the attack style for ' +
        '`skill` (Attack/Strength/Defence), attacks the nearest reachable matching NPC that is not fighting someone ' +
        'else, waits for the kill, repeats. Optional food (eaten below `eatBelow`), bone burying and a loot list. ' +
        'Refuses areas reaching the Wilderness and NPCs more than `maxLevelGap` (default 5) levels above the bot. ' +
        'The engine waits out low HP when there is no food, so without food it refuses NPCs above combat level 5. ' +
        'Weapon/shield need the bot to meet their wield requirement. Spots: Lumbridge chickens (3231,3295, ' +
        'radius 8; fenced coop with a gate; verified); Lumbridge cows (3253,3290, radius 12; south gate at ' +
        '3253,3266; unverified).',
    params: Params,
    memory: (): CombatMemory => ({ fightStartedAtTick: null, lootSkipped: new Map() }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const s = ctx.state();
        const p = ctx.params;
        for (const item of [p.weapon, p.shield]) {
            if (item && !wornOrCarried(s, item)) return `${item} is neither worn nor in the inventory`;
        }
        if (!s.player) return 'no player state';
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
                const { weapon, shield } = ctx.params;
                const pending = (n?: string) => !!n && !worn(s, n) && carried(s, n);
                return pending(weapon) || pending(shield);
            },
            *run(ctx) {
                const equipFails = ctx.streak('equipFails');
                for (const n of [ctx.params.weapon, ctx.params.shield]) {
                    // Fresh state per item: equipping the weapon may have moved the shield's slot.
                    const s = ctx.state();
                    if (!n || worn(s, n)) continue;
                    const item = s.inventory.find(i => sameName(i.name, n));
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

                const { target, tooStrong, limit } = pickTarget(state, ctx.params);
                const noTarget = ctx.streak('noTarget');
                if (!target) {
                    if (tooStrong)
                        return { fail: `${tooStrong.name} is level ${tooStrong.combatLevel}, above limit ${limit}` };
                    if (noTarget.add() >= NO_TARGET_LIMIT)
                        return { fail: `no free reachable ${ctx.params.target} in the area` };
                    yield* ticks(NO_TARGET_WAIT_TICKS);
                    return;
                }
                noTarget.reset();

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
