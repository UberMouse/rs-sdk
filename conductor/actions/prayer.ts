// Ported from sdk/actions.ts activatePrayer / deactivatePrayer @ 4c2069cc0
// Unlike bot.activatePrayer it does no dismissBlockingUI (the dialog guard's job) and takes a display name
// ("Protect from Melee") as the quest and combat pages write it; one op turns a prayer on or off. It checks
// the level and the prayer points before an on, as upstream, and waits for the prayer's own flag in
// `state.prayers` (the toggle is a click on the prayer tab, so a closed or blocked tab shows as a timeout).
import { PRAYER_LEVELS, PRAYER_NAMES } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { TICK_MS } from '../lib/util';
import type { ActionContext } from './context';

/** bot.activatePrayer's 5s wait for the flag, in ticks. */
export const PRAYER_WAIT_TICKS = Math.ceil(5000 / TICK_MS);

const display = (id: string) => {
    const words = id.split('_');
    return words.map((w, i) => (i > 0 && ['of', 'from'].includes(w) ? w : w[0]!.toUpperCase() + w.slice(1))).join(' ');
};

/** The prayers in tab order (index 0-14), by display name: "Thick Skin", "Burst of Strength", "Protect from Melee", ... */
export const PRAYERS: readonly string[] = PRAYER_NAMES.map(display).map(n =>
    // The sdk id spells it protect_items; the game (prayers.dbrow) calls it "Protect Item".
    n === 'Protect Items' ? 'Protect Item' : n,
);

/** A prayer's index by display name, case and spacing ignored; undefined when there is no such prayer. */
export const prayerIndex = (name: string): number | undefined => {
    const wanted = name.trim().replace(/\s+/g, ' ').toLowerCase();
    // The sdk's spelling "Protect Items" is an alias of the game's "Protect Item".
    const i = PRAYERS.findIndex(p => p.toLowerCase() === (wanted === 'protect items' ? 'protect item' : wanted));
    return i < 0 ? undefined : i;
};

export type PrayerResult =
    | { ok: true; changed: boolean }
    | { ok: false; reason: 'unknown' | 'level' | 'no-points' | 'send-failed' | 'timeout'; message: string };

/** Whether prayer `index` is on in this state. */
export const prayerActive = (s: { prayers: { activePrayers: boolean[] } }, index: number): boolean =>
    s.prayers.activePrayers[index] === true;

/** Turns the prayer named `name` on or off; `changed` is false when it already was as asked. */
export function* setPrayer(ctx: ActionContext, name: string, on: boolean): Op<PrayerResult> {
    const index = prayerIndex(name);
    if (index === undefined)
        return { ok: false, reason: 'unknown', message: `No prayer called ${name} (${PRAYERS.join(', ')})` };
    const s = ctx.state();
    if (prayerActive(s, index) === on) return { ok: true, changed: false };
    if (on) {
        const required = PRAYER_LEVELS[index] ?? 1;
        if (s.prayers.prayerLevel < required)
            return {
                ok: false,
                reason: 'level',
                message: `${PRAYERS[index]} needs Prayer ${required}, the bot has ${s.prayers.prayerLevel}`,
            };
        if (s.prayers.prayerPoints <= 0)
            return { ok: false, reason: 'no-points', message: `No prayer points left for ${PRAYERS[index]}` };
    }
    const verb = on ? 'on' : 'off';
    const sent = yield* send({ type: 'togglePrayer', prayerIndex: index, reason: `${PRAYERS[index]} ${verb}` });
    if (!sent.success) return { ok: false, reason: 'send-failed', message: sent.message };
    const w = yield* wait(`${PRAYERS[index]} ${verb}`, st => prayerActive(st, index) === on, PRAYER_WAIT_TICKS);
    if (w.kind !== 'met') return { ok: false, reason: 'timeout', message: `${PRAYERS[index]} did not turn ${verb}` };
    return { ok: true, changed: true };
}
