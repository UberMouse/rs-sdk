import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
    const raw: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) raw[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    for (const [k, v] of Object.entries(raw)) process.env[k] = v;
    if (!raw.BOT_USERNAME || !raw.PASSWORD) throw new Error(`${path} is missing BOT_USERNAME or PASSWORD`);

    const server = raw.SERVER || undefined;
    let webOrigin = 'http://localhost:8888';
    if (server && !server.startsWith('localhost') && !server.startsWith('127.')) {
        webOrigin = /^wss?:\/\//.test(server)
            ? server.replace(/^ws/, 'http').replace(/\/gateway$/, '')
            : `https://${server}`;
    } else if (server?.includes(':')) {
        webOrigin = `http://${server}`;
    }
    return { username: raw.BOT_USERNAME, password: raw.PASSWORD, server, webOrigin, raw };
}

export function botClientUrl(env: BotEnv): string {
    return `${env.webOrigin}/bot?bot=${encodeURIComponent(env.username)}&password=${encodeURIComponent(env.password)}`;
}
