// The curated training methods (wiki/world/methods.ts, world.json `methods`) beside the conductor's plans: the link
// between a method and the promoted plans that run it (a plan's `method`, a method's `plans`), and what those plans'
// runs measured against the method's floor at the levels the runs started on (`stats.ts --methods`).
//
// - The measured figure is the plans' whole runs: the XP of each skill the method trains over the runs' total time, a
//   plan counted once by its own `plan:<name>` result (runs.ts selectResults), so it covers the plan's every leg.
// - The start levels are read from the recording of a plan run's first phase run (its first state): the earliest plan
//   run whose recording shows them. A later run that started higher, or a run that levelled, widens `levelRange`.
// - The tool is the best axe or pickaxe the woodcutting or mining checker would pick from what the bot held at the
//   start of any of the runs' phase runs (inventory or worn), at the start level; null when none shows one.
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

/** A method's plans' runs beside its floor. */
export interface MethodRuns {
    method: string;
    plans: string[];
    runs: number;
    hours: number;
    /** Each skill the method trains: its XP over the runs' whole time. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** The trained skills' base levels at the start of the earliest run whose recording shows them, and that run. */
    start?: { runId: string; levels: Partial<Record<Skill, number>> };
    /** Each trained skill whose level changed across the runs: the start level, and the highest one a run began or ended on. */
    levelRange: Partial<Record<Skill, [number, number]>>;
    /** The tool kind the method's family reads from the profile, or null when it reads none. */
    toolKind: 'axe' | 'pickaxe' | null;
    /** The best tool of that kind the runs held; null when none showed one (the entry leaves it to fill). */
    tool: string | null;
    /** The floor's XP/hr at the start levels and tool (the entry's measuredProfile), or why there is none. */
    floor?: Partial<Record<Skill, number>>;
    floorError?: string;
    /** Each trained skill with a floor: measured as a percentage of it, and the XP/hr short of it. */
    gap: Partial<Record<Skill, { pct: number; shortfall: number }>>;
    /** The last run's date (YYYY-MM-DD). */
    last?: string;
    /** The `measured` entry for methods.ts; absent without start levels. */
    entry?: Measured;
}

export interface MethodRunsInput {
    bot: string;
    /** The stats.ts command the figures come from: the entry's `from`. */
    command: string;
    methods: Pick<WorldMethod, 'id' | 'plans' | 'skill' | 'levels'>[];
    /** Every result of the bot, phase runs included (runs.ts loadResults). */
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
        levelRange: {},
        toolKind,
        tool: null,
        gap: {},
    };
    if (!runs.length) return out;

    const xp: Partial<Record<Skill, number>> = {};
    for (const r of runs) {
        out.hours += r.durationMs / HOUR_MS;
        for (const [name, n] of Object.entries(r.xpGained ?? {})) {
            const s = skillOf(name);
            if (s && skills.includes(s)) xp[s] = (xp[s] ?? 0) + n;
        }
    }
    for (const s of skills) out.xpPerHour[s] = out.hours > 0 ? Math.round((xp[s] ?? 0) / out.hours) : 0;
    out.last = day(runs.at(-1)!.t);

    const starts = runs.map(r => phaseRuns.get(r.runId) ?? []).map(list => list.map(input.start));
    const firstIdx = starts.findIndex(list => list[0] !== undefined);
    if (firstIdx < 0) return out;
    const first = starts[firstIdx]![0]!;
    const levels: Partial<Record<Skill, number>> = {};
    for (const s of skills) if (first.levels[s] !== undefined) levels[s] = first.levels[s];
    out.start = { runId: runs[firstIdx]!.runId, levels };

    for (const s of skills) {
        const from = levels[s];
        if (from === undefined) continue;
        let to = from;
        runs.forEach((r, i) => {
            to = Math.max(to, starts[i]![0]?.levels[s] ?? 0);
            for (const [name, g] of Object.entries(r.levelsGained ?? {}))
                if (skillOf(name) === s) to = Math.max(to, g.to);
        });
        if (to > from) out.levelRange[s] = [from, to];
    }

    if (toolKind) {
        const held = new Set(
            starts.flat().flatMap(st => (st?.held ?? []).map(name => name.toLowerCase().replaceAll(' ', '_'))),
        );
        const level = first.levels[m.skill] ?? 1;
        out.tool = bestTool(
            input.tools[toolKind].filter(t => held.has(t.obj)),
            level,
        );
    }

    out.entry = {
        xpPerHour: out.xpPerHour,
        level: levels,
        ...(out.tool !== null && { tool: out.tool }),
        bot: input.bot,
        date: out.last,
        hours: Math.round(out.hours * 10_000) / 10_000,
        from: input.command,
    };
    try {
        const rates = input.floor(m, out.entry);
        out.floor = {};
        for (const s of skills) {
            const floor = Math.round(rates.xpPerHour[s] ?? 0);
            out.floor[s] = floor;
            const measured = out.xpPerHour[s] ?? 0;
            if (floor > 0)
                out.gap[s] = { pct: Math.round((measured / floor) * 1000) / 10, shortfall: floor - measured };
        }
    } catch (e) {
        out.floorError = errMessage(e);
    }
    return out;
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

/** The `--methods` report, one block per method with runs and one line per method without. */
export function formatMethodRuns(list: MethodRuns[]): string[] {
    const out: string[] = [];
    for (const r of list) {
        const plans = r.plans.length ? r.plans.join(', ') : 'none';
        if (!r.runs) {
            out.push(`${r.method}: no runs (plans: ${plans})`);
            continue;
        }
        out.push(`${r.method} (plans: ${plans}) · runs ${r.runs} · ${r.hours.toFixed(2)} h · last ${r.last}`);
        if (!r.start) {
            out.push('  no run recording shows the start levels: no floor, no entry');
            continue;
        }
        const range = Object.entries(r.levelRange).map(([s, [a, b]]) => `${s} ${a}-${b}`);
        out.push(
            `  start levels ${Object.entries(r.start.levels)
                .map(([s, n]) => `${s} ${n}`)
                .join(
                    ', ',
                )} (run ${r.start.runId})${range.length ? `; changed across the runs: ${range.join(', ')}` : ''}`,
        );
        if (r.toolKind)
            out.push(`  ${r.toolKind} ${r.tool ?? 'unknown: no run showed one held (fill it in the entry)'}`);
        if (r.floorError) out.push(`  floor: ${r.floorError}`);
        for (const [s, measured] of Object.entries(r.xpPerHour)) {
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
        out.push('  measured entry (methods.ts):');
        out.push(formatMeasured(r.entry!, r.toolKind, '    '));
    }
    return out;
}
