import { describe, expect, test } from 'bun:test';
import essenceMine from '../../tasks/essence-mine';
import { walking } from '../react';
import { simulate } from '../simulate';
import { world } from '../world';

const SHOP = { x: 3252, z: 3402 };
const MINE = { x: 2894, z: 4838 };
const shop = world()
    .player({ at: SHOP })
    .npcBeside('Aubury', { options: ['Talk-to', 'Trade', 'Teleport'] });
const mine = world()
    .player({ at: MINE })
    .loc('Portal', MINE.x + 2, MINE.z, { options: ['Use'] });
/** An inventory change stands in for the teleport animation the bot waits to see. */
const inMine = mine.inv('Coins', 1);

describe('essence-mine: enter', () => {
    test("uses Aubury's Teleport option and is done inside the mine", async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'enter' },
            timeline: shop.series(30, (w, i) => (i < 6 ? w : inMine.tick(i))),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: in the essence mine');
        expect(r.sends).toEqual(['Teleport Aubury']);
        expect(r.steps).toEqual(['teleport', 'finish']);
    });

    test('already inside is done at once', async () => {
        const r = await simulate(essenceMine, { params: { action: 'enter' }, timeline: mine.series(3) });
        expect(r.result.reason).toBe('finish: in the essence mine');
        expect(r.sends).toEqual([]);
    });

    test('walks to the shop first when Aubury is not in view', async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'enter' },
            timeline: world()
                .player({ at: { x: 3230, z: 3240 } })
                .series(6),
            react: walking(),
        });
        expect(r.steps[0]).toBe('walk-to-aubury');
        expect(r.sends[0]).toMatch(/^walk/i);
    });

    test('before the quest the game refuses and the run fails', async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'enter' },
            timeline: shop.series(10, (w, i) =>
                i < 2 ? w : w.message('You need to have completed the Rune Mysteries Quest to use this feature.'),
            ),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('teleport: Rune Mysteries is not complete');
    });

    test('three teleports that go nowhere fail the run', async () => {
        const r = await simulate(essenceMine, { params: { action: 'enter' }, timeline: shop.series(80) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('teleport: 3 teleports in a row failed: no teleport in time');
        expect(r.sends).toEqual(['Teleport Aubury', 'Teleport Aubury', 'Teleport Aubury']);
    });

    test('no Teleport option on Aubury fails', async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'enter' },
            timeline: world()
                .player({ at: SHOP })
                .npcBeside('Aubury', { options: ['Talk-to'] })
                .series(5),
        });
        expect(r.result.reason).toMatch(/^teleport: Aubury has no Teleport option/);
    });
});

describe('essence-mine: leave', () => {
    test('uses the portal and is done once outside', async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'leave' },
            timeline: mine.series(30, (w, i) => (i < 6 ? w : shop.tick(i))),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: left the essence mine');
        expect(r.sends).toEqual(['Use Portal']);
    });

    test('already outside is done at once', async () => {
        const r = await simulate(essenceMine, { params: { action: 'leave' }, timeline: shop.series(3) });
        expect(r.result.reason).toBe('finish: left the essence mine');
    });

    test('no portal in sight fails', async () => {
        const r = await simulate(essenceMine, {
            params: { action: 'leave' },
            timeline: world().player({ at: MINE }).series(30),
        });
        expect(r.result.reason).toMatch(/^portal: no reachable Portal in sight \(known portals: \(2885,4850\)/);
    });

    test('no portal in view: walks to the nearest known portal, then uses it once in view', async () => {
        const far = world().player({ at: { x: 2900, z: 4840 } });
        const r = await simulate(essenceMine, {
            params: { action: 'leave' },
            timeline: far.series(40, (w, i) =>
                i < 2 ? w : i < 10 ? w.loc('Portal', 2885, 4852, { options: ['Use'] }).tick(i) : shop.tick(i),
            ),
            react: walking(),
        });
        expect(r.sends[0]).toMatch(/^walk/i);
        expect(r.sends.slice(0, 2)).toEqual(['walk to (2885, 4850)', 'Use Portal']);
    });

    test('a portal that does not take us out is retried, then fails', async () => {
        const r = await simulate(essenceMine, { params: { action: 'leave' }, timeline: mine.series(120) });
        expect(r.result.reason).toBe('portal: 3 portal uses in a row failed at (2896,4838); try another portal');
        expect(r.sends).toEqual(['Use Portal', 'Use Portal', 'Use Portal']);
    });
});
