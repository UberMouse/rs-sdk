import { z } from 'zod/v4';
import { type BotWorldState, type NearbyNpc, PRAYER_LEVELS } from '../../sdk/types';
import { ATTACK_OPTION, ATTACK_WAIT_TICKS, attack } from '../actions/attack';
import { CAST_DELAY_TICKS, CAST_WAIT_TICKS, cast } from '../actions/cast';
import { EAT_WAIT_TICKS } from '../actions/eat';
import { EQUIP_WAIT_TICKS, equip } from '../actions/equip';
import { PRAYER_WAIT_TICKS, prayerActive, prayerConflict, prayerIndex, setPrayer } from '../actions/prayer';
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
import { AreaSchema, inArea, refuseArea, returnToAreaStep, WALK_TO_AREA_SILENT_TICKS } from '../lib/area';
import { attackers, isLevelUp, isUnlockPage, PLAYER_TARGET_OFFSET, recentlyHit } from '../lib/interrupts';
import { squareReachesWilderness } from '../lib/wilderness';
import { HOLD_HP_FLOOR_FRACTION, HOLD_HP_FLOOR_MIN } from '../lib/engine';
import { LOW_HP_MAX_FRACTION, lowHpFraction } from '../lib/threat';
import { COMBAT_SPELL_NAMES, COMBAT_SPELLS, STAFF_RUNES } from '../lib/spells';
import { defineTask, type Outcome, type Step, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill, TICK_MS } from '../lib/util';
import { MAX_XP } from '../lib/xp';
import { failStreak } from '../lib/streak';
import { eatStep, foodInInventory, wantsToEat } from '../lib/eat-step';

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
const EAT_FAIL_LIMIT = 3;
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
/** One failed attack: a walk to a far NPC that never moves the bot, then the attack's send, wait and retry wait. */
const ATTACK_FAILS = failStreak({
    name: 'attackFails',
    limit: ATTACK_FAIL_LIMIT,
    worstTicks: WALK_MAX_TICKS + AFTER_WALK_TICKS,
    what: 'attacks',
});
/** One failed eat: its wait (EAT_WAIT_TICKS). */
const EAT_FAILS = failStreak({ name: 'eatFails', limit: EAT_FAIL_LIMIT, worstTicks: EAT_WAIT_TICKS });
/** One failed cast: the cast's wait and the retry tick. */
const CAST_FAILS = failStreak({
    name: 'castFails',
    limit: CAST_FAIL_LIMIT,
    worstTicks: CAST_WAIT_TICKS + 1,
    what: 'casts',
});
/** One unanswered level-up click: its send, the wait for the next page and the retry tick. */
const LEVEL_UP_FAILS = failStreak({
    name: 'levelUpFails',
    limit: LEVEL_UP_FAIL_LIMIT,
    worstTicks: SEND_TICKS + LEVEL_UP_WAIT_TICKS + 1,
});
/** One failed equip: the wait for the item to show as worn (EQUIP_WAIT_TICKS). */
const EQUIP_FAILS = failStreak({ name: 'equipFails', limit: EQUIP_FAIL_LIMIT, worstTicks: EQUIP_WAIT_TICKS });
/** One failed style try: the wait for the style list, or a send and the wait for the combat tab to show the style. */
const STYLE_FAILS = failStreak({
    name: 'styleFails',
    limit: STYLE_FAIL_LIMIT,
    worstTicks: Math.max(STYLE_LIST_WAIT_TICKS, SEND_TICKS + STYLE_WAIT_TICKS),
});
/** One failed prayer click: the wait for the prayer to show as on (PRAYER_WAIT_TICKS). */
const PRAYER_FAILS = failStreak({ name: 'prayerFails', limit: PRAYER_FAIL_LIMIT, worstTicks: PRAYER_WAIT_TICKS });
/** One failed bury: its send and the wait for a bone to leave the inventory. */
const BURY_FAILS = failStreak({ name: 'buryFails', limit: BURY_FAIL_LIMIT, worstTicks: SEND_TICKS + BURY_WAIT_TICKS });
/**
 * The watchdog waits for the longest of the specific failures, so each can report its reason:
 * the fight and loot give-ups, the walks back to the area, the wait for a respawn, the eat step's failed eats
 * (each waiting out EAT_WAIT_TICKS) and each fail streak. The send tick of the cast, equip and prayer streaks is
 * inside the window's margin.
 */
const SILENT = [
    FIGHT_GIVE_UP_TICKS,
    MAX_RESPAWN_WAIT_TICKS + NO_TARGET_WAIT_TICKS,
    LOOT_GIVE_UP_TICKS,
    WALK_TO_AREA_SILENT_TICKS,
    EAT_FAILS,
    ATTACK_FAILS,
    CAST_FAILS,
    LEVEL_UP_FAILS,
    EQUIP_FAILS,
    STYLE_FAILS,
    PRAYER_FAILS,
    BURY_FAILS,
];
/** Ground items further than this are not worth leaving the fight spot for. */
const LOOT_RADIUS = 6;
/** Ticks the dialog may trail the end of the fight that opens it (the client's state packets and the interface update are separate). */
const DIALOG_LAG_TICKS = 3;
const STEP_TIMEOUT_MS = 300_000;
/** Without food, preflight refuses NPCs above this combat level (chickens are 1, cows 2). */
const NO_FOOD_MAX_NPC_LEVEL = 5;

/**
 * The bones `buryBones` picks up and buries: the `bones` category items monsters drop that the bury script accepts
 * (skill_prayer/configs/bones.obj, scripts/bury_bone.rs2). The burnt and pasted quest bones are left out.
 */
const BONE_NAMES = [
    'Bones',
    'Big bones',
    'Bat bones',
    'Wolf bones',
    'Babydragon bones',
    'Dragon bones',
    'Jogre bones',
    'Shaikahan bones',
];

const Params = z
    .object({
        target: z
            .string()
            .trim()
            .min(1)
            .describe('The NPC to fight, by exact name (case-insensitive, not a regex), e.g. "Chicken", "Cow".'),
        skill: z
            .enum(SKILLS)
            .default('Attack')
            .describe('The skill to train. Attack, Strength and Defence pick the melee style that trains it.'),
        allowMaxed: z
            .boolean()
            .optional()
            .describe('Train `skill` even at level 99 (otherwise refused; Magic is never refused).'),
        area: AreaSchema.describe(
            'Where to fight: the bot never wanders beyond `radius` of this centre, and walks back to it when away.',
        ),
        targetRange: z
            .enum(['area', 'visible'])
            .default('area')
            .describe(
                'Which NPCs are targets. "area": only those inside `area`. "visible": the nearest free reachable matching NPC ' +
                    'anywhere in view, for targets that roam, flee or teleport (imps); `area` then only anchors the run: the ' +
                    'bot walks back to it only when no target is in view and no wanted loot lies near. Loot is picked up ' +
                    'wherever it lies near the bot.',
            ),
        weapon: z
            .string()
            .trim()
            .optional()
            .describe('An item to wield if not already worn, by exact name (e.g. "Bronze sword"); a bow for Ranged.'),
        shield: z
            .string()
            .trim()
            .optional()
            .describe('A shield to wield if not already worn, by exact name; it adds defence for the fight.'),
        ammo: z
            .string()
            .trim()
            .optional()
            .describe(
                'Ranged: the ammunition to wield, by exact name (e.g. "Bronze arrow"); list it in `loot` too to pick fallen ones up and re-wield them.',
            ),
        spell: z
            .enum(COMBAT_SPELL_NAMES)
            .optional()
            .describe(
                'Magic: the combat spell cast on each target, e.g. "Wind Strike"; its runes come from the inventory, and a ' +
                    'worn Staff of air, water, earth or fire covers only its own rune.',
            ),
        food: z
            .array(z.string().trim())
            .default([])
            .describe(
                `Food to eat when HP falls below \`eatBelow\`, by exact item name. The engine's low-HP guard, which eats or ends the run when HP is low, also eats any food carried below ${Math.round(lowHpFraction(1) * 100)}% of max HP, ${Math.round(lowHpFraction(2) * 100)}% with two attackers on the bot and ${Math.round(LOW_HP_MAX_FRACTION * 100)}% with three or more.`,
            ),
        eatBelow: z
            .number()
            .min(0.1)
            .max(0.9)
            .default(DEFAULT_EAT_BELOW)
            .describe(
                'The fraction of max HP to eat `food` below; needs `food` held, and with none the bot does not eat here.',
            ),
        buryBones: z
            .boolean()
            .default(false)
            .describe(`Bury bones for Prayer XP, picking them up too: ${BONE_NAMES.join(', ')}.`),
        loot: z
            .array(z.string().trim())
            .default([])
            .describe(
                'Ground items to pick up after a kill, by exact name (case-insensitive), e.g. ["Feather", "Cowhide"].',
            ),
        maxLevelGap: z
            .number()
            .min(0)
            .default(DEFAULT_MAX_LEVEL_GAP)
            .describe("Refuse (and never attack) NPCs with a combat level above the bot's combat level plus this."),
        level: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
                'Only attack NPCs of this exact combat level, for NPCs that share a name across levels (the Monks of ' +
                    'Zamorak are 17, 22 and 30; only the level-30 one drops the Golden key). An NPC already attacking the ' +
                    'bot is fought whatever its level, as the server refuses any other attack while one is on the bot.',
            ),
        minLevel: z.number().int().min(1).optional().describe('Only attack NPCs of at least this combat level.'),
        maxLevel: z.number().int().min(1).optional().describe('Only attack NPCs of at most this combat level.'),
        stopOnDialog: z
            .boolean()
            .default(false)
            .describe(
                'End the run `done` the moment a quest dialog opens, leaving it open for a following `talk` (Sir ' +
                    "Mordred's death opens Morgan Le Faye's choice, which the engine's dialog guard would answer \"No. He " +
                    'deserves to die."). The guard is off for the run, so the task clicks level-up dialogs away itself. ' +
                    `While the dialog is open the engine holds it while HP is above the larger of ${HOLD_HP_FLOOR_MIN} HP and ` +
                    `${Math.round(HOLD_HP_FLOOR_FRACTION * 100)}% of max HP (rounded up) and eats at or below it; a dialog open before any fight fails the run.`,
            ),
        respawnWaitTicks: z
            .number()
            .int()
            .min(0)
            .max(MAX_RESPAWN_WAIT_TICKS)
            .default(0)
            .describe(
                'How long to keep waiting for a target to appear (a single imp or boss respawns in 50-100 ticks) before ' +
                    `failing "no free reachable ...". The default wait is ${NO_TARGET_LIMIT} looks, about ` +
                    `${NO_TARGET_LIMIT * NO_TARGET_WAIT_TICKS} ticks; a value under that changes nothing.`,
            ),
        prayers: z
            .array(
                z
                    .string()
                    .trim()
                    .refine(n => prayerIndex(n) !== undefined, { message: 'not a prayer name' }),
            )
            .superRefine((names, c) => {
                // Each of a group switches the others off, so the prayer-on step would turn them on in turn for ever.
                const conflict = prayerConflict(names);
                if (conflict) c.addIssue({ code: 'custom', message: conflict });
            })
            .default([])
            .describe(
                'Prayers to hold on for the fight, by whole name, case-insensitive, not a regex (e.g. ["Protect from ' +
                    'Melee"]); prayers that switch each other off cannot be named together. Turned on once a target is ' +
                    'picked (before the attack); those this run turned on go off when it ends. The run fails when the ' +
                    'prayer points run out.',
            ),
        keepPrayersOn: z
            .boolean()
            .default(false)
            .describe(
                "Leave the prayers this run turned on when it ends, for a plan's following non-combat phases (walk, pick " +
                    'up, climb) in a hostile area; they drain the points until the `prayer` task turns them off. They also ' +
                    "stay on when `stopOnDialog`'s kept dialog is still open at the end (a prayer click would close it), and the " +
                    "run's `done` reason then names them. A prayer " +
                    "an earlier phase kept on, or already on at the start, is not this run's: a later combat phase never " +
                    'turns it off, only the `prayer` task does.',
            ),
        endWhenPackFull: z
            .boolean()
            .default(false)
            .describe(
                'End the run `done` when `loot` (or `buryBones`) is set, a wanted ground item lies in reach and the pack is ' +
                    'full so it cannot be picked up, after any fight in progress ends: a plan then goes on to a bank phase. ' +
                    'Wanted loot includes bones when `buryBones` is set. Meant for non-stackable loot (herbs, hides, bones): ' +
                    'a full pack counts as blocking whatever the loot, even stackable loot already held (coins, runes, ' +
                    'feathers) that the game would still pick up. Off: combat goes on fighting with the loot left on the ground. ' +
                    '`fullPackTicks` in the diagnostics is approximate (ticks between looks that both saw the pack blocking loot).',
            ),
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
    /** The NPC the bot is fighting (the cast step's `engaged` is its own local), until the fight is seen to end (a kill when it is gone or at 0 HP). */
    fightTarget: { index: number; name: string } | null;
    /** Run totals for the RESULT's diagnostics. */
    kills: number;
    lootPicked: number;
    fullPackTicks: number;
    /** The tick the full-pack count was last brought up to date, or null when the pack was not blocking loot then. */
    fullPackNotedAt: number | null;
}
type Ctx = TaskContext<CombatParams, CombatMemory>;

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
    const limit = uncappedLimit(s, p);
    return foodInInventory(s, p) ? limit : Math.min(limit, NO_FOOD_MAX_NPC_LEVEL);
}

/** The level limit before the no-food cap: combat level + `maxLevelGap`. */
const uncappedLimit = (s: BotWorldState, p: CombatParams) => (s.player?.combatLevel ?? 0) + p.maxLevelGap;

/** True when the no-food cap, not combat level + `maxLevelGap`, is what holds the limit down. */
const cappedWithoutFood = (s: BotWorldState, p: CombatParams) =>
    !foodInInventory(s, p) && uncappedLimit(s, p) > NO_FOOD_MAX_NPC_LEVEL;

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

const lootNames = (p: CombatParams) => (p.buryBones ? [...p.loot, ...BONE_NAMES] : p.loot);

/** Reachable wanted ground items near the fight spot, nearest first (none while the pack is full). */
function wantedGroundItems(ctx: Ctx) {
    if (ctx.inventoryFull()) return [];
    return lootItems(ctx);
}

/** Wanted ground items in reach whatever the pack holds, nearest first. */
function lootItems(ctx: Ctx) {
    const names = lootNames(ctx.params);
    if (names.length === 0) return [];
    return ctx
        .state()
        .groundItems.filter(i => names.some(n => exactName(n).test(i.name)))
        .filter(i => i.reachable !== false && i.distance <= LOOT_RADIUS && inRange(ctx.state(), ctx.params, i))
        .filter(i => (ctx.memory.lootSkipped.get(lootKey(i)) ?? -Infinity) <= ctx.state().tick)
        .sort((a, b) => a.distance - b.distance);
}

/** Nothing is fighting the bot and it is fighting nothing: the moment to loot or to end for a full pack. */
const nothingFighting = (ctx: Ctx) => !fighting(ctx.state()) && attackers(ctx.state()).length === 0;

/** `loot` is set, a wanted item lies in reach and the pack is full: the pickup is skipped for want of a slot. */
const packBlocksLoot = (ctx: Ctx) => ctx.inventoryFull() && lootItems(ctx).length > 0;

/** Brings `fullPackTicks` up to date: the ticks since the last look that also found the pack blocking loot. */
function notePackFull(ctx: Ctx) {
    const now = ctx.state().tick;
    if (!packBlocksLoot(ctx)) {
        ctx.memory.fullPackNotedAt = null;
        return;
    }
    ctx.memory.fullPackTicks += now - (ctx.memory.fullPackNotedAt ?? now);
    ctx.memory.fullPackNotedAt = now;
}

/** The engaged NPC is gone from view, or still listed at 0 HP. */
const targetEnded = (state: BotWorldState, e: { index: number; name: string }) => {
    const npc = state.nearbyNpcs.find(n => n.index === e.index && n.name === e.name);
    return !npc || npc.hp === 0 || npc.healthPercent === 0;
};

/**
 * Counts the kill of the NPC the bot was fighting once it is gone or at 0 HP, and forgets it. Waits for the fight to
 * end unless `atEnd` (the run is over: `inCombat` outlasts a kill by ~20 ticks). An NPC still alive stays uncounted:
 * a fight that broke off is no kill. A guard can cut a wait short, so any step may be the first to see the end.
 */
function settleKill(ctx: Ctx, state: BotWorldState = ctx.state(), atEnd = false) {
    const e = ctx.memory.fightTarget;
    if (!e || (!atEnd && fighting(state)) || !targetEnded(state, e)) return;
    ctx.memory.kills++;
    ctx.memory.fightTarget = null;
}

/** Makes `next` the fight target, first settling the previous one: counted if gone or at 0 HP, else dropped. */
function setFightTarget(ctx: Ctx, state: BotWorldState, next: { index: number; name: string }) {
    const prev = ctx.memory.fightTarget;
    if (prev && prev.index !== next.index && targetEnded(state, prev)) ctx.memory.kills++;
    ctx.memory.fightTarget = { index: next.index, name: next.name };
}

/** Remembers the NPC the bot is fighting, for `settleKill`. */
function noteEngaged(ctx: Ctx, state: BotWorldState) {
    const p = state.player;
    if (!p || !fighting(state) || p.combat.targetType !== 'npc') return;
    if (ctx.memory.fightTarget?.index === p.combat.targetIndex) return;
    const npc = state.nearbyNpcs.find(n => n.index === p.combat.targetIndex);
    if (npc) setFightTarget(ctx, state, npc);
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
    noteEngaged(ctx, state);
    const { stopOnDialog } = ctx.params;
    const w = yield* wait(
        'kill',
        s => !fighting(s) || wantsToEat(s, ctx.params) || (stopOnDialog && s.dialog.isOpen),
        FIGHT_SLICE_TICKS,
    );
    // The fight being timed is over; a later fight starts a fresh clock.
    if (!fighting(w.state)) ctx.memory.fightStartedAtTick = null;
    settleKill(ctx, w.state);
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
    if (picked?.tooStrong) {
        const limitLabel = cappedWithoutFood(ctx.state(), ctx.params)
            ? `no-food limit ${picked.limit} (no food held; restock)`
            : `limit ${picked.limit}`;
        return {
            outcome: {
                fail: `${picked.tooStrong.name} is level ${picked.tooStrong.combatLevel}, above the ${limitLabel}`,
            },
        };
    }
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
        'Trains a combat skill by fighting one kind of NPC. It wields the given weapon and shield, sets the attack ' +
        'style for `skill`, attacks the nearest reachable matching NPC that is not fighting someone else, waits ' +
        'for the kill, and repeats; an NPC already attacking the bot is fought first. Starts even while under ' +
        'attack when an attacker is a target or all attackers are weaker than the bot. ' +
        `Targets and loot within ${WILDERNESS_MARGIN} tiles of the Wilderness are never taken (an attacker is still ` +
        'fought). Ranged fails "out of <ammo>" when none are left; Magic fails when runes run out or the Magic level ' +
        "is too low. The RESULT's diagnostics carry `kills` (targets seen dead or gone after a fight; an NPC that left " +
        'view counts too, a heuristic), `lootPicked` and `fullPackTicks`. Refuses an area reaching the Wilderness.',
    rules: [
        'Ranged needs `weapon` (a bow) and `ammo`; Magic needs `spell`, the Magic level for it and its runes.',
        `A cast of Wind Strike takes ${Object.entries(COMBAT_SPELLS['Wind Strike'].runes)
            .map(([rune, n]) => `${n} ${rune}`)
            .join(' and ')}.`,
        '`weapon`, `shield` and `ammo` must be worn or in the inventory, and the bot must meet their wield requirement.',
        "NPCs more than `maxLevelGap` levels above the bot's combat level are refused. The engine waits out low HP " +
            `when there is no food, so without food the task refuses NPCs above combat level ${NO_FOOD_MAX_NPC_LEVEL}.`,
        '`level` cannot be combined with `minLevel` / `maxLevel`, and `minLevel` must not be above `maxLevel`.',
        'Each of `prayers` needs its Prayer level, and the bot needs prayer points left to start.',
    ],
    spots: [
        'Lumbridge chickens: `area` {x:3231,z:3295,radius:8}; fenced coop with a gate; verified.',
        'Lumbridge cows: `area` {x:3253,z:3290,radius:12}; south gate at 3253,3266; unverified.',
    ],
    params: Params,
    diagnostics(ctx) {
        // The run can end on the tick the last kill lands, before any step settles it; settleKill is idempotent.
        settleKill(ctx, ctx.state(), true);
        const { kills, lootPicked, fullPackTicks } = ctx.memory;
        const area = areaWatchReport(ctx.memory.areaWatch, ctx.params.area);
        return { diagnostics: { ...area.diagnostics, kills, lootPicked, fullPackTicks }, warnings: area.warnings };
    },
    memory: (): CombatMemory => ({
        areaWatch: newAreaWatch(),
        fightStartedAtTick: null,
        noAmmoSinceTick: null,
        lootSkipped: new Map(),
        castTarget: null,
        fought: false,
        levelUpClickedAtTick: null,
        prayersTurnedOn: [],
        fightTarget: null,
        kills: 0,
        lootPicked: 0,
        fullPackTicks: 0,
        fullPackNotedAt: null,
    }),
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,
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
     * `keepPrayersOn` leaves them on whatever ended the run (the plan's explicit choice).
     */
    *onEnd(ctx) {
        const s = ctx.state();
        const on = ctx.memory.prayersTurnedOn.filter(n => prayerActive(s, prayerIndex(n) ?? -1));
        if (on.length === 0) return;
        if (ctx.params.keepPrayersOn) {
            yield* log(`keepPrayersOn: ${on.join(', ')} stays on, ${s.prayers.prayerPoints} points`);
            return;
        }
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
        if (p.skill !== 'Magic' && !p.allowMaxed) {
            const xp = findSkill(s, p.skill)?.experience ?? 0;
            if (xp >= MAX_XP) return `${p.skill} is level 99; pick an unmaxed skill (allowMaxed: true to override)`;
        }
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
                    LEVEL_UP_FAILS.clear(ctx);
                    return;
                }
                const failed = LEVEL_UP_FAILS.missWith(
                    ctx,
                    `level-up dialog would not clear${sent.success ? '' : `: ${sent.message}`}`,
                );
                if (failed) return failed;
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
                for (const n of [ctx.params.weapon, ctx.params.shield, ctx.params.ammo]) {
                    // Fresh state per item: equipping the weapon may have moved the shield's slot.
                    const s = ctx.state();
                    if (!n || (worn(s, n) && n !== ctx.params.ammo)) continue;
                    const item = s.inventory.find(i => exactName(n).test(i.name));
                    if (!item) continue;
                    const r = yield* equip(ctx, item);
                    if (r.ok) continue;
                    const failed = EQUIP_FAILS.missWith(ctx, `cannot equip ${n}: ${r.message}`);
                    if (failed) return failed;
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
                if (!style) {
                    if (cs?.known && cs.styles.length > 0)
                        return {
                            fail: `no combat style trains ${ctx.params.skill} with ${ctx.params.weapon ?? 'current weapon'}`,
                        };
                    // The client has not published a real style list yet (login, or lagging the equip step).
                    const failed = STYLE_FAILS.missWith(ctx, 'combat style list never loaded');
                    if (failed) return failed;
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
                } else {
                    return STYLE_FAILS.missWith(
                        ctx,
                        `could not set combat style ${style.name} for ${ctx.params.skill}`,
                    );
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
                for (const name of prayersOff(ctx.state(), ctx.params)) {
                    const r = yield* setPrayer(ctx, name, true);
                    if (r.ok) {
                        PRAYER_FAILS.clear(ctx);
                        if (!ctx.memory.prayersTurnedOn.includes(name)) ctx.memory.prayersTurnedOn.push(name);
                        yield* log(`prayer ${name} on`);
                        continue;
                    }
                    if (r.reason === 'no-points') return { fail: 'out of prayer points' };
                    if (r.reason === 'level') return { fail: r.message };
                    const failed = PRAYER_FAILS.missWith(ctx, `could not turn ${name} on: ${r.message}`);
                    if (failed) return failed;
                }
            },
        },
        eatStep<CombatParams, CombatMemory>({
            wants: wantsToEat,
            food: foodInInventory,
            streak: EAT_FAILS,
            failText: (food, r) => `could not eat ${food.name}: ${r.message}`,
        }),
        {
            name: 'bury-bones',
            when: ctx => ctx.params.buryBones && countBones(ctx.state()) > 0,
            *run(ctx) {
                const s = ctx.state();
                const bones = s.inventory.find(isBones);
                const opt = bones?.optionsWithIndex.find(o => BURY_OPTION.test(o.text));
                if (!bones || !opt) return { fail: 'bones have no Bury option' };
                const before = countBones(s);
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
                if (buried?.kind !== 'met') return BURY_FAILS.missWith(ctx, 'bones did not bury');
                BURY_FAILS.clear(ctx);
            },
        },
        {
            name: 'pack-full',
            // Loot in reach but no slot to take it: end for the plan's bank phase, once the fight is over.
            when: ctx => ctx.params.endWhenPackFull && nothingFighting(ctx) && packBlocksLoot(ctx),
            run(ctx) {
                const left = lootItems(ctx).length;
                settleKill(ctx);
                notePackFull(ctx);
                return { done: `pack full: ${left} wanted ground item(s) left, ${ctx.memory.kills} kills` };
            },
        },
        {
            name: 'loot',
            // Never walk off to loot while fighting, or while another NPC is attacking the bot.
            when: ctx => nothingFighting(ctx) && wantedGroundItems(ctx).length > 0,
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
                settleKill(ctx);
                const r = yield* pickup(ctx, item);
                if (r.ok) {
                    ctx.memory.lootPicked++;
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
                settleKill(ctx, state);
                notePackFull(ctx);
                forgetGoneCastTarget(ctx, state);
                // Keep casting at the NPC the bot is already fighting; else pick a free one.
                const engaged =
                    p.combat.targetType === 'npc'
                        ? state.nearbyNpcs.find(n => n.index === p.combat.targetIndex && matches(n, ctx.params))
                        : undefined;
                const chosen = yield* chooseTarget(ctx, engaged);
                if (!('target' in chosen)) return chosen.outcome;
                const { target } = chosen;
                setFightTarget(ctx, state, target);

                ctx.memory.fought = true;
                const r = yield* cast(ctx, target, COMBAT_SPELLS[name].component, name);
                if (r.ok) {
                    CAST_FAILS.clear(ctx);
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
                const failed = CAST_FAILS.miss(ctx, r.message);
                if (failed) return failed;
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
                settleKill(ctx, state);
                notePackFull(ctx);
                if (fighting(state)) return yield* waitForKill(ctx);
                ctx.memory.fightStartedAtTick = null;

                const chosen = yield* chooseTarget(ctx);
                if (!('target' in chosen)) return chosen.outcome;
                const { target } = chosen;

                const result = yield* walkAndAttack(ctx, target);
                if (result.ok) {
                    ATTACK_FAILS.clear(ctx);
                    return;
                }
                yield* log(`attack ${target.name} failed: ${result.message}`);
                const failed = ATTACK_FAILS.miss(ctx, result.message);
                if (failed) return failed;
                yield* ticks(ATTACK_RETRY_TICKS);
            },
        },
    ],
});
