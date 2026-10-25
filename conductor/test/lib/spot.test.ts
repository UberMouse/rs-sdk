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
