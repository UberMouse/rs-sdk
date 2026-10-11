import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { OBSTACLE_SETTLE_TICKS, OBSTACLE_WAIT_TICKS, obstacle } from '../../actions/obstacle';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const at = { x: 2474, z: 3435 };
const start = world()
    .player({ at: { x: 2474, z: 3436 } })
    .skill('Agility', 1, 0);
const across = start.loc('Log balance', at.x, at.z, { options: ['Walk-across'], id: 2295 });
const log = across.build().nearbyLocs[0]!;
const WALK_ACROSS = /^walk-across$/i;
/** On the far side with the XP paid. */
const crossed = (w: ReturnType<typeof world>, xp = 187) =>
    w.player({ at: { x: 2474, z: 3428 } }).skill('Agility', 1, xp);

async function run(states: BotWorldState[], opts: TimelineOptions = {}, option = WALK_ACROSS) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(obstacle(driver, log, option), { driver });
    if (r.kind !== 'returned') throw new Error(`obstacle did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('obstacle', () => {
    test('sends the option and succeeds once Agility XP is paid and the bot has moved', async () => {
        const { result, driver } = await run(across.series(20, (w, i) => (i >= 6 ? crossed(w) : w)));
        expect(result).toEqual({ ok: true, xp: 187 });
        expect(driver.commands[0]).toEqual({
            type: 'send',
            action: {
                type: 'interactLoc',
                x: at.x,
                z: at.z,
                locId: 2295,
                optionIndex: 1,
                reason: 'Walk-across Log balance',
            },
        });
        // The XP tick, then the settle ticks.
        expect(driver.state().tick).toBe(6 + OBSTACLE_SETTLE_TICKS);
    });

    test('the XP is read after the settle ticks, so a move that lands later is included', async () => {
        const { result } = await run(across.series(20, (w, i) => (i >= 6 ? crossed(w, i >= 7 ? 300 : 187) : w)));
        expect(result).toEqual({ ok: true, xp: 300 });
    });

    test('walking to the obstacle is not a crossing: XP is needed', async () => {
        const { result } = await run(
            across.series(OBSTACLE_WAIT_TICKS + 5, (w, i) => w.player({ at: { x: 2474, z: 3436 - Math.min(i, 1) } })),
        );
        expect(result.ok === false && result.reason).toBe('no-xp');
        expect(result.ok === false && result.message).toMatch(/no Agility XP within \d+ ticks; bot moved from/);
    });

    test('XP with the bot back where it stood is not a crossing either', async () => {
        const { result } = await run(
            across.series(OBSTACLE_WAIT_TICKS + 5, (w, i) => (i >= 3 ? w.skill('Agility', 1, 50) : w)),
        );
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('nothing happening is a timeout after the wait budget', async () => {
        const { result, driver } = await run(across.series(1));
        expect(result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'timed out crossing Log balance at (2474,3435)',
        });
        expect(driver.state().tick).toBe(OBSTACLE_WAIT_TICKS);
    });

    test('a refusal from this side ends the wait at once', async () => {
        const { result, driver } = await run(
            across.series(20, (w, i) => (i >= 2 ? w.tick(i).message('You can not do that from here.') : w)),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'refused',
            message: 'Log balance at (2474,3435): You can not do that from here.',
        });
        expect(driver.state().tick).toBe(2);
    });

    test('a message already on screen before the send is not an answer', async () => {
        const stale = across.tick(1).message('The pipe is being used').tick(0);
        const { result } = await run(stale.series(OBSTACLE_WAIT_TICKS + 2));
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('"I can\'t reach that!" is a refusal', async () => {
        const { result } = await run(
            across.series(20, (w, i) => (i >= 2 ? w.tick(i).message("I can't reach that!") : w)),
        );
        expect(result.ok === false && result.reason).toBe('refused');
    });

    test('a slip is a fall, even with the bot moved and no XP', async () => {
        const { result } = await run(
            across.series(20, (w, i) =>
                i >= 4
                    ? w
                          .player({ at: { x: 2474, z: 3433 } })
                          .tick(i)
                          .message('You slip and fall to the ground.')
                    : w,
            ),
        );
        expect(result.ok === false && result.reason).toBe('fell');
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(across.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('an option the loc lacks is no-option, nothing sent', async () => {
        const { result, driver } = await run(across.series(1), {}, /^climb$/i);
        expect(result.ok === false && result.reason).toBe('no-option');
        expect(driver.commands).toEqual([]);
    });
});
