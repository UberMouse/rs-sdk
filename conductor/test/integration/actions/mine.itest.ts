import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { MINE_OPTION, MINE_WAIT_TICKS, mine } from '../../../actions/mine';
import { countItems, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// South-west Varrock mine: tin rocks (loc ids 2094/2095 are rock1/rock2) from server/content/maps/m49_52.jm2.
// None is in the mining smoke test's area ((3285,3365) radius 8) and no other test mines here, so only
// an earlier run of this one leaves a rock depleted.
const ROCKS = [
    { x: 3172, z: 3366 },
    { x: 3173, z: 3365 },
    { x: 3173, z: 3366 },
    { x: 3176, z: 3369 },
];
const SPAWN = { x: 3175, z: 3367 };
/** A mined tin rock respawns in 10 ticks (mine.dbrow); generous for slow ticks. */
const RESPAWN_WAIT_MS = 30_000;
const TIN = /^tin ore$/i;
const TIN_ROCK_IDS = [2094, 2095, 2123, 2124];

const standing = (s: BotWorldState) =>
    s.nearbyLocs
        .filter(l => TIN_ROCK_IDS.includes(l.id) && l.reachable === true && l.options.some(o => MINE_OPTION.test(o)))
        .filter(l => ROCKS.some(r => r.x === l.x && r.z === l.z))
        .sort((a, b) => a.distance - b.distance);

test(
    'mine takes ore from a rock and gains the ore and XP',
    async () => {
        await withFixtureBot(
            { position: SPAWN, skills: { Mining: 1 }, inventory: [{ id: Items.BRONZE_PICKAXE, count: 1 }] },
            async ({ sdk }) => {
                const ready = await sdk.waitForCondition(s => standing(s).length > 0, RESPAWN_WAIT_MS);
                const rock = standing(ready)[0]!;
                expect(countItems(ready, TIN)).toBe(0);
                const xpBefore = sdk.getSkillXp('Mining') ?? 0;

                const r = await runLive(sdk, ctx => mine(ctx, rock, TIN));
                expect(r, `mine at (${rock.x},${rock.z})`).toEqual({ ok: true });
                expect(countItems(sdk.getState()!, TIN)).toBe(1);
                expect(sdk.getSkillXp('Mining') ?? 0).toBeGreaterThan(xpBefore);
            },
        );
    },
    itestTimeout({ extraMs: RESPAWN_WAIT_MS + MINE_WAIT_TICKS * TICK_MS }),
);
