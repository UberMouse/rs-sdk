// Integration harness: a fresh bot spawned from a generated save, driven through the real local
// stack (engine + gateway + headless lite client). Each test gets its own never-used account, so
// tests run in parallel and leave no state behind that another test reads.
//
// writeFixtureSave / startLiteClient mirror conductor/lib/saves.ts writeSave and
// conductor/lib/client.ts startLiteClient on the parallel-bots branch; switch to those once it
// lands.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const STOP_GRACE_MS = 5000;
const LOG_TAIL_LINES = 40;

function logTail(file: string): string {
    try {
        return readFileSync(file, 'utf8').split('\n').slice(-LOG_TAIL_LINES).join('\n');
    } catch {
        return '(no log)';
    }
}

/**
 * Spawn the headless lite client for `botName`; resolves once it has registered with the gateway.
 * The child stays attached to this process (no detach/unref) so a crashed test run cannot orphan it.
 */
export function startLiteClient(botName: string, opts: { timeoutMs?: number } = {}): Promise<LiteClient> {
    const timeoutMs = opts.timeoutMs ?? LITE_START_TIMEOUT_MS;
    const log = join(REPO_ROOT, 'conductor/runs', botName, 'lite-client.log');
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, '');
    const proc = spawn(process.execPath, ['src/lite/runner.ts', botName], {
        cwd: join(REPO_ROOT, 'server/webclient'),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<void>(resolve => {
        if (proc.exitCode !== null || proc.signalCode !== null) resolve();
        else proc.once('exit', () => resolve());
    });
    const client: LiteClient = {
        pid: proc.pid ?? -1,
        log,
        async stop() {
            if (proc.exitCode !== null || proc.signalCode !== null) return;
            proc.kill('SIGINT');
            const timer = setTimeout(() => proc.kill('SIGKILL'), STOP_GRACE_MS);
            await exited;
            clearTimeout(timer);
        },
    };
    return new Promise((resolve, reject) => {
        let seen = '';
        const timer = setTimeout(() => {
            void client.stop();
            reject(new Error(`lite client for ${botName} not ready after ${timeoutMs}ms; ${log}:\n${logTail(log)}`));
        }, timeoutMs);
        const onData = (chunk: Buffer) => {
            appendFileSync(log, chunk);
            seen += chunk.toString();
            if (LITE_READY.test(seen)) {
                clearTimeout(timer);
                resolve(client);
            }
        };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.once('exit', code => {
            clearTimeout(timer);
            reject(
                new Error(`lite client for ${botName} exited (${code}) before it was ready; ${log}:\n${logTail(log)}`),
            );
        });
    });
}

export interface FixtureBot {
    name: string;
    env: BotEnv;
    sdk: BotSDK;
    bot: BotActions;
    client: LiteClient;
}

export interface FixtureOptions {
    /** Also connect a control SDK (default true). Off for tests that drive the bot through run-task.ts. */
    connect?: boolean;
}

/**
 * Run `fn` against a fresh bot logged in from `save`. The save is checked to have loaded (the bot
 * stands at `save.position`), so a save written where the running engine doesn't look fails loudly.
 */
export async function withFixtureBot<T>(
    save: SaveConfig,
    fn: (bot: FixtureBot) => Promise<T>,
    opts: FixtureOptions = {},
): Promise<T> {
    const name = freshBotName();
    writeFixtureSave(name, save);
    writeBotEnv(name);
    let client: LiteClient | undefined;
    let sdk: BotSDK | undefined;
    try {
        client = await startLiteClient(name);
        const env = loadBotEnv(name);
        // Observe-only connections still see state, so the spawn check never takes control.
        sdk = await connectSdk(env, opts.connect === false ? 'observe' : 'control');
        const state = await sdk.waitForReady(STATE_READY_TIMEOUT_MS);
        const p = state.player;
        if (save.position && p && distance({ x: p.worldX, z: p.worldZ }, save.position) > SPAWN_TOLERANCE) {
            throw new Error(
                `${name} logged in at (${p.worldX},${p.worldZ}), not the fixture position ` +
                    `(${save.position.x},${save.position.z}): the save was not loaded. Is ${engineDir()} the ` +
                    'engine directory the running server uses? Set RS_ENGINE_DIR.',
            );
        }
        if (opts.connect === false) {
            await disconnectQuietly(sdk);
            sdk = undefined;
        }
        return await fn({ name, env, sdk: sdk as BotSDK, bot: new BotActions(sdk as BotSDK), client });
    } catch (e) {
        if (client && e instanceof Error) {
            e.message += `\n--- lite client log tail (${client.log}) ---\n${logTail(client.log)}`;
        }
        throw e;
    } finally {
        if (sdk) await disconnectQuietly(sdk);
        await client?.stop();
        rmSync(join(REPO_ROOT, 'bots', name), { recursive: true, force: true });
    }
}

export interface TaskRun {
    /** The parsed `RESULT <json>` line (a TaskResult). */
    result: Record<string, any>;
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

/** Run `bun conductor/run-task.ts` as a subprocess against `bot` and parse its RESULT line. */
export function runTask(bot: string, task: string, params: unknown, until: string[]): Promise<TaskRun> {
    const args = ['conductor/run-task.ts', bot, task, '--params', JSON.stringify(params)];
    for (const u of until) args.push('--until', u);
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', c => (stdout += c));
        proc.stderr.on('data', c => (stderr += c));
        proc.once('error', reject);
        proc.once('close', exitCode => {
            const line = stdout.split('\n').findLast(l => l.startsWith('RESULT '));
            if (!line) {
                reject(new Error(`run-task printed no RESULT line (exit ${exitCode}):\n${stdout}\n${stderr}`));
                return;
            }
            resolve({ result: JSON.parse(line.slice('RESULT '.length)), stdout, stderr, exitCode });
        });
    });
}
