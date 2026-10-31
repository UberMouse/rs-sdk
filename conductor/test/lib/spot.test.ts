import { describe, expect, test } from 'bun:test';
import { AtSchema } from '../../lib/spot';
import interact from '../../tasks/interact';
import talk from '../../tasks/talk';
import { walking } from '../react';
import { simulate } from '../simulate';
import { world } from '../world';

const params = (at: object) => ({
    target: 'loc',
    name: '^Ladder$',
    option: '^Climb-up$',
    at: { x: 3416, z: 3487, level: 1, ...at },
});

describe('the shared `at`: met', () => {
    test('is an optional list of requirement tokens', () => {
        expect(AtSchema.parse({ x: 1, z: 2 }).met).toBeUndefined();
        expect(AtSchema.parse({ x: 1, z: 2, met: ['quest:priestperil>=4'] }).met).toEqual(['quest:priestperil>=4']);
        expect(AtSchema.safeParse({ x: 1, z: 2, met: 'quest:priestperil>=4' }).success).toBe(false);
    });

    // The Paterdomus temple's Large door opens from outside from Priest in Peril stage 4 (the world graph's gate row);
    // the bot cannot read the stage, so a walk to the floor above plans through it only when the plan says so.
    const OUTSIDE = world().player({ at: { x: 3400, z: 3489 } });

    test('without met the step does not plan through the stage-gated door', async () => {
        const r = await simulate(interact, { params: params({}), timeline: OUTSIDE.series(1), react: walking() });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/can't walk to .*No connector/);
        expect(r.sends).toEqual([]);
    });

    test('with met the walk is planned through the door, to the stairs', async () => {
        const r = await simulate(interact, {
            params: params({ met: ['quest:priestperil>=4'] }),
            timeline: OUTSIDE.series(1),
            react: walking(),
        });
        // The scripted world has no staircase in sight, so the climb fails; the walk to its stand tile was planned.
        expect(r.sends[0]).toBe('walk to (3417, 3486)');
        expect(r.result.reason).not.toMatch(/No connector/);
    });
});

const talkParams = (met?: string[]) => ({
    npc: '^Drezel$',
    at: { x: 3416, z: 3487, level: 1, ...(met ? { met } : {}) },
});

describe('the shared `at`: met on talk', () => {
    const OUTSIDE = world().player({ at: { x: 3400, z: 3489 } });
    test('without met the talk walk does not plan through the stage-gated door', async () => {
        const r = await simulate(talk, { params: talkParams(), timeline: OUTSIDE.series(1), react: walking() });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/can't walk to .*No connector/);
    });

    test('with met the talk walk is planned through the door', async () => {
        const r = await simulate(talk, {
            params: talkParams(['quest:priestperil>=4']),
            timeline: OUTSIDE.series(1),
            react: walking(),
        });
        expect(r.sends[0]).toBe('walk to (3417, 3486)');
        expect(r.result.reason).not.toMatch(/No connector/);
    });
});

describe('the shared `at`: an exact tile', () => {
    test('tolerance 0 is that exact tile; below 0 is refused', () => {
        expect(AtSchema.parse({ x: 1, z: 2, tolerance: 0 }).tolerance).toBe(0);
        expect(AtSchema.safeParse({ x: 1, z: 2, tolerance: -1 }).success).toBe(false);
    });

    // The Blue Moon Inn chest (3218, 3396) is used from (3219, 3396) only, a wall between that tile and the room
    // next door (3219, 3397): a tolerance of 1 would count the room as there.
    const chest = world().loc('Chest', 3218, 3396, { options: ['Open'] });
    const room = world().player({ at: { x: 3219, z: 3397 } });
    const exact = { target: 'loc', name: '^Chest$', option: '^Open$', at: { x: 3219, z: 3396, tolerance: 0 } };

    test('a bot one tile off is not there: the walk step runs', async () => {
        const r = await simulate(interact, {
            params: exact,
            timeline: room.series(1, () => chest.player({ at: { x: 3219, z: 3397 } })),
            react: walking(),
        });
        expect(r.steps[0]).toBe('walk');
        expect(r.sends[0]).toBe('walk to (3219, 3396)');
    });

    test('with tolerance 1 the same bot counts as there and interacts', async () => {
        const r = await simulate(interact, {
            params: { ...exact, at: { ...exact.at, tolerance: 1 } },
            timeline: room.series(1, () => chest.player({ at: { x: 3219, z: 3397 } })),
            react: walking(),
        });
        expect(r.steps[0]).toBe('interact');
    });
});
