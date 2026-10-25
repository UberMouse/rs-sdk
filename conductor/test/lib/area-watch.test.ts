import { describe, expect, test } from 'bun:test';
import { log, type Op } from '../../core/op';
import { areaWatchReport, newAreaWatch, noteIdle, outsideSighting, trackIdle } from '../../lib/area-watch';
import { world } from '../world';

const AREA = { x: 100, z: 100, radius: 5 };
const S = world().build();
const at = (x: number, z: number, distance = 1, name = 'Tree') => ({ name, x, z, distance });

describe('outsideSighting', () => {
    test('picks the nearest accepted target outside the area', () => {
        const items = [at(101, 100), at(120, 100, 9), at(110, 100, 4)];
        expect(outsideSighting(S, AREA, items, () => true)).toEqual(at(110, 100, 4));
    });

    test('nothing without an area, for targets inside it, or for ones the filter refuses', () => {
        expect(outsideSighting(S, undefined, [at(120, 100)], () => true)).toBeUndefined();
        expect(outsideSighting(S, AREA, [at(103, 100)], () => true)).toBeUndefined();
        expect(outsideSighting(S, AREA, [at(120, 100)], () => false)).toBeUndefined();
    });

    test('on the surface, skips targets within the margin of the Wilderness', () => {
        const near = at(3100, 3518);
        const area = { x: 3100, z: 3490, radius: 4 };
        expect(outsideSighting(world().build(), area, [near], () => true)).toBeUndefined();
        expect(
            outsideSighting(
                world()
                    .player({ at: { x: 3100, z: 3490, level: 1 } })
                    .build(),
                area,
                [near],
                () => true,
            ),
        ).toEqual(near);
    });
});

describe('areaWatchReport', () => {
    test('no idle ticks: nothing to report', () => {
        expect(areaWatchReport(newAreaWatch(), AREA)).toEqual({ diagnostics: {}, warnings: [] });
    });

    test('warns past ten percent, not at it', () => {
        const watch = newAreaWatch();
        noteIdle(watch, 9, undefined);
        noteIdle(watch, 1, at(110, 100, 6));
        expect(areaWatchReport(watch, AREA).warnings).toEqual([]);
        noteIdle(watch, 1, undefined);
        noteIdle(watch, 1, at(108, 100, 4));
        const report = areaWatchReport(watch, AREA);
        expect(report.diagnostics).toMatchObject({
            idleTicks: 12,
            seenOutsideAreaTicks: 2,
            nearestOutsideArea: { name: 'Tree', x: 108, z: 100 },
        });
        expect(report.warnings).toHaveLength(1);
    });

    test('a sighting at either end of the wait counts the whole wait once', () => {
        const watch = newAreaWatch();
        noteIdle(watch, 3, at(110, 100), at(111, 100));
        expect(watch.idleTicks).toBe(3);
        expect(watch.seenOutsideAreaTicks).toBe(3);
    });

    test('a wait of no ticks counts nothing', () => {
        const watch = newAreaWatch();
        noteIdle(watch, 0, at(110, 100));
        expect(watch).toEqual(newAreaWatch());
    });
});

const throwingState = (): (() => typeof S) => {
    let n = 0;
    return () => {
        if (n++ > 0) throw new Error('state gone');
        return S;
    };
};
const noSighting = () => undefined;
/** Steps a generator op, answering every command with nothing, to its end. */
const drive = <T>(op: Op<T>): T => {
    let r = op.next();
    while (!r.done) r = op.next(undefined as never);
    return r.value;
};

describe('trackIdle', () => {
    test('a state() that throws in the accounting does not replace the return value', () => {
        const idle = (function* (): Op<number> {
            yield* log('idling');
            return 7;
        })();
        const run = trackIdle({ state: throwingState() }, newAreaWatch(), noSighting, idle);
        expect(drive(run)).toBe(7);
    });

    test('nor the error the wait threw', () => {
        const idle = (function* (): Op<number> {
            yield* log('idling');
            throw new Error('real failure');
        })();
        const run = trackIdle({ state: throwingState() }, newAreaWatch(), noSighting, idle);
        expect(() => drive(run)).toThrow('real failure');
    });
});
