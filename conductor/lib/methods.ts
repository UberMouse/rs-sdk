// The curated training methods (wiki/world/methods.ts, world.json `methods`) beside the conductor's plans: the link
// between a method and the promoted plans that run it (a plan's `method`, a method's `plans`), and what those plans'
// runs measured against the method's floor at the levels each run started on (`stats.ts --methods`).
//
// - The measured figure is the plans' whole runs: the XP of each skill the method trains over the runs' total time, a
//   plan counted once by its own `plan:<name>` result (runs.ts selectResults), so it covers the plan's every leg.
// - A run's start levels are read from the recording of its first phase run (its first state); its tool is the best
//   axe or pickaxe the woodcutting or mining checker would pick, at those levels, from what the bot held at the start
//   of any of its phase runs (inventory or worn), null when none shows one.
// - The gap weighs each run's floor at its own start by its hours, so runs at different levels each meet their own
//   floor. Runs with no recorded start count in neither side of it.
import type { BotWorldState } from '../../sdk/types';
import type { Measured } from '../../wiki/world/methods';
import type { CycleRates } from '../../wiki/world/model/cycle';
import { measuredProfile, type MethodModel } from '../../wiki/world/model/method';
import { bestTool, type Tools } from '../../wiki/world/model/profile';
import { SKILLS, type Skill } from '../../wiki/world/model/server';
import { methodQuery } from '../../wiki/world/query';
import type { World, WorldMethod } from '../../wiki/world/types';
import { selectResults, type TimedResult } from './runs';
import { errMessage } from './util';

/** The plan<->method link disagreements (`errors`), and the plans that name no method (`unlinked`, a to-do list). */
export function checkPlanMethods(
    plans: { name: string; method?: string }[],
    methods: Pick<WorldMethod, 'id' | 'plans'>[],
): { errors: string[]; unlinked: string[] } {
    const errors: string[] = [];
    const planByName = new Map(plans.map(p => [p.name, p]));
    const methodById = new Map(methods.map(m => [m.id, m]));
    for (const p of plans) {
        if (p.method === undefined) continue;
        const m = methodById.get(p.method);
        if (!m) errors.push(`plan ${p.name} names method ${p.method}, which world.json does not have`);
        else if (!m.plans?.includes(p.name))
            errors.push(
                `plan ${p.name} names method ${p.method}, whose plans (${m.plans?.join(', ') || 'none'}) leave it out`,
            );
    }
    for (const m of methods) {
        for (const name of m.plans ?? []) {
            const p = planByName.get(name);
            if (!p) errors.push(`method ${m.id} lists plan ${name}, which is no promoted plan`);
            else if (p.method !== m.id)
                errors.push(`method ${m.id} lists plan ${name}, which names ${p.method ?? 'no method'}`);
        }
    }
    return { errors, unlinked: plans.filter(p => p.method === undefined).map(p => p.name) };
}

/** What a run started with: its base levels and the items it held (inventory and worn). */
export interface RunStart {
    levels: Partial<Record<Skill, number>>;
    held: string[];
}

/** The game's skill name (`Mining`, a result's XP key) as a model Skill, or undefined for one the model has not. */
const skillOf = (name: string): Skill | undefined => SKILLS.find(s => s === name.toLowerCase());

export function runStart(state: BotWorldState): RunStart {
    const levels: Partial<Record<Skill, number>> = {};
    for (const k of state.skills) {
        const skill = skillOf(k.name);
        if (skill) levels[skill] = k.baseLevel;
    }
    return { levels, held: [...state.inventory, ...state.equipment].map(i => i.name) };
}

/** One plan run of a method. */
export interface MethodRun {
    runId: string;
    /** Its result's date (YYYY-MM-DD). */
    date: string;
    hours: number;
    /** Each skill the method trains: its XP over the run's time. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** The trained skills' base levels at its first phase run's start; absent when its recording shows none. */
    levels?: Partial<Record<Skill, number>>;
    /** The best tool of the method's kind it held at any of its phase runs' starts, at its start level; null when none. */
    tool: string | null;
    /** The floor's XP/hr at its start levels and tool (rounded), or why there is none. */
    floor?: Partial<Record<Skill, number>>;
    floorError?: string;
    /** Each trained skill with a floor: measured as a percentage of it. */
    pct: Partial<Record<Skill, number>>;
}

/** A method's plans' runs beside its floor. */
export interface MethodRuns {
    method: string;
    plans: string[];
    runs: number;
    hours: number;
    /** Each skill the method trains: its XP over all the runs' time. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** The last run's date (YYYY-MM-DD). */
    last?: string;
    /** Every run, oldest first. */
    perRun: MethodRun[];
    /** The runs the floor and gap count, those with a recorded start: their number, hours and XP/hr. */
    counted?: { runs: number; hours: number; xpPerHour: Partial<Record<Skill, number>> };
    /** Runs with no recorded start, left out of the floor and the gap. */
    excluded: number;
    /** Each trained skill whose level changed over the counted runs: the lowest start, the highest start or end. */
    levelRange: Partial<Record<Skill, [number, number]>>;
    /** The tool kind the method's family reads from the profile, or null when it reads none. */
    toolKind: 'axe' | 'pickaxe' | null;
    /** The counted runs' floor, each run's weighed by its hours; absent with no counted run, or one whose floor failed. */
    floor?: Partial<Record<Skill, number>>;
    /** The first counted run whose floor could not be rated, and why. */
    floorError?: string;
    /** Each trained skill with a floor: the counted runs' XP over their floors' XP, and the XP/hr short of it. */
    gap: Partial<Record<Skill, { pct: number; shortfall: number }>>;
    /** The `measured` entry for methods.ts: present when every counted run started at the same levels and tool. */
    entry?: Measured;
}

export interface MethodRunsInput {
    bot: string;
    /** The stats.ts command the figures come from: the entry's `from`. */
    command: string;
    methods: Pick<WorldMethod, 'id' | 'plans' | 'skill' | 'levels'>[];
    /** Every result of the bot, phase runs included, in time order (runs.ts loadResults). */
    results: TimedResult[];
    /** Only plan runs logged at or after this time (ms since the epoch). */
    since?: number;
    /** A phase run's start, from its recording; undefined when it has none. */
    start(phaseRun: TimedResult): RunStart | undefined;
    tools: Tools;
    /** The floor at a measured entry's profile (wiki/world/model/method.ts measuredProfile). */
    floor(method: Pick<WorldMethod, 'id' | 'skill'>, measured: Measured): CycleRates;
}

const HOUR_MS = 3_600_000;
const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
const perHourOf = (xp: number, hours: number): number => (hours > 0 ? Math.round(xp / hours) : 0);

/** Each method of `methods`, in their order, with what its plans' runs measured. */
export function methodRuns(input: MethodRunsInput): MethodRuns[] {
    const phaseRuns = new Map<string, TimedResult[]>();
    for (const r of input.results) {
        if (r.partOf === undefined) continue;
        const list = phaseRuns.get(r.partOf) ?? [];
        list.push(r);
        phaseRuns.set(r.partOf, list);
    }
    // Phase runs are sequential, so the earliest result is the first phase run.
    for (const list of phaseRuns.values()) list.sort((a, b) => a.t - b.t);
    const plans = selectResults(input.results, input.since === undefined ? {} : { since: input.since });
    return input.methods.map(m => methodRunsOf(m, plans, phaseRuns, input));
}

function methodRunsOf(
    m: MethodRunsInput['methods'][number],
    results: TimedResult[],
    phaseRuns: Map<string, TimedResult[]>,
    input: MethodRunsInput,
): MethodRuns {
    const skills = Object.keys(m.levels) as Skill[];
    const toolKind = m.skill === 'mining' ? 'pickaxe' : m.skill === 'woodcutting' ? 'axe' : null;
    const names = new Set((m.plans ?? []).map(p => `plan:${p}`));
    const runs = results.filter(r => names.has(r.task));
    const out: MethodRuns = {
        method: m.id,
        plans: m.plans ?? [],
        runs: runs.length,
        hours: 0,
        xpPerHour: {},
        perRun: [],
        excluded: 0,
        levelRange: {},
        toolKind,
        gap: {},
    };
    if (!runs.length) return out;

    const xpOf = (r: TimedResult): Partial<Record<Skill, number>> => {
        const xp: Partial<Record<Skill, number>> = {};
        for (const [name, n] of Object.entries(r.xpGained ?? {})) {
            const s = skillOf(name);
            if (s && skills.includes(s)) xp[s] = (xp[s] ?? 0) + n;
        }
        return xp;
    };
    const total: Partial<Record<Skill, number>> = {};
    const counted = { runs: 0, hours: 0, xp: {} as Partial<Record<Skill, number>> };
    // Each skill's XP the counted runs' floors would have made: Σ floor at the run's start × its hours.
    const expected: Partial<Record<Skill, number>> = {};
    let floorFailed = false;
    for (const r of runs) {
        const hours = r.durationMs / HOUR_MS;
        const xp = xpOf(r);
        out.hours += hours;
        for (const s of skills) total[s] = (total[s] ?? 0) + (xp[s] ?? 0);
        const run = runOf(m, r, hours, xp, phaseRuns.get(r.runId) ?? [], toolKind, skills, input);
        out.perRun.push(run.figures);
        if (!run.figures.levels) {
            out.excluded++;
            continue;
        }
        counted.runs++;
        counted.hours += hours;
        for (const s of skills) counted.xp[s] = (counted.xp[s] ?? 0) + (xp[s] ?? 0);
        widenLevelRange(out.levelRange, run.figures.levels, r, skills);
        if (!run.rates) {
            floorFailed = true;
            out.floorError ??= `run ${r.runId}: ${run.figures.floorError}`;
            continue;
        }
        for (const s of skills) expected[s] = (expected[s] ?? 0) + (run.rates[s] ?? 0) * hours;
    }
    for (const s of skills) {
        out.xpPerHour[s] = perHourOf(total[s] ?? 0, out.hours);
        const range = out.levelRange[s];
        if (range && range[0] === range[1]) delete out.levelRange[s];
    }
    out.last = day(runs.at(-1)!.t);
    if (!counted.runs) return out;

    out.counted = { runs: counted.runs, hours: counted.hours, xpPerHour: {} };
    for (const s of skills) out.counted.xpPerHour[s] = perHourOf(counted.xp[s] ?? 0, counted.hours);
    if (!floorFailed) {
        out.floor = {};
        for (const s of skills) {
            const floor = perHourOf(expected[s] ?? 0, counted.hours);
            out.floor[s] = floor;
            if (!expected[s]) continue;
            out.gap[s] = {
                pct: Math.round(((counted.xp[s] ?? 0) / expected[s]) * 1000) / 10,
                shortfall: floor - out.counted.xpPerHour[s]!,
            };
        }
    }

    const starts = out.perRun.filter(r => r.levels);
    const first = starts[0]!;
    const same = starts.every(r => r.tool === first.tool && skills.every(s => r.levels![s] === first.levels![s]));
    if (same)
        out.entry = {
            xpPerHour: out.counted.xpPerHour,
            level: first.levels!,
            ...(first.tool !== null && { tool: first.tool }),
            bot: input.bot,
            date: starts.at(-1)!.date,
            hours: Math.round(counted.hours * 10_000) / 10_000,
            from: input.command,
        };
    return out;
}

/** One plan run's figures, and its floor's unrounded rates when it has one. */
function runOf(
    m: MethodRunsInput['methods'][number],
    r: TimedResult,
    hours: number,
    xp: Partial<Record<Skill, number>>,
    phases: TimedResult[],
    toolKind: MethodRuns['toolKind'],
    skills: Skill[],
    input: MethodRunsInput,
): { figures: MethodRun; rates?: Partial<Record<Skill, number>> } {
    const figures: MethodRun = { runId: r.runId, date: day(r.t), hours, xpPerHour: {}, tool: null, pct: {} };
    for (const s of skills) figures.xpPerHour[s] = perHourOf(xp[s] ?? 0, hours);
    const starts = phases.map(input.start);
    const first = starts[0];
    if (!first) return { figures };
    const levels: Partial<Record<Skill, number>> = {};
    for (const s of skills) if (first.levels[s] !== undefined) levels[s] = first.levels[s];
    figures.levels = levels;
    if (toolKind) {
        const held = new Set(
            starts.flatMap(st => (st?.held ?? []).map(name => name.toLowerCase().replaceAll(' ', '_'))),
        );
        figures.tool = bestTool(
            input.tools[toolKind].filter(t => held.has(t.obj)),
            first.levels[m.skill] ?? 1,
        );
    }
    // The floor at the run's start levels: a run that levels up trains above them for part of its time, so this
    // floor understates what the run's levels made possible (levelRange shows where that happened).
    try {
        const rates = input.floor(m, {
            xpPerHour: figures.xpPerHour,
            level: levels,
            ...(figures.tool !== null && { tool: figures.tool }),
            bot: input.bot,
            date: figures.date,
            hours,
            from: input.command,
        }).xpPerHour;
        figures.floor = {};
        for (const s of skills) {
            const floor = rates[s] ?? 0;
            figures.floor[s] = Math.round(floor);
            if (floor > 0 && hours > 0) figures.pct[s] = Math.round(((xp[s] ?? 0) / (floor * hours)) * 1000) / 10;
        }
        return { figures, rates };
    } catch (e) {
        figures.floorError = errMessage(e);
        return { figures };
    }
}

/** Widens `range` to a counted run's start levels and the levels it gained. */
function widenLevelRange(
    range: MethodRuns['levelRange'],
    levels: Partial<Record<Skill, number>>,
    r: TimedResult,
    skills: Skill[],
): void {
    for (const s of skills) {
        const from = levels[s];
        if (from === undefined) continue;
        let [lo, hi] = range[s] ?? [from, from];
        lo = Math.min(lo, from);
        hi = Math.max(hi, from);
        for (const [name, g] of Object.entries(r.levelsGained ?? {})) if (skillOf(name) === s) hi = Math.max(hi, g.to);
        range[s] = [lo, hi];
    }
}

/**
 * MethodRunsInput.floor over `world`'s methods: the floor at measuredProfile of the entry, the profile the training
 * pages set a measured figure beside (model/method.ts measuredFigures), over the method's shortest way.
 */
export function measuredFloor(
    world: Pick<World, 'sites' | 'features' | 'methods'>,
    model: MethodModel,
): MethodRunsInput['floor'] {
    const query = methodQuery(world, model);
    const byId = new Map(world.methods.map(m => [m.id, m]));
    return (m, measured) => {
        const def = byId.get(m.id);
        if (!def) throw new Error(`No method ${m.id} in world.json`);
        return query.methodRate(m.id, measuredProfile({ def, skill: def.skill }, measured, model.tools));
    };
}

/** An integer as methods.ts writes it: `543_631`. */
const literal = (n: number): string =>
    Number.isInteger(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_') : String(n);

const record = (r: Partial<Record<string, number>>): string =>
    `{ ${Object.entries(r)
        .map(([k, v]) => `${k}: ${literal(v!)}`)
        .join(', ')} }`;

/** A `measured` entry as methods.ts formats one; a tool the method reads but no run showed is a line to fill. */
export function formatMeasured(entry: Measured, toolKind: MethodRuns['toolKind'], indent = ''): string {
    const lines = [
        '{',
        `    xpPerHour: ${record(entry.xpPerHour)},`,
        `    level: ${record(entry.level)},`,
        ...(entry.tool !== undefined
            ? [`    tool: '${entry.tool}',`]
            : toolKind
              ? [
                    `    // tool: '<FILL IN: the ${toolKind} the runs used, e.g. ${toolKind === 'axe' ? 'rune_axe' : 'rune_pickaxe'}>',`,
                ]
              : []),
        `    bot: '${entry.bot}',`,
        `    date: '${entry.date}',`,
        `    hours: ${entry.hours},`,
        `    from: '${entry.from.replaceAll("'", "\\'")}',`,
        '},',
    ];
    return lines.map(l => indent + l).join('\n');
}

const perHour = (n: number): string => `${n.toLocaleString('en-US')}/h`;
const levelsText = (levels: Partial<Record<string, number>>): string =>
    Object.entries(levels)
        .map(([s, n]) => `${s} ${n}`)
        .join(', ');
const rates = (xpPerHour: Partial<Record<string, number>>): string =>
    Object.entries(xpPerHour)
        .map(([s, n]) => `${s} ${perHour(n!)}`)
        .join(', ');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One run as a row of the per-run table. */
function runRow(r: MethodRun, toolKind: MethodRuns['toolKind']): string {
    const cells = [`${r.date} ${r.runId}`];
    if (!r.levels) cells.push('no recorded start');
    else {
        cells.push(levelsText(r.levels));
        if (toolKind) cells.push(r.tool ?? `no ${toolKind} held`);
    }
    cells.push(`${r.hours.toFixed(2)} h`);
    for (const [s, measured] of Object.entries(r.xpPerHour)) {
        const floor = r.floor?.[s as Skill];
        const pct = r.pct[s as Skill];
        cells.push(
            `${s} ${perHour(measured!)}` +
                (floor === undefined ? '' : ` of ${perHour(floor)}${pct === undefined ? '' : ` (${pct}%)`}`),
        );
    }
    if (r.floorError) cells.push(`floor: ${r.floorError}`);
    return cells.join(' · ');
}

/** The `--methods` report: a block per method with runs, then one line naming the methods without. */
export function formatMethodRuns(list: MethodRuns[]): string[] {
    const out: string[] = [];
    const none: string[] = [];
    for (const r of list) {
        if (!r.runs) {
            none.push(r.method);
            continue;
        }
        const plans = r.plans.length ? r.plans.join(', ') : 'none';
        out.push(`${r.method} (plans: ${plans}) · runs ${r.runs} · ${r.hours.toFixed(2)} h · last ${r.last}`);
        if (!r.counted) {
            out.push(`  measured ${rates(r.xpPerHour)}`);
            out.push('  no run recording shows the start levels: no floor, no entry');
            continue;
        }
        if (r.excluded) {
            const hours = r.hours - r.counted.hours;
            out.push(
                `  ${plural(r.excluded, 'run')} (${hours.toFixed(2)} h) with no recorded start left out of the floor ` +
                    `and gap below; all runs measured ${rates(r.xpPerHour)}`,
            );
        }
        if (r.floorError) out.push(`  floor: ${r.floorError}`);
        for (const [s, measured] of Object.entries(r.counted.xpPerHour)) {
            const floor = r.floor?.[s as Skill];
            const gap = r.gap[s as Skill];
            out.push(
                `  ${s}: measured ${perHour(measured!)}` +
                    (floor === undefined
                        ? ''
                        : ` · floor ${perHour(floor)}` +
                          (gap
                              ? ` · ${gap.pct}% of floor, ` +
                                (gap.shortfall >= 0
                                    ? `${perHour(gap.shortfall)} short`
                                    : `${perHour(-gap.shortfall)} above it: a model bug to find`)
                              : '')),
            );
        }
        const range = Object.entries(r.levelRange).map(([s, [a, b]]) => `${s} ${a}-${b}`);
        if (range.length)
            out.push(
                `  levels moved over the runs: ${range.join(', ')} (each run's floor is at its start levels, so ` +
                    'one that levelled understates)',
            );
        if (r.entry) {
            out.push(
                `  every run started at ${levelsText(r.entry.level)}` +
                    (r.toolKind ? `, ${r.entry.tool ?? `no ${r.toolKind} held (fill it in the entry)`}` : ''),
            );
            out.push('  measured entry (methods.ts):');
            out.push(formatMeasured(r.entry, r.toolKind, '    '));
        } else {
            out.push(`  the runs started at different levels${r.toolKind ? ` or ${r.toolKind}s` : ''}:`);
            for (const run of r.perRun) out.push(`    ${runRow(run, r.toolKind)}`);
            out.push('  narrow --since to runs at one level for a pasteable measured entry');
        }
    }
    if (none.length) out.push(`no runs: ${none.join(', ')}`);
    return out;
}
