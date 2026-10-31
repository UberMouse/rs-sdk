import { describe, expect, test } from 'bun:test';
import teleport from '../../tasks/teleport';
import { TELEPORT_WAIT_TICKS } from '../../actions/teleport';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';

const FALADOR = { x: 3012, z: 3355 };
const LUMBRIDGE_DEST = { x: 3221, z: 3218 };
const CAST = 'cast Lumbridge Teleport';
const ready = world()
    .player({ at: FALADOR })
    .skill('Magic', 31, 0)
    .inv('Air rune', 3)
    .inv('Earth rune', 1)
    .inv('Law rune', 1);
const params = { spell: 'lumbridge' } as const;
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
/** XP on tick 2, the jump on tick 4, the runes gone from tick 2. */
const casting = (w: World, i: number) => {
    const cast = i >= 2 ? w.skill('Magic', 31, 410).inv('Air rune', 0).inv('Earth rune', 0).inv('Law rune', 0) : w;
    return i >= 4 ? cast.player({ at: LUMBRIDGE_DEST }) : cast;
};
const late = (w: World, i: number) => {
    const cast = i >= 2 ? w.skill('Magic', 31, 410).inv('Air rune', 0).inv('Earth rune', 0).inv('Law rune', 0) : w;
    return i >= 8 ? cast.player({ at: LUMBRIDGE_DEST }) : cast;
};
const refused = (msg: string, at = 3) => ready.series(12, (w, i) => (i >= at ? w.message(msg) : w));

describe('teleport: success', () => {
    test('casts once and ends done at the destination with the XP paid', async () => {
        const r = await simulate(teleport, { params, timeline: ready.series(12, casting) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('cast: cast Lumbridge Teleport: arrived, +410 Magic xp');
        expect(r.sends).toEqual([CAST]);
        expect(r.result.xpGained.Magic).toBe(410);
        expect(logged(r)).toEqual([]);
    });

    test('a worn staff stands in for its rune', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: world()
                .player({ at: FALADOR })
                .skill('Magic', 31, 0)
                .inv('Air rune', 3)
                .inv('Law rune', 1)
                .equipment({ name: 'Staff of earth', id: 1385 })
                .series(12, (w, i) => (i >= 4 ? w.skill('Magic', 31, 410).player({ at: LUMBRIDGE_DEST }) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([CAST]);
    });

    test('already at the destination: done, nothing cast', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready.player({ at: LUMBRIDGE_DEST }).series(4, w => w),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('arrived: already at the Lumbridge Teleport destination, nothing cast');
        expect(r.sends).toEqual([]);
    });

    test('other spells send their own component and name', async () => {
        const r = await simulate(teleport, {
            params: { spell: 'camelot' },
            timeline: world()
                .player({ at: FALADOR })
                .skill('Magic', 45, 0)
                .inv('Air rune', 5)
                .inv('Law rune', 1)
                .series(12, (w, i) => (i >= 4 ? w.skill('Magic', 45, 555).player({ at: { x: 2757, z: 3478 } }) : w)),
        });
        expect(r.sends).toEqual(['cast Camelot Teleport']);
        expect(r.result.status).toBe('done');
    });

    test('Watchtower is on plane 2: the right x/z on plane 0 is not arrival', async () => {
        const r = await simulate(teleport, {
            params: { spell: 'watchtower' },
            timeline: world()
                .player({ at: FALADOR })
                .skill('Magic', 58, 0)
                .inv('Earth rune', 2)
                .inv('Law rune', 2)
                .series(14, (w, i) =>
                    i >= 4 ? w.skill('Magic', 58, 680).player({ at: { x: 2933, z: 4713, level: 2 } }) : w,
                ),
        });
        expect(r.result.status).toBe('done');
    });
});

const refusal = async (w: World, p: Parameters<typeof simulate>[1]['params'] = params) => {
    const r = await simulate(teleport, { params: p, timeline: w.series(4, x => x) });
    expect(r.sends).toEqual([]);
    return r.result;
};

describe('teleport: preflight', () => {
    test('too low a Magic level', async () => {
        const res = await refusal(ready.skill('Magic', 30, 0));
        expect(res.status).toBe('failed');
        expect(res.reason).toContain('Lumbridge Teleport needs Magic 31, bot has 30');
    });

    test('missing runes are named', async () => {
        const res = await refusal(ready.inv('Law rune', 0).inv('Air rune', 1));
        expect(res.reason).toContain('needs 2 more Air rune, 1 more Law rune');
    });

    test('a staff of the wrong element does not help', async () => {
        const res = await refusal(ready.inv('Earth rune', 0).equipment({ name: 'Staff of fire', id: 1387 }));
        expect(res.reason).toContain('1 more Earth rune');
    });

    test('already at the destination without the level or runes: done, nothing cast', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: world()
                .player({ at: LUMBRIDGE_DEST })
                .skill('Magic', 1, 0)
                .series(4, w => w),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
    });

    test('inside the Wilderness (level 5) the shared guard fails the run and nothing is sent', async () => {
        const res = await refusal(ready.player({ at: { x: 3100, z: 3555 } }));
        expect(res.status).toBe('failed');
    });

    test('above Wilderness level 20 on the surface', async () => {
        // z 3700 is level 23 (3680 is the first above 20).
        const res = await refusal(ready.player({ at: { x: 3100, z: 3700 } }));
        expect(res.reason).toContain('blocked above Wilderness level 20');
    });
});

describe('teleport: failures', () => {
    test('the server says the Magic level is too low', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: refused('Your Magic level is not high enough for this spell.'),
        });
        expect(r.result.reason).toBe('cast: level: Your Magic level is not high enough for this spell.');
        expect(r.sends).toEqual([CAST]);
    });

    test('the server says a rune is missing', async () => {
        const msg = 'You do not have enough Law Runes to cast this spell.';
        const r = await simulate(teleport, { params, timeline: refused(msg) });
        expect(r.result.reason).toBe(`cast: no-runes: ${msg}`);
        expect(r.sends).toEqual([CAST]);
    });

    test('the Wilderness block', async () => {
        const msg = 'A mysterious force blocks your teleport spell!';
        const r = await simulate(teleport, { params, timeline: refused(msg) });
        expect(r.result.reason).toBe(`cast: wilderness: ${msg}`);
    });

    test('a quest gate', async () => {
        const msg = 'You must have completed Plague City to use this spell.';
        const r = await simulate(teleport, {
            params: { spell: 'ardougne' },
            timeline: world()
                .player({ at: FALADOR })
                .skill('Magic', 51, 0)
                .inv('Water rune', 2)
                .inv('Law rune', 2)
                .series(12, (w, i) => (i >= 3 ? w.message(msg) : w)),
        });
        expect(r.result.reason).toBe(`cast: refused: ${msg}`);
    });

    test('a Tutorial Island message box is a refusal, not a silent no-teleport', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready.series(12, (w, i) =>
                i >= 3 ? w.recentDialog(['You cannot teleport from Tutorial Island!']) : w,
            ),
        });
        expect(r.result.reason).toBe('cast: refused: You cannot teleport from Tutorial Island!');
        expect(r.sends).toEqual([CAST]);
    });

    test('no effect at all: fails after the wait and casts only once', async () => {
        const r = await simulate(teleport, { params, timeline: ready.series(TELEPORT_WAIT_TICKS + 8, w => w) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no-teleport: Lumbridge Teleport had no effect');
        expect(r.sends).toEqual([CAST]);
    });

    test('XP without the jump is a failure that names it, and is not retried', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready.series(TELEPORT_WAIT_TICKS + 8, (w, i) => (i >= 2 ? w.skill('Magic', 31, 410) : w)),
        });
        expect(r.result.reason).toContain('paid 410 Magic xp but the bot is not at its destination');
        expect(r.sends).toEqual([CAST]);
    });
});

describe('teleport: guards', () => {
    test('low HP mid-wait: the guard eats, and the cast is not sent twice', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready
                .inv('Lobster', 1, { id: 379 })
                .series(16, (w, i) =>
                    casting(i >= 2 && i < 5 ? w.player({ hp: 2, maxHp: 30 }) : w.player({ hp: 20, maxHp: 30 }), i),
                ),
        });
        expect(r.sends.filter(s => s === CAST).length).toBe(1);
        expect(r.result.status).toBe('done');
    });

    test('a low-HP abort cuts the wait before arrival: the run still ends done with one cast', async () => {
        // Arrival on tick 8: after the guard's abort at tick 3, so the cast-sent step must wait for it.
        const r = await simulate(teleport, {
            params,
            timeline: ready
                .inv('Lobster', 1, { id: 379 })
                .series(20, (w, i) =>
                    late(i >= 2 && i < 5 ? w.player({ hp: 2, maxHp: 30 }) : w.player({ hp: 20, maxHp: 30 }), i),
                ),
        });
        expect(r.sends.filter(s => s === CAST).length).toBe(1);
        expect(r.result.status).toBe('done');
    });

    test('a level-up dialog opening on the XP tick does not stop the run: done, one cast', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready.series(14, (w, i) =>
                casting(i === 2 ? w.dialog({ text: 'Congratulations, you just advanced a Magic level.' }) : w, i),
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s === CAST).length).toBe(1);
    });

    test('attacked mid-wait: the cast is not resent and the run ends done on arrival', async () => {
        const r = await simulate(teleport, {
            params,
            timeline: ready.series(16, (w, i) => casting(attackedFrom(w, i, 8), i)),
        });
        expect(r.sends.filter(s => s === CAST).length).toBe(1);
        expect(r.result.status).toBe('done');
    });
});
