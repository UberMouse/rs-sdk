import { describe, expect, test } from 'bun:test';
import {
    interfaceSays,
    interfaceTexts,
    PRESS_CLICK_LIMIT,
    PRESS_EFFECT_TICKS,
    PRESS_READY_TICKS,
    type PressProgress,
    pressComponent,
    type PressSpec,
    resolveComponent,
} from '../../actions/press';
import type { BotAction } from '../../../sdk/types';
import { ROLL_BUTTON, withDice } from '../dice';
import { world } from '../world';
import { refuse, runOp } from './harness';

const spec: PressSpec = { component: 'death_dice:com_28', ready: /^your roll/i, until: /^you (win|lose)/i };
const base = world().build();
/** One state per tick: the table shows `caption(i)`. */
const table = (n: number, caption: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => withDice({ ...base, tick: i }, caption(i)));
const press =
    (progress: PressProgress = { clicked: false }, s: PressSpec = spec) =>
    (ctx: Parameters<typeof pressComponent>[0]) =>
        pressComponent(ctx, s, progress);
const click: BotAction = { type: 'clickComponent', componentId: ROLL_BUTTON, reason: 'click death_dice:com_28' };

describe('press: reading the interface', () => {
    test('texts come from the component dump', () => {
        const s = withDice(base, 'Your roll...');
        expect([...interfaceTexts(s).values()]).toEqual(['', 'Your roll...']);
        expect(interfaceSays(s, /roll/)).toBe('Your roll...');
        expect(interfaceSays(base, /roll/)).toBeUndefined();
    });

    test('a component name resolves to its interface and component ids', () => {
        expect(resolveComponent('death_dice:com_28')).toEqual({ interfaceId: 6675, componentId: ROLL_BUTTON });
        expect(resolveComponent('death_dice:com_9999')).toBeUndefined();
        expect(resolveComponent('nothing_here:com_1')).toBeUndefined();
    });
});

describe('press: pressComponent', () => {
    test('waits for the ready text, clicks once, and returns the text that matched', async () => {
        const states = table(40, i => (i >= 5 ? (i >= 9 ? 'You win!' : 'Your roll...') : 'Harold rolls...'));
        const { result, sends, driver } = await runOp(states, press());
        expect(result).toEqual({ ok: true, text: 'You win!' });
        expect(sends).toEqual([click]);
        expect(driver.state().tick).toBe(9);
    });

    test('no ready text needed: clicks at once', async () => {
        const states = table(20, i => (i >= 3 ? 'You lose!' : 'Harold rolls...'));
        const { result, sends } = await runOp(states, press({ clicked: false }, { ...spec, ready: undefined }));
        expect(result).toEqual({ ok: true, text: 'You lose!' });
        expect(sends).toEqual([click]);
    });

    test('a ready text that never shows is not-ready, with nothing sent', async () => {
        const { result, sends, driver } = await runOp(
            table(60, () => 'Harold rolls...'),
            press(),
        );
        expect(result).toMatchObject({ ok: false, reason: 'not-ready' });
        expect(sends).toEqual([]);
        expect(driver.state().tick).toBe(PRESS_READY_TICKS);
    });

    test('a click with no effect is repeated once, then no-effect', async () => {
        const { result, sends, driver } = await runOp(
            table(80, () => 'Your roll...'),
            press(),
        );
        expect(result).toMatchObject({ ok: false, reason: 'no-effect' });
        expect(sends).toEqual(Array.from({ length: PRESS_CLICK_LIMIT }, () => click));
        expect(driver.state().tick).toBeLessThanOrEqual(PRESS_EFFECT_TICKS * PRESS_CLICK_LIMIT);
    });

    test('the interface closing under the click is closed, not retried', async () => {
        const states = Array.from({ length: 20 }, (_, i) =>
            i < 3 ? withDice({ ...base, tick: i }, 'Your roll...') : { ...base, tick: i },
        );
        const { result, sends } = await runOp(states, press());
        expect(result).toMatchObject({ ok: false, reason: 'closed' });
        expect(sends).toEqual([click]);
    });

    test('a click already sent (a cut-off step) is not sent again', async () => {
        const states = table(20, i => (i >= 2 ? 'You win!' : 'Your roll...'));
        const { result, sends } = await runOp(states, press({ clicked: true }));
        expect(result).toEqual({ ok: true, text: 'You win!' });
        expect(sends).toEqual([]);
    });

    test('the click is recorded before it is sent', async () => {
        const progress = { clicked: false };
        const seen: boolean[] = [];
        await runOp(
            table(20, () => 'Your roll...'),
            press(progress),
            {
                respond: () => {
                    seen.push(progress.clicked);
                    return undefined;
                },
            },
        );
        expect(seen[0]).toBe(true);
    });

    test('a refused click is send-failed and may be sent again', async () => {
        const progress = { clicked: false };
        const { result } = await runOp(
            table(20, () => 'Your roll...'),
            press(progress),
            { respond: refuse },
        );
        expect(result).toMatchObject({ ok: false, reason: 'send-failed' });
        expect(progress.clicked).toBe(false);
    });

    test('another interface open is not-open; an unknown component is no-component', async () => {
        const other = [world().modal(1234).build()];
        expect((await runOp(other, press())).result).toMatchObject({ ok: false, reason: 'not-open' });
        const bad = await runOp(
            table(3, () => ''),
            press({ clicked: false }, { ...spec, component: 'death_dice:com_9999' }),
        );
        expect(bad.result).toMatchObject({ ok: false, reason: 'no-component' });
    });
});
