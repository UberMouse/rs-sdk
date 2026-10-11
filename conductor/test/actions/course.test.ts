import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { courseSectionOf, crossObstacle, GNOME, LEAVE_ATTEMPT_TICKS, leaveCourse } from '../../actions/course';
import type { Effect } from '../../core/drivers/timeline';
import { world } from '../world';
import { runOp } from './harness';

const branchDown = world()
    .skill('Agility', 1, 0)
    .loc('Tree branch', 2486, 3419, { level: 2, options: ['Climb-down'] });
const onSection = branchDown.player({ at: { x: 2483, z: 3420, level: 2 } });
const states = (w: BotWorldState, n = 3) => Array.from({ length: n }, (_, i) => ({ ...w, tick: i }));
const down: Effect = t =>
    world(t)
        .player({ at: { x: 2487, z: 3420, level: 0 } })
        .skill('Agility', 1, 125)
        .build();
const isLoc = (a: BotAction) => a.type === 'interactLoc';

describe('courseSectionOf', () => {
    test('level 0 is never on a section, whatever the tile', () => {
        expect(
            courseSectionOf(
                world()
                    .player({ at: { x: 2483, z: 3420, level: 0 } })
                    .build(),
            ),
        ).toBeUndefined();
    });

    test('a raised tile outside the section box is on no course', () => {
        expect(
            courseSectionOf(
                world()
                    .player({ at: { x: 3200, z: 3200, level: 1 } })
                    .build(),
            ),
        ).toBeUndefined();
    });

    test('a raised tile inside the box is on the gnome course', () => {
        const s = courseSectionOf(onSection.build());
        expect(s?.name).toBe('gnome');
        expect(s?.course).toBe(GNOME);
    });
});

describe('leaveCourse', () => {
    test('off a section there is nothing to cross', async () => {
        const r = await runOp(states(world().build()), ctx => leaveCourse(ctx));
        expect(r.result).toEqual({ ok: true, crossed: 0 });
        expect(r.sends).toEqual([]);
    });

    test('on a section it crosses the next obstacle and is done on the ground', async () => {
        const r = await runOp(states(onSection.build()), ctx => leaveCourse(ctx), {
            react: a => (isLoc(a) ? down : undefined),
        });
        expect(r.result).toEqual({ ok: true, crossed: 1 });
        expect(r.sends.filter(isLoc)).toHaveLength(1);
    });

    test('with too few ticks left it is no-time and sends nothing', async () => {
        const r = await runOp(states(onSection.build()), ctx =>
            leaveCourse({ state: () => ctx.state(), stepTicksLeft: () => LEAVE_ATTEMPT_TICKS }, 1),
        );
        expect(r.result).toMatchObject({ ok: false, reason: 'no-time' });
        expect(r.sends).toEqual([]);
    });

    test('a raised spot no obstacle leads on from fails', async () => {
        const w = world().player({ at: { x: 2483, z: 3420, level: 3 } });
        const r = await runOp(states(w.build()), ctx => leaveCourse(ctx));
        expect(r.result).toMatchObject({ ok: false, reason: 'failed' });
        expect(r.sends).toEqual([]);
    });
});

describe('crossObstacle', () => {
    test('an obstacle whose loc is nowhere (scene, scan, map data) is not-found', async () => {
        const branch = GNOME.obstacles.find(o => o.label === 'branch down')!;
        const w = world().player({ at: { x: 2483, z: 3420, level: 2 } });
        const r = await runOp(states(w.build()), ctx => crossObstacle(ctx, branch), { scan: () => [] });
        expect(r.result).toMatchObject({ ok: false, reason: 'not-found' });
        expect(r.sends).toEqual([]);
    });
});
