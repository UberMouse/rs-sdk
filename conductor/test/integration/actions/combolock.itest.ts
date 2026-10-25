import { expect, test } from 'bun:test';
import { lockOpen, readWheels, solveCombolock } from '../../../actions/combolock';
import { interactLoc } from '../../../actions/interact';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { wait } from '../../../core/op';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { itestTimeout, withFixtureBot } from '../harness';

// Handelmort Mansion, a tile south of the Tribal Totem lock door (combodoor, 2634,3323): the same spot as the
// combolock smoke test (the tribal door's lock persists per account, and each fixture bot is a fresh account).
const MANSION = { x: 2634, z: 3322 };
const DOOR = { x: 2634, z: 3323 };
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

test(
    'solveCombolock reads the real wheels, sets them and the game accepts the word',
    async () => {
        await withFixtureBot({ position: MANSION, varps: { 200: 2 } }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(
                s => s.nearbyLocs.some(l => l.x === DOOR.x && l.z === DOOR.z),
                30_000,
            );
            const door = ready.nearbyLocs.find(l => l.x === DOOR.x && l.z === DOOR.z)!;
            const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
            try {
                const opened = await interpret(
                    (function* () {
                        yield* interactLoc(door, /^open$/i);
                        return yield* wait('lock open', lockOpen, 20);
                    })(),
                    { driver },
                );
                expect(opened.kind).toBe('returned');
                // A fresh lock shows A on every wheel.
                expect(readWheels(sdk.getState()!)).toEqual([0, 0, 0, 0]);

                const wrong = await interpret(solveCombolock(driver, 'ABCD', { confirmCursor: null }), { driver });
                expect(wrong).toMatchObject({ kind: 'returned', value: { ok: false, reason: 'wrong' } });
                expect(lockOpen(sdk.getState()!)).toBe(false);
            } finally {
                driver.close();
            }
        });
    },
    itestTimeout({ extraMs: 120_000 }),
);
