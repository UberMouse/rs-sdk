import { z } from 'zod/v4';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { AreaSchema, inArea, refuseArea, returnToAreaStep } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';
import { isLowHp } from '../lib/threat';
import { errMessage } from '../lib/util';

const SKILLS = ['Attack', 'Strength', 'Defence'] as const;

/** An NPC may be this many levels above the bot's combat level before the task refuses to fight it. */
const DEFAULT_MAX_LEVEL_GAP = 5;
const DEFAULT_EAT_BELOW = 0.6;
/** Wall-clock time one fight may last before it counts as stuck (a chicken dies in a handful of ticks). */
const FIGHT_TIMEOUT_MS = 90_000;
const FIGHT_SLICE_MS = 6_000;
const STYLE_WAIT_MS = 3_000;
const STYLE_LIST_WAIT_TICKS = 3;
const BURY_WAIT_MS = 5_000;
const NO_TARGET_LIMIT = 20;
const NO_TARGET_WAIT_TICKS = 3;
const ATTACK_FAIL_LIMIT = 6;
const STYLE_FAIL_LIMIT = 3;
const EQUIP_FAIL_LIMIT = 3;
const BURY_FAIL_LIMIT = 3;
const LOOT_FAIL_LIMIT = 9;
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
type Ctx = TaskContext<CombatParams>;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const BONES_NAME = 'Bones';
const BONES = new RegExp(`^${BONES_NAME}$`, 'i');
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

/** HP is under the configured eat threshold. */
const belowEatThreshold = (s: BotWorldState, p: CombatParams) =>
    !!s.player && s.player.maxHp > 0 && s.player.hp < s.player.maxHp * p.eatBelow;

/** Wait for `pred`; false when the wait times out, any other failure is rethrown. */
async function waitOrTimeout(ctx: Ctx, pred: (s: BotWorldState) => boolean, ms: number): Promise<boolean> {
    try {
        await ctx.sdk.waitForCondition(pred, ms);
        return true;
    } catch (e) {
        if (/timed out/i.test(errMessage(e))) return false;
        throw e;
    }
}

const matches = (npc: NearbyNpc, p: CombatParams) => sameName(npc.name, p.target);

const lootKey = (i: { id: number; x: number; z: number }) => `${i.id}@${i.x},${i.z}`;

const skippedLoot = (ctx: Ctx): Set<string> => {
    const existing = ctx.memory.lootSkipped;
    if (existing instanceof Set) return existing;
    const created = new Set<string>();
    ctx.memory.lootSkipped = created;
    return created;
};

/** Reachable wanted ground items near the fight spot, nearest first. */
function wantedGroundItems(ctx: Ctx) {
    const names = ctx.params.buryBones ? [...ctx.params.loot, BONES_NAME] : ctx.params.loot;
    if (names.length === 0 || ctx.inventoryFull()) return [];
    const skip = skippedLoot(ctx);
    return ctx.sdk
        .getGroundItems()
        .filter(i => names.some(n => sameName(n, i.name)))
        .filter(i => i.reachable !== false && i.distance <= LOOT_RADIUS && inArea(ctx.params.area, i))
        .filter(i => !skip.has(lootKey(i)))
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
            n.options.some(o => /attack/i.test(o)) &&
            inArea(p.area, n),
    );
    const target = candidates.filter(n => n.combatLevel <= limit).sort((a, b) => a.distance - b.distance)[0];
    return { target, tooStrong: candidates.find(n => n.combatLevel > limit), limit };
}

/** Wait one slice for the kill, waking early when HP needs the eat/low-HP steps. */
async function waitForKill(ctx: Ctx) {
    const startedAt = typeof ctx.memory.fightStartedAt === 'number' ? ctx.memory.fightStartedAt : Date.now();
    ctx.memory.fightStartedAt = startedAt;
    if (Date.now() - startedAt > FIGHT_TIMEOUT_MS) {
        const p = ctx.state().player;
        return { fail: `fight lasted over ${FIGHT_TIMEOUT_MS / 1000}s at (${p?.worldX},${p?.worldZ})` };
    }
    await waitOrTimeout(
        ctx,
        s =>
            !s.player?.combat.inCombat ||
            isLowHp(s) ||
            (belowEatThreshold(s, ctx.params) && !!foodInInventory(s, ctx.params)),
        FIGHT_SLICE_MS,
    );
    // The fight being timed is over; a later fight starts a fresh clock.
    if (!ctx.state().player?.combat.inCombat) delete ctx.memory.fightStartedAt;
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
    stepTimeoutMs: STEP_TIMEOUT_MS,

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
                const need = pending(weapon) || pending(shield);
                if (!need) ctx.counter('equipFails').reset();
                return need;
            },
            async run(ctx) {
                const s = ctx.state();
                for (const n of [ctx.params.weapon, ctx.params.shield]) {
                    if (!n || worn(s, n) || !carried(s, n)) continue;
                    const r = await ctx.bot.equipItem(n);
                    if (!r.success && ctx.counter('equipFails').add() >= EQUIP_FAIL_LIMIT)
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
                const need = style ? s.combatStyle?.currentStyle !== style.index : !!s.combatStyle;
                if (!need) ctx.counter('styleFails').reset();
                return need;
            },
            async run(ctx) {
                const cs = ctx.state().combatStyle;
                const style = styleFor(ctx.state(), ctx.params.skill);
                if (!style) {
                    if (cs?.known && cs.styles.length > 0)
                        return {
                            fail: `no combat style trains ${ctx.params.skill} with ${ctx.params.weapon ?? 'current weapon'}`,
                        };
                    // The client has not published a real style list yet (login, or lagging the equip step).
                    if (ctx.counter('styleFails').add() >= STYLE_FAIL_LIMIT)
                        return { fail: 'combat style list never loaded' };
                    await ctx.sdk.waitForTicks(STYLE_LIST_WAIT_TICKS);
                    return;
                }
                // No bot.* method for this; the effect is checked below.
                await ctx.sdk.sendSetCombatStyle(style.index);
                if (await waitOrTimeout(ctx, s => s.combatStyle?.currentStyle === style.index, STYLE_WAIT_MS)) {
                    ctx.log(`combat style ${style.name} (${style.type}) for ${ctx.params.skill}`);
                } else if (ctx.counter('styleFails').add() >= STYLE_FAIL_LIMIT) {
                    return { fail: `could not set combat style ${style.name} for ${ctx.params.skill}` };
                }
            },
        },
        returnToAreaStep<CombatParams>(params => params.area),
        {
            name: 'eat',
            when: ctx => {
                const s = ctx.state();
                const need = belowEatThreshold(s, ctx.params) && !!foodInInventory(s, ctx.params);
                if (!need) ctx.counter('eatFails').reset();
                return need;
            },
            async run(ctx) {
                const food = foodInInventory(ctx.state(), ctx.params);
                if (!food) return;
                const r = await ctx.bot.eatFood(food);
                if (r.success) {
                    ctx.counter('eatFails').reset();
                    return;
                }
                if (ctx.counter('eatFails').add() >= EAT_FAIL_LIMIT)
                    return { fail: `could not eat ${food.name}: ${r.message}` };
            },
        },
        {
            name: 'bury-bones',
            when: ctx => ctx.params.buryBones && countBones(ctx.state()) > 0,
            async run(ctx) {
                const bones = ctx.state().inventory.find(isBones);
                const opt = bones?.optionsWithIndex.find(o => /^bury$/i.test(o.text));
                if (!bones || !opt) return { fail: 'bones have no Bury option' };
                await ctx.bot.dismissBlockingUI();
                const before = countBones(ctx.state());
                // No bot.* method for this; the effect is checked below.
                await ctx.sdk.sendUseItem(bones.slot, opt.opIndex);
                if (!(await waitOrTimeout(ctx, s => countBones(s) < before, BURY_WAIT_MS))) {
                    if (ctx.counter('buryFails').add() >= BURY_FAIL_LIMIT) return { fail: 'bones did not bury' };
                    return;
                }
                ctx.counter('buryFails').reset();
            },
        },
        {
            name: 'loot',
            // Never walk off to loot while something is hitting the bot.
            when: ctx => !ctx.state().player?.combat.inCombat && wantedGroundItems(ctx).length > 0,
            async run(ctx) {
                const item = wantedGroundItems(ctx)[0];
                if (!item) return;
                const r = await ctx.bot.pickupItem(item);
                if (r.success) {
                    ctx.counter('lootFails').reset();
                    return;
                }
                // Remember items that could not be taken so the loop does not retry them forever.
                skippedLoot(ctx).add(lootKey(item));
                ctx.log(`loot ${item.name} failed: ${r.message}`);
                if (ctx.counter('lootFails').add() >= LOOT_FAIL_LIMIT)
                    return { fail: `looting keeps failing (last: ${r.message})` };
            },
        },
        {
            name: 'fight',
            when: () => true,
            async run(ctx) {
                const state = ctx.state();
                const p = state.player;
                if (!p) return;
                if (p.combat.inCombat) return waitForKill(ctx);
                delete ctx.memory.fightStartedAt;

                const { target, tooStrong, limit } = pickTarget(state, ctx.params);
                if (!target) {
                    if (tooStrong)
                        return { fail: `${tooStrong.name} is level ${tooStrong.combatLevel}, above limit ${limit}` };
                    if (ctx.counter('noTarget').add() >= NO_TARGET_LIMIT)
                        return { fail: `no free reachable ${ctx.params.target} in the area` };
                    await ctx.sdk.waitForTicks(NO_TARGET_WAIT_TICKS);
                    return;
                }
                ctx.counter('noTarget').reset();

                let result: Awaited<ReturnType<typeof ctx.bot.attack>>;
                try {
                    result = await ctx.bot.attack(target);
                } catch (e) {
                    result = { success: false, message: errMessage(e) };
                }
                if (result.success) {
                    ctx.counter('attackFails').reset();
                    return;
                }
                ctx.log(`attack ${target.name} failed: ${result.message}`);
                if (result.reason === 'died') return { fail: result.message };
                if (ctx.counter('attackFails').add() >= ATTACK_FAIL_LIMIT)
                    return { fail: `${ATTACK_FAIL_LIMIT} attacks in a row failed (last: ${result.message})` };
                await ctx.sdk.waitForTicks(1);
            },
        },
    ],
});
