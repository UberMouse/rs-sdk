import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

test(
    'wait task waits its ticks out and ends done',
    async () => {
        await withFixtureBot(
            {},
            async ({ name }) => {
                const run = await runTask(name, 'wait', { ticks: 5 }, ['minutes:1']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toBe('wait: waited 5 ticks');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 1 }),
);
