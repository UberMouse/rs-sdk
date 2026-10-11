import { expect, test } from 'bun:test';
import type { NearbyLoc } from '../../../../sdk/types';
import { obstacle } from '../../../actions/obstacle';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { itestTimeout, withFixtureBot } from '../harness';

// The Gnome Stronghold course (server/content/maps/m38_53.jm2); no other test goes there.
const START = { x: 2474, z: 3436 };
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };
/** The log balance sits on a bridge-flagged tile: the client never lists it, so the loc is built from the map. */
const LOG: NearbyLoc = {
    id: 2295,
    name: 'Log balance',
    x: 2474,
    z: 3435,
    level: 0,
    distance: 1,
    optionsWithIndex: [{ text: 'Walk-across', opIndex: 1 }],
    options: ['Walk-across'],
};

test(
    'obstacle walks the log balance and gains Agility XP on the far side',
    async () => {
        await withFixtureBot({ position: START, skills: { Agility: 1 } }, async ({ sdk }) => {
            const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
            try {
                const r = await interpret(obstacle(driver, LOG, /^walk-across$/i), { driver });
                expect(r.kind).toBe('returned');
                if (r.kind === 'returned') expect(r.value).toMatchObject({ ok: true });
            } finally {
                driver.close();
            }
            const s = sdk.getState()!;
            expect(s.skills.find(k => k.name === 'Agility')!.experience).toBeGreaterThan(0);
            expect(s.player!.worldZ).toBeLessThan(3432);
        });
    },
    itestTimeout({ taskMinutes: 1 }),
);
