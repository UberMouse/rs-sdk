import { describe, expect, test } from 'bun:test';
import { CLIMB_DIALOG_TICKS, CLIMB_MAX_TICKS, CLIMB_OPEN_TICKS, CLIMB_WAIT_TICKS, climb } from '../../actions/climb';
import { CONNECTORS } from '../../lib/connectors';
import { castle, floorLocs, LANDING } from '../stairs';
import { world } from '../world';
import { refuse, runOp } from './harness';

const connector = (level: number, direction: 'up' | 'down') => {
    const c = CONNECTORS.find(
        k => k.name === 'Lumbridge castle stairs' && k.loc.level === level && k.direction === direction,
    );
    if (!c) throw new Error(`no connector ${level} ${direction}`);
    return c;
};
const onFloor = (level: number) => {
    const w = world().player({ at: { ...LANDING, level } });
    return { ...w.build(), nearbyLocs: floorLocs(level) };
};
const states = (level: number, n = 3) => Array.from({ length: n }, (_, i) => ({ ...onFloor(level), tick: i }));
const levelOf = (r: { driver: { state(): { player: { level: number } | null } } }) => r.driver.state().player?.level;

const askOnly = (level: number) => {
    const w = world()
        .player({ at: { ...LANDING, level } })
        .loc('Staircase', 3204, 3207, { options: ['Climb'] });
    return Array.from({ length: 3 }, (_, i) => ({ ...w.build(), tick: i }));
};

describe('climb', () => {
    test('sends the direction option on the loc and succeeds once on the next floor', async () => {
        const r = await runOp(states(0), ctx => climb(ctx, connector(0, 'up')), { react: castle() });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends).toEqual([
            {
                type: 'interactLoc',
                x: 3204,
                z: 3207,
                locId: expect.any(Number),
                optionIndex: 1,
                reason: 'Climb-up Staircase',
            },
        ]);
        expect(levelOf(r)).toBe(1);
    });

    test('a middle floor uses its Climb-up (op 2) and Climb-down (op 3) options, no dialog', async () => {
        const up = await runOp(states(1), ctx => climb(ctx, connector(1, 'up')), { react: castle() });
        expect(up.result).toEqual({ ok: true });
        expect(up.sends.map(s => s.type === 'interactLoc' && s.optionIndex)).toEqual([2]);
        expect(levelOf(up)).toBe(2);
        const down = await runOp(states(1), ctx => climb(ctx, connector(1, 'down')), { react: castle() });
        expect(down.sends.map(s => s.type === 'interactLoc' && s.optionIndex)).toEqual([3]);
        expect(levelOf(down)).toBe(0);
    });

    test('a loc with only a plain Climb opens "Climb up or down?": the matching choice is clicked', async () => {
        const up = await runOp(askOnly(1), ctx => climb(ctx, connector(1, 'up')), { react: castle() });
        expect(up.result).toEqual({ ok: true });
        expect(up.sends.map(s => s.type)).toEqual(['interactLoc', 'clickDialogOption']);
        expect(up.sends[1]).toMatchObject({ optionIndex: 0 });
        const down = await runOp(askOnly(1), ctx => climb(ctx, connector(1, 'down')), { react: castle() });
        expect(down.sends[1]).toMatchObject({ optionIndex: 1 });
        expect(levelOf(down)).toBe(0);
    });

    test('a choice that never shows the direction is no-dialog, and the open choice is closed', async () => {
        const w = world()
            .player({ at: { ...LANDING, level: 1 } })
            .loc('Staircase', 3204, 3207, { options: ['Climb'] });
        const asking = Array.from({ length: 12 }, (_, i) => ({
            ...w.dialog({ options: ['Talk', 'Leave'] }).build(),
            tick: i,
        }));
        const r = await runOp(asking, ctx => climb(ctx, connector(1, 'up')));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-dialog' });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc', 'closeModal']);
    });

    test('a climb the server ignores times out after CLIMB_WAIT_TICKS, stating it', async () => {
        const r = await runOp(states(0, 3), ctx => climb(ctx, connector(0, 'up')), { react: castle({ stuck: true }) });
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(r.driver.state().tick).toBe(CLIMB_WAIT_TICKS);
    });

    test("'I can't reach that!' ends it at once as cant-reach", async () => {
        const blocked = [onFloor(0), { ...world(onFloor(0)).tick(1).message("I can't reach that!").build() }];
        const r = await runOp(blocked, ctx => climb(ctx, connector(0, 'up')));
        expect(r.result).toMatchObject({ ok: false, reason: 'cant-reach' });
        expect(r.driver.state().tick).toBe(1);
    });

    test('no loc in sight: scans once, then no-loc; a loc only the scan shows is used', async () => {
        const none = { ...onFloor(0), nearbyLocs: [] };
        const missing = await runOp([none], ctx => climb(ctx, connector(0, 'up')));
        expect(missing.result).toMatchObject({ ok: false, reason: 'no-loc' });
        expect(missing.driver.commands.filter(c => c.type === 'scan')).toHaveLength(1);
        expect(missing.sends).toEqual([]);
        const found = await runOp([none, { ...none, tick: 1 }], ctx => climb(ctx, connector(0, 'up')), {
            scan: () => floorLocs(0),
            react: castle(),
        });
        expect(found.result).toEqual({ ok: true });
    });

    test('a loc offering only the other direction is no-loc; the wrong plane sends nothing', async () => {
        const downOnly = states(0).map(st => ({ ...st, nearbyLocs: floorLocs(2).map(l => ({ ...l, level: 0 })) }));
        const other = await runOp(downOnly, ctx => climb(ctx, connector(0, 'up')));
        expect(other.result).toMatchObject({ ok: false, reason: 'no-loc' });
        const upstairs = await runOp(states(2), ctx => climb(ctx, connector(0, 'up')));
        expect(upstairs.result).toMatchObject({ ok: false, reason: 'wrong-plane' });
        expect(upstairs.sends).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const r = await runOp(states(0), ctx => climb(ctx, connector(0, 'up')), { respond: refuse });
        expect(r.result).toMatchObject({ ok: false, reason: 'send-failed' });
    });

    test('the worst case is a send, the dialog or the opening, its answer and the wait', () => {
        expect(CLIMB_MAX_TICKS).toBe(1 + Math.max(CLIMB_DIALOG_TICKS, CLIMB_OPEN_TICKS) + 1 + CLIMB_WAIT_TICKS);
    });
});

describe('climb through a closed trapdoor', () => {
    const trapdoor = CONNECTORS.find(k => k.name === 'Edgeville Dungeon trapdoor' && k.direction === 'down');
    if (!trapdoor) throw new Error('no Edgeville Dungeon trapdoor');
    const surface = world().player({ at: { level: 0, x: 3096, z: 3467 } });
    const closed = surface.loc('Trapdoor', 3097, 3468, { options: ['Open'] });
    const open = surface.loc('Trapdoor', 3097, 3468, { options: ['Climb-down', 'Close'] });
    const below = world().player({ at: { level: 0, x: 3097, z: 9868 } });
    const timeline = (opensAt: number, climbsAt: number) =>
        Array.from({ length: 40 }, (_, i) => ({
            ...(i >= climbsAt ? below : i >= opensAt ? open : closed).build(),
            tick: i,
        }));

    test('opens it, then climbs down once it offers Climb-down', async () => {
        const r = await runOp(timeline(3, 8), ctx => climb(ctx, trapdoor));
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type === 'interactLoc' && s.optionIndex)).toEqual([1, 1]);
        expect(r.sends.map(s => s.type === 'interactLoc' && s.reason)).toEqual([
            'Open Trapdoor',
            'Climb-down Trapdoor',
        ]);
    });

    test('an already open trapdoor is climbed at once', async () => {
        const r = await runOp(timeline(0, 4), ctx => climb(ctx, trapdoor));
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type === 'interactLoc' && s.reason)).toEqual(['Climb-down Trapdoor']);
    });

    test('a trapdoor that never opens is not-opened after CLIMB_OPEN_TICKS', async () => {
        const r = await runOp(timeline(99, 99), ctx => climb(ctx, trapdoor));
        expect(r.result).toMatchObject({ ok: false, reason: 'not-opened' });
        expect(r.sends).toHaveLength(1);
        expect(r.driver.state().tick).toBe(CLIMB_OPEN_TICKS);
    });

    test('a refused open is send-failed', async () => {
        const r = await runOp(timeline(3, 8), ctx => climb(ctx, trapdoor), { respond: refuse });
        expect(r.result).toMatchObject({ ok: false, reason: 'send-failed' });
    });
});
