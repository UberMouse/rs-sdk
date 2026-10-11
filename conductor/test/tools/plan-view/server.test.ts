import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LogEvent, type PhaseLog, type RunSummary, stampTime } from '../../../tools/plan-view/model';
import {
    type BotInfo,
    hostAllowed,
    type RunReply,
    type SessionsReply,
    startServer,
} from '../../../tools/plan-view/server';
import { isTestBot, LOG_STALE_MS, processStartedAt, RunsStore, Tail } from '../../../tools/plan-view/store';
import { FeedProbe, RsWorldProxy, type WorldInfo } from '../../../tools/plan-view/world';

const FIXTURE = join(import.meta.dir, '../../fixtures/plan-view/conductor2');
const PLAN = '2026-10-11T00-21-22-727Z-plan-pottery-craft';
/** A pid no process has: the kernel's pid_max is at most 2^22. */
const DEAD_PID = 2 ** 22 + 1;

const root = mkdtempSync(join(tmpdir(), 'plan-view-'));
const dir = join(root, 'conductor/runs/conductor2');
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(dir, { recursive: true });
cpSync(FIXTURE, dir, { recursive: true });

const line = (e: Record<string, unknown>, t = Date.now()) => `${JSON.stringify({ t, ...e })}\n`;
/**
 * Events are stamped with the real clock (the store judges a pid-less log's freshness by its file's
 * mtime, which is real too), unless `t` pins them: a log whose stamp the store compares with its
 * events' times (a phase log is the first stamped at or after its selection) must carry that time.
 */
const writeLog = (file: string, events: Record<string, unknown>[], t?: number) =>
    writeFileSync(join(dir, file), events.map(e => line(e, t)).join(''));
/** The time of a fixture log's stamp. */
const stamped = (file: string): number => stampTime(file)!;

const START = {
    type: 'start',
    plan: 'p',
    bot: 'conductor2',
    phases: [{ phase: 'chop', task: 'woodcutting', params: {} }],
    requires: [],
    stops: [],
};
const SELECT = {
    type: 'select',
    phase: 'chop',
    checks: { chop: 'chosen' },
    last: null,
    inventory: {},
    free: 28,
    bank: null,
};

describe('RunsStore', () => {
    const store = new RunsStore([root]);

    test('lists plans with their state: ended, running by a live pid, killed by a dead one', () => {
        writeLog('2026-10-11T02-00-00-000Z-plan-alive.ndjson', [
            { type: 'source', file: 'x', copy: 'y', pid: process.pid, session: 's1' },
            START,
        ]);
        writeLog('2026-10-11T01-00-00-000Z-plan-dead.ndjson', [
            { type: 'source', file: 'x', copy: 'y', pid: DEAD_PID, session: 's1' },
            START,
        ]);
        const plans = store.runs('conductor2');
        const byId = Object.fromEntries(plans.map(p => [p.runId, p] as [string, RunSummary]));
        expect(byId['2026-10-11T02-00-00-000Z-plan-alive']).toMatchObject({
            state: 'running',
            session: 's1',
            name: 'p',
        });
        expect(byId['2026-10-11T01-00-00-000Z-plan-dead']).toMatchObject({ state: 'killed' });
        expect(byId[PLAN]).toMatchObject({ state: 'ended', status: 'failed' });
        expect(plans[0]!.runId).toBe('2026-10-11T02-00-00-000Z-plan-alive');
    });

    test("a log without a pid counts as running while it, or its open phase's log, is fresh", () => {
        const OLD = '2026-10-11T03-00-00-000Z-plan-old.ndjson';
        const PHASE = '2026-10-11T03-00-00-010Z-woodcutting.ndjson';
        writeLog(OLD, [START, SELECT], stamped(OLD));
        writeLog(PHASE, [{ type: 'start', task: 'woodcutting', params: {} }], stamped(PHASE));
        const p = store.run('conductor2', '2026-10-11T03-00-00-000Z-plan-old')!;
        expect(p.run.state).toBe('running');
        // Before phase-start, the open run's log is the first of its task stamped from its selection on.
        expect(store.phaseFile(p.run, p.run.runs[0]!, dir)).toEndWith('2026-10-11T03-00-00-010Z-woodcutting.ndjson');
    });

    test('reads the source copy and phase logs; refuses runIds that leave the runs directory', () => {
        const p = store.run('conductor2', PLAN)!;
        expect(store.source(p)).toContain('definePlan');
        expect(store.phase('conductor2', '2026-10-11T00-23-55-152Z-crafting')?.step).toBe('fire');
        expect(store.run('conductor2', '../../etc/passwd')).toBeNull();
        expect(store.phase('conductor2', '../x')).toBeNull();
        expect(store.run('nobody', PLAN)).toBeNull();
    });
});

describe('RunsStore, task runs', () => {
    const store = new RunsStore([root]);
    const OWN = '2026-10-11T02-30-00-000Z-woodcutting';
    const STALE = '2026-10-11T02-40-00-000Z-mining';

    test('lists a task run of its own beside the plans; never a phase of a plan', () => {
        writeLog(`${OWN}.ndjson`, [
            { type: 'source', pid: process.pid, session: 's3' },
            { type: 'start', task: 'woodcutting', bot: 'conductor2', params: { tree: 'oak' }, stops: [] },
        ]);
        const runs = store.runs('conductor2');
        expect(runs.find(r => r.runId === OWN)).toMatchObject({
            kind: 'task',
            name: 'woodcutting',
            state: 'running',
            session: 's3',
        });
        // The fixture plan's phases name it in their results; plan-old's open phase is named by its stamp.
        expect(runs.filter(r => r.kind === 'task').map(r => r.runId)).toEqual([OWN]);
        const own = store.run('conductor2', OWN)!;
        expect(own.run.kind).toBe('task');
        expect(store.source(own)).toBeNull();
        expect(store.phaseFile(own.run, own.run.runs[0]!, dir)).toBe(join(dir, `${OWN}.ndjson`));
    });

    test('a task log without a pid runs while it or its recording is fresh, then counts as killed', () => {
        writeLog(`${STALE}.ndjson`, [{ type: 'start', task: 'mining', params: {} }]);
        expect(store.run('conductor2', STALE)?.run.state).toBe('running');
        const old = (Date.now() - LOG_STALE_MS - 60_000) / 1000;
        utimesSync(join(dir, `${STALE}.ndjson`), old, old);
        expect(store.run('conductor2', STALE)?.run.state).toBe('killed');
        writeFileSync(join(dir, `${STALE}.ticks.ndjson.gz`), '');
        expect(store.run('conductor2', STALE)?.run.state).toBe('running');
        rmSync(join(dir, `${STALE}.ticks.ndjson.gz`));
        rmSync(join(dir, `${STALE}.ndjson`));
    });

    test('a phase log that names its plan is no run of its own, even before the plan log does', () => {
        const phase = '2026-10-11T02-50-00-000Z-fishing';
        writeLog(`${phase}.ndjson`, [
            { type: 'start', task: 'fishing', params: {} },
            { type: 'result', status: 'done', reason: 'r', partOf: '2026-10-11T02-49-00-000Z-plan-gone' },
        ]);
        expect(store.runs('conductor2').some(r => r.runId === phase)).toBe(false);
        rmSync(join(dir, `${phase}.ndjson`));
    });

    test('integration test bots are told apart by name', () => {
        expect(isTestBot('it0cisrg5cxd')).toBe(true);
        expect(isTestBot('conductor2')).toBe(false);
        expect(isTestBot('itsy')).toBe(false);
    });
});

describe('RunsStore, what changes under it', () => {
    test('a live pid under a process younger than the plan is a recycled one: killed', () => {
        // This process started after 2026-01-01, so it cannot be the one that ran this plan.
        const old = '2026-01-01T00-00-00-000Z-plan-recycled';
        writeLog(`${old}.ndjson`, [
            { type: 'source', file: 'x', copy: 'y', pid: process.pid },
            { ...START, t: Date.parse('2026-01-01T00:00:00Z') },
        ]);
        expect(new RunsStore([root]).run('conductor2', old)?.run.state).toBe('killed');
        const started = processStartedAt(process.pid);
        if (started !== null) expect(Math.abs(started - (Date.now() - performance.now()))).toBeLessThan(10_000);
    });

    test('forgets the folds of logs that are gone, and skips a bot directory that vanished', () => {
        const store = new RunsStore([root]);
        const id = '2026-10-11T05-00-00-000Z-plan-gone';
        writeLog(`${id}.ndjson`, [START]);
        store.runs('conductor2');
        const cache = (store as unknown as { cache: Map<string, unknown> }).cache;
        expect(cache.has(join(dir, `${id}.ndjson`))).toBe(true);
        rmSync(join(dir, `${id}.ndjson`));
        store.runs('conductor2');
        expect(cache.has(join(dir, `${id}.ndjson`))).toBe(false);

        const other = join(root, 'conductor/runs/brief');
        mkdirSync(other, { recursive: true });
        writeFileSync(join(other, '2026-10-11T06-00-00-000Z-plan-x.ndjson'), line(START));
        expect(store.botDirs().has('brief')).toBe(true);
        rmSync(other, { recursive: true });
        expect(store.runs('brief')).toEqual([]);
    });

    test("owners names the conductor sessions in the roots' durable state", () => {
        const store = new RunsStore([root]);
        expect(store.owners()).toEqual([]);
        mkdirSync(join(root, '.durable-state'), { recursive: true });
        writeFileSync(
            join(root, '.durable-state/state.json'),
            JSON.stringify({ sessionId: 's1', bot: 'conductor2', goal: 'g' }),
        );
        expect(store.owners()).toEqual([{ session: 's1', root, bot: 'conductor2', goal: 'g' }]);
        rmSync(join(root, '.durable-state'), { recursive: true });
    });
});

describe('Tail', () => {
    test('holds a line back until its newline, and re-reads a file that shrank', () => {
        const f = join(root, 'tail.ndjson');
        writeFileSync(f, '{"t":1,"type":"a"}\n{"t":2,"ty');
        const tail = new Tail(f);
        expect(tail.read().map(e => e.type)).toEqual(['a']);
        expect(tail.read()).toEqual([]);
        appendFileSync(f, 'pe":"b"}\nnot json\n');
        expect(tail.read().map(e => e.type)).toEqual(['b']);
        writeFileSync(f, '{"t":3,"type":"c"}\n');
        expect(tail.read().map(e => e.type)).toEqual(['c']);
        expect(new Tail(join(root, 'missing.ndjson')).read()).toEqual([]);
    });
});

describe('server', () => {
    let srv: ReturnType<typeof startServer>;
    beforeAll(() => {
        srv = startServer({
            roots: [root],
            port: 0,
            observe: false,
            // No network: rs-world's build from a stub, and an engine whose feed is off.
            rsWorld: new RsWorldProxy(join(root, 'rs-world-cache'), 'https://pages.example/rs-world/', async url =>
                url.endsWith('/index.html')
                    ? new Response('<html>rs-world</html>', { headers: { 'content-type': 'text/html' } })
                    : new Response('', { status: 404 }),
            ),
            feeds: new FeedProbe(
                async () => false,
                async () => new Response(null, { status: 404 }),
            ),
        });
    });
    afterAll(() => srv.close());
    const get = async <T>(path: string, status = 200): Promise<T> => {
        const res = await fetch(new URL(path, srv.url));
        expect(res.status).toBe(status);
        return (await res.json()) as T;
    };

    test('serves the page and the JSON reads', async () => {
        const page = await fetch(srv.url);
        expect(await page.text()).toContain('Plan viewer');
        const bots = await get<BotInfo[]>('/api/bots');
        expect(bots.map(b => b.bot)).toEqual(['conductor2']);
        const s = await get<SessionsReply>('/api/sessions?bot=conductor2');
        expect(s.sessions.find(g => g.session === 's1')?.runs.length).toBe(2);
        const plan = await get<RunReply>(`/api/run?bot=conductor2&runId=${PLAN}`);
        expect(plan.run.runs).toHaveLength(6);
        expect(plan.source).toContain('pottery-craft');
        expect((await get<PhaseLog>('/api/phase?bot=conductor2&runId=2026-10-11T00-22-38-352Z-mining')).task).toBe(
            'mining',
        );
        await get('/api/run?bot=conductor2&runId=..%2Fx', 400);
        await get('/api/run?bot=conductor2&runId=nope', 404);
        await get('/api/live', 400);
        // A page that rebinds its own name to the viewer's address is refused.
        for (const path of ['/api/bots', '/', '/rs-world/', '/chunk.js']) {
            const rebound = await fetch(new URL(path, srv.url), { headers: { host: 'evil.example:7790' } });
            expect(rebound.status).toBe(403);
        }
    });

    test('serves the page and its chunks cross-origin isolated, for the world panel', async () => {
        const page = await fetch(srv.url);
        expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin');
        expect(page.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        const html = await page.text();
        expect(html).toContain('id="world-frame"');
        const chunks = [...html.matchAll(/(?:src|href)="(\.?\/[^"]+\.(?:js|css))"/g)].map(m => m[1]!);
        expect(chunks.length).toBeGreaterThan(0);
        for (const c of chunks) {
            const res = await fetch(new URL(c, srv.url));
            expect(res.status).toBe(200);
            expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        }
    });

    test("world names the bot's feed and whether it is on; rs-world is served beside the page", async () => {
        mkdirSync(join(root, 'bots/conductor2'), { recursive: true });
        writeFileSync(join(root, 'bots/conductor2/bot.env'), 'BOT_USERNAME=conductor2\nPASSWORD=pw\n');
        const w = await get<WorldInfo>('/api/world?bot=conductor2');
        expect(w).toMatchObject({ follow: 'conductor2', feed: 'ws://localhost:8888/worldfeed', status: 'off' });
        expect(w.message).toContain('WORLD_FEED=true');
        await get('/api/world?bot=nobody', 404);
        await get('/api/world', 400);
        const rw = await fetch(new URL('/rs-world/', srv.url));
        expect(await rw.text()).toBe('<html>rs-world</html>');
        expect(rw.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        expect((await fetch(new URL('/rs-world/nope.js', srv.url))).status).toBe(404);
    });

    test('the live stream follows the newest plan, then its events and its open phase', async () => {
        const ctl = new AbortController();
        const res = await fetch(new URL('/api/live?bot=conductor2', srv.url), { signal: ctl.signal });
        const events = sse(res);
        try {
            const first = await events.until('run');
            expect((first as RunReply).run.runId).toBe('2026-10-11T03-00-00-000Z-plan-old');

            // A new plan starts: the stream switches to it.
            const id = '2026-10-11T04-00-00-000Z-plan-live';
            writeLog(`${id}.ndjson`, [
                { type: 'source', file: 'x', copy: 'y', pid: process.pid, session: 's2' },
                START,
            ]);
            const switched = (await events.until('run')) as RunReply;
            expect(switched.run).toMatchObject({ runId: id, state: 'running' });

            // Its selection and phase-start arrive as events, then its phase log as a snapshot. As
            // runPlan does, phase-start is logged before the phase's own log exists.
            const phaseId = '2026-10-11T04-00-00-010Z-woodcutting';
            appendFileSync(
                join(dir, `${id}.ndjson`),
                line(SELECT) + line({ type: 'phase-start', phase: 'chop', index: 0, runId: phaseId, logFile: 'l' }),
            );
            const pe = (await events.until('run-events')) as { events: LogEvent[] };
            expect(pe.events.map(e => e.type)).toEqual(['select', 'phase-start']);
            writeLog(`${phaseId}.ndjson`, [
                { type: 'start', task: 'woodcutting', params: { tree: 'tree' } },
                { type: 'step', step: 'chop' },
            ]);
            const phase = (await events.until('phase')) as PhaseLog;
            expect(phase).toMatchObject({ runId: phaseId, step: 'chop' });

            appendFileSync(join(dir, `${phaseId}.ndjson`), line({ type: 'step', step: 'walk' }));
            const more = (await events.until('phase-events')) as { events: LogEvent[] };
            expect(more.events.map(e => e.type)).toEqual(['step']);
        } finally {
            ctl.abort();
        }
    });

    test('the live stream follows a task run of its own: the run, and its own log as the phase', async () => {
        const ctl = new AbortController();
        const res = await fetch(new URL('/api/live?bot=conductor2', srv.url), { signal: ctl.signal });
        const events = sse(res);
        try {
            await events.until('run');
            const id = '2026-10-11T07-00-00-000Z-fishing';
            writeLog(`${id}.ndjson`, [
                { type: 'source', pid: process.pid, session: 's4' },
                { type: 'start', task: 'fishing', bot: 'conductor2', params: { spot: 'net' }, stops: [] },
                { type: 'step', step: 'fish' },
            ]);
            const switched = (await events.until('run')) as RunReply;
            expect(switched.run).toMatchObject({ runId: id, kind: 'task', name: 'fishing', state: 'running' });
            expect(switched).toMatchObject({ source: null, openPhase: id });
            expect((await events.until('phase')) as PhaseLog).toMatchObject({ runId: id, step: 'fish' });

            appendFileSync(join(dir, `${id}.ndjson`), line({ type: 'result', status: 'done', reason: 'full' }));
            const ended = (await events.until('run-events')) as { runId: string; events: LogEvent[] };
            expect(ended).toMatchObject({ runId: id });
            expect(ended.events.map(e => e.type)).toEqual(['result']);
        } finally {
            ctl.abort();
        }
    });
});

const hostReq = (host: string) => new Request('http://x/', { headers: { host } });

describe('hostAllowed', () => {
    test('bound to loopback, only loopback names are answered; bound elsewhere, any', () => {
        expect(hostAllowed(hostReq('127.0.0.1:7790'), '127.0.0.1')).toBe(true);
        expect(hostAllowed(hostReq('localhost:7790'), '127.0.0.1')).toBe(true);
        expect(hostAllowed(hostReq('[::1]:7790'), '127.0.0.1')).toBe(true);
        expect(hostAllowed(hostReq('attacker.example'), '127.0.0.1')).toBe(false);
        expect(hostAllowed(hostReq('box.lan:7790'), '0.0.0.0')).toBe(true);
    });
});

/** Reads a Server-Sent Events response: `until(name)` resolves with the next such event's data. */
function sse(res: Response) {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const queue: { event: string; data: unknown }[] = [];
    const pull = async () => {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event && data) queue.push({ event, data: JSON.parse(data) });
        }
    };
    return {
        async until(name: string, ms = 5000): Promise<unknown> {
            const deadline = Date.now() + ms;
            for (;;) {
                const at = queue.findIndex(e => e.event === name);
                if (at >= 0) return queue.splice(0, at + 1).at(-1)!.data;
                if (Date.now() > deadline) throw new Error(`no ${name} event in ${ms}ms`);
                await pull();
            }
        },
    };
}
