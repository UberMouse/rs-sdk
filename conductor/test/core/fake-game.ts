// A game a LiveDriver can run against in unit tests: it ticks on a timer and answers each send a
// macrotask later, as the real client does, so a recorded run has the interleavings of a live one.
// Only what the replay fixture task sends is answered.
import { z } from 'zod/v4';
import type { BotSDK } from '../../../sdk/index';
import type { ActionResult, BotWorldState, ConnectionState, NearbyLoc } from '../../../sdk/types';
import { LiveDriver } from '../../core/drivers/live';
import { parseRecording, Recorder, type Recording, type RecordingOut } from '../../core/drivers/recording';
import { scan, send, ticks, wait } from '../../core/op';
import { executeTask, type ExecuteOptions } from '../../lib/engine';
import type { StopCondition } from '../../lib/stop';
import { defineTask, type Sinks, type TaskResult } from '../../lib/task';
import { countItems, findSkill } from '../../lib/util';
import { LUMBRIDGE, world } from '../world';

const OK: ActionResult = { success: true, message: 'ok' };
const macrotask = () => new Promise<void>(resolve => setImmediate(resolve));

export const TREE = { x: LUMBRIDGE.x + 2, z: LUMBRIDGE.z };
/** XP a chop gives. */
export const CHOP_XP = 25;

export const logsOf = (s: BotWorldState) => countItems(s, /^logs$/i);
const xpOf = (s: BotWorldState) => findSkill(s, 'Woodcutting')?.experience ?? 0;

export function startState(): BotWorldState {
    return world()
        .tick(100)
        .player({ at: LUMBRIDGE })
        .skill('Woodcutting', 1, 0)
        .loc('Tree', TREE.x, TREE.z, { options: ['Chop down'] })
        .build();
}

export interface FakeGameOptions {
    /** Every third tick is published twice, the second a revision of the same tick. */
    revisions?: boolean;
    /** Which chops (1-based) the game refuses ("I can't reach that!"). */
    refuseChop?: (n: number) => boolean;
    /** The game stops ticking after this tick. */
    lastTick?: number;
}

export class FakeGame {
    state: BotWorldState = startState();
    connection: ConnectionState = 'connected';
    private readonly stateListeners = new Set<(s: BotWorldState) => void>();
    private due: { tick: number; apply: (s: BotWorldState) => BotWorldState }[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private chops = 0;

    constructor(private readonly opts: FakeGameOptions = {}) {}

    start(): void {
        this.timer = setTimeout(() => this.tick(), 1);
    }

    stop(): void {
        clearTimeout(this.timer);
    }

    private tick(): void {
        let s: BotWorldState = { ...this.state, tick: this.state.tick + 1, revision: 0 };
        const now = this.due.filter(d => d.tick <= s.tick);
        this.due = this.due.filter(d => d.tick > s.tick);
        for (const d of now) s = d.apply(s);
        this.publish(s);
        if (this.opts.revisions && s.tick % 3 === 0)
            setImmediate(() => this.publish({ ...this.state, revision: (this.state.revision ?? 0) + 1 }));
        if (this.opts.lastTick === undefined || s.tick < this.opts.lastTick)
            this.timer = setTimeout(() => this.tick(), 1);
    }

    private after(n: number, apply: (s: BotWorldState) => BotWorldState): void {
        this.due.push({ tick: this.state.tick + n, apply });
    }

    private publish(s: BotWorldState): void {
        this.state = s;
        for (const l of this.stateListeners) l(s);
    }

    getState() {
        return this.state;
    }
    getConnectionState() {
        return this.connection;
    }
    onStateUpdate(l: (s: BotWorldState) => void) {
        this.stateListeners.add(l);
        return () => this.stateListeners.delete(l);
    }
    onConnectionStateChange() {
        return () => {};
    }

    async sendInteractLoc(): Promise<ActionResult> {
        await macrotask();
        if (this.opts.refuseChop?.(++this.chops))
            return { success: false, message: "I can't reach that!", reason: 'cant_reach' };
        this.after(2, s =>
            world(s)
                .inv('Logs', logsOf(s) + 1)
                .skill('Woodcutting', 1, xpOf(s) + CHOP_XP)
                .build(),
        );
        return OK;
    }

    async sendDropItem(slot: number): Promise<ActionResult> {
        await macrotask();
        this.after(1, s => ({ ...s, inventory: s.inventory.filter(i => i.slot !== slot) }));
        return OK;
    }

    async scanNearbyLocs(): Promise<NearbyLoc[]> {
        await macrotask();
        return this.state.nearbyLocs;
    }
}

/** How a variant of the fixture task differs from the recorded one. */
export interface ChopperVariant {
    /** Drops the logs once it holds this many (default 3). */
    dropAt?: number;
    /** After its first chop, waits one tick and then sends a `none` before waiting on. */
    peekAfterFirstChop?: boolean;
    /** Waits a tick before the chop it starts holding this many logs. */
    hesitateAt?: number;
    /** Ends the run once it holds this many logs. */
    enoughAt?: number;
    /** Scans before every chop. */
    scans?: boolean;
}

/** The replay fixture: chops the tree, retries a refused chop, drops its logs at `dropAt`. */
export function chopper(v: ChopperVariant = {}) {
    const dropAt = v.dropAt ?? 3;
    return defineTask({
        name: 'chopper',
        description: 'replay fixture',
        params: z.object({}),
        memory: () => ({ chops: 0, hesitated: false }),
        isComplete: ctx => (v.enoughAt !== undefined && logsOf(ctx.state()) >= v.enoughAt ? 'enough logs' : null),
        steps: [
            {
                name: 'drop',
                when: ctx => logsOf(ctx.state()) >= dropAt,
                *run(ctx) {
                    const s = ctx.state();
                    const held = logsOf(s);
                    const slot = s.inventory.find(i => /^logs$/i.test(i.name))!.slot;
                    yield* send({ type: 'dropItem', slot, reason: 'drop Logs' });
                    yield* wait('dropped', st => logsOf(st) < held, 5);
                },
            },
            {
                name: 'chop',
                when: () => true,
                *run(ctx) {
                    if (v.hesitateAt !== undefined && logsOf(ctx.state()) === v.hesitateAt && !ctx.memory.hesitated) {
                        ctx.memory.hesitated = true;
                        yield* ticks(1);
                    }
                    if (v.scans) yield* scan(8);
                    const s = ctx.state();
                    const tree = s.nearbyLocs.find(l => l.name === 'Tree')!;
                    const before = xpOf(s);
                    const r = yield* send({
                        type: 'interactLoc',
                        x: tree.x,
                        z: tree.z,
                        locId: tree.id,
                        optionIndex: 1,
                        reason: 'Chop down Tree',
                    });
                    if (!r.success) {
                        yield* send({ type: 'none', reason: `refused: ${r.message}` });
                        return;
                    }
                    if (v.peekAfterFirstChop && ctx.memory.chops++ === 0) {
                        yield* ticks(1);
                        yield* send({ type: 'none', reason: 'peek' });
                    }
                    yield* wait('xp', st => xpOf(st) > before, 10);
                },
            },
        ],
    });
}

/** In-memory sinks; screenshots get a fake path. */
export function memorySinks(): Sinks & { lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        event: () => {},
        print: line => lines.push(line),
        screenshot: async label => `/shots/${label}.png`,
    };
}

export const RUN = { bot: 'tester', runId: 'run-1', logFile: '/logs/run-1.ndjson' };

/**
 * Runs `def` on `game` through a recording LiveDriver, as run-task does, and returns the result and
 * the recording read back. Small gzip chunks, so a recording spans many members.
 */
export async function recordRun(
    def: ReturnType<typeof chopper>,
    game: FakeGame,
    opts: {
        stops?: StopCondition[];
        stallMs?: number;
        out?: RecordingOut;
        warn?: (msg: string) => void;
        externalStop?: ExecuteOptions['externalStop'];
    } = {},
): Promise<{ result: TaskResult; recording: Recording | null; recorder: Recorder }> {
    const chunks: Uint8Array[] = [];
    const out: RecordingOut = opts.out ?? { write: b => chunks.push(b), close: () => {} };
    const stops = opts.stops ?? [{ kind: 'xp', skill: 'Woodcutting', amount: 5 * CHOP_XP }];
    const recorder = new Recorder(
        out,
        { task: def.name, ...RUN, params: {}, stops },
        opts.warn ??
            (msg => {
                throw new Error(`unexpected recorder warning: ${msg}`);
            }),
        4096,
    );
    const sinks = recorder.wrap(memorySinks());
    const driver = new LiveDriver(game as unknown as BotSDK, sinks, opts.stallMs ?? 1000, recorder);
    game.start();
    let result: TaskResult;
    try {
        result = await executeTask(def, {
            driver,
            sinks,
            ...RUN,
            botName: RUN.bot,
            rawParams: {},
            stops,
            ...(opts.externalStop && { externalStop: opts.externalStop }),
        });
    } finally {
        driver.close();
        recorder.close();
        game.stop();
    }
    return { result, recording: chunks.length ? parseRecording(Buffer.concat(chunks)) : null, recorder };
}
