import { describe, expect, test } from 'bun:test';
import {
    ALPHABET,
    CONFIRM_WAIT_TICKS,
    type LockProgress,
    readWheels,
    solveCombolock,
    WHEEL_WAIT_TICKS,
    wheelClicks,
    wordValues,
} from '../../actions/combolock';
import { TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { type LockKind, lockReact, PEER_LOCK, SOLVED_MESSAGE, TRIBAL_LOCK, withLock, withoutLock } from '../lock';
import { world } from '../world';

interface RunOptions {
    lock?: LockKind;
    start?: number[];
    answer?: string;
    react?: Partial<Parameters<typeof lockReact>[0]>;
    progress?: LockProgress;
    ticks?: number;
}

async function run(word: string, opts: RunOptions = {}) {
    const lock = opts.lock ?? PEER_LOCK;
    const sim = lockReact({ lock, start: opts.start, answer: opts.answer ?? word, ...opts.react });
    const open = withLock(world().build(), lock, opts.start ?? [0, 0, 0, 0]);
    const driver = new TimelineDriver(
        Array.from({ length: opts.ticks ?? 400 }, (_, tick) => ({ ...open, tick })),
        { react: sim.react },
    );
    const progress = opts.progress ?? { confirmCursor: null };
    const r = await interpret(solveCombolock(driver, word, progress), { driver });
    if (r.kind !== 'returned') throw new Error(`solveCombolock did not return: ${JSON.stringify(r)}`);
    return { result: r.value, sim, driver, progress };
}

describe('wheelClicks', () => {
    test('goes the short way round, up on a tie', () => {
        expect(wheelClicks(0, 3)).toBe(3);
        expect(wheelClicks(0, 22)).toBe(-4);
        expect(wheelClicks(25, 0)).toBe(1);
        expect(wheelClicks(0, 25)).toBe(-1);
        expect(wheelClicks(0, 13)).toBe(13);
        expect(wheelClicks(13, 0)).toBe(13);
        expect(wheelClicks(5, 5)).toBe(0);
        for (let a = 0; a < ALPHABET; a++)
            for (let b = 0; b < ALPHABET; b++) {
                expect(Math.abs(wheelClicks(a, b))).toBeLessThanOrEqual(13);
                expect((a + wheelClicks(a, b) + 52) % ALPHABET).toBe(b);
            }
    });

    test('a word is four letters, A=0', () => {
        expect(wordValues('mind')).toEqual([12, 8, 13, 3]);
        expect(wordValues('KURT')).toEqual([10, 20, 17, 19]);
        expect(wordValues('abc')).toBeUndefined();
        expect(wordValues('abc1')).toBeUndefined();
    });
});

describe('solveCombolock', () => {
    test.each([
        ['MIND', 'up12'],
        ['TREE', 'down7'],
        ['LIFE', 'up11'],
        ['FIRE', 'up5'],
        ['TIME', 'down7'],
        ['WIND', 'down4'],
    ])('%s from AAAA: the fewest clicks, then the confirm', async (word, first) => {
        const { result, sim } = await run(word);
        expect(result.ok).toBe(true);
        expect(sim.wheels.map(v => String.fromCharCode(65 + v)).join('')).toBe(word);
        expect(sim.clicks.at(-1)).toBe('confirm');
        // Wheel 1 is clicked first, the whole way, in one direction.
        const wheel1 = sim.clicks.filter(c => /^(up|down)0$/.test(c));
        expect(`${wheel1[0]!.replace(/0$/, '')}${wheel1.length}`).toBe(first);
        const total = [...word].reduce((n, c) => n + Math.abs(wheelClicks(0, c.charCodeAt(0) - 65)), 0);
        expect(sim.clicks.length).toBe(total + 1);
    });

    test('wraps: Z to A and A to Z are one click', async () => {
        const { sim } = await run('AZAZ', { start: [25, 0, 25, 0] });
        expect(sim.clicks).toEqual(['up0', 'down1', 'up2', 'down3', 'confirm']);
    });

    test('works on the tribal door interface too', async () => {
        const { result, sim, driver } = await run('KURT', { lock: TRIBAL_LOCK });
        expect(result).toEqual({ ok: true, message: `KURT: ${SOLVED_MESSAGE.tribal_door2}` });
        expect(sim.wheels).toEqual([10, 20, 17, 19]);
        expect(driver.commands.some(c => c.type === 'send' && c.action.type === 'clickComponent')).toBe(true);
    });

    test('a lock that is partly set (a cut-off run) is finished from where it stands', async () => {
        const { result, sim } = await run('MIND', { start: [12, 8, 10, 0] });
        expect(result.ok).toBe(true);
        expect(sim.clicks).toEqual(['up2', 'up2', 'up2', 'up3', 'up3', 'up3', 'confirm']);
    });

    test('a click made before the cut-off that overshot is undone the short way', async () => {
        const { sim } = await run('MIND', { start: [13, 8, 13, 3] });
        expect(sim.clicks).toEqual(['down0', 'confirm']);
    });

    test('the lock refusing the word fails wrong, naming the message', async () => {
        const { result } = await run('MIND', { answer: 'TREE' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('wrong');
        expect(result.message).toContain('You have failed to solve the riddle.');
    });

    test('an ignored click is retried once; a wheel that never moves fails no-effect', async () => {
        const once = await run('BAAA', { react: { ignoreFirst: 1 } });
        expect(once.result.ok).toBe(true);
        expect(once.sim.clicks).toEqual(['up0', 'up0', 'confirm']);
        const dead = await run('BAAA', { react: { deadWheels: [0] } });
        expect(dead.result.ok).toBe(false);
        if (dead.result.ok) return;
        expect(dead.result.reason).toBe('no-effect');
        expect(dead.result.message).toContain('wheel 1 stayed on A');
        // The lock is closed behind the failure: an open lock would hide the inventory.
        expect(dead.sim.clicks).toEqual(['up0', 'up0', 'close']);
        expect(dead.driver.state().tick).toBe(2 * WHEEL_WAIT_TICKS + 1);
    });

    test('a confirm the game ignores fails no-effect after its wait', async () => {
        const { result, driver, sim } = await run('AAAA', { react: { deadConfirm: true } });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('no-effect');
        expect(result.message).toContain('stayed open');
        expect(driver.state().tick).toBe(CONFIRM_WAIT_TICKS + 1);
        expect(sim.clicks.at(-1)).toBe('close');
    });

    test('no lock open: not-open; a bad word: bad-word', async () => {
        const closed = world().build();
        const driver = new TimelineDriver([closed]);
        const r = await interpret(solveCombolock(driver, 'MIND', { confirmCursor: null }), { driver });
        expect(r.kind === 'returned' && !r.value.ok && r.value.reason).toBe('not-open');
        const bad = await interpret(solveCombolock(driver, 'MI', { confirmCursor: null }), { driver });
        expect(bad.kind === 'returned' && !bad.value.ok && bad.value.reason).toBe('bad-word');
    });

    test('a lock with no readable letters is unreadable: no arrow is clicked, the lock is closed', async () => {
        const open = withLock(world().build(), PEER_LOCK, ['?', 'A', 'A', 'A']);
        const sim = lockReact({ lock: PEER_LOCK, answer: 'MIND' });
        const driver = new TimelineDriver([open], { react: sim.react });
        const r = await interpret(solveCombolock(driver, 'MIND', { confirmCursor: null }), { driver });
        expect(r.kind === 'returned' && !r.value.ok && r.value.reason).toBe('unreadable');
        // No arrow was clicked; the lock was only closed again.
        expect(sim.clicks).toEqual(['close']);
        const noDump = { ...open, interface: { ...open.interface, debugInfo: undefined } };
        expect(readWheels(noDump)).toEqual([undefined, undefined, undefined, undefined]);
    });

    test('the lock closing under the clicks fails closed', async () => {
        const open = withLock(world().build(), PEER_LOCK, [0, 0, 0, 0]);
        const states = [open, open, open, withoutLock(open)];
        const driver = new TimelineDriver(states);
        const r = await interpret(solveCombolock(driver, 'MIND', { confirmCursor: null }), { driver });
        expect(r.kind === 'returned' && !r.value.ok && r.value.reason).toBe('closed');
    });

    test('a call that resumes after the confirm was sent reads the verdict without clicking', async () => {
        const closed = world().tick(5).message(SOLVED_MESSAGE.combolockdoor).build();
        const driver = new TimelineDriver([closed]);
        const r = await interpret(solveCombolock(driver, 'MIND', { confirmCursor: 3 }), { driver });
        expect(r.kind === 'returned' && r.value.ok).toBe(true);
        expect(driver.commands.filter(c => c.type === 'send')).toEqual([]);
    });

    test('the cursor is recorded before the confirm is sent', async () => {
        const { progress } = await run('AAAA');
        expect(progress.confirmCursor).not.toBeNull();
    });
});
