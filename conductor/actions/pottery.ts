// Not ported: sdk/actions.ts has no pottery methods; closest upstream is fletchLogs @ 3b2be2bc2 (the
// make menu) and useItemOnLoc @ 3b2be2bc2. Three ops, one per stage of the engine's pottery
// (server/content/scripts/skill_crafting/scripts/pottery/pottery.rs2): `soften` mixes a clay with a
// jug, bowl or bucket of water, `shape` uses soft clay on a potter's wheel and answers its make menu
// (skill_multi3), `fire` uses an unfired item on a pottery oven. Each makes exactly one item per call:
// shape clicks the make-1 button (the one labelled with the product) so the XP wait ends with the
// item, and the oven's use-on-loc fires one item. Like `fletch`, shape owns its menu: an open chat-modal
// menu freezes the player's queues until a packet closes it, so it closes the menu on every path that
// leaves it open, and a stale one before it starts. The dialog guard leaves a skill make menu alone
// (isSkillMenu). A level-up that lands on the shaping tick is the guard's, not the op's.
import { resolveSkillDialogProduct, skillDialogProductLabels } from '../../sdk/action-quantity';
import type { ActionResult, BotWorldState, NearbyLoc } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { countItems, findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu } from './dismiss';
import { CANT_REACH, dialogSince, messageCursor, messageSince } from './messages';

/** Pottery products, by the make menu's labels. `unfired` and `fired` are the exact inventory item names. */
export const POTTERY_PRODUCTS = ['pot', 'pie dish', 'bowl'] as const;
export const POTTERY: Record<(typeof POTTERY_PRODUCTS)[number], { level: number; unfired: string; fired: string }> = {
    pot: { level: 1, unfired: 'Unfired pot', fired: 'Pot' },
    'pie dish': { level: 7, unfired: 'Unfired pie dish', fired: 'Pie dish' },
    bowl: { level: 8, unfired: 'Unfired bowl', fired: 'Bowl' },
};
export type PotteryProduct = (typeof POTTERY_PRODUCTS)[number];

export const CLAY = /^clay$/i;
export const SOFT_CLAY = /^soft clay$/i;
export const WATER_SOURCE = /^(bucket|jug|bowl) of water$/i;
export const unfiredOf = (product: PotteryProduct) => new RegExp(`^${POTTERY[product].unfired}$`, 'i');

/** Ticks for a soften: the items swap on the next tick and the player is free a tick after that. */
export const SOFTEN_WAIT_TICKS = 8;
/** Ticks to wait for the make menu: fletching's 5s, doubled because the wait includes the walk up to the wheel. */
export const SHAPE_MENU_TICKS = Math.ceil(10_000 / TICK_MS);
/** Ticks a closeModal gets to take the make menu away. */
export const SHAPE_CLOSE_TICKS = 5;
/** The shaping queue's 2-tick delay, with room for lag. */
export const SHAPE_MAKE_TICKS = 12;
/** An oven use is 2 + 2 ticks of animation and delay, plus the walk up to the oven. */
export const FIRE_WAIT_TICKS = Math.ceil(12_000 / TICK_MS);

/** The game's level box ("You need a Crafting level of 7 to make a pie dish."). */
const TOO_LOW = /need a crafting level/i;
/** The Fremennik-only wheels and ovens. */
const NOT_ALLOWED = /only fremenniks/i;
/** The engine's last line of a soften, after its one-tick delay (pottery.rs2 make_softclay). */
const SOFTENED = /soft workable clay/i;
const NOTHING = /nothing interesting happens/i;

const xpOf = (s: BotWorldState) => findSkill(s, 'Crafting')?.experience ?? 0;
const label = (text: string) => text.replaceAll('\\n', '').trim();

export type SoftenResult =
    | { ok: true }
    | { ok: false; reason: 'no-clay' | 'no-water' | 'send-failed' | 'timeout'; message: string };

/** Uses a clay on a jug, bowl or bucket of water: one soft clay (the water container comes back empty). */
export function* soften(ctx: ActionContext): Op<SoftenResult> {
    const s = ctx.state();
    const clay = s.inventory.find(i => CLAY.test(i.name));
    if (!clay) return { ok: false, reason: 'no-clay', message: 'No clay in inventory' };
    const water = s.inventory.find(i => WATER_SOURCE.test(i.name));
    if (!water) return { ok: false, reason: 'no-water', message: 'No bucket, jug or bowl of water in inventory' };
    const before = countItems(s, SOFT_CLAY);
    const cursor = messageCursor(s);
    const sent = yield* send({
        type: 'useItemOnItem',
        sourceSlot: water.slot,
        targetSlot: clay.slot,
        reason: `use ${water.name} on ${clay.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    // The items change at once, but the engine then delays the player a tick and says so: a send before
    // that message is dropped, so the op is done at the message, not at the inventory change.
    const w = yield* wait(
        'soft clay made',
        st => countItems(st, SOFT_CLAY) > before && !!messageSince(st, cursor, SOFTENED),
        SOFTEN_WAIT_TICKS,
    );
    if (w.kind === 'timeout') return { ok: false, reason: 'timeout', message: `No soft clay from ${water.name}` };
    return { ok: true };
}

export type ShapeResult =
    | { ok: true; xpGained: number }
    | {
          ok: false;
          reason:
              | 'no-clay'
              | 'cant-reach'
              | 'not-allowed'
              | 'no-menu'
              | 'no-product'
              | 'level-too-low'
              | 'send-failed'
              | 'timeout';
          message: string;
      };

/** Closes the open modal and waits (bounded) for the make menu to go; the caller checks whether it did. */
function* closeMenu(): Op<ActionResult> {
    const sent = yield* send({ type: 'closeModal', reason: 'close make menu' });
    if (sent.success) yield* wait('make menu closed', st => !isSkillMenu(st.dialog), SHAPE_CLOSE_TICKS);
    return sent;
}

/** Uses soft clay on the potter's wheel `wheel`, picks `product` in its menu and waits for the Crafting XP: one item. */
export function* shape(ctx: ActionContext, wheel: NearbyLoc, product: PotteryProduct): Op<ShapeResult> {
    const s = ctx.state();
    const clay = s.inventory.find(i => SOFT_CLAY.test(i.name));
    if (!clay) return { ok: false, reason: 'no-clay', message: 'No soft clay in inventory' };
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);
    const said = (st: BotWorldState, pattern: RegExp) =>
        messageSince(st, cursor, pattern) ?? dialogSince(st, cursor, pattern);

    if (isSkillMenu(s.dialog)) {
        const closed = yield* closeMenu();
        if (!closed.success) return { ok: false, reason: 'send-failed', message: closed.message };
        if (isSkillMenu(ctx.state().dialog))
            return { ok: false, reason: 'timeout', message: 'A make menu was already open and would not close' };
    }

    let used = false;
    let clicked = false;
    try {
        const sent = yield* send({
            type: 'useItemOnLoc',
            itemSlot: clay.slot,
            x: wheel.x,
            z: wheel.z,
            locId: wheel.id,
            reason: `use ${clay.name} on ${wheel.name}`,
        });
        if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
        used = true;
        const menu = yield* wait(
            'pottery menu',
            st =>
                isSkillMenu(st.dialog) ||
                !!messageSince(st, cursor, CANT_REACH) ||
                !!said(st, NOT_ALLOWED) ||
                !!messageSince(st, cursor, NOTHING),
            SHAPE_MENU_TICKS,
        );
        if (!isSkillMenu(menu.state.dialog)) {
            if (messageSince(menu.state, cursor, CANT_REACH))
                return { ok: false, reason: 'cant-reach', message: `Cannot reach ${wheel.name}` };
            const denied = said(menu.state, NOT_ALLOWED);
            if (denied) return { ok: false, reason: 'not-allowed', message: denied };
            return { ok: false, reason: 'no-menu', message: 'Pottery menu did not open' };
        }
        const options = menu.state.dialog.options;
        const choice = resolveSkillDialogProduct(options, product);
        if (!choice) {
            const available = skillDialogProductLabels(options)
                .map(l => `"${label(l)}"`)
                .join(', ');
            return {
                ok: false,
                reason: 'no-product',
                message: `No pottery product matched "${product}". Available: ${available}`,
            };
        }
        const click = yield* send({
            type: 'clickDialogOption',
            optionIndex: choice.index,
            reason: `shape ${label(choice.text)}`,
        });
        if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
        clicked = true;
        const made = yield* wait(
            `shape ${product}`,
            st => xpOf(st) > xpBefore || !!said(st, TOO_LOW),
            SHAPE_MAKE_TICKS,
        );
        const xpGained = xpOf(made.state) - xpBefore;
        if (xpGained > 0) return { ok: true, xpGained };
        const tooLow = said(made.state, TOO_LOW);
        if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
        return { ok: false, reason: 'timeout', message: 'Shaping timed out' };
    } finally {
        // The menu is the op's from the use until the click answers it: a bailout or a cancel must not leave it open.
        if (used && !clicked && isSkillMenu(ctx.state().dialog)) yield* closeMenu();
    }
}

export type FireResult =
    | { ok: true; cracked: boolean; xpGained: number }
    | {
          ok: false;
          reason: 'no-unfired' | 'cant-reach' | 'not-allowed' | 'send-failed' | 'timeout';
          message: string;
      };

/**
 * Uses the first inventory item matching `unfired` on the pottery oven `oven`. `ok` with `cracked` false
 * and the XP when it came out fired, `cracked` true when it cracked (the item is gone, no XP: a normal
 * result, not a failure).
 */
export function* fire(ctx: ActionContext, unfired: RegExp, oven: NearbyLoc): Op<FireResult> {
    const s = ctx.state();
    const item = s.inventory.find(i => unfired.test(i.name));
    if (!item) return { ok: false, reason: 'no-unfired', message: 'No unfired pottery in inventory' };
    const before = countItems(s, unfired);
    const xpBefore = xpOf(s);
    const cursor = messageCursor(s);
    const sent = yield* send({
        type: 'useItemOnLoc',
        itemSlot: item.slot,
        x: oven.x,
        z: oven.z,
        locId: oven.id,
        reason: `fire ${item.name} in ${oven.name}`,
    });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(
        `fire ${item.name}`,
        st =>
            countItems(st, unfired) < before ||
            !!messageSince(st, cursor, CANT_REACH) ||
            !!messageSince(st, cursor, NOT_ALLOWED),
        FIRE_WAIT_TICKS,
    );
    if (countItems(w.state, unfired) < before) {
        const xpGained = xpOf(w.state) - xpBefore;
        return { ok: true, cracked: xpGained <= 0, xpGained: Math.max(0, xpGained) };
    }
    const denied = messageSince(w.state, cursor, NOT_ALLOWED);
    if (denied) return { ok: false, reason: 'not-allowed', message: denied };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${oven.name}` };
    return { ok: false, reason: 'timeout', message: `Timed out firing ${item.name} in ${oven.name}` };
}
