import { resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { StateDecoder, readRecording, recordingFile } from '../../../core/drivers/recording';
import { REPO_ROOT } from '../../../lib/env';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Open Lumbridge fields east of the castle: a short walk nobody else's test stands on.
const START = { x: 3230, z: 3240 };
const GOAL = { x: 3237, z: 3247 };
const MELEE = 14;

/** The prayers on in the last state a run recorded. */
function prayersOnAtEnd(logFile: string): number[] {
    const decoder = new StateDecoder();
    let state: ReturnType<StateDecoder['decode']> | undefined;
    for (const rec of readRecording(recordingFile(resolve(REPO_ROOT, logFile))).records) {
        if (rec.k === 'p') state = decoder.decode(rec.d, rec.x);
    }
    return (state?.prayers.activePrayers ?? []).flatMap((on, i) => (on ? [i] : []));
}

test(
    'prayer keeps Protect from Melee on through a walk, then switches it off',
    async () => {
        await withFixtureBot(
            { position: START, skills: { Prayer: 70 } },
            async ({ name }) => {
                const on = await runTask(name, 'prayer', { on: ['Protect from Melee'] }, ['minutes:1']);
                const detail = (r: typeof on) => `${JSON.stringify(r.result)}\n${r.stderr}`;
                expect(on.result.status, detail(on)).toBe('done');
                expect(prayersOnAtEnd(on.result.logFile), detail(on)).toEqual([MELEE]);

                const walk = await runTask(name, 'travel', { to: GOAL }, ['minutes:2']);
                expect(walk.result.status, detail(walk)).toBe('done');
                expect(prayersOnAtEnd(walk.result.logFile), detail(walk)).toEqual([MELEE]);

                const off = await runTask(name, 'prayer', { off: ['Protect from Melee'] }, ['minutes:1']);
                expect(off.result.status, detail(off)).toBe('done');
                expect(prayersOnAtEnd(off.result.logFile), detail(off)).toEqual([]);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
