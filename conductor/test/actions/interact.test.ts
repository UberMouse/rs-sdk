import { describe, expect, test } from 'bun:test';
import type { NearbyLoc } from '../../../sdk/types';
import { interactLoc } from '../../actions/interact';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const base = world().loc('Bank booth', 3208, 3220, { options: ['Use', 'Use-quickly'] });
const booth = base.build().nearbyLocs[0]!;

async function run(loc: NearbyLoc, option: number | RegExp, opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(base.series(1), opts);
    const r = await interpret(interactLoc(loc, option), { driver });
    if (r.kind !== 'returned') throw new Error(`interactLoc did not return: ${JSON.stringify(r)}`);
    return { result: r.value, sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : [])) };
}

describe('interactLoc', () => {
    test('a pattern picks the option index from the texts the loc publishes', async () => {
        const { result, sends } = await run(booth, /quickly/i);
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            {
                type: 'interactLoc',
                x: 3208,
                z: 3220,
                locId: booth.id,
                optionIndex: 2,
                reason: 'Use-quickly Bank booth',
            },
        ]);
    });

    test('an index is sent as given, published or not', async () => {
        expect((await run(booth, 1)).sends[0]).toMatchObject({ optionIndex: 1, reason: 'Use Bank booth' });
        expect((await run(booth, 4)).sends[0]).toMatchObject({ optionIndex: 4, reason: 'op 4 Bank booth' });
    });

    test('a pattern no option matches sends nothing', async () => {
        const { result, sends } = await run(booth, /^chop/i);
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'no /^chop/i option on Bank booth' });
        expect(sends).toEqual([]);
    });

    test('a refused send is send-failed with its message', async () => {
        const { result } = await run(booth, 1, { respond: () => ({ success: false, message: 'not connected' }) });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});
