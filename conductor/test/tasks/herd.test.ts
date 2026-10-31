import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import herd, { PROD_ANIM, nextPush, pushDirection, remaining, standTile } from '../../tasks/herd';
import { walking } from '../react';
import { simulate } from '../simulate';
import { world } from '../world';

const SHEEP = 'Diseased sheep 2';
const stopPen = { minX: 2590, maxX: 2600, minZ: 3355, maxZ: 3364 };
/** Route for the tests: west along z=3367 to a corner, then south into the pen's approach. */
const ROUTE: [{ x: number; z: number }, ...{ x: number; z: number }[]] = [
    { x: 2594, z: 3367 },
    { x: 2594, z: 3363 },
];

/** What a prod does as the server runs it: one tile away from an orthogonally adjacent player, the larger axis. */
function prodReact(log: number[] = [], opts: { ignore?: boolean; vanish?: boolean } = {}) {
    return walking((action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type !== 'interactNpc') return undefined;
        const p = state.player;
        const n = state.nearbyNpcs.find(x => x.index === action.npcIndex);
        if (!p || !n) return undefined;
        let px = p.worldX;
        let pz = p.worldZ;
        // The server's approach: from two tiles away in line, the player steps beside the NPC first.
        if (Math.abs(n.x - px) + Math.abs(n.z - pz) === 2 && (n.x === px || n.z === pz)) {
            px += Math.sign(n.x - px);
            pz += Math.sign(n.z - pz);
        }
        const dx = n.x - px;
        const dz = n.z - pz;
        if (Math.abs(dx) + Math.abs(dz) !== 1) return undefined; // a diagonal or distant prod is ignored
        log.push(n.index);
        if (opts.ignore) return undefined;
        return s => ({
            ...s,
            player: s.player && { ...s.player, worldX: px, worldZ: pz },
            nearbyNpcs: opts.vanish
                ? s.nearbyNpcs.filter(x => x.index !== n.index)
                : s.nearbyNpcs.map(x =>
                      x.index === n.index
                          ? {
                                ...x,
                                x: x.x + dx,
                                z: x.z + dz,
                                tileX: (x.tileX ?? x.x) + dx,
                                tileZ: (x.tileZ ?? x.z) + dz,
                            }
                          : x,
                  ),
        });
    });
}

const field = (sheep: { x: number; z: number }, player: { x: number; z: number }) =>
    world()
        .player({ at: player })
        .npc(SHEEP, sheep.x, sheep.z, { index: 7, options: ['Prod'] });

describe('herd: geometry', () => {
    test('the push goes along the larger axis, x on a tie', () => {
        const o = { x: 10, z: 10 };
        expect(pushDirection(o, { x: 4, z: 9 })).toEqual({ x: -1, z: 0 });
        expect(pushDirection(o, { x: 12, z: 9 })).toEqual({ x: 1, z: 0 });
        expect(pushDirection(o, { x: 9, z: 3 })).toEqual({ x: 0, z: -1 });
        expect(pushDirection(o, { x: 11, z: 20 })).toEqual({ x: 0, z: 1 });
        expect(pushDirection(o, { x: 7, z: 7 })).toEqual({ x: -1, z: 0 });
        expect(pushDirection(o, { x: 10, z: 10 })).toBeNull();
    });

    test('the stand tile is directly opposite the push', () => {
        expect(standTile({ x: 10, z: 10 }, { x: -1, z: 0 })).toEqual({ x: 11, z: 10 });
        expect(standTile({ x: 10, z: 10 }, { x: 0, z: -1 })).toEqual({ x: 10, z: 11 });
        expect(standTile({ x: 10, z: 10 }, { x: 1, z: 0 })).toEqual({ x: 9, z: 10 });
        expect(standTile({ x: 10, z: 10 }, { x: 0, z: 1 })).toEqual({ x: 10, z: 9 });
    });

    test('a passed waypoint moves on to the next; at the last the last leg carries on', () => {
        expect(nextPush({ x: 2594, z: 3367 }, ROUTE, 0, 0)).toEqual({ dir: { x: 0, z: -1 }, leg: 1 });
        expect(nextPush({ x: 2594, z: 3363 }, ROUTE, 1, 0)).toEqual({ dir: { x: 0, z: -1 }, leg: 1 });
        expect(nextPush({ x: 2600, z: 3367 }, ROUTE, 0, 0)).toEqual({ dir: { x: -1, z: 0 }, leg: 0 });
        expect(remaining({ x: 2600, z: 3367 }, ROUTE, 0)).toBe(6 + 4);
    });
});

describe('herd: the run', () => {
    test('walks to the opposite tile and prods, leg by leg, until the NPC is in the stop area', async () => {
        const prods: number[] = [];
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: ROUTE, stop: stopPen },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: prodReact(prods),
        });
        expect(r.result.status, r.result.reason).toBe('done');
        expect(r.result.reason).toMatch(/NPC at \(2594,3363\)|NPC at \(2594,3364\)/);
        // 3 west, then 4 south; the stop rect's top edge is z=3364.
        expect(prods.length).toBe(3 + 3);
        expect(r.sends.filter(s => s.startsWith('Prod')).length).toBe(prods.length);
        expect(r.sends.some(s => s === 'herd stand tile')).toBe(true);
    });

    test('with no stop it is done on the last waypoint', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: [{ x: 2595, z: 3367 }] },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: prodReact(),
        });
        expect(r.result.status, r.result.reason).toBe('done');
        expect(r.result.reason).toBe('herd: NPC at (2595,3367) after 2 prods');
    });

    test('locks onto the copy nearest `from` and never prods another', async () => {
        const prods: number[] = [];
        const base = world()
            .player({ at: { x: 2598, z: 3367 } })
            .npc(SHEEP, 2597, 3367, { index: 11, options: ['Prod'] })
            .npc(SHEEP, 2597, 3380, { index: 12, options: ['Prod'] });
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, from: { x: 2597, z: 3380 }, route: [{ x: 2597, z: 3375 }] },
            timeline: [base.build()],
            react: prodReact(prods),
        });
        // The far copy is the chosen one; the bot walks to it and herds it, never touching #11.
        expect(prods.length).toBeGreaterThan(0);
        expect(new Set(prods)).toEqual(new Set([12]));
        expect(r.result.status, r.result.reason).toBe('done');
    });

    test('a bot far from the NPC walks to the first stand tile by route, then prods', async () => {
        const prods: number[] = [];
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: [{ x: 2595, z: 3367 }] },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2610, z: 3372 }).build()],
            react: prodReact(prods),
        });
        expect(r.result.status, r.result.reason).toBe('done');
        expect(prods).toEqual([7, 7]);
    });

    test('a prod answered "I can\'t reach that!" fails the run at once', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: ROUTE },
            timeline: [
                field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build(),
                ...Array.from({ length: 3 }, (_, i) =>
                    field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 })
                        .tick(i + 1)
                        .message("I can't reach that!")
                        .build(),
                ),
            ],
            react: () => undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe("herd: the NPC at (2597,3367) can't be reached from (2598,3367)");
    });

    test('a prod seen by its animation is followed at once, before the NPC is seen to step', async () => {
        // Each prod: the player animates the next tick, the NPC steps two ticks later.
        const prods: number[] = [];
        const truth: { sheep?: number } = {};
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: [{ x: 2592, z: 3367 }] },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: walking((a, st): Effect | undefined => {
                if (a.type !== 'interactNpc') return undefined;
                const p = st.player;
                if (!p) return undefined;
                // The server's own view: where the NPC and the player really are (the state shows the step late).
                const from = truth.sheep ?? 2597;
                const px = Math.abs(from - p.worldX) === 2 ? p.worldX + Math.sign(from - p.worldX) : p.worldX;
                if (Math.abs(from - px) !== 1) return undefined;
                prods.push(a.npcIndex);
                const to = from + (from - px);
                truth.sheep = to;
                let k = 0;
                return s => {
                    k++;
                    return {
                        ...s,
                        player: s.player && { ...s.player, worldX: px, animId: k === 1 ? PROD_ANIM : -1 },
                        nearbyNpcs: s.nearbyNpcs.map(x => (k >= 3 ? { ...x, x: to, tileX: to } : x)),
                    };
                };
            }),
        });
        expect(r.result.status, r.result.reason).toBe('done');
        // The bot never walked between prods: it stepped behind the NPC through the prod's own approach.
        expect(r.sends).toEqual(Array(5).fill('Prod Diseased sheep 2'));
        expect(prods).toHaveLength(5);
    });

    test('prods by the option index given', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, op: 2, route: [{ x: 2596, z: 3367 }] },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: prodReact(),
        });
        expect(r.sends).toContain('op 2 Diseased sheep 2');
    });

    test('an NPC that leaves view after a prod is done with goneIsDone, lost otherwise', async () => {
        const params = { name: `^${SHEEP}$`, route: [{ x: 2595, z: 3360 }], stop: stopPen };
        const timeline = [field({ x: 2595, z: 3366 }, { x: 2595, z: 3367 }).build()];
        const done = await simulate(herd, {
            params: { ...params, goneIsDone: true },
            timeline,
            react: prodReact([], { vanish: true }),
        });
        expect(done.result.status).toBe('done');
        expect(done.result.reason).toBe(`herd: ^${SHEEP}$ left view after 1 prods`);
        const lost = await simulate(herd, { params, timeline, react: prodReact([], { vanish: true }) });
        expect(lost.result.status).toBe('failed');
        expect(lost.result.reason).toBe('herd: lost the NPC (#7) after 1 prods');
    });
});

describe('herd: failures', () => {
    test('an NPC vanishing far from the goal is lost, not a jump, even with goneIsDone', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: [{ x: 2595, z: 3360 }], stop: stopPen, goneIsDone: true },
            timeline: [field({ x: 2560, z: 3360 }, { x: 2559, z: 3360 }).build()],
            react: prodReact([], { vanish: true }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'herd: lost the NPC (#7) after 1 prods, last seen (2560,3360), 30 tiles from the goal, not a jump',
        );
    });

    test('prods that animate but never move the NPC fail on the prod streak, not the no-progress limit', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: ROUTE },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: walking((a): Effect | undefined => {
                if (a.type !== 'interactNpc') return undefined;
                let k = 0;
                return s => {
                    k++;
                    return { ...s, player: s.player && { ...s.player, animId: k === 1 ? PROD_ANIM : -1 } };
                };
            }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('4 prods in a row did not move the NPC');
    });

    test('preflight refuses when no such NPC is in view', async () => {
        const r = await simulate(herd, {
            params: { name: '^Nobody$', route: ROUTE },
            timeline: [world().build()],
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no NPC matching /^Nobody$/ in view');
    });

    test('prods that never move the NPC fail the run', async () => {
        const prods: number[] = [];
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: ROUTE },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: prodReact(prods, { ignore: true }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('herd: 4 prods in a row did not move the NPC at (2597,3367)');
        expect(prods.length).toBe(4);
    });

    test('a stand tile that cannot be reached fails the run', async () => {
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: ROUTE },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2600, z: 3369 }).build()],
            // Without walking() the bot never moves.
            react: () => undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe("herd: can't reach the stand tile (2598,3367) for the NPC at (2597,3367)");
    });

    test('a route that does not get shorter fails after 12 prods', async () => {
        // One step west, then the NPC wanders back and forth: it never gets closer than that again.
        let prods = 0;
        const r = await simulate(herd, {
            params: { name: `^${SHEEP}$`, route: [{ x: 2570, z: 3367 }] },
            timeline: [field({ x: 2597, z: 3367 }, { x: 2598, z: 3367 }).build()],
            react: walking((a): Effect | undefined => {
                if (a.type !== 'interactNpc') return undefined;
                const dx = prods++ % 2 === 0 ? -1 : 1;
                return s => ({
                    ...s,
                    nearbyNpcs: s.nearbyNpcs.map(n => ({ ...n, x: n.x + dx, tileX: (n.tileX ?? n.x) + dx })),
                });
            }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('herd: no progress in 12 prods (26 tiles left at best)');
    });
});
