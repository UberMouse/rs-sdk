import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { TELEPORT_WAIT_TICKS } from '../../actions/teleport';
import { TimelineDriver } from '../../core/drivers/timeline';
import {
    EPILOGUE_GRACE_TICKS,
    EPILOGUE_TICKS,
    escapeSpell,
    fleeDestinations,
    FLEE_DISTANCE,
    MAX_FLEE_LEGS,
    needsEpilogue,
    runEpilogue,
    epilogueSummary,
    safeSpotTracker,
    trackSafeSpot,
    withEpilogueResult,
} from '../../lib/epilogue';
import { noCrossings, straightPaths } from '../paths';
import { walking } from '../react';
import { type World, world } from '../world';

const AT = { x: 3222, z: 3218 };
/** Fighting a goblin next to it, at `hp` of 40. */
const fighting = (hp: number) =>
    world().player({ hp, maxHp: 40, inCombat: true }).npcBeside('Goblin', { attacking: true });
const calm = (hp: number) => world().player({ hp, maxHp: 40, inCombat: false });

const at = (x: number, z: number) => world().player({ hp: 30, maxHp: 40, inCombat: true, at: { x, z } });

const spellBase = (hp: number) =>
    fighting(hp).skill('Magic', 31, 0).inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1);

const own = (hp: number) => {
    const w = world()
        .npcBeside('Goblin', { attacking: true, options: ['Attack'] })
        .player({ hp, maxHp: 40 });
    return w.fighting(w.build().nearbyNpcs[0]!.index);
};

/** A fight at 38/40 that follows, where every walk is blocked. */
const blocked = (retaliate: boolean) =>
    new TimelineDriver(
        fighting(38)
            .autoRetaliate(retaliate)
            .series(300, (w, i) => w.player({ hp: 38, lastDamageTick: i })),
        { react: walking(undefined, () => true) },
    );

/** Runs the epilogue on a timeline where sends move the bot (`walking`). */
async function run(
    timeline: BotWorldState[],
    opts: { safe?: { x: number; z: number; level: number } | null; onCast?: (w: World) => World } = {},
) {
    const walk = walking();
    const driver = new TimelineDriver(timeline, {
        react: (a, s) =>
            a.type === 'clickComponent' && opts.onCast ? st => opts.onCast!(world(st)).build() : walk(a, s),
    });
    const epilogue = await runEpilogue(driver, {
        safe: opts.safe ?? null,
        pathfinder: straightPaths(),
        walkWorld: noCrossings(),
    });
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    return { epilogue, sends, driver };
}

describe('needsEpilogue', () => {
    test('a done run never gets one', () => {
        expect(needsEpilogue({ status: 'done', reason: 'x' })).toBe(false);
    });
    test('failed, stuck and error runs do', () => {
        for (const status of ['failed', 'stuck', 'error'] as const)
            expect(needsEpilogue({ status, reason: 'no phase applies' })).toBe(true);
    });
    test('a vanished client gets none', () => {
        expect(needsEpilogue({ status: 'stuck', reason: 'client stopped publishing ticks for 30s' })).toBe(false);
        expect(needsEpilogue({ status: 'error', reason: 'the SDK disconnected' })).toBe(false);
    });
});

describe('epilogue: under attack at the end of a failed run', () => {
    test('low HP with food: eats, then walks away until out of the fight', async () => {
        // The goblin's reach is lost once the bot has walked off; HP is back up from the second tick (the eat).
        const { epilogue, sends } = await run(
            fighting(10)
                .inv('Shrimps', 3)
                .series(40, (w, i) => (i >= 1 ? w.player({ hp: 25 }) : w)),
        );
        expect(epilogue?.actions[0]).toStartWith('ate');
        expect(epilogue?.actions.some(a => a.startsWith('walked'))).toBe(true);
        expect(epilogue?.ended).toBe('safe');
        expect(epilogue?.hpBefore).toBe(10);
        expect(epilogue?.hpAfter).toBe(25);
        // Eat first, then away from the goblin (it stands east): west. Never an attack or a pickup.
        expect(sends[0]).toMatchObject({ type: 'useInventoryItem', reason: 'Eat Shrimps' });
        expect(sends.every(s => s.type === 'useInventoryItem' || s.type === 'walkTo')).toBe(true);
        const walk = sends.find(s => s.type === 'walkTo');
        expect((walk as { x: number }).x).toBeLessThan(AT.x);
    });

    test('not under attack: does nothing at all', async () => {
        const { epilogue, sends } = await run(calm(10).inv('Shrimps', 3).series(5));
        expect(epilogue).toBeNull();
        expect(sends).toEqual([]);
    });

    test('in combat with nothing hitting it (a stale flag) is not under attack', async () => {
        const { epilogue, sends } = await run(world().player({ hp: 10, maxHp: 40, inCombat: true }).series(5));
        expect(epilogue).toBeNull();
        expect(sends).toEqual([]);
    });

    test('healthy: walks away without eating', async () => {
        const { epilogue, sends } = await run(fighting(38).inv('Shrimps', 3).series(30));
        expect(epilogue?.actions).toEqual(['walked']);
        expect(epilogue?.ended).toBe('safe');
        expect(sends.some(s => s.type === 'useInventoryItem')).toBe(false);
    });

    test('low HP and no food: teleports at once when the runes are held', async () => {
        const base = fighting(10).skill('Magic', 31, 0).inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1);
        const { epilogue, sends } = await run(
            base.series(20, (w, i) =>
                i >= 5
                    ? calm(10)
                          .skill('Magic', 31, 410)
                          .player({ at: { x: 3221, z: 3218 } })
                    : w,
            ),
        );
        expect(sends[0]).toMatchObject({ type: 'clickComponent', reason: 'cast Lumbridge Teleport' });
        expect(epilogue?.actions).toEqual(['teleported lumbridge']);
        expect(epilogue?.ended).toBe('safe');
    });

    test('HP still falling after a walk leg: teleports', async () => {
        // A foe that follows keeps hitting: the hit tick stays recent, so the bot stays under attack away from it.
        const base = fighting(30).skill('Magic', 37, 0).inv('Air rune', 3).inv('Water rune', 1).inv('Law rune', 1);
        const tl = base.series(80, (w, i) => w.player({ hp: Math.max(25, 38 - i), lastDamageTick: i }));
        const { epilogue, sends } = await run(tl, {
            onCast: w => w.skill('Magic', 37, 700).player({ at: { x: 2965, z: 3378 }, inCombat: false }),
        });
        const types = sends.map(s => s.type);
        expect(types[0]).toBe('walkTo');
        expect(types.indexOf('clickComponent')).toBeGreaterThan(types.indexOf('walkTo'));
        expect(epilogue?.actions.at(-1)).toBe('teleported falador');
        expect(epilogue?.ended).toBe('safe');
    });

    test('a foe that follows: walks a few legs, then stands and eats as HP falls', async () => {
        // The hit tick stays recent, so the bot is under attack wherever it walks.
        const tl = fighting(30)
            .inv('Shrimps', 4)
            .series(200, (w, i) => w.player({ hp: Math.max(5, 30 - Math.floor(i / 3)), lastDamageTick: i }));
        const { epilogue, sends } = await run(tl);
        const types = sends.map(s => s.type);
        expect(types.filter(x => x === 'walkTo').length).toBeGreaterThan(0);
        expect(types.filter(x => x === 'walkTo').length).toBeLessThanOrEqual(MAX_FLEE_LEGS);
        const eatAt = types.indexOf('useInventoryItem');
        expect(eatAt).toBeGreaterThan(types.indexOf('walkTo'));
        expect(epilogue?.ended).toBe('timeout');
        expect(epilogue?.actions.some(a => a.startsWith('ate'))).toBe(true);
    });

    test('a teleport is cast once, however the fight goes', async () => {
        const base = fighting(10).skill('Magic', 31, 0).inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1);
        const { sends } = await run(base.series(300));
        expect(sends.filter(s => s.type === 'clickComponent')).toHaveLength(1);
    });

    test('no way to leave: bounded by the time budget', async () => {
        const driver = new TimelineDriver(fighting(30).series(1), { react: walking(undefined, () => true) });
        const epilogue = await runEpilogue(driver, { pathfinder: straightPaths(), walkWorld: noCrossings() });
        expect(epilogue).not.toBeNull();
        expect(epilogue!.ticks).toBeLessThanOrEqual(EPILOGUE_TICKS + EPILOGUE_GRACE_TICKS);
        expect(epilogue!.ended).toBe('timeout');
        expect(epilogue!.inCombat).toBe(true);
    });

    test('the cut-off holds even when a cast is too late to start', async () => {
        // No food and runes, but fewer ticks left than the cast needs: no cast.
        const base = fighting(10).skill('Magic', 31, 0).inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1);
        const driver = new TimelineDriver(
            base.series(1).map(s => ({ ...s, tick: 0 })),
            { react: walking(undefined, () => true) },
        );
        const r = await runEpilogue(driver, { pathfinder: straightPaths(), walkWorld: noCrossings() });
        expect(r!.ticks).toBeLessThanOrEqual(EPILOGUE_TICKS + EPILOGUE_GRACE_TICKS + TELEPORT_WAIT_TICKS);
    });

    test('a client that is gone gives no epilogue', async () => {
        const driver = new TimelineDriver(fighting(10).series(1));
        driver.state = () => {
            throw new Error('no world state from client');
        };
        expect(await runEpilogue(driver)).toBeNull();
    });
});

describe('fleeDestinations', () => {
    const s = fighting(30).build();

    test('directly away from the foe first', () => {
        const [first] = fleeDestinations(s, null);
        expect(first).toEqual({ x: AT.x - FLEE_DISTANCE, z: AT.z });
    });

    test('the remembered safe spot comes first when it lies away from the foe', () => {
        const safe = { x: AT.x - 20, z: AT.z + 3, level: 0 };
        expect(fleeDestinations(s, safe)[0]).toEqual({ x: safe.x, z: safe.z });
    });

    test('a safe spot past the foe, on another plane or too near is not run to', () => {
        for (const safe of [
            { x: AT.x + 20, z: AT.z, level: 0 },
            { x: AT.x - 20, z: AT.z, level: 1 },
            { x: AT.x - 2, z: AT.z, level: 0 },
        ])
            expect(fleeDestinations(s, safe)[0]).toEqual({ x: AT.x - FLEE_DISTANCE, z: AT.z });
    });

    test('a remembered safe spot beyond twice the flee distance is dropped', () => {
        const far = { x: AT.x - FLEE_DISTANCE * 2 - 1, z: AT.z, level: 0 };
        const near = { x: AT.x - FLEE_DISTANCE * 2, z: AT.z, level: 0 };
        expect(fleeDestinations(s, far)[0]).toEqual({ x: AT.x - FLEE_DISTANCE, z: AT.z });
        expect(fleeDestinations(s, near)[0]).toEqual({ x: near.x, z: near.z });
    });

    test('turned alternatives follow', () => {
        expect(fleeDestinations(s, null)).toHaveLength(5);
    });
});

describe('escapeSpell and safeSpotTracker', () => {
    test('needs the level and every rune', () => {
        const base = world().skill('Magic', 31, 0);
        expect(escapeSpell(base.inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1).build())).toBe('lumbridge');
        expect(escapeSpell(base.inv('Air rune', 3).inv('Law rune', 1).build())).toBeNull();
        expect(escapeSpell(world().skill('Magic', 10, 0).inv('Air rune', 9).inv('Law rune', 1).build())).toBeNull();
    });

    test('no teleport above Wilderness level 20', () => {
        const w = world()
            .skill('Magic', 31, 0)
            .inv('Air rune', 3)
            .inv('Earth rune', 1)
            .inv('Law rune', 1)
            .player({ at: { x: 3100, z: 3700 } });
        expect(escapeSpell(w.build())).toBeNull();
    });

    test('remembers the last tile out of combat only', () => {
        const t = safeSpotTracker();
        expect(t.spot()).toBeNull();
        t.observe(
            calm(30)
                .player({ at: { x: 3200, z: 3200 } })
                .build(),
        );
        t.observe(
            fighting(30)
                .player({ at: { x: 3210, z: 3210 } })
                .build(),
        );
        expect(t.spot()).toEqual({ x: 3200, z: 3200, level: 0 });
    });
});

/** The epilogue's result and walk sends on the blocked fight. */
const countWalks = async (retaliate: boolean) => {
    const driver = blocked(retaliate);
    const epilogue = await runEpilogue(driver, { pathfinder: straightPaths(), walkWorld: noCrossings() });
    const walks = driver.commands.filter(c => c.type === 'send' && c.action.type === 'walkTo').length;
    return { epilogue, walks };
};

describe('fleeDestinations and the Wilderness', () => {
    test('outside it, never into it: a foe to the south at the border leaves only tame ways', () => {
        const s = at(3100, 3515).npc('Skeleton', 3100, 3514, { attacking: true }).build();
        const out = fleeDestinations(s, null);
        expect(out.length).toBeGreaterThan(0);
        expect(out.every(d => d.z < 3520)).toBe(true);
        // A safe spot inside it is dropped too.
        expect(fleeDestinations(s, { x: 3100, z: 3530, level: 0 }).every(d => d.z < 3520)).toBe(true);
    });

    test('inside it, only toward a lower level', () => {
        // Level 3 at z 3540; the foe stands north, so away is south (lower), and north-ward turns are dropped.
        const s = at(3100, 3540).npc('Skeleton', 3100, 3541, { attacking: true }).build();
        const out = fleeDestinations(s, null);
        expect(out[0]).toEqual({ x: 3100, z: 3540 - FLEE_DISTANCE });
        expect(out.every(d => d.z < 3540)).toBe(true);
    });
});

describe('epilogue: auto-retaliate off', () => {
    test('at the hold point it teleports at once, even at healthy HP', async () => {
        const tl = spellBase(38)
            .autoRetaliate(false)
            .series(60, (w, i) => w.player({ lastDamageTick: i }));
        const { epilogue, sends } = await run(tl, {
            onCast: w => w.skill('Magic', 31, 410).player({ at: { x: 3221, z: 3218 }, inCombat: false }),
        });
        // Legs first; once the walk stalled (HP fell) or the legs ran out, the cast.
        expect(epilogue?.actions).toContain('retaliate off');
        expect(epilogue?.actions.some(a => a.startsWith('teleported'))).toBe(true);
        expect(sends.some(s => s.type === 'clickComponent')).toBe(true);
    });

    test('with no spell it keeps walking past the leg cap instead of holding', async () => {
        // Every way is blocked: retaliate on would hold once the directions are spent.
        const off = await countWalks(false);
        const on = await countWalks(true);
        expect(off.epilogue?.actions).toContain('retaliate off');
        expect(off.walks).toBeGreaterThan(on.walks);
        expect(on.epilogue?.actions).not.toContain('retaliate off');
    });

    test('retaliate on holds after the legs', async () => {
        const tl = fighting(38).series(200, (w, i) => w.player({ hp: 38, lastDamageTick: i }));
        const { epilogue, sends } = await run(tl);
        expect(sends.filter(s => s.type === 'walkTo').length).toBeLessThanOrEqual(MAX_FLEE_LEGS);
        expect(epilogue?.actions).not.toContain('retaliate off');
    });
});

describe("epilogue: the bot's own fight", () => {
    test('HP fine and the only foe is its own target: holds, never walks', async () => {
        const tl = own(35).series(40, (w, i) => w.player({ lastDamageTick: i }));
        const { epilogue, sends } = await run(tl);
        expect(sends.filter(s => s.type === 'walkTo')).toEqual([]);
        expect(epilogue?.ended).toBe('timeout');
    });

    test('below the eat line it eats on', async () => {
        const tl = own(10)
            .inv('Shrimps', 2)
            .series(40, (w, i) => w.player({ lastDamageTick: i }));
        const { sends } = await run(tl);
        expect(sends[0]).toMatchObject({ type: 'useInventoryItem', reason: 'Eat Shrimps' });
    });
});

describe('epilogue: a leg that does not shake the fight', () => {
    test('HP fell and the foe is still on it: holds after the first leg', async () => {
        const tl = fighting(38)
            .inv('Shrimps', 4)
            .series(100, (w, i) => w.player({ hp: Math.max(30, 38 - i), lastDamageTick: i }));
        const { sends } = await run(tl);
        expect(sends.filter(s => s.type === 'walkTo')).toHaveLength(1);
    });
});

describe('epilogue: teleport on losing', () => {
    test('a one-point drop after a leg is not losing', async () => {
        const base = fighting(38).skill('Magic', 31, 0).inv('Air rune', 3).inv('Earth rune', 1).inv('Law rune', 1);
        const tl = base.series(60, (w, i) => w.player({ hp: i >= 2 ? 37 : 38, lastDamageTick: i }));
        const { sends } = await run(tl);
        expect(sends.filter(s => s.type === 'clickComponent')).toEqual([]);
    });
});

describe('epilogue: death', () => {
    test('a death message during it is `died`, not `safe`', async () => {
        const tl = fighting(10)
            .inv('Shrimps', 1)
            .series(20, (w, i) =>
                i >= 4
                    ? calm(40)
                          .message('Oh dear, you are dead!')
                          .player({ at: { x: 3222, z: 3218 } })
                    : w,
            );
        const { epilogue } = await run(tl);
        expect(epilogue?.ended).toBe('died');
    });
});

describe('a cut-short epilogue keeps its record', () => {
    test('out of time keeps the actions so far and hpBefore', async () => {
        // The clock jumps past the budget while the bot holds after its walk legs.
        const tl = fighting(30)
            .series(60, (w, i) => w.player({ lastDamageTick: i }))
            .map((s, i) => ({ ...s, tick: i < 14 ? i : EPILOGUE_TICKS + EPILOGUE_GRACE_TICKS + 20 }));
        const { epilogue } = await run(tl);
        expect(epilogue?.ended).toBe('out of time');
        expect(epilogue?.hpBefore).toBe(30);
        expect(epilogue?.actions.some(a => a.startsWith('walked'))).toBe(true);
    });
});

describe('a driver that throws mid-epilogue', () => {
    test('keeps hpBefore and the actions, with the error as cutShort and null hp when state is unreadable', async () => {
        const driver = new TimelineDriver(fighting(30).series(1), { react: walking(undefined, () => true) });
        const real = driver.state.bind(driver);
        let calls = 0;
        driver.state = () => {
            if (++calls > 12) throw new Error('SDK disconnected mid-run');
            return real();
        };
        const r = await runEpilogue(driver, { pathfinder: straightPaths(), walkWorld: noCrossings() });
        expect(r).not.toBeNull();
        expect(r!.ended).toBe('cut short');
        expect(r!.cutShort).toContain('SDK disconnected');
        expect(r!.hpBefore).toBe(30);
        expect(r!.hpAfter).toBeNull();
        expect(r!.inCombat).toBeNull();
    });
});

describe('result helpers', () => {
    const e = {
        actions: ['ate'],
        ended: 'safe' as const,
        hpBefore: 10,
        hpAfter: 30,
        maxHp: 40,
        inCombat: false,
        ticks: 12,
    };
    const result = {
        status: 'failed' as const,
        reason: 'x',
        durationMs: 5,
        hp: { current: 10, max: 40 },
        inCombat: true,
        finalPos: { x: 1, z: 2, level: 0 },
    } as unknown as Parameters<typeof withEpilogueResult>[0];

    test('merges the epilogue and the bot as it now stands, keeping status and reason', () => {
        const s = calm(30)
            .player({ at: { x: 3200, z: 3201 } })
            .build();
        const r = withEpilogueResult(result, e, s);
        expect(r).toMatchObject({
            status: 'failed',
            reason: 'x',
            durationMs: 5,
            epilogue: e,
            finalPos: { x: 3200, z: 3201, level: 0 },
            hp: { current: 30, max: 40 },
            inCombat: false,
        });
    });

    test('without a state it only adds the epilogue', () => {
        expect(withEpilogueResult(result, e, null)).toEqual({ ...result, epilogue: e });
    });

    test('summary line carries the ended value and any cut-short text', () => {
        expect(epilogueSummary(e)).toBe('epilogue: ate (safe), hp 30/40, inCombat false');
        expect(epilogueSummary({ ...e, actions: [], ended: 'cut short', cutShort: 'aborted by x' })).toContain(
            'nothing done (cut short: aborted by x)',
        );
    });

    test('trackSafeSpot seeds from the current state and follows updates until stopped', () => {
        const listeners: ((s: BotWorldState) => void)[] = [];
        let unsubscribed = false;
        const t = trackSafeSpot({
            getState: () =>
                calm(30)
                    .player({ at: { x: 3200, z: 3200 } })
                    .build(),
            onStateUpdate: l => {
                listeners.push(l);
                return () => {
                    unsubscribed = true;
                };
            },
        });
        expect(t.spot()).toEqual({ x: 3200, z: 3200, level: 0 });
        listeners[0]!(
            fighting(30)
                .player({ at: { x: 3210, z: 3210 } })
                .build(),
        );
        expect(t.spot()).toEqual({ x: 3200, z: 3200, level: 0 });
        t.stop();
        expect(unsubscribed).toBe(true);
    });
});
