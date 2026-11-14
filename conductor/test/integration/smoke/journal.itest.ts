import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

test(
    "journal task reads a fresh account's not-started Cook's Assistant journal and closes it",
    async () => {
        await withFixtureBot(
            {},
            async ({ name }) => {
                const run = await runTask(name, 'journal', { quest: 'cook' }, ['minutes:1']);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toMatch(/^journal: .*Cook/);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 1 }),
);
