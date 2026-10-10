// Not ported: sdk/actions.ts has no cooking method; closest upstream is useItemOnLoc @ 4c2069cc0.
// The animation starts a tick before the raw item is swapped for a cooked or burnt one, which is why
// useItemOnLoc's own evidence (an animation, a changed inventory) is not enough. This revision (289)
// has no cook-all menu: the engine's attempt_cook_item cooks exactly one item per use.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { CANT_REACH, dialogSince, messageCursor, messageSince } from './messages';

/** Wait for one cook: a walk up to the source (the client's own pathing), the arrival delay and the cook's delay. */
const COOK_WAIT_MS = 12_000;
export const COOK_WAIT_TICKS = Math.ceil(COOK_WAIT_MS / TICK_MS);

/** The game's level box ("You need a Cooking level of 15 to cook trout.") */
const TOO_LOW = /need a cooking level/i;
const MEMBERS = /members'? (world|server)/i;
const CANT_COOK = /can't cook that|cannot cook that|already cooked|already marinated/i;
/** The refusals of a source this account may not use: the Cook's quest-gated range, the Fremennik fires. */
const NOT_ALLOWED = /who said you could use that|only members of the fremennik/i;

export type CookResult =
    | { ok: true; burnt: boolean; xpGained: number }
    | {
          ok: false;
          reason:
              | 'no-raw'
              | 'level-too-low'
              | 'members'
              | 'cant-cook'
              | 'not-allowed'
              | 'cant-reach'
              | 'send-failed'
              | 'timeout';
          message: string;
      };

const xpOf = (s: BotWorldState) => findSkill(s, 'Cooking')?.experience ?? 0;

/**
 * Uses the first inventory item matching `raw` on `source` and waits for the result: `ok` with `burnt`
 * false and the XP when it cooked, `burnt` true when the item burnt (it is gone and no XP came; a burn
 * is a normal result at low levels, not a failure). The other reasons mean the item was not cooked.
 * `level-too-low` is the game's own refusal, so it covers a food the task's tables do not know.
 */
export function* cook(ctx: ActionContext, raw: RegExp, source: NearbyLoc): Op<CookResult> {
    const s = ctx.state();
    const item = s.inventory.find(i => raw.test(i.name));
    if (!item) return { ok: false, reason: 'no-raw', message: 'No raw food in inventory' };
    const rawBefore = countItems(s, raw);
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);
    const said = (st: BotWorldState, pattern: RegExp) =>
        messageSince(st, cursor, pattern) ?? dialogSince(st, cursor, pattern);

    const sent = yield* send({
        type: 'useItemOnLoc',
        itemSlot: item.slot,
        x: source.x,
        z: source.z,
        locId: source.id,
        reason: `cook ${item.name} on ${source.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const refusal = (st: BotWorldState) =>
        said(st, TOO_LOW) ?? said(st, MEMBERS) ?? said(st, CANT_COOK) ?? said(st, NOT_ALLOWED);
    const w = yield* wait(
        `cook ${item.name}`,
        st => countItems(st, raw) < rawBefore || !!refusal(st) || !!messageSince(st, cursor, CANT_REACH),
        COOK_WAIT_TICKS,
    );
    if (countItems(w.state, raw) < rawBefore) {
        const xpGained = xpOf(w.state) - xpBefore;
        return { ok: true, burnt: xpGained <= 0, xpGained: Math.max(0, xpGained) };
    }
    const tooLow = said(w.state, TOO_LOW);
    if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
    const members = said(w.state, MEMBERS);
    if (members) return { ok: false, reason: 'members', message: members };
    const cant = said(w.state, CANT_COOK);
    if (cant) return { ok: false, reason: 'cant-cook', message: cant };
    const denied = said(w.state, NOT_ALLOWED);
    if (denied) return { ok: false, reason: 'not-allowed', message: denied };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${source.name}` };
    return { ok: false, reason: 'timeout', message: `Timed out cooking ${item.name} on ${source.name}` };
}
