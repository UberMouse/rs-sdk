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
import { readObjNames } from '../../../wiki/world/model/items';
import { fromWorldMethod, measuredFigures, methodModel } from '../../../wiki/world/model/method';
import type { Tools } from '../../../wiki/world/model/profile';
import type { Skill } from '../../../wiki/world/model/server';
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
import { readConfigs } from '../../../wiki/world/sources/configs';

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

/**
 * The phase runs' starts, by log file: run-1 started at Mining 60 and picked up a rune pickaxe in its second phase;
 * run-2 started at Mining 62 holding none.
 */
const STARTS: Record<string, RunStart> = {
    'mining-10': { levels: { mining: 60, smithing: 40 }, held: ['Bronze pickaxe'] },
    'bank-20': { levels: { mining: 60 }, held: ['Rune pickaxe', 'Iron ore'] },
    'mining-50': { levels: { mining: 62 }, held: [] },
};
/** Both runs started at Mining 60 with the rune pickaxe. */
const SAME: Record<string, RunStart> = { ...STARTS, 'mining-50': { levels: { mining: 60 }, held: ['Rune pickaxe'] } };

/** A floor of 4,000 XP/h per Mining level the run started at. */
const perLevel = (_: unknown, m: Measured) => ({ xpPerHour: { mining: m.level.mining! * 4_000 } }) as CycleRates;

/** The game's obj config names by display name. */
const OBJ_NAMES = readObjNames(readConfigs('obj'));
/** The worn objs each method here reads: a melee method every one, a superheat one the staff of fire, others none. */
const WORN_READ: Record<string, 'all' | ReadonlySet<string>> = {
    giants: 'all',
    superheat: new Set(['staff_of_fire']),
};

function input(o: Partial<MethodRunsInput> = {}): MethodRunsInput {
    return {
        bot: 'tester',
        command: 'stats.ts tester --methods',
        methods: [IRON],
        results: RESULTS,
        start: r => STARTS[r.logFile],
        tools: TOOLS,
        wornRead: m => WORN_READ[m.id] ?? new Set(),
        objName: OBJ_NAMES,
        floor: perLevel,
        ...o,
    };
}

/** A melee method over the iron-bulk runs (the plan's name is all methodRuns matches on). */
const GIANTS = {
    id: 'giants',
    plans: ['iron-bulk'],
    skill: 'attack' as const,
    levels: { attack: 40, strength: 1, defence: 1, hitpoints: 10 },
};
/** The base levels of the seven skills the combat level is taken from. */
const COMBAT = { attack: 60, strength: 55, defence: 50, hitpoints: 58, prayer: 43, ranged: 30, magic: 33 };
/** A start at COMBAT and Mining 70, wearing `worn` (by display name), with `o` over those levels. */
const fighter = (worn: string[], o: Record<string, number> = {}): RunStart => ({
    levels: { ...COMBAT, mining: 70, ...o },
    held: ['Lobster', ...worn],
    worn,
});
const SCIMITAR = fighter(['Rune scimitar', 'Amulet of power']);
/** Every phase run of run-1 starts at `run1`, of run-2 at `run2`. */
const byRun = (run1: RunStart, run2: RunStart) => (run: TimedResult) => (run.partOf === 'run-1' ? run1 : run2);

/** The GIANTS entry of run-1 started at SCIMITAR and run-2 at `run2`. */
const giantsEntry = (run2: RunStart) =>
    methodRuns(input({ methods: [GIANTS], start: byRun(SCIMITAR, run2) }))[0]!.entry;

/** SAME, run-1 wearing `worn` and run-2 nothing. */
const dressed = (worn: string[]): Record<string, RunStart> => ({
    ...SAME,
    'mining-10': { ...SAME['mining-10']!, worn },
    'mining-50': { ...SAME['mining-50']!, worn: [] },
});
/** A start at Magic 50 and Smithing 40, wearing `worn`. */
const caster = (worn: string[]): RunStart => ({ levels: { magic: 50, smithing: 40 }, held: worn, worn });

describe('methodRuns', () => {
    test("the method's plans' whole runs: its skills' XP over their total hours, other plans and skills left out", () => {
        const [r] = methodRuns(input());
        // (60,000 + 40,000) Mining XP over 2 x 0.5 h; Smithing is not the method's, chop-burn not its plan.
        expect(r).toMatchObject({ method: 'iron-bank', runs: 2, hours: 1, xpPerHour: { mining: 100_000 } });
        expect(r!.last).toBe(new Date(60).toISOString().slice(0, 10));
    });

    test("each run's start levels are its first phase run's; the range covers later starts and level-ups", () => {
        const [r] = methodRuns(input());
        expect(r!.perRun.map(p => [p.runId, p.levels])).toEqual([
            ['run-1', { mining: 60 }],
            ['run-2', { mining: 62 }],
        ]);
        // run-1 ended at 61, run-2 started at 62.
        expect(r!.levelRange).toEqual({ mining: [60, 62] });
        expect(methodRuns(input({ start: run => SAME[run.logFile] }))[0]!.levelRange).toEqual({ mining: [60, 61] });
    });

    test("a run's tool is the best one held at any of its phase runs' starts that the checker allows at its level", () => {
        expect(methodRuns(input())[0]!.perRun.map(p => p.tool)).toEqual(['rune_pickaxe', null]);
        // At Mining 35 the rune pickaxe (41) is above the level: the bronze one is the best usable.
        const low: Record<string, RunStart> = {
            ...STARTS,
            'mining-10': { levels: { mining: 35 }, held: ['Bronze pickaxe'] },
        };
        expect(methodRuns(input({ start: r => low[r.logFile] }))[0]!.perRun[0]!.tool).toBe('bronze_pickaxe');
    });

    test("the gap is the runs' XP over the XP each run's floor at its own start makes in its hours", () => {
        const [r] = methodRuns(input());
        // run-1: floor 60 x 4,000 = 240,000/h x 0.5 h = 120,000 XP; measured 60,000 = 50%.
        // run-2: floor 62 x 4,000 = 248,000/h x 0.5 h = 124,000 XP; measured 40,000 = 32.3%.
        // All: 100,000 / (120,000 + 124,000) = 40.98% -> 41%. Floor 244,000 XP over 1 h = 244,000/h,
        // 144,000/h above the measured 100,000/h. (The earliest run's floor alone, 240,000/h, would read 41.7%.)
        expect(r!.perRun.map(p => [p.floor, p.pct])).toEqual([
            [{ mining: 240_000 }, { mining: 50 }],
            [{ mining: 248_000 }, { mining: 32.3 }],
        ]);
        expect(r!.floor).toEqual({ mining: 244_000 });
        expect(r!.gap).toEqual({ mining: { pct: 41, shortfall: 144_000 } });
    });

    test('runs with no recorded start count in neither side of the gap', () => {
        const [r] = methodRuns(input({ start: run => (run.partOf === 'run-1' ? undefined : STARTS[run.logFile]) }));
        // run-2 alone: 40,000 XP / (248,000/h x 0.5 h = 124,000 XP) = 32.3%; 80,000/h measured, 168,000/h short.
        expect([r!.excluded, r!.counted]).toEqual([1, { runs: 1, hours: 0.5, xpPerHour: { mining: 80_000 } }]);
        expect(r!.xpPerHour).toEqual({ mining: 100_000 });
        expect(r!.floor).toEqual({ mining: 248_000 });
        expect(r!.gap).toEqual({ mining: { pct: 32.3, shortfall: 168_000 } });
    });

    test('the entry is withheld when the runs started at different levels, or with different tools', () => {
        expect(methodRuns(input())[0]!.entry).toBeUndefined();
        const tools: Record<string, RunStart> = { ...SAME, 'mining-50': { levels: { mining: 60 }, held: [] } };
        expect(methodRuns(input({ start: r => tools[r.logFile] }))[0]!.entry).toBeUndefined();
    });

    test('the entry is present when every counted run started at the same levels and tool, and is what the floor is rated at', () => {
        const seen: Measured[] = [];
        const [r] = methodRuns(
            input({
                start: run => SAME[run.logFile],
                floor: (m, measured) => {
                    seen.push(measured);
                    return perLevel(m, measured);
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
        // Each run's floor is rated at its own start levels and tool.
        expect(seen.map(m => [m.level, m.tool])).toEqual([
            [{ mining: 60 }, 'rune_pickaxe'],
            [{ mining: 60 }, 'rune_pickaxe'],
        ]);
        // 100,000 XP / (240,000/h x 1 h) = 41.7%.
        expect(r!.gap).toEqual({ mining: { pct: 41.7, shortfall: 140_000 } });
    });

    test('a run with no tool held leaves the tool out of the entry', () => {
        const none = methodRuns(input({ start: r => ({ ...SAME[r.logFile]!, held: [] }) }))[0]!;
        expect([none.toolKind, none.entry?.tool, none.entry?.level]).toEqual(['pickaxe', undefined, { mining: 60 }]);
    });

    test('since leaves out the plan runs before it', () => {
        expect(methodRuns(input({ since: 31 }))[0]).toMatchObject({ runs: 1, xpPerHour: { mining: 80_000 } });
    });

    test('a floor that throws is reported with its run; no floor or gap, the entry kept', () => {
        const [r] = methodRuns(
            input({
                start: run => SAME[run.logFile],
                floor: () => {
                    throw new Error('mining needs a pickaxe');
                },
            }),
        );
        expect(r!.floorError).toBe('run run-1: mining needs a pickaxe');
        expect(r!.perRun[1]!.floorError).toBe('mining needs a pickaxe');
        expect([r!.floor, r!.gap]).toEqual([undefined, {}]);
        expect(r!.entry).toBeDefined();
    });

    describe('a combat method: worn objs and every combat-level skill', () => {
        test("the entry records every combat-level skill and the worn objs by config name, the floor's too", () => {
            const seen: Measured[] = [];
            const [r] = methodRuns(
                input({
                    methods: [GIANTS],
                    start: byRun(SCIMITAR, SCIMITAR),
                    floor: (_, m, skill) => {
                        if (skill === 'attack') seen.push(m);
                        return { xpPerHour: {} } as CycleRates;
                    },
                }),
            );
            // Prayer, Ranged and Magic are trained by no melee style but set the combat level; Mining is left out.
            expect(r!.entry).toMatchObject({ level: COMBAT, worn: ['rune_scimitar', 'amulet_of_power'] });
            expect(r!.entry!.tool).toBeUndefined();
            expect(seen.map(m => [m.level, m.worn])).toEqual([
                [COMBAT, ['rune_scimitar', 'amulet_of_power']],
                [COMBAT, ['rune_scimitar', 'amulet_of_power']],
            ]);
            expect(formatMeasured(r!.entry!, r!.toolKind)).toContain("    worn: ['rune_scimitar', 'amulet_of_power'],");
        });

        test("each trained skill's floor is rated for that skill, its style the best for it", () => {
            // A stub whose style for each skill trains only that skill: 1,000 XP/h of it, none of the others.
            const asked: string[] = [];
            const [r] = methodRuns(
                input({
                    methods: [GIANTS],
                    start: byRun(SCIMITAR, SCIMITAR),
                    floor: (_, __, skill) => {
                        asked.push(skill);
                        return { xpPerHour: { [skill]: 1_000 } } as unknown as CycleRates;
                    },
                }),
            );
            expect(asked.slice(0, 4)).toEqual(['attack', 'strength', 'defence', 'hitpoints']);
            expect(r!.perRun[0]!.floor).toEqual({ attack: 1_000, strength: 1_000, defence: 1_000, hitpoints: 1_000 });
            expect(r!.floor).toEqual({ attack: 1_000, strength: 1_000, defence: 1_000, hitpoints: 1_000 });
        });

        test('runs that wore different objs, or started at a different untrained combat skill, have no entry', () => {
            expect(giantsEntry(fighter(['Rune scimitar']))).toBeUndefined();
            expect(giantsEntry(fighter(['Rune scimitar', 'Amulet of power'], { prayer: 44 }))).toBeUndefined();
            // A Mining level, which a melee method neither trains nor reads, doesn't split them.
            expect(giantsEntry(fighter(['Rune scimitar', 'Amulet of power'], { mining: 71 }))).toBeDefined();
        });

        test('a start recorded before worn objs were read wore what an empty one did', () => {
            const unread = { ...SCIMITAR, worn: undefined };
            const bare = fighter([]);
            const r = methodRuns(input({ methods: [GIANTS], start: byRun(unread, bare) }))[0]!;
            expect(r.entry).toBeDefined();
            expect(r.entry!.worn).toBeUndefined();
        });

        test('display names map through the obj configs; one that maps to none is a line to fill and no floor', () => {
            // `Pirate's hook` is the config piratehook, not pirate's_hook; no obj is named `Dragon dagger(p++)`.
            const start = fighter(['Amulet of glory(4)', "Pirate's hook", 'Dragon dagger(p++)']);
            const r = methodRuns(input({ methods: [GIANTS], start: byRun(start, start) }))[0]!;
            expect(r.entry!.worn).toEqual(['amulet_of_glory_4', 'piratehook']);
            expect(r.unnamedWorn).toEqual(['Dragon dagger(p++)']);
            expect(r.perRun[0]!.floorError).toBe(
                'worn Dragon dagger(p++): no one obj config has that name, so no floor',
            );
            const lines = formatMeasured(r.entry!, r.toolKind, '', r.unnamedWorn);
            expect(lines).toContain("    worn: ['amulet_of_glory_4', 'piratehook'],");
            expect(lines).toContain("    // worn: '<FILL IN: the obj config name of Dragon dagger(p++)>',");
        });

        test("a run's row names its worn objs", () => {
            const lines = formatMethodRuns(
                methodRuns(input({ methods: [GIANTS], start: byRun(fighter(['Rune scimitar']), fighter([])) })),
            );
            expect(lines.find(l => l.includes(' run-1 '))).toContain('worn rune_scimitar');
            expect(lines.find(l => l.includes(' run-2 '))).not.toContain('worn');
        });
    });

    describe('a skilling method: only the worn objs its families read', () => {
        test('mining runs in different armour, a pickaxe wielded or not, still make one entry, wearing none', () => {
            const r = methodRuns(input({ start: run => dressed(['Iron full helm', 'Rune pickaxe'])[run.logFile] }))[0]!;
            expect(r.entry).toBeDefined();
            expect(r.entry!.worn).toBeUndefined();
            expect(r.perRun.map(p => p.worn)).toEqual([undefined, undefined]);
        });

        test('a superheat pair with and without the staff of fire splits; the staff alone is recorded', () => {
            const SUPER = {
                id: 'superheat',
                plans: ['iron-bulk'],
                skill: 'magic' as const,
                levels: { magic: 43, smithing: 30 },
            };
            const entry = (run1: string[], run2: string[]) =>
                methodRuns(input({ methods: [SUPER], start: byRun(caster(run1), caster(run2)) }))[0]!.entry;
            expect(entry(['Staff of fire', 'Iron full helm'], ['Iron full helm'])).toBeUndefined();
            expect(entry(['Staff of fire', 'Iron full helm'], ['Staff of fire'])!.worn).toEqual(['staff_of_fire']);
        });
    });

    test('a method with no runs, or none with a recording, has no entry', () => {
        expect(methodRuns(input({ methods: [LURE] }))[0]).toMatchObject({ method: 'lure-cook', runs: 0 });
        const [r] = methodRuns(input({ start: () => undefined }));
        expect([r!.runs, r!.excluded, r!.counted, r!.entry]).toEqual([2, 2, undefined, undefined]);
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
    const date = new Date(60).toISOString().slice(0, 10);

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

    test('runs at one level and tool: the gap and the entry; the methods without runs on one line', () => {
        const other = { ...LURE, id: 'other' };
        const lines = formatMethodRuns(
            methodRuns(input({ methods: [IRON, LURE, other], start: r => SAME[r.logFile] })),
        );
        expect(lines.slice(0, 5)).toEqual([
            `iron-bank (plans: iron-bulk) · runs 2 · 1.00 h · last ${date}`,
            '  mining: measured 100,000/h · floor 240,000/h · 41.7% of floor, 140,000/h short',
            "  levels moved over the runs: mining 60-61 (each run's floor is at its start levels, so one that levelled understates)",
            '  every run started at mining 60, rune_pickaxe',
            '  measured entry (methods.ts):',
        ]);
        expect(lines[5]).toStartWith('    {\n        xpPerHour: { mining: 100_000 },');
        expect(lines.at(-1)).toBe('no runs: lure-cook, other');
    });

    test('runs at different levels: a table of the runs and the --since hint, no entry', () => {
        expect(formatMethodRuns(methodRuns(input()))).toEqual([
            `iron-bank (plans: iron-bulk) · runs 2 · 1.00 h · last ${date}`,
            '  mining: measured 100,000/h · floor 244,000/h · 41% of floor, 144,000/h short',
            "  levels moved over the runs: mining 60-62 (each run's floor is at its start levels, so one that levelled understates)",
            '  the runs started at different levels, pickaxes or worn objs:',
            `    ${date} run-1 · mining 60 · rune_pickaxe · 0.50 h · mining 120,000/h of 240,000/h (50%)`,
            `    ${date} run-2 · mining 62 · no pickaxe held · 0.50 h · mining 80,000/h of 248,000/h (32.3%)`,
            '  narrow --since to runs at one level for a pasteable measured entry',
        ]);
    });

    test('runs with no recorded start: counted and named, the gap over the rest', () => {
        const lines = formatMethodRuns(
            methodRuns(input({ start: run => (run.partOf === 'run-1' ? undefined : STARTS[run.logFile]) })),
        );
        expect(lines.slice(1, 3)).toEqual([
            '  1 run (0.50 h) with no recorded start left out of the floor and gap below; all runs measured mining 100,000/h',
            '  mining: measured 80,000/h · floor 248,000/h · 32.3% of floor, 168,000/h short',
        ]);
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
            expect(runStart(start)).toEqual({
                levels: { mining: 60 },
                held: ['Rune pickaxe', 'Bronze axe'],
                worn: ['Bronze axe'],
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an empty or another-version recording is refused at once', () => {
        const dir = mkdtempSync(join(tmpdir(), 'methods-start-'));
        try {
            const log = join(dir, 'run.ndjson');
            writeFileSync(join(dir, 'run.ticks.ndjson.gz'), '');
            expect(() => readStartState(log)).toThrow(/empty recording/);
            // A short header of version 0 ahead of 200 KB of random hex: more than the first read, refused on it.
            const lines = [
                { k: 'h', v: 0, at: 1 },
                { k: 'p', d: { blob: randomBytes(100_000).toString('hex') } },
            ];
            writeFileSync(
                join(dir, 'run.ticks.ndjson.gz'),
                gzipSync(lines.map(l => JSON.stringify(l) + '\n').join('')),
            );
            expect(() => readStartState(log)).toThrow(/not a version 1 recording/);
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
        // Every skill a figure measured, not only the method's own: a combat method rates each for its best style.
        for (const wm of WORLD.methods) {
            const m = fromWorldMethod(wm, WORLD);
            const skills = new Set((wm.measured ?? []).flatMap(e => Object.keys(e.xpPerHour) as Skill[]));
            for (const skill of skills)
                for (const f of measuredFigures(m, skill, ctx)) {
                    expect(floor(wm, f.measured, skill).xpPerHour[skill] ?? 0).toBe(f.floor);
                    checked++;
                }
        }
        expect(checked).toBeGreaterThan(0);
    });
});
