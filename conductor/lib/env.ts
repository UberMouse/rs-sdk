import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { loadEnvFile, webOriginFor } from '../../sdk/runner';

export const REPO_ROOT = resolve(import.meta.dir, '../..');

export interface BotEnv {
    username: string;
    password: string;
    server?: string;
    /** Engine web origin serving /bot, e.g. http://localhost:8888 */
    webOrigin: string;
    raw: Record<string, string>;
}

/** Read bots/<name>/bot.env and export it into process.env for the SDK. */
export function loadBotEnv(name: string): BotEnv {
    const path = join(REPO_ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`No bot.env for "${name}" at ${path}`);
    const raw = loadEnvFile(path);
    if (!raw.BOT_USERNAME || !raw.PASSWORD) throw new Error(`${path} is missing BOT_USERNAME or PASSWORD`);

    const server = raw.SERVER || undefined;
    const webOrigin = webOriginFor(server);
    return { username: raw.BOT_USERNAME, password: raw.PASSWORD, server, webOrigin, raw };
}

/** loadBotEnv for CLI tools: a missing or incomplete bot.env is a usage error (exit 2), not a stack trace. */
export function loadBotEnvOrFail(name: string): BotEnv {
    try {
        return loadBotEnv(name);
    } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(2);
    }
}

export function botClientUrl(env: BotEnv): string {
    return `${env.webOrigin}/bot?bot=${encodeURIComponent(env.username)}&password=${encodeURIComponent(env.password)}`;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Longest a request to the engine or gateway may take before it counts as failed. */
export const FETCH_TIMEOUT_MS = 5_000;

/** Number of control connections the gateway has for the bot. Throws when it can't tell. */
export async function controllerCount(env: BotEnv): Promise<number> {
    const url = `${env.webOrigin}/status/${encodeURIComponent(env.username)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const status = (await res.json()) as { controllers?: unknown };
    if (status.controllers !== undefined && !Array.isArray(status.controllers)) {
        throw new Error(`${url}: unexpected controllers field`);
    }
    return status.controllers?.length ?? 0;
}

/** Connect a BotSDK that never launches a browser or reconnects. Caller must disconnectQuietly it. */
export async function connectSdk(env: BotEnv, mode: 'observe' | 'control'): Promise<BotSDK> {
    const sdk = new BotSDK({
        botUsername: env.username,
        password: env.password,
        gatewayUrl: deriveGatewayUrl(env.server),
        connectionMode: mode,
        autoLaunchBrowser: false,
        autoReconnect: false,
        showChat: false,
    });
    try {
        await sdk.connect();
    } catch (e) {
        await disconnectQuietly(sdk);
        throw e;
    }
    return sdk;
}

/** Disconnect, but never wait more than `ms`; the timeout timer is cleared so it cannot hold the process open. */
export async function disconnectQuietly(sdk: BotSDK, ms = 3000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            sdk.disconnect(),
            new Promise(r => {
                timer = setTimeout(r, ms);
            }),
        ]);
    } catch {
        // already disconnected
    } finally {
        clearTimeout(timer);
    }
}
