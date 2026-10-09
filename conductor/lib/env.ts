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

export function botClientUrl(env: BotEnv): string {
    return `${env.webOrigin}/bot?bot=${encodeURIComponent(env.username)}&password=${encodeURIComponent(env.password)}`;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
