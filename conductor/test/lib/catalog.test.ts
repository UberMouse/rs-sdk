import { describe, expect, test } from 'bun:test';
import { relative } from 'node:path';
import { loadTask, TASKS_DIR } from '../../lib/catalog';

describe('loadTask', () => {
    test('a directory relative to the working directory loads', async () => {
        const rel = relative(process.cwd(), TASKS_DIR);
        expect(rel.startsWith('/')).toBe(false);
        expect((await loadTask('woodcutting', rel)).name).toBe('woodcutting');
    });

    test('a bad name and a missing task are refused', async () => {
        await expect(loadTask('../x')).rejects.toThrow('bad task name');
        await expect(loadTask('no-such-task')).rejects.toThrow();
    });
});
