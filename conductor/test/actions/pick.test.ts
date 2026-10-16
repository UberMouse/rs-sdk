import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { PICK_WAIT_TICKS, pick } from '../../actions/pick';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const FLAX = /^flax$/i;
const at = { x: 2740, z: 3440 };
const field = world().loc('Flax', at.x, at.z, { id: 2646, options: ['Pick'] });
const flax = field.build().nearbyLocs[0]!;
/** The flax is gone (picked bare: the loc is deleted for a while). */
const bare = world();

async function run(states: BotWorldState[], opts: TimelineOptions = {}, target = flax) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(pick(driver, target, FLAX), { driver });
    if (r.kind !== 'returned') throw new Error(`pick did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('pick', () => {
    test('sends Pick on the loc and succeeds once the item arrives', async () => {
        const { result, driver } = await run(field.series(10, (w, i) => (i >= 3 ? w.inv('Flax', 1) : w)));
        expect(result).toEqual({ ok: true });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: { type: 'interactLoc', x: at.x, z: at.z, locId: 2646, optionIndex: 1, reason: 'Pick Flax' },
            },
        ]);
        expect(driver.state().tick).toBe(3);
    });

    test('the flax going with the item gained is still a success', async () => {
        const { result } = await run(field.series(10, (w, i) => (i >= 3 ? bare.inv('Flax', 1).tick(i) : w)));
        expect(result).toEqual({ ok: true });
    });

    test('the loc going with nothing gained is gone', async () => {
        const { result } = await run(field.series(10, (w, i) => (i >= 3 ? bare.tick(i) : w)));
        expect(result).toEqual({
            ok: false,
            reason: 'gone',
            message: 'Flax at (2740,3440) was gone before it was picked',
        });
    });

    test('flax already carried is not a pick', async () => {
        const carrying = field.inv('Flax', 4);
        const { result } = await run(carrying.series(10, (w, i) => (i >= 3 ? bare.inv('Flax', 4).tick(i) : w)));
        expect(result.ok === false && result.reason).toBe('gone');
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(field.series(1));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'timed out waiting for Flax to be picked' });
        expect(driver.state().tick).toBe(PICK_WAIT_TICKS);
    });

    test('a loc with no Pick option is no-option, and nothing is sent', async () => {
        const stump = world()
            .loc('Flax', at.x, at.z, { id: 2646, options: ['Examine'] })
            .build().nearbyLocs[0]!;
        const { result, driver } = await run(field.series(1), {}, stump);
        expect(result.ok === false && result.reason).toBe('no-option');
        expect(driver.commands).toEqual([]);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(field.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});
