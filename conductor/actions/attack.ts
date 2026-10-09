// Ported from sdk/actions.ts attack @ 4c2069cc0
// NPC targets only (attackNpcEntity); the PvP path is not ported. Unlike bot.attack it takes the NPC
// from the caller, does not walk to it first (a task that must walk through doors does so itself;
// the client's own pathing covers the last tiles), and drops upstream's coordinate sanity check. It
// leaves death to the death guard (upstream's `died` result) and level-up dialogs to the dialog guard,
// and decides on the state its wait ended on, so upstream's "no combat effect observed" race can't
// happen: a wait that ends with nothing to show is a timeout.
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { messageCursor, messageSince } from './messages';

/** bot.attack's default 5s wait for the fight to start or the server's refusal, in ticks. */
export const ATTACK_WAIT_TICKS = Math.ceil(5000 / TICK_MS);
/** The option that attacks an NPC. */
export const ATTACK_OPTION = /attack/i;

const CANT_REACH = /can't reach|cannot reach/i;
/**
 * Single-way combat refusals from player_combat.rs2 ("I'm already under attack!", "Someone else is
 * fighting that."): they clear on their own, a few ticks after the other fight's last hit.
 */
const ALREADY_FIGHTING = /already under attack|someone else is fighting|someone else is already fighting/i;

export type AttackResult =
    | { ok: true }
    | {
          ok: false;
          reason: 'no-option' | 'cant-reach' | 'already-in-combat' | 'target-gone' | 'send-failed' | 'timeout';
          message: string;
      };

/**
 * Attacks `npc` and waits until the fight with it has started: the bot targets it in combat, or a hit
 * on it lands. That evidence beats an already-fighting refusal that races it, as upstream. `cant-reach`
 * is the client finding no route (nothing sent) or the server's "I can't reach that!"; `already-in-combat` is a single-way
 * combat refusal (the NPC or the bot is fighting someone else); `target-gone` is the NPC leaving view
 * (killed by someone else, despawned) before the fight started.
 */
export function* attack(ctx: ActionContext, npc: NearbyNpc): Op<AttackResult> {
    const option = npc.optionsWithIndex.find(o => ATTACK_OPTION.test(o.text));
    if (!option) return { ok: false, reason: 'no-option', message: `No attack option on ${npc.name}` };
    const before = ctx.state();
    const cursor = messageCursor(before);
    const revision = before.revision ?? before.tick;

    const sent = yield* send({
        type: 'interactNpc',
        npcIndex: npc.index,
        optionIndex: option.opIndex,
        reason: `${option.text} ${npc.name}`,
    });
    if (!sent.success)
        return {
            ok: false,
            reason: sent.reason === 'cant_reach' ? 'cant-reach' : 'send-failed',
            message: sent.message,
        };

    const engaged = (s: BotWorldState) => {
        const combat = s.player?.combat;
        if (combat?.inCombat && combat.targetType === 'npc' && combat.targetIndex === npc.index) return true;
        return s.combatEvents.some(
            e =>
                (e.observationId ?? e.tick) > revision &&
                e.type === 'damage_dealt' &&
                e.targetType === 'npc' &&
                e.targetIndex === npc.index,
        );
    };
    const visible = (s: BotWorldState) => s.nearbyNpcs.some(n => n.index === npc.index);
    const cantReach = (s: BotWorldState) => messageSince(s, cursor, CANT_REACH);
    const refused = (s: BotWorldState) => messageSince(s, cursor, ALREADY_FIGHTING);

    const w = yield* wait(
        `attack ${npc.name}`,
        s => engaged(s) || !visible(s) || !!cantReach(s) || !!refused(s),
        ATTACK_WAIT_TICKS,
    );
    if (cantReach(w.state)) return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}` };
    if (engaged(w.state)) return { ok: true };
    if (refused(w.state))
        return { ok: false, reason: 'already-in-combat', message: `${npc.name} is already in combat` };
    if (!visible(w.state))
        return {
            ok: false,
            reason: 'target-gone',
            message: `${npc.name} disappeared before combat was observed`,
        };
    return { ok: false, reason: 'timeout', message: `Timeout waiting to attack ${npc.name}` };
}
