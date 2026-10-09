import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { MINE_WAIT_TICKS, mine } from '../../actions/mine';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const COPPER = /^copper ore$/i;
const at = { x: 3285, z: 3365 };
const ROCK_ID = 2090;
const quarry = world().loc('Rocks', at.x, at.z, { id: ROCK_ID, options: ['Mine', 'Prospect'] });
const rock = quarry.build().nearbyLocs[0]!;
/** The rock is mined out: the depleted rock (another loc id) stands on its tile. */
const depleted = world().loc('Rocks', at.x, at.z, { id: 450, options: ['Mine', 'Prospect'] });

async function run(states: BotWorldState[], opts: TimelineOptions = {}, target = rock) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(mine(driver, target, COPPER), { driver });
    if (r.kind !== 'returned') throw new Error(`mine did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('mine', () => {
    test('sends Mine on the rock and succeeds once ore arrives', async () => {
        const { result, driver } = await run(quarry.series(10, (w, i) => (i >= 4 ? w.inv('Copper ore', 1) : w)));
        expect(result).toEqual({ ok: true });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: {
                    type: 'interactLoc',
                    x: at.x,
                    z: at.z,
                    locId: ROCK_ID,
                    optionIndex: 1,
                    reason: 'Mine Rocks',
                },
            },
        ]);
        expect(driver.state().tick).toBe(4);
    });

    test('ore gained as the rock depletes is still a success', async () => {
        const { result } = await run(quarry.series(10, (w, i) => (i >= 3 ? depleted.inv('Copper ore', 1).tick(i) : w)));
        expect(result).toEqual({ ok: true });
    });

    test('the rock changing with no ore gained is a rock mined out by someone else', async () => {
        const { result } = await run(quarry.series(10, (w, i) => (i >= 3 ? depleted.tick(i) : w)));
        expect(result).toEqual({
            ok: false,
            reason: 'rock-gone',
            message: 'rock at (3285,3365) was mined out by someone else',
        });
    });

    test('ore already carried, or another ore, is not a mine', async () => {
        const carrying = quarry.inv('Copper ore', 3);
        const { result } = await run(
            carrying.series(10, (w, i) => (i >= 3 ? depleted.inv('Copper ore', 3).inv('Tin ore', 1).tick(i) : w)),
        );
        expect(result.ok === false && result.reason).toBe('rock-gone');
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(quarry.series(1));
        expect(result).toEqual({ ok: false, reason: 'timeout', message: 'timed out waiting for ore from rock' });
        expect(driver.state().tick).toBe(MINE_WAIT_TICKS);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(quarry.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('a rock with no Mine option is no-option, and nothing is sent', async () => {
        const bare = world().loc('Rocks', at.x, at.z, { id: ROCK_ID, options: ['Prospect'] });
        const { result, driver } = await run(bare.series(1), {}, bare.build().nearbyLocs[0]!);
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'no /^mine$/i option on Rocks' });
        expect(driver.commands).toEqual([]);
    });
});
