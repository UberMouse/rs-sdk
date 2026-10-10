import { describe, expect, test } from 'bun:test';
import { errorResult } from '../../lib/run-cli';
import { selectResults, type TimedResult } from '../../lib/runs';

/** A logged result: `t` when it was written, `partOf` for a plan's phase run. */
const logged = (t: number, task: string, partOf?: string): TimedResult => ({
    ...errorResult({ task, bot: 'tester', params: {}, ...(partOf !== undefined && { partOf }) }, 'r', 1000),
    status: 'done',
    t,
});

// One chop-burn plan whose phases ran woodcutting then firemaking, and a woodcutting run on its own.
const RESULTS = [
    logged(1, 'woodcutting', 'plan-1'),
    logged(2, 'firemaking', 'plan-1'),
    logged(3, 'plan:chop-burn'),
    logged(4, 'woodcutting'),
];
const tasks = (rs: TimedResult[]) => rs.map(r => `${r.t} ${r.task}`);

describe('selectResults', () => {
    test('counts a plan once, by its own result, and leaves its phase runs out', () => {
        expect(tasks(selectResults(RESULTS))).toEqual(['3 plan:chop-burn', '4 woodcutting']);
    });

    test('phases: true counts the phase runs as well', () => {
        expect(tasks(selectResults(RESULTS, { phases: true }))).toEqual([
            '1 woodcutting',
            '2 firemaking',
            '3 plan:chop-burn',
            '4 woodcutting',
        ]);
    });

    test('task and since narrow either way', () => {
        expect(tasks(selectResults(RESULTS, { task: 'woodcutting' }))).toEqual(['4 woodcutting']);
        expect(tasks(selectResults(RESULTS, { task: 'woodcutting', phases: true }))).toEqual([
            '1 woodcutting',
            '4 woodcutting',
        ]);
        expect(tasks(selectResults(RESULTS, { task: 'plan:chop-burn' }))).toEqual(['3 plan:chop-burn']);
        expect(tasks(selectResults(RESULTS, { since: 2, phases: true }))).toEqual([
            '2 firemaking',
            '3 plan:chop-burn',
            '4 woodcutting',
        ]);
    });
});
