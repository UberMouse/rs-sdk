// Steps put in front of every task's own steps, so no task has to handle death,
// low HP, the Wilderness or blocking dialogs itself.
import type { BotWorldState } from '../../sdk/types';
import { isInWilderness } from './area';
import type { Step } from './task';
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
/** Loops a dialog may stay open after dismissal attempts before the run gives up. */
const DIALOG_STUCK_LIMIT = 5;

/** An inventory item with an Eat option; Drink items are not food for `bot.eatFood`. */
export const findFood = (state: BotWorldState): InventoryItem | undefined =>
    state.inventory.find(i => i.optionsWithIndex.some(o => /^eat$/i.test(o.text)));

/** Ends the run if the bot died since the task started. */
export const deathCheck: Step = {
    name: 'interrupt:death',
    when: ctx =>
        ctx
            .state()
            .gameMessages.some(m => m.tick >= ctx.startTick && m.type === GAME_MESSAGE_SYSTEM && DEATH.test(m.text)),
    run: async ctx => {
        const s = ctx.state();
        const p = s.player;
        const recent = s.gameMessages
            .filter(m => m.tick >= ctx.startTick)
            .slice(-DEATH_REASON_MESSAGES)
            .map(m => m.text);
        const from = ctx.previousPos ? `died near (${ctx.previousPos.x},${ctx.previousPos.z}), ` : 'died, ';
        return { fail: `${from}respawned at (${p?.worldX},${p?.worldZ}); last messages: ${recent.join(' | ')}` };
    },
};

/** Ends the run if the bot is on the surface in the Wilderness (PvP, death drops items). */
export const wildernessCheck: Step = {
    name: 'interrupt:wilderness',
    when: ctx => {
        const p = ctx.state().player;
        return !!p && isInWilderness(p.level, p.worldX, p.worldZ);
    },
    run: async ctx => {
        const p = ctx.state().player;
        return { fail: `in the Wilderness at (${p?.worldX},${p?.worldZ})` };
    },
};

/**
 * Eats when HP is low. With nothing to eat it fails the run if the bot is in combat
 * or still losing HP, and otherwise waits for HP to regenerate. The counters reset in
 * `when` as soon as HP is healthy again, so they bound one low-HP episode rather than the whole run.
 */
export const lowHpCheck: Step = {
    name: 'interrupt:low-hp',
    when: ctx => {
        const low = isLowHp(ctx.state());
        if (!low) {
            ctx.counter('lowHpEats').reset();
            ctx.counter('lowHpRegenTicks').reset();
            ctx.memory.lowHpLast = undefined;
        }
        return low;
    },
    run: async ctx => {
        const s = ctx.state();
        const p = s.player;
        const where = `hp ${p?.hp}/${p?.maxHp} at (${p?.worldX},${p?.worldZ})`;
        const last = ctx.memory.lowHpLast;
        const hpFell = typeof last === 'number' && !!p && p.hp < last;
        ctx.memory.lowHpLast = p?.hp;

        const food = findFood(s);
        if (!food) {
            if (p?.combat.inCombat || hpFell) return { fail: `${where}, no food` };
            const waited = ctx.counter('lowHpRegenTicks').add(REGEN_SLICE_TICKS);
            if (waited > REGEN_CAP_TICKS) return { fail: `${where} not regenerating after ${REGEN_CAP_TICKS} ticks` };
            await ctx.sdk.waitForTicks(REGEN_SLICE_TICKS);
            return;
        }
        const eats = ctx.counter('lowHpEats').add();
        if (eats > MAX_EATS_PER_EPISODE) return { fail: `${where} after ${MAX_EATS_PER_EPISODE} eats` };
        const r = await ctx.bot.eatFood(food);
        ctx.log(`low hp: ${where}: ${r.message}`);
        if (!r.success) return { fail: `${where}: could not eat ${food.name}: ${r.message}` };
    },
};

/**
 * Clears level-up and other "click to continue" dialogs. BotActions methods do
 * this themselves; this covers tasks that use raw sdk.send* calls. Tasks that
 * drive dialogs on purpose set `ctx.memory.expectDialog = true`.
 */
export const dismissDialog: Step = {
    name: 'interrupt:dialog',
    when: ctx => {
        const open = ctx.state().dialog.isOpen;
        if (!open) ctx.counter('dialogStuckRuns').reset();
        return !ctx.memory.expectDialog && open;
    },
    run: async ctx => {
        await ctx.bot.dismissBlockingUI();
        const dialog = ctx.state().dialog;
        if (!dialog.isOpen) return;
        // dismissBlockingUI leaves multi-option dialogs alone and returns at once; wait a tick
        // so the loop yields, and give up if nothing else closes it.
        await ctx.sdk.waitForTicks(1);
        const stuck = ctx.counter('dialogStuckRuns').add();
        if (stuck > DIALOG_STUCK_LIMIT)
            return { fail: `dialog stuck open: ${dialog.options.map(o => o.text).join(' | ')}` };
    },
};

export const INTERRUPTS: Step[] = [deathCheck, wildernessCheck, lowHpCheck, dismissDialog];
