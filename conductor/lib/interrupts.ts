// Steps put in front of every task's own steps, so no task has to remember
// them (ArteDungeon listed MenuFailSafe first for the same reason).
import type { Step } from './task';

const DEATH = /oh dear, you are dead/i;

/** Ends the run if the bot died since the task started. */
export const deathCheck: Step = {
    name: 'interrupt:death',
    when: ctx => {
        const since = ctx.memory.__startTick as number;
        return ctx.state().gameMessages.some(m => m.tick >= since && m.type === 0 && DEATH.test(m.text));
    },
    run: async () => ({ fail: 'died' }),
};

/**
 * Clears level-up and other "click to continue" dialogs. BotActions methods do
 * this themselves; this covers tasks that use raw sdk.send* calls. Tasks that
 * drive dialogs on purpose set `ctx.memory.expectDialog = true`.
 */
export const dismissDialog: Step = {
    name: 'interrupt:dialog',
    when: ctx => !ctx.memory.expectDialog && ctx.state().dialog.isOpen,
    run: async ctx => {
        await ctx.bot.dismissBlockingUI();
    },
};

export const INTERRUPTS: Step<any>[] = [deathCheck, dismissDialog];
