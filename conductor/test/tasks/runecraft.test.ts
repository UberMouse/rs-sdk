import { describe, expect, test } from 'bun:test';
import runecraft from '../../tasks/runecraft';
import { simulate, type Simulation } from '../simulate';
import { walking } from '../react';
import { type World, world } from '../world';

const RUINS = { x: 2984, z: 3291 };
const TEMPLE = { x: 2842, z: 4833 };
const MINE = { x: 2894, z: 4838 };
const base = world().skill('Runecraft', 1, 0);
const OUT = { x: 2983, z: 3288 };
/** Standing by the Air ruins with `n` essence and the talisman. */
const outside = (n = 5) =>
    base
        .player({ at: OUT })
        .inv('Air talisman', 1)
        .inv('Rune essence', n)
        .loc('Mysterious ruins', RUINS.x, RUINS.z, { options: [] })
        .loc('Portal', 0, 0, { options: ['Use'] }) // far, to be ignored: not a temple
        .tick(0);
// A coin in the temple: the world changes the inventory as the real teleport's animation changes the player.
const temple = (n: number) =>
    base
        .inv('Coins', 1)
        .player({ at: TEMPLE })
        .inv('Air talisman', 1)
        .inv('Rune essence', n)
        .loc('Altar', TEMPLE.x + 1, TEMPLE.z, { options: ['Craft-rune'] })
        .loc('Portal', TEMPLE.x + 3, TEMPLE.z - 4, { options: ['Use'] });
const crafted = (w: World) => w.inv('Rune essence', 0).inv('Air rune', 5).skill('Runecraft', 1, 250);
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

describe('runecraft: the trip', () => {
    test('uses the talisman on the ruins, crafts, leaves by the portal and is done outside', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: outside().series(40, (w, i) => {
                if (i < 4) return w;
                if (i < 10) return temple(5).tick(i);
                if (i < 16) return crafted(temple(5)).tick(i);
                return crafted(outside(0)).tick(i);
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: crafted air runes and left the temple');
        expect(r.sends).toEqual(['use Air talisman on Mysterious ruins', 'Craft-rune Altar', 'Use Portal']);
        expect(r.steps).toEqual(['enter', 'craft', 'leave', 'finish']);
        expect(logged(r)).toEqual(['crafted air runes']);
    });

    test('a talisman use that teleports nothing is retried, and the third failure fails', async () => {
        const r = await simulate(runecraft, { params: { altar: 'air' }, timeline: outside().series(80) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^enter: 3 tries to enter the ruins failed/);
        expect(r.sends.filter(s => s.startsWith('use Air'))).toHaveLength(3);
    });

    test('a craft that leaves the essence in the inventory is retried, then fails', async () => {
        const r = await simulate(runecraft, { params: { altar: 'air' }, timeline: temple(5).series(120) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('craft: 3 crafts in a row failed');
        expect(r.sends.filter(s => s === 'Craft-rune Altar')).toHaveLength(3);
    });

    test('far from the ruins it walks toward them first', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: outside()
                .player({ at: { x: 3253, z: 3402 } })
                .series(6),
            react: walking(),
        });
        expect(r.sends[0]).toMatch(/^walk/i);
        expect(r.steps[0]).toBe('enter');
    });

    test('inside a temple with no essence it only leaves and is done', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: temple(0).series(40, (w, i) => (i < 8 ? w : outside(0).tick(i))),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: left the air temple with no essence to craft');
        expect(r.sends).toEqual(['Use Portal']);
    });
});

describe('runecraft: refusals and failures', () => {
    test('no essence outside the temple is refused', async () => {
        const r = await simulate(runecraft, { params: { altar: 'air' }, timeline: outside(0).series(5) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: no rune essence held');
    });

    test('a level below the altar is refused', async () => {
        const r = await simulate(runecraft, { params: { altar: 'earth' }, timeline: outside().series(5) });
        expect(r.result.reason).toBe('preflight: earth runes need runecraft 9, bot has 1');
    });

    test('inside the essence mine is refused', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: outside().player({ at: MINE }).series(5),
        });
        expect(r.result.reason).toMatch(/^preflight: in the Rune Essence Mine/);
    });

    test('a missing talisman is refused', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: outside().inv('Air talisman', 0).series(5),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: no Air talisman in the inventory');
    });

    test('ruins that never appear after a successful walk fail after three tries', async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: world()
                .skill('Runecraft', 1, 0)
                .player({ at: OUT })
                .inv('Air talisman', 1)
                .inv('Rune essence', 5)
                .series(200),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('enter: Mysterious ruins not found near (2984,3291)');
    });

    test("another altar's talisman does not count", async () => {
        const r = await simulate(runecraft, {
            params: { altar: 'air' },
            timeline: outside().inv('Air talisman', 0).inv('Mind talisman', 1, { id: 1448 }).series(5),
        });
        expect(r.result.reason).toBe('preflight: no Air talisman in the inventory');
    });
});
