// A live run's recording: everything its task code could observe through the driver, in the order it
// observed it, so ReplayDriver (replay.ts) can feed the same run to changed code and find the first
// decision that differs.
//
// The code observes the game through driver calls (`state()`, `nextTick()`, `now()`) and the
// results of its commands. Between two calls only a macrotask can change what it sees: a state
// publication, a command settling, the tick-stall timer. So the recording is those events, each
// tagged with how many `state()`/`nextTick()`/`now()` calls the code made since the previous record
// (`n`), plus each command as issued, plus every `now()` value read (`w`). Replaying the same calls
// in the same order then sees every event at the same call.
//
// Full states, not a projection: a publication is ~20 KiB of JSON, and the client already limits
// what it publishes to about 15 tiles, so trimming saves little and would have to prove the code
// reads nothing it drops. Each state is stored as the top-level keys that changed since the last one
// (lossless; a third of the size gzipped). Lines are buffered and appended as separate gzip members,
// synchronously, so memory stays bounded and `close()` can run in a signal handler. Sizes are in
// conductor/docs/interruptible-tasks.md §Replay.
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import type { ActionResult, BotAction, BotWorldState, NearbyLoc, SkillState } from '../../../sdk/types';
import type { StopCondition } from '../../lib/stop';
import type { Sinks } from '../../lib/task';
import { errMessage } from '../../lib/util';

export const RECORDING_VERSION = 1;
/** Raw bytes buffered before they are compressed and appended as one gzip member. */
export const RECORDING_CHUNK_BYTES = 256 * 1024;

/** The recording next to a run's NDJSON log. */
export const recordingFile = (logFile: string): string => logFile.replace(/\.ndjson$/, '') + '.ticks.ndjson.gz';

/** What executeTask was given, so a replay re-runs the task with the same inputs from the file alone. */
export interface RunInputs {
    task: string;
    bot: string;
    runId: string;
    logFile: string;
    params: unknown;
    stops: StopCondition[];
    progressEveryMs?: number;
    /** The plan's runId, for a phase run (ExecuteOptions.partOf). */
    partOf?: string;
    /** The plan's bank record at the phase's start (ExecuteOptions.bank). */
    bank?: Record<string, number>;
}

/** A command as the driver (or the screenshot sink) received it. */
export type RecordedCommand =
    | { type: 'send'; action: BotAction }
    | { type: 'scan'; radius?: number }
    | { type: 'screenshot'; label: string };

/** `n`: state()/nextTick()/now() calls since the previous record. `w`: now() values read since then, as deltas. */
interface Timing {
    n?: number;
    w?: number[];
}

export type Header = { k: 'h'; v: number; run: RunInputs; at: number };

export type Rec =
    /** A state publication: the top-level keys that changed (`d`) and those removed (`x`). */
    | ({ k: 'p'; d: Record<string, unknown>; x?: string[] } & Timing)
    /** A command issued on the state of `tick`. */
    | ({ k: 'c'; id: number; tick: number; cmd: RecordedCommand } & Timing)
    /** Command `id` settled with `v`, or failed with `err`. */
    | ({ k: 'r'; id: number; v?: unknown; err?: string } & Timing)
    /** A tick request rejected: the client stalled (`stall`) or disconnected. */
    | ({ k: 'e'; msg: string; stall?: boolean } & Timing)
    /** The run's result. */
    | ({ k: 'end'; status: string; reason: string } & Timing)
    /**
     * An external stop (ExecuteOptions.externalStop) ended the run on its `check`th call, on the state
     * of `tick`. Untimed: it is no driver event, so the replay drops it from the stream and the records
     * around it line up as in a recording without it. `n`/`w` are `never` rather than left out, so
     * code reading them off any record still type-checks.
     */
    | { k: 'stop'; tick: number; check: number; reason: string; n?: never; w?: never };

/** Encodes each state as the top-level keys that differ from the previous one. */
class StateEncoder {
    private prev = new Map<string, string>();

    encode(s: BotWorldState): { d: Record<string, unknown>; x?: string[] } {
        const next = new Map<string, string>();
        const d: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) {
            if (v === undefined) continue;
            const json = JSON.stringify(v);
            next.set(k, json);
            if (this.prev.get(k) !== json) d[k] = v;
        }
        const x = [...this.prev.keys()].filter(k => !next.has(k));
        this.prev = next;
        return x.length ? { d, x } : { d };
    }
}

/** Rebuilds states from StateEncoder's deltas; every state gets fresh objects, as live publications do. */
export class StateDecoder {
    private prev = new Map<string, string>();

    decode(d: Record<string, unknown>, x: string[] = []): BotWorldState {
        for (const k of x) this.prev.delete(k);
        for (const [k, v] of Object.entries(d)) this.prev.set(k, JSON.stringify(v));
        const s: Record<string, unknown> = {};
        for (const [k, json] of this.prev) s[k] = JSON.parse(json);
        if (Array.isArray(s.skills)) s.skills = withSkillNames(s.skills as SkillState[]);
        return s as unknown as BotWorldState;
    }
}

/**
 * The SDK wraps live `state.skills` in a Proxy so `skills.Woodcutting` works besides `skills[0]`
 * (sdk/index.ts, "Wrap skills array with a Proxy"); replayed JSON gets the same, so code reading it
 * by name behaves alike under replay. Stat<N> placeholder entries are left out of the name lookup.
 */
function withSkillNames(skills: SkillState[]): SkillState[] {
    const byName: Record<string, SkillState> = {};
    for (const skill of skills) {
        if (/^Stat\d+$/i.test(skill.name)) continue;
        byName[skill.name] = skill;
    }
    return new Proxy(skills, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && prop in byName) return byName[prop];
            return Reflect.get(target, prop, receiver);
        },
    });
}

/** Where a recorder's compressed bytes go; the file one in normal use, a fake in tests. */
export interface RecordingOut {
    write(bytes: Uint8Array): void;
    close(): void;
}

function fileOut(path: string): RecordingOut {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'w');
    return {
        write: bytes => {
            for (let off = 0; off < bytes.length;) off += writeSync(fd, bytes, off);
        },
        close: () => closeSync(fd),
    };
}

/**
 * Records one live run (see the file comment). Best effort: the first failure (open, encode, write)
 * is reported through `warn` and turns the recorder off, and no method ever throws into the run.
 */
export class Recorder {
    private out: RecordingOut | null;
    private buf = '';
    private calls = 0;
    private reads: number[] = [];
    private lastNow: number;
    private nextId = 0;
    private tick = -1;
    private readonly encoder = new StateEncoder();

    constructor(
        out: RecordingOut,
        run: RunInputs,
        private readonly warn: (msg: string) => void,
        private readonly chunkBytes = RECORDING_CHUNK_BYTES,
    ) {
        this.out = out;
        this.lastNow = Date.now();
        this.line({ k: 'h', v: RECORDING_VERSION, run, at: this.lastNow } satisfies Header);
    }

    /** A recorder writing to `path`, or null (after a warning) when the file can't be created. */
    static toFile(path: string, run: RunInputs, warn: (msg: string) => void): Recorder | null {
        try {
            return new Recorder(fileOut(path), run, warn);
        } catch (e) {
            warn(`recording off: can't create ${path}: ${errMessage(e)}`);
            return null;
        }
    }

    get recording(): boolean {
        return this.out !== null;
    }

    /** The code called `state()` or `nextTick()`. */
    call(): void {
        this.calls++;
    }

    /** The code read the clock: a call, whose value replay returns. */
    now(t: number): void {
        this.calls++;
        if (this.out) this.reads.push(t);
    }

    publish(s: BotWorldState): void {
        this.guard(() => {
            this.tick = s.tick;
            this.write({ k: 'p', ...this.encoder.encode(s) });
        });
    }

    /** Records a command as issued; returns its id for `settled`/`failed`. */
    command(cmd: RecordedCommand): number {
        const id = this.nextId++;
        this.guard(() => this.write({ k: 'c', id, tick: this.tick, cmd }));
        return id;
    }

    settled(id: number, v: ActionResult | NearbyLoc[] | string | null): void {
        this.guard(() => this.write({ k: 'r', id, v }));
    }

    failed(id: number, e: unknown): void {
        this.guard(() => this.write({ k: 'r', id, err: errMessage(e) }));
    }

    tickError(msg: string, stall: boolean): void {
        this.guard(() => this.write({ k: 'e', msg, ...(stall && { stall }) }));
    }

    /**
     * `sinks` with screenshots recorded as commands, an external stop as a `stop` record and the run's
     * result as the closing record, so the replay can return each screenshot's path, stop where the
     * run was stopped and compare outcomes.
     */
    wrap(sinks: Sinks): Sinks {
        return {
            event: e => {
                if (e.type === 'external-stop')
                    this.guard(() =>
                        this.line({
                            k: 'stop',
                            tick: Number(e.tick),
                            check: Number(e.check),
                            reason: String(e.reason),
                        }),
                    );
                if (e.type === 'result')
                    this.guard(() => this.write({ k: 'end', status: String(e.status), reason: String(e.reason) }));
                sinks.event(e);
            },
            print: line => sinks.print(line),
            screenshot: async label => {
                const id = this.command({ type: 'screenshot', label });
                try {
                    const path = await sinks.screenshot(label);
                    this.settled(id, path);
                    return path;
                } catch (e) {
                    this.failed(id, e);
                    throw e;
                }
            },
        };
    }

    /** Flushes and closes the file; synchronous, so a signal handler can call it. Idempotent. */
    close(): void {
        const out = this.out;
        if (!out) return;
        this.guard(() => this.flush());
        this.out = null;
        try {
            out.close();
        } catch {
            // Everything written so far is already on disk.
        }
    }

    private write(rec: Rec): void {
        const timed: Rec = { ...rec };
        if (this.calls) timed.n = this.calls;
        if (this.reads.length) {
            timed.w = this.reads.map(t => {
                const d = t - this.lastNow;
                this.lastNow = t;
                return d;
            });
        }
        this.calls = 0;
        this.reads = [];
        this.line(timed);
    }

    private line(rec: Rec | Header): void {
        if (!this.out) return;
        this.buf += JSON.stringify(rec) + '\n';
        if (this.buf.length >= this.chunkBytes) this.flush();
    }

    private flush(): void {
        if (!this.out || !this.buf) return;
        const bytes = gzipSync(this.buf);
        this.buf = '';
        this.out.write(bytes);
    }

    private guard(f: () => void): void {
        if (!this.out) return;
        try {
            f();
        } catch (e) {
            const out = this.out;
            this.out = null;
            this.buf = '';
            try {
                out.close();
            } catch {
                // Already failing; the warning below is what matters.
            }
            this.warn(`recording off: ${errMessage(e)}`);
        }
    }
}

/** A recording read back: `w` already turned into absolute times. */
export interface Recording {
    header: Header;
    records: Rec[];
    /** No `end` record: the run was killed or crashed before its result. */
    truncated: boolean;
}

/** Reads a recording file; one cut off mid-write (a killed run) reads up to its last whole line. */
export function readRecording(path: string): Recording {
    return parseRecording(readFileSync(path));
}

/** A recording with no whole line: an empty file, or a prefix of one cut inside its header line. */
export class EmptyRecordingError extends Error {
    constructor() {
        super('empty recording');
    }
}

/** A recording from its gzipped bytes (see readRecording). */
export function parseRecording(bytes: Uint8Array): Recording {
    const text = gunzipSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8');
    const lines = text.split('\n');
    // The last element is '' after a whole file's final newline, or the partial line of a cut one.
    lines.pop();
    const [first, ...rest] = lines;
    if (!first) throw new EmptyRecordingError();
    const header = JSON.parse(first) as Header;
    if (header.k !== 'h' || header.v !== RECORDING_VERSION)
        throw new Error(`not a version ${RECORDING_VERSION} recording`);
    let now = header.at;
    const records = rest.map(line => {
        const rec = JSON.parse(line) as Rec;
        if (rec.w) rec.w = rec.w.map(d => (now += d));
        return rec;
    });
    return { header, records, truncated: records.at(-1)?.k !== 'end' };
}
