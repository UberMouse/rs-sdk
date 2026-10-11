import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Barbarian Village, east of the potter's wheel (3087,3409) and its oven (3084,3407): ground floor, no gate.
const CLAY = 434;
const SOFT_CLAY = 1761;
const BUCKET_OF_WATER = 1929;
const BOWLS = 3;
/** Crafting XP of shaping a bowl: processexp 180 (18 xp) in pottery.struct, times the local server's 25x rate. */
const SHAPE_BOWL_XP = 18 * 25;
const items = (id: number, n: number) => Array.from({ length: n }, () => ({ id, count: 1 }));

test(
    'crafting task softens clay, shapes bowls at the wheel and fires them in the oven',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3090, z: 3409 },
                skills: { Crafting: 8 },
                inventory: [...items(SOFT_CLAY, 2), ...items(CLAY, 1), ...items(BUCKET_OF_WATER, 1)],
            },
            async ({ name }) => {
                const run = await runTask(name, 'crafting', { product: 'bowl' }, ['minutes:3']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.inventoryDelta.Clay, detail).toBe(-1);
                expect(run.result.inventoryDelta['Soft clay'], detail).toBe(-2);
                // 3 bowls are shaped (2 soft clay, 1 softened) and then fired, so none stay unfired. A firing can crack, so only the XP lower bound is asserted.
                expect(run.result.inventoryDelta['Unfired bowl'], detail).toBeUndefined();
                expect(run.result.xpGained.Crafting, detail).toBeGreaterThanOrEqual(BOWLS * SHAPE_BOWL_XP);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
