// Append one line to the conductor's journal, stamped with the real current UTC time.
//
//   bun conductor/tools/journal.ts <kind> <objective> --verdict '<text>' [--result '<text>']
//       [--command '<text>'] [--commit <sha>] [--task <name>] [--field key=value ...] [--file <path>]
//
// The conductor never types timestamps by hand. Default file is .durable-state/journal.jsonl under
// the current git worktree root. Prints the line to stdout and the file path to stderr.
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { appendJournalLine, JOURNAL_KINDS, type JournalKind, type JournalLine, journalStamp } from '../lib/journal';

const isKind = (s: string | undefined): s is JournalKind => JOURNAL_KINDS.some(k => k === s);
const RESERVED = ['at', 'kind', 'objective', 'task', 'command', 'result', 'verdict', 'commit'];
const REVIEW_FIELDS = ['rounds', 'found', 'fixed', 'deferred', 'dropped'];
const USAGE = `usage: bun conductor/tools/journal.ts <kind> <objective> --verdict '<text>' [--result '<text>']
         [--command '<text>'] [--commit <sha>] [--task <name>] [--field key=value ...] [--file <path>]
  kind: ${JOURNAL_KINDS.join(' | ')}
  review lines also require --task and numeric --field ${REVIEW_FIELDS.join(', ')}
  --field adds extra keys (plain decimal numbers like 2 or -1.5 become numbers, anything else stays a string), e.g. --field rounds=2
  --file defaults to .durable-state/journal.jsonl under the current git worktree root`;

function fail(msg: string): never {
    console.error(`journal: ${msg}\n${USAGE}`);
    process.exit(2);
}

let parsed;
try {
    parsed = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: 'boolean', short: 'h' },
            result: { type: 'string' },
            verdict: { type: 'string' },
            command: { type: 'string' },
            commit: { type: 'string' },
            task: { type: 'string' },
            field: { type: 'string', multiple: true },
            file: { type: 'string' },
        },
    });
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}
const { values, positionals } = parsed;
if (values.help) {
    console.log(USAGE);
    process.exit(0);
}

const [kind, objective, ...extra] = positionals;
if (!isKind(kind)) fail(`kind must be one of ${JOURNAL_KINDS.join(', ')} (got ${kind ?? 'nothing'})`);
if (!objective) fail('missing <objective>');
if (extra.length) fail(`unexpected extra argument(s): ${extra.join(' ')} (quote the objective)`);
if (!values.verdict) fail('--verdict is required');

const line: JournalLine = {
    at: journalStamp(),
    kind,
    objective,
    verdict: values.verdict,
};
if (values.task) line.task = values.task;
if (values.command) line.command = values.command;
if (values.result) line.result = values.result;
if (values.commit) line.commit = values.commit;
for (const f of values.field ?? []) {
    const eq = f.indexOf('=');
    if (eq < 1) fail(`--field expects key=value (got '${f}')`);
    const key = f.slice(0, eq);
    if (RESERVED.includes(key)) fail(`--field ${key} would overwrite a standard key`);
    const raw = f.slice(eq + 1);
    line[key] = /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw) ? Number(raw) : raw;
}
if (kind === 'review') {
    const missing = [
        ...(line.task ? [] : ['--task']),
        ...REVIEW_FIELDS.filter(k => typeof line[k] !== 'number').map(k => `--field ${k}=<number>`),
    ];
    if (missing.length) fail(`review line is missing ${missing.join(', ')}`);
}

let file: string;
if (values.file) {
    file = resolve(values.file);
} else {
    const top = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel']);
    if (top.exitCode !== 0) fail('not inside a git worktree; pass --file');
    file = join(top.stdout.toString().trim(), '.durable-state', 'journal.jsonl');
}
const out = appendJournalLine(file, line);
console.log(out);
console.error(`journal: appended to ${file}`);
