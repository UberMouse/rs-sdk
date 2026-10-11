import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { FILL_WAIT_TICKS, fillContainer } from '../../actions/fill';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const at = { x: 3221, z: 3210 };
const BUCKET = 1925;
const FULL = 1929;
const start = world()
    .inv('Bucket', 2, { id: BUCKET })
    .loc('Fountain', at.x, at.z, { options: ['Use'] });
const fountain = start.build().nearbyLocs[0]!;
const bucket = start.build().inventory[0]!;
/** One bucket filled in place. */
const filled = start.inv('Bucket', 1, { id: BUCKET }).inv('Bucket of water', 1, { id: FULL });

async function run(states: BotWorldState[], opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(fillContainer(driver, bucket, fountain), { driver });
    if (r.kind !== 'returned') throw new Error(`fillContainer did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('fillContainer', () => {
    test('uses the container on the source and succeeds once one fewer is held', async () => {
        const { result, driver } = await run(start.series(10, (w, i) => (i >= 2 ? filled : w)));
        expect(result).toEqual({ ok: true });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: {
                    type: 'useItemOnLoc',
                    itemSlot: bucket.slot,
                    x: at.x,
                    z: at.z,
                    locId: fountain.id,
                    reason: 'use Bucket on Fountain',
                },
            },
        ]);
        expect(driver.ticksElapsed).toBe(2);
    });

    test('an "I can\'t reach that!" message is cant-reach', async () => {
        const { result } = await run(start.series(10, (w, i) => (i >= 2 ? w.message("I can't reach that!") : w)));
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Fountain' });
    });

    test('"nothing interesting happens" is nothing-happened', async () => {
        const { result } = await run(
            start.series(10, (w, i) => (i >= 2 ? w.message('Nothing interesting happens.') : w)),
        );
        expect(result).toEqual({ ok: false, reason: 'nothing-happened', message: 'Nothing interesting happens.' });
    });

    test('a message from before the use is not an answer to it', async () => {
        const { result } = await run(start.message("I can't reach that!").series(1));
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('no change within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(start.series(1));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Timeout filling Bucket at Fountain',
        });
        expect(driver.state().tick).toBe(FILL_WAIT_TICKS);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(start.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});
