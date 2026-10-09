import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { CHOP_OPTION, CHOP_WAIT_TICKS, chop } from '../../../actions/chop';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItems, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

// Normal trees north of Lumbridge castle, as captured in conductor/test/fixtures/lumbridge.json. None
// is in the woodcutting smoke test's grove ((3195,3220) radius 12) and no other test chops, so only an
// earlier run of this one leaves a stump here.
const TREES = [
    { x: 3217, z: 3231 },
    { x: 3212, z: 3232 },
    { x: 3225, z: 3232 },
    { x: 3235, z: 3230 },
];
const SPAWN = { x: 3220, z: 3228 };
/** A felled normal tree respawns within 80s (wiki/skills/woodcutting.md). */
const RESPAWN_WAIT_MS = 90_000;
const LOGS = /^logs$/i;
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

const standing = (s: BotWorldState) =>
    s.nearbyLocs
        .filter(l => /^tree$/i.test(l.name) && l.options.some(o => CHOP_OPTION.test(o)))
        .filter(l => TREES.some(t => t.x === l.x && t.z === l.z))
        .sort((a, b) => a.distance - b.distance);

test(
    'chop fells a tree and gains its log',
    async () => {
        await withFixtureBot(
            // High enough to fell a normal tree within a few attempts, so the chop never nears its wait.
            { position: SPAWN, skills: { Woodcutting: 60 }, inventory: [{ id: Items.BRONZE_AXE, count: 1 }] },
            async ({ sdk }) => {
                const ready = await sdk.waitForCondition(s => standing(s).length > 0, RESPAWN_WAIT_MS);
                const tree = standing(ready)[0]!;
                expect(countItems(ready, LOGS)).toBe(0);

                const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
                try {
                    const r = await interpret(chop(driver, tree, LOGS), { driver });
                    expect(r, `chop at (${tree.x},${tree.z})`).toEqual({ kind: 'returned', value: { ok: true } });
                } finally {
                    driver.close();
                }
                expect(countItems(sdk.getState()!, LOGS)).toBe(1);
            },
        );
    },
    itestTimeout({ extraMs: RESPAWN_WAIT_MS + CHOP_WAIT_TICKS * TICK_MS }),
);
