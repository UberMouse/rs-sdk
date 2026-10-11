// The plan viewer's world panel: rs-world (github.com/maxbittker/rs-world), a live 3D view of an
// rs-sdk world, served from the viewer's own origin and following the bot over its engine's world
// feed (ws://<engine>/worldfeed, on when the engine runs with WORLD_FEED=true).
//
// rs-world shares buffers with its workers (SharedArrayBuffer), so it runs only cross-origin
// isolated: the viewer's page and every rs-world file are served with COOP/COEP headers, and the
// files are proxied from the published build rather than framed from it. They are cached on disk;
// content-hashed files (static/) are kept, the rest revalidated by ETag, and served from the cache
// when GitHub Pages can't be reached.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { webOriginFor } from '../../../sdk/runner';
import { FETCH_TIMEOUT_MS } from '../../lib/env';
import { errMessage } from '../../lib/util';

/** Where the viewer serves rs-world: the path its build was published under, so its absolute URLs resolve. */
export const RS_WORLD_PATH = '/rs-world/';
export const RS_WORLD_UPSTREAM = 'https://maxbittker.github.io/rs-world/';

/** What makes a page cross-origin isolated; CORP lets an isolated page embed it. */
export const ISOLATION_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
} as const;

/** `$XDG_CACHE_HOME/rs-sdk/plan-view/rs-world`, else under ~/.cache. */
export function defaultCacheDir(env: Record<string, string | undefined> = process.env): string {
    return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'rs-sdk/plan-view/rs-world');
}

/** One segment of a build file's path: the build's names are plain (hashed chunks, cache files). */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * A path under RS_WORLD_PATH as a file path inside the build; null for anything else. Only plain
 * segments pass: no '.', '..', empty segment, scheme or escape, so the path can't climb out of the
 * cache directory or resolve to another host than the build's.
 */
export function buildPath(pathname: string): string | null {
    if (!pathname.startsWith(RS_WORLD_PATH)) return null;
    const rel = pathname.slice(RS_WORLD_PATH.length);
    const dir = rel === '' || rel.endsWith('/');
    const parts = dir ? rel.split('/').slice(0, -1) : rel.split('/');
    if (parts.some(p => !SEGMENT.test(p) || p === '.' || p === '..')) return null;
    return dir ? `${rel}index.html` : rel;
}

/** A build file's URL upstream; null unless it stays under `upstream`. */
export function upstreamUrl(rel: string, upstream: string): string | null {
    const href = new URL(rel, upstream).href;
    return href.startsWith(upstream) ? href : null;
}

interface Meta {
    etag: string | null;
    type: string;
}

/** A cached file's meta as written; null for a file that isn't (then the file is fetched again). */
function metaOf(x: unknown): Meta | null {
    if (!x || typeof x !== 'object') return null;
    const { etag, type } = x as Record<string, unknown>;
    if (typeof type !== 'string' || (etag !== null && typeof etag !== 'string')) return null;
    return { etag, type };
}

/** How long one upstream file may take: the build's cache data is ~10 MB, more than an API answer. */
const UPSTREAM_TIMEOUT_MS = 30_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Serves rs-world's build from the cache, filling and revalidating it from `upstream`. */
export class RsWorldProxy {
    /** One upstream request per file at a time; a second viewer waits for the first's. */
    private inflight = new Map<string, Promise<Response>>();

    constructor(
        readonly cacheDir: string = defaultCacheDir(),
        private readonly upstream: string = RS_WORLD_UPSTREAM,
        private readonly fetchFn: Fetch = fetch,
    ) {}

    async serve(pathname: string): Promise<Response> {
        const rel = buildPath(pathname);
        const url = rel === null ? null : upstreamUrl(rel, this.upstream);
        if (rel === null || url === null) return new Response('bad path', { status: 400, headers: ISOLATION_HEADERS });
        let pending = this.inflight.get(rel);
        if (!pending) {
            pending = this.load(rel, url).finally(() => this.inflight.delete(rel));
            this.inflight.set(rel, pending);
        }
        // Each caller gets its own body.
        return (await pending).clone();
    }

    private file = (rel: string) => join(this.cacheDir, 'files', rel);
    private metaFile = (rel: string) => join(this.cacheDir, 'meta', `${rel}.json`);

    private cached(rel: string): { body: Buffer; meta: Meta } | null {
        try {
            const meta = metaOf(JSON.parse(readFileSync(this.metaFile(rel), 'utf8')));
            return meta && { body: readFileSync(this.file(rel)), meta };
        } catch {
            return null;
        }
    }

    private respond(rel: string, body: Buffer, meta: Meta): Response {
        const immutable = rel.startsWith('static/');
        return new Response(body, {
            headers: {
                ...ISOLATION_HEADERS,
                'Content-Type': meta.type,
                'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
            },
        });
    }

    /** The build file `rel`, from the cache or from `url` upstream. */
    private async load(rel: string, url: string): Promise<Response> {
        const hit = this.cached(rel);
        // Content-hashed: a file under a name never changes.
        if (hit && rel.startsWith('static/')) return this.respond(rel, hit.body, hit.meta);
        let res: Response;
        let body: Buffer;
        try {
            res = await this.fetchFn(url, {
                headers: hit?.meta.etag ? { 'If-None-Match': hit.meta.etag } : {},
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            });
            if (res.status === 304 && hit) return this.respond(rel, hit.body, hit.meta);
            if (!res.ok) {
                await res.body?.cancel();
                if (hit && res.status >= 500) return this.respond(rel, hit.body, hit.meta);
                return new Response(`rs-world: ${res.status} from ${this.upstream}`, {
                    status: res.status === 404 ? 404 : 502,
                    headers: ISOLATION_HEADERS,
                });
            }
            // A body cut off mid-transfer fails here, and falls back as an unanswered request does.
            body = Buffer.from(await res.arrayBuffer());
        } catch (e) {
            if (hit) return this.respond(rel, hit.body, hit.meta);
            return new Response(`rs-world: ${errMessage(e)}`, { status: 502, headers: ISOLATION_HEADERS });
        }
        const meta: Meta = {
            etag: res.headers.get('etag'),
            type: res.headers.get('content-type') ?? 'application/octet-stream',
        };
        try {
            writeAtomic(this.file(rel), body);
            writeAtomic(this.metaFile(rel), JSON.stringify(meta));
        } catch (e) {
            console.error(`plan-view: rs-world cache ${rel}: ${errMessage(e)}`);
        }
        return this.respond(rel, body, meta);
    }
}

/** Writes beside the file and renames over it, so a reader never sees half a file. */
function writeAtomic(file: string, data: string | Buffer): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, file);
}

/** on: the feed answers; off: the engine runs without WORLD_FEED; else why it can't be used. */
export type FeedStatus = 'on' | 'off' | 'token' | 'full' | 'unreachable';

export interface WorldInfo {
    /** The player rs-world follows: the bot's account name. */
    follow: string;
    /** The engine's world feed, as the browser connects to it. */
    feed: string;
    status: FeedStatus;
    message: string | null;
}

/** The engine a bot plays on and its account name, from its bot.env (read, not exported into process.env). */
export function botWorld(bot: string, root: string): { webOrigin: string; username: string } {
    const path = join(root, 'bots', bot, 'bot.env');
    const env = parseEnv(readFileSync(path, 'utf8')) as Record<string, string | undefined>;
    if (!env.BOT_USERNAME) throw new Error(`${path} has no BOT_USERNAME`);
    return { webOrigin: webOriginFor(env.SERVER || undefined), username: env.BOT_USERNAME };
}

/** The world feed of the engine at a web origin, as a websocket URL. */
export const feedUrl = (webOrigin: string): string => `${webOrigin.replace(/^http/, 'ws')}/worldfeed`;

/** How long a feed's status is reused before the engine is asked again. */
const PROBE_TTL_MS = 10_000;
const HELLO_TIMEOUT_MS = 3000;

/** Opens a feed and resolves true on its first message (the hello), false on an error or a timeout; then closes it. */
export type FeedHello = (url: string) => Promise<boolean>;
const feedHello: FeedHello = url =>
    new Promise(resolve => {
        let ws: WebSocket;
        try {
            ws = new WebSocket(url);
        } catch {
            resolve(false);
            return;
        }
        const done = (ok: boolean) => {
            clearTimeout(timer);
            resolve(ok);
            try {
                ws.close();
            } catch {
                // already closed
            }
        };
        const timer = setTimeout(() => done(false), HELLO_TIMEOUT_MS);
        ws.addEventListener('message', () => done(true));
        ws.addEventListener('error', () => done(false));
        ws.addEventListener('close', () => done(false));
    });

/** A websocket handshake's headers, for asking why an engine refuses the feed. */
const UPGRADE = {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'cGxhbi12aWV3IHByb2JlIQ==',
};

/**
 * Whether an engine's world feed can be used. It answers only websocket handshakes (a plain GET of
 * its path is the web server's 404 either way): a feed that sends its hello is on; else the refused
 * handshake's status says why: 404 off, 403 without its token, 503 full.
 */
export class FeedProbe {
    private cache = new Map<string, { at: number; status: Promise<Pick<WorldInfo, 'status' | 'message'>> }>();

    constructor(
        private readonly hello: FeedHello = feedHello,
        private readonly fetchFn: Fetch = fetch,
    ) {}

    async info(world: { webOrigin: string; username: string }): Promise<WorldInfo> {
        let hit = this.cache.get(world.webOrigin);
        if (!hit || Date.now() - hit.at > PROBE_TTL_MS) {
            hit = { at: Date.now(), status: this.probe(world.webOrigin) };
            this.cache.set(world.webOrigin, hit);
        }
        return { follow: world.username, feed: feedUrl(world.webOrigin), ...(await hit.status) };
    }

    private async probe(origin: string): Promise<Pick<WorldInfo, 'status' | 'message'>> {
        if (await this.hello(feedUrl(origin))) return { status: 'on', message: null };
        let res: Response;
        try {
            res = await this.fetchFn(`${origin}/worldfeed`, {
                headers: UPGRADE,
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            await res.body?.cancel();
        } catch (e) {
            return { status: 'unreachable', message: `the engine at ${origin} did not answer: ${errMessage(e)}` };
        }
        switch (res.status) {
            case 404:
                return {
                    status: 'off',
                    message: `the engine at ${origin} runs without its world feed: restart it with WORLD_FEED=true (conductor/local/up.sh sets it)`,
                };
            case 403:
                return { status: 'token', message: 'the world feed needs a token (WORLD_FEED_TOKEN)' };
            case 503:
                return { status: 'full', message: 'the world feed has its most clients (WORLD_FEED_MAX_CLIENTS)' };
            default:
                return {
                    status: 'unreachable',
                    message: `the world feed at ${feedUrl(origin)} sent no hello (handshake: ${res.status})`,
                };
        }
    }
}
