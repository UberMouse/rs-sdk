import { z } from 'zod/v4';
import { type BotWorldState, type NearbyNpc, PRAYER_LEVELS } from '../../sdk/types';
import { ATTACK_OPTION, ATTACK_WAIT_TICKS, attack } from '../actions/attack';
import { CAST_DELAY_TICKS, CAST_WAIT_TICKS, cast } from '../actions/cast';
import { eat } from '../actions/eat';
import { equip } from '../actions/equip';
import { prayerActive, prayerIndex, setPrayer } from '../actions/prayer';
import { PICKUP_GRACE_TICKS, PICKUP_WAIT_TICKS, pickup } from '../actions/pickup';
import { WALK_MAX_TICKS, walkTo } from '../actions/walk';
import { log, type Op, send, ticks, wait } from '../core/op';
import {
    areaWatchReport,
    type AreaWatch,
    newAreaWatch,
    trackIdle,
    outsideSighting,
    type Sighting,
    WILDERNESS_MARGIN,
} from '../lib/area-watch';
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_FAIL_LIMIT } from '../lib/area';
import { attackers, isLevelUp, isUnlockPage, PLAYER_TARGET_OFFSET, recentlyHit } from '../lib/interrupts';
import { squareReachesWilderness } from '../lib/wilderness';
import { COMBAT_SPELL_NAMES, COMBAT_SPELLS, STAFF_RUNES } from '../lib/spells';
import { defineTask, type Outcome, type Step, type TaskContext } from '../lib/task';
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
/** The most `respawnWaitTicks` may ask for; the watchdog window counts it. */
export const MAX_RESPAWN_WAIT_TICKS = 600;
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
const PRAYER_FAIL_LIMIT = 3;
const LEVEL_UP_FAIL_LIMIT = 3;
/** How long a click on a level-up box gets to show the next page or close it (3 s). */
const LEVEL_UP_WAIT_TICKS = Math.ceil(3_000 / TICK_MS);
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
    MAX_RESPAWN_WAIT_TICKS + NO_TARGET_WAIT_TICKS,
    LOOT_GIVE_UP_TICKS,
    failStreakTicks(WALK_FAIL_LIMIT, WALK_MAX_TICKS),
    failStreakTicks(ATTACK_FAIL_LIMIT, WALK_MAX_TICKS + AFTER_WALK_TICKS),
    failStreakTicks(CAST_FAIL_LIMIT, CAST_WAIT_TICKS + 1),
];
const STUCK_AFTER_MS = stuckWindowMs(...SILENT_STREAK_TICKS);
/** Ground items further than this are not worth leaving the fight spot for. */
const LOOT_RADIUS = 6;
const EAT_FAIL_LIMIT = 3;
/** Ticks the dialog may trail the end of the fight that opens it (the client's state packets and the interface update are separate). */
const DIALOG_LAG_TICKS = 3;
const STEP_TIMEOUT_MS = 300_000;
/** Without food, preflight refuses NPCs above this combat level (chickens are 1, cows 2). */
const NO_FOOD_MAX_NPC_LEVEL = 5;

/** Prayers that switch each other off (prayer_deactivate in the server's prayers.dbrow), by tab index. */
const PRAYER_CONFLICTS: readonly (readonly number[])[] = [
    [0, 3, 9], // Thick, Rock, Steel Skin
    [1, 4, 10], // Burst of, Superhuman, Ultimate Strength
    [2, 5, 11], // Clarity of Thought, Improved, Incredible Reflexes
    [12, 13, 14], // Protect from Magic, Missiles, Melee
];

const Params = z
    .object({
        /** Exact NPC name (case-insensitive), e.g. "Chicken", "Cow". */
        target: z.string().trim().min(1),
        /**
         * The skill to train. Attack/Strength/Defence pick the melee style that trains it; Ranged needs a bow
         * as `weapon` and `ammo`; Magic needs a `spell`.
         */
        skill: z.enum(SKILLS).default('Attack'),
        /** Where to fight. Required: the bot never wanders beyond `radius` of this centre. */
        area: AreaSchema,
        /**
         * Which NPCs are targets. "area" (default): only those inside `area`. "visible": the nearest free reachable
         * matching NPC anywhere in view, for targets that roam, flee or teleport (imps); `area` then only anchors the
         * run: the bot walks back to it when no target is in view (and no wanted loot lies near). Loot is picked up
         * wherever it lies near the bot. Free targets, and loot, within WILDERNESS_MARGIN tiles of the Wilderness are never taken (an attacker is still fought).
         */
        targetRange: z.enum(['area', 'visible']).default('area'),
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
        /**
         * Only attack NPCs of this exact combat level, for NPCs that share a name across levels (the Monks of
         * Zamorak are 17, 22 and 30; only the level-30 one drops the Golden key). An NPC already attacking the
         * bot is fought whatever its level, as the server refuses any other attack while one is on the bot.
         */
        level: z.number().int().min(1).optional(),
        /** Only attack NPCs of at least / at most this combat level (`level` as a range). */
        minLevel: z.number().int().min(1).optional(),
        maxLevel: z.number().int().min(1).optional(),
        /**
         * End the run `done` as soon as a quest dialog opens, leaving it open for the next phase (Sir Mordred's
         * death opens Morgan Le Faye's choice, which the shared dialog guard would answer "No. He deserves to
         * die."). The dialog guard is off for the run, so level-up dialogs are clicked away by the task itself.
         */
        stopOnDialog: z.boolean().default(false),
        /**
         * How long to keep waiting for a target to appear (a single imp or boss respawns in 50-100 ticks) before
         * failing "no free reachable ...". Default 0: the usual 20 looks, about 60 ticks. Capped at MAX_RESPAWN_WAIT_TICKS.
         */
        respawnWaitTicks: z.number().int().min(0).max(MAX_RESPAWN_WAIT_TICKS).default(0),
        /**
         * Prayers to hold on for the fight, by name ("Protect from Melee"): turned on once a target is picked (before the
         * attack), back off when the run ends (only those it turned on). The run fails when the prayer points run out.
         */
        prayers: z
            .array(
                z
                    .string()
                    .trim()
                    .refine(n => prayerIndex(n) !== undefined, { message: 'not a prayer name' }),
            )
            .superRefine((names, c) => {
                // Each of a group switches the others off, so the prayer-on step would turn them on in turn for ever.
                for (const group of PRAYER_CONFLICTS) {
                    const held = names.filter(n => group.includes(prayerIndex(n) ?? -1));
                    if (new Set(held.map(n => prayerIndex(n))).size > 1)
                        c.addIssue({ code: 'custom', message: `prayers switch each other off: ${held.join(', ')}` });
                }
            })
            .default([]),
    })
    .refine(p => p.minLevel === undefined || p.maxLevel === undefined || p.minLevel <= p.maxLevel, {
        message: 'minLevel is above maxLevel',
        path: ['minLevel'],
    })
    .refine(p => p.level === undefined || (p.minLevel === undefined && p.maxLevel === undefined), {
        message: '`level` cannot be combined with minLevel / maxLevel',
        path: ['level'],
    });

type CombatParams = z.infer<typeof Params>;
interface CombatMemory {
    /** Idle ticks and the ones with a target in view outside the area (diagnostic, lib/area-watch.ts). */
    areaWatch: AreaWatch;
    /** The tick the fight being waited out was first seen, until the bot is out of combat. */
    fightStartedAtTick: number | null;
    /** The tick a fight was first seen with no ammo left (Ranged), or null while ammo remains. */
    noAmmoSinceTick: number | null;
    /** Ground items (`lootKey`) a pickup failed on, with the tick they are skippable until. */
    lootSkipped: Map<string, number>;
    /** The NPC the Magic step is casting at, and the casts so far. */
    castTarget: { index: number; casts: number } | null;
    /** An attack or cast has been sent this run (or a fight was found on): a dialog after that may be the fight's. */
    fought: boolean;
    /** The tick a level-up page was last clicked: its unlock page ("You can now wield Steel Weaponry!") follows. */
    levelUpClickedAtTick: number | null;
    /** The prayers this run turned on, which `onEnd` turns off again (a prayer already on at the start is not ours). */
    prayersTurnedOn: string[];
}
type Ctx = TaskContext<CombatParams, CombatMemory>;

/** The bones `buryBones` picks up and buries: what F2P monsters drop (big bones from giants, bat bones from bats). */
const BONE_NAMES = ['Bones', 'Big bones', 'Bat bones', 'Wolf bones'];
const BURY_OPTION = /^bury$/i;
const isBones = (i: { name: string }) => BONE_NAMES.some(n => exactName(n).test(i.name));
const countBones = (s: BotWorldState) => s.inventory.filter(isBones).length;

/**
 * The bot has a target and is fighting it. `combat.inCombat` alone stays true for about 20 ticks after the
 * kill (the combat timer, with `targetIndex` already -1): waiting for it to clear idles through the ticks the
 * next attack could use, and holds loot back. The target is what the next step needs.
 */
const fighting = (s: BotWorldState) => !!s.player?.combat.inCombat && s.player.combat.targetIndex >= 0;

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

/** The NPC's combat level passes the `level` / `minLevel` / `maxLevel` filter. */
const levelWanted = (npc: NearbyNpc, p: CombatParams) =>
    (p.level === undefined || npc.combatLevel === p.level) &&
    (p.minLevel === undefined || npc.combatLevel >= p.minLevel) &&
    (p.maxLevel === undefined || npc.combatLevel <= p.maxLevel);

/** The target as the filter names it, for messages: `Monk of Zamorak (level 30)`. */
function targetLabel(p: CombatParams): string {
    const range =
        p.level !== undefined
            ? `level ${p.level}`
            : p.minLevel !== undefined || p.maxLevel !== undefined
              ? `level ${p.minLevel ?? 1}-${p.maxLevel ?? '+'}`
              : '';
    return range ? `${p.target} (${range})` : p.target;
}

/** The configured prayers that are off. */
const prayersOff = (s: BotWorldState, p: CombatParams) => p.prayers.filter(n => !prayerActive(s, prayerIndex(n) ?? -1));

const notContinue = (x: string) => x !== '' && !/^click here to continue$/i.test(x.trim());
/**
 * A dialog's text for a log or a reason: what the NPC says, or the choices on offer. The "Click here to
 * continue" button label is dropped: the speaker and the line sit in `allComponents` beside it.
 */
const dialogText = (s: BotWorldState) => {
    const choices = s.dialog.options.map(o => o.text).filter(notContinue);
    const shown = choices.length > 0 ? choices : (s.dialog.allComponents ?? []).map(c => c.text);
    const parts = [...new Set([s.dialog.text ?? '', ...shown].filter(notContinue))];
    return (parts.length > 0 ? parts.join(' | ') : s.dialog.options.map(o => o.text).join(' | ')).slice(0, 80);
};
/** What the dialog shows, to tell that a click moved it to another page. */
const dialogPage = (s: BotWorldState) =>
    JSON.stringify([
        s.dialog.pageId,
        s.dialog.text,
        s.dialog.options.map(o => o.text),
        s.dialog.allComponents?.map(c => c.text),
    ]);
/**
 * A dialog `stopOnDialog` leaves for the next phase: open, and neither a level-up box nor (`unlock`) the unlock page
 * after one's click. The step passes whether it is within UNLOCK_PAGE_TICKS of its click; the engine's hook has no
 * click memory and takes any unlock-looking page as one, the safe side (an eat may then close it).
 */
const keptDialog = (s: BotWorldState, unlock: boolean) => s.dialog.isOpen && !isLevelUp(s) && !unlock;
/** How long after a level-up click an unlock page still counts as part of it. */
const UNLOCK_PAGE_TICKS = LEVEL_UP_WAIT_TICKS + 2;

/** `visible` mode only (Wilderness coordinates apply on the surface, hence `level === 0`): the point is on the surface within WILDERNESS_MARGIN of the Wilderness, where the bot must not go. */
const nearWilderness = (state: BotWorldState, p: CombatParams, at: { x: number; z: number }) =>
    p.targetRange === 'visible' && state.player?.level === 0 && squareReachesWilderness(at.x, at.z, WILDERNESS_MARGIN);

/** A target or loot at `at` is allowed by the range mode: inside the area, or (visible) anywhere safe in view. */
const inRange = (state: BotWorldState, p: CombatParams, at: { x: number; z: number }) =>
    p.targetRange === 'visible' ? !nearWilderness(state, p, at) : inArea(p.area, at);

const lootKey = (i: { id: number; x: number; z: number }) => `${i.id}@${i.x},${i.z}`;

/** Reachable wanted ground items near the fight spot, nearest first. */
function wantedGroundItems(ctx: Ctx) {
    const names = ctx.params.buryBones ? [...ctx.params.loot, ...BONE_NAMES] : ctx.params.loot;
    if (names.length === 0 || ctx.inventoryFull()) return [];
    return ctx
        .state()
        .groundItems.filter(i => names.some(n => exactName(n).test(i.name)))
        .filter(i => i.reachable !== false && i.distance <= LOOT_RADIUS && inRange(ctx.state(), ctx.params, i))
        .filter(i => (ctx.memory.lootSkipped.get(lootKey(i)) ?? -Infinity) <= ctx.state().tick)
        .sort((a, b) => a.distance - b.distance);
}

/** A matching NPC the bot may attack now, wherever it stands: free, reachable, attackable, of a level the task wants. */
const freeTarget = (n: BotWorldState['nearbyNpcs'][number], p: CombatParams) =>
    matches(n, p) &&
    n.reachable !== false &&
    !n.inCombat &&
    levelWanted(n, p) &&
    n.options.some(o => ATTACK_OPTION.test(o));

/**
 * Diagnostic only: the nearest free in-limit target in view outside the area, for the idle count. Nothing in
 * `visible` mode (it takes those) and nothing within WILDERNESS_MARGIN of the Wilderness (never taken).
 */
function outsideTarget(state: BotWorldState, p: CombatParams): Sighting | undefined {
    if (p.targetRange !== 'area') return undefined;
    const limit = levelLimit(state, p);
    return outsideSighting(state, p.area, state.nearbyNpcs, n => freeTarget(n, p) && n.combatLevel <= limit);
}

/**
 * The in-limit target: first a matching NPC that is already fighting the bot (the server refuses an attack on
 * any other NPC while one is on the bot, "I'm already under attack!", and the bot would repeat it until the
 * attacker died to its auto-retaliate), else the nearest free one, or else a free matching NPC that is too strong.
 */
function pickTarget(state: BotWorldState, p: CombatParams) {
    const limit = levelLimit(state, p);
    // `attackers` cannot tell the bot's attacker from an NPC fighting another player; a recent hit on the bot can,
    // and so can having no listed player (Elvarg faces the bot long before its first hit; a player the client does
    // not list cannot be seen, so this is a heuristic). Whatever the hit, an NPC facing a listed player, or one a
    // listed player targets, is that player's fight.
    const mine = recentlyHit(state) || state.nearbyPlayers.length === 0;
    const othersFight = (n: BotWorldState['nearbyNpcs'][number]) =>
        state.nearbyPlayers.some(
            pl =>
                n.targetIndex - PLAYER_TARGET_OFFSET === pl.index ||
                (pl.combatTargetType === 'npc' && pl.combatTargetIndex === n.index),
        );
    const attacker = (mine ? attackers(state) : []).find(
        n =>
            !othersFight(n) &&
            matches(n, p) &&
            n.reachable !== false &&
            n.combatLevel <= limit &&
            n.options.some(o => ATTACK_OPTION.test(o)),
    );
    if (attacker) return { target: attacker, tooStrong: undefined, limit };
    const candidates = state.nearbyNpcs.filter(n => freeTarget(n, p) && inRange(state, p, n));
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
    ctx.memory.fought = true;
    const { stopOnDialog } = ctx.params;
    const w = yield* wait(
        'kill',
        s => !fighting(s) || wantsToEat(s, ctx.params) || (stopOnDialog && s.dialog.isOpen),
        FIGHT_SLICE_TICKS,
    );
    // The fight being timed is over; a later fight starts a fresh clock.
    if (!fighting(w.state)) ctx.memory.fightStartedAtTick = null;
    // The fight's end (Sir Mordred's scripted death) reaches the bot a tick or so before the dialog it opens; an attack
    // sent in that gap closes the dialog before the plan's `talk` can answer it. Give the dialog a moment to show.
    if (stopOnDialog && !fighting(w.state) && !w.state.dialog.isOpen)
        yield* wait('dialog after the fight', st => st.dialog.isOpen, DIALOG_LAG_TICKS);
}

/** bot.attack's walk to a far NPC, then the attack op; a failed walk reads as upstream's out-of-reach. */
function* walkAndAttack(ctx: Ctx, npc: NearbyNpc): Op<{ ok: true } | { ok: false; message: string }> {
    if (npc.distance > ATTACK_WALK_BEYOND) {
        const walked = yield* walkTo(ctx, npc.x, npc.z, ATTACK_WALK_BEYOND, { reserveTicks: AFTER_WALK_TICKS });
        if (!walked.ok) return { ok: false, message: `Cannot reach ${npc.name}: ${walked.message}` };
    }
    ctx.memory.fought = true;
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
    const lookLimit = Math.max(NO_TARGET_LIMIT, Math.ceil(ctx.params.respawnWaitTicks / NO_TARGET_WAIT_TICKS));
    if (noTarget.add() >= lookLimit)
        return {
            outcome: {
                fail: `no free reachable ${targetLabel(ctx.params)} ${ctx.params.targetRange === 'visible' ? 'in view' : 'in the area'}`,
            },
        };
    yield* trackIdle(ctx, ctx.memory.areaWatch, s => outsideTarget(s, ctx.params), ticks(NO_TARGET_WAIT_TICKS));
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

/**
 * Combat may start in a fight (arriving at aggressive hill giants, an attack mid-plan, a mining phase swarmed in a
 * dungeon) when something faces the bot and at least one such attacker is a target of this task, or every one is
 * winnable (its level no higher than the bot's). Fighting is this task's purpose, and the plan has no other way
 * out: eat/interact tasks are refused under attack. Low HP does not refuse: the low-HP guard eats during the run.
 * An unknown attacker (a hit with none next to the bot) keeps the engine's refusal. The pick step fights the
 * attacker first.
 */
export function startsInCombat(p: CombatParams, state: BotWorldState): boolean {
    const foes = attackers(state);
    const me = state.player;
    if (!me || foes.length === 0) return false;
    return foes.some(n => matches(n, p)) || foes.every(n => n.combatLevel <= me.combatLevel);
}

const returnToAreaBase = returnToAreaStep<CombatParams>(params => params.area);
/**
 * The walk back to the area. In `visible` mode the bot may have chased targets out of it: it keeps going
 * after what it sees (a target, or loot to pick up) and walks back only when there is none.
 */
const returnToArea: Step<CombatParams, CombatMemory> = {
    ...returnToAreaBase,
    when: (ctx: Ctx) =>
        returnToAreaBase.when(ctx) &&
        (ctx.params.targetRange === 'area' ||
            (!fighting(ctx.state()) &&
                attackers(ctx.state()).length === 0 &&
                !pickTarget(ctx.state(), ctx.params).target &&
                wantedGroundItems(ctx).length === 0)),
};

export default defineTask({
    name: 'combat',
    description:
        `Train a combat skill on one kind of NPC inside an area (starts even while under attack when an attacker is a target or all attackers are weaker than the bot; the low-HP guard eats during the run), or with \`targetRange: "visible"\` on any matching NPC in view (imps and other roamers; \`area\` then only anchors the run; the bot walks back to it only when no target or loot is in view). Targets and loot within ${WILDERNESS_MARGIN} tiles of the Wilderness are never taken. Wields the given weapon/shield, sets the attack ` +
        'style for `skill` (Attack/Strength/Defence/Ranged), attacks the nearest reachable matching NPC that is not ' +
        'fighting someone else, waits for the kill, repeats. Ranged: `weapon` is a bow and `ammo` its arrows (wielded; ' +
        'fails "out of <ammo>" when none are left; list the arrow in `loot` to pick fallen ones up and re-wield them). ' +
        'Magic: casts `spell` (free-to-play Strike/Bolt/Blast, e.g. "Wind Strike", 1 Mind + 1 Air rune per cast) at ' +
        "each target with runes from the inventory (a worn Staff of <element> replaces just that element's rune); fails when runes run out or the " +
        'Magic level is too low. Optional food (eaten below `eatBelow`), bone burying (Bones, Big bones, Bat bones, Wolf bones) and a loot list; an NPC already attacking the bot is fought first. ' +
        'Refuses areas reaching the Wilderness and NPCs more than `maxLevelGap` (default 5) levels above the bot. ' +
        'The engine waits out low HP when there is no food, so without food it refuses NPCs above combat level 5. ' +
        'Weapon/shield need the bot to meet their wield requirement. `level` (or `minLevel`/`maxLevel`) attacks only NPCs ' +
        'of that combat level (Monk of Zamorak: 17, 22, 30 share a name); `prayers` (e.g. ["Protect from Melee"]) are ' +
        'turned on once a target is picked (before the attack) and, those this run turned on, off when the run ends, failing when the prayer points run out; ' +
        "`respawnWaitTicks` (default 0 = about 60 ticks) keeps waiting for a lone target to respawn; `stopOnDialog` ends the run `done` the moment a dialog opens (Sir Mordred's death opens Morgan Le Faye's " +
        'choice) and leaves it open (prayers it turned on stay on, named in the reason), with the dialog guard off, for a following `talk`; the open dialog is also kept from the low-HP eat and the end-of-run settle and eat (above the HP floor, the larger of 8 and a quarter of max HP); a dialog open before any fight fails the run. Spots: Lumbridge chickens (3231,3295, ' +
        'radius 8; fenced coop with a gate; verified); Lumbridge cows (3253,3290, radius 12; south gate at ' +
        '3253,3266; unverified).',
    params: Params,
    diagnostics: ctx => areaWatchReport(ctx.memory.areaWatch, ctx.params.area),
    memory: (): CombatMemory => ({
        areaWatch: newAreaWatch(),
        fightStartedAtTick: null,
        noAmmoSinceTick: null,
        lootSkipped: new Map(),
        castTarget: null,
        fought: false,
        levelUpClickedAtTick: null,
        prayersTurnedOn: [],
    }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
    startInCombat: startsInCombat,
    // The dialog is kept open past the end of the run, so neither the low-hp eat nor the engine's fight settle and
    // eat before leaving may close it (the engine only holds above its HP floor).
    holdsDialog: (p, s) => p.stopOnDialog && keptDialog(s, isUnlockPage(s)),
    // With `stopOnDialog` the run ends when a dialog opens and leaves it for the next phase: the shared dialog
    // guard would click through it or answer a choice with its decline pattern ("No. He deserves to die.").
    allowGuards: p => (p.stopOnDialog ? ['dialog'] : []),

    /**
     * The prayers this run turned on, off again, whatever ended the run (done, a stop, a failure); the points
     * drain while one is on. Not with `stopOnDialog`'s quest dialog open: every prayer click starts with
     * `if_close`, which would close the dialog left for the next phase (the prayers are named in its reason).
     * Without `stopOnDialog` no dialog is the run's to keep, so the click may close whatever is open.
     */
    *onEnd(ctx) {
        const s = ctx.state();
        const on = ctx.memory.prayersTurnedOn.filter(n => prayerActive(s, prayerIndex(n) ?? -1));
        if (on.length === 0) return;
        const clicked = ctx.memory.levelUpClickedAtTick;
        const unlock = clicked !== null && s.tick - clicked <= UNLOCK_PAGE_TICKS && isUnlockPage(s);
        if (ctx.params.stopOnDialog && keptDialog(s, unlock)) {
            yield* log(`dialog open, leaving prayers on: ${on.join(', ')}`);
            return;
        }
        for (const name of on) {
            const r = yield* setPrayer(ctx, name, false);
            if (!r.ok) yield* log(`could not turn ${name} off: ${r.message}`);
        }
    },

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
        for (const name of p.prayers) {
            const i = prayerIndex(name) ?? 0;
            if (s.prayers.prayerLevel < (PRAYER_LEVELS[i] ?? 1))
                return `${name} needs Prayer ${PRAYER_LEVELS[i]}, the bot has ${s.prayers.prayerLevel}`;
        }
        if (p.prayers.length > 0 && s.prayers.prayerPoints <= 0) return 'no prayer points left for prayers';
        const seen = s.nearbyNpcs.filter(n => matches(n, p) && levelWanted(n, p));
        const lowest = Math.min(...seen.map(n => n.combatLevel));
        const limit = levelLimit(s, p);
        if (seen.length > 0 && lowest > limit)
            return `${targetLabel(p)} is level ${lowest}, above the limit ${limit} (combat ${s.player.combatLevel} + ${p.maxLevelGap}${foodInInventory(s, p) ? '' : `, capped at ${NO_FOOD_MAX_NPC_LEVEL} without food`})`;
        return refuseArea(p.area);
    },

    steps: [
        {
            name: 'dialog-open',
            when: ctx => ctx.params.stopOnDialog && ctx.state().dialog.isOpen,
            *run(ctx) {
                const s = ctx.state();
                const levelUpFails = ctx.streak('levelUpFails');
                // A level-up lands mid-fight like any other fight's; it is not what the plan waits for. Nor is
                // the unlock page that follows its click.
                const clicked = ctx.memory.levelUpClickedAtTick;
                const unlock = clicked !== null && s.tick - clicked <= UNLOCK_PAGE_TICKS && isUnlockPage(s);
                if (keptDialog(s, unlock)) {
                    if (!ctx.memory.fought) return { fail: `dialog open before any fight: ${dialogText(s)}` };
                    const left = ctx.memory.prayersTurnedOn.filter(n => prayerActive(s, prayerIndex(n) ?? -1));
                    return {
                        done: `dialog opened: ${dialogText(s)}${left.length ? `; prayers still on: ${left.join(', ')}` : ''}`,
                    };
                }
                // One page at a time, not `dismiss`: the last hit's level-up can sit in front of the quest
                // dialog, and clicking on past its pages would answer or skip the very dialog left open.
                const page = dialogPage(s);
                const sent = yield* send({
                    type: 'clickDialogOption',
                    optionIndex: s.dialog.options[0]?.index ?? 0,
                    reason: 'continue level-up dialog',
                });
                // A click the client rejects usually met a dialog that had just closed under a stale state: look again.
                const moved = sent.success
                    ? yield* wait(
                          'level-up page',
                          st => !st.dialog.isOpen || dialogPage(st) !== page,
                          LEVEL_UP_WAIT_TICKS,
                      )
                    : null;
                if (moved?.kind === 'met') {
                    ctx.memory.levelUpClickedAtTick = s.tick;
                    levelUpFails.reset();
                    return;
                }
                if (levelUpFails.add() >= LEVEL_UP_FAIL_LIMIT)
                    return { fail: `level-up dialog would not clear${sent.success ? '' : `: ${sent.message}`}` };
                yield* ticks(1);
            },
        },
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
        returnToArea,
        {
            name: 'out-of-prayer',
            // An empty prayer tab mid-fight leaves the bot unprotected: end the run, not the fight.
            when: ctx => ctx.params.prayers.length > 0 && ctx.state().prayers.prayerPoints <= 0,
            run: () => ({ fail: 'out of prayer points' }),
        },
        {
            name: 'prayer-on',
            // On once a target is picked (before the fight step walks to it and attacks) or a fight is on.
            when: ctx => {
                const s = ctx.state();
                const p = ctx.params;
                if (prayersOff(s, p).length === 0) return false;
                return fighting(s) || attackers(s).length > 0 || !!pickTarget(s, p).target;
            },
            *run(ctx) {
                const prayerFails = ctx.streak('prayerFails');
                for (const name of prayersOff(ctx.state(), ctx.params)) {
                    const r = yield* setPrayer(ctx, name, true);
                    if (r.ok) {
                        prayerFails.reset();
                        if (!ctx.memory.prayersTurnedOn.includes(name)) ctx.memory.prayersTurnedOn.push(name);
                        yield* log(`prayer ${name} on`);
                        continue;
                    }
                    if (r.reason === 'no-points') return { fail: 'out of prayer points' };
                    if (r.reason === 'level') return { fail: r.message };
                    if (prayerFails.add() >= PRAYER_FAIL_LIMIT)
                        return { fail: `could not turn ${name} on: ${r.message}` };
                }
            },
        },
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
            // Never walk off to loot while fighting, or while another NPC is attacking the bot.
            when: ctx =>
                !fighting(ctx.state()) && attackers(ctx.state()).length === 0 && wantedGroundItems(ctx).length > 0,
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
                ctx.memory.fought = true;
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
                if (fighting(state)) return yield* waitForKill(ctx);
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
