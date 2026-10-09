// Integration harness: a fresh bot spawned from a generated save, driven through the real local
// stack (engine + gateway + headless lite client). Each test gets its own never-used account, so
// tests run in parallel and leave no state behind that another test reads.
//
// writeFixtureSave / startLiteClient mirror conductor/lib/saves.ts writeSave and
// conductor/lib/client.ts startLiteClient on the parallel-bots branch; switch to those once it
// lands.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { createSaveData, type SaveConfig } from '../../../sdk/test/utils/save-generator';
import { connectSdk, disconnectQuietly, loadBotEnv, REPO_ROOT, type BotEnv } from '../../lib/env';
import { distance } from '../../lib/util';

const LITE_READY = /Gateway connected, registering as/;
const LITE_START_TIMEOUT_MS = 60_000;
const STATE_READY_TIMEOUT_MS = 30_000;
/** The spawn tile and the tile the engine logs the bot in at may differ by a step. */
const SPAWN_TOLERANCE = 2;
const NAME_PREFIX = 'it';
/** Account names are at most 12 characters. */
const NAME_RANDOM_CHARS = 10;
const STOP_GRACE_MS = 5000;
const LOG_TAIL_LINES = 40;
/** run-task prints its RESULT and exits within ~6s of SIGTERM; SIGKILL after this. */
const TASK_TERM_GRACE_MS = 8000;
/** Slack over a task's own `minutes:N` stop for startup, the final RESULT and teardown. */
const TASK_MARGIN_MS = 2 * 60_000;
const TASK_FALLBACK_TIMEOUT_MS = 10 * 60_000;
/** Teardown after the task: client stop (SIGINT, then SIGKILL) plus a little slack. */
const TEARDOWN_MS = STOP_GRACE_MS + 10_000;
/** Variables loadBotEnv exports from the last bot's bot.env; children read their own bot.env. */
const BOT_ENV_KEYS = ['BOT_USERNAME', 'PASSWORD', 'SERVER', 'GATEWAY_URL', 'SHOW_CHAT', 'TELEMETRY'];

/** Task run time from the `minutes:N` stops (the earliest ends the run), if any. */
function taskMinutes(until: string[]): number | undefined {
    const m = until.flatMap(u => (/^minutes:(\d+(?:\.\d+)?)$/.exec(u) ? [Number(u.slice('minutes:'.length))] : []));
    return m.length > 0 ? Math.min(...m) : undefined;
}

function taskTimeoutMs(until: string[]): number {
    const minutes = taskMinutes(until);
    return minutes === undefined ? TASK_FALLBACK_TIMEOUT_MS : minutes * 60_000 + TASK_MARGIN_MS;
}

/**
 * A bun:test timeout covering client start, login, the task (runTask's default timeout for these
 * stops) and teardown, so the harness's own timeouts fire before bun's.
 */
export function itestTimeout(opts: { taskMinutes: number }): number {
    return (
        LITE_START_TIMEOUT_MS +
        STATE_READY_TIMEOUT_MS +
        taskTimeoutMs([`minutes:${opts.taskMinutes}`]) +
        TASK_TERM_GRACE_MS +
        TEARDOWN_MS
    );
}

// Everything this process spawned that is still alive, and the fixture dirs it created. A dying
// parent (exit, SIGINT, SIGTERM) kills them, so a crashed or interrupted run leaves no client or
// task controlling a bot. Handlers are registered once per process, on first spawn.
const liveChildren = new Set<ChildProcess>();
const liveFixtures = new Set<string>();
let cleanupInstalled = false;

function killAll(): void {
    for (const proc of liveChildren) proc.kill('SIGKILL');
    for (const name of liveFixtures) rmSync(join(REPO_ROOT, 'bots', name), { recursive: true, force: true });
}

function installCleanup(): void {
    if (cleanupInstalled) return;
    cleanupInstalled = true;
    process.on('exit', killAll);
    for (const [signal, code] of [
        ['SIGINT', 130],
        ['SIGTERM', 143],
    ] as const) {
        process.on(signal, () => {
            killAll();
            process.exit(code);
        });
    }
}

/** Track `proc` until it exits. */
function track(proc: ChildProcess): void {
    installCleanup();
    liveChildren.add(proc);
    const untrack = () => liveChildren.delete(proc);
    proc.once('exit', untrack);
    proc.once('error', untrack);
}

/** process.env without the bot credentials loadBotEnv leaves behind. */
function childEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const k of BOT_ENV_KEYS) delete env[k];
    return env;
}

/**
 * The engine directory whose data/players the running server reads. RS_ENGINE_DIR wins; otherwise
 * the main checkout (git's common dir), because one shared server runs from there for every
 * worktree.
 */
export function engineDir(): string {
    if (process.env.RS_ENGINE_DIR) return process.env.RS_ENGINE_DIR;
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    }).trim();
    return join(dirname(common), 'server/engine');
}

/** A fresh account name that has never been online. */
export function freshBotName(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(NAME_RANDOM_CHARS);
    let out = NAME_PREFIX;
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
}

/** Write a generated save where the running engine loads it (atomic tmp + rename). */
export function writeFixtureSave(username: string, config: SaveConfig): string {
    const file = join(engineDir(), 'data/players/main', `${username.toLowerCase()}.sav`);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, createSaveData(config));
    renameSync(tmp, file);
    return file;
}

/** bots/<name>/bot.env for the local stack, as `create-bot.ts --local --no-chat` writes it. */
function writeBotEnv(name: string): void {
    const dir = join(REPO_ROOT, 'bots', name);
    mkdirSync(dir, { recursive: true });
    const password = randomBytes(9).toString('base64url');
    writeFileSync(
        join(dir, 'bot.env'),
        [
            `BOT_USERNAME=${name}`,
            `PASSWORD=${password}`,
            'SERVER=localhost:8888',
            'GATEWAY_URL=ws://localhost:7780',
            'SHOW_CHAT=false',
            'TELEMETRY=false',
            '',
        ].join('\n'),
    );
}

export interface LiteClient {
    pid: number;
    /** Combined stdout/stderr of the client: conductor/runs/<bot>/lite-client.log. */
    log: string;
    /** SIGINT, then SIGKILL after 5s; resolves once the process is gone. */
    stop(): Promise<void>;
}

function logTail(file: string): string {
    try {
        return readFileSync(file, 'utf8').split('\n').slice(-LOG_TAIL_LINES).join('\n');
    } catch {
        return '(no log)';
    }
}

/**
 * Spawn the headless lite client for `botName`; resolves once it has registered with the gateway.
 * The child stays attached to this process (no detach/unref) and is SIGKILLed if this process
 * exits or is signalled, so a crashed test run cannot orphan it.
 */
export function startLiteClient(botName: string, opts: { timeoutMs?: number } = {}): Promise<LiteClient> {
    const timeoutMs = opts.timeoutMs ?? LITE_START_TIMEOUT_MS;
    const log = join(REPO_ROOT, 'conductor/runs', botName, 'lite-client.log');
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, '');
    const proc = spawn(process.execPath, ['src/lite/runner.ts', botName], {
        cwd: join(REPO_ROOT, 'server/webclient'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv(),
    });
    track(proc);
    let gone = false;
    const exited = new Promise<void>(resolve => {
        const onGone = () => {
            gone = true;
            resolve();
        };
        proc.once('exit', onGone);
        proc.once('error', onGone);
    });
    const client: LiteClient = {
        pid: proc.pid ?? -1,
        log,
        async stop() {
            if (gone) return;
            proc.kill('SIGINT');
            const timer = setTimeout(() => proc.kill('SIGKILL'), STOP_GRACE_MS);
            await exited;
            clearTimeout(timer);
        },
    };
    return new Promise((resolve, reject) => {
        let seen = '';
        let settled = false;
        // Stop the process before rejecting: the caller never receives `client`, so cannot stop it.
        const fail = async (message: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            await client.stop();
            reject(new Error(`${message}; ${log}:\n${logTail(log)}`));
        };
        const timer = setTimeout(
            () => void fail(`lite client for ${botName} not ready after ${timeoutMs}ms`),
            timeoutMs,
        );
        const onData = (chunk: Buffer) => {
            appendFileSync(log, chunk);
            seen += chunk.toString();
            if (!settled && LITE_READY.test(seen)) {
                settled = true;
                clearTimeout(timer);
                resolve(client);
            }
        };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.once('error', e => void fail(`lite client for ${botName} failed to spawn (${e.message})`));
        proc.once('exit', code => void fail(`lite client for ${botName} exited (${code}) before it was ready`));
    });
}

/** What every fixture has; `connect: false` tests get only this (they drive the bot via runTask). */
export interface FixtureBase {
    name: string;
    env: BotEnv;
    client: LiteClient;
}

/** A fixture with a control connection. */
export interface FixtureBot extends FixtureBase {
    sdk: BotSDK;
    bot: BotActions;
}

/** Remove the lite client log (and its directory if that leaves it empty) after a passing run. */
function removeLiteLog(botName: string): void {
    const log = join(REPO_ROOT, 'conductor/runs', botName, 'lite-client.log');
    rmSync(log, { force: true });
    try {
        rmdirSync(dirname(log));
    } catch {
        // not empty (or already gone): leave it
    }
}

/**
 * Run `fn` against a fresh bot logged in from `save`. The save is checked to have loaded (the bot
 * stands at `save.position`), so a save written where the running engine doesn't look fails loudly.
 * With `connect: false` no control SDK is handed out, for tests that drive the bot through
 * run-task.ts. The lite client log is removed when the run passes and kept (path in the error) when
 * it fails; the .sav stays, because the engine rewrites it on logout.
 */
export function withFixtureBot<T>(
    save: SaveConfig,
    fn: (bot: FixtureBot) => Promise<T>,
    opts?: { connect?: true },
): Promise<T>;
export function withFixtureBot<T>(
    save: SaveConfig,
    fn: (bot: FixtureBase) => Promise<T>,
    opts: { connect: false },
): Promise<T>;
export async function withFixtureBot<T>(
    save: SaveConfig,
    // The overloads above are the checked surface; `any` here lets one body serve both.
    fn: (bot: any) => Promise<T>,
    opts: { connect?: boolean } = {},
): Promise<T> {
    const name = freshBotName();
    writeFixtureSave(name, save);
    liveFixtures.add(name);
    installCleanup();
    writeBotEnv(name);
    let client: LiteClient | undefined;
    let sdk: BotSDK | undefined;
    let failed = false;
    try {
        client = await startLiteClient(name);
        const env = loadBotEnv(name);
        // Observe-only connections still see state, so the spawn check never takes control.
        const connected = await connectSdk(env, opts.connect === false ? 'observe' : 'control');
        sdk = connected;
        const state = await connected.waitForReady(STATE_READY_TIMEOUT_MS);
        const p = state.player;
        if (save.position && p && distance({ x: p.worldX, z: p.worldZ }, save.position) > SPAWN_TOLERANCE) {
            throw new Error(
                `${name} logged in at (${p.worldX},${p.worldZ}), not the fixture position ` +
                    `(${save.position.x},${save.position.z}): the save was not loaded. Is ${engineDir()} the ` +
                    'engine directory the running server uses? Set RS_ENGINE_DIR.',
            );
        }
        if (opts.connect === false) {
            await disconnectQuietly(connected);
            sdk = undefined;
            return await fn({ name, env, client });
        }
        const controlled: FixtureBot = { name, env, client, sdk: connected, bot: new BotActions(connected) };
        return await fn(controlled);
    } catch (e) {
        failed = true;
        if (client && e instanceof Error) {
            e.message += `\n--- lite client log tail (${client.log}) ---\n${logTail(client.log)}`;
        }
        throw e;
    } finally {
        if (sdk) await disconnectQuietly(sdk);
        await client?.stop();
        rmSync(join(REPO_ROOT, 'bots', name), { recursive: true, force: true });
        liveFixtures.delete(name);
        if (!failed) removeLiteLog(name);
    }
}

export interface TaskRun {
    /** The parsed `RESULT <json>` line (a TaskResult). */
    result: Record<string, any>;
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

const lastLines = (text: string) => text.split('\n').slice(-LOG_TAIL_LINES).join('\n');

function outputTail(stdout: string, stderr: string): string {
    return `--- stdout tail ---\n${lastLines(stdout)}\n--- stderr tail ---\n${lastLines(stderr)}`;
}

/**
 * Run `bun conductor/run-task.ts` as a subprocess against `bot` and parse its RESULT line. After
 * `timeoutMs` (default: the earliest `minutes:N` stop plus a margin, else 10 minutes) it sends
 * SIGTERM (run-task prints its own RESULT then), SIGKILL after a grace period, and rejects with
 * the output tail once the process is gone.
 */
export function runTask(
    bot: string,
    task: string,
    params: unknown,
    until: string[],
    opts: { timeoutMs?: number } = {},
): Promise<TaskRun> {
    const timeoutMs = opts.timeoutMs ?? taskTimeoutMs(until);
    const args = ['conductor/run-task.ts', bot, task, '--params', JSON.stringify(params)];
    for (const u of until) args.push('--until', u);
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, args, {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv(),
        });
        track(proc);
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
            killTimer = setTimeout(() => proc.kill('SIGKILL'), TASK_TERM_GRACE_MS);
        }, timeoutMs);
        const settle = (finish: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(killTimer);
            finish();
        };
        proc.stdout.on('data', c => (stdout += c));
        proc.stderr.on('data', c => (stderr += c));
        proc.once('error', e => settle(() => reject(e)));
        proc.once('close', exitCode =>
            settle(() => {
                if (timedOut) {
                    reject(new Error(`run-task ${task} timed out after ${timeoutMs}ms\n${outputTail(stdout, stderr)}`));
                    return;
                }
                const line = stdout.split('\n').findLast(l => l.startsWith('RESULT '));
                if (!line) {
                    reject(
                        new Error(`run-task printed no RESULT line (exit ${exitCode})\n${outputTail(stdout, stderr)}`),
                    );
                    return;
                }
                try {
                    resolve({ result: JSON.parse(line.slice('RESULT '.length)), stdout, stderr, exitCode });
                } catch (e) {
                    reject(
                        new Error(
                            `run-task RESULT line is not valid JSON (${e instanceof Error ? e.message : e})\n` +
                                outputTail(stdout, stderr),
                        ),
                    );
                }
            }),
        );
    });
}
