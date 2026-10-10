import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { REPO_ROOT } from '../../../lib/env';
import { INVENTORY_SLOTS } from '../../../lib/util';
import { itestTimeout, runPlan, withFixtureBot } from '../harness';

// The promoted chop-burn plan, ended by its own `until` after the second firemaking phase.
const PLAN = 'conductor/test/fixtures/plans/chop-burn-twice.ts';
// The woodcutting phase's area: the bot starts at the trees, so the first phase chops. Both spots are
// the ones woodcutting.itest.ts and firemaking.itest.ts use, and parallel tests share the engine, so
// another bot can cut these trees or light this field at the same time; MINUTES bounds such a run.
const TREES = { x: 3195, z: 3220 };
/** Free slots, so each chop -> burn cycle is this many logs. */
const FREE = 3;
/** How each phase run ends in a cycle (the tasks' result reasons). */
const ENDED = {
    woodcutting: new RegExp(`^stop-full: inventory full: ${FREE} logs$`),
    firemaking: new RegExp(`^finish: no Logs left to burn \\(lit ${FREE}\\)$`),
};
/** Unrelated items beside the axe and the tinderbox. */
const FILLER = INVENTORY_SLOTS - 2 - FREE;
/**
 * Combat ~12: the Giant spiders on the walk between the two spots attack a combat-3 bot, which can fail
 * a woodcutting phase and with it the plan, and leave one above combat 4 alone (learnings/hazards.md).
 */
const COMBAT = { Attack: 10, Strength: 10, Defence: 10, Hitpoints: 12 };
/** A backstop: two cycles take well under this, and the plan's `until` ends the run first. */
const MINUTES = 5;

const readEvents = (file: string): Record<string, any>[] =>
    readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));

test(
    'chop-burn plan runs two chop -> burn cycles',
    async () => {
        await withFixtureBot(
            {
                position: TREES,
                skills: { Woodcutting: 1, Firemaking: 1, ...COMBAT },
                inventory: [
                    { id: Items.BRONZE_AXE, count: 1 },
                    { id: Items.TINDERBOX, count: 1 },
                    ...Array.from({ length: FILLER }, () => ({ id: Items.BRONZE_BAR, count: 1 })),
                ],
            },
            async ({ name }) => {
                const run = await runPlan(name, PLAN, [`minutes:${MINUTES}`]);
                const { result } = run;
                const detail = `${JSON.stringify(result)}\n${run.stderr}`;
                expect(result.status, detail).toBe('done');
                expect(result.reason, detail).toBe('plan until met');
                const runs = (phase: string) => result.phases.find((p: { phase: string }) => p.phase === phase)?.runs;
                expect(runs('firemaking'), detail).toBe(2);
                expect(runs('woodcutting'), detail).toBeGreaterThanOrEqual(2);
                expect(result.xpGained.Woodcutting, detail).toBeGreaterThan(0);
                expect(result.xpGained.Firemaking, detail).toBeGreaterThan(0);

                // Each phase run the plan log names has its own log, whose result points back at the plan
                // and ended the cycle's way: chopping on a full inventory, burning on no logs left.
                const planLog = resolve(REPO_ROOT, result.logFile);
                const ends = readEvents(planLog).filter(e => e.type === 'phase-end');
                expect(ends.length, detail).toBe(runs('firemaking') + runs('woodcutting'));
                for (const end of ends) {
                    const phaseLog = join(dirname(planLog), `${end.runId}.ndjson`);
                    expect(existsSync(phaseLog), phaseLog).toBe(true);
                    const phaseResult = readEvents(phaseLog).find(e => e.type === 'result');
                    expect(phaseResult?.partOf, phaseLog).toBe(result.runId);
                    expect(phaseResult?.reason, phaseLog).toMatch(ENDED[end.phase as keyof typeof ENDED]);
                }
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: MINUTES }),
);
