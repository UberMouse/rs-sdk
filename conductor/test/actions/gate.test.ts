import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { GATE_ATTEMPTS, GATE_DIALOG_TICKS, GNOME_GATE, insideFence, passGate } from '../../actions/gate';
import type { Effect } from '../../core/drivers/timeline';
import { fakePaths } from '../paths';
import { world } from '../world';
import { runOp } from './harness';

const SOUTH = { x: 2461, z: 3381 };
const THROUGH = { x: 2461, z: 3385 };
const south = world()
    .player({ at: SOUTH })
    .loc('Gate', 2459, 3383, { options: ['Open'] });
const NORTH = { x: 2461, z: 3385 };
const OUT = { x: 2461, z: 3382 };
const states = (w = south, n = 3) => Array.from({ length: n }, (_, i) => ({ ...w.build(), tick: i }));
const at =
    (to: { x: number; z: number }): Effect =>
    s =>
        world(s).player({ at: to }).build();
const isOpen = (a: BotAction) => a.type === 'interactLoc';

describe('passGate', () => {
    test('one Open click walks the bot through', async () => {
        const r = await runOp(states(), ctx => passGate(ctx, GNOME_GATE), {
            react: a => (isOpen(a) ? at(THROUGH) : undefined),
        });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc']);
        expect(r.sends[0]).toMatchObject({ x: 2459, z: 3383, optionIndex: 1 });
    });

    test('a bot already north of the gate sends nothing', async () => {
        const w = south.player({ at: THROUGH });
        const r = await runOp(states(w), ctx => passGate(ctx, GNOME_GATE));
        expect(r.result).toEqual({ ok: true });
        expect(r.sends).toEqual([]);
    });

    test("Femi's first dialog: the busy choice is clicked, then the second Open passes", async () => {
        let opens = 0;
        let asked = false;
        const r = await runOp(states(south, 4), ctx => passGate(ctx, GNOME_GATE), {
            react: a => {
                if (isOpen(a)) {
                    opens++;
                    if (opens === 1) {
                        asked = true;
                        return t =>
                            world(t)
                                .dialog({ options: ["Sorry, I'm a bit busy.", 'OK then.'] })
                                .build();
                    }
                    return at(THROUGH);
                }
                if (a.type === 'clickDialogOption') return t => world(t).dialog(false).build();
                return undefined;
            },
        });
        expect(asked).toBe(true);
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc', 'clickDialogOption', 'interactLoc']);
        expect(r.sends[1]).toMatchObject({ optionIndex: 0 });
    });

    test('a gate that never lets the bot through times out after GATE_ATTEMPTS tries', async () => {
        const r = await runOp(states(south, GATE_ATTEMPTS * (GATE_DIALOG_TICKS + 2)), ctx => passGate(ctx, GNOME_GATE));
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(r.sends.filter(isOpen)).toHaveLength(GATE_ATTEMPTS);
    });

    test('outward, one Open click from the inside stand tile passes at z <= exitZ (no Femi)', async () => {
        const w = south.player({ at: NORTH });
        const r = await runOp(states(w), ctx => passGate(ctx, GNOME_GATE, 'out'), {
            react: a => (isOpen(a) ? at(OUT) : undefined),
        });
        expect(r.result).toEqual({ ok: true });
        expect(r.sends.map(s => s.type)).toEqual(['interactLoc']);
    });

    test('outward, a bot already south of the gate sends nothing', async () => {
        const r = await runOp(states(south), ctx => passGate(ctx, GNOME_GATE, 'out'));
        expect(r.result).toEqual({ ok: true });
        expect(r.sends).toEqual([]);
    });

    test('outward, a gate that stays shut times out after `attempts` Open clicks', async () => {
        const w = south.player({ at: NORTH });
        const r = await runOp(states(w, 2 * (GATE_DIALOG_TICKS + 2)), ctx => passGate(ctx, GNOME_GATE, 'out', 2));
        expect(r.result).toMatchObject({ ok: false, reason: 'timeout' });
        expect(r.sends.filter(isOpen)).toHaveLength(2);
    });

    test('no gate in sight is no-loc', async () => {
        const w = world().player({ at: SOUTH });
        const r = await runOp(states(w), ctx => passGate(ctx, GNOME_GATE), { scan: () => [] });
        expect(r.result).toMatchObject({ ok: false, reason: 'no-loc' });
        expect(r.sends).toEqual([]);
    });

    test('a dialog without the busy choice is no-dialog', async () => {
        const w = south.dialog({ options: ['Yes', 'No'] });
        const r = await runOp(states(w), ctx => passGate(ctx, GNOME_GATE));
        expect(r.result).toMatchObject({ ok: false, reason: 'no-dialog' });
    });

    test('a refused click is send-failed', async () => {
        const r = await runOp(states(), ctx => passGate(ctx, GNOME_GATE), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result).toMatchObject({ ok: false, reason: 'send-failed' });
    });
});

const box = (x: number, z: number) => x >= 10 && x <= 20 && z >= 10 && z <= 20;

describe('insideFence', () => {
    const spec = { ...GNOME_GATE, inside: { x: 15, z: 15 }, bounds: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 } };
    const paths = fakePaths(
        () => ({ success: false, waypoints: [] }),
        [],
        () => false,
        (x, z, dx, dz) => box(x, z) !== box(x + dx, z + dz),
    );

    test('the fill stops at the fence', () => {
        expect(insideFence(paths, spec, 15, 15)).toBe(true);
        expect(insideFence(paths, spec, 10, 20)).toBe(true);
        expect(insideFence(paths, spec, 9, 15)).toBe(false);
        expect(insideFence(paths, spec, 30, 30)).toBe(false);
    });
});
