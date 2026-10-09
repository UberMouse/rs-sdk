import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { isSkillMenu, SMITHING_INTERFACE } from '../../actions/dismiss';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../../actions/modal';
import {
    SMELT_MAKE_TICKS,
    SMELT_MENU_TICKS,
    smelt,
    smith,
    SMITH_CLOSE_TICKS,
    SMITH_DELAY_TICKS,
    SMITH_INTERFACE_TICKS,
    SMITH_MAKE_TICKS,
    smithingButton,
} from '../../actions/smith';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { type Guard, interpret } from '../../core/interpret';
import type { Step } from '../../lib/task';
import { runTask } from '../engine/harness';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const ANVIL_AT = { x: 3188, z: 3421 };
const FURNACE_AT = { x: 3226, z: 3255 };
const BRONZE_BAR = /^bronze bar$/i;
const DAGGER_ID = 1205;
const BOOK = 1234;

/** One bronze bar on the anvil makes a dagger for 125 xp (12.5 in tenths). */
const anvilKit = world()
    .player({ at: { x: ANVIL_AT.x + 1, z: ANVIL_AT.z } })
    .skill('Smithing', 1, 0)
    .inv('Hammer', 1)
    .inv('Bronze bar', 1)
    .loc('Anvil', ANVIL_AT.x, ANVIL_AT.z, { id: 2783 })
    .tick(0);
const anvil = anvilKit.build().nearbyLocs[0]!;
const anvilOpen = (w: World) => w.modal(SMITHING_INTERFACE);
const forged = (w: World) =>
    w.inv('Bronze bar', 0).inv('Bronze dagger', 1, { id: DAGGER_ID }).skill('Smithing', 1, 125);

const useBar: BotAction = {
    type: 'useItemOnLoc',
    itemSlot: 1,
    x: ANVIL_AT.x,
    z: ANVIL_AT.z,
    locId: 2783,
    reason: 'use Bronze bar on Anvil',
};
const clickDagger: BotAction = {
    type: 'clickComponentWithOption',
    componentId: 1119,
    optionIndex: 1,
    slot: 0,
    reason: 'smith dagger',
};
const closeAnvil: BotAction = { type: 'closeModal', reason: 'close smithing interface' };
const closeAnvilUnconfirmed: BotAction = {
    type: 'closeModal',
    reason: 'close smithing interface (open not confirmed)',
};

/** The bar used at tick 0, the interface open at ticks 2-3, the dagger made at tick 4. */
const smithing = (made: (w: World) => World = forged) => [
    anvilKit.build(),
    anvilKit.tick(1).build(),
    anvilOpen(anvilKit.tick(2)).build(),
    anvilOpen(anvilKit.tick(3)).build(),
    made(anvilKit.tick(4)).build(),
];

/** A closeModal takes the anvil interface (or any main modal) and any dialog away from the next tick on, then is spent. */
const closes: TimelineOptions['react'] = action =>
    action.type === 'closeModal'
        ? s => (s.interface.isOpen || s.dialog.isOpen ? world(s).modal(false).dialog(false).build() : s)
        : undefined;
const levelUp = (w: World) => w.dialog({ options: ['Click here to continue'] });
/** Iron's failure: the ore goes into the furnace and no bar comes out. */
const impure = (w: World) => w.inv('Copper ore', 0).message('The ore is too impure and you fail to refine it.');
const sentOf = (driver: TimelineDriver) => driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));

describe('smith', () => {
    test('uses the bar on the anvil, clicks the product in the interface, and waits for the xp', async () => {
        const { result, sends, driver } = await runOp(smithing(), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR));
        expect(result).toEqual({ ok: true, xpGained: 125, product: 'dagger' });
        // The server closes the interface itself on the click, so there is nothing left to close.
        expect(sends).toEqual([useBar, clickDagger]);
        // It returns once the player's post-smith delay is over: the xp came at tick 4.
        expect(driver.state().tick).toBe(4 + SMITH_DELAY_TICKS);
    });

    test('a product is found by name with spaces and hyphens ignored, on its column and row', () => {
        expect(smithingButton('Med-helm')).toMatchObject({ component: 1122, slot: 0 });
        expect(smithingButton('2h sword')).toMatchObject({ component: 1119, slot: 4 });
        expect(smithingButton('platebody')).toMatchObject({ component: 1121, slot: 3 });
        expect(smithingButton('kite shield')).toMatchObject({ component: 1122, slot: 3 });
        expect(smithingButton('kiteshield')).toMatchObject({ component: 1122, slot: 3 });
        // No partial match: "sword" is the sword, never the longsword or the 2h.
        expect(smithingButton('sword')).toMatchObject({ component: 1119, slot: 1 });
        expect(smithingButton('swor')).toBeUndefined();
    });

    test('needs an item named exactly Hammer, the bar asked for and a product it knows, before sending anything', async () => {
        const warhammer = world().inv('Bronze warhammer', 1, { id: 1337 }).inv('Bronze bar', 1);
        const noHammer = await runOp(warhammer.series(1), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR));
        expect(noHammer.result).toEqual({ ok: false, reason: 'no-hammer', message: 'No hammer in inventory' });
        const iron = world().inv('Hammer', 1).inv('Iron bar', 1);
        const noBars = await runOp(iron.series(1), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR));
        expect(noBars.result).toEqual({
            ok: false,
            reason: 'no-bars',
            message: 'No bars matching /^bronze bar$/i in inventory',
        });
        const unknown = await runOp(anvilKit.series(1), ctx => smith(ctx, anvil, 'claws', BRONZE_BAR));
        expect(unknown.result).toEqual({
            ok: false,
            reason: 'unknown-product',
            message: 'Unknown smithing product: claws',
        });
        for (const r of [noHammer, noBars, unknown]) expect(r.sends).toEqual([]);
    });

    test('no interface within its wait is no-interface, and a close goes after the open in case it lands late', async () => {
        const { result, sends, driver } = await runOp(anvilKit.series(1), ctx =>
            smith(ctx, anvil, 'dagger', BRONZE_BAR),
        );
        expect(result).toEqual({ ok: false, reason: 'no-interface', message: 'Smithing interface did not open' });
        expect(sends).toEqual([useBar, closeAnvilUnconfirmed]);
        expect(driver.state().tick).toBe(SMITH_INTERFACE_TICKS + CLEANUP_CLOSE_WAIT_TICKS);
    });

    test("the server's can't-reach, or the client's, is cant-reach", async () => {
        const said = [anvilKit.build(), anvilKit.tick(1).message("I can't reach that!").build()];
        const server = await runOp(said, ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR));
        expect(server.result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Anvil' });
        const noRoute = { success: false, message: 'no route', reason: 'cant_reach' };
        const client = await runOp(anvilKit.series(1), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR), {
            respond: a => (a.type === 'useItemOnLoc' ? noRoute : undefined),
        });
        expect(client.result).toEqual({ ok: false, reason: 'cant-reach', message: 'no route' });
        expect(client.sends).toEqual([useBar]);
    });

    test("the game's level box is level-too-low, before the interface opens or after the click", async () => {
        const metal = 'You need a Smithing level of at least 15 to work irons.';
        const before = [anvilKit.build(), anvilKit.tick(1).recentDialog([metal]).build()];
        const r1 = await runOp(before, ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR));
        expect(r1.result).toEqual({ ok: false, reason: 'level-too-low', message: 'Smithing level too low' });
        const product = 'You need a Smithing level of 18 to make a platebody.';
        const r2 = await runOp(
            smithing(w => w.recentDialog([product])),
            ctx => smith(ctx, anvil, 'platebody', BRONZE_BAR),
        );
        expect(r2.result).toEqual({ ok: false, reason: 'level-too-low', message: 'Smithing level too low' });
    });

    test('"don\'t have enough" after the click is no-bars', async () => {
        const box = "You don't have enough bronze bars to make a platebody.";
        const { result } = await runOp(
            smithing(w => w.recentDialog([box])),
            ctx => smith(ctx, anvil, 'platebody', BRONZE_BAR),
        );
        expect(result).toEqual({ ok: false, reason: 'no-bars', message: 'Not enough bars' });
    });

    test('no xp within its wait after the click is a timeout, and the interface left open is closed', async () => {
        const states = [
            anvilKit,
            anvilKit.tick(1),
            ...anvilOpen(anvilKit.tick(2))
                .series(40)
                .map(s => world(s)),
        ].map(w => w.build());
        const { result, sends, driver } = await runOp(states, ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR), {
            react: closes,
        });
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Smithing timed out' });
        expect(sends).toEqual([useBar, clickDagger, closeAnvil]);
        expect(driver.state().interface.isOpen).toBe(false);
        expect(driver.state().tick).toBe(2 + SMITH_MAKE_TICKS + 1);
    });

    test('a refused send fails at once; a refused click closes the interface it opened', async () => {
        const use = await runOp(anvilKit.series(1), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR), {
            respond: refuse,
        });
        expect(use.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(use.sends).toEqual([useBar]);
        const click = await runOp(smithing(), ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR), {
            react: closes,
            respond: a => (a.type === 'clickComponentWithOption' ? refuse() : undefined),
        });
        expect(click.result).toEqual({
            ok: false,
            reason: 'send-failed',
            message: 'Failed to click smithing option: not connected',
        });
        expect(click.sends).toEqual([useBar, clickDagger, closeAnvil]);
    });
});

describe('smith owns the smithing interface', () => {
    test('one already open is closed before the bar is used, not mistaken for the new one', async () => {
        // Open from the start, gone once closed, open again from tick 4 when the bar has opened it.
        const states = [
            anvilOpen(anvilKit),
            anvilOpen(anvilKit.tick(1)),
            anvilKit.tick(2),
            anvilKit.tick(3),
            ...[4, 5].map(i => anvilOpen(anvilKit.tick(i))),
            forged(anvilKit.tick(6)),
        ].map(w => w.build());
        const { result, sends } = await runOp(states, ctx => smith(ctx, anvil, 'dagger', BRONZE_BAR), {
            react: closes,
        });
        expect(result).toMatchObject({ ok: true });
        expect(sends).toEqual([closeAnvil, useBar, clickDagger]);
    });

    test('one already open that will not close fails without using the bar', async () => {
        const { result, sends, driver } = await runOp(anvilOpen(anvilKit).series(40), ctx =>
            smith(ctx, anvil, 'dagger', BRONZE_BAR),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'A smithing interface was already open: smithing interface still open after two closes',
        });
        expect(sends).toEqual([
            closeAnvil,
            { type: 'closeModal', reason: 'close smithing interface (second attempt)' },
        ]);
        expect(driver.state().tick).toBe(SMITH_CLOSE_TICKS + 1);
    });

    test('cancelled with the interface open and before the click, it closes it in cleanup', async () => {
        // The interface shows at tick 2, the tick the guard fires on, so the op is cancelled inside its
        // wait for the interface, before it clicks.
        const states = [anvilKit, anvilKit.tick(1), anvilOpen(anvilKit.tick(2)), anvilOpen(anvilKit.tick(3))].map(w =>
            w.build(),
        );
        const driver = new TimelineDriver(states, { react: closes });
        const abort: Guard = { name: 'abort', policy: 'abort', when: s => s.tick >= 2, run: () => ({ fail: 'x' }) };
        const r = await interpret(smith(driver, anvil, 'dagger', BRONZE_BAR), { driver, guards: [abort] });
        expect(r.kind).toBe('aborted');
        expect(sentOf(driver)).toEqual([useBar, closeAnvil]);
        expect(driver.state().interface.isOpen).toBe(false);
    });

    test('cancelled after the bar was used and before the interface showed, it waits for it and closes it', async () => {
        const states = [
            anvilKit,
            anvilKit.tick(1),
            anvilKit.tick(2),
            anvilOpen(anvilKit.tick(3)),
            anvilOpen(anvilKit.tick(4)),
        ].map(w => w.build());
        const driver = new TimelineDriver(states, { react: closes });
        const abort: Guard = { name: 'abort', policy: 'abort', when: s => s.tick === 1, run: () => ({ fail: 'x' }) };
        const r = await interpret(smith(driver, anvil, 'dagger', BRONZE_BAR), { driver, guards: [abort] });
        expect(r.kind).toBe('aborted');
        expect(sentOf(driver)).toEqual([useBar, closeAnvil]);
        expect(driver.state().interface.isOpen).toBe(false);
    });
});

describe('smith under the engine: its own interface vs the guards', () => {
    const step: Step = {
        name: 'smith',
        when: () => true,
        *run(ctx) {
            const r = yield* smith(ctx, anvil, 'dagger', BRONZE_BAR);
            return r.ok ? { done: `made ${r.product}` } : { fail: r.message };
        },
    };

    test('the interface guard never fires on the open smithing interface', async () => {
        const r = await runTask([step], smithing());
        expect(r.result.reason).toBe('smith: made dagger');
        expect(r.sends).toEqual(['use Bronze bar on Anvil', 'smith dagger']);
        expect(r.result.stepRuns['interrupt:interface']).toBeUndefined();
    });

    test('a level-up after the dagger is cleared by the dialog guard', async () => {
        const states = [
            ...smithing().slice(0, 4),
            levelUp(forged(anvilKit.tick(4))).build(),
            forged(anvilKit.tick(5)).build(),
        ];
        const r = await runTask([step], states);
        expect(r.result.reason).toBe('smith: made dagger');
        expect(r.sends).toEqual(['use Bronze bar on Anvil', 'smith dagger', 'continue dialog']);
        expect(r.result.stepRuns['interrupt:dialog']).toBe(1);
    });

    test('a book left open is still closed by the interface guard, then the op runs', async () => {
        const states = [
            anvilKit.modal(BOOK),
            anvilKit.tick(1),
            anvilKit.tick(2),
            anvilOpen(anvilKit.tick(3)),
            anvilOpen(anvilKit.tick(4)),
            forged(anvilKit.tick(5)),
        ].map(w => w.build());
        const r = await runTask([step], states, { react: closes });
        expect(r.result.reason).toBe('smith: made dagger');
        expect(r.sends).toEqual([`close interface ${BOOK}`, 'use Bronze bar on Anvil', 'smith dagger']);
        expect(r.result.stepRuns['interrupt:interface']).toBe(1);
    });
});

// The furnace's smelting menu: Smelt X, Smelt 10, Smelt 5 and the bar's own button per bar, the last
// with its label after a literal "\n\n\n\n" as the client publishes it (colour tags already stripped;
// one kept here to show they do not matter).
const BAR_LABELS = ['Bronze', 'Iron', 'Silver', 'Steel', 'Gold', 'Mithril', 'Adamant', 'Rune'];
const MENU = BAR_LABELS.flatMap(b => [`Smelt X @lre@${b}`, `Smelt 10 ${b}`, `Smelt 5 ${b}`, `\\n\\n\\n\\n${b}`]);
const furnaceKit = world()
    .player({ at: { x: FURNACE_AT.x + 2, z: FURNACE_AT.z } })
    .skill('Smithing', 1, 0)
    .inv('Copper ore', 1)
    .inv('Tin ore', 1)
    .loc('Furnace', FURNACE_AT.x, FURNACE_AT.z, { id: 2781, options: ['Smelt'] })
    .tick(0);
const furnace = furnaceKit.build().nearbyLocs[0]!;
const menuOpen = (w: World) => w.dialog({ options: MENU });
const smelted = (w: World) => w.inv('Copper ore', 0).inv('Tin ore', 0).inv('Bronze bar', 1).skill('Smithing', 1, 62);

const openMenu: BotAction = {
    type: 'interactLoc',
    x: FURNACE_AT.x,
    z: FURNACE_AT.z,
    locId: 2781,
    optionIndex: 1,
    reason: 'Smelt Furnace',
};
const choose = (label: string): BotAction => ({
    type: 'clickDialogOption',
    optionIndex: BAR_LABELS.indexOf(label) * 4 + 3,
    reason: `smelt ${label}`,
});
const closeMenu: BotAction = { type: 'closeModal', reason: 'close smelting menu' };

/** Smelt taken at tick 0, the menu open at ticks 2-3, the bar made at tick 6. */
const smelting = (made: (w: World) => World = smelted) => [
    furnaceKit.build(),
    furnaceKit.tick(1).build(),
    menuOpen(furnaceKit.tick(2)).build(),
    menuOpen(furnaceKit.tick(3)).build(),
    furnaceKit.tick(4).build(),
    furnaceKit.tick(5).build(),
    made(furnaceKit.tick(6)).build(),
];

describe('smelt', () => {
    test("takes the furnace's Smelt option, clicks the bar's own button by its label, and waits for the bar", async () => {
        const { result, sends } = await runOp(smelting(), ctx => smelt(ctx, furnace, 'Bronze'));
        expect(result).toEqual({ ok: true, xpGained: 62, product: 'Bronze' });
        // The bar's own button smelts one; the quantity buttons come first in each row.
        expect(sends).toEqual([openMenu, choose('Bronze')]);
    });

    test('matches the label in any case, and finds every bar in the menu', async () => {
        for (const label of BAR_LABELS) {
            const { sends } = await runOp(smelting(), ctx => smelt(ctx, furnace, label.toLowerCase()));
            expect(sends[1]).toEqual(choose(label));
        }
    });

    test('ore gone with no xp is still a smelt: the bar failed (iron), xpGained 0', async () => {
        const { result } = await runOp(smelting(impure), ctx => smelt(ctx, furnace, 'Iron'));
        expect(result).toEqual({ ok: true, xpGained: 0, product: 'Iron' });
    });

    test('a furnace without a Smelt option is no-option, with nothing sent', async () => {
        const decoy = world().loc('Furnace', FURNACE_AT.x - 1, FURNACE_AT.z + 1, { id: 2785 });
        const { result, sends } = await runOp(decoy.series(1), ctx =>
            smelt(ctx, decoy.build().nearbyLocs[0]!, 'Bronze'),
        );
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'no /^smelt$/i option on Furnace' });
        expect(sends).toEqual([]);
    });

    test("the server's can't-reach is cant-reach", async () => {
        const said = [furnaceKit.build(), furnaceKit.tick(1).message("I can't reach that!").build()];
        const { result } = await runOp(said, ctx => smelt(ctx, furnace, 'Bronze'));
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Furnace' });
    });

    test('no menu within its wait is no-menu, and a close goes after the open in case it lands late', async () => {
        const { result, sends, driver } = await runOp(furnaceKit.series(1), ctx => smelt(ctx, furnace, 'Bronze'));
        expect(result).toEqual({ ok: false, reason: 'no-menu', message: 'Smelting menu did not open' });
        expect(sends).toEqual([openMenu, { type: 'closeModal', reason: 'close smelting menu (open not confirmed)' }]);
        expect(driver.state().tick).toBe(SMELT_MENU_TICKS + CLEANUP_CLOSE_WAIT_TICKS);
    });

    test('a bar the menu does not offer is no-product, naming what it offers, and the menu is closed', async () => {
        const { result, sends, driver } = await runOp(
            [furnaceKit.build(), furnaceKit.tick(1).build(), ...menuOpen(furnaceKit.tick(2)).series(10)],
            ctx => smelt(ctx, furnace, 'Bluerite'),
            { react: closes },
        );
        expect(result).toEqual({
            ok: false,
            reason: 'no-product',
            message:
                'No smelting product matched "Bluerite". Available: "Bronze", "Iron", "Silver", "Steel", "Gold", "Mithril", "Adamant", "Rune"',
        });
        expect(sends).toEqual([openMenu, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test("the game's level box after the click is level-too-low, with the game's words", async () => {
        const box = 'You need a Smithing level of 15 to smelt an iron bar.';
        const { result } = await runOp(
            smelting(w => w.recentDialog([box])),
            ctx => smelt(ctx, furnace, 'Iron'),
        );
        expect(result).toEqual({ ok: false, reason: 'level-too-low', message: box });
    });

    test('the game saying the ore is missing is no-ore', async () => {
        const box = 'You need at least 1 Copper ore and 1 Tin ore to smelt a bronze bar.';
        const { result } = await runOp(
            smelting(w => w.recentDialog([box])),
            ctx => smelt(ctx, furnace, 'Bronze'),
        );
        expect(result).toEqual({ ok: false, reason: 'no-ore', message: box });
    });

    test('nothing within its wait after the click is a timeout', async () => {
        const { result, sends, driver } = await runOp(
            smelting(w => w),
            ctx => smelt(ctx, furnace, 'Bronze'),
        );
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Smelting timed out' });
        expect(sends).toEqual([openMenu, choose('Bronze')]);
        expect(driver.state().tick).toBe(2 + SMELT_MAKE_TICKS);
    });

    test('a refused Smelt fails at once with nothing to close', async () => {
        const { result, sends } = await runOp(furnaceKit.series(1), ctx => smelt(ctx, furnace, 'Bronze'), {
            respond: refuse,
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(sends).toEqual([openMenu]);
    });
});

describe('smelt owns its menu', () => {
    test('a refused click leaves no menu behind', async () => {
        const states = [furnaceKit.build(), furnaceKit.tick(1).build(), ...menuOpen(furnaceKit.tick(2)).series(10)];
        const { result, sends } = await runOp(states, ctx => smelt(ctx, furnace, 'Bronze'), {
            react: closes,
            respond: a => (a.type === 'clickDialogOption' ? refuse() : undefined),
        });
        expect(result).toMatchObject({ ok: false, reason: 'send-failed' });
        expect(sends).toEqual([openMenu, choose('Bronze'), closeMenu]);
    });

    test('a menu already open is closed before the Smelt option is taken', async () => {
        const states = [
            menuOpen(furnaceKit),
            menuOpen(furnaceKit.tick(1)),
            furnaceKit.tick(2),
            furnaceKit.tick(3),
            ...[4, 5].map(i => menuOpen(furnaceKit.tick(i))),
            smelted(furnaceKit.tick(6)),
        ].map(w => w.build());
        const { result, sends } = await runOp(states, ctx => smelt(ctx, furnace, 'Bronze'), { react: closes });
        expect(result).toMatchObject({ ok: true });
        expect(sends).toEqual([closeMenu, openMenu, choose('Bronze')]);
    });

    test('a menu already open that will not close fails without taking the Smelt option', async () => {
        const { result, sends } = await runOp(menuOpen(furnaceKit).series(40), ctx => smelt(ctx, furnace, 'Bronze'));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'A make menu was already open: smelting menu still open after two closes',
        });
        expect(sends.every(a => a.type === 'closeModal')).toBe(true);
    });

    test('cancelled after the menu opened and before the click, it closes the menu in cleanup', async () => {
        const states = [furnaceKit, furnaceKit.tick(1), menuOpen(furnaceKit.tick(2)), menuOpen(furnaceKit.tick(3))].map(
            w => w.build(),
        );
        const driver = new TimelineDriver(states, { react: closes });
        const abort: Guard = { name: 'abort', policy: 'abort', when: s => s.tick >= 2, run: () => ({ fail: 'x' }) };
        const r = await interpret(smelt(driver, furnace, 'Bronze'), { driver, guards: [abort] });
        expect(r.kind).toBe('aborted');
        expect(sentOf(driver)).toEqual([openMenu, closeMenu]);
        expect(isSkillMenu(driver.state().dialog)).toBe(false);
    });

    test('the dialog guard leaves the smelting menu to the op, and clears a level-up after it', async () => {
        const step: Step = {
            name: 'smelt',
            when: () => true,
            *run(ctx) {
                const r = yield* smelt(ctx, furnace, 'Bronze');
                return r.ok ? { done: `smelted ${r.product}` } : { fail: r.message };
            },
        };
        const states: BotWorldState[] = [
            ...smelting().slice(0, 6),
            levelUp(smelted(furnaceKit.tick(6))).build(),
            smelted(furnaceKit.tick(7)).build(),
        ];
        const r = await runTask([step], states);
        expect(r.result.reason).toBe('smelt: smelted Bronze');
        expect(r.sends).toEqual(['Smelt Furnace', 'smelt Bronze', 'continue dialog']);
        expect(r.result.stepRuns['interrupt:dialog']).toBe(1);
    });
});
