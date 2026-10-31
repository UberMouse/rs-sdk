import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import type { TimelineOptions } from '../../core/drivers/timeline';
import prayer from '../../tasks/prayer';
import { simulate } from '../simulate';
import { world } from '../world';

const MELEE = 14;
const MAGIC = 12;
const tab = (p: { active?: number[]; points?: number; level?: number } = {}): BotWorldState => ({
    ...world().build(),
    prayers: {
        activePrayers: Array.from({ length: 15 }, (_, i) => p.active?.includes(i) ?? false),
        prayerPoints: p.points ?? 30,
        prayerLevel: p.level ?? 70,
    },
});
/** A toggle flips the prayer's flag from the next tick on; Protect from X switches its two siblings off. */
const react: TimelineOptions['react'] = (action, state) => {
    if (action.type !== 'togglePrayer') return undefined;
    const next = !state.prayers.activePrayers[action.prayerIndex];
    return s => ({
        ...s,
        prayers: {
            ...s.prayers,
            activePrayers: s.prayers.activePrayers.map((v, i) =>
                i === action.prayerIndex ? next : next && i >= 12 && action.prayerIndex >= 12 ? false : v,
            ),
        },
    });
};
const drain: TimelineOptions['react'] = a =>
    a.type === 'togglePrayer' ? st => ({ ...st, prayers: { ...st.prayers, prayerPoints: 0 } }) : undefined;
const run = (params: object, p?: Parameters<typeof tab>[0], r: TimelineOptions['react'] = react) =>
    simulate(prayer, { params, timeline: [tab(p)], react: r });

describe('prayer', () => {
    test('switches a prayer on and is done when the flag shows', async () => {
        const r = await run({ on: ['Protect from Melee'] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Protect from Melee on']);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(true);
    });

    test('switches a prayer off', async () => {
        const r = await run({ off: ['Protect from Melee'] }, { active: [MELEE] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Protect from Melee off']);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(false);
    });

    test('on and off together: off first, then on', async () => {
        const r = await run({ on: ['Protect from Melee'], off: ['Protect from Magic'] }, { active: [MAGIC] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Protect from Magic off', 'Protect from Melee on']);
    });

    test('already as asked sends nothing', async () => {
        const r = await run({ on: ['Protect from Melee'], off: ['Protect from Magic'] }, { active: [MELEE] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
    });

    test('too low a Prayer level is refused', async () => {
        const r = await run({ on: ['Protect from Melee'] }, { level: 20 });
        expect(r.result.reason).toBe('preflight: Protect from Melee needs Prayer 43, the bot has 20');
    });

    test('no prayer points is refused for an on, but not for an off', async () => {
        const on = await run({ on: ['Protect from Melee'] }, { points: 0 });
        expect(on.result.reason).toBe('preflight: no prayer points left for Protect from Melee');
        const off = await run({ off: ['Protect from Melee'] }, { points: 0, active: [MELEE] });
        expect(off.result.status).toBe('done');
    });

    test('points that run out after the preflight fail the run', async () => {
        const r = await simulate(prayer, {
            params: { on: ['Protect from Melee'] },
            timeline: [tab({ points: 1 })],
            react: drain,
        });
        expect(r.result.status).toBe('failed');
    });

    test('a toggle that never lands fails after the limit', async () => {
        const r = await run({ on: ['Protect from Melee'] }, undefined, () => undefined);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('could not turn Protect from Melee on');
    });

    test('bad params are refused', async () => {
        for (const params of [
            {},
            { on: ['Nonsense'] },
            { on: ['Protect from Melee', 'Protect from Magic'] },
            { on: ['Protect from Melee'], off: ['protect from melee'] },
        ]) {
            expect(prayer.params.safeParse(params).success).toBe(false);
        }
    });
});
