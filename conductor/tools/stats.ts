// What each task + params variant has actually produced, from every run's result event.
//
//   bun conductor/tools/stats.ts <bot> [--task <name>] [--since <YYYY-MM-DD>] [--json]
//
// The conductor uses this to pick the best method for an objective and to compare a new
// variant (a different spot, target or mode) against the incumbent; the curator copies XP/hr
// into the knowledge base from here, not from a single run.
import { parseArgs } from 'node:util';
import { loadResults } from '../lib/runs';
import { canonical } from '../lib/util';

const usage = 'usage: bun conductor/tools/stats.ts <bot> [--task <name>] [--since <YYYY-MM-DD>] [--json]';
const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { task: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' } },
});
const bot = positionals[0];
if (!bot) {
    console.error(usage);
    process.exit(2);
}
const taskFilter = values.task;
const since = values.since === undefined ? 0 : Date.parse(values.since);
if (Number.isNaN(since)) {
    console.error(`bad --since "${values.since}": expected YYYY-MM-DD`);
    process.exit(2);
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

const { results: allResults, skipped } = loadResults(bot);
if (skipped)
    console.error(`stats: skipped ${skipped} unparseable or malformed result line(s) in conductor/runs/${bot}`);
const results = allResults.filter(r => r.t >= since && (!taskFilter || r.task === taskFilter));
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
