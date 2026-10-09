// Start a bot's headless lite client (server/webclient/src/lite/runner.ts) and wait until it is ready.
// Only clients started here are tracked (pid file in conductor/runs/<bot>/); a client started by
// hand or by tools/client.ts is not, and stopLiteClient leaves it alone.
import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, sleep } from './env';

/** Printed by the lite runner once it is logged in and attached to the gateway. */
const READY = 'Gateway connected';
const POLL_MS = 250;
const STOP_GRACE_MS = 5_000;
/** In conductor/runs/<bot>/: the pid of the lite client startLiteClient last spawned. */
const PID_FILE = 'lite-client.pid';

/** Is `pid` still this bot's lite runner? Checks the command line, so a recycled pid is never signalled. */
function isRunner(pid: number, botName: string): boolean {
    try {
        const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
        return argv.some(a => a.endsWith('lite/runner.ts')) && argv.includes(botName);
    } catch {
        return false;
    }
}

/** Send a signal; false when the process is already gone. */
function signal(target: { kill(signal: NodeJS.Signals): unknown } | number, sig: NodeJS.Signals): boolean {
    try {
        if (typeof target === 'number') process.kill(target, sig);
        else target.kill(sig);
        return true;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw e;
    }
}

/** Stop the lite client startLiteClient last spawned for this bot, if it is still running. Returns whether one was. */
export async function stopLiteClient(botName: string): Promise<boolean> {
    const pidFile = join(REPO_ROOT, 'conductor/runs', botName, PID_FILE);
    if (!existsSync(pidFile)) return false;
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    rmSync(pidFile);
    if (!Number.isInteger(pid) || pid <= 0 || !isRunner(pid, botName)) return false;
    if (!signal(pid, 'SIGINT')) return false;
    const deadline = Date.now() + STOP_GRACE_MS;
    while (isRunner(pid, botName) && Date.now() < deadline) await sleep(POLL_MS);
    if (isRunner(pid, botName)) signal(pid, 'SIGKILL');
    return true;
}

export interface LiteClient {
    pid: number;
    log: string;
    /** SIGINT (the runner's clean shutdown), then SIGKILL after a grace period. */
    stop(): Promise<void>;
}

/** A child has exited once it has an exit code or was killed by a signal. */
const exited = (proc: ChildProcess) => proc.exitCode !== null || proc.signalCode !== null;

/**
 * Spawn the lite client for bots/<botName>/bot.env, with its output in
 * conductor/runs/<botName>/lite-client.log. By default it is detached and outlives this process;
 * `attached: true` ties it to this process instead (killed when this process exits), for tests.
 * Resolves once it reports the gateway connection; rejects (and kills it) if it exits first or
 * `timeoutMs` passes.
 */
export async function startLiteClient(
    botName: string,
    { timeoutMs = 60_000, attached = false } = {},
): Promise<LiteClient> {
    const runDir = join(REPO_ROOT, 'conductor/runs', botName);
    mkdirSync(runDir, { recursive: true });
    const log = join(runDir, 'lite-client.log');
    const fd = openSync(log, 'w');
    const proc = spawn(process.execPath, ['src/lite/runner.ts', botName], {
        cwd: join(REPO_ROOT, 'server/webclient'),
        stdio: ['ignore', fd, fd],
        detached: !attached,
    });
    closeSync(fd);
    const pid = proc.pid;
    if (pid === undefined) throw new Error(`could not start the lite client for ${botName}`);
    if (attached) {
        process.once('exit', () => exited(proc) || signal(proc, 'SIGKILL'));
    } else {
        proc.unref();
    }
    writeFileSync(join(runDir, PID_FILE), `${pid}\n`);

    const stop = async () => {
        if (exited(proc) || !signal(proc, 'SIGINT')) return;
        const deadline = Date.now() + STOP_GRACE_MS;
        while (!exited(proc) && Date.now() < deadline) await sleep(POLL_MS);
        if (!exited(proc)) signal(proc, 'SIGKILL');
    };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (readFileSync(log, 'utf8').includes(READY)) return { pid, log, stop };
        if (exited(proc)) {
            throw new Error(
                `lite client for ${botName} exited (${proc.exitCode ?? proc.signalCode}) before connecting; see ${log}`,
            );
        }
        await sleep(POLL_MS);
    }
    await stop();
    throw new Error(`lite client for ${botName} did not connect within ${timeoutMs / 1000}s; see ${log}`);
}
