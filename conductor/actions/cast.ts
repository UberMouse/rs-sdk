// Ported from sdk/actions.ts castSpell @ 4c2069cc0
// NPC targets only (sendSpellOnNpc); the player path is not ported. Differences that change behaviour:
// the caller passes the NPC and the spell's component id; it does not walk first (the server's approach
// trigger closes to casting range itself); death and level-up dialogs are left to the guards; and the
// decision is made on the state the wait ended on. Evidence is Magic XP only: the engine gives a cast's
// XP before it rolls the hit (player_magic.rs2 pvm_spell_cast), so a splash still pays and upstream's
// "runes consumed" fallback is not needed (a staff-fed cast uses no runes but still pays XP).
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, messageCursor, messageSince } from './messages';

/** bot.castSpell's default 3s wait for the cast's XP or the server's refusal, in ticks. */
export const CAST_WAIT_TICKS = Math.ceil(3000 / TICK_MS);
/**
 * Ticks the server holds the next cast back after one (%action_delay = map_clock + 5): a cast sent
 * earlier is queued until then, so a loop gains nothing by sending sooner.
 */
export const CAST_DELAY_TICKS = 5;

const NO_RUNES = /do not have enough|don't have enough/i;
const LOW_LEVEL = /magic level is not high enough/i;

export type CastResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason: 'no-runes' | 'level' | 'cant-reach' | 'target-gone' | 'send-failed' | 'timeout';
          message: string;
      };

const magicXp = (s: BotWorldState) => findSkill(s, 'Magic')?.experience ?? 0;

/**
 * Casts the combat spell with component id `spell` on `npc` and waits until Magic XP is gained.
 * `no-runes` and `level` are the server's refusals ("You do not have enough Air Runes to cast this
 * spell.", "Your Magic level is not high enough for this spell."); `cant-reach` is the client finding no
 * route (nothing sent) or "I can't reach that!"; `target-gone` is the NPC leaving view first.
 */
export function* cast(ctx: ActionContext, npc: NearbyNpc, spell: number, spellName: string): Op<CastResult> {
    const before = ctx.state();
    const cursor = messageCursor(before);
    const xp0 = magicXp(before);

    const sent = yield* send({
        type: 'spellOnNpc',
        npcIndex: npc.index,
        spellComponent: spell,
        reason: `cast ${spellName} on ${npc.name}`,
    });
    if (!sent.success)
        return {
            ok: false,
            reason: sent.reason === 'cant_reach' ? 'cant-reach' : 'send-failed',
            message: sent.message,
        };

    const visible = (s: BotWorldState) => s.nearbyNpcs.some(n => n.index === npc.index);
    const refusal = (s: BotWorldState) =>
        messageSince(s, cursor, NO_RUNES) ?? messageSince(s, cursor, LOW_LEVEL) ?? messageSince(s, cursor, CANT_REACH);
    const w = yield* wait(
        `cast ${spellName} on ${npc.name}`,
        s => magicXp(s) > xp0 || !!refusal(s) || !visible(s),
        CAST_WAIT_TICKS,
    );
    const gained = magicXp(w.state) - xp0;
    if (gained > 0) return { ok: true, xpGained: gained };
    const no = messageSince(w.state, cursor, NO_RUNES);
    if (no) return { ok: false, reason: 'no-runes', message: no };
    const low = messageSince(w.state, cursor, LOW_LEVEL);
    if (low) return { ok: false, reason: 'level', message: low };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${npc.name}` };
    if (!visible(w.state))
        return { ok: false, reason: 'target-gone', message: `${npc.name} disappeared before the cast landed` };
    return { ok: false, reason: 'timeout', message: `Timeout waiting for ${spellName} on ${npc.name}` };
}
