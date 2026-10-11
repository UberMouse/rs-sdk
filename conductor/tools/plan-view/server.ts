// The plan viewer's HTTP side: the page, JSON reads of the run logs, one Server-Sent Events stream
// per viewer that follows a bot's newest run (a plan, or a task run of its own) as its logs grow, and
// the world panel's rs-world build. Read-only throughout.
import type { Server } from 'bun';
import { basename, join } from 'node:path';
import {
    applyRunEvent,
    type BotSnapshot,
    foldPhase,
    foldRun,
    followed,
    groupSessions,
    type LogEvent,
    openRun,
    type PhaseLog,
    type Run,
    type RunSummary,
} from './model';
import { errMessage } from '../../lib/util';
import { Observers } from './observer';
import { BOT_NAME, isTestBot, RUN_ID, RunsStore, type SessionOwner, Tail } from './store';
import { botWorld, FeedProbe, ISOLATION_HEADERS, RS_WORLD_PATH, RsWorldProxy, type WorldInfo } from './world';

/** How often a live stream reads its logs, and re-lists the bot's runs. */
const TAIL_MS = 500;
const LIST_MS = 2000;
const HEARTBEAT_MS = 15_000;

export interface BotInfo {
    bot: string;
    /** Its plan runs and task runs of their own. */
    runs: number;
    latest: RunSummary | null;
    /** An integration test's throwaway account. */
    test: boolean;
}

export interface SessionsReply {
    sessions: ReturnType<typeof groupSessions>;
    owners: SessionOwner[];
}

export interface RunReply {
    run: Run;
    /** A plan's source copy; null for a task run. */
    source: string | null;
    /** The open phase run's runId, also for logs that only name it at its end. */
    openPhase: string | null;
}

/** The SSE events a live stream sends, by name. */
export interface LiveEvents {
    runs: SessionsReply;
    run: RunReply;
    'run-events': { runId: string; events: LogEvent[] };
    /** A run without a result whose process was found gone, or found again. */
    'run-state': { runId: string; state: Run['state'] };
    phase: PhaseLog;
    'phase-events': { runId: string; events: LogEvent[] };
    bot: BotSnapshot;
}

export interface ServerOptions {
    roots: string[];
    port?: number;
    hostname?: string;
    /** Connect observers for the bot panel. Default true; tests turn it off. */
    observe?: boolean;
    /** Serves the world panel's rs-world build; the default proxies the published one. */
    rsWorld?: RsWorldProxy;
    /** Tells whether a bot's engine serves its world feed. */
    feeds?: FeedProbe;
}

const json = (x: unknown, status = 200) => Response.json(x, { status });
const bad = (msg: string) => json({ error: msg }, 400);
const noop = () => {};
const botParam = (url: URL) => {
    const bot = url.searchParams.get('bot');
    return bot && BOT_NAME.test(bot) ? bot : null;
};

/** The open phase run's log file and runId, also for plan logs that only name a run at its end. */
function openPhase(store: RunsStore, run: Run, dir: string): { file: string; runId: string } | null {
    const open = openRun(run);
    const file = open && store.phaseFile(run, open, dir);
    return file ? { file, runId: basename(file, '.ndjson') } : null;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const isLoopback = (host: string) => LOOPBACK.has(host);
/**
 * Whether a request may be answered: bound to loopback, only when it names a loopback host, so a
 * page that rebinds its own name to 127.0.0.1 can't read the logs through the viewer's browser.
 */
export function hostAllowed(req: Request, boundHost: string): boolean {
    if (!isLoopback(boundHost)) return true;
    const host = req.headers.get('host') ?? '';
    return isLoopback(host.replace(/:\d+$/, ''));
}

export function startServer(opts: ServerOptions): { server: Server; url: string; close(): Promise<void> } {
    const store = new RunsStore(opts.roots);
    const hostname = opts.hostname ?? '127.0.0.1';
    /** Wraps a route so it answers only requests naming a loopback host (see hostAllowed). */
    const loopback =
        (handler: (req: Request) => Response | Promise<Response>) =>
        (req: Request): Response | Promise<Response> =>
            hostAllowed(req, hostname) ? handler(req) : json({ error: 'forbidden host' }, 403);
    const observers = opts.observe === false ? null : new Observers(bot => store.botRoot(bot));
    const rsWorld = opts.rsWorld ?? new RsWorldProxy();
    const feeds = opts.feeds ?? new FeedProbe();
    let page: Promise<Map<string, Blob>> | null = null;

    const bots = (): BotInfo[] => {
        const runs = store.runs();
        return [...store.botDirs().keys()]
            .map(bot => {
                const mine = runs.filter(p => p.bot === bot);
                return { bot, runs: mine.length, latest: followed(mine, bot), test: isTestBot(bot) };
            })
            .sort(
                (a, b) =>
                    Number(b.latest?.state === 'running') - Number(a.latest?.state === 'running') ||
                    (b.latest?.startedAt ?? 0) - (a.latest?.startedAt ?? 0),
            );
    };
    const sessions = (bot?: string): SessionsReply => ({
        sessions: groupSessions(store.runs(bot)),
        owners: store.owners(),
    });
    const runReply = (bot: string, runId: string): RunReply | null => {
        const p = store.run(bot, runId);
        if (!p) return null;
        return { run: p.run, source: store.source(p), openPhase: openPhase(store, p.run, p.dir)?.runId ?? null };
    };

    const live = (req: Request, bot: string): Response => {
        let cleanup: () => void = noop;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const enc = new TextEncoder();
                let closed = false;
                const send = <K extends keyof LiveEvents>(event: K, data: LiveEvents[K]) => {
                    if (closed) return;
                    try {
                        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                    } catch {
                        cleanup();
                    }
                };

                let listSig = '';
                let current: { runId: string; dir: string; tail: Tail; run: Run } | null = null;
                /** The open phase run's log; a task run's is its own log, tailed twice. */
                let phase: { file: string; runId: string; tail: Tail } | null = null;

                const follow = (summary: RunSummary) => {
                    const p = store.run(bot, summary.runId);
                    if (!p) return;
                    const tail = new Tail(p.file);
                    const run = foldRun(p.run.kind, summary.runId, bot, tail.read());
                    if (!run.result) run.state = p.run.state;
                    current = { runId: run.runId, dir: p.dir, tail, run };
                    phase = null;
                    send('run', {
                        run,
                        source: store.source(p),
                        openPhase: openPhase(store, run, p.dir)?.runId ?? null,
                    });
                    trackPhase();
                };

                /** Switches the phase tail to the open run's log once it exists; the last one stays until then. */
                const trackPhase = () => {
                    if (!current) return;
                    const open = openPhase(store, current.run, current.dir);
                    if (!open || open.file === phase?.file) return;
                    const tail = new Tail(open.file);
                    phase = { ...open, tail };
                    send('phase', foldPhase(open.runId, tail.read()));
                };

                const list = () => {
                    const runs = store.runs(bot);
                    const sig = runs.map(p => `${p.runId}:${p.state}:${p.status}`).join(',');
                    if (sig !== listSig) {
                        listSig = sig;
                        send('runs', { sessions: groupSessions(runs), owners: store.owners() });
                    }
                    const newest = followed(runs, bot);
                    if (newest && newest.runId !== current?.runId) follow(newest);
                    else if (current && !current.run.result && newest && newest.state !== current.run.state) {
                        current.run.state = newest.state;
                        send('run-state', { runId: current.runId, state: newest.state });
                    }
                };

                const tick = () => {
                    if (phase) {
                        const events = phase.tail.read();
                        if (events.length) send('phase-events', { runId: phase.runId, events });
                    }
                    if (current) {
                        const events = current.tail.read();
                        if (events.length) {
                            for (const e of events) applyRunEvent(current.run, e);
                            send('run-events', { runId: current.runId, events });
                        }
                        trackPhase();
                    }
                };

                /**
                 * A timer's body, kept from throwing: an exception in a timer would end the process
                 * and every viewer's stream with it. A failure is logged once until it changes.
                 */
                let lastError = '';
                const guarded = (fn: () => void) => () => {
                    try {
                        fn();
                        lastError = '';
                    } catch (e) {
                        const msg = errMessage(e);
                        if (msg !== lastError) console.error(`plan-view: live ${bot}: ${msg}`);
                        lastError = msg;
                    }
                };

                guarded(list)();
                const tailTimer = setInterval(guarded(tick), TAIL_MS);
                const listTimer = setInterval(guarded(list), LIST_MS);
                const beat = setInterval(() => {
                    if (closed) return;
                    try {
                        controller.enqueue(enc.encode(': beat\n\n'));
                    } catch {
                        cleanup();
                    }
                }, HEARTBEAT_MS);
                const unwatch = observers?.watch(bot, s => send('bot', s)) ?? noop;
                cleanup = () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(tailTimer);
                    clearInterval(listTimer);
                    clearInterval(beat);
                    unwatch();
                    try {
                        controller.close();
                    } catch {
                        // already closed by the client
                    }
                };
                req.signal.addEventListener('abort', () => cleanup());
            },
            cancel() {
                cleanup();
            },
        });
        return new Response(stream, {
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        });
    };

    /**
     * The page, bundled once on first request (by path: `/` and its chunks), so it can be served
     * cross-origin isolated: the world panel's rs-world needs that of the page that frames it.
     */
    const pageFiles = (): Promise<Map<string, Blob>> =>
        (page ??= Bun.build({ entrypoints: [join(import.meta.dir, 'page.html')], target: 'browser' }).then(out => {
            if (!out.success) throw new AggregateError(out.logs, 'plan-view: the page did not build');
            return new Map(out.outputs.map(a => [a.path.replace(/^\.\//, '/').replace(/^\/page\.html$/, '/'), a]));
        }));
    const servePage = async (pathname: string): Promise<Response | null> => {
        let files: Map<string, Blob>;
        try {
            files = await pageFiles();
        } catch (e) {
            page = null;
            return new Response(errMessage(e), { status: 500 });
        }
        const file = files.get(pathname);
        return file ? new Response(file, { headers: { ...ISOLATION_HEADERS, 'Content-Type': file.type } }) : null;
    };

    const world = async (bot: string): Promise<Response> => {
        const root = store.botRoot(bot);
        if (!root) return json({ error: `no bots/${bot}/bot.env in any checkout` }, 404);
        let info: WorldInfo;
        try {
            info = await feeds.info(botWorld(bot, root));
        } catch (e) {
            return json({ error: errMessage(e) }, 404);
        }
        return json(info);
    };

    const server = Bun.serve({
        hostname,
        port: opts.port ?? 7790,
        // SSE streams sit idle between events; the heartbeat keeps proxies honest.
        idleTimeout: 0,
        routes: {
            '/': loopback(async () => (await servePage('/')) ?? json({ error: 'the page build has no page' }, 500)),
            '/api/bots': loopback(() => json(bots())),
            '/api/sessions': loopback(req => {
                const url = new URL(req.url);
                const bot = url.searchParams.get('bot');
                if (bot !== null && !BOT_NAME.test(bot)) return bad('bad bot');
                return json(sessions(bot ?? undefined));
            }),
            '/api/run': loopback(req => {
                const url = new URL(req.url);
                const bot = botParam(url);
                const runId = url.searchParams.get('runId') ?? '';
                if (!bot || !RUN_ID.test(runId)) return bad('need bot and runId');
                const reply = runReply(bot, runId);
                return reply ? json(reply) : json({ error: 'no such run' }, 404);
            }),
            '/api/phase': loopback(req => {
                const url = new URL(req.url);
                const bot = botParam(url);
                const runId = url.searchParams.get('runId') ?? '';
                if (!bot || !RUN_ID.test(runId)) return bad('need bot and runId');
                const log = store.phase(bot, runId);
                return log ? json(log) : json({ error: 'no such phase run' }, 404);
            }),
            '/api/live': loopback(req => {
                const bot = botParam(new URL(req.url));
                return bot ? live(req, bot) : bad('need bot');
            }),
            '/api/world': loopback(req => {
                const bot = botParam(new URL(req.url));
                return bot ? world(bot) : bad('need bot');
            }),
            // It fetches and caches on request: a page rebinding its name to the viewer must not drive it.
            [`${RS_WORLD_PATH}*`]: loopback(req => rsWorld.serve(new URL(req.url).pathname)),
        },
        // The page's chunks, by the names the build gave them.
        fetch: loopback(async req => (await servePage(new URL(req.url).pathname)) ?? json({ error: 'not found' }, 404)),
    });

    return {
        server,
        url: `http://${server.hostname}:${server.port}/`,
        close: async () => {
            await observers?.close();
            await server.stop(true);
        },
    };
}
