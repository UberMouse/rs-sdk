import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { PRAYERS, PRAYER_WAIT_TICKS, prayerIndex, setPrayer } from '../../actions/prayer';
import { world } from '../world';
import { refuse, runOp } from './harness';

/** The prayer tab as the client publishes it: 15 flags, points and the base level. */
export const withPrayers = (
    s: BotWorldState,
    p: { active?: number[]; points?: number; level?: number } = {},
): BotWorldState => ({
    ...s,
    prayers: {
        activePrayers: Array.from({ length: 15 }, (_, i) => p.active?.includes(i) ?? false),
        prayerPoints: p.points ?? 30,
        prayerLevel: p.level ?? 43,
    },
});

const MELEE = 14;
const off = (p: { points?: number; level?: number } = {}) => withPrayers(world().build(), p);
const on = withPrayers(world().build(), { active: [MELEE] });

describe('prayer names', () => {
    test('are the tab order in display form, matched ignoring case and spacing', () => {
        expect(PRAYERS[14]).toBe('Protect from Melee');
        expect(PRAYERS[1]).toBe('Burst of Strength');
        expect(prayerIndex('  protect FROM melee ')).toBe(14);
        expect(prayerIndex('Protect from Fire')).toBeUndefined();
    });

    test('Protect Item is the game spelling; the sdk spelling Protect Items is an alias', () => {
        expect(PRAYERS[8]).toBe('Protect Item');
        expect(prayerIndex('Protect Item')).toBe(8);
        expect(prayerIndex('protect items')).toBe(8);
    });
});

describe('setPrayer', () => {
    test('toggles an off prayer on and waits for its flag', async () => {
        const { result, sends } = await runOp([off(), off(), on], ctx => setPrayer(ctx, 'Protect from Melee', true));
        expect(result).toEqual({ ok: true, changed: true });
        expect(sends).toEqual([{ type: 'togglePrayer', prayerIndex: MELEE, reason: 'Protect from Melee on' }]);
    });

    test('toggles an active prayer off', async () => {
        const { result, sends } = await runOp([on, off()], ctx => setPrayer(ctx, 'Protect from Melee', false));
        expect(result).toEqual({ ok: true, changed: true });
        expect(sends).toEqual([{ type: 'togglePrayer', prayerIndex: MELEE, reason: 'Protect from Melee off' }]);
    });

    test('sends nothing when the prayer is already as asked', async () => {
        const a = await runOp([on], ctx => setPrayer(ctx, 'Protect from Melee', true));
        expect(a.result).toEqual({ ok: true, changed: false });
        const b = await runOp([off()], ctx => setPrayer(ctx, 'Protect from Melee', false));
        expect(b.result).toEqual({ ok: true, changed: false });
        expect([...a.sends, ...b.sends]).toEqual([]);
    });

    test('refuses an unknown prayer, a level too low and no points, sending nothing', async () => {
        const unknown = await runOp([off()], ctx => setPrayer(ctx, 'Protect from Fire', true));
        expect(unknown.result).toMatchObject({ ok: false, reason: 'unknown' });
        const level = await runOp([off({ level: 20 })], ctx => setPrayer(ctx, 'Protect from Melee', true));
        expect(level.result).toEqual({
            ok: false,
            reason: 'level',
            message: 'Protect from Melee needs Prayer 43, the bot has 20',
        });
        const points = await runOp([off({ points: 0 })], ctx => setPrayer(ctx, 'Protect from Melee', true));
        expect(points.result).toMatchObject({ ok: false, reason: 'no-points' });
        expect([...unknown.sends, ...level.sends, ...points.sends]).toEqual([]);
    });

    test('turning one off needs no points', async () => {
        const dry = withPrayers(world().build(), { active: [MELEE], points: 0 });
        const { result } = await runOp([dry, off({ points: 0 })], ctx => setPrayer(ctx, 'Protect from Melee', false));
        expect(result).toEqual({ ok: true, changed: true });
    });

    test('a flag that never changes is a timeout', async () => {
        const { result, driver } = await runOp([off()], ctx => setPrayer(ctx, 'Protect from Melee', true));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'Protect from Melee did not turn on' });
        expect(driver.state().tick).toBe(PRAYER_WAIT_TICKS);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp([off()], ctx => setPrayer(ctx, 'Protect from Melee', true), {
            respond: refuse,
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
