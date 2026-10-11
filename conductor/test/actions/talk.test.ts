import { describe, expect, test } from 'bun:test';
import {
    converse,
    MAX_CLICKS,
    PAGE_STALL_LIMIT,
    REOPEN_GRACE_TICKS,
    startTalk,
    TALK_OPEN_TICKS,
    type TalkProgress,
} from '../../actions/talk';
import { type Page, dialogScript } from '../dialog-script';
import { world } from '../world';
import { refuse, runOp } from './harness';

const base = world();
/** The conversation already open on its first page. */
const open = (page: Page) => base.dialog({ text: 'page 0', options: page ?? [] }).series(3);
const run = async (pages: Page[], choices: RegExp[], progress: TalkProgress = { answered: 0 }) => {
    const script = dialogScript(pages, () => false, 1);
    // Show page 0 as the first state, then let clicks move on.
    const r = await runOp(open(pages[0] ?? null), ctx => converse(ctx, choices, progress), {
        react: (a, s) => (a.type === 'clickDialogOption' ? script.react(a, s) : undefined),
    });
    return { ...r, progress };
};
const clickIndexes = (sends: { type: string; optionIndex?: number }[]) =>
    sends.filter(s => s.type === 'clickDialogOption').map(s => s.optionIndex);

const page = (i: number, tick: number) =>
    base
        .tick(tick)
        .dialog({ text: `p${i}`, options: [] })
        .build();
const closed = (tick: number) => base.tick(tick).build();

describe('converse', () => {
    test('clicks continue pages, answers the choice by its text, and is done when the dialog closes', async () => {
        // Pages: continue, choice (B is the second option), continue, closed.
        const { result, sends, progress } = await run([[], ['A one', 'B two', 'C three'], [], null], [/^B/]);
        // The scripted script starts counting at the first click: its page 0 is the one already shown.
        expect(result).toEqual({ ok: true, answered: 1 });
        expect(progress.answered).toBe(1);
        expect(clickIndexes(sends)).toEqual([0, 1, 0]);
    });

    test('colour tags are not part of the option text', async () => {
        const { result } = await run([['@blu@Yes, ok.@bla@', 'No'], null], [/^yes/i]);
        expect(result).toEqual({ ok: true, answered: 1 });
    });

    test('several choices are answered in order', async () => {
        const { result, sends } = await run([['x1', 'y1'], [], ['x2', 'y2'], null], [/y1/, /x2/]);
        expect(result).toEqual({ ok: true, answered: 2 });
        expect(clickIndexes(sends)).toEqual([1, 0, 0]);
    });

    test('a missing option fails naming the options on offer, and clicks nothing', async () => {
        const { result, sends } = await run([['Alpha', 'Beta']], [/gamma/]);
        expect(result).toEqual({
            ok: false,
            reason: 'missing-option',
            message: 'no option matching /gamma/ (choice 1 of 1); the dialog offers "Alpha" | "Beta"',
        });
        expect(clickIndexes(sends)).toEqual([]);
    });

    test('a choice after the last was answered is unexpected', async () => {
        const { result } = await run([['a', 'b'], [], ['c', 'd']], [/a/]);
        expect(result).toMatchObject({ ok: false, reason: 'unexpected-choice' });
        expect(result.ok ? '' : result.message).toBe('a choice came after all 1 were answered: "c" | "d"');
    });

    test('the dialog closing with choices left fails closed-early', async () => {
        const { result } = await run([[], null], [/a/]);
        expect(result).toEqual({
            ok: false,
            reason: 'closed-early',
            message: 'the dialog closed after 0 of 1 choices (next: /a/)',
        });
    });

    test('a conversation with no choices ends when the dialog closes', async () => {
        const { result, sends } = await run([[], [], null], []);
        expect(result).toEqual({ ok: true, answered: 0 });
        expect(clickIndexes(sends)).toEqual([0, 0]);
    });

    test('progress from an earlier call skips the choices already answered', async () => {
        const { result } = await run([['b1', 'b2'], null], [/a/, /b2/], { answered: 1 });
        expect(result).toEqual({ ok: true, answered: 2 });
    });

    test('a refused click is send-failed', async () => {
        const r = await runOp(open([]), ctx => converse(ctx, [], { answered: 0 }), { respond: refuse });
        expect(r.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('a page that never moves is stuck after PAGE_STALL_LIMIT clicks', async () => {
        const r = await runOp(open([]), ctx => converse(ctx, [], { answered: 0 }));
        expect(r.result).toMatchObject({ ok: false, reason: 'stuck' });
        expect(clickIndexes(r.sends)).toHaveLength(PAGE_STALL_LIMIT);
    });

    test('a choice that does not move on is stuck at once', async () => {
        const r = await runOp(open(['a', 'b']), ctx => converse(ctx, [/a/], { answered: 0 }));
        expect(r.result).toMatchObject({ ok: false, reason: 'stuck' });
        expect(clickIndexes(r.sends)).toHaveLength(1);
    });

    test('a dialog closed for a tick or two between pages is not the end', async () => {
        // A page with no option published waits OPTION_APPEAR_TICKS for one before the bare click.
        const states = [0, 1, 2]
            .map(t => page(0, t))
            .concat(
                [3, 4].map(closed),
                [5, 6, 7].map(t => page(1, t)),
                [closed(8)],
            );
        const r = await runOp(states, ctx => converse(ctx, [], { answered: 0 }));
        expect(r.result).toEqual({ ok: true, answered: 0 });
        expect(clickIndexes(r.sends)).toHaveLength(2);
    });

    test('a dialog that stays closed REOPEN_GRACE_TICKS ends the conversation at that tick', async () => {
        const r = await runOp([open([])[0]!, base.tick(1).build(), base.tick(2).build()], ctx =>
            converse(ctx, [], { answered: 0 }),
        );
        expect(r.result).toEqual({ ok: true, answered: 0 });
        expect(REOPEN_GRACE_TICKS).toBeGreaterThan(0);
    });

    test('a conversation is cut off at MAX_CLICKS', async () => {
        const pages: Page[] = Array.from({ length: MAX_CLICKS + 20 }, () => []);
        const script = dialogScript(pages, () => false, 1);
        const r = await runOp(open([]), ctx => converse(ctx, [], { answered: 0 }), { react: script.react });
        expect(r.result).toMatchObject({ ok: false, reason: 'stuck' });
        expect(clickIndexes(r.sends)).toHaveLength(MAX_CLICKS);
    });
});

describe('startTalk', () => {
    const duke = base.npc('Duke Horacio', 3211, 3220, { index: 9, options: ['Talk-to'] });
    const npc = duke.build().nearbyNpcs[0]!;

    test('sends Talk-to (option 1) and is ok once the dialog opens', async () => {
        const script = dialogScript([[]]);
        const r = await runOp(duke.series(10), ctx => startTalk(ctx, npc), { react: script.react });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends).toEqual([{ type: 'interactNpc', npcIndex: 9, optionIndex: 1, reason: 'Talk-to Duke Horacio' }]);
    });

    test('another option can start the conversation', async () => {
        const shop = base.npc('Aubury', 3253, 3402, { index: 4, options: ['Talk-to', 'Trade'] });
        const aubury = shop.build().nearbyNpcs[0]!;
        const r = await runOp(shop.series(10), ctx => startTalk(ctx, aubury, /^trade$/i), {
            react: dialogScript([[]]).react,
        });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends[0]).toMatchObject({ optionIndex: 2 });
    });

    test('an NPC without the option is no-option and nothing is sent', async () => {
        const r = await runOp(duke.series(3), ctx => startTalk(ctx, npc, /^trade$/i));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-option' });
        expect(r.sends).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const r = await runOp(duke.series(3), ctx => startTalk(ctx, npc), { respond: refuse });
        expect(r.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('the server\'s "I can\'t reach that!" is cant-reach', async () => {
        const r = await runOp(
            duke.series(10, (w, i) => (i >= 2 ? w.message("I can't reach that!") : w)),
            ctx => startTalk(ctx, npc),
        );
        expect(r.result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Duke Horacio' });
    });

    test('the NPC leaving view is target-gone', async () => {
        const r = await runOp([duke.tick(0).build(), base.tick(1).build()], ctx => startTalk(ctx, npc));
        expect(r.result).toEqual({ ok: false, reason: 'target-gone', message: 'Duke Horacio left view' });
    });

    test('no dialog within TALK_OPEN_TICKS is a timeout', async () => {
        const r = await runOp(duke.series(1), ctx => startTalk(ctx, npc));
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(r.driver.state().tick).toBe(TALK_OPEN_TICKS);
    });
});
