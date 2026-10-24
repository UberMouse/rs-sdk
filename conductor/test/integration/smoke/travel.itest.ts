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
            {
                position: STONE_CIRCLE,
                skills: { Hitpoints: 30 },
                inventory: Array.from({ length: 4 }, () => ({ id: Items.SHRIMPS, count: 1 })),
            },
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

// Edgeville bank to just past the Wilderness ditch (z 3520), on the road north; no other test stands here.
const EDGEVILLE = { x: 3094, z: 3492 };
const WILDERNESS_GOAL = { x: 3094, z: 3575 };

test(
    'travel enters the Wilderness only with wilderness: true',
    async () => {
        await withFixtureBot(
            { position: EDGEVILLE, inventory: Array.from({ length: 3 }, () => ({ id: Items.SHRIMPS, count: 1 })) },
            async ({ name }) => {
                const refused = await runTask(name, 'travel', { to: WILDERNESS_GOAL }, ['minutes:1']);
                expect(refused.result.reason ?? '', refused.stderr).toContain('is in the Wilderness');
                const run = await runTask(name, 'travel', { to: WILDERNESS_GOAL, wilderness: true }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const p = run.result.finalPos!;
                expect(
                    Math.max(Math.abs(p.x - WILDERNESS_GOAL.x), Math.abs(p.z - WILDERNESS_GOAL.z)),
                    detail,
                ).toBeLessThanOrEqual(3);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

// Varrock Sewers: the way east to the moss giants is closed by a slashable web at (3210, 9898), the only link
// (the Edgeville Dungeon side ends at a wall at x 3152). Start at the sewer ladder's landing; the goal is a
// tile west of the web that no route reaches without crossing it (an offline flood fill).
// Combat 99 so nothing in the sewers hunts the bot.
const SEWER_LADDER = { x: 3237, z: 9859 };
const BEYOND_WEB = { x: 3201, z: 9881 };
const WEAPON_SLOT = 3;
const MITHRIL_SCIMITAR = 1329;
const SEWER_FIGHTER = { Attack: 99, Strength: 99, Defence: 99, Hitpoints: 99 };

test(
    'travel slashes the sewer web open and reaches the tiles beyond it',
    async () => {
        await withFixtureBot(
            {
                position: SEWER_LADDER,
                skills: SEWER_FIGHTER,
                equipment: [{ id: MITHRIL_SCIMITAR, count: 1, slot: WEAPON_SLOT }],
            },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: BEYOND_WEB, tolerance: 1 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const p = run.result.finalPos!;
                expect(
                    Math.max(Math.abs(p.x - BEYOND_WEB.x), Math.abs(p.z - BEYOND_WEB.z)),
                    detail,
                ).toBeLessThanOrEqual(1);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);

test(
    'travel beyond the sewer web with no slash weapon fails saying so',
    async () => {
        await withFixtureBot(
            { position: SEWER_LADDER, skills: SEWER_FIGHTER },
            async ({ name }) => {
                const run = await runTask(name, 'travel', { to: BEYOND_WEB, tolerance: 1 }, ['minutes:4']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('failed');
                expect(run.result.reason, detail).toContain('No slash weapon');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
