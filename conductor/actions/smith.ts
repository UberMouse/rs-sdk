// Ported from sdk/actions.ts smithAtAnvil @ 4c2069cc0
// Not ported: sdk/actions.ts has no furnace smelting method; closest upstream is useItemOnLoc @ 4c2069cc0.
// smith differs from bot.smithAtAnvil: the caller passes the anvil, the product and the bar (upstream
// finds an anvil and guesses the bar); it needs an item named exactly Hammer (upstream's /hammer/i also
// matches a warhammer); a product is matched by its whole name, never partially, and an unknown one is
// `unknown-product`; the game's refusals are read from message boxes as well as game messages; it owns
// the smithing interface (OP_OWNED_INTERFACES), closing one already open and, under withModal, the one it
// opens on every path; and it waits out the post-smith delay (SMITH_DELAY_TICKS), as a bar used sooner is
// lost. smelt takes the furnace's Smelt option and answers the smelting menu by the bar's label, so it
// makes exactly the bar asked for (ore used on a furnace makes steel from iron when coal is held); it
// owns that menu as smith owns the interface.
import type { ActionResult, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { CLEANUP_TICKS } from '../core/interpret';
import { log, type Op, send, ticks, wait } from '../core/op';
import { findSkill, TICK_MS } from '../lib/util';
import type { ActionContext } from './context';
import { isSkillMenu, SMITHING_INTERFACE } from './dismiss';
import { interactLoc } from './interact';
import { CANT_REACH, dialogSince, messageCursor, messageSince } from './messages';
import { type CloseModalResult, closeModalUntil, type ModalOps, withModal } from './modal';

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
/** A close of the op's own interface or menu: a wait and a second attempt's tick (closeModalUntil). */
const CLOSE_MAX_TICKS = SMITH_CLOSE_TICKS + 1;
/**
 * The most ticks smith takes: closing an interface already open, the wait for its own, then the make
 * wait, the post-smith delay and the close, or after an open that never showed, withModal's cleanup.
 */
export const SMITH_MAX_TICKS =
    CLOSE_MAX_TICKS +
    SMITH_INTERFACE_TICKS +
    Math.max(SMITH_MAKE_TICKS + SMITH_DELAY_TICKS + CLOSE_MAX_TICKS, CLEANUP_TICKS);
/** The most ticks smelt takes, as SMITH_MAX_TICKS: there is no delay after a smelt. */
export const SMELT_MAX_TICKS =
    CLOSE_MAX_TICKS + SMELT_MENU_TICKS + Math.max(SMELT_MAKE_TICKS + CLOSE_MAX_TICKS, CLEANUP_TICKS);

/** The furnace option that opens the smelting menu (oploc2 in skill_smithing/scripts/smelting/smelting.rs2). */
export const SMELT_OPTION = /^smelt$/i;

/** The smith op's hammer: exactly Hammer, never a warhammer. */
export const HAMMER = /^hammer$/i;
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
 * The anvil interface's product buttons in columns 1-4: inventory components smithing:column1..4 (ids
 * 1119-1122 in server/content/pack/interface.pack), each slot a product in the order skill_smithing/
 * configs/smithing/smithing.inv stocks them, the same for every metal. Column 5 (ammunition, and wire,
 * nails or studs depending on the metal) is not offered. The client publishes no labels for these, so a
 * product is found by name: `name` is the op's own, `aliases` other spellings upstream accepts.
 */
const SMITHING_BUTTONS = [
    { name: 'dagger', aliases: [], component: 1119, slot: 0 },
    { name: 'sword', aliases: [], component: 1119, slot: 1 },
    { name: 'scimitar', aliases: [], component: 1119, slot: 2 },
    { name: 'longsword', aliases: [], component: 1119, slot: 3 },
    { name: '2h sword', aliases: ['two-handed sword'], component: 1119, slot: 4 },
    { name: 'axe', aliases: [], component: 1120, slot: 0 },
    { name: 'mace', aliases: [], component: 1120, slot: 1 },
    { name: 'warhammer', aliases: [], component: 1120, slot: 2 },
    { name: 'battleaxe', aliases: [], component: 1120, slot: 3 },
    { name: 'chainbody', aliases: [], component: 1121, slot: 0 },
    { name: 'platelegs', aliases: [], component: 1121, slot: 1 },
    { name: 'plateskirt', aliases: [], component: 1121, slot: 2 },
    { name: 'platebody', aliases: [], component: 1121, slot: 3 },
    { name: 'med helm', aliases: ['medium helm'], component: 1122, slot: 0 },
    { name: 'full helm', aliases: [], component: 1122, slot: 1 },
    { name: 'sq shield', aliases: ['square shield'], component: 1122, slot: 2 },
    { name: 'kiteshield', aliases: [], component: 1122, slot: 3 },
] as const;

/** A product the anvil interface offers, by the op's own name for it. */
export type SmithingProduct = (typeof SMITHING_BUTTONS)[number]['name'];
type SmithingButton = (typeof SMITHING_BUTTONS)[number];

/** A product name with case, spaces and hyphens ignored: "Med helm", "med-helm" and "medhelm" are one. */
const productKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const BUTTON_BY_KEY: ReadonlyMap<string, SmithingButton> = new Map(
    SMITHING_BUTTONS.flatMap(b => [b.name, ...b.aliases].map(n => [productKey(n), b] as const)),
);

/** The anvil interface's button for `product` (any case, spacing or alias), or undefined for one it does not offer. */
export const smithingButton = (product: string): SmithingButton | undefined => BUTTON_BY_KEY.get(productKey(product));

/** The op's own name for `product` ("Square-shield" is "sq shield"), or undefined for one it does not offer. */
export const smithingProduct = (product: string): SmithingProduct | undefined => smithingButton(product)?.name;

type Failure<R extends string> = { ok: false; reason: R; message: string };

/** `message` also says when the interface or menu the op opened could not be closed after it. */
type Made = { ok: true; xpGained: number; product: string; message: string };

export type SmithResult =
    | Made
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
    | Made
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

/** Closes the anvil's smithing interface (see closeModalUntil). */
export function* closeSmithing(ctx: ActionContext, waitTicks = SMITH_CLOSE_TICKS): Op<CloseModalResult> {
    return yield* closeModalUntil(ctx, 'smithing interface', s => !anvilOpen(s), waitTicks);
}

/** Closes an open skill make or smelting menu (see closeModalUntil). */
function* closeSmeltMenu(ctx: ActionContext, waitTicks = SMITH_CLOSE_TICKS): Op<CloseModalResult> {
    return yield* closeModalUntil(ctx, 'smelting menu', s => !smeltMenuOpen(s), waitTicks);
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

/**
 * `result` as is when withModal's close of `what` went through (after the work, or after a failed open).
 * Otherwise the failed close is logged and added to its message: the interface guard leaves the op's
 * own interface open, so the next smith or smelt (or the next run's start) is what closes it.
 */
function* notingClose<R extends { message: string }>(result: R, closed: CloseModalResult, what: string): Op<R> {
    if (closed.ok) return result;
    yield* log(`${what} left open: ${closed.message}`);
    return { ...result, message: `${result.message}; ${what} left open: ${closed.message}` };
}

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
        return { ok: true, xpGained, product, message: `Smithed ${product}` };
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
    if (r.ok) return yield* notingClose(r.value, r.closed, modal.name);
    const reason = r.reason === 'timeout' ? 'no-interface' : r.reason;
    return yield* notingClose<SmithResult>({ ok: false, reason, message: r.message }, r.closed, modal.name);
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
    if (xpGained > 0 || inventorySignature(w.state) !== inventory)
        return {
            ok: true,
            xpGained,
            product: chosen,
            message: xpGained > 0 ? `Smelted ${chosen}` : `Smelted ${chosen}: the ore was used and no bar came out`,
        };
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
    if (r.ok) return yield* notingClose(r.value, r.closed, modal.name);
    const reason = r.reason === 'timeout' ? 'no-menu' : r.reason;
    return yield* notingClose<SmeltResult>({ ok: false, reason, message: r.message }, r.closed, modal.name);
}
