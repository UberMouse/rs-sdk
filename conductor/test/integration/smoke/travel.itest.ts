import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { disconnectQuietly } from '../../../lib/env';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Open ground south-east of the Lumbridge cow field gate; a short walk with a waypoint.
const LUMBRIDGE = { x: 3225, z: 3230 };
const WAYPOINT = { x: 3240, z: 3262 };
const GOAL = { x: 3262, z: 3285 };
// East of the Gnome Stronghold gate (2459,3383), outside its fence; the course start (2474,3436) is inside.
const OUTSIDE_GATE = { x: 2506, z: 3390 };
const COURSE = { x: 2474, z: 3436 };
// Just east of the Varrock stone circle, where the dark wizards (aggressive, level 7 and 20) attack a
// low-combat bot; no other test stands here. FLEE_TO is about 20 tiles south-east, out of their reach.
const STONE_CIRCLE = { x: 3233, z: 3373 };
const FLEE_TO = { x: 3253, z: 3355 };
const ATTACKED_WAIT_MS = 60_000;

test(
    'travel walks a short leg through a waypoint',
    async () => {
        await withFixtureBot(
            { position: LUMBRIDGE },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: GOAL, waypoints: [WAYPOINT] }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos, detail).not.toBeNull();
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - GOAL.x), Math.abs(p.z - GOAL.z)), detail).toBeLessThanOrEqual(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'travel passes the Gnome Stronghold gate (and Femi at it) into the course',
    async () => {
        await withFixtureBot(
            { position: OUTSIDE_GATE },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: COURSE, tolerance: 4 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.stepRuns['gnome-gate'], detail).toBe(1);
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - COURSE.x), Math.abs(p.z - COURSE.z)), detail).toBeLessThanOrEqual(4);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

test(
    'travel flees an attacker',
    async () => {
        // Combat level about 8 (Hitpoints 30), well under twice a dark wizard's level, so they are aggressive.
        await withFixtureBot(
            { position: STONE_CIRCLE, skills: { Hitpoints: 30 }, inventory: [{ id: Items.SHRIMPS, count: 4 }] },
            async ({ name, sdk }) => {
                const fight = await sdk.waitForCondition(s => !!s.player?.combat.inCombat, ATTACKED_WAIT_MS);
                expect(fight.player?.combat.inCombat, 'the bot is attacked before the run').toBe(true);
                // The run-task subprocess takes the control connection.
                await disconnectQuietly(sdk);
                const run = await runTask(name, 'travel', { to: FLEE_TO, flee: true }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.stepRuns['interrupt:under-attack'], detail).toBeUndefined();
                const p = run.result.finalPos!;
                expect(Math.max(Math.abs(p.x - FLEE_TO.x), Math.abs(p.z - FLEE_TO.z)), detail).toBeLessThanOrEqual(3);
            },
        );
    },
    itestTimeout({ taskMinutes: 3, extraMs: ATTACKED_WAIT_MS }),
);

test(
    'travel flees an attacker at low HP with no food',
    async () => {
        // No food, and the wizards wear the bot below half its HP before the run starts: the low-hp guard
        // must not end a flee run while it is under fire. The setup depends on their hits landing, so a bot that
        // never gets hurt that way (or dies first) leaves nothing to test and the test returns early.
        await withFixtureBot({ position: STONE_CIRCLE, skills: { Hitpoints: 30 } }, async ({ name, sdk }) => {
            const hurt = await sdk
                .waitForCondition(
                    s => !!s.player?.combat.inCombat && s.player.hp > 0 && s.player.hp < s.player.maxHp / 2,
                    ATTACKED_WAIT_MS * 2,
                )
                .catch(() => null);
            if (!hurt?.player || hurt.player.hp <= 0) {
                console.warn('travel low-HP flee: the bot was not hurt (or died) in time; nothing to test');
                return;
            }
            await disconnectQuietly(sdk);
            const run = await runTask(name, 'travel', { to: FLEE_TO, flee: true }, ['minutes:3']);
            const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
            // The run ends done on arrival or at its minute limit (once out of the fight the guard rests to
            // regenerate, slow at Hitpoints 30); either way it must not fail with the low-hp guard's reason.
            expect(run.result.reason ?? '', detail).not.toContain('low-hp');
            expect(run.result.status, detail).toBe('done');
            expect(run.result.stepRuns.walk, detail).toBeGreaterThan(0);
        });
    },
    itestTimeout({ taskMinutes: 3, extraMs: ATTACKED_WAIT_MS * 2 }),
);
