import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { fillContainer } from '../../../actions/fill';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItems } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

// The Lumbridge castle courtyard fountain (wiki: water_sources.loc `fountain`); it never runs dry, so
// other tests may use it at the same time.
const SPAWN = { x: 3220, z: 3212 };
const BUCKET = 1925;
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

const fountain = (s: BotWorldState) =>
    s.nearbyLocs
        .filter(l => /^fountain$/i.test(l.name) && l.reachable !== false)
        .sort((a, b) => a.distance - b.distance)[0];

test(
    'fillContainer turns an empty bucket into a bucket of water at the fountain',
    async () => {
        await withFixtureBot({ position: SPAWN, inventory: [{ id: BUCKET, count: 1 }] }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => !!fountain(s), 15_000);
            const source = fountain(ready)!;
            const empty = ready.inventory.find(i => i.id === BUCKET)!;
            const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
            try {
                const r = await interpret(fillContainer(driver, empty, source), { driver });
                expect(r, `fill at (${source.x},${source.z})`).toEqual({ kind: 'returned', value: { ok: true } });
            } finally {
                driver.close();
            }
            expect(countItems(sdk.getState()!, /^bucket of water$/i)).toBe(1);
            expect(countItems(sdk.getState()!, /^bucket$/i)).toBe(0);
        });
    },
    itestTimeout({ extraMs: 30_000 }),
);
