import { describe, expect, test } from 'bun:test';
import { MAX_STEP_TILES, MOVED_PREFIX, movementWatch } from '../../actions/movement';
import { world } from '../world';

const at = (tick: number, x: number, z: number, level = 0) =>
    world().tick(tick).player({ at: { x, z, level } }).build();

describe('movementWatch', () => {
    test('a run of 2 tiles a tick, diagonal or straight, is the bot walking', () => {
        const watch = movementWatch(at(1, 3200, 3200));
        for (let i = 1; i <= 6; i++) expect(watch(at(1 + i, 3200 + 2 * i, 3200 + 2 * i))).toBeNull();
    });

    test('a jump of more than a run step in one tick is the game moving the bot', () => {
        const watch = movementWatch(at(1, 3200, 3200));
        expect(watch(at(2, 3200 + MAX_STEP_TILES + 1, 3200))).toBe(`${MOVED_PREFIX}(3203,3200)`);
    });

    test('skipped ticks allow a proportionally longer walk, from the previous state and from the start', () => {
        const watch = movementWatch(at(1, 3200, 3200));
        expect(watch(at(6, 3210, 3200))).toBeNull();
        expect(watch(at(7, 3212, 3200))).toBeNull();
        expect(watch(at(8, 3225, 3200))).not.toBeNull();
    });

    test('a move spread over states a guard handled is caught against the pre-send position', () => {
        const watch = movementWatch(at(1, 2762, 4694));
        expect(watch(at(2, 2762, 4694))).toBeNull();
        expect(watch(at(3, 2762, 4694))).toBeNull();
        // 4 tiles after 3 ticks of standing still is within run reach of the start; 7 is not.
        expect(watch(at(4, 2755, 4694))).not.toBeNull();
    });

    test('a change of floor counts, and stays seen', () => {
        const watch = movementWatch(at(1, 3200, 3200));
        expect(watch(at(2, 3200, 3201, 1))).not.toBeNull();
        expect(watch(at(3, 3200, 3201, 1))).not.toBeNull();
    });

    test('one tile counts only with anyMove', () => {
        expect(movementWatch(at(1, 3200, 3200))(at(2, 3201, 3200))).toBeNull();
        expect(movementWatch(at(1, 3200, 3200), true)(at(2, 3201, 3200))).not.toBeNull();
        expect(movementWatch(at(1, 3200, 3200), true)(at(2, 3200, 3200))).toBeNull();
    });

    test('with no player before the send, a later state is not a move', () => {
        const noPlayer = { ...at(1, 3200, 3200), player: undefined };
        const watch = movementWatch(noPlayer as never);
        expect(watch(at(2, 3200, 3200))).toBeNull();
        expect(watch(at(3, 3200, 3200))).toBeNull();
    });
});
