// Guards every task runs under, so no task has to handle death, low HP, the Wilderness or blocking
// dialogs itself. The engine checks them at every tick of a generator step's waits and between
// steps for every task; a task opts out of one with `allow`.
import type { BotActions } from '../../sdk/actions';
import type { BotWorldState } from '../../sdk/types';
import type { GuardOutcome } from '../core/interpret';
import { call, log, type Op, ticks } from '../core/op';
import { isInWilderness } from './area';
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
/** Ticks of regeneration waiting per low-HP episode (~5 minutes at 0.6s per tick) before giving up. */
const REGEN_CAP_TICKS = 500;
/** Handler runs a dialog may stay open through within one episode before the run gives up. */
const DIALOG_STUCK_LIMIT = 5;

export type GuardName = 'death' | 'wilderness' | 'low-hp' | 'dialog';

/** What a guard knows of the run besides the state it is checking. */
export interface GuardRun {
    /** Game tick the run started at; messages from earlier ticks are not this run's. */
    readonly startTick: number;
    /** Where the bot stood at the start of the previous loop; null without a player. */
    readonly previousPos: { x: number; z: number } | null;
    /** For the legacy actions the guards still call (eating, dismissing dialogs). */
    readonly bot: BotActions;
}

/**
 * A guard over a run. Its episode lasts from when `when` first holds until the engine next checks it
 * and finds it false; `run` gets that episode's state, so its limits bound one episode, not the run.
 */
export interface TaskGuard<E extends object = object> {
    name: GuardName;
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
export const guardLabel = (name: GuardName) => `interrupt:${name}`;

/** An inventory item with an Eat option; Drink items are not food for `bot.eatFood`. */
export const findFood = (state: BotWorldState): InventoryItem | undefined =>
    state.inventory.find(i => i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));

const noEpisode = () => ({});

/** Ends the run if the bot died since the task started. */
export const deathGuard: TaskGuard = {
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
export const wildernessGuard: TaskGuard = {
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
export const lowHpGuard: TaskGuard<LowHpEpisode> = {
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
        const r = yield* call('bot.eatFood', () => run.bot.eatFood(food));
        yield* log(`low hp: ${where}: ${r.message}`);
        if (!r.success) return { fail: `${where}: could not eat ${food.name}: ${r.message}` };
    },
};

/**
 * Clears level-up and other "click to continue" dialogs. BotActions methods do this themselves;
 * this covers tasks that use raw sdk.send* calls. A task that drives dialogs on purpose sets
 * `allow: ['dialog']`.
 */
export const dialogGuard: TaskGuard<{ stuckRuns: number }> = {
    name: 'dialog',
    policy: 'suspend',
    episode: () => ({ stuckRuns: 0 }),
    when: s => s.dialog.isOpen,
    *run(_fired, run, episode) {
        yield* call('bot.dismissBlockingUI', () => run.bot.dismissBlockingUI());
        const { dialog } = yield* ticks(0);
        if (!dialog.isOpen) return;
        // dismissBlockingUI leaves multi-option dialogs alone and returns at once; wait a tick so the
        // loop yields, and give up if nothing else closes it.
        yield* ticks(1);
        if (++episode.stuckRuns > DIALOG_STUCK_LIMIT)
            return { fail: `dialog stuck open: ${dialog.options.map(o => o.text).join(' | ')}` };
    },
};

/** Priority order: the first whose `when` holds fires. */
export const GUARDS: readonly TaskGuard[] = [deathGuard, wildernessGuard, lowHpGuard, dialogGuard];
