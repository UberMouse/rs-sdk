// The plan viewer page: follows a bot's newest run (a plan, or a task run of its own) over /api/live,
// or shows a past one picked from the session list, and the bot in a live 3D world (rs-world). Folds
// the streamed log events with the server's own model functions.
import {
    applyPhaseEvent,
    applyRunEvent,
    type BotSnapshot,
    type PhaseLog,
    type PhaseRunEntry,
    type Run,
    type RunSummary,
    type Selection,
    type SessionGroup,
} from './model';
import type { TaskStatus } from '../../lib/task';
import type { BotInfo, LiveEvents, RunReply, SessionsReply } from './server';
import type { WorldInfo } from './world';

// ---- state ----

let bot: string | null = null;
let follow = true;
let es: EventSource | null = null;
let connected = false;
let sessions: SessionsReply | null = null;
/** The bot's newest run, kept current by the stream. */
let live: RunReply | null = null;
/** The newest run's open (or last) phase log, kept current by the stream; a task run's own log. */
let livePhase: PhaseLog | null = null;
/** What the main panel shows: `live` when following. */
let viewing: RunReply | null = null;
/** A phase run picked on the timeline or table; null shows the open (or last) one. */
let picked: number | null = null;
/** Phase logs fetched for runs not followed live, by runId. */
const phaseLogs = new Map<string, { log: PhaseLog | null; at: number; loading: boolean }>();
let botSnap: BotSnapshot | null = null;
/** Which phase's source line is highlighted. */
let sourcePhase: string | null = null;
let sourceKey = '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- DOM helpers ----

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

function add(el: Element, children: Child[]) {
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) add(el, c);
        else el.append(c instanceof Node ? c : String(c));
    }
}
function attrs(el: Element, a: Attrs) {
    for (const [k, v] of Object.entries(a)) {
        if (v === null || v === undefined || v === false) continue;
        if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
}
function h(tag: string, a: Attrs = {}, ...children: Child[]): HTMLElement {
    const el = document.createElement(tag);
    attrs(el, a);
    add(el, children);
    return el;
}
const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, a: Attrs = {}, ...children: Child[]): SVGElement {
    const el = document.createElementNS(SVG, tag);
    attrs(el, a);
    add(el, children);
    return el;
}

// ---- formatting ----

const pad = (n: number) => String(n).padStart(2, '0');
function clock(t: number): string {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dayClock(t: number): string {
    const d = new Date(t);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dur(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ${pad(sec % 60)}s`;
    return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}
const num = (n: number) => n.toLocaleString();
const xpText = (xp: Record<string, number> | undefined) =>
    Object.entries(xp ?? {})
        .map(([k, v]) => `${k} +${num(v)}`)
        .join(', ') || 'none';

type Status = 'done' | 'failed' | 'stuck' | 'error' | 'running' | 'killed';
const STATUS: Record<Status, { icon: string; label: string; cls: string }> = {
    done: { icon: '✓', label: 'done', cls: 'good' },
    stuck: { icon: '⏸', label: 'stuck', cls: 'warning' },
    failed: { icon: '✕', label: 'failed', cls: 'serious' },
    error: { icon: '⚠', label: 'error', cls: 'critical' },
    running: { icon: '▶', label: 'running', cls: 'run' },
    killed: { icon: '◼', label: 'no result', cls: 'killed' },
};
function badge(st: Status, label?: string): HTMLElement {
    const m = STATUS[st];
    return h(
        'span',
        { class: `st ${m.cls}` },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, m.icon),
        label ?? m.label,
    );
}
const runStatus = (p: { state: Run['state']; status: TaskStatus | null }): Status =>
    p.state === 'running' ? 'running' : p.state === 'killed' ? 'killed' : (p.status ?? 'killed');
const phaseRunStatus = (r: PhaseRunEntry, run: Run): Status =>
    r.status ?? (run.state === 'running' ? 'running' : 'killed');

// ---- data ----

async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

function readHash(): { bot?: string; run?: string } {
    const p = new URLSearchParams(location.hash.slice(1));
    return { bot: p.get('bot') ?? undefined, run: p.get('run') ?? undefined };
}
function writeHash() {
    const p: Record<string, string> = {};
    if (bot) p.bot = bot;
    if (!follow && viewing) p.run = viewing.run.runId;
    history.replaceState(null, '', `#${q(p)}`);
}

function connect(name: string) {
    es?.close();
    connected = false;
    live = null;
    livePhase = null;
    sessions = null;
    botSnap = null;
    phaseLogs.clear();
    const src = new EventSource(`/api/live?${q({ bot: name })}`);
    es = src;
    const on = <K extends keyof LiveEvents>(event: K, fn: (d: LiveEvents[K]) => void) =>
        src.addEventListener(event, ev => {
            if (es !== src) return;
            fn(JSON.parse((ev as MessageEvent<string>).data) as LiveEvents[K]);
            schedule();
        });
    src.addEventListener('open', () => {
        connected = true;
        schedule();
    });
    src.addEventListener('error', () => {
        connected = false;
        schedule();
    });
    on('runs', d => {
        sessions = d;
    });
    on('run', d => {
        live = d;
        livePhase = null;
        // A page reloaded on the live run's link holds a fetched copy: take the live one instead.
        if (follow || viewing?.run.runId === d.run.runId) show(d);
    });
    on('run-events', d => {
        if (live?.run.runId !== d.runId) return;
        for (const e of d.events) applyRunEvent(live.run, e);
    });
    on('run-state', d => {
        if (live?.run.runId === d.runId) live.run.state = d.state;
    });
    on('phase', d => {
        livePhase = d;
        // Logs without phase-start name the open run only through this.
        if (live) live.openPhase = d.runId;
    });
    on('phase-events', d => {
        if (livePhase?.runId !== d.runId) return;
        for (const e of d.events) applyPhaseEvent(livePhase, e);
    });
    on('bot', d => {
        botSnap = d;
    });
}

function show(reply: RunReply) {
    if (viewing?.run.runId !== reply.run.runId) {
        picked = null;
        sourcePhase = null;
    }
    viewing = reply;
    writeHash();
}

async function pickListed(runId: string) {
    if (!bot) return;
    follow = runId === live?.run.runId && follow;
    if (live?.run.runId === runId) show(live);
    else {
        try {
            show(await getJson<RunReply>(`/api/run?${q({ bot, runId })}`));
        } catch (e) {
            console.error(e);
        }
    }
    schedule();
}

function setFollow(on: boolean) {
    follow = on;
    if (on && live) show(live);
    writeHash();
    schedule();
}

function pickRun(index: number | null) {
    picked = index;
    const r = index === null ? null : viewing?.run.runs[index];
    if (r) sourcePhase = r.phase;
    schedule();
}

/** How often a run that has not ended, and is not followed live, is read again. */
const REREAD_MS = 2000;

/** The phase run the panel shows: the one picked, else the latest. */
const shownEntry = (run: Run): PhaseRunEntry | undefined => (picked !== null ? run.runs[picked] : run.runs.at(-1));

/** Where a phase run's log comes from: the live stream when it is that run's, else its runId to fetch. */
function logSource(entry: PhaseRunEntry, run: Run): { live: PhaseLog } | { runId: string } | null {
    const runId = entry.runId ?? (entry.endedAt === null && viewing?.run === run ? viewing.openPhase : null);
    const isLive = viewing === live && entry.index === run.runs.length - 1;
    if (isLive && livePhase && (!runId || runId === livePhase.runId)) return { live: livePhase };
    return runId ? { runId } : null;
}

/** The shown run's log, as far as it is known; reads only. */
function phaseLogFor(entry: PhaseRunEntry, run: Run): PhaseLog | null {
    const src = logSource(entry, run);
    if (!src) return null;
    return 'live' in src ? src.live : (phaseLogs.get(src.runId)?.log ?? null);
}

/** Fetches the shown run's log when it isn't live and isn't cached (an ended run's log never changes). */
function ensurePhaseLog() {
    const run = viewing?.run;
    const entry = run && shownEntry(run);
    const src = entry && logSource(entry, run);
    if (!src || 'live' in src || !bot) return;
    const { runId } = src;
    const hit = phaseLogs.get(runId);
    if (hit && (hit.loading || hit.log?.result || Date.now() - hit.at < REREAD_MS)) return;
    const slot = { log: hit?.log ?? null, at: Date.now(), loading: true };
    phaseLogs.set(runId, slot);
    void getJson<PhaseLog>(`/api/phase?${q({ bot, runId })}`)
        .then(log => {
            slot.log = log;
        })
        .catch((e: unknown) => {
            console.error(e);
        })
        .finally(() => {
            slot.loading = false;
            slot.at = Date.now();
            schedule();
        });
}

// ---- rendering ----

let pending = false;
function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
        pending = false;
        render();
    });
}

function render() {
    ensurePhaseLog();
    const follower = $<HTMLButtonElement>('follow');
    follower.setAttribute('aria-pressed', String(follow));
    $('conn').textContent = connected ? '' : 'reconnecting…';
    renderSessions();
    renderMain();
    // Its status reads the bot snapshot; the iframe stays put unless its source changes.
    renderWorld();
}

function renderSessions() {
    const nav = $('sessions');
    const groups = sessions?.sessions ?? [];
    const open = new Set(Array.from(nav.querySelectorAll('details[open]'), d => (d as HTMLElement).dataset.key));
    // Until the first groups render, open the newest; after that, whatever the viewer left open.
    const first = !nav.querySelector('details');
    if (!groups.length) {
        nav.replaceChildren(h('p', { class: 'muted' }, sessions ? 'No runs for this bot.' : 'Loading…'));
        return;
    }
    nav.replaceChildren(
        ...groups.map((g, i) => sessionGroup(g, first ? i === 0 || hasViewing(g) : open.has(g.key) || hasViewing(g))),
    );
}
const hasViewing = (g: SessionGroup) => {
    const runId = viewing?.run.runId;
    return !!runId && g.runs.some(p => p.runId === runId);
};

function sessionGroup(g: SessionGroup, isOpen: boolean): HTMLElement {
    const owner = g.session ? sessions?.owners.find(o => o.session === g.session) : undefined;
    const title = g.session
        ? `Session ${g.session.slice(0, 8)}${owner ? ` · conductor${owner.bot ? ` (${owner.bot})` : ''}` : ''}`
        : `Untagged · ${g.key.slice('untagged:'.length)}`;
    const sub = `${dayClock(g.firstAt)} – ${clock(g.lastAt)} · ${g.runs.length} run${g.runs.length === 1 ? '' : 's'}`;
    return h(
        'details',
        { class: 'session', 'data-key': g.key, open: isOpen },
        h(
            'summary',
            { title: owner?.goal ?? g.session ?? 'Plan logs from before runs were stamped with their session' },
            h('span', { class: 'title' }, title),
            h('span', { class: 'sub' }, sub),
            owner?.goal ? h('span', { class: 'sub' }, owner.goal) : null,
        ),
        g.runs.map(runItem),
    );
}

function runItem(p: RunSummary): HTMLElement {
    const st = runStatus(p);
    const m = STATUS[st];
    const current = viewing?.run.runId === p.runId;
    return h(
        'button',
        {
            class: 'plan-item',
            type: 'button',
            'aria-current': current ? 'true' : null,
            title: p.reason ?? m.label,
            onclick: () => void pickListed(p.runId),
        },
        h('span', { class: `st ${m.cls}`, 'aria-label': m.label }, h('span', { class: 'ic' }, m.icon)),
        h(
            'span',
            { class: 'name' },
            p.kind === 'task' ? h('span', { class: 'kind' }, 'task') : null,
            p.name,
            p.runId === live?.run.runId && follow ? h('span', { class: 'muted' }, ' · live') : null,
        ),
        h('span', { class: 'when' }, clock(p.startedAt), ' · ', dur((p.endedAt ?? Date.now()) - p.startedAt)),
    );
}

function renderMain() {
    const main = $('main');
    const scroll = main.querySelector('.source')?.scrollTop ?? null;
    const linesScroll = main.querySelector('.lines');
    const stick = linesScroll ? linesScroll.scrollTop + linesScroll.clientHeight >= linesScroll.scrollHeight - 4 : true;
    if (!viewing) {
        main.replaceChildren(h('p', { class: 'empty' }, bot ? 'No runs for this bot yet.' : 'No bots with run logs.'));
        return;
    }
    const run = viewing.run;
    // A task run of its own is one phase run: no timeline, phases or source to show.
    main.replaceChildren(
        ...(run.kind === 'plan'
            ? [
                  runHeader(run),
                  timeline(run),
                  h(
                      'div',
                      { class: 'cols' },
                      h('div', { class: 'stack' }, phaseTable(run), phasePanel(run)),
                      botPanel(),
                  ),
                  sourcePanel(viewing),
              ]
            : [runHeader(run), h('div', { class: 'cols' }, phasePanel(run), botPanel())]),
    );
    const src = main.querySelector('.source');
    const key = `${run.runId}:${sourcePhase}`;
    if (src && scroll !== null && sourceKey === key) src.scrollTop = scroll;
    else if (src) {
        main.querySelector('.source .hl')?.scrollIntoView({ block: 'center' });
        sourceKey = key;
    }
    const lines = main.querySelector('.lines');
    if (lines && stick) lines.scrollTop = lines.scrollHeight;
}

function runHeader(run: Run): HTMLElement {
    const st = runStatus({ state: run.state, status: run.result?.status ?? null });
    const end = run.endedAt ?? Date.now();
    const r = run.result;
    const stops = run.stops
        .map(x => {
            const minutes =
                typeof x === 'object' && x !== null && 'kind' in x && x.kind === 'minutes' && 'minutes' in x;
            return minutes ? `${x.minutes} min` : JSON.stringify(x);
        })
        .join(', ');
    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'plan-head' },
            run.kind === 'task' ? h('span', { class: 'kind' }, 'task') : null,
            h('span', { class: 'pname' }, run.name),
            badge(st),
            !follow && live && live.run.runId !== run.runId
                ? h('button', { type: 'button', onclick: () => setFollow(true) }, `Back to live: ${live.run.name}`)
                : null,
        ),
        h(
            'div',
            { class: 'kv' },
            h('span', {}, 'bot ', h('b', {}, run.bot)),
            h('span', {}, 'started ', h('b', {}, dayClock(run.startedAt))),
            h('span', {}, run.state === 'running' ? 'running for ' : 'took ', h('b', {}, dur(end - run.startedAt))),
            run.kind === 'plan' ? h('span', {}, 'phase runs ', h('b', {}, run.runs.length)) : null,
            stops ? h('span', {}, 'until ', h('b', {}, stops)) : null,
            run.requires.length ? h('span', {}, 'requires ', h('b', {}, run.requires.join(', '))) : null,
            run.session ? h('span', {}, 'session ', h('b', { class: 'mono' }, run.session.slice(0, 8))) : null,
            h('span', { class: 'mono muted', title: run.sourceFile ?? '' }, run.runId),
        ),
        r
            ? h(
                  'div',
                  { class: `result ${STATUS[st].cls}` },
                  badge(st),
                  ' ',
                  r.reason,
                  h(
                      'div',
                      { class: 'kv' },
                      h('span', {}, 'XP ', h('b', {}, xpText(r.xpGained))),
                      Object.keys(r.levelsGained).length
                          ? h(
                                'span',
                                {},
                                'levels ',
                                h(
                                    'b',
                                    {},
                                    Object.entries(r.levelsGained)
                                        .map(([k, v]) => `${k} ${v.from}→${v.to}`)
                                        .join(', '),
                                ),
                            )
                          : null,
                      h(
                          'span',
                          {},
                          'inventory ',
                          h(
                              'b',
                              {},
                              Object.entries(r.inventoryDelta)
                                  .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
                                  .join(', ') || 'unchanged',
                          ),
                      ),
                  ),
              )
            : run.state === 'killed'
              ? h(
                    'div',
                    { class: 'result' },
                    badge('killed'),
                    ` The ${run.kind} log has no result and its process is gone: hard-killed or crashed.`,
                )
              : null,
        run.errors.length
            ? h(
                  'ul',
                  { class: 'errors' },
                  run.errors.map(e => h('li', {}, `${clock(e.t)} ${e.message}`)),
              )
            : null,
    );
}

// ---- timeline ----

/** The timeline's viewBox width; it scales to the card. */
const TIMELINE_W = 1000;
const LANE = 26;
const LABEL_W = 140;
const AXIS_H = 22;

/** Axis tick spacings, smallest first: the first that gives at most 8 ticks is used. */
const TICK_STEPS_MS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400].map(x => x * 1000);
function niceStep(spanMs: number): number {
    return TICK_STEPS_MS.find(st => spanMs / st <= 8) ?? TICK_STEPS_MS.at(-1)!;
}

function timeline(run: Run): HTMLElement {
    const lanes = run.phases.length ? run.phases.map(p => p.phase) : [...new Set(run.runs.map(r => r.phase))];
    const t0 = run.startedAt;
    const t1 = Math.max(run.endedAt ?? Date.now(), t0 + 1000);
    const width = TIMELINE_W;
    const plotW = width - LABEL_W - 8;
    const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * plotW;
    const height = lanes.length * LANE + AXIS_H;
    const step = niceStep(t1 - t0);
    const ticks: number[] = [];
    for (let t = 0; t <= t1 - t0; t += step) ticks.push(t);

    const svg = s(
        'svg',
        { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Phase runs of ${run.name} over time` },
        ticks.map(t =>
            s(
                'g',
                {},
                s('line', { class: 'gridline', x1: x(t0 + t), x2: x(t0 + t), y1: 0, y2: lanes.length * LANE }),
                s(
                    'text',
                    { class: 'tick', x: x(t0 + t), y: lanes.length * LANE + 15, 'text-anchor': 'middle' },
                    dur(t),
                ),
            ),
        ),
        s('line', { class: 'baseline', x1: LABEL_W, x2: width - 8, y1: lanes.length * LANE, y2: lanes.length * LANE }),
        lanes.map((name, i) =>
            s(
                'text',
                { class: 'lane-label', x: LABEL_W - 8, y: i * LANE + LANE / 2 + 4, 'text-anchor': 'end' },
                name.length > 20 ? `${name.slice(0, 19)}…` : name,
            ),
        ),
        run.runs.map(r => {
            const lane = lanes.indexOf(r.phase);
            if (lane < 0) return null;
            const st = phaseRunStatus(r, run);
            const x0 = x(r.startedAt);
            const w = Math.max(4, x(r.endedAt ?? t1) - x0);
            const y = lane * LANE + 5;
            const tip = `${r.phase} · ${STATUS[st].label}\n${clock(r.startedAt)} for ${dur((r.endedAt ?? Date.now()) - r.startedAt)}${r.reason ? `\n${r.reason}` : ''}`;
            const choose = () => pickRun(r.index);
            return s(
                'g',
                { 'data-tip': tip, onclick: choose },
                s('rect', {
                    class: `bar ${STATUS[st].cls}${picked === r.index ? ' selected' : ''}`,
                    x: x0,
                    y,
                    width: w,
                    height: LANE - 10,
                    rx: 4,
                }),
                // A hit target taller and wider than the mark.
                s('rect', { class: 'hit', x: x0 - 3, y: lane * LANE, width: w + 6, height: LANE }),
            );
        }),
        run.state === 'running'
            ? s('line', { class: 'now', x1: x(t1), x2: x(t1), y1: 0, y2: lanes.length * LANE })
            : null,
    );
    const used = new Set(run.runs.map(r => phaseRunStatus(r, run)));
    return h(
        'section',
        { class: 'card timeline' },
        h('h2', {}, 'Timeline'),
        run.runs.length ? h('div', { class: 'scroll' }, svg) : h('p', { class: 'muted' }, 'No phase has run yet.'),
        h(
            'div',
            { class: 'legend' },
            (Object.keys(STATUS) as Status[]).filter(k => used.has(k)).map(k => badge(k)),
        ),
    );
}

// ---- phase table ----

function phaseTable(run: Run): HTMLElement {
    const lastSel = run.selections.at(-1);
    const open = run.runs.at(-1);
    const current = open && open.endedAt === null ? open.phase : null;
    const rows = run.phases.map((p, i) => {
        const mine = run.runs.filter(r => r.phase === p.phase);
        const counts = new Map<Status, number>();
        for (const r of mine) {
            const st = phaseRunStatus(r, run);
            counts.set(st, (counts.get(st) ?? 0) + 1);
        }
        const summary = run.result?.phases?.find(x => x.phase === p.phase);
        const ms = summary?.durationMs ?? mine.reduce((n, r) => n + ((r.endedAt ?? Date.now()) - r.startedAt), 0);
        const check = lastSel ? (lastSel.checks[p.phase] ?? 'not checked') : '—';
        const last = mine.at(-1);
        return h(
            'tr',
            { class: current === p.phase ? 'current' : null },
            h('td', { class: 'num muted' }, i + 1),
            h(
                'td',
                {},
                h('button', { type: 'button', class: 'linkish', onclick: () => highlight(p.phase) }, p.phase),
                p.task !== p.phase ? h('div', { class: 'muted' }, p.task) : null,
                h(
                    'details',
                    { class: 'params' },
                    h('summary', {}, 'params'),
                    h('pre', {}, JSON.stringify(p.params, null, 2)),
                ),
            ),
            h(
                'td',
                {},
                h(
                    'span',
                    { class: `check ${check === 'chosen' ? 'chosen' : check === 'not checked' ? 'not' : ''}` },
                    check,
                ),
            ),
            h('td', { class: 'num' }, mine.length),
            h(
                'td',
                {},
                h(
                    'div',
                    { class: 'chips' },
                    [...counts].map(([k, n]) => badge(k, `${n}`)),
                ),
            ),
            h('td', { class: 'num' }, mine.length ? dur(ms) : ''),
            h('td', {}, summary ? xpText(summary.xpGained) : ''),
            h(
                'td',
                { class: 'reason' },
                last
                    ? h(
                          'button',
                          { type: 'button', class: 'linkish', onclick: () => pickRun(last.index) },
                          last.reason ?? 'running…',
                      )
                    : '',
            ),
        );
    });
    return h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Phases'),
        h(
            'p',
            { class: 'muted hint' },
            'In selection order: the first phase whose when holds runs. "Last check" is what each answered at the latest selection.',
        ),
        h(
            'div',
            { class: 'table-wrap' },
            h(
                'table',
                {},
                h(
                    'thead',
                    {},
                    h(
                        'tr',
                        {},
                        ['#', 'Phase', 'Last check', 'Runs', 'Outcomes', 'Time', 'XP', 'Last reason'].map(t =>
                            h('th', {}, t),
                        ),
                    ),
                ),
                h('tbody', {}, rows),
            ),
        ),
    );
}

function highlight(phase: string) {
    sourcePhase = phase;
    sourceKey = '';
    schedule();
}

// ---- phase run panel ----

function phasePanel(run: Run): HTMLElement {
    const entry = shownEntry(run);
    if (!entry)
        return h(
            'section',
            { class: 'card' },
            h('h2', {}, 'Phase run'),
            h('p', { class: 'muted' }, 'No phase has run yet.'),
        );
    const log = phaseLogFor(entry, run);
    const sel = run.selections[entry.selection];
    const st = phaseRunStatus(entry, run);
    const steps = Object.entries(log?.stepRuns ?? {}).sort((a, b) => b[1] - a[1]);
    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'plan-head' },
            run.kind === 'plan'
                ? [
                      h('h2', { class: 'flush' }, `Phase run ${entry.index + 1} of ${run.runs.length}`),
                      h('b', {}, entry.phase),
                  ]
                : h('h2', { class: 'flush' }, 'Task run'),
            badge(st),
            picked !== null ? h('button', { type: 'button', onclick: () => pickRun(null) }, 'Show latest') : null,
        ),
        h(
            'div',
            { class: 'kv' },
            h('span', {}, 'started ', h('b', {}, clock(entry.startedAt))),
            h('span', {}, 'for ', h('b', {}, dur((entry.endedAt ?? Date.now()) - entry.startedAt))),
            log?.step ? h('span', {}, 'step ', h('b', {}, log.step)) : null,
            log?.gained ? h('span', {}, 'gained ', h('b', {}, log.gained)) : null,
            entry.reason ? h('span', {}, 'reason ', h('b', {}, entry.reason)) : null,
            entry.runId ? h('span', { class: 'mono muted' }, entry.runId) : null,
        ),
        h(
            'div',
            { class: 'phase-grid' },
            h(
                'div',
                {},
                run.kind === 'task' ? taskParams(run, log) : selectionPanel(sel),
                h('div', { class: 'sub-h' }, 'Steps entered'),
                steps.length
                    ? h(
                          'div',
                          { class: 'chips' },
                          steps.map(([k, n]) => h('span', { class: 'chip' }, k, h('b', {}, n))),
                      )
                    : h('span', { class: 'muted' }, log ? 'none yet' : 'loading…'),
            ),
            h(
                'div',
                {},
                h('div', { class: 'sub-h' }, run.kind === 'plan' ? 'Phase log' : 'Log'),
                log && log.lines.length
                    ? h(
                          'pre',
                          { class: 'lines' },
                          log.lines.map(l =>
                              h(
                                  'div',
                                  { class: 'l' },
                                  h('span', { class: 't' }, clock(l.t)),
                                  h('span', { class: l.kind }, l.text),
                              ),
                          ),
                      )
                    : h('span', { class: 'muted' }, log ? 'no lines yet' : 'loading…'),
            ),
        ),
    );
}

/** A task run's params: what it was started with, where a phase shows the selection that chose it. */
function taskParams(run: Run, log: PhaseLog | null): Child[] {
    return [
        h('div', { class: 'sub-h' }, 'Params'),
        h('pre', { class: 'params-json' }, JSON.stringify(run.phases[0]?.params ?? log?.params ?? null, null, 2)),
    ];
}

/** The selection that started a phase run: each phase's answer, the inventory and the bank it saw. */
function selectionPanel(sel: Selection | undefined): Child[] {
    const head = h('div', { class: 'sub-h' }, 'Chosen at this selection');
    if (!sel) return [head, h('span', { class: 'muted' }, 'no selection recorded')];
    return [
        head,
        h(
            'div',
            { class: 'chips' },
            Object.entries(sel.checks).map(([k, v]) =>
                h('span', { class: 'chip' }, k, h('b', { class: v === 'chosen' ? '' : 'muted' }, v)),
            ),
        ),
        sel.last
            ? h('div', { class: 'sub-h' }, `after ${sel.last.phase} ${sel.last.status}: ${sel.last.reason}`)
            : null,
        h('div', { class: 'sub-h' }, `Inventory (${sel.free} free)`),
        countChips(sel.inventory),
        h('div', { class: 'sub-h' }, 'Bank as last seen'),
        sel.bank ? countChips(sel.bank) : h('span', { class: 'muted' }, 'not seen open yet in this plan'),
    ];
}

function countChips(counts: Record<string, number>): HTMLElement {
    const items = Object.entries(counts);
    if (!items.length) return h('span', { class: 'muted' }, 'empty');
    return h(
        'div',
        { class: 'chips' },
        items.map(([k, n]) => h('span', { class: 'chip' }, k, h('b', {}, num(n)))),
    );
}

// ---- bot panel ----

function botPanel(): HTMLElement {
    const b = botSnap;
    const watching = viewing === live;
    const title = h('h2', {}, `Bot${bot ? ` · ${bot}` : ''}`);
    if (!b) return h('aside', { class: 'card' }, title, h('p', { class: 'muted' }, 'connecting…'));
    const stMap: Record<BotSnapshot['status'], Status> = {
        live: 'running',
        stale: 'stuck',
        connecting: 'killed',
        offline: 'error',
    };
    const label = { live: 'live', stale: 'stale', connecting: 'connecting', offline: 'offline' }[b.status];
    const p = b.player;
    const slots = [...b.inventory];
    while (slots.length < b.slots) slots.push({ name: '', count: 0 });
    return h(
        'aside',
        { class: 'card' },
        title,
        h('div', {}, badge(stMap[b.status], label), b.message ? h('span', { class: 'muted' }, ` ${b.message}`) : null),
        !watching ? h('div', { class: 'sub-h' }, 'Now, not at the time of the plan shown.') : null,
        p
            ? h(
                  'div',
                  {},
                  h(
                      'div',
                      { class: 'kv' },
                      h(
                          'span',
                          {},
                          'at ',
                          h('b', { class: 'mono' }, `${p.x}, ${p.z}${p.plane ? ` (plane ${p.plane})` : ''}`),
                      ),
                      h('span', {}, 'combat ', h('b', {}, p.combatLevel)),
                      p.inCombat ? h('span', {}, h('b', {}, '⚔ in combat')) : null,
                  ),
                  h('div', { class: 'sub-h' }, `HP ${p.hp} / ${p.maxHp}`),
                  h(
                      'div',
                      {
                          class: 'hp',
                          role: 'meter',
                          'aria-valuenow': p.hp,
                          'aria-valuemax': p.maxHp,
                          'aria-valuemin': 0,
                      },
                      h('span', { style: `width:${p.maxHp ? Math.round((100 * p.hp) / p.maxHp) : 0}%` }),
                  ),
              )
            : null,
        h('div', { class: 'sub-h' }, `Inventory (${b.slots - b.inventory.length} free)`),
        h(
            'div',
            { class: 'inv' },
            slots.map(i =>
                i.name
                    ? h(
                          'div',
                          { class: 'slot', title: `${i.name} × ${i.count}` },
                          i.name,
                          i.count > 1 ? h('span', { class: 'c' }, num(i.count)) : null,
                      )
                    : h('div', { class: 'slot blank' }),
            ),
        ),
        b.equipment.length
            ? [h('div', { class: 'sub-h' }, 'Equipped'), h('div', { class: 'muted' }, b.equipment.join(', '))]
            : null,
        b.skills.length
            ? [
                  h('div', { class: 'sub-h' }, 'Skills'),
                  h(
                      'div',
                      { class: 'skills' },
                      b.skills.map(k =>
                          h(
                              'span',
                              { title: `${num(k.xp)} XP` },
                              k.name,
                              h('b', {}, k.level === k.baseLevel ? k.baseLevel : `${k.level}/${k.baseLevel}`),
                          ),
                      ),
                  ),
              ]
            : null,
    );
}

// ---- source ----

function sourcePanel(reply: RunReply): HTMLElement {
    if (!reply.source)
        return h(
            'section',
            { class: 'card' },
            h('h2', {}, 'Plan source'),
            h('p', { class: 'muted' }, 'No copy of the source beside this log.'),
        );
    const lines = reply.source.split('\n');
    const task = reply.run.phases.find(p => p.phase === sourcePhase)?.task;
    const target = sourcePhase === null ? -1 : sourceLine(lines, sourcePhase, task ?? sourcePhase);
    return h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Plan source', h('span', { class: 'muted plain' }, ` · the copy that ran`)),
        h(
            'pre',
            { class: 'source' },
            lines.map((l, i) => h('span', { class: `ln${i === target ? ' hl' : ''}` }, tint(l))),
        ),
    );
}
/** The line declaring a phase: its `name:`, or for a phase named after its task, the phase(<task>, ...) call. */
function sourceLine(lines: string[], phase: string, task: string): number {
    const named = lines.findIndex(l => l.includes(`name: '${phase}'`));
    if (named >= 0) return named;
    const call = new RegExp(`phase\\(\\s*${escapeRe(toIdent(task))}\\b`);
    return lines.findIndex(l => call.test(l));
}
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Task name -> the identifier plans import it as: "fish-cook" -> "fishCook". */
const toIdent = (task: string) => task.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Comments muted and strings tinted; enough to read a plan, not a TypeScript highlighter. */
function tint(line: string): Child[] {
    const out: Child[] = [];
    const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
    let at = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
        if (m.index > at) out.push(line.slice(at, m.index));
        out.push(h('span', { class: m[1] ? 'cm' : 'str' }, m[0]));
        at = m.index + m[0].length;
    }
    out.push(line.slice(at) || (out.length ? '' : ' '));
    return out;
}

// ---- world ----

/** Whether the 3D view is open; remembered per browser. */
const WORLD_OPEN_KEY = 'plan-view:world-open';
/** How often a feed that is not on is asked about again: an engine restart turns it on. */
const WORLD_RECHECK_MS = 15_000;
let worldOpen = true;
/** The world panel's bot, and what /api/world says of it. */
let worldBot: string | null = null;
let world: WorldInfo | null = null;
let worldError: string | null = null;
let worldTimer: ReturnType<typeof setTimeout> | null = null;

function readWorldOpen(): boolean {
    try {
        return localStorage.getItem(WORLD_OPEN_KEY) !== 'false';
    } catch {
        return true;
    }
}
function setWorldOpen(open: boolean) {
    worldOpen = open;
    try {
        localStorage.setItem(WORLD_OPEN_KEY, String(open));
    } catch {
        // storage blocked: open for this page only
    }
    renderWorld();
}

/** rs-world, served by the viewer, streaming the engine's feed and following the bot. */
const worldSrc = (w: WorldInfo) => `/rs-world/?${q({ live: w.feed, follow: w.follow })}`;

async function loadWorld(name: string) {
    if (worldTimer) clearTimeout(worldTimer);
    worldTimer = null;
    if (worldBot !== name) {
        worldBot = name;
        world = null;
        worldError = null;
        renderWorld();
    }
    try {
        const w = await getJson<WorldInfo>(`/api/world?${q({ bot: name })}`);
        if (worldBot !== name) return;
        world = w;
        worldError = null;
    } catch (e) {
        if (worldBot !== name) return;
        worldError = String(e);
    }
    if (world?.status !== 'on') worldTimer = setTimeout(() => void loadWorld(name), WORLD_RECHECK_MS);
    renderWorld();
}

/** The world panel's one line: what it follows, or why it shows nothing. */
function worldStatus(isolated: boolean): string {
    if (!worldBot) return '';
    if (worldError) return `Can't tell where ${worldBot} is: ${worldError}`;
    if (!world) return 'Asking the engine for its world feed…';
    if (world.status !== 'on') return `No 3D view: ${world.message ?? world.status}`;
    if (!isolated)
        return 'No 3D view: this page is not cross-origin isolated. Open the viewer at http://localhost or 127.0.0.1.';
    // The bot panel's observer knows whether a game client plays the bot now.
    if (botSnap && botSnap.status !== 'live')
        return `Not in the game now (${botSnap.status}): the view follows ${world.follow} once a client logs in`;
    return `Following ${world.follow} over ${world.feed}`;
}

function renderWorld() {
    const toggle = $<HTMLButtonElement>('world-toggle');
    const status = $('world-status');
    const tab = $<HTMLAnchorElement>('world-tab');
    const frame = $('world-frame');
    toggle.setAttribute('aria-pressed', String(worldOpen));
    // rs-world shares memory with its workers, which only a cross-origin isolated page may: the
    // server sends the headers, but a browser isolates only a secure context (https or localhost).
    const isolated = window.crossOriginIsolated;
    /** The world to show: its feed is on and the page can run rs-world. */
    const ready = world?.status === 'on' && isolated ? world : null;
    status.textContent = worldStatus(isolated);
    tab.hidden = !ready;
    if (world) tab.href = worldSrc(world);
    if (!worldOpen || !ready) {
        // Unloading it stops the renderer and closes its feed connection.
        frame.replaceChildren();
        frame.hidden = true;
        return;
    }
    frame.hidden = false;
    const src = worldSrc(ready);
    if (frame.querySelector('iframe')?.dataset.src === src) return;
    frame.replaceChildren(h('iframe', { src, 'data-src': src, title: `${ready.follow} in the game world (rs-world)` }));
}

// ---- tooltip ----

function initTip() {
    const tip = $('tip');
    document.addEventListener('pointermove', ev => {
        const el = (ev.target as Element | null)?.closest?.('[data-tip]');
        if (!el) {
            tip.hidden = true;
            return;
        }
        const [head, ...rest] = (el.getAttribute('data-tip') ?? '').split('\n');
        tip.replaceChildren(h('b', {}, head ?? ''), ...rest.map(r => h('div', {}, r)));
        tip.hidden = false;
        const gap = 14;
        const w = tip.offsetWidth;
        const left = ev.clientX + gap + w > innerWidth ? ev.clientX - gap - w : ev.clientX + gap;
        tip.style.left = `${Math.max(4, left)}px`;
        tip.style.top = `${ev.clientY + gap}px`;
    });
}

// ---- boot ----

const botOption = (b: BotInfo) =>
    h(
        'option',
        { value: b.bot, selected: b.bot === bot },
        `${b.bot}${b.latest?.state === 'running' ? ' ▶' : ''} (${b.runs})`,
    );

async function init() {
    initTip();
    $('follow').addEventListener('click', () => setFollow(!follow));
    worldOpen = readWorldOpen();
    $('world-toggle').addEventListener('click', () => setWorldOpen(!worldOpen));
    const select = $<HTMLSelectElement>('bot');
    let bots: BotInfo[] = [];
    try {
        bots = await getJson<BotInfo[]>('/api/bots');
    } catch (e) {
        $('main').replaceChildren(h('p', { class: 'empty' }, `Could not list bots: ${String(e)}`));
        return;
    }
    const hash = readHash();
    // Integration tests' throwaway bots go last, apart, so they don't bury the real ones.
    const real = bots.filter(b => !b.test);
    const tests = bots.filter(b => b.test);
    bot = bots.find(b => b.bot === hash.bot)?.bot ?? real[0]?.bot ?? bots[0]?.bot ?? null;
    select.replaceChildren(
        ...real.map(botOption),
        ...(tests.length ? [h('optgroup', { label: 'Integration test bots' }, tests.map(botOption))] : []),
    );
    select.addEventListener('change', () => {
        bot = select.value;
        follow = true;
        viewing = null;
        connect(bot);
        void loadWorld(bot);
        writeHash();
        schedule();
    });
    if (!bot) {
        schedule();
        return;
    }
    void loadWorld(bot);
    if (hash.run) {
        follow = false;
        try {
            show(await getJson<RunReply>(`/api/run?${q({ bot, runId: hash.run })}`));
        } catch {
            follow = true;
        }
    }
    connect(bot);
    // Durations and the timeline's "now" move while a run runs.
    setInterval(() => {
        if (viewing?.run.state === 'running') schedule();
    }, 1000);
    schedule();
}

void init();
