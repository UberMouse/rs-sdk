// What each task + params variant has actually produced, from every run's result event.
//
//   bun conductor/tools/stats.ts <bot> [--task <name>] [--since <YYYY-MM-DD>] [--phases] [--json] [--root <checkout>]
//   bun conductor/tools/stats.ts <bot> --methods [--since <YYYY-MM-DD>] [--json] [--root <checkout>]
//
// A plan counts once, as `plan:<name>` with its phases and their params as the variant; `--phases`
// also counts each of its phase runs as a run of that task.
//
// `--methods`: per curated training method (wiki/world/methods.ts), its plans' whole runs: the XP/hr of
// each skill it trains beside its floor at the levels each run started on, the gap, and a `measured`
// entry to paste into methods.ts when the runs all started at the same levels, tool and worn objs, else a
// table of the runs (lib/methods.ts says where each figure comes from: a combat method's entry records every
// skill of the combat level and the gear worn).
//
// `--root` reads conductor/runs/ of another checkout (this one by default), as plan-view.ts does.
//
// The conductor uses this to pick the best method for an objective and to compare a new
// variant (a different spot, target or mode) against the incumbent; the curator copies XP/hr
// into the knowledge base from here, not from a single run.
import { join, resolve } from 'node:path';
import { readGameData } from '../../wiki/world/model/families/index';
import { readObjNames } from '../../wiki/world/model/items';
import { methodModel, wornRead } from '../../wiki/world/model/method';
import { formatMethodRuns, measuredFloor, methodRuns, runStart } from '../lib/methods';
import { REPO_ROOT } from '../lib/env';
import { loadResults, readStartState, selectResults } from '../lib/runs';
import { canonical, errMessage, fail, parseCli } from '../lib/util';

const usage =
    'usage: bun conductor/tools/stats.ts <bot> [--task <name>] [--since <YYYY-MM-DD>] [--phases] [--json] [--root <checkout>]\n' +
    '       bun conductor/tools/stats.ts <bot> --methods [--since <YYYY-MM-DD>] [--json] [--root <checkout>]';
const { values, positionals } = parseCli(
    {
        task: { type: 'string' },
        since: { type: 'string' },
        phases: { type: 'boolean' },
        methods: { type: 'boolean' },
        json: { type: 'boolean' },
        root: { type: 'string' },
    },
    usage,
);
const [bot] = positionals;
if (!bot || positionals.length > 1) fail(usage, 2);
const taskFilter = values.task;
const since = values.since === undefined ? 0 : Date.parse(values.since);
if (Number.isNaN(since)) {
    fail(`bad --since "${values.since}": expected YYYY-MM-DD`, 2);
}

interface Variant {
    task: string;
    params: string;
    runs: number;
    status: Record<string, number>;
    hours: number;
    xp: Record<string, number>;
    xpPerHour: Record<string, number>;
    failures: Record<string, number>;
    last: string;
}

const root = values.root === undefined ? REPO_ROOT : resolve(values.root);
const runsDir = join(root, 'conductor/runs', bot);
const { results: allResults, skipped } = loadResults(bot, root);
if (skipped) console.error(`stats: skipped ${skipped} unparseable or malformed result line(s) in ${runsDir}`);

if (values.methods) {
    if (taskFilter !== undefined || values.phases)
        fail(`--methods counts whole plan runs: no --task or --phases\n${usage}`, 2);
    // Imported here: the world index loads world.json on import, which only --methods needs.
    const { WORLD } = await import('../lib/world-index');
    const data = readGameData();
    const model = methodModel(data);
    const reads = new Map(WORLD.methods.map(m => [m.id, wornRead(m, model)]));
    // A recording that can't be read (empty, another version) reads as missing: a plan run whose first phase run's it
    // is has no recorded start.
    const unreadable = new Map<string, string>();
    const list = methodRuns({
        bot,
        command: `stats.ts ${bot} --methods${values.since === undefined ? '' : ` --since ${values.since}`}`,
        methods: WORLD.methods,
        results: allResults,
        since,
        start: r => {
            try {
                const state = readStartState(r.logFile);
                return state && runStart(state);
            } catch (e) {
                unreadable.set(r.logFile, errMessage(e));
                return undefined;
            }
        },
        tools: model.tools,
        wornRead: m => reads.get(m.id)!,
        objName: readObjNames(data.objs),
        floor: measuredFloor(WORLD, model),
    });
    if (unreadable.size)
        console.error(
            `stats: ${unreadable.size} unreadable recording(s) in ${runsDir} read as missing; first: ` +
                unreadable.values().next().value,
        );
    if (values.json) console.log(JSON.stringify(list, null, 2));
    else for (const line of formatMethodRuns(list)) console.log(line);
    process.exit(0);
}
const results = selectResults(allResults, {
    since,
    ...(taskFilter && { task: taskFilter }),
    ...(values.phases && { phases: true }),
});
const variants = new Map<string, Variant>();
for (const r of results) {
    const params = canonical(r.params);
    const key = `${r.task} ${params}`;
    const v = variants.get(key) ?? {
        task: r.task,
        params,
        runs: 0,
        status: {},
        hours: 0,
        xp: {},
        xpPerHour: {},
        failures: {},
        last: '',
    };
    v.runs++;
    v.status[r.status] = (v.status[r.status] ?? 0) + 1;
    v.hours += r.durationMs / 3_600_000;
    for (const [skill, n] of Object.entries(r.xpGained ?? {})) v.xp[skill] = (v.xp[skill] ?? 0) + n;
    if (r.status !== 'done') {
        // Numbers vary run to run ("for 90s", coordinates); strip them so reasons group.
        const reason = r.reason.replace(/\d+/g, '#').slice(0, 120);
        v.failures[reason] = (v.failures[reason] ?? 0) + 1;
    }
    v.last = new Date(r.t).toISOString().slice(0, 16);
    variants.set(key, v);
}
for (const v of variants.values()) {
    for (const [skill, n] of Object.entries(v.xp)) v.xpPerHour[skill] = v.hours > 0 ? Math.round(n / v.hours) : 0;
}

const list = [...variants.values()].sort((a, b) => a.task.localeCompare(b.task) || b.runs - a.runs);
if (values.json) {
    console.log(JSON.stringify(list, null, 2));
    process.exit(0);
}
if (!list.length) {
    console.log(`no task results for ${bot}${taskFilter ? ` (task ${taskFilter})` : ''}`);
    process.exit(0);
}
for (const v of list) {
    const ok = v.status.done ?? 0;
    const rate =
        Object.entries(v.xpPerHour)
            .map(([s, n]) => `${s} ${n.toLocaleString()}/h`)
            .join(', ') || 'no xp';
    console.log(`${v.task} ${v.params}`);
    console.log(
        `  runs ${v.runs} (done ${ok}, ${
            Object.entries(v.status)
                .filter(([s]) => s !== 'done')
                .map(([s, n]) => `${s} ${n}`)
                .join(', ') || 'no failures'
        }) · ${(v.hours * 60).toFixed(1)} min · ${rate} · last ${v.last}`,
    );
    for (const [reason, n] of Object.entries(v.failures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)) {
        console.log(`  ✗ ${n}× ${reason}`);
    }
}
