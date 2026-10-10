import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { FISH_WAIT_TICKS, fish } from '../../../actions/fish';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItems, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

// Draynor Village net spots (server/content/maps/m48_50.jm2): (3085,3230) and (3086,3227). Stand south and fish the
// nearer, southern one: the dark wizards at (3084,3236) reach a low-combat bot at the northern tile.
const SHORE = { x: 3087, z: 3227 };
const SHRIMPS = /^raw shrimps$/i;
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

const netSpots = (s: BotWorldState) =>
    s.nearbyNpcs
        .filter(n => /^fishing spot$/i.test(n.name) && n.options.some(o => /^net$/i.test(o)))
        .sort((a, b) => a.distance - b.distance);

test(
    'fish nets a shrimp at a Draynor spot',
    async () => {
        await withFixtureBot(
            { position: SHORE, skills: { Fishing: 1 }, inventory: [{ id: Items.SMALL_FISHING_NET, count: 1 }] },
            async ({ sdk }) => {
                const ready = await sdk.waitForCondition(s => netSpots(s).length > 0, 30_000);
                const spot = netSpots(ready)[0]!;
                expect(countItems(ready, SHRIMPS)).toBe(0);

                const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
                try {
                    const r = await interpret(fish(driver, spot, /^net$/i, [SHRIMPS]), { driver });
                    // The spot may hop mid-wait; a catch is the normal result.
                    if (r.kind === 'returned' && !r.value.ok && r.value.reason === 'spot-moved') return;
                    expect(r, `fish at (${spot.x},${spot.z})`).toEqual({ kind: 'returned', value: { ok: true } });
                } finally {
                    driver.close();
                }
                expect(countItems(sdk.getState()!, SHRIMPS)).toBe(1);
            },
        );
    },
    itestTimeout({ extraMs: FISH_WAIT_TICKS * TICK_MS }),
);
