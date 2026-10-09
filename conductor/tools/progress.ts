// How far the account is from maxed, and how fast it is getting there.
//
//   bun conductor/tools/progress.ts <bot> [--json] [--no-record]
//
// Reads live skills in observe mode (never takes control), appends a snapshot to
// conductor/runs/<bot>/progress.jsonl, and prints each skill's level, XP to 99, and the change
// since the first and the previous snapshot. The conductor runs it after each task run.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BotSDK } from '../../sdk/index';
import { waitForLiveClient } from '../../sdk/runner';
import { MAX_XP } from '../lib/xp';
import { connectSdk, disconnectQuietly, loadBotEnvOrFail, REPO_ROOT } from '../lib/env';
import { errMessage, fail, parseCli } from '../lib/util';

const usage = 'usage: bun conductor/tools/progress.ts <bot> [--json] [--no-record]';
const { values: flags, positionals } = parseCli({ json: { type: 'boolean' }, 'no-record': { type: 'boolean' } }, usage);
const [name] = positionals;
if (!name || positionals.length > 1) fail(usage, 2);

interface Snapshot {
    t: number;
    skills: Record<string, { level: number; xp: number }>;
}

const env = loadBotEnvOrFail(name);
let sdk: BotSDK | undefined;
let snap: Snapshot;
try {
    sdk = await connectSdk(env, 'observe');
    // The gateway replays the last state it cached after a client leaves; only a tick change proves a client is live.
    if (!(await waitForLiveClient(sdk)))
        throw new Error(`no live game client (start one: cd server/webclient && bun src/lite/runner.ts ${name})`);
    const state = sdk.getState();
    if (!state) throw new Error('game state vanished after the tick wait');
    snap = { t: Date.now(), skills: {} };
    // Stat18/Stat19 are unused slots in this revision's skill list.
    for (const k of state.skills.filter(skill => !/^Stat\d+$/.test(skill.name))) {
        snap.skills[k.name] = { level: k.baseLevel, xp: k.experience };
    }
} catch (e) {
    console.error(`progress: ${errMessage(e)}`);
    process.exit(1);
} finally {
    if (sdk) await disconnectQuietly(sdk);
}

const file = join(REPO_ROOT, 'conductor/runs', name, 'progress.jsonl');
const history: Snapshot[] = [];
let badLines = 0;
for (const line of existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []) {
    try {
        history.push(JSON.parse(line));
    } catch {
        badLines++;
    }
}
if (badLines) console.error(`progress: skipped ${badLines} unparseable line(s) in ${file}`);
const first = history[0];
const prev = history[history.length - 1];
if (!flags['no-record']) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(snap) + '\n');
}

const skills = Object.entries(snap.skills);
const totalLevel = skills.reduce((n, [, s]) => n + s.level, 0);
const maxedXp = skills.reduce((n, [, s]) => n + Math.min(s.xp, MAX_XP), 0);
const pct = (100 * maxedXp) / (MAX_XP * skills.length);

if (flags.json) {
    console.log(
        JSON.stringify(
            { totalLevel, maxTotal: 99 * skills.length, percentToMax: pct, snapshot: snap, first, previous: prev },
            null,
            2,
        ),
    );
    process.exit(0);
}

const fmt = (n: number) => n.toLocaleString('en-US');
const delta = (cur: number, base?: number) => (base === undefined || cur === base ? '' : `+${fmt(cur - base)}`);
console.log(`${env.username}: total level ${totalLevel}/${99 * skills.length}, ${pct.toFixed(3)}% of max XP`);
if (first)
    console.log(
        `since first snapshot ${new Date(first.t).toISOString().slice(0, 16)}Z; since previous ${new Date(prev!.t).toISOString().slice(0, 16)}Z`,
    );
console.log('skill         lvl          xp     to 99   Δfirst    Δprev');
for (const [skill, s] of skills.sort((a, b) => b[1].xp - a[1].xp)) {
    console.log(
        `${skill.padEnd(12)} ${String(s.level).padStart(4)} ${fmt(s.xp).padStart(11)} ${fmt(Math.max(0, MAX_XP - s.xp)).padStart(11)}` +
            ` ${delta(s.xp, first?.skills[skill]?.xp).padStart(8)} ${delta(s.xp, prev?.skills[skill]?.xp).padStart(8)}`,
    );
}
process.exit(0);
