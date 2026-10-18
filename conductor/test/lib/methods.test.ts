import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { BotWorldState } from '../../../sdk/types';
import type { Measured } from '../../../wiki/world/methods';
import type { CycleRates } from '../../../wiki/world/model/cycle';
import { readGameData } from '../../../wiki/world/model/families/index';
import { fromWorldMethod, measuredFigures, methodModel } from '../../../wiki/world/model/method';
import type { Tools } from '../../../wiki/world/model/profile';
import {
    checkPlanMethods,
    formatMeasured,
    formatMethodRuns,
    measuredFloor,
    type MethodRunsInput,
    methodRuns,
    type RunStart,
    runStart,
} from '../../lib/methods';
import { errorResult } from '../../lib/run-cli';
import { readStartState, type TimedResult } from '../../lib/runs';
import { WORLD } from '../../lib/world-index';

describe('checkPlanMethods', () => {
    test('a link both sides record passes; a plan with no method is only listed', () => {
        expect(
            checkPlanMethods(
                [{ name: 'iron-bulk', method: 'iron-bank' }, { name: 'chop-burn' }],
                [{ id: 'iron-bank', plans: ['iron-bulk'] }, { id: 'iron-drop' }],
            ),
        ).toEqual({ errors: [], unlinked: ['chop-burn'] });
    });

    test('a plan naming a method world.json lacks, or one that does not list it back, fails', () => {
        expect(
            checkPlanMethods(
                [
                    { name: 'a', method: 'gone' },
                    { name: 'b', method: 'iron-drop' },
                ],
                [{ id: 'iron-drop' }],
            ).errors,
        ).toEqual([
            'plan a names method gone, which world.json does not have',
            'plan b names method iron-drop, whose plans (none) leave it out',
        ]);
    });

    test('a method listing a plan that is not promoted, or that names another method or none, fails', () => {
        expect(
            checkPlanMethods(
                [{ name: 'b', method: 'other' }, { name: 'c' }],
                [
                    { id: 'm', plans: ['a', 'b', 'c'] },
                    { id: 'other', plans: ['b'] },
                ],
            ).errors,
        ).toEqual([
            'method m lists plan a, which is no promoted plan',
            'method m lists plan b, which names other',
            'method m lists plan c, which names no method',
        ]);
    });
});

const HOUR = 3_600_000;
const TOOLS: Tools = {
    axe: [{ obj: 'rune_axe', level: 0 }],
    pickaxe: [
        { obj: 'rune_pickaxe', level: 41 },
        { obj: 'adamant_pickaxe', level: 31 },
        { obj: 'bronze_pickaxe', level: 1 },
    ],
};
const IRON = { id: 'iron-bank', plans: ['iron-bulk'], skill: 'mining' as const, levels: { mining: 15 } };
const LURE = {
    id: 'lure-cook',
    plans: ['lure-cook-bank'],
    skill: 'fishing' as const,
    levels: { fishing: 20, cooking: 25 },
};

/** A logged result: a plan run's (`partOf` absent) or one of its phase runs'. */
function result(
    t: number,
    task: string,
    o: Partial<Pick<TimedResult, 'runId' | 'partOf' | 'durationMs' | 'xpGained' | 'levelsGained'>> = {},
): TimedResult {
    const base = errorResult({ task, bot: 'tester', params: {} }, 'r', o.durationMs ?? 1000);
    return { ...base, status: 'done', runId: o.runId ?? `${task}-${t}`, logFile: `${o.runId ?? task}-${t}`, ...o, t };
}

/** Two iron-bulk runs of half an hour, their phase runs, and a run of another plan. */
const RESULTS: TimedResult[] = [
    result(10, 'mining', { partOf: 'run-1' }),
    result(20, 'bank', { partOf: 'run-1' }),
    result(30, 'plan:iron-bulk', {
        runId: 'run-1',
        durationMs: HOUR / 2,
        xpGained: { Mining: 60_000, Smithing: 9_999 },
        levelsGained: { Mining: { from: 60, to: 61 } },
    }),
    result(40, 'plan:chop-burn', { runId: 'run-x', durationMs: HOUR, xpGained: { Mining: 1 } }),
    result(50, 'mining', { partOf: 'run-2' }),
    result(60, 'plan:iron-bulk', { runId: 'run-2', durationMs: HOUR / 2, xpGained: { Mining: 40_000 } }),
];

/** The phase runs' starts, by log file: run-1 started at Mining 60 and picked up a rune pickaxe in its second phase. */
const STARTS: Record<string, RunStart> = {
    'mining-10': { levels: { mining: 60, smithing: 40 }, held: ['Bronze pickaxe'] },
    'bank-20': { levels: { mining: 60 }, held: ['Rune pickaxe', 'Iron ore'] },
    'mining-50': { levels: { mining: 62 }, held: [] },
};

function input(o: Partial<MethodRunsInput> = {}): MethodRunsInput {
    return {
        bot: 'tester',
        command: 'stats.ts tester --methods',
        methods: [IRON],
        results: RESULTS,
        start: r => STARTS[r.logFile],
        tools: TOOLS,
        floor: () => ({ xpPerHour: { mining: 200_000 } }) as unknown as CycleRates,
        ...o,
    };
}

describe('methodRuns', () => {
    test("the method's plans' whole runs: its skills' XP over their total hours, other plans and skills left out", () => {
        const [r] = methodRuns(input());
        // (60,000 + 40,000) Mining XP over 2 x 0.5 h; Smithing is not the method's, chop-burn not its plan.
        expect(r).toMatchObject({ method: 'iron-bank', runs: 2, hours: 1, xpPerHour: { mining: 100_000 } });
        expect(r!.last).toBe(new Date(60).toISOString().slice(0, 10));
    });

    test("the start levels are the earliest run's first phase run's; the range covers later starts and level-ups", () => {
        const [r] = methodRuns(input());
        expect(r!.start).toEqual({ runId: 'run-1', levels: { mining: 60 } });
        // run-1 ended at 61, run-2 started at 62.
        expect(r!.levelRange).toEqual({ mining: [60, 62] });
    });

    test('the earliest run with no recording is passed over for the next', () => {
        const [r] = methodRuns(input({ start: run => (run.partOf === 'run-1' ? undefined : STARTS[run.logFile]) }));
        expect(r!.start).toEqual({ runId: 'run-2', levels: { mining: 62 } });
    });

    test('the tool is the best one held at any phase run start that the checker allows at the start level', () => {
        expect(methodRuns(input())[0]!.tool).toBe('rune_pickaxe');
        // At Mining 35 the rune pickaxe (41) is above the level: the bronze one is the best usable.
        const low: Record<string, RunStart> = {
            ...STARTS,
            'mining-10': { levels: { mining: 35 }, held: ['Bronze pickaxe'] },
        };
        expect(methodRuns(input({ start: r => low[r.logFile] }))[0]!.tool).toBe('bronze_pickaxe');
        const none = methodRuns(input({ start: r => ({ ...STARTS[r.logFile]!, held: [] }) }))[0]!;
        expect([none.toolKind, none.tool, none.entry?.tool]).toEqual(['pickaxe', null, undefined]);
    });

    test('the entry is what the floor is rated at, and the gap is measured over floor', () => {
        const seen: Measured[] = [];
        const [r] = methodRuns(
            input({
                floor: (_, m) => {
                    seen.push(m);
                    return { xpPerHour: { mining: 250_000.4 } } as unknown as CycleRates;
                },
            }),
        );
        expect(r!.entry).toEqual({
            xpPerHour: { mining: 100_000 },
            level: { mining: 60 },
            tool: 'rune_pickaxe',
            bot: 'tester',
            date: new Date(60).toISOString().slice(0, 10),
            hours: 1,
            from: 'stats.ts tester --methods',
        });
        expect(seen).toEqual([r!.entry!]);
        // 100,000 / 250,000 = 40%; 150,000/h short.
        expect(r!.floor).toEqual({ mining: 250_000 });
        expect(r!.gap).toEqual({ mining: { pct: 40, shortfall: 150_000 } });
    });

    test('since leaves out the plan runs before it', () => {
        expect(methodRuns(input({ since: 31 }))[0]).toMatchObject({ runs: 1, xpPerHour: { mining: 80_000 } });
    });

    test('a floor that throws is reported, the entry kept', () => {
        const [r] = methodRuns(
            input({
                floor: () => {
                    throw new Error('mining needs a pickaxe');
                },
            }),
        );
        expect(r!.floorError).toBe('mining needs a pickaxe');
        expect(r!.entry).toBeDefined();
    });

    test('a method with no runs, or none with a recording, has no entry', () => {
        expect(methodRuns(input({ methods: [LURE] }))[0]).toMatchObject({ method: 'lure-cook', runs: 0 });
        const [r] = methodRuns(input({ start: () => undefined }));
        expect([r!.runs, r!.start, r!.entry]).toEqual([2, undefined, undefined]);
    });
});

describe('formatMeasured / formatMethodRuns', () => {
    const entry: Measured = {
        xpPerHour: { fishing: 433_771, cooking: 601_217 },
        level: { fishing: 48, cooking: 53 },
        bot: 'conductor2',
        date: '2026-10-11',
        hours: 0.5031,
        from: 'stats.ts conductor2 --methods',
    };

    test('an entry reads as methods.ts writes one', () => {
        expect(formatMeasured(entry, null)).toBe(
            [
                '{',
                '    xpPerHour: { fishing: 433_771, cooking: 601_217 },',
                '    level: { fishing: 48, cooking: 53 },',
                "    bot: 'conductor2',",
                "    date: '2026-10-11',",
                '    hours: 0.5031,',
                "    from: 'stats.ts conductor2 --methods',",
                '},',
            ].join('\n'),
        );
    });

    test('a tool the method reads but no run showed is a marked line to fill', () => {
        expect(formatMeasured(entry, 'pickaxe')).toContain(
            "    // tool: '<FILL IN: the pickaxe the runs used, e.g. rune_pickaxe>',",
        );
        expect(formatMeasured({ ...entry, tool: 'adamant_pickaxe' }, 'pickaxe')).toContain(
            "    tool: 'adamant_pickaxe',",
        );
    });

    test('the report: a block per method with runs, one line per method without', () => {
        const lines = formatMethodRuns(methodRuns(input({ methods: [IRON, LURE] })));
        expect(lines.slice(0, 5)).toEqual([
            `iron-bank (plans: iron-bulk) · runs 2 · 1.00 h · last ${new Date(60).toISOString().slice(0, 10)}`,
            '  start levels mining 60 (run run-1); changed across the runs: mining 60-62',
            '  pickaxe rune_pickaxe',
            '  mining: measured 100,000/h · floor 200,000/h · 50% of floor, 100,000/h short',
            '  measured entry (methods.ts):',
        ]);
        expect(lines.at(-1)).toBe('lure-cook: no runs (plans: lure-cook-bank)');
    });

    test('a measured figure above the floor is flagged as a model bug', () => {
        const [r] = methodRuns(input({ floor: () => ({ xpPerHour: { mining: 80_000 } }) as unknown as CycleRates }));
        expect(formatMethodRuns([r!])).toContain(
            '  mining: measured 100,000/h · floor 80,000/h · 125% of floor, 20,000/h above it: a model bug to find',
        );
    });
});

describe('readStartState / runStart', () => {
    const state = {
        skills: [
            { name: 'Mining', level: 58, baseLevel: 60, experience: 273_742 },
            { name: 'Stat23', level: 1, baseLevel: 1, experience: 0 },
        ],
        inventory: [{ name: 'Rune pickaxe' }],
        equipment: [{ name: 'Bronze axe' }],
    };

    /** A recording of `header` then `state` then a command, next to log file `log`, as the Recorder writes one. */
    function recording(dir: string, params: unknown): string {
        const log = join(dir, 'run.ndjson');
        const lines = [
            { k: 'h', v: 1, run: { task: 'mining', bot: 'b', runId: 'r', logFile: log, params, stops: [] }, at: 1 },
            { k: 'p', d: state },
            { k: 'c', id: 1, tick: 1, cmd: { type: 'scan' } },
        ];
        writeFileSync(join(dir, 'run.ticks.ndjson.gz'), gzipSync(lines.map(l => JSON.stringify(l) + '\n').join('')));
        return log;
    }

    test("a run's first recorded state, read past a header longer than the first read", () => {
        const dir = mkdtempSync(join(tmpdir(), 'methods-start-'));
        try {
            // 200 KB of random hex compresses to ~100 KB: more than the 64 KB first read.
            const log = recording(dir, { blob: randomBytes(100_000).toString('hex') });
            const start = readStartState(log)!;
            expect(runStart(start)).toEqual({ levels: { mining: 60 }, held: ['Rune pickaxe', 'Bronze axe'] });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a run with no recording has no start', () => {
        expect(readStartState(join(tmpdir(), 'no-such-run.ndjson'))).toBeUndefined();
    });

    test('base levels, not boosted or drained ones', () => {
        expect(runStart(state as unknown as BotWorldState).levels).toEqual({ mining: 60 });
    });
});

describe('measuredFloor (world.json)', () => {
    test("each committed measured figure's floor is the one the training pages set it beside", () => {
        const model = methodModel(readGameData());
        const floor = measuredFloor(WORLD, model);
        const ctx = { world: WORLD, ...model };
        let checked = 0;
        for (const wm of WORLD.methods) {
            const figures = measuredFigures(fromWorldMethod(wm, WORLD), wm.skill, ctx);
            for (const f of figures) {
                expect(floor(wm, f.measured).xpPerHour[wm.skill] ?? 0).toBe(f.floor);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});
