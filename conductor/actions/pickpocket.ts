// Ported from sdk/actions.ts pickpocketNpc @ 3b2be2bc2
// Unlike bot.pickpocketNpc it takes the NPC from the caller and does not walk to it first (a task that
// must walk through doors does so itself); it waits in ticks; a caught attempt is a result, not a
// failure (`outcome: 'caught'`), because the stun it starts is the caller's to wait out; and the "can't
// pickpocket during combat" refusal and an NPC leaving view are results of their own. Upstream's
// idle-walk clock and the op-rejection cursor are replaced by one acknowledgement window: a refused op
// (stunned, mid-action, a modal open) prints nothing, and reads as `not-started`.
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { findSkill } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** The option that picks an NPC's pocket. */
export const PICKPOCKET_OPTION = /^pickpocket$/i;
/** How long the server gets to print "You attempt to pick ..." (2.4 s): the client may walk a tile or two first. */
export const PICKPOCKET_ACK_TICKS = 6;
/** After the attempt message, how long the XP or the stun gets to land (the script's p_delay is a tick or two). */
export const PICKPOCKET_RESOLVE_TICKS = 10;
/**
 * A caught attempt stuns the bot for this many ticks (`stun_ticks` in
 * skill_thieving/configs/pickpocking/pickpocket.dbrow, 8 for every target); an op sent inside it is
 * dropped without a message.
 */
export const STUN_TICKS = 8;
/** Extra ticks a caller waits past STUN_TICKS: its count starts at the message, a tick or so before the script sets the stun. */
export const STUN_MARGIN_TICKS = 2;

const ATTEMPT = /you attempt to pick/i;
const CAUGHT = /you've been stunned|you fail to pick/i;
const IN_COMBAT = /can't pickpocket during combat/i;

export type PickpocketResult =
    | { ok: true; outcome: 'success'; xpGained: number }
    | { ok: true; outcome: 'caught' }
    | {
          ok: false;
          reason: 'no-option' | 'send-failed' | 'cant-reach' | 'in-combat' | 'target-gone' | 'not-started' | 'timeout';
          message: string;
      };

const thievingXp = (s: BotWorldState) => findSkill(s, 'Thieving')?.experience ?? 0;

/**
 * Picks `npc`'s pocket once and waits for the result: XP gained is a success, the stun message a caught
 * attempt. Success is decided on XP, as upstream, so coins alone never count. `in-combat` is the
 * server's refusal within 8 ticks of any combat; `not-started` is no sign the op ran within
 * PICKPOCKET_ACK_TICKS (stunned, mid-action, a modal open, the NPC out of range).
 */
export function* pickpocket(ctx: ActionContext, npc: NearbyNpc): Op<PickpocketResult> {
    const option = npc.optionsWithIndex.find(o => PICKPOCKET_OPTION.test(o.text));
    if (!option) return { ok: false, reason: 'no-option', message: `No Pickpocket option on ${npc.name}` };
    const before = ctx.state();
    const cursor = messageCursor(before);
    const xpBefore = thievingXp(before);

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

    const picked = (s: BotWorldState) => thievingXp(s) > xpBefore;
    const caught = (s: BotWorldState) => !!messageSince(s, cursor, CAUGHT);
    const cantReach = (s: BotWorldState) => !!messageSince(s, cursor, CANT_REACH);
    const combat = (s: BotWorldState) => !!messageSince(s, cursor, IN_COMBAT);
    const attempted = (s: BotWorldState) => !!messageSince(s, cursor, ATTEMPT);
    const visible = (s: BotWorldState) => s.nearbyNpcs.some(n => n.index === npc.index);

    const decided = (s: BotWorldState): PickpocketResult | null => {
        if (picked(s)) return { ok: true, outcome: 'success', xpGained: thievingXp(s) - xpBefore };
        if (caught(s)) return { ok: true, outcome: 'caught' };
        if (cantReach(s)) return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}` };
        if (combat(s))
            return { ok: false, reason: 'in-combat', message: `Cannot pickpocket ${npc.name} during combat` };
        return null;
    };
    const stop = (s: BotWorldState) => !!decided(s) || attempted(s) || !visible(s);

    const acked = yield* wait(`pickpocket ${npc.name}`, stop, PICKPOCKET_ACK_TICKS);
    const early = decided(acked.state);
    if (early) return early;
    if (!attempted(acked.state)) {
        if (!visible(acked.state))
            return { ok: false, reason: 'target-gone', message: `${npc.name} left view before the attempt` };
        return {
            ok: false,
            reason: 'not-started',
            message: `Pickpocket never started on ${npc.name} (no attempt message within ${PICKPOCKET_ACK_TICKS} ticks)`,
        };
    }
    const resolved = yield* wait(`pickpocket result ${npc.name}`, s => !!decided(s), PICKPOCKET_RESOLVE_TICKS);
    return (
        decided(resolved.state) ?? {
            ok: false,
            reason: 'timeout',
            message: `Pickpocket on ${npc.name} neither paid nor stunned within ${PICKPOCKET_RESOLVE_TICKS} ticks`,
        }
    );
}
