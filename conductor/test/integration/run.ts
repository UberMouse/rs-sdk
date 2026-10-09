// bun run test:integration [filter] [-j N]
// Runs each *.itest.ts under conductor/test/integration as its own `bun test` process (they share
// one local stack, but every test spawns its own account), N at a time, then prints a table.
import { spawn } from 'node:child_process';
import { Glob } from 'bun';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../../lib/env';

const DEFAULT_JOBS = 3;
const ROOT = 'conductor/test/integration';

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

const files = [...new Glob('**/*.itest.ts').scanSync(join(REPO_ROOT, ROOT))]
    .map(f => join(ROOT, f))
    .filter(f => f.includes(filter))
    .sort();
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

function runFile(file: string): Promise<Outcome> {
    const started = Date.now();
    return new Promise(resolve => {
        // The ./ prefix makes bun treat the argument as a path rather than a name filter.
        const proc = spawn(process.execPath, ['test', `./${file}`], {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        proc.stdout.on('data', c => (output += c));
        proc.stderr.on('data', c => (output += c));
        const done = (ok: boolean, extra = '') =>
            resolve({ file, ok, seconds: (Date.now() - started) / 1000, output: output + extra });
        proc.once('error', e => done(false, String(e)));
        proc.once('close', code => done(code === 0));
    });
}

const outcomes: Outcome[] = [];
const queue = [...files];
await Promise.all(
    Array.from({ length: Math.min(jobs, files.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) outcomes.push(await runFile(file));
    }),
);
outcomes.sort((a, b) => a.file.localeCompare(b.file));

for (const o of outcomes) {
    if (!o.ok) console.log(`\n--- ${o.file} ---\n${o.output}`);
}
const names = outcomes.map(o => relative(ROOT, o.file));
const width = Math.max(...names.map(n => n.length), 4);
console.log(`\n${'file'.padEnd(width)}  result  seconds`);
outcomes.forEach((o, i) => {
    console.log(`${names[i]!.padEnd(width)}  ${(o.ok ? 'pass' : 'FAIL').padEnd(6)}  ${o.seconds.toFixed(1)}`);
});
process.exit(outcomes.every(o => o.ok) ? 0 : 1);
