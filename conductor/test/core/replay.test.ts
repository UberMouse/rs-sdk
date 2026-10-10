import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { z } from 'zod/v4';
import type { BotWorldState } from '../../../sdk/types';
import {
    parseRecording,
    type Rec,
    type Recording,
    RECORDING_VERSION,
    StateDecoder,
} from '../../core/drivers/recording';
import { LOOKAHEAD_TICKS } from '../../core/drivers/replay';
import { send, ticks } from '../../core/op';
import { replayRun } from '../../lib/replay';
import { defineTask } from '../../lib/task';
import { worldState } from '../world';
import {
    CHOP_XP,
    chopper,
    type ChopperVariant,
    FakeGame,
    type FakeGameOptions,
    logsOf,
    recordRun,
    RUN,
} from './fake-game';

/** Logs held in the last recorded state of `tick`. */
function logsAt(recording: Recording, tick: number): number {
    const decoder = new StateDecoder();
    let last: BotWorldState | null = null;
    for (const r of recording.records) {
        if (r.k !== 'p') continue;
        const s = decoder.decode(r.d, r.x);
        if (s.tick === tick) last = s;
    }
    if (!last) throw new Error(`no state of tick ${tick} in the recording`);
    return logsOf(last);
}

/** The tick the recording sent its `nth` (0-based) send of `type` on. */
function sendTick(recording: Recording, type: string, nth = 0): number {
    const sent = recording.records.flatMap(r =>
        r.k === 'c' && r.cmd.type === 'send' && r.cmd.action.type === type ? [r.tick] : [],
    );
    const tick = sent[nth];
    if (tick === undefined) throw new Error(`no ${type} #${nth} in the recording`);
    return tick;
}

async function recorded(opts: FakeGameOptions = {}, variant: ChopperVariant = {}) {
    const { result, recording } = await recordRun(chopper(variant), new FakeGame(opts));
    if (!recording) throw new Error('nothing recorded');
    return { result, recording };
}

const CHOP = 'send interactLoc (Chop down Tree)';

/** A phase's `until`, as a plan hands it to the engine. */
const untilTwoLogs = (s: BotWorldState) => (logsOf(s) >= 2 ? 'until: 2 logs' : null);

describe('replay of a recorded run', () => {
    test('unchanged code replays with no divergence, to the same result', async () => {
        const { result, recording } = await recorded({ revisions: true, refuseChop: n => n === 2 }, { scans: true });
        expect(result.status).toBe('done');
        expect(recording.truncated).toBe(false);
        const report = await replayRun(recording, chopper({ scans: true }));
        expect(report.divergence).toBeNull();
        // The whole result, duration included: the replay reads the recorded clock too.
        expect(report.replayed).toEqual(result);
        expect('partOf' in report.replayed).toBe(false);
        expect(report.matched).toBe(recording.records.filter(r => r.k === 'c').length);
        expect(report.recorded).toEqual({ status: result.status, reason: result.reason });
    });

    test('a run that ends stuck on a stalled client replays to the same end', async () => {
        const { result, recording } = await recordRun(chopper(), new FakeGame({ lastTick: 110 }), { stallMs: 50 });
        expect(result.status).toBe('stuck');
        const report = await replayRun(recording!, chopper());
        expect(report.divergence).toBeNull();
        expect(report.replayed).toEqual(result);
    });

    test('a phase run an external stop ended replays to the same end and result, from its stop record', async () => {
        const { result, recording } = await recordRun(chopper(), new FakeGame(), {
            externalStop: untilTwoLogs,
            partOf: 'plan-run-1',
        });
        expect(result).toMatchObject({ status: 'done', reason: 'until: 2 logs', partOf: 'plan-run-1' });
        expect(recording!.header.run.partOf).toBe('plan-run-1');
        const stops = recording!.records.flatMap(r => (r.k === 'stop' ? [r] : []));
        expect(stops).toEqual([
            { k: 'stop', tick: expect.any(Number), check: expect.any(Number), reason: 'until: 2 logs' },
        ]);
        const stopTick = stops[0]!.tick;
        expect(logsAt(recording!, stopTick)).toBe(2);

        const report = await replayRun(recording!, chopper());
        expect(report.divergence).toBeNull();
        expect(report.replayed).toEqual(result);

        // Without the record the replay runs on past the recorded end and chops again.
        const unstopped = { ...recording!, records: recording!.records.filter(r => r.k !== 'stop') };
        const ran = await replayRun(unstopped, chopper());
        expect(ran.divergence).toMatchObject({ kind: 'extra' });
        expect(ran.divergence?.expected).toBe('no command; the run ended (done: until: 2 logs)');
    });

    test('a changed decision is reported where the recorded run decided otherwise', async () => {
        const { recording } = await recorded();
        // Recorded: drop at 3 logs. Changed: drop at 2, so it drops where the recording chopped a third time.
        const report = await replayRun(recording, chopper({ dropAt: 2 }));
        const at2 = sendTick(recording, 'interactLoc', 2);
        expect(logsAt(recording, at2)).toBe(2);
        expect(report.divergence).toMatchObject({ kind: 'different', tick: at2 });
        expect(report.divergence?.expected).toStartWith(`${CHOP} {"locId":`);
        expect(report.divergence?.expected).toEndWith(`at tick ${at2}`);
        expect(report.divergence?.got).toStartWith('send dropItem (drop Logs) {"slot":');
        // Two chops matched before it.
        expect(report.matched).toBe(2);
    });

    test('a command the recorded run did not send is extra', async () => {
        const { recording } = await recorded();
        const report = await replayRun(recording, chopper({ peekAfterFirstChop: true }));
        const chopped = sendTick(recording, 'interactLoc');
        expect(report.divergence).toMatchObject({
            kind: 'extra',
            tick: chopped + 1,
            got: `send none (peek) at tick ${chopped + 1}`,
        });
        expect(report.divergence?.expected).toStartWith(`no command; next ${CHOP}`);
    });

    test('a command sent a tick late is a tick divergence', async () => {
        const { recording } = await recorded();
        const report = await replayRun(recording, chopper({ hesitateAt: 1 }));
        const second = sendTick(recording, 'interactLoc', 1);
        expect(report.divergence).toMatchObject({ kind: 'tick', tick: second + 1 });
        expect(report.divergence?.expected).toEndWith(`at tick ${second}`);
        expect(report.divergence?.got).toEndWith(`at tick ${second + 1}`);
    });

    test('a command the replay never sends is missing, also when its run ends first', async () => {
        const { recording } = await recorded();
        const ended = await replayRun(recording, chopper({ enoughAt: 2 }));
        const at2 = sendTick(recording, 'interactLoc', 2);
        expect(ended.divergence).toMatchObject({
            kind: 'missing',
            tick: at2,
            got: `the run ended (done: enough logs) at tick ${at2}`,
        });
        expect(ended.divergence?.expected).toEndWith(`at tick ${at2}`);

        // Waiting it out: missing once the recorded run ends, or LOOKAHEAD_TICKS on, without it.
        const stall = defineTask({
            ...chopper(),
            steps: [
                {
                    name: 'idle',
                    when: () => true,
                    *run() {
                        yield* ticks(1000);
                    },
                },
            ],
        });
        const first = sendTick(recording, 'interactLoc');
        const short = await replayRun(recording, stall);
        // Looking ahead it gets the recorded world, chops included, so its own stop may end it first.
        expect(short.divergence?.kind).toBe('missing');
        expect(short.divergence?.got).toMatch(/^(no command before the recorded run ended|the run ended \(done: )/);
        expect(short.divergence?.expected).toEndWith(`at tick ${first}`);

        const long = await recordRun(chopper(), new FakeGame(), {
            stops: [{ kind: 'xp', skill: 'Woodcutting', amount: 15 * CHOP_XP }],
        });
        const longFirst = sendTick(long.recording!, 'interactLoc');
        const capped = await replayRun(long.recording!, stall);
        const tick = longFirst + LOOKAHEAD_TICKS + 1;
        expect(capped.divergence).toMatchObject({ kind: 'missing', tick, got: `no command by tick ${tick}` });
    });
});

/** A recording written by hand: a header, then `records`. */
function handmade(records: Rec[]): Recording {
    const run = { task: 'test', ...RUN, params: {}, stops: [] };
    const lines = [{ k: 'h', v: RECORDING_VERSION, run, at: 1000 }, ...records].map(r => JSON.stringify(r));
    return parseRecording(gzipSync(lines.join('\n') + '\n'));
}

const initial = (): Rec => ({ k: 'p', d: { ...worldState(5) } });

/** Sends `act`, fails with the answer's message when it is refused. */
const actOnce = defineTask({
    name: 'test',
    description: 'replay test',
    params: z.object({}),
    steps: [
        {
            name: 'act',
            when: () => true,
            *run() {
                const r = yield* send({ type: 'none', reason: 'act' });
                return r.success ? { done: 'acted' } : { fail: r.message };
            },
        },
    ],
});

describe('the replay driver', () => {
    test('answers commands from the recording: a send result and a screenshot path', async () => {
        const recording = handmade([
            initial(),
            { k: 'c', id: 0, tick: 5, cmd: { type: 'send', action: { type: 'none', reason: 'act' } } },
            { k: 'r', id: 0, v: { success: false, message: 'refused live' } },
            { k: 'c', id: 1, tick: 5, cmd: { type: 'screenshot', label: 'test-failed' } },
            { k: 'r', id: 1, v: '/shots/live.png' },
            { k: 'end', status: 'failed', reason: 'act: refused live' },
        ]);
        const report = await replayRun(recording, actOnce);
        expect(report.divergence).toBeNull();
        expect(report.replayed.status).toBe('failed');
        expect(report.replayed.reason).toBe('act: refused live');
        expect(report.replayed.screenshots).toEqual(['/shots/live.png']);
    });

    test('the same commands ending another way is an outcome divergence', async () => {
        const recording = handmade([
            initial(),
            { k: 'c', id: 0, tick: 5, cmd: { type: 'send', action: { type: 'none', reason: 'act' } } },
            { k: 'r', id: 0, v: { success: true, message: 'ok' } },
            { k: 'end', status: 'done', reason: 'act: acted differently' },
        ]);
        const report = await replayRun(recording, actOnce);
        expect(report.divergence).toEqual({
            kind: 'outcome',
            tick: 5,
            expected: 'the run ended (done: act: acted differently)',
            got: 'the run ended (done: act: acted) at tick 5',
        });
    });

    test('a recording without a result (a killed run) replays to its end with no divergence', async () => {
        const recording = handmade([
            initial(),
            { k: 'c', id: 0, tick: 5, cmd: { type: 'send', action: { type: 'none', reason: 'act' } } },
        ]);
        expect(recording.truncated).toBe(true);
        const report = await replayRun(recording, actOnce);
        expect(report.divergence).toBeNull();
        expect(report.exhausted).toBe(true);
        expect(report.recorded).toBeNull();
    });
});
