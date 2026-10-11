import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { isSkillMenu } from '../../actions/dismiss';
import {
    fire,
    FIRE_WAIT_TICKS,
    shape,
    SHAPE_CLOSE_TICKS,
    SHAPE_MAKE_TICKS,
    SHAPE_MENU_TICKS,
    soften,
    SOFTEN_WAIT_TICKS,
    unfiredOf,
} from '../../actions/pottery';
import type { TimelineOptions } from '../../core/drivers/timeline';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const WHEEL = { x: 3087, z: 3409 };
const MENU = ['Pot', 'Pie Dish', 'Bowl'].flatMap(p => ['Make X', 'Make 10', 'Make 5', `\\n\\n\\n\\n${p}`]);
const SOFT = 1761;
const DONE = 'You now have some soft workable clay.';
const BASE = world().skill('Crafting', 1, 0);
const clayKit = BASE.inv('Clay', 1, { id: 434 }).inv('Bucket of water', 1, { id: 1929 });
const wheelKit = BASE.inv('Soft clay', 1, { id: SOFT }).loc("Potter's Wheel", WHEEL.x, WHEEL.z).tick(1);
const ovenKit = BASE.inv('Unfired pot', 1, { id: 1787 }).loc('Pottery Oven', 3084, 3407).tick(1);
const menu = (w: World) => w.dialog({ options: MENU });
const wheel = (ws: World) => ws.build().nearbyLocs[0]!;
const oven = (ws: World) => ws.build().nearbyLocs[0]!;
const useClay: BotAction = {
    type: 'useItemOnLoc',
    itemSlot: 0,
    x: WHEEL.x,
    z: WHEEL.z,
    locId: wheel(wheelKit).id,
    reason: "use Soft clay on Potter's Wheel",
};
const choose = (optionIndex: number, label: string): BotAction => ({
    type: 'clickDialogOption',
    optionIndex,
    reason: `shape ${label}`,
});
const closeMenu: BotAction = { type: 'closeModal', reason: 'close make menu' };
const react: TimelineOptions['react'] = action =>
    action.type === 'closeModal'
        ? s => (s.dialog.isOpen ? { ...s, dialog: { isOpen: false, options: [], isWaiting: false } } : s)
        : undefined;
const SHAPED = (w: World) => w.inv('Soft clay', 0).inv('Unfired pot', 1, { id: 1787 }).skill('Crafting', 1, 157);

describe('soften', () => {
    test('uses the water on the clay and waits for the soft clay', async () => {
        const states = [
            clayKit.tick(0),
            clayKit.tick(1),
            BASE.inv('Soft clay', 1, { id: SOFT }).inv('Bucket', 1, { id: 1925 }).tick(2),
            BASE.inv('Soft clay', 1, { id: SOFT }).inv('Bucket', 1, { id: 1925 }).tick(3).message(DONE),
        ].map(w => w.build());
        const { result, sends } = await runOp(states, ctx => soften(ctx));
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            { type: 'useItemOnItem', sourceSlot: 1, targetSlot: 0, reason: 'use Bucket of water on Clay' },
        ]);
    });

    test('a jug or bowl of water works too', async () => {
        const jug = BASE.inv('Clay', 1, { id: 434 }).inv('Jug of water', 1, { id: 1937 });
        const { result } = await runOp(
            [jug.tick(0), jug.inv('Clay', 0).inv('Soft clay', 1, { id: SOFT }).tick(1).message(DONE)].map(w =>
                w.build(),
            ),
            ctx => soften(ctx),
        );
        expect(result).toEqual({ ok: true });
    });

    test('says what is missing, and that a refused send or no soft clay fails', async () => {
        const noClay = await runOp(BASE.inv('Bucket of water', 1, { id: 1929 }).series(1), ctx => soften(ctx));
        expect(noClay.result).toEqual({ ok: false, reason: 'no-clay', message: 'No clay in inventory' });
        const noWater = await runOp(BASE.inv('Clay', 1, { id: 434 }).series(1), ctx => soften(ctx));
        expect(noWater.result).toMatchObject({ ok: false, reason: 'no-water' });
        const refused = await runOp(clayKit.series(1), ctx => soften(ctx), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        const nothing = await runOp(clayKit.series(1), ctx => soften(ctx));
        expect(nothing.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(nothing.driver.state().tick).toBe(SOFTEN_WAIT_TICKS);
    });
});

/** Soft clay used at tick 1, the menu open at ticks 2-3, the item shaped at tick 5. */
const shaping = (made: (w: World) => World = SHAPED) => [
    wheelKit,
    menu(wheelKit.tick(2)),
    menu(wheelKit.tick(3)),
    wheelKit.tick(4),
    made(wheelKit.tick(5)),
];

describe('shape', () => {
    test('uses the soft clay on the wheel, clicks the product by label and waits for the xp', async () => {
        const { result, sends } = await runOp(
            shaping().map(w => w.build()),
            ctx => shape(ctx, wheel(wheelKit), 'pot'),
        );
        expect(result).toEqual({ ok: true, xpGained: 157 });
        // The make-1 button is the fourth of a product's four, after Make X, 10 and 5.
        expect(sends).toEqual([useClay, choose(3, 'Pot')]);
        const bowl = await runOp(
            shaping().map(w => w.build()),
            ctx => shape(ctx, wheel(wheelKit), 'bowl'),
        );
        expect(bowl.sends[1]).toEqual(choose(11, 'Bowl'));
    });

    test('a product the menu does not offer is no-product and the menu is closed', async () => {
        const { result, sends } = await runOp(
            shaping().map(w => w.build()),
            // 'urn' is deliberately not a product: it probes the menu-has-no-such-product path.
            ctx => shape(ctx, wheel(wheelKit), 'urn' as never),
            { react },
        );
        expect(result).toMatchObject({ ok: false, reason: 'no-product' });
        expect(sends).toEqual([useClay, closeMenu]);
    });

    test('no menu within its wait is no-menu; cant-reach and the Fremennik refusal are their own', async () => {
        const none = await runOp(wheelKit.series(1), ctx => shape(ctx, wheel(wheelKit), 'pot'));
        expect(none.result).toEqual({ ok: false, reason: 'no-menu', message: 'Pottery menu did not open' });
        expect(none.driver.state().tick).toBe(1 + SHAPE_MENU_TICKS);
        const cant = await runOp([wheelKit.build(), wheelKit.tick(2).message("I can't reach that!").build()], ctx =>
            shape(ctx, wheel(wheelKit), 'pot'),
        );
        expect(cant.result).toEqual({ ok: false, reason: 'cant-reach', message: "Cannot reach Potter's Wheel" });
        const text = 'Only Fremenniks may use this pottery wheel.';
        const denied = await runOp([wheelKit.build(), wheelKit.tick(2).message(text).build()], ctx =>
            shape(ctx, wheel(wheelKit), 'pot'),
        );
        expect(denied.result).toEqual({ ok: false, reason: 'not-allowed', message: text });
    });

    test("the game's level box after the click is level-too-low; no xp is a timeout", async () => {
        const box = 'You need a Crafting level of 7 to make a pie dish.';
        const low = await runOp(
            shaping(w => w.recentDialog([box])).map(w => w.build()),
            ctx => shape(ctx, wheel(wheelKit), 'pie dish'),
        );
        expect(low.result).toEqual({ ok: false, reason: 'level-too-low', message: box });
        const stuck = await runOp(
            shaping(w => w).map(w => w.build()),
            ctx => shape(ctx, wheel(wheelKit), 'pot'),
        );
        expect(stuck.result).toEqual({ ok: false, reason: 'timeout', message: 'Shaping timed out' });
        expect(stuck.driver.state().tick).toBe(2 + SHAPE_MAKE_TICKS);
    });

    test('needs soft clay; a refused send fails at once', async () => {
        const none = await runOp(BASE.loc("Potter's Wheel", WHEEL.x, WHEEL.z).series(1), ctx =>
            shape(ctx, wheel(wheelKit), 'pot'),
        );
        expect(none.result).toMatchObject({ ok: false, reason: 'no-clay' });
        const refused = await runOp(wheelKit.series(1), ctx => shape(ctx, wheel(wheelKit), 'pot'), { respond: refuse });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('a refused click leaves no menu behind', async () => {
        const { result, sends } = await runOp(
            shaping().map(w => w.build()),
            ctx => shape(ctx, wheel(wheelKit), 'pot'),
            { react, respond: a => (a.type === 'clickDialogOption' ? refuse() : undefined) },
        );
        expect(result).toMatchObject({ ok: false, reason: 'send-failed' });
        expect(sends.at(-1)).toEqual(closeMenu);
    });

    test('a stale menu is closed before the use; one that will not close fails without using the clay', async () => {
        const states = [menu(wheelKit.tick(0)), menu(wheelKit.tick(1)), wheelKit.tick(2), wheelKit.tick(3)].map(w =>
            w.build(),
        );
        const closed = await runOp(
            [...states, ...[4, 5].map(i => menu(wheelKit.tick(i)).build()), SHAPED(wheelKit.tick(6)).build()],
            ctx => shape(ctx, wheel(wheelKit), 'pot'),
            { react },
        );
        expect(closed.result).toMatchObject({ ok: true });
        expect(closed.sends).toEqual([closeMenu, useClay, choose(3, 'Pot')]);
        const stuck = await runOp(menu(wheelKit).series(40), ctx => shape(ctx, wheel(wheelKit), 'pot'));
        expect(stuck.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(stuck.sends).toEqual([closeMenu]);
        expect(stuck.driver.state().tick).toBe(1 + SHAPE_CLOSE_TICKS);
        expect(isSkillMenu(stuck.driver.state().dialog)).toBe(true);
    });
});

const fired = (w: World, xp = 157) => w.inv('Unfired pot', 0).inv('Pot', 1, { id: 1931 }).skill('Crafting', 1, xp);
const useOven = (o = oven(ovenKit)): BotAction => ({
    type: 'useItemOnLoc',
    itemSlot: 0,
    x: o.x,
    z: o.z,
    locId: o.id,
    reason: 'fire Unfired pot in Pottery Oven',
});

describe('fire', () => {
    test('uses the unfired item on the oven and reports the xp', async () => {
        const { result, sends } = await runOp(
            [ovenKit, ovenKit.tick(2), fired(ovenKit.tick(5))].map(w => w.build()),
            ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)),
        );
        expect(result).toEqual({ ok: true, cracked: false, xpGained: 157 });
        expect(sends).toEqual([useOven()]);
    });

    test('a cracked item is gone with no xp: ok, cracked', async () => {
        const cracked = ovenKit.tick(5).inv('Unfired pot', 0);
        const { result } = await runOp(
            [ovenKit, cracked].map(w => w.build()),
            ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)),
        );
        expect(result).toEqual({ ok: true, cracked: true, xpGained: 0 });
    });

    test('refusals, a missing item, a refused send and no effect are their own reasons', async () => {
        const text = 'Only Fremenniks may use this pottery oven.';
        const denied = await runOp(
            [ovenKit, ovenKit.tick(2).message(text)].map(w => w.build()),
            ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)),
        );
        expect(denied.result).toEqual({ ok: false, reason: 'not-allowed', message: text });
        const cant = await runOp(
            [ovenKit, ovenKit.tick(2).message("I can't reach that!")].map(w => w.build()),
            ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)),
        );
        expect(cant.result).toMatchObject({ ok: false, reason: 'cant-reach' });
        const none = await runOp(BASE.series(1), ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)));
        expect(none.result).toMatchObject({ ok: false, reason: 'no-unfired' });
        const refused = await runOp(ovenKit.series(1), ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)), {
            respond: refuse,
        });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        const idle = await runOp(ovenKit.series(1), ctx => fire(ctx, unfiredOf('pot'), oven(ovenKit)));
        expect(idle.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(idle.driver.state().tick).toBe(1 + FIRE_WAIT_TICKS);
    });
});
