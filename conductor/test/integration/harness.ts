// Integration harness: a fresh bot spawned from a generated save, driven through the real local
// stack (engine + gateway + headless lite client). Each test gets its own never-used account, so
// tests run in parallel and leave no state behind that another test reads. Saves are written
// through the engine's management port (conductor/lib/saves.ts writeSave), so the engine says
// which file it reads; clients start through conductor/lib/client.ts.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { crc32 } from 'node:zlib';
import { createSaveData, Skills, type SaveConfig } from '../../../sdk/test/utils/save-generator';
import { type LiteClient, startLiteClient } from '../../lib/client';
import { connectSdk, disconnectQuietly, loadBotEnv, REPO_ROOT, type BotEnv } from '../../lib/env';
import { unstackableStacks, writeSave } from '../../lib/saves';
import { distance } from '../../lib/util';

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
/** Covers what itestTimeout's stages omit (SDK connect, the extra client stop after a failed start), so bun's timeout never fires before the harness's and hides its output tail. */
const TIMEOUT_MARGIN_MS = 30_000;
/** Variables loadBotEnv exports (sdk/runner.ts loadEnvFile) from the last bot's bot.env; children read their own bot.env. */
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
 * stops) and teardown, so the harness's own timeouts fire before bun's. `extraMs` is the test body's
 * own worst case, for tests that drive the bot with the control SDK instead of a task.
 */
export function itestTimeout(opts: { taskMinutes?: number; extraMs?: number }): number {
    const task =
        opts.taskMinutes === undefined ? 0 : taskTimeoutMs([`minutes:${opts.taskMinutes}`]) + TASK_TERM_GRACE_MS;
    return (
        LITE_START_TIMEOUT_MS + STATE_READY_TIMEOUT_MS + task + (opts.extraMs ?? 0) + TEARDOWN_MS + TIMEOUT_MARGIN_MS
    );
}

// Everything this process spawned that is still alive, and the fixture dirs it created. A dying
// parent (exit, SIGINT, SIGTERM) SIGKILLs them at once (no graceful client stop, no task RESULT) and
// removes the fixture dirs, so a crashed or interrupted run leaves no client or task controlling a
// bot; a SIGKILLed client leaves its bot logged in until the server times the session out. Handlers are registered once per process, on first spawn.
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

/** A fresh account name that has never been online. */
export function freshBotName(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(NAME_RANDOM_CHARS);
    let out = NAME_PREFIX;
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
}

/** Bytes before the skill block in a save: magic, version, position, appearance, energy, playtime. */
const SAVE_SKILLS_OFFSET = 28;
/** Bytes per skill in a save: p4 experience, p1 level. */
const SAVE_SKILL_BYTES = 5;
const SAVE_CRC_BYTES = 4;

/** Engine experience for a level, the formula save-generator.ts uses (10 units per displayed xp). */
export function levelXp(level: number): number {
    let xp = 0;
    for (let i = 1; i < level; i++) xp += Math.floor(i + 300 * Math.pow(2, i / 10));
    return Math.floor(xp / 4) * 10;
}

/** The level createSaveData writes for a skill: the config's level or 1, and Hitpoints 10 unless raised. */
function savedLevel(config: SaveConfig, skill: string): number {
    const key = skill.toUpperCase();
    const level = Object.entries(config.skills ?? {}).find(([n]) => n.toUpperCase() === key)?.[1] ?? 1;
    return key === 'HITPOINTS' && level === 1 ? 10 : level;
}

const slot = (index: number) => SAVE_SKILLS_OFFSET + index * SAVE_SKILL_BYTES;
const drift = (what: string) =>
    new Error(`patchSkillXp: save layout drifted from sdk/test/utils/save-generator.ts (${what})`);

/**
 * Raw experience (engine units, 10 per displayed xp) per skill, replacing the threshold of the level
 * SaveConfig gives it. The engine derives the base level from experience on load, so
 * `xp: { Woodcutting: 799 }` at level 1 stands just short of level 2 (800). The save's
 * CRC covers the skill block, so it is recomputed.
 */
function patchSkillXp(save: Uint8Array, config: SaveConfig, xp: Record<string, number>): Uint8Array {
    const out = Uint8Array.from(save);
    const view = new DataView(out.buffer);
    // This duplicates sdk/test/utils/save-generator.ts's layout; fail loudly if it drifts.
    const hp = Skills.HITPOINTS;
    if (view.getInt32(slot(hp), false) !== levelXp(savedLevel(config, 'HITPOINTS')))
        throw drift('Hitpoints experience');
    for (const [skill, value] of Object.entries(xp)) {
        const index = (Skills as Record<string, number>)[skill.toUpperCase()];
        if (index === undefined) throw new Error(`unknown skill "${skill}" in fixture xp`);
        if (view.getUint8(slot(index) + 4) !== savedLevel(config, skill)) throw drift(`${skill} level byte`);
        view.setInt32(slot(index), value, false);
    }
    const body = out.length - SAVE_CRC_BYTES;
    // crc32 is unsigned; the engine's Packet.getcrc is the same CRC-32 read back as a signed int.
    view.setInt32(body, crc32(out.subarray(0, body)) | 0, false);
    return out;
}

/** Write a generated save where the running engine loads it (writeSave asks the engine which file); returns its path. */
export async function writeFixtureSave(env: BotEnv, config: SaveConfig, xp?: Record<string, number>): Promise<string> {
    const stacked = unstackableStacks(config.inventory);
    if (stacked.length)
        throw new Error(
            `fixture inventory puts several of a non-stackable item in one slot (the first use removes them all): ${stacked.join(', ')}; list one entry per copy`,
        );
    const bytes = createSaveData(config);
    return (await writeSave(env, xp ? patchSkillXp(bytes, config, xp) : bytes)).path;
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

function logTail(file: string): string {
    try {
        return readFileSync(file, 'utf8').split('\n').slice(-LOG_TAIL_LINES).join('\n');
    } catch {
        return '(no log)';
    }
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

/** Remove the lite client's log and pid file (and its directory if that leaves it empty) after a passing run. */
function removeLiteLog(botName: string): void {
    const log = join(REPO_ROOT, 'conductor/runs', botName, 'lite-client.log');
    rmSync(log, { force: true });
    rmSync(join(dirname(log), 'lite-client.pid'), { force: true });
    try {
        rmdirSync(dirname(log));
    } catch {
        // not empty (or already gone): leave it
    }
}

/**
 * Run `fn` against a fresh bot logged in from `save`. The save is checked to have loaded (the bot
 * stands at `save.position`), so a save written where the running engine doesn't look fails loudly.
 * `xp` overrides a skill's experience (see patchSkillXp). With `connect: false` no control SDK is handed out, for tests that drive the bot through
 * run-task.ts. The lite client log is removed when the run passes and kept (path in the error) when
 * it fails; the .sav stays, because the engine rewrites it on logout.
 */
export function withFixtureBot<T>(
    save: SaveConfig,
    fn: (bot: FixtureBot) => Promise<T>,
    opts?: { connect?: true; xp?: Record<string, number> },
): Promise<T>;
export function withFixtureBot<T>(
    save: SaveConfig,
    fn: (bot: FixtureBase) => Promise<T>,
    opts: { connect: false; xp?: Record<string, number> },
): Promise<T>;
export async function withFixtureBot<T>(
    save: SaveConfig,
    // The overloads above are the checked surface; `any` here lets one body serve both.
    fn: (bot: any) => Promise<T>,
    opts: { connect?: boolean; xp?: Record<string, number> } = {},
): Promise<T> {
    const name = freshBotName();
    liveFixtures.add(name);
    installCleanup();
    writeBotEnv(name);
    let client: LiteClient | undefined;
    let sdk: BotSDK | undefined;
    let failed = false;
    try {
        const env = loadBotEnv(name);
        const savePath = await writeFixtureSave(env, save, opts.xp);
        // Attached: the process's exit (killAll's process.exit included) SIGKILLs it.
        client = await startLiteClient(name, { timeoutMs: LITE_START_TIMEOUT_MS, attached: true });
        // Observe-only connections still see state, so the spawn check never takes control.
        const connected = await connectSdk(env, opts.connect === false ? 'observe' : 'control');
        sdk = connected;
        const state = await connected.waitForReady(STATE_READY_TIMEOUT_MS);
        const p = state.player;
        if (save.position && p && distance({ x: p.worldX, z: p.worldZ }, save.position) > SPAWN_TOLERANCE) {
            throw new Error(
                `${name} logged in at (${p.worldX},${p.worldZ}), not the fixture position ` +
                    `(${save.position.x},${save.position.z}): the save written to ${savePath} was not loaded.`,
            );
        }
        // "Ready" only means a position and some entities: the inventory snapshot can arrive later.
        if (save.inventory?.length || save.coins) {
            await connected.waitForCondition(s => s.inventory.length > 0, STATE_READY_TIMEOUT_MS);
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
    /** The parsed `RESULT <json>` line (a TaskResult; a PlanResult from runPlan). */
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
 * Run `bun conductor/run-task.ts <args>` as a subprocess and parse its RESULT line; `what` names the
 * run in the failure messages (a task, or `--plan <file>`). After `timeoutMs` it sends SIGTERM
 * (run-task prints its own RESULT then), SIGKILL after a grace period, and rejects with the output
 * tail once the process is gone.
 */
function runConductor(what: string, args: string[], timeoutMs: number): Promise<TaskRun> {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, ['conductor/run-task.ts', ...args], {
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
                    reject(new Error(`run-task ${what} timed out after ${timeoutMs}ms\n${outputTail(stdout, stderr)}`));
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

const untilArgs = (until: string[]) => until.flatMap(u => ['--until', u]);

/**
 * Run catalog task `task` on `bot` through run-task.ts and parse its RESULT. `timeoutMs` defaults to
 * the earliest `minutes:N` stop plus a margin, else 10 minutes.
 */
export function runTask(
    bot: string,
    task: string,
    params: unknown,
    until: string[],
    opts: { timeoutMs?: number } = {},
): Promise<TaskRun> {
    return runConductor(
        task,
        [bot, task, '--params', JSON.stringify(params), ...untilArgs(until)],
        opts.timeoutMs ?? taskTimeoutMs(until),
    );
}

/**
 * Run the plan in `file` (relative to the repo root) on `bot` through `run-task.ts --plan`, as runTask
 * runs a task; its RESULT is a PlanResult, and `minutes:N` counts from the plan's start.
 */
export function runPlan(
    bot: string,
    file: string,
    until: string[],
    opts: { timeoutMs?: number } = {},
): Promise<TaskRun> {
    return runConductor(
        `--plan ${file}`,
        [bot, '--plan', file, ...untilArgs(until)],
        opts.timeoutMs ?? taskTimeoutMs(until),
    );
}
