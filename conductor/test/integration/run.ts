// bun run test:integration [filter] [-j N]
// Runs each *.itest.ts under conductor/test/integration as its own `bun test` process (they share
// one local stack, but every test spawns its own account), N at a time, then prints a table.
// The filter is a substring of the path relative to conductor/test/integration.
import { spawn, type ChildProcess } from 'node:child_process';
import { Glob } from 'bun';
import { join } from 'node:path';
import { REPO_ROOT } from '../../lib/env';

const DEFAULT_JOBS = 3;
const ROOT = 'conductor/test/integration';
/** A test file that has not finished by now is killed and reported as failed. */
const FILE_TIMEOUT_MS = 10 * 60_000;
/** A `bun test` child SIGKILLs its own children and exits at once on SIGTERM; this is only a backstop. */
const KILL_GRACE_MS = 20_000;

let filter = '';
let jobs = DEFAULT_JOBS;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-j') jobs = Number(args[++i]);
    else if (a.startsWith('-j')) jobs = Number(a.slice(2));
    else filter = a;
}
if (!Number.isInteger(jobs) || jobs < 1) {
    console.error('usage: bun run test:integration [filter] [-j N]');
    process.exit(2);
}

// Paths relative to ROOT, so the filter cannot match the repo's own location.
const files = [...new Glob('**/*.itest.ts').scanSync(join(REPO_ROOT, ROOT))].filter(f => f.includes(filter)).sort();
if (files.length === 0) {
    console.error(`no integration tests match "${filter}"`);
    process.exit(2);
}

interface Outcome {
    file: string;
    ok: boolean;
    seconds: number;
    output: string;
}

const running = new Set<ChildProcess>();
let aborting = false;

/** SIGTERM `proc`, then SIGKILL if it is still alive after the grace period. */
function terminate(proc: ChildProcess): void {
    proc.kill('SIGTERM');
    const timer = setTimeout(() => proc.kill('SIGKILL'), KILL_GRACE_MS);
    proc.once('close', () => clearTimeout(timer));
}

function runFile(file: string): Promise<Outcome> {
    const started = Date.now();
    return new Promise(resolve => {
        // The ./ prefix makes bun treat the argument as a path rather than a name filter.
        const proc = spawn(process.execPath, ['test', `./${join(ROOT, file)}`], {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        running.add(proc);
        let output = '';
        let timedOut = false;
        proc.stdout.on('data', c => (output += c));
        proc.stderr.on('data', c => (output += c));
        const timer = setTimeout(() => {
            timedOut = true;
            terminate(proc);
        }, FILE_TIMEOUT_MS);
        let finished = false;
        const done = (ok: boolean, extra = '') => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            running.delete(proc);
            const seconds = (Date.now() - started) / 1000;
            console.log(`${ok ? 'pass' : 'FAIL'}  ${file}  ${seconds.toFixed(1)}s`);
            resolve({ file, ok, seconds, output: output + extra });
        };
        proc.once('error', e => done(false, String(e)));
        proc.once('close', code =>
            done(code === 0 && !timedOut, timedOut ? `\ntimeout: killed after ${FILE_TIMEOUT_MS / 1000}s` : ''),
        );
    });
}

// Forward SIGINT/SIGTERM to the test processes. Each one's handler (harness.ts) SIGKILLs its lite
// clients and run-task children immediately and removes its fixture dirs; there is no graceful stop,
// so the killed bots stay logged in until the server times them out. Wait, then exit non-zero.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        if (aborting) return;
        aborting = true;
        console.error(`\n${signal}: stopping ${running.size} running test file(s)`);
        for (const proc of running) terminate(proc);
        // Backstop: the children are SIGKILLed after KILL_GRACE_MS; don't hang past that.
        setTimeout(() => process.exit(1), KILL_GRACE_MS + 2000);
    });
}

const outcomes: Outcome[] = [];
const queue = [...files];
await Promise.all(
    Array.from({ length: Math.min(jobs, files.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
            if (aborting) return;
            outcomes.push(await runFile(file));
        }
    }),
);
if (aborting) process.exit(1);
outcomes.sort((a, b) => a.file.localeCompare(b.file));

for (const o of outcomes) {
    if (!o.ok) console.log(`\n--- ${o.file} ---\n${o.output}`);
}
const width = Math.max(...outcomes.map(o => o.file.length), 4);
console.log(`\n${'file'.padEnd(width)}  result  seconds`);
for (const o of outcomes) {
    console.log(`${o.file.padEnd(width)}  ${(o.ok ? 'pass' : 'FAIL').padEnd(6)}  ${o.seconds.toFixed(1)}`);
}
process.exit(outcomes.every(o => o.ok) ? 0 : 1);
