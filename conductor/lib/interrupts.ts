// Guards every task runs under, so no task has to handle death, low HP, the Wilderness, blocking
// dialogs or leftover modals itself. The engine checks them at every tick of a generator step's waits
// and between steps for every task; a task opts out of one with `allow`, and adds its own with `guards`.
import type { BotWorldState } from '../../sdk/types';
import { ATTACK_OPTION } from '../actions/attack';
import type { ActionContext } from '../actions/context';
import { clearStrayChoice, closableInterface, dismiss, isSkillMenu } from '../actions/dismiss';
import { EAT_ATTEMPT_TICKS, eat } from '../actions/eat';
import type { GuardOutcome } from '../core/interpret';
import { log, type Op, ticks } from '../core/op';
import { isInWilderness } from './wilderness';
import { isLowHp } from './threat';

type InventoryItem = BotWorldState['inventory'][number];

/** GameMessage.type for system/game messages (sdk/types.ts). */
const GAME_MESSAGE_SYSTEM = 0;
const DEATH = /oh dear,? you are dead/i;
/** How many of the latest game messages go into a death reason. */
const DEATH_REASON_MESSAGES = 3;

/** Eats (or failed eats) within one low-HP episode before the run gives up. */
const MAX_EATS_PER_EPISODE = 8;
/** Eats re-sent within one low-HP episode after the server ignored one while the player was held. */
const MAX_HELD_RETRIES = 3;
/** Eats re-sent within one low-HP episode when an eat under fire showed no effect (the server's 2-tick eat delay); not counted against MAX_EATS_PER_EPISODE. */
const MAX_FIRE_RETRIES = 3;
/** Ticks the guard waits for a hold (obstacle script, forced walk) to end before it re-sends the eat. */
const HOLD_WAIT_TICKS = 20;
/** Ticks waited per slice while regenerating HP with nothing to eat. */
const REGEN_SLICE_TICKS = 5;
/** Ticks of regeneration waiting per low-HP episode before giving up. */
const REGEN_CAP_TICKS = 500;
/** The run fails on the dialog guard's Nth run within one episode that does not clear the dialog. */
const DIALOG_STUCK_LIMIT = 6;
/** Ticks one fight with an attacker the state does not name may last while the bot waits for auto-retaliate. */
const UNKNOWN_ATTACKER_TICK_LIMIT = 40;
/** The unknown-attacker wait fails once the bot lost this much hp. */
const UNKNOWN_ATTACKER_HP_LOSS = 3;
/** A named fight fails when neither the bot's hp nor the attacker's health percent changed for this many ticks. */
const NO_PROGRESS_TICKS = 60;
/** A hit this many ticks old still counts as an ongoing attack. */
const RECENT_HIT_TICKS = 10;
/** An NPC farther than this (tiles) is not the one fighting the bot. */
const ATTACKER_REACH = 2;
/** The client packs a player as an NPC's target (faceEntity) as index + 32768. */
export const PLAYER_TARGET_OFFSET = 32768;
/** The run fails on the interface guard's Nth close within one episode that leaves the interface open. */
const INTERFACE_STUCK_LIMIT = 3;

/** The shared guards (GUARDS); a task's own guards take other names. */
export type GuardName = 'death' | 'wilderness' | 'low-hp' | 'dialog' | 'interface';
/** The guards a task may turn off: death and the Wilderness protect the account and are always on. */
export type AllowableGuard = Exclude<GuardName, 'death' | 'wilderness'>;

/** What a guard knows of the run besides the state it is checking; its ops read the latest state through it. */
export interface GuardRun extends ActionContext {
    /** Game tick the run started at; messages from earlier ticks are not this run's. */
    readonly startTick: number;
    /** Where the bot stood at the start of the previous loop; null without a player. */
    readonly previousPos: { x: number; z: number } | null;
}

/**
 * A guard over a run. Its episode lasts from when `when` first holds until the engine next checks it
 * and finds it false; `run` gets that episode's state, so its limits bound one episode, not the run.
 */
export interface TaskGuard<E extends object = object, N extends string = string> {
    /** Unique among a run's guards; logs, step counts and fail reasons show it as `guardLabel(name)`. */
    name: N;
    /** `abort` cancels the running step and then runs; `suspend` runs inside the wait, which carries on. */
    policy: 'abort' | 'suspend';
    /** Also fires inside `uninterruptible` sections. */
    critical?: boolean;
    /** Fresh state for a new episode. */
    episode(): E;
    /** Pure: the engine calls it often, several times a tick inside waits. */
    when(state: BotWorldState, run: GuardRun): boolean;
    /** Given the state it fired on; returns the outcome directly when nothing needs doing in game. */
    run(state: BotWorldState, run: GuardRun, episode: E): GuardOutcome | Op<GuardOutcome>;
}

/** The name a guard has in logs, step counts and failure reasons. */
export const guardLabel = (name: string) => `interrupt:${name}`;

/** An inventory item with an Eat option; Drink items are not food here. */
export const isFood = (item: InventoryItem): boolean => item.optionsWithIndex.some(o => /^eat$/i.test(o.text));
/** Food items held: every item with an Eat option, counting stacks. */
export const foodCount = (state: BotWorldState): number =>
    state.inventory.filter(isFood).reduce((n, i) => n + i.count, 0);
export const findFood = (state: BotWorldState): InventoryItem | undefined => state.inventory.find(isFood);

const noEpisode = () => ({});

/** Ends the run if the bot died since the task started. */
export const deathGuard: TaskGuard<object, GuardName> = {
    name: 'death',
    policy: 'abort',
    critical: true,
    episode: noEpisode,
    when: (s, run) =>
        s.gameMessages.some(m => m.tick >= run.startTick && m.type === GAME_MESSAGE_SYSTEM && DEATH.test(m.text)),
    run: (s, run) => {
        const p = s.player;
        const recent = s.gameMessages
            .filter(m => m.tick >= run.startTick)
            .slice(-DEATH_REASON_MESSAGES)
            .map(m => m.text);
        const from = run.previousPos ? `died near (${run.previousPos.x},${run.previousPos.z}), ` : 'died, ';
        return { fail: `${from}respawned at (${p?.worldX},${p?.worldZ}); last messages: ${recent.join(' | ')}` };
    },
};

/** Ends the run if the bot is in the Wilderness, on the surface or in the Edgeville dungeon (PvP, death drops items). */
export const wildernessGuard: TaskGuard<object, GuardName> = {
    name: 'wilderness',
    policy: 'abort',
    critical: true,
    episode: noEpisode,
    when: s => !!s.player && isInWilderness(s.player.level, s.player.worldX, s.player.worldZ),
    run: s => ({ fail: `in the Wilderness at (${s.player?.worldX},${s.player?.worldZ})` }),
};

/** The bot is in combat or took a hit lately: resting for HP here would not be quiet. */
export function underFire(s: BotWorldState): boolean {
    return !!s.player?.combat.inCombat || recentlyHit(s);
}

type Player = NonNullable<BotWorldState['player']>;

/** The player animates, or moved since `before`: a movement script may be holding it. */
function wasHeld(before: Player | null | undefined, now: Player | null | undefined): boolean {
    if (!now) return false;
    if (now.animId !== -1) return true;
    return !!before && (before.worldX !== now.worldX || before.worldZ !== now.worldZ);
}

/**
 * Waits until the player stands still and idle for a tick, at most HOLD_WAIT_TICKS; stops at once if
 * the bot comes under fire, where waiting only costs HP. Returns whether the hold ended.
 */
function* waitHoldEnd(): Op<boolean> {
    let last = yield* ticks(0);
    for (let i = 0; i < HOLD_WAIT_TICKS; i++) {
        const s = yield* ticks(1);
        if (underFire(s)) return false;
        const a = last.player;
        const b = s.player;
        if (b && b.animId === -1 && a && a.worldX === b.worldX && a.worldZ === b.worldZ) return true;
        last = s;
    }
    return false;
}

/** HP is under the eat line; the line rises with attackers only while the bot is under fire (an NPC fighting someone else beside it must not raise it). */
function lowForAttackers(s: BotWorldState): boolean {
    return isLowHp(s, underFire(s) ? attackers(s).length : 0);
}

interface LowHpEpisode {
    /** HP when the guard last ran, to tell whether the bot is still losing HP. */
    lastHp: number | null;
    eats: number;
    regenTicks: number;
}

/**
 * Eats when HP is low. With nothing to eat it fails the run if the bot is in combat or still losing
 * HP, and otherwise waits for HP to regenerate.
 */
export const lowHpGuard: TaskGuard<LowHpEpisode, GuardName> = {
    name: 'low-hp',
    policy: 'abort',
    episode: () => ({ lastHp: null, eats: 0, regenTicks: 0 }),
    when: s => lowForAttackers(s),
    *run(_fired, run, episode) {
        // The aborted step's cleanup may have taken ticks since the guard fired: decide on the state now.
        const s = yield* ticks(0);
        if (!lowForAttackers(s)) return;
        const p = s.player;
        const where = `hp ${p?.hp}/${p?.maxHp} at (${p?.worldX},${p?.worldZ})`;
        const hpFell = episode.lastHp !== null && !!p && p.hp < episode.lastHp;
        episode.lastHp = p?.hp ?? null;

        const food = findFood(s);
        if (!food) {
            if (p?.combat.inCombat || hpFell) return { fail: `${where}, no food` };
            episode.regenTicks += REGEN_SLICE_TICKS;
            if (episode.regenTicks > REGEN_CAP_TICKS)
                return { fail: `${where} not regenerating after ${REGEN_CAP_TICKS} ticks` };
            yield* ticks(REGEN_SLICE_TICKS);
            return;
        }
        if (++episode.eats > MAX_EATS_PER_EPISODE) return { fail: `${where} after ${MAX_EATS_PER_EPISODE} eats` };
        let eaten = food;
        let from = p;
        // Under fire a dead 13-tick wait is the worst case: try short and send again (an eat within 2 ticks of the last is ignored).
        const fire = underFire(s);
        const maxTries = fire ? MAX_FIRE_RETRIES : 0;
        let r = yield* eat(run, food, fire ? EAT_ATTEMPT_TICKS : undefined);
        for (let tries = 0; !r.ok && r.reason === 'timeout' && tries < maxTries; tries++) {
            const now = run.state();
            const f = findFood(now);
            if (!f || !lowForAttackers(now)) break;
            eaten = f;
            r = yield* eat(run, f, EAT_ATTEMPT_TICKS);
        }
        // The server ignores an eat while a movement script holds the player (an agility obstacle): when
        // the eat showed no effect and the player moved or animated during that attempt, wait the hold
        // out and retry. Never under fire: a fight animates the player, and waiting there only costs HP.
        // These retries are bounded by MAX_HELD_RETRIES, apart from MAX_EATS_PER_EPISODE.
        let retries = 0;
        for (; !r.ok && r.reason === 'timeout' && retries < MAX_HELD_RETRIES; retries++) {
            const now = run.state();
            if (!lowForAttackers(now) || underFire(now) || !wasHeld(from, now.player)) break;
            const f = findFood(now);
            if (!f) break;
            yield* log(`low hp: eat ignored while held at (${now.player?.worldX},${now.player?.worldZ}); waiting`);
            const ended = yield* waitHoldEnd();
            yield* log(`low hp: hold ${ended ? 'ended' : 'still going'}; eating again (retry ${retries + 1})`);
            eaten = f;
            from = run.state().player;
            r = yield* eat(run, f);
        }
        if (!r.ok) {
            const after = retries > 0 ? ` (after ${retries} held retries)` : '';
            return { fail: `${where}: could not eat ${eaten.name}: ${r.message}${after}` };
        }
        yield* log(`low hp: ${where}: ate ${eaten.name}, +${r.hpGained} hp`);
    },
};

/**
 * Clears level-up and other "click to continue" dialogs. Most BotActions methods do this themselves
 * (dismissBlockingUI); ops send raw, so this guard does, through the dismiss op. It answers no
 * choice itself (one nobody answers after DIALOG_STUCK_LIMIT runs is declined or closed, clearStrayChoice), and does not fire on a skill make menu, which the op that opened it answers. A task that
 * drives dialogs on purpose sets `allow: ['dialog']`.
 */
export const dialogGuard: TaskGuard<{ stuckRuns: number }, GuardName> = {
    name: 'dialog',
    policy: 'suspend',
    episode: () => ({ stuckRuns: 0 }),
    when: s => s.dialog.isOpen && !isSkillMenu(s.dialog),
    *run(_fired, run, episode) {
        const r = yield* dismiss(run, { modals: false });
        if (r.ok) return;
        // A choice is left alone (and a refused send waits for nothing): wait a tick so the loop
        // yields; a stray one is cleared once the stuck limit is reached.
        if (r.reason !== 'stuck') yield* ticks(1);
        // The op's own message: a fresh state's options are empty once the dialog has closed, and only the
        // message tells a choice from a stuck page or a refused send.
        if (++episode.stuckRuns < DIALOG_STUCK_LIMIT) return;
        // A choice no step answered in that long is a stray one (a dialog an earlier run opened and left): decline
        // it or close it (never an option that pays or accepts), and carry on.
        if (r.reason === 'choice') {
            yield* log(`dialog guard: nobody answered a choice (${r.message}): declining or closing it`);
            const cleared = yield* clearStrayChoice(run);
            if (cleared.ok) {
                episode.stuckRuns = 0;
                return;
            }
        }
        return { fail: `dialog stuck open: ${r.message}` };
    },
};

/**
 * Closes a leftover informational modal: while a main modal is open the server runs no loc or NPC
 * interaction (Player.tryInteract needs canAccess), so every chop would time out. Most BotActions
 * methods close these first (dismissBlockingUI); ops send raw, so this guard does, through the dismiss
 * op. A task that opens one on purpose sets `allow: ['interface']`.
 */
export const interfaceGuard: TaskGuard<{ stuckCloses: number }, GuardName> = {
    name: 'interface',
    policy: 'suspend',
    episode: () => ({ stuckCloses: 0 }),
    when: closableInterface,
    *run(fired, run, episode) {
        const id = fired.interface.interfaceId;
        const r = yield* dismiss(run, { dialogs: false });
        if (r.ok) return;
        // A refused close waited for nothing: wait a tick so the loop yields.
        if (r.reason !== 'stuck') yield* ticks(1);
        if (++episode.stuckCloses >= INTERFACE_STUCK_LIMIT)
            return { fail: `interface ${id} stuck open after ${INTERFACE_STUCK_LIMIT} closes: ${r.message}` };
    },
};

/** Priority order: the first whose `when` holds fires. */
export const GUARDS: readonly TaskGuard<object, GuardName>[] = [
    deathGuard,
    wildernessGuard,
    lowHpGuard,
    dialogGuard,
    interfaceGuard,
];

/**
 * The NPCs that may be fighting the bot: within melee-ish reach and facing a player (the client packs
 * a player target as index + 32768). An NPC the bot only faces, such as a fishing spot or a pickpocket
 * victim, is never in this list. The bot's own index is not published and an NPC's `inCombat` is true
 * whenever it has any face target, so an NPC within reach facing another player (one fighting someone
 * else) cannot be told from the real attacker: it is treated as the attacker.
 */
export function attackers(s: BotWorldState): BotWorldState['nearbyNpcs'] {
    return s.nearbyNpcs.filter(n => n.targetIndex >= PLAYER_TARGET_OFFSET && n.distance <= ATTACKER_REACH);
}

/** The highest combat level among `npcs`, or undefined with none. */
function strongest(npcs: BotWorldState['nearbyNpcs']): BotWorldState['nearbyNpcs'][number] | undefined {
    return [...npcs].sort((a, b) => b.combatLevel - a.combatLevel)[0];
}

const dialogWords = (s: BotWorldState) =>
    [s.dialog.text ?? '', ...(s.dialog.allComponents ?? []).map(c => c.text)].join(' ');
/** The level-up box (levelup.dbrow: "Congratulations, you just advanced an attack level."): not a quest dialog. */
export const isLevelUp = (s: BotWorldState) => /you just advanced an? \w+ level/i.test(dialogWords(s));
/**
 * The page a level-up opens after its click (levelup_unlocks_*.rs2 objbox: "You can now wield Steel Weaponry!",
 * "Members can now cook ...", "You are now qualified to enter ..."). The words alone also fit other text, so a
 * caller with a click to anchor on takes it as one only right after that click.
 */
export const isUnlockPage = (s: BotWorldState) => /\b(can|are) now\b/i.test(dialogWords(s));

/** Took a hit (a 0 splat counts) within RECENT_HIT_TICKS. */
export const recentlyHit = (s: BotWorldState): boolean => {
    const at = s.player?.combat.lastDamageTick ?? -1;
    return at >= 0 && s.tick - at <= RECENT_HIT_TICKS;
};

/** In combat, and something attacks the bot: an attacker next to it, or a hit taken lately. */
export const isAttacked = (s: BotWorldState): boolean =>
    !!s.player?.combat.inCombat && (attackers(s).length > 0 || recentlyHit(s));

/**
 * In combat with an NPC the bot targets, whether or not it hits back: the target is in view, alive and
 * attackable. A fishing spot has no Attack option. The client publishes a target only while hits on the bot
 * or on it back the facing, or within a walk-up grace, so a target the bot only faced drops out by itself (after ~16 ticks, `FACING_GRACE_CYCLES` = 500 cycles).
 */
export const ownFight = (s: BotWorldState): boolean => {
    const c = s.player?.combat;
    if (!c?.inCombat || c.targetType !== 'npc') return false;
    const target = s.nearbyNpcs.find(n => n.index === c.targetIndex);
    return !!target && target.healthPercent !== 0 && target.options.some(o => ATTACK_OPTION.test(o));
};

interface UnderAttackEpisode {
    /** The bot's highest hp this episode: the baseline for the unknown-attacker hp-loss check. */
    startHp: number | null;
    /** The tick the current run of consecutive unnamed-attacker ticks began; null while a foe is named. */
    unknownSince: number | null;
    /**
     * What was last seen and the tick any of it last changed, across named/unnamed flips: the bot's hp,
     * the named foe's healthPercent (kept while no foe is named) and lastDamageTick (a 0 splat; it counts
     * as progress only while a foe is named, as an unnamed attacker's hits must not extend its 40 ticks).
     */
    last: { hp: number; foePercent: number | null; damageTick: number; tick: number } | null;
}

/**
 * For a skilling task whose interaction (a chop, a mine, a fish) would cancel auto-retaliate: while
 * something attacks the bot it touches nothing and lets auto-retaliate finish the fight.
 *
 * "Attacked" (`isAttacked`) is not `combat.inCombat` alone: that is also true for the client's walk-up
 * grace after the bot merely faces an attackable NPC (a man it pickpockets or talks to). An NPC with no
 * Attack option, such as a fishing spot, is never published as a target. It needs an attacker next to
 * the bot, or a hit taken within RECENT_HIT_TICKS, on top of inCombat.
 *
 * A named attacker is waited out with no total tick cap, when winnable: auto-retaliate on and the
 * attacker's combat level no higher than the bot's; otherwise the run fails at once, naming it. The
 * wait is bounded by progress instead: it fails when neither the bot's hp nor the attacker's health
 * percent changed for NO_PROGRESS_TICKS. Low HP is not handled here: the shared low-HP guard runs
 * before task guards and eats, or fails with no food in combat, so this guard never sees it.
 * When the attacker cannot be told from state (a hit with no attacker next to the bot: a player, a
 * ranged attacker) the fight is waited out for at most UNKNOWN_ATTACKER_TICK_LIMIT consecutive such ticks (a tick naming a foe restarts the count), and fails at
 * once if the bot lost UNKNOWN_ATTACKER_HP_LOSS hp meanwhile.
 * Not in GUARDS: a task opts in with `guards: [underAttackGuard]`.
 */
export const underAttackGuard: TaskGuard<UnderAttackEpisode> = {
    name: 'under-attack',
    policy: 'abort',
    episode: () => ({ startHp: null, unknownSince: null, last: null }),
    when: isAttacked,
    *run(_fired, _run, episode) {
        // The aborted step's cleanup may have taken ticks since the guard fired: decide on the state now.
        const s = yield* ticks(0);
        const p = s.player;
        if (!p || !isAttacked(s)) return;
        const foe = strongest(attackers(s));
        const who = foe ? `${foe.name} (level ${foe.combatLevel})` : 'an unknown attacker';
        const at = `(${p.worldX},${p.worldZ})`;
        if (s.autoRetaliateEnabled === false) return { fail: `attacked by ${who} with auto-retaliate off at ${at}` };
        if (foe && foe.combatLevel > p.combatLevel)
            return { fail: `attacked by ${who}, above the bot's combat level ${p.combatLevel}, at ${at}` };
        const damageTick = p.combat.lastDamageTick;
        const prev = episode.last;
        const changed =
            !prev ||
            prev.hp !== p.hp ||
            (foe !== undefined && (prev.foePercent !== foe.healthPercent || prev.damageTick !== damageTick));
        const last = changed
            ? { hp: p.hp, foePercent: foe ? foe.healthPercent : (prev?.foePercent ?? null), damageTick, tick: s.tick }
            : { ...prev, damageTick, foePercent: foe ? foe.healthPercent : prev.foePercent };
        episode.last = last;
        episode.startHp = Math.max(episode.startHp ?? p.hp, p.hp);
        const stalled = s.tick - last.tick;
        episode.unknownSince = foe ? null : (episode.unknownSince ?? s.tick);
        if (foe) {
            if (stalled >= NO_PROGRESS_TICKS)
                return { fail: `fight with ${who} not finished: no hp change for ${NO_PROGRESS_TICKS} ticks at ${at}` };
        } else {
            if (episode.startHp - p.hp >= UNKNOWN_ATTACKER_HP_LOSS)
                return { fail: `attacked by ${who} at ${at}: hp ${p.hp}/${p.maxHp}, down from ${episode.startHp}` };
            if (s.tick - (episode.unknownSince ?? s.tick) >= UNKNOWN_ATTACKER_TICK_LIMIT)
                return { fail: `under attack by ${who} for ${UNKNOWN_ATTACKER_TICK_LIMIT} ticks at ${at}` };
        }
        yield* ticks(1);
    },
};
