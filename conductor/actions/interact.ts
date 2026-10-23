// Ported from sdk/actions.ts interactLoc and interactNpc @ 3b2be2bc2
// Only the option lookup and the send. bot.interactLoc also walks to a loc over 2 tiles away and then
// waits for any animation, dialog or interface; here the client's own pathing takes the bot to the
// loc, a task walks first itself when it must, and each caller waits for the effect it needs (logs,
// ore) instead.
// sendUseOnLoc is the send half of sdk/actions.ts useItemOnLoc @ 4c2069cc0 (the port line use.ts carries):
// the evidence wait is left to the caller.
import type { InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { type Op, send } from '../core/op';
import { useOnLocAction } from './use';

export type InteractResult = { ok: true } | { ok: false; reason: 'no-option' | 'send-failed'; message: string };

interface PublishedOption {
    text: string;
    opIndex: number;
}

/**
 * The option index and label to send for `option` on the target `name`: an index (sent as given, even
 * when the target doesn't publish it, as bot.interactLoc does) or a pattern for one of its option texts.
 */
export function pickOption(
    options: readonly PublishedOption[],
    name: string,
    option: number | RegExp,
): { ok: true; optionIndex: number; label: string } | { ok: false; reason: 'no-option'; message: string } {
    if (typeof option === 'number')
        return {
            ok: true,
            optionIndex: option,
            label: options.find(o => o.opIndex === option)?.text ?? `op ${option}`,
        };
    const match = options.find(o => option.test(o.text));
    if (!match) return { ok: false, reason: 'no-option', message: `no ${option} option on ${name}` };
    return { ok: true, optionIndex: match.opIndex, label: match.text };
}

const sentResult = (sent: { success: boolean; message: string }): InteractResult =>
    sent.success ? { ok: true } : { ok: false, reason: 'send-failed', message: sent.message };

/**
 * Sends `option` on `loc`: an option index, or a pattern for one of the loc's option texts. `ok` only
 * means the client sent it, not that the server acted (it may answer "I can't reach that!"): the
 * caller waits for the effect.
 */
export function* interactLoc(loc: NearbyLoc, option: number | RegExp): Op<InteractResult> {
    const picked = pickOption(loc.optionsWithIndex, loc.name, option);
    if (!picked.ok) return picked;
    return sentResult(
        yield* send({
            type: 'interactLoc',
            x: loc.x,
            z: loc.z,
            locId: loc.id,
            optionIndex: picked.optionIndex,
            reason: `${picked.label} ${loc.name}`,
        }),
    );
}

/**
 * Sends `option` on `npc`: an option index, or a pattern for one of the NPC's option texts. As
 * interactLoc, `ok` only means the client sent it; `startTalk` (a conversation) and `interact`
 * (any option, waiting for its effect) are the ops that wait.
 */
export function* interactNpc(npc: NearbyNpc, option: number | RegExp): Op<InteractResult> {
    const picked = pickOption(npc.optionsWithIndex, npc.name, option);
    if (!picked.ok) return picked;
    return sentResult(
        yield* send({
            type: 'interactNpc',
            npcIndex: npc.index,
            optionIndex: picked.optionIndex,
            reason: `${picked.label} ${npc.name}`,
        }),
    );
}

/**
 * Sends inventory `item` used on `loc` once, without waiting for evidence (`useItemOnLoc` in use.ts waits
 * for an inventory, dialog or animation change): as interactLoc, `ok` only means sent, and a caller that
 * judges the effect itself (`useOn` in interaction.ts) takes this.
 */
export function* sendUseOnLoc(item: InventoryItem, loc: NearbyLoc): Op<InteractResult> {
    return sentResult(yield* send(useOnLocAction(item, loc)));
}

/** Sends `option` on the inventory `item` (Wear, Eat, Check...): as interactLoc, `ok` only means sent. */
export function* interactItem(item: InventoryItem, option: number | RegExp): Op<InteractResult> {
    const picked = pickOption(item.optionsWithIndex, item.name, option);
    if (!picked.ok) return picked;
    return sentResult(
        yield* send({
            type: 'useInventoryItem',
            slot: item.slot,
            optionIndex: picked.optionIndex,
            reason: `${picked.label} ${item.name}`,
        }),
    );
}
