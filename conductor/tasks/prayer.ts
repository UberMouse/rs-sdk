import { z } from 'zod/v4';
import { PRAYER_LEVELS } from '../../sdk/types';
import {
    PRAYER_CONFLICTS,
    PRAYER_WAIT_TICKS,
    PRAYERS,
    prayerActive,
    prayerConflict,
    prayerIndex,
    setPrayer,
} from '../actions/prayer';
import { log } from '../core/op';
import { failStreak } from '../lib/streak';
import { defineTask, type TaskContext } from '../lib/task';
import { DEFAULT_WINDOW_TICKS } from '../lib/watchdog';

const FAIL_LIMIT = 3;
/** A toggle is one send and one PRAYER_WAIT_TICKS wait for the prayer to switch. */
const SET_FAILS = failStreak({ name: 'setFails', limit: FAIL_LIMIT, worstTicks: PRAYER_WAIT_TICKS });

const PrayerName = z
    .string()
    .trim()
    .refine(n => prayerIndex(n) !== undefined, { message: `not a prayer name (${PRAYERS.join(', ')})` });

const Params = z
    .object({
        on: z
            .array(PrayerName)
            .superRefine((names, c) => {
                const conflict = prayerConflict(names);
                if (conflict) c.addIssue({ code: 'custom', message: conflict });
            })
            .default([])
            .describe(
                'Prayers to switch on, by whole name, case-insensitive, not a regex (e.g. ["Protect from Melee"]). Switching one on switches off any it conflicts with.',
            ),
        off: z
            .array(PrayerName)
            .default([])
            .describe(
                'Prayers to switch off, by whole name, case-insensitive, not a regex; one that is already off is left alone.',
            ),
    })
    .refine(p => p.on.length + p.off.length > 0, { message: 'name a prayer in `on` or `off`' })
    .refine(p => !p.on.some(n => p.off.some(o => prayerIndex(o) === prayerIndex(n))), {
        message: 'a prayer is in both `on` and `off`',
        path: ['off'],
    });

type PrayerParams = z.infer<typeof Params>;
type Ctx = TaskContext<PrayerParams>;

/** The prayers in `p` that are not as asked in this state: those to switch on that are off, and those to switch off that are on. */
const wrong = (ctx: Ctx) => {
    const s = ctx.state();
    const p = ctx.params;
    return [
        ...p.on.filter(n => !prayerActive(s, prayerIndex(n) ?? -1)).map(name => ({ name, on: true })),
        ...p.off.filter(n => prayerActive(s, prayerIndex(n) ?? -1)).map(name => ({ name, on: false })),
    ];
};

export default defineTask({
    name: 'prayer',
    description:
        'Switches prayers on or off by name and leaves them as set. Done when the prayers match what was asked ' +
        '(a prayer already as asked is left alone); fails when a prayer will not switch. Each click closes any open ' +
        'dialog, so run it before a dialog is the next thing to answer, not between a dialog and its answer. ' +
        'Plans use it after a `combat` run with `keepPrayersOn: true`, to switch the protection prayer off once the ' +
        'hostile area is left, or on before a walk through it. A prayer drains points while on (70 points last ' +
        "about 155 s with Protect from Melee), so leaving one on is the plan's explicit choice.",
    rules: [
        'Name a prayer in `on` or `off`; no prayer in both.',
        `Prayers that switch each other off cannot be named together in \`on\`: ${PRAYER_CONFLICTS.map(g => g.map(i => PRAYERS[i]).join('/')).join('; ')}.`,
        "A prayer to switch on needs the bot's Prayer level and prayer points left; short of either, the task fails.",
    ],
    params: Params,
    silent: [SET_FAILS, DEFAULT_WINDOW_TICKS],

    preflight(ctx) {
        const s = ctx.state();
        for (const { name, on } of wrong(ctx)) {
            if (!on) continue;
            const i = prayerIndex(name) ?? 0;
            const required = PRAYER_LEVELS[i] ?? 1;
            if (s.prayers.prayerLevel < required)
                return `${PRAYERS[i]} needs Prayer ${required}, the bot has ${s.prayers.prayerLevel}`;
            if (s.prayers.prayerPoints <= 0) return `no prayer points left for ${PRAYERS[i]}`;
        }
        return null;
    },

    steps: [
        {
            name: 'finish',
            when: ctx => wrong(ctx).length === 0,
            run: ctx => ({
                done: `prayers set (on: ${ctx.params.on.join(', ') || 'none'}; off: ${ctx.params.off.join(', ') || 'none'})`,
            }),
        },
        {
            name: 'set',
            when: () => true,
            *run(ctx: Ctx) {
                // Off first: turning one off never fails for points, and frees the slot a conflicting on would take anyway.
                for (const { name, on } of wrong(ctx).sort((a, b) => Number(a.on) - Number(b.on))) {
                    const r = yield* setPrayer(ctx, name, on);
                    if (r.ok) {
                        SET_FAILS.clear(ctx);
                        if (r.changed) yield* log(`prayer ${name} ${on ? 'on' : 'off'}`);
                        continue;
                    }
                    if (r.reason === 'no-points' || r.reason === 'level') return { fail: r.message };
                    const failed = SET_FAILS.missWith(ctx, `could not turn ${name} ${on ? 'on' : 'off'}: ${r.message}`);
                    if (failed) return failed;
                }
            },
        },
    ],
});
