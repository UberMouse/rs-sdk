// Ported from sdk/actions.ts smithAtAnvil @ 4c2069cc0
// Not ported: sdk/actions.ts has no furnace smelting method; closest upstream is useItemOnLoc @ 4c2069cc0.
// smith differs from bot.smithAtAnvil: it takes the anvil, the product and the bar from the caller
// (upstream finds the nearest anvil, reads a metal off the product name and defaults to any item named
// "... bar"); it needs an item named exactly Hammer (upstream's /hammer/i also matches a warhammer); a
// product is looked up by its name with spaces and hyphens ignored, never by a partial match (upstream
// falls back to the longest key either containing or contained in the name), and an unknown one is
// `unknown-product`, not upstream's `level_too_low`. The game's refusals arrive as message boxes, which
// upstream's game-message check misses: here a level box or "don't have enough" ends the wait, and
// "I can't reach that!" ends the wait for the interface. The op owns the smithing interface it opens:
// the interface guard leaves it alone (OP_OWNED_INTERFACES), so the op closes it, through withModal, on
// every path that leaves it open (no XP, a refused click, a cancel), and closes one already open before
// it starts, since that one may have been opened with another bar. After the XP it waits out the
// player's post-smith delay (SMITH_DELAY_TICKS), which upstream returns straight into.
// smelt replaces the legacy task's use of ore on a furnace, which smelts one bar without a menu (and
// makes steel from iron ore when 2+ coal are held at Smithing 30+): it takes the furnace's Smelt option
// and answers the smelting menu by the bar's label, which makes exactly the bar asked for. The menu is
// the op's from the Smelt option until its click answers it, under withModal as the anvil interface is.
import type { ActionResult, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { type Op, type Pred, send, ticks, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu, SMITHING_INTERFACE } from './dismiss';
import { interactLoc } from './interact';
import { dialogSince, messageCursor, messageSince } from './messages';
import { type CloseModalResult, type ModalOps, withModal } from './modal';

/** bot.smithAtAnvil's 5s wait for the smithing interface to open, in ticks. */
export const SMITH_INTERFACE_TICKS = Math.ceil(5000 / TICK_MS);
/** bot.smithAtAnvil's default 10s wait for Smithing XP after the click, in ticks. */
export const SMITH_MAKE_TICKS = Math.ceil(10_000 / TICK_MS);
/** The smelting menu gets the same 5s to open that the anvil's interface does. */
export const SMELT_MENU_TICKS = SMITH_INTERFACE_TICKS;
/** The legacy smithing task's 6s wait for the ore to go after it was used on the furnace, in ticks. */
export const SMELT_MAKE_TICKS = Math.ceil(6000 / TICK_MS);
/** Ticks a closeModal gets to take the anvil interface or the smelting menu away (fletch's make menu gets as long). */
export const SMITH_CLOSE_TICKS = 5;
/**
 * Ticks after the Smithing XP before the player takes a new interaction: smithing_anvil
 * (skill_smithing/scripts/smithing/smithing.rs2) delays the player 2 ticks after the product, and a
 * level-up box opens 3 ticks after the XP. A bar used on the anvil sooner is lost: no interface opens.
 */
export const SMITH_DELAY_TICKS = 3;

/** The furnace option that opens the smelting menu (oploc2 in skill_smithing/scripts/smelting/smelting.rs2). */
export const SMELT_OPTION = /^smelt$/i;

const HAMMER = /^hammer$/i;
const CANT_REACH = /can't reach|cannot reach/i;
/**
 * Upstream's level check, which also matches the game's boxes: "You need a Smithing level of at least 15
 * to work irons." (the anvil), "... of 18 to make a platebody." (a product), "... of 15 to smelt an iron
 * bar." (the furnace).
 */
const TOO_LOW = /need a smithing level|level to/i;
/** Upstream's bar check; the game's box is "You don't have enough bronze bars to make a platebody." */
const NOT_ENOUGH_BARS = /don't have enough/i;
/**
 * The furnace's refusals for missing ore, from skill_smithing/configs/smelting/smelting.struct
 * (processfailure, queueore_*): "You need at least 1 Copper ore and 1 Tin ore ...", "You don't have any
 * iron ore to smelt.", "You have run out of ...", "You don't have enough coal ...".
 */
const NO_ORE = /you need at least|you don't have any|run out of|don't have enough coal/i;

/**
 * The anvil interface's product buttons: inventory components smithing:column1..5 (ids 1119-1123 in
 * server/content/pack/interface.pack), each slot a product in the order skill_smithing/configs/smithing/
 * smithing.inv stocks them (the same for every metal). The client publishes no labels for them, so a
 * product is found by name here. Names as upstream's SMITHING_COMPONENTS spells them, aliases included.
 */
const SMITHING_BUTTONS: readonly { names: readonly string[]; component: number; slot: number }[] = [
    { names: ['dagger'], component: 1119, slot: 0 },
    { names: ['sword'], component: 1119, slot: 1 },
    { names: ['scimitar'], component: 1119, slot: 2 },
    { names: ['longsword', 'long sword'], component: 1119, slot: 3 },
    { names: ['2h sword', 'two-handed sword'], component: 1119, slot: 4 },
    { names: ['axe'], component: 1120, slot: 0 },
    { names: ['mace'], component: 1120, slot: 1 },
    { names: ['warhammer', 'war hammer'], component: 1120, slot: 2 },
    { names: ['battleaxe', 'battle axe'], component: 1120, slot: 3 },
    { names: ['chainbody', 'chain body'], component: 1121, slot: 0 },
    { names: ['platelegs', 'plate legs'], component: 1121, slot: 1 },
    { names: ['plateskirt', 'plate skirt'], component: 1121, slot: 2 },
    { names: ['platebody', 'plate body'], component: 1121, slot: 3 },
    { names: ['med helm', 'medium helm'], component: 1122, slot: 0 },
    { names: ['full helm'], component: 1122, slot: 1 },
    { names: ['sq shield', 'square shield'], component: 1122, slot: 2 },
    { names: ['kiteshield', 'kite shield'], component: 1122, slot: 3 },
    { names: ['dart tips'], component: 1123, slot: 0 },
    { names: ['arrowheads', 'arrow tips', 'arrowtips'], component: 1123, slot: 1 },
    { names: ['throwing knives', 'knives'], component: 1123, slot: 2 },
    { names: ['nails'], component: 1123, slot: 3 },
];

/** A product name with case, spaces and hyphens ignored: "Med helm", "med-helm" and "medhelm" are one. */
const productKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BUTTON_BY_KEY = new Map(SMITHING_BUTTONS.flatMap(b => b.names.map(n => [productKey(n), b] as const)));

/** The anvil interface's button for `product`, or undefined for a product it does not offer. */
export const smithingButton = (product: string) => BUTTON_BY_KEY.get(productKey(product));

type Failure<R extends string> = { ok: false; reason: R; message: string };

export type SmithResult =
    | { ok: true; xpGained: number; product: string }
    | Failure<
          | 'no-hammer'
          | 'no-bars'
          | 'unknown-product'
          | 'cant-reach'
          | 'no-interface'
          | 'level-too-low'
          | 'send-failed'
          | 'timeout'
      >;

export type SmeltResult =
    /** `xpGained` 0: the ore went into the furnace and no bar came out (iron's 50% failure). */
    | { ok: true; xpGained: number; product: string }
    | Failure<
          'no-option' | 'cant-reach' | 'no-menu' | 'no-product' | 'level-too-low' | 'no-ore' | 'send-failed' | 'timeout'
      >;

const xpOf = (s: BotWorldState) => findSkill(s, 'Smithing')?.experience ?? 0;
const anvilOpen = (s: BotWorldState) => s.interface.isOpen && s.interface.interfaceId === SMITHING_INTERFACE;
const smeltMenuOpen = (s: BotWorldState) => isSkillMenu(s.dialog);
const inventorySignature = (s: BotWorldState) => s.inventory.map(i => `${i.slot}:${i.id}:${i.count}`).join(',');

/** What the game said since `cursor` matching `pattern`, as a game message or a message box. */
const saidSince = (s: BotWorldState, cursor: number, pattern: RegExp) =>
    messageSince(s, cursor, pattern) ?? dialogSince(s, cursor, pattern);

/**
 * Closes what `isClosed` is false for with a closeModal, and a second one if the first shows no effect
 * within `waitTicks`; already closed is success. At most `waitTicks + 1` ticks.
 */
function* closeModalOf(ctx: ActionContext, what: string, isClosed: Pred, waitTicks: number): Op<CloseModalResult> {
    if (isClosed(ctx.state())) return { ok: true, message: `${what} already closed` };
    const sent = yield* send({ type: 'closeModal', reason: `close ${what}` });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(`${what} closed`, isClosed, waitTicks);
    if (w.kind === 'met') return { ok: true, message: `${what} closed` };
    const again = yield* send({ type: 'closeModal', reason: `close ${what} (second attempt)` });
    if (!again.success) return { ok: false, reason: 'send-failed', message: again.message };
    const last = yield* ticks(1);
    if (isClosed(last)) return { ok: true, message: `${what} closed (second attempt)` };
    return { ok: false, reason: 'timeout', message: `${what} still open after two closes` };
}

/** Closes the anvil's smithing interface (see closeModalOf). */
export function* closeSmithing(ctx: ActionContext, waitTicks = SMITH_CLOSE_TICKS): Op<CloseModalResult> {
    return yield* closeModalOf(ctx, 'smithing interface', s => !anvilOpen(s), waitTicks);
}

/** Closes an open skill make or smelting menu (see closeModalOf). */
function* closeSmeltMenu(ctx: ActionContext, waitTicks = SMITH_CLOSE_TICKS): Op<CloseModalResult> {
    return yield* closeModalOf(ctx, 'smelting menu', s => !smeltMenuOpen(s), waitTicks);
}

// What the open ops report; only `timeout` means an open was sent that can still land (withModal).
type AnvilOpenFailure = Failure<'cant-reach' | 'level-too-low' | 'send-failed' | 'timeout'>;
type MenuOpenFailure = Failure<'no-option' | 'cant-reach' | 'send-failed' | 'timeout'>;
type Opened = { ok: true; message: string };

const sendFailure = (r: ActionResult): Failure<'cant-reach' | 'send-failed'> => ({
    ok: false,
    reason: r.reason === 'cant_reach' ? 'cant-reach' : 'send-failed',
    message: r.message,
});

/** Uses `bar` on `anvil` and waits for the smithing interface, or the game's refusal. */
function* openAnvil(
    ctx: ActionContext,
    anvil: NearbyLoc,
    bar: InventoryItem,
    cursor: number,
): Op<Opened | AnvilOpenFailure> {
    const sent = yield* send({
        type: 'useItemOnLoc',
        itemSlot: bar.slot,
        x: anvil.x,
        z: anvil.z,
        locId: anvil.id,
        reason: `use ${bar.name} on ${anvil.name}`,
    });
    if (!sent.success) return sendFailure(sent);
    const w = yield* wait(
        'smithing interface',
        s => anvilOpen(s) || !!messageSince(s, cursor, CANT_REACH) || !!saidSince(s, cursor, TOO_LOW),
        SMITH_INTERFACE_TICKS,
    );
    if (anvilOpen(w.state)) return { ok: true, message: 'Smithing interface open' };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${anvil.name}` };
    if (saidSince(w.state, cursor, TOO_LOW))
        return { ok: false, reason: 'level-too-low', message: 'Smithing level too low' };
    return { ok: false, reason: 'timeout', message: 'Smithing interface did not open' };
}

/** Clicks `product`'s button in the open interface (Make, one item) and waits for the Smithing XP. */
function* forge(
    product: string,
    button: { component: number; slot: number },
    xpBefore: number,
    cursor: number,
): Op<SmithResult> {
    const click = yield* send({
        type: 'clickComponentWithOption',
        componentId: button.component,
        optionIndex: 1,
        slot: button.slot,
        reason: `smith ${product}`,
    });
    if (!click.success)
        return { ok: false, reason: 'send-failed', message: `Failed to click smithing option: ${click.message}` };
    const w = yield* wait(
        `smith ${product}`,
        s => xpOf(s) > xpBefore || !!saidSince(s, cursor, TOO_LOW) || !!saidSince(s, cursor, NOT_ENOUGH_BARS),
        SMITH_MAKE_TICKS,
    );
    const xpGained = xpOf(w.state) - xpBefore;
    if (xpGained > 0) {
        yield* ticks(SMITH_DELAY_TICKS);
        return { ok: true, xpGained, product };
    }
    if (saidSince(w.state, cursor, TOO_LOW))
        return { ok: false, reason: 'level-too-low', message: 'Smithing level too low' };
    if (saidSince(w.state, cursor, NOT_ENOUGH_BARS))
        return { ok: false, reason: 'no-bars', message: 'Not enough bars' };
    return { ok: false, reason: 'timeout', message: 'Smithing timed out' };
}

/**
 * Smiths one `product` ("dagger", "med helm", "2h sword") at `anvil` from the first inventory item
 * matching `bar`, and waits for the Smithing XP. The smithing interface is the op's: it closes one
 * already open before it starts, and the one it opens on every path that leaves it open.
 */
export function* smith(ctx: ActionContext, anvil: NearbyLoc, product: string, bar: RegExp): Op<SmithResult> {
    const s = ctx.state();
    if (!s.inventory.some(i => HAMMER.test(i.name)))
        return { ok: false, reason: 'no-hammer', message: 'No hammer in inventory' };
    const barItem = s.inventory.find(i => bar.test(i.name));
    if (!barItem) return { ok: false, reason: 'no-bars', message: `No bars matching ${bar} in inventory` };
    const button = smithingButton(product);
    if (!button) return { ok: false, reason: 'unknown-product', message: `Unknown smithing product: ${product}` };

    // An interface already open would satisfy the wait for the new one on the send tick, and the click
    // would smith with whatever bar opened it: take it away first.
    if (anvilOpen(s)) {
        const closed = yield* closeSmithing(ctx);
        if (!closed.ok)
            return {
                ok: false,
                reason: closed.reason,
                message: `A smithing interface was already open: ${closed.message}`,
            };
    }

    const xpBefore = xpOf(ctx.state());
    const cursor = messageCursor(ctx.state());
    const modal: ModalOps<AnvilOpenFailure> = {
        name: 'smithing interface',
        open: () => openAnvil(ctx, anvil, barItem, cursor),
        close: waitTicks => closeSmithing(ctx, waitTicks),
        isOpen: anvilOpen,
        isClosed: st => !anvilOpen(st),
        closeAction: reason => ({ type: 'closeModal', reason }),
    };
    const r = yield* withModal(ctx, modal, forge(product, button, xpBefore, cursor));
    if (r.ok) return r.value;
    if (r.reason === 'timeout') return { ok: false, reason: 'no-interface', message: r.message };
    return r;
}

/** A menu button's label: the client keeps a literal "\n" before a bar's name, and colour tags are dropped. */
const label = (text: string) =>
    text
        .replace(/@[a-z0-9]+@/gi, '')
        .replaceAll('\\n', ' ')
        .replace(/\s+/g, ' ')
        .trim();
/** "Smelt X Bronze", "Smelt 10 Bronze": a quantity button, not a bar's own. */
const QUANTITY = /^smelt\s+(x|\d+)\b/i;

/** Takes the furnace's Smelt option and waits for the smelting menu, or "I can't reach that!". */
function* openSmeltMenu(ctx: ActionContext, furnace: NearbyLoc, cursor: number): Op<Opened | MenuOpenFailure> {
    const sent = yield* interactLoc(furnace, SMELT_OPTION);
    if (!sent.ok) return sent;
    const w = yield* wait(
        'smelting menu',
        s => smeltMenuOpen(s) || !!messageSince(s, cursor, CANT_REACH),
        SMELT_MENU_TICKS,
    );
    if (smeltMenuOpen(w.state)) return { ok: true, message: 'Smelting menu open' };
    if (messageSince(w.state, cursor, CANT_REACH))
        return { ok: false, reason: 'cant-reach', message: `Cannot reach ${furnace.name}` };
    return { ok: false, reason: 'timeout', message: 'Smelting menu did not open' };
}

/**
 * Clicks the bar's own button (smelt one) in the open menu and waits for the ore to go: Smithing XP, any
 * change to the inventory (an iron ore lost without a bar changes nothing else), or the game's refusal.
 */
function* smeltOne(
    ctx: ActionContext,
    bar: string,
    xpBefore: number,
    inventory: string,
    cursor: number,
): Op<SmeltResult> {
    const options = ctx.state().dialog.options;
    const choice = options.find(o => label(o.text).toLowerCase() === bar.toLowerCase());
    if (!choice) {
        const available = options
            .map(o => label(o.text))
            .filter(l => l && !QUANTITY.test(l))
            .map(l => `"${l}"`)
            .join(', ');
        return {
            ok: false,
            reason: 'no-product',
            message: `No smelting product matched "${bar}". Available: ${available}`,
        };
    }
    const chosen = label(choice.text);
    const click = yield* send({ type: 'clickDialogOption', optionIndex: choice.index, reason: `smelt ${chosen}` });
    if (!click.success) return { ok: false, reason: 'send-failed', message: click.message };
    const w = yield* wait(
        `smelt ${chosen}`,
        s =>
            xpOf(s) > xpBefore ||
            inventorySignature(s) !== inventory ||
            !!saidSince(s, cursor, TOO_LOW) ||
            !!saidSince(s, cursor, NO_ORE),
        SMELT_MAKE_TICKS,
    );
    const xpGained = xpOf(w.state) - xpBefore;
    if (xpGained > 0 || inventorySignature(w.state) !== inventory) return { ok: true, xpGained, product: chosen };
    const tooLow = saidSince(w.state, cursor, TOO_LOW);
    if (tooLow) return { ok: false, reason: 'level-too-low', message: tooLow };
    const noOre = saidSince(w.state, cursor, NO_ORE);
    if (noOre) return { ok: false, reason: 'no-ore', message: noOre };
    return { ok: false, reason: 'timeout', message: 'Smelting timed out' };
}

/**
 * Smelts one `bar` at `furnace`: takes its Smelt option, clicks the bar by its label in the menu
 * ("Bronze", "Iron", "Steel", "Mithril", "Adamant", "Rune"), and waits for the ore to go. The menu is
 * the op's: it closes one already open before it starts, and the one it opens on every path that
 * leaves it open.
 */
export function* smelt(ctx: ActionContext, furnace: NearbyLoc, bar: string): Op<SmeltResult> {
    // A menu already open would satisfy the wait for the new one on the send tick, and the click would
    // answer whatever it is for: take it away first.
    if (smeltMenuOpen(ctx.state())) {
        const closed = yield* closeSmeltMenu(ctx);
        if (!closed.ok)
            return { ok: false, reason: closed.reason, message: `A make menu was already open: ${closed.message}` };
    }
    const s = ctx.state();
    const xpBefore = xpOf(s);
    const inventory = inventorySignature(s);
    const cursor = messageCursor(s);
    const modal: ModalOps<MenuOpenFailure> = {
        name: 'smelting menu',
        open: () => openSmeltMenu(ctx, furnace, cursor),
        close: waitTicks => closeSmeltMenu(ctx, waitTicks),
        isOpen: smeltMenuOpen,
        isClosed: st => !smeltMenuOpen(st),
        closeAction: reason => ({ type: 'closeModal', reason }),
    };
    const r = yield* withModal(ctx, modal, smeltOne(ctx, bar, xpBefore, inventory, cursor));
    if (r.ok) return r.value;
    if (r.reason === 'timeout') return { ok: false, reason: 'no-menu', message: r.message };
    return r;
}
