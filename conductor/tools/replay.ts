// Re-runs the current code of a recorded run's task against the recording and reports the first
// command it would have sent differently: "would the new code have decided differently here?".
//
//   bun conductor/tools/replay.ts <conductor/runs/<bot>/<runId>.ticks.ndjson.gz> [--task-dir <dir>] [--verbose]
//
// run-task.ts records every run next to its log. Prints "no divergence" or the first divergence (the
// tick, what the recording did, what the code does now). Exit 0 for no divergence, 1 for one, 2 for
// a usage error or a recording or task that can't be read. `--task-dir` loads the task from another
// directory (a variant under test); `--verbose` prints the replayed run's own output.
import { parseArgs } from 'node:util';
import { readRecording, type Recording } from '../core/drivers/recording';
import { loadTask, TASKS_DIR } from '../lib/catalog';
import { replayRun } from '../lib/replay';
import { canonical, errMessage } from '../lib/util';

const usage = 'usage: bun conductor/tools/replay.ts <recording.ticks.ndjson.gz> [--task-dir <dir>] [--verbose]';
let values: { 'task-dir'?: string; verbose?: boolean };
let positionals: string[];
try {
    ({ values, positionals } = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: { 'task-dir': { type: 'string' }, verbose: { type: 'boolean' } },
    }));
} catch (e) {
    console.error(`replay: ${errMessage(e)}\n${usage}`);
    process.exit(2);
}
const [file, ...extra] = positionals;
if (!file || extra.length) {
    console.error(usage);
    process.exit(2);
}

let recording: Recording;
try {
    recording = readRecording(file);
} catch (e) {
    console.error(`replay: can't read ${file}: ${errMessage(e)}`);
    process.exit(2);
}
const { run } = recording.header;
let def;
try {
    def = await loadTask(run.task, values['task-dir'] ?? TASKS_DIR);
} catch (e) {
    console.error(`replay: can't load task "${run.task}": ${errMessage(e)}`);
    process.exit(2);
}

console.log(`replaying ${run.task} ${canonical(run.params)} on ${run.bot} (run ${run.runId})`);
const report = await replayRun(recording, def, values.verbose ? { print: line => console.log(`  | ${line}`) } : {});
const d = report.divergence;
if (d) {
    console.log(`divergence at tick ${d.tick} (${d.kind}), after ${report.matched} matching commands`);
    console.log(`  recorded: ${d.expected}`);
    console.log(`  replayed: ${d.got}`);
    process.exit(1);
}
const ending = report.exhausted
    ? `through tick ${report.tick}, where the recording ends without a result (the run was killed or crashed)`
    : `and both runs ended ${report.recorded?.status}: ${report.recorded?.reason}`;
console.log(`no divergence: ${report.matched} commands matched ${ending}`);
process.exit(0);
