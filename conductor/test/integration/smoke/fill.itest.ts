import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// The Lumbridge castle courtyard fountain (3221,3210); it never runs dry, so other tests may share it.
const COURTYARD = { x: 3220, z: 3212 };
const BUCKET = 1925;
const JUG = 1935;

test(
    'fill task fills every bucket and then the jugs',
    async () => {
        await withFixtureBot(
            {
                position: COURTYARD,
                inventory: [
                    { id: BUCKET, count: 1 },
                    { id: BUCKET, count: 1 },
                    { id: BUCKET, count: 1 },
                    { id: JUG, count: 1 },
                    { id: JUG, count: 1 },
                ],
            },
            async ({ name }) => {
                const buckets = await runTask(name, 'fill', { container: 'Bucket' }, ['minutes:2']);
                const detail = `${JSON.stringify(buckets.result)}\n${buckets.stderr}`;
                expect(buckets.result.status, detail).toBe('done');
                expect(buckets.result.inventoryDelta, detail).toEqual({ Bucket: -3, 'Bucket of water': 3 });

                const jugs = await runTask(name, 'fill', { container: 'Jug' }, ['minutes:2']);
                const jugDetail = `${JSON.stringify(jugs.result)}\n${jugs.stderr}`;
                expect(jugs.result.status, jugDetail).toBe('done');
                expect(jugs.result.inventoryDelta, jugDetail).toEqual({ Jug: -2, 'Jug of water': 2 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
