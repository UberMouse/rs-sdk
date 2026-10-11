import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    botWorld,
    buildPath,
    defaultCacheDir,
    FeedProbe,
    feedUrl,
    RsWorldProxy,
    upstreamUrl,
} from '../../../tools/plan-view/world';

const tmp = mkdtempSync(join(tmpdir(), 'plan-view-world-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const UPSTREAM = 'https://pages.example/rs-world/';

/** A fake upstream: answers from `files`, honours If-None-Match, and records what it was asked. */
function upstream(files: Record<string, { body: string; etag?: string; type?: string }>) {
    const calls: { url: string; ifNoneMatch: string | null }[] = [];
    let down = false;
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
        const ifNoneMatch = new Headers(init?.headers).get('if-none-match');
        calls.push({ url, ifNoneMatch });
        if (down) throw new Error('offline');
        const f = files[url.slice(UPSTREAM.length)];
        if (!f) return new Response('nope', { status: 404 });
        if (f.etag && ifNoneMatch === f.etag) return new Response(null, { status: 304 });
        return new Response(f.body, {
            headers: { 'content-type': f.type ?? 'text/plain', ...(f.etag && { etag: f.etag }) },
        });
    };
    return {
        fetchFn,
        calls,
        goDown: () => {
            down = true;
        },
    };
}

describe('buildPath', () => {
    test('maps /rs-world/ paths into the build; the root is its index; nothing climbs out', () => {
        expect(buildPath('/rs-world/')).toBe('index.html');
        expect(buildPath('/rs-world/static/js/main.1.js')).toBe('static/js/main.1.js');
        expect(buildPath('/rs-world/caches/rs-sdk-289/')).toBe('caches/rs-sdk-289/index.html');
        expect(buildPath('/rs-world/../etc/passwd')).toBeNull();
        expect(buildPath('/rs-world/a/%2e%2e/b')).toBeNull();
        expect(buildPath('/rs-world/%E0%A4%A')).toBeNull();
        expect(buildPath('/elsewhere')).toBeNull();
    });

    test('no path names another host: schemes, empty segments and escapes are refused', () => {
        for (const p of [
            '/rs-world/https://evil.com/x',
            '/rs-world///evil.com/x',
            '/rs-world/%2F%2Fevil.com/x',
            '/rs-world/a//b.js',
            '/rs-world/c:/x',
        ])
            expect(buildPath(p)).toBeNull();
        expect(upstreamUrl('static/a.js', UPSTREAM)).toBe(`${UPSTREAM}static/a.js`);
        expect(upstreamUrl('//evil.com/x', UPSTREAM)).toBeNull();
        expect(upstreamUrl('https://evil.com/x', UPSTREAM)).toBeNull();
    });

    test('the cache lives under XDG_CACHE_HOME, else ~/.cache', () => {
        expect(defaultCacheDir({ XDG_CACHE_HOME: '/c' })).toBe('/c/rs-sdk/plan-view/rs-world');
        expect(defaultCacheDir({})).toEndWith('/.cache/rs-sdk/plan-view/rs-world');
    });
});

describe('RsWorldProxy', () => {
    test('serves isolated, keeps hashed files, revalidates the rest by ETag, falls back offline', async () => {
        const up = upstream({
            'index.html': { body: '<html>v1</html>', etag: '"i1"', type: 'text/html' },
            'static/js/main.abc.js': { body: 'js', type: 'text/javascript' },
        });
        const proxy = new RsWorldProxy(join(tmp, 'cache1'), UPSTREAM, up.fetchFn);

        const page = await proxy.serve('/rs-world/');
        expect(page.status).toBe(200);
        expect(await page.text()).toBe('<html>v1</html>');
        expect(page.headers.get('content-type')).toBe('text/html');
        expect(page.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin');
        expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin');

        // Revalidated with its ETag: a 304 serves the cached copy.
        expect(await (await proxy.serve('/rs-world/index.html')).text()).toBe('<html>v1</html>');
        expect(up.calls.at(-1)).toEqual({ url: `${UPSTREAM}index.html`, ifNoneMatch: '"i1"' });

        // A content-hashed file is fetched once.
        expect(await (await proxy.serve('/rs-world/static/js/main.abc.js')).text()).toBe('js');
        const asked = up.calls.length;
        const again = await proxy.serve('/rs-world/static/js/main.abc.js');
        expect(await again.text()).toBe('js');
        expect(again.headers.get('cache-control')).toContain('immutable');
        expect(up.calls.length).toBe(asked);

        // Offline: what is cached is served, what isn't is a 502.
        up.goDown();
        expect(await (await proxy.serve('/rs-world/')).text()).toBe('<html>v1</html>');
        expect((await proxy.serve('/rs-world/caches/caches.json')).status).toBe(502);
    });

    test('passes a 404 on, refuses a bad path, and shares one upstream request between viewers', async () => {
        const up = upstream({ 'caches/caches.json': { body: '[]', etag: '"c"' } });
        const proxy = new RsWorldProxy(join(tmp, 'cache2'), UPSTREAM, up.fetchFn);
        expect((await proxy.serve('/rs-world/missing.js')).status).toBe(404);
        expect((await proxy.serve('/rs-world/../x')).status).toBe(400);
        const before = up.calls.length;
        const both = await Promise.all([
            proxy.serve('/rs-world/caches/caches.json'),
            proxy.serve('/rs-world/caches/caches.json'),
        ]);
        expect(await Promise.all(both.map(r => r.text()))).toEqual(['[]', '[]']);
        expect(up.calls.length).toBe(before + 1);
        // An off-host path never reaches upstream.
        expect((await proxy.serve('/rs-world/https://evil.com/x')).status).toBe(400);
        expect(up.calls.every(c => c.url.startsWith(UPSTREAM))).toBe(true);
    });

    test('a body cut off mid-transfer falls back to the cache, else a 502; a corrupt meta is a miss', async () => {
        const cacheDir = join(tmp, 'cache3');
        let cut = false;
        const fetchFn = async (): Promise<Response> => {
            if (!cut) return new Response('v1', { headers: { 'content-type': 'text/plain', etag: '"1"' } });
            const body = new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode('par'));
                    c.error(new Error('connection reset'));
                },
            });
            return new Response(body, { headers: { etag: '"2"' } });
        };
        const proxy = new RsWorldProxy(cacheDir, UPSTREAM, fetchFn);
        expect(await (await proxy.serve('/rs-world/a.json')).text()).toBe('v1');
        cut = true;
        const fallback = await proxy.serve('/rs-world/a.json');
        expect(await fallback.text()).toBe('v1');
        expect(fallback.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        expect((await proxy.serve('/rs-world/b.json')).status).toBe(502);

        // A meta without its type is no cache entry: the file is fetched again, whole.
        cut = false;
        writeFileSync(join(cacheDir, 'meta/a.json.json'), JSON.stringify({ etag: '"1"' }));
        const again = await proxy.serve('/rs-world/a.json');
        expect(again.headers.get('content-type')).toBe('text/plain');
    });
});

/** An engine's answer to the probe's handshake. */
const handshake = (status: number) => async () => new Response(null, { status });

describe('FeedProbe', () => {
    const origin = 'http://engine.test:8888';

    test('a feed that says hello is on; a refused handshake says why', async () => {
        const on = new FeedProbe(async () => true, handshake(500));
        expect(await on.info({ webOrigin: origin, username: 'Bot1' })).toEqual({
            follow: 'Bot1',
            feed: 'ws://engine.test:8888/worldfeed',
            status: 'on',
            message: null,
        });
        const status = async (code: number) =>
            (await new FeedProbe(async () => false, handshake(code)).info({ webOrigin: origin, username: 'b' })).status;
        expect(await status(404)).toBe('off');
        expect(await status(403)).toBe('token');
        expect(await status(503)).toBe('full');
        expect(await status(400)).toBe('unreachable');
        const down = new FeedProbe(
            async () => false,
            async () => {
                throw new Error('refused');
            },
        );
        expect((await down.info({ webOrigin: origin, username: 'b' })).message).toContain('refused');
    });

    test('asks an engine once per ten seconds', async () => {
        let asked = 0;
        const probe = new FeedProbe(async () => {
            asked++;
            return true;
        });
        await probe.info({ webOrigin: origin, username: 'a' });
        await probe.info({ webOrigin: origin, username: 'b' });
        expect(asked).toBe(1);
    });

    test('feedUrl and botWorld: the bot.env server as a websocket, read without exporting it', () => {
        expect(feedUrl('http://localhost:8888')).toBe('ws://localhost:8888/worldfeed');
        expect(feedUrl('https://rs.example')).toBe('wss://rs.example/worldfeed');
        mkdirSync(join(tmp, 'bots/b1'), { recursive: true });
        writeFileSync(join(tmp, 'bots/b1/bot.env'), 'BOT_USERNAME=b1\nPASSWORD=secret-pw\nSERVER=rs.example\n');
        const before = process.env.PASSWORD;
        expect(botWorld('b1', tmp)).toEqual({ webOrigin: 'https://rs.example', username: 'b1' });
        expect(process.env.PASSWORD).not.toBe('secret-pw');
        expect(process.env.PASSWORD === before).toBe(true);
        writeFileSync(join(tmp, 'bots/b1/bot.env'), 'PASSWORD=x\n');
        expect(() => botWorld('b1', tmp)).toThrow(/BOT_USERNAME/);
    });
});
