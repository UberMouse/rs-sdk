// Guards every task runs under, so no task has to handle death, low HP, the Wilderness, blocking
// dialogs or leftover modals itself. The engine checks them at every tick of a generator step's waits
// and between steps for every task; a task opts out of one with `allow`, and adds its own with `guards`.
import type { BotWorldState } from '../../sdk/types';
import type { ActionContext } from '../actions/context';
import { closableInterface, dismiss, isSkillMenu } from '../actions/dismiss';
import { eat } from '../actions/eat';
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
/** Ticks waited per slice while regenerating HP with nothing to eat. */
const REGEN_SLICE_TICKS = 5;
/** Ticks of regeneration waiting per low-HP episode before giving up. */
const REGEN_CAP_TICKS = 500;
/** The run fails on the dialog guard's Nth run within one episode that does not clear the dialog. */
const DIALOG_STUCK_LIMIT = 6;
/** Ticks one fight may last while the bot only waits for auto-retaliate to win it. */
const COMBAT_TICK_LIMIT = 40;
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
export const findFood = (state: BotWorldState): InventoryItem | undefined =>
    state.inventory.find(i => i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));

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

/** Ends the run if the bot is on the surface in the Wilderness (PvP, death drops items). */
export const wildernessGuard: TaskGuard<object, GuardName> = {
    name: 'wilderness',
    policy: 'abort',
    critical: true,
    episode: noEpisode,
    when: s => !!s.player && isInWilderness(s.player.level, s.player.worldX, s.player.worldZ),
    run: s => ({ fail: `in the Wilderness at (${s.player?.worldX},${s.player?.worldZ})` }),
};

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
    when: s => isLowHp(s),
    *run(_fired, run, episode) {
        // The aborted step's cleanup may have taken ticks since the guard fired: decide on the state now.
        const s = yield* ticks(0);
        if (!isLowHp(s)) return;
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
        const r = yield* eat(run, food);
        if (!r.ok) return { fail: `${where}: could not eat ${food.name}: ${r.message}` };
        yield* log(`low hp: ${where}: ate ${food.name}, +${r.hpGained} hp`);
    },
};

/**
 * Clears level-up and other "click to continue" dialogs. Most BotActions methods do this themselves
 * (dismissBlockingUI); ops send raw, so this guard does, through the dismiss op. It never answers a
 * choice, and does not fire on a skill make menu, which the op that opened it answers. A task that
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
        // yields, and give up if nothing else closes it.
        if (r.reason !== 'stuck') yield* ticks(1);
        // The op's own message: a fresh state's options are empty once the dialog has closed, and only the
        // message tells a choice from a stuck page or a refused send.
        if (++episode.stuckRuns >= DIALOG_STUCK_LIMIT) return { fail: `dialog stuck open: ${r.message}` };
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
 * For a skilling task whose interaction (a chop, a mine) would cancel auto-retaliate: while something
 * fights the bot, it touches nothing and lets auto-retaliate win. It fails at once when auto-retaliate
 * is off, and when one fight lasts COMBAT_TICK_LIMIT ticks. Not in GUARDS: a task opts in with
 * `guards: [underAttackGuard]`.
 */
export const underAttackGuard: TaskGuard<{ since: number | null }> = {
    name: 'under-attack',
    policy: 'abort',
    episode: () => ({ since: null }),
    when: s => !!s.player?.combat.inCombat,
    *run(_fired, _run, episode) {
        // The aborted step's cleanup may have taken ticks since the guard fired: decide on the state now.
        const s = yield* ticks(0);
        const p = s.player;
        if (!p?.combat.inCombat) return;
        const at = `(${p.worldX},${p.worldZ})`;
        if (s.autoRetaliateEnabled === false) return { fail: `attacked with auto-retaliate off at ${at}` };
        episode.since ??= s.tick;
        if (s.tick - episode.since >= COMBAT_TICK_LIMIT)
            return { fail: `under attack for ${COMBAT_TICK_LIMIT} ticks at ${at}` };
        yield* ticks(1);
    },
};
