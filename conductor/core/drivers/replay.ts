// A Driver that plays a recording (recording.ts) back to task code and reports the first command the
// code issues that the recorded run did not. Each recorded event (a publication, a command settling,
// a refused tick) reaches the code at the same driver call it reached the live code: `n` says how
// many state()/nextTick()/now() calls came first. An event the code was waiting for when it arrived
// is delivered once the code has gone idle (setImmediate), as a live websocket message is.
//
// Replay is valid up to the first divergence: the recorded world does not react to a new decision.
// From there the driver stops: the code's state() throws, ticks are refused and commands fail, so
// the run winds down at once.
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import type { Sinks } from '../../lib/task';
import { canonical } from '../../lib/util';
import { type Driver, TickStall } from '../interpret';
import { type Rec, type RecordedCommand, type Recording, StateDecoder } from './recording';

/**
 * - different: the replay sent another command where the recording sent one.
 * - extra: the replay sent a command where the recording sent none.
 * - missing: the recording sent a command the replay never did (it waited, or its run ended).
 * - tick: the same command, sent on another tick.
 * - outcome: the same commands, but the run ended differently.
 */
export type DivergenceKind = 'different' | 'extra' | 'missing' | 'tick' | 'outcome';

export interface Divergence {
    kind: DivergenceKind;
    /** The replay's tick when the difference showed. */
    tick: number;
    /** What the recorded run did. */
    expected: string;
    /** What the replayed code did. */
    got: string;
}

/** What the replayed code gets from the driver once the replay has stopped. */
export class ReplayStopped extends Error {
    override name = 'ReplayStopped';
}

/**
 * Idle turns with no driver call, for at least BLOCKED_MS, before the code counts as blocked rather
 * than between two awaits of its own (the engine's `sleep(0)`). Wall time only paces this check.
 */
const BLOCKED_TURNS = 10;
const BLOCKED_MS = 20;
/** Ticks the replay may run on, blocked short of a command the recording sent, to see whether it sends it late. */
export const LOOKAHEAD_TICKS = 25;

type Event = Extract<Rec, { k: 'p' | 'r' | 'e' }>;
type Sent = Extract<Rec, { k: 'c' }>;

const isEvent = (r: Rec | undefined): r is Event => r?.k === 'p' || r?.k === 'r' || r?.k === 'e';

/** Commands compare as their JSON, as recorded: an `undefined` field is no field. */
const commandKey = (cmd: RecordedCommand): string => canonical(JSON.parse(JSON.stringify(cmd)));

export function describeCommand(cmd: RecordedCommand): string {
    switch (cmd.type) {
        case 'send': {
            const { type, reason, ...args } = cmd.action as BotAction & Record<string, unknown>;
            const json = canonical(JSON.parse(JSON.stringify(args)));
            return `send ${type} (${reason})${json === '{}' ? '' : ` ${json}`}`;
        }
        case 'scan':
            return cmd.radius === undefined ? 'scan' : `scan radius ${cmd.radius}`;
        case 'screenshot':
            return `screenshot "${cmd.label}"`;
    }
}

const at = (cmd: RecordedCommand, tick: number) => `${describeCommand(cmd)} at tick ${tick}`;

interface Settle<T> {
    resolve(v: T): void;
    reject(e: Error): void;
}

export class ReplayDriver implements Driver {
    /** The first difference from the recording, once found. */
    divergence: Divergence | null = null;
    /** Commands the replay sent as the recording did. */
    matched = 0;
    /** The recording ran out (it has no result) while the replay waited on it. */
    exhausted = false;

    private readonly records: Rec[];
    private pos = 0;
    /** Driver calls since the last record consumed (Rec.n). */
    private calls = 0;
    private current: BotWorldState | null = null;
    private lastTick = -1;
    private pendingTick: (Settle<BotWorldState> & { promise: Promise<BotWorldState> }) | null = null;
    private readonly pendingCommands = new Map<number, Settle<unknown>>();
    private readonly decoder = new StateDecoder();
    private clock: number;
    private clockRead = 0;
    private stopped: ReplayStopped | null = null;
    private finished = false;
    /** A command the recording sent while the replay sat blocked: the replay's next command is held to it. */
    private missing: Sent | null = null;
    private progress = 0;
    private idleProgress = -1;
    private idleTurns = 0;
    private idleSince = 0;
    private scheduled = false;

    constructor(recording: Recording) {
        // An external stop is no driver event; replayRun stops the run there itself.
        this.records = recording.records.filter(r => r.k !== 'stop');
        this.clock = recording.header.at;
    }

    state(): BotWorldState {
        this.enter();
        if (this.stopped) throw this.stopped;
        if (!this.current) throw new Error('no world state from client');
        return this.current;
    }

    nextTick(): Promise<BotWorldState> {
        this.enter();
        if (this.stopped) return Promise.reject(this.stopped);
        if (this.pendingTick) return this.pendingTick.promise;
        const head = this.head();
        // Refused on the spot (the live driver records a refusal with the call that met it).
        if (head?.k === 'e' && (head.n ?? 0) <= this.calls) {
            this.consume(head);
            return Promise.reject(head.stall ? new TickStall(head.msg) : new Error(head.msg));
        }
        let settle!: Settle<BotWorldState>;
        const promise = new Promise<BotWorldState>((resolve, reject) => {
            settle = { resolve, reject };
        });
        this.pendingTick = { ...settle, promise };
        return promise;
    }

    send(action: BotAction): Promise<ActionResult> {
        const stopped: ActionResult = { success: false, message: 'replay stopped', reason: 'replay' };
        return this.issue({ type: 'send', action }, stopped) as Promise<ActionResult>;
    }

    scan(radius?: number): Promise<NearbyLoc[]> {
        return this.issue({ type: 'scan', ...(radius !== undefined && { radius }) }, []) as Promise<NearbyLoc[]>;
    }

    screenshot(label: string): Promise<string | null> {
        return this.issue({ type: 'screenshot', label }, null) as Promise<string | null>;
    }

    /** Unused by the engine, which sends op logs to its sinks; nothing to compare. */
    log(): void {}

    /** The recorded clock: each read returns what the same read returned live. */
    now(): number {
        this.enter();
        const w = this.head()?.w;
        if (w && this.clockRead < w.length) this.clock = w[this.clockRead++]!;
        return this.clock;
    }

    /**
     * Sinks for executeTask: screenshots answered from the recording, and the result event checked
     * against the recorded one. `print` gets the replayed run's output lines.
     */
    sinks(print: (line: string) => void = () => {}): Sinks {
        return {
            event: e => {
                if (e.type === 'result') this.ended(String(e.status), String(e.reason));
            },
            print,
            screenshot: label => this.screenshot(label),
        };
    }

    /** The tick of the state the code last saw. */
    get tick(): number {
        return this.current?.tick ?? -1;
    }

    /** Stops answering; call once executeTask has returned. */
    close(): void {
        this.finished = true;
        this.stop('replay closed');
    }

    private head(): Rec | undefined {
        return this.records[this.pos];
    }

    /** A driver call: first the events that came before it live, then it counts. */
    private enter(): void {
        if (!this.stopped) this.catchUp();
        this.calls++;
        this.progress++;
        this.schedule();
    }

    /** Looking ahead (see `missing`), calls no longer line up with the recording's: only `idle` delivers. */
    private catchUp(): void {
        if (this.missing) return;
        for (let head = this.head(); isEvent(head) && (head.n ?? 0) <= this.calls; head = this.head()) this.apply(head);
    }

    private consume(rec: Rec): void {
        this.pos++;
        this.calls = 0;
        if (rec.w?.length) this.clock = rec.w.at(-1)!;
        this.clockRead = 0;
        this.progress++;
    }

    /** Delivers an event as the live driver received it. */
    private apply(rec: Event): void {
        this.consume(rec);
        switch (rec.k) {
            case 'p': {
                const s = this.decoder.decode(rec.d, rec.x);
                this.current = s;
                if (s.tick > this.lastTick) {
                    this.lastTick = s.tick;
                    const p = this.pendingTick;
                    this.pendingTick = null;
                    p?.resolve(s);
                }
                return;
            }
            case 'r': {
                const c = this.pendingCommands.get(rec.id);
                if (!c) return;
                this.pendingCommands.delete(rec.id);
                if (rec.err !== undefined) c.reject(new Error(rec.err));
                else c.resolve(rec.v);
                return;
            }
            case 'e': {
                const p = this.pendingTick;
                this.pendingTick = null;
                p?.reject(rec.stall ? new TickStall(rec.msg) : new Error(rec.msg));
            }
        }
    }

    private issue(cmd: RecordedCommand, whenStopped: unknown): Promise<unknown> {
        if (!this.stopped) this.catchUp();
        this.progress++;
        this.schedule();
        if (this.stopped) return Promise.resolve(whenStopped);
        const tick = this.tick;
        const got = at(cmd, tick);
        const key = commandKey(cmd);
        if (this.missing) {
            const m = this.missing;
            const kind = commandKey(m.cmd) === key ? 'tick' : 'missing';
            return this.refuse({ kind, tick, expected: at(m.cmd, m.tick), got }, whenStopped);
        }
        const head = this.head();
        if (head?.k === 'c') {
            if (commandKey(head.cmd) !== key)
                return this.refuse({ kind: 'different', tick, expected: at(head.cmd, head.tick), got }, whenStopped);
            if (head.tick !== tick)
                return this.refuse({ kind: 'tick', tick, expected: at(head.cmd, head.tick), got }, whenStopped);
            this.consume(head);
            this.matched++;
            const promise = new Promise<unknown>((resolve, reject) => {
                this.pendingCommands.set(head.id, { resolve, reject });
            });
            // A result recorded straight after its command settled before the code's next call.
            const next = this.head();
            if (next?.k === 'r' && next.id === head.id && !next.n) this.apply(next);
            return promise;
        }
        // The recording sent nothing here: it went on waiting for the world, or its run ended.
        const later = this.records.slice(this.pos).find(r => r.k === 'c' || r.k === 'end');
        if (later?.k === 'c' && commandKey(later.cmd) === key)
            return this.refuse({ kind: 'tick', tick, expected: at(later.cmd, later.tick), got }, whenStopped);
        const expected =
            later?.k === 'c'
                ? `no command; next ${at(later.cmd, later.tick)}`
                : later?.k === 'end'
                  ? `no command; the run ended (${later.status}: ${later.reason})`
                  : 'no command before the recording ends';
        return this.refuse({ kind: 'extra', tick, expected, got }, whenStopped);
    }

    /** The replayed run's result: the recording must have ended here too, and the same way. */
    private ended(status: string, reason: string): void {
        if (this.stopped) return;
        this.catchUp();
        const got = `the run ended (${status}: ${reason}) at tick ${this.tick}`;
        const rest = this.records.slice(this.pos).find(r => r.k === 'c' || r.k === 'end');
        if (this.missing)
            this.diverge({ kind: 'missing', tick: this.tick, expected: at(this.missing.cmd, this.missing.tick), got });
        else if (rest?.k === 'c')
            this.diverge({ kind: 'missing', tick: this.tick, expected: at(rest.cmd, rest.tick), got });
        else if (rest?.k === 'end' && (rest.status !== status || rest.reason !== reason))
            this.diverge({
                kind: 'outcome',
                tick: this.tick,
                expected: `the run ended (${rest.status}: ${rest.reason})`,
                got,
            });
        this.finished = true;
    }

    /** Notes the first divergence and stops the replay. */
    private diverge(d: Divergence): void {
        this.divergence ??= d;
        this.stop(`diverged at tick ${d.tick}`);
    }

    /** Diverges on a command, which gets the answer every command gets once the replay has stopped. */
    private refuse<T>(d: Divergence, answer: T): Promise<T> {
        this.diverge(d);
        return Promise.resolve(answer);
    }

    private stop(why: string): void {
        if (this.stopped) return;
        const stopped = new ReplayStopped(`replay stopped: ${why}`);
        this.stopped = stopped;
        const p = this.pendingTick;
        this.pendingTick = null;
        p?.reject(stopped);
        for (const c of this.pendingCommands.values()) c.reject(stopped);
        this.pendingCommands.clear();
    }

    private schedule(): void {
        if (this.scheduled || this.stopped || this.finished) return;
        this.scheduled = true;
        setImmediate(() => {
            this.scheduled = false;
            this.idle();
        });
    }

    /** The code is idle: deliver the event it waits for, or find that it waits for one that never comes. */
    private idle(): void {
        if (this.stopped || this.finished) return;
        const now = performance.now();
        if (this.progress !== this.idleProgress) {
            this.idleProgress = this.progress;
            this.idleTurns = 0;
            this.idleSince = now;
        } else this.idleTurns++;
        const blocked = this.idleTurns >= BLOCKED_TURNS && now - this.idleSince >= BLOCKED_MS;
        const head = this.head();
        if (this.missing && this.tick - this.missing.tick > LOOKAHEAD_TICKS) {
            const m = this.missing;
            this.diverge({
                kind: 'missing',
                tick: this.tick,
                expected: at(m.cmd, m.tick),
                got: `no command by tick ${this.tick}`,
            });
            return;
        }
        // Looking ahead, the code's calls no longer line up with the recording's: records go in as they come.
        if (isEvent(head) && ((head.n ?? 0) <= this.calls || blocked || this.missing)) this.apply(head);
        else if (blocked || this.missing) this.blockedAt(head);
        this.schedule();
    }

    /** The code is blocked waiting while the recording has a command or its end next (or nothing). */
    private blockedAt(head: Rec | undefined): void {
        const m = this.missing;
        if (m && head?.k !== 'c') {
            const got = head ? 'no command before the recorded run ended' : 'no command before the recording ends';
            this.diverge({ kind: 'missing', tick: this.tick, expected: at(m.cmd, m.tick), got });
        } else if (!head) {
            this.exhausted = true;
            this.stop('the recording ends here');
        } else if (head.k === 'c') {
            // Skip it and run on: if the replay sends it a few ticks later, that is a `tick` divergence.
            this.missing ??= head;
            this.consume(head);
        } else if (head.k === 'end') {
            this.diverge({
                kind: 'outcome',
                tick: this.tick,
                expected: `the run ended (${head.status}: ${head.reason})`,
                got: `still running at tick ${this.tick}`,
            });
        }
    }
}
