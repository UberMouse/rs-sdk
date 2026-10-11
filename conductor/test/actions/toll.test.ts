import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { payToll, TOLL_ATTEMPTS, TOLL_DIALOG_TICKS } from '../../actions/toll';
import type { Effect } from '../../core/drivers/timeline';
import { world } from '../world';
import { refuse, runOp } from './harness';

const base = (x: number, coins = 50) => {
    const w = world()
        .player({ at: { x, z: 3228 } })
        .loc('Gate', 3268, 3228, { options: ['Open'] });
    return coins ? w.inv('Coins', coins) : w;
};
const states = (w = base(3267), n = 3) => Array.from({ length: n }, (_, i) => ({ ...w.build(), tick: i }));
const choice = ["No thank you, I'll walk around.", 'Who does my money go to?', 'Yes, ok.'];
const isOpen = (a: BotAction) => a.type === 'interactLoc';
const toX =
    (x: number): Effect =>
    s =>
        world(s)
            .dialog(false)
            .player({ at: { x, z: 3228 } })
            .build();

describe('payToll', () => {
    test('opens the gate, picks "Yes, ok." and ends on the east side', async () => {
        const r = await runOp(states(), ctx => payToll(ctx), {
            react: a =>
                isOpen(a)
                    ? s => world(s).dialog({ options: choice }).build()
                    : a.type === 'clickDialogOption'
                      ? toX(3268)
                      : undefined,
        });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc', 'clickDialogOption']);
        expect(r.sends[1]).toMatchObject({ optionIndex: 2 });
    });

    test('from the east side it ends on the west side', async () => {
        const r = await runOp(states(base(3268)), ctx => payToll(ctx), {
            react: a =>
                isOpen(a)
                    ? s => world(s).dialog({ options: choice }).build()
                    : a.type === 'clickDialogOption'
                      ? toX(3267)
                      : undefined,
        });
        expect(r.result).toEqual({ ok: true });
    });

    test('a free pass (no choice) just crosses', async () => {
        const r = await runOp(states(), ctx => payToll(ctx), { react: a => (isOpen(a) ? toX(3268) : undefined) });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc']);
    });

    test('under 10 coins is no-coins and sends nothing', async () => {
        const r = await runOp(states(base(3267, 9)), ctx => payToll(ctx));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-coins' });
        expect(r.sends).toEqual([]);
    });

    test('no gate in sight is no-loc', async () => {
        const w = world()
            .player({ at: { x: 3267, z: 3228 } })
            .inv('Coins', 50);
        const r = await runOp(states(w), ctx => payToll(ctx));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-loc' });
    });

    test('a dialog with no Yes choice is no-dialog', async () => {
        const r = await runOp(states(base(3267).dialog({ options: ['A', 'B'] })), ctx => payToll(ctx));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-dialog' });
    });

    test('a gate that stays shut times out after TOLL_ATTEMPTS clicks', async () => {
        const r = await runOp(states(base(3267), TOLL_ATTEMPTS * (TOLL_DIALOG_TICKS + 2)), ctx => payToll(ctx));
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(r.sends.filter(isOpen)).toHaveLength(TOLL_ATTEMPTS);
    });

    test('a paid toll that has not got the bot through is not paid again', async () => {
        const r = await runOp(states(), ctx => payToll(ctx), {
            react: a =>
                isOpen(a)
                    ? s => world(s).dialog({ options: choice }).build()
                    : a.type === 'clickDialogOption'
                      ? s => world(s).dialog(false).inv('Coins', 40).build()
                      : undefined,
        });
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout', message: expect.stringContaining('paid') });
        expect(r.sends.filter(isOpen)).toHaveLength(1);
    });

    test('a refused click is send-failed', async () => {
        const r = await runOp(states(), ctx => payToll(ctx), { respond: refuse });
        expect(r.result).toMatchObject({ ok: false, reason: 'send-failed' });
    });
});
