import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { CHOP_WAIT_TICKS, chop } from '../../actions/chop';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const LOGS = /^Logs$/i;
const at = { x: 3224, z: 3220 };
const forest = world().loc('Tree', at.x, at.z, { options: ['Chop down'] });
const tree = forest.build().nearbyLocs[0]!;
/** The tree has fallen: a stump (another loc id) stands on its tile. */
const stump = world().loc('Tree stump', at.x, at.z, { id: 1342 });

async function run(states: BotWorldState[], opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(chop(driver, tree, LOGS), { driver });
    if (r.kind !== 'returned') throw new Error(`chop did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('chop', () => {
    test('sends Chop down on the tree and succeeds once a log arrives', async () => {
        const { result, driver } = await run(forest.series(10, (w, i) => (i >= 4 ? w.inv('Logs', 1) : w)));
        expect(result).toEqual({ ok: true });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: {
                    type: 'interactLoc',
                    x: at.x,
                    z: at.z,
                    locId: tree.id,
                    optionIndex: 1,
                    reason: 'Chop down Tree',
                },
            },
        ]);
        expect(driver.state().tick).toBe(4);
    });

    test('the tree falling with no log gained is a tree felled by someone else', async () => {
        const { result } = await run(forest.series(10, (w, i) => (i >= 3 ? stump.tick(i) : w)));
        expect(result).toEqual({
            ok: false,
            reason: 'felled-by-other',
            message: 'Tree was felled by someone else',
        });
    });

    test('logs already carried, or logs of another tree, are not a chop', async () => {
        const carrying = forest.inv('Logs', 3);
        const { result } = await run(
            carrying.series(10, (w, i) => (i >= 3 ? stump.inv('Logs', 3).inv('Oak logs', 1).tick(i) : w)),
        );
        expect(result.ok === false && result.reason).toBe('felled-by-other');
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(forest.series(1));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'timed out waiting for logs from Tree' });
        expect(driver.state().tick).toBe(CHOP_WAIT_TICKS);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(forest.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});
