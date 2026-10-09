import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { recordingFile } from '../../../core/drivers/recording';
import { REPO_ROOT } from '../../../lib/env';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Lumbridge trees: the verified training spot in wiki/skills/woodcutting.md.
const TREES = { x: 3195, z: 3220 };
/** Spawning bun and replaying a few minutes of recording. */
const REPLAY_MS = 60_000;

test(
    'a recorded woodcutting run replays with no divergence against the code that ran it',
    async () => {
        await withFixtureBot(
            { position: TREES, skills: { Woodcutting: 1 }, inventory: [{ id: Items.BRONZE_AXE, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'woodcutting',
                    { tree: 'tree', area: { x: TREES.x, z: TREES.z, radius: 12 }, onFull: 'drop' },
                    ['xp:Woodcutting:75', 'minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                const file = recordingFile(run.result.logFile);
                expect(existsSync(file), detail).toBe(true);

                const replay = Bun.spawn([process.execPath, 'conductor/tools/replay.ts', file], {
                    cwd: REPO_ROOT,
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                const [stdout, stderr, code] = await Promise.all([
                    new Response(replay.stdout).text(),
                    new Response(replay.stderr).text(),
                    replay.exited,
                ]);
                const output = `${stdout}${stderr}`;
                expect(code, output).toBe(0);
                expect(stdout, output).toMatch(/^no divergence: \d+ commands matched and both runs ended done: /m);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2, extraMs: REPLAY_MS }),
);
