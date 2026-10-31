import { z } from 'zod/v4';
import { PRAYER_LEVELS } from '../../sdk/types';
import { PRAYERS, prayerActive, prayerConflict, prayerIndex, setPrayer } from '../actions/prayer';
import { log } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';

const FAIL_LIMIT = 3;

const PrayerName = z
    .string()
    .trim()
    .refine(n => prayerIndex(n) !== undefined, { message: `not a prayer name (${PRAYERS.join(', ')})` });

const Params = z
    .object({
        /** Prayers to switch on, by name ("Protect from Melee"). Switching one on switches off any it conflicts with. */
        on: z
            .array(PrayerName)
            .superRefine((names, c) => {
                const conflict = prayerConflict(names);
                if (conflict) c.addIssue({ code: 'custom', message: conflict });
            })
            .default([]),
        /** Prayers to switch off, by name. */
        off: z.array(PrayerName).default([]),
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
        'Sets prayers by name and leaves them as set: `on` (e.g. ["Protect from Melee"]) switches prayers on, `off` switches ' +
        'prayers off; done when the published prayer state matches (a prayer already as asked is left alone), failing when the Prayer ' +
        'level or the prayer points are short. For a plan: use it after a `combat` run with `keepPrayersOn: true` to switch the ' +
        'protection prayer off once the hostile area is left, or to switch one on before a walk through it. Prayers drain points ' +
        "while on (70 points last about 155 s with Protect from Melee), so leaving one on is the plan's explicit choice. " +
        'Each click closes any open dialog, so run it before a dialog is the next thing to answer, not between a dialog and its answer. ' +
        'Prayers that switch each other off (the three protection prayers; Thick/Rock/Steel Skin; the strength and the attack groups) cannot be named together in `on`.',
    params: Params,

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
                const fails = ctx.streak('setFails');
                // Off first: turning one off never fails for points, and frees the slot a conflicting on would take anyway.
                for (const { name, on } of wrong(ctx).sort((a, b) => Number(a.on) - Number(b.on))) {
                    const r = yield* setPrayer(ctx, name, on);
                    if (r.ok) {
                        fails.reset();
                        if (r.changed) yield* log(`prayer ${name} ${on ? 'on' : 'off'}`);
                        continue;
                    }
                    if (r.reason === 'no-points' || r.reason === 'level') return { fail: r.message };
                    if (fails.add() >= FAIL_LIMIT)
                        return { fail: `could not turn ${name} ${on ? 'on' : 'off'}: ${r.message}` };
                }
            },
        },
    ],
});
