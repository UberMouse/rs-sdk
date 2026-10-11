// The plan viewer's HTTP side: the page, JSON reads of the run logs, and one Server-Sent Events
// stream per viewer that follows a bot's newest plan as its logs grow. Read-only throughout.
import type { Server } from 'bun';
import { basename } from 'node:path';
import {
    applyPlanEvent,
    type BotSnapshot,
    foldPhase,
    foldPlan,
    followed,
    groupSessions,
    type LogEvent,
    openRun,
    type PhaseLog,
    type PlanRun,
    type PlanSummary,
} from './model';
import { errMessage } from '../../lib/util';
import { Observers } from './observer';
import page from './page.html';
import { BOT_NAME, RUN_ID, RunsStore, type SessionOwner, Tail } from './store';

/** How often a live stream reads its logs, and re-lists the bot's plans. */
const TAIL_MS = 500;
const LIST_MS = 2000;
const HEARTBEAT_MS = 15_000;

export interface BotInfo {
    bot: string;
    plans: number;
    latest: PlanSummary | null;
}

export interface SessionsReply {
    sessions: ReturnType<typeof groupSessions>;
    owners: SessionOwner[];
}

export interface PlanReply {
    run: PlanRun;
    source: string | null;
    /** The open phase run's runId, also for logs that only name it at its end. */
    openPhase: string | null;
}

/** The SSE events a live stream sends, by name. */
export interface LiveEvents {
    plans: SessionsReply;
    plan: PlanReply;
    'plan-events': { runId: string; events: LogEvent[] };
    /** A plan without a result whose process was found gone, or found again. */
    'plan-state': { runId: string; state: PlanRun['state'] };
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
}

const json = (x: unknown, status = 200) => Response.json(x, { status });
const bad = (msg: string) => json({ error: msg }, 400);
const noop = () => {};
const botParam = (url: URL) => {
    const bot = url.searchParams.get('bot');
    return bot && BOT_NAME.test(bot) ? bot : null;
};

/** The open phase run's log file and runId, also for plan logs that only name a run at its end. */
function openPhase(store: RunsStore, run: PlanRun, dir: string): { file: string; runId: string } | null {
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
    /** An API route that answers only requests naming a loopback host (see hostAllowed). */
    const api =
        (handler: (req: Request) => Response) =>
        (req: Request): Response =>
            hostAllowed(req, hostname) ? handler(req) : json({ error: 'forbidden host' }, 403);
    const observers = opts.observe === false ? null : new Observers(bot => store.botRoot(bot));

    const bots = (): BotInfo[] => {
        const plans = store.plans();
        return [...store.botDirs().keys()]
            .map(bot => {
                const mine = plans.filter(p => p.bot === bot);
                return { bot, plans: mine.length, latest: followed(mine, bot) };
            })
            .sort(
                (a, b) =>
                    Number(b.latest?.state === 'running') - Number(a.latest?.state === 'running') ||
                    (b.latest?.startedAt ?? 0) - (a.latest?.startedAt ?? 0),
            );
    };
    const sessions = (bot?: string): SessionsReply => ({
        sessions: groupSessions(store.plans(bot)),
        owners: store.owners(),
    });
    const planReply = (bot: string, runId: string): PlanReply | null => {
        const p = store.plan(bot, runId);
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
                let plan: { runId: string; dir: string; tail: Tail; run: PlanRun } | null = null;
                let phase: { file: string; runId: string; tail: Tail } | null = null;

                const follow = (summary: PlanSummary) => {
                    const p = store.plan(bot, summary.runId);
                    if (!p) return;
                    const tail = new Tail(p.file);
                    const run = foldPlan(summary.runId, bot, tail.read());
                    if (!run.result) run.state = p.run.state;
                    plan = { runId: run.runId, dir: p.dir, tail, run };
                    phase = null;
                    send('plan', {
                        run,
                        source: store.source(p),
                        openPhase: openPhase(store, run, p.dir)?.runId ?? null,
                    });
                    trackPhase();
                };

                /** Switches the phase tail to the open run's log once it exists; the last one stays until then. */
                const trackPhase = () => {
                    if (!plan) return;
                    const open = openPhase(store, plan.run, plan.dir);
                    if (!open || open.file === phase?.file) return;
                    const tail = new Tail(open.file);
                    phase = { ...open, tail };
                    send('phase', foldPhase(open.runId, tail.read()));
                };

                const list = () => {
                    const plans = store.plans(bot);
                    const sig = plans.map(p => `${p.runId}:${p.state}:${p.status}`).join(',');
                    if (sig !== listSig) {
                        listSig = sig;
                        send('plans', { sessions: groupSessions(plans), owners: store.owners() });
                    }
                    const newest = followed(plans, bot);
                    if (newest && newest.runId !== plan?.runId) follow(newest);
                    else if (plan && !plan.run.result && newest && newest.state !== plan.run.state) {
                        plan.run.state = newest.state;
                        send('plan-state', { runId: plan.runId, state: newest.state });
                    }
                };

                const tick = () => {
                    if (phase) {
                        const events = phase.tail.read();
                        if (events.length) send('phase-events', { runId: phase.runId, events });
                    }
                    if (plan) {
                        const events = plan.tail.read();
                        if (events.length) {
                            for (const e of events) applyPlanEvent(plan.run, e);
                            send('plan-events', { runId: plan.runId, events });
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

    const server = Bun.serve({
        hostname,
        port: opts.port ?? 7790,
        // SSE streams sit idle between events; the heartbeat keeps proxies honest.
        idleTimeout: 0,
        routes: {
            '/': page,
            '/api/bots': api(() => json(bots())),
            '/api/sessions': api(req => {
                const url = new URL(req.url);
                const bot = url.searchParams.get('bot');
                if (bot !== null && !BOT_NAME.test(bot)) return bad('bad bot');
                return json(sessions(bot ?? undefined));
            }),
            '/api/plan': api(req => {
                const url = new URL(req.url);
                const bot = botParam(url);
                const runId = url.searchParams.get('runId') ?? '';
                if (!bot || !RUN_ID.test(runId)) return bad('need bot and runId');
                const reply = planReply(bot, runId);
                return reply ? json(reply) : json({ error: 'no such plan' }, 404);
            }),
            '/api/phase': api(req => {
                const url = new URL(req.url);
                const bot = botParam(url);
                const runId = url.searchParams.get('runId') ?? '';
                if (!bot || !RUN_ID.test(runId)) return bad('need bot and runId');
                const log = store.phase(bot, runId);
                return log ? json(log) : json({ error: 'no such phase run' }, 404);
            }),
            '/api/live': api(req => {
                const bot = botParam(new URL(req.url));
                return bot ? live(req, bot) : bad('need bot');
            }),
        },
        fetch: () => json({ error: 'not found' }, 404),
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
