import { describe, expect, test } from 'bun:test';
import { USE_WAIT_TICKS, useItemOnItem, useItemOnLoc } from '../../actions/use';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const FEATHER = 314;
const SHAFT = 52;
const HEADLESS = 53;
const BUCKET_OF_WATER = 1929;
const fletcher = world().inv('Feather', 1, { id: FEATHER }).inv('Arrow shaft', 1, { id: SHAFT }).tick(1);
const [feathers, shafts] = fletcher.build().inventory;
const nothing = (w: World) => w.message('Nothing interesting happens.');

describe('useItemOnItem', () => {
    test('sends the use and succeeds on an inventory change', async () => {
        const made = fletcher.inv('Arrow shaft', 0).inv('Headless arrow', 1, { id: HEADLESS }).tick(2);
        const { result, sends } = await runOp([fletcher.build(), made.build()], ctx =>
            useItemOnItem(ctx, feathers!, shafts!),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            { type: 'useItemOnItem', sourceSlot: 0, targetSlot: 1, reason: 'use Feather on Arrow shaft' },
        ]);
    });

    test('a dialog opening, or an animation starting, is evidence too', async () => {
        const menu = fletcher.dialog({ options: ['Make X', 'Make 10', 'Make 5', 'Short Bow'] }).tick(2);
        const opened = await runOp([fletcher.build(), menu.build()], ctx => useItemOnItem(ctx, feathers!, shafts!));
        expect(opened.result).toEqual({ ok: true });

        const busy = fletcher.tick(2).build();
        const animating = { ...busy, player: { ...busy.player!, animId: 1248 } };
        const anim = await runOp([fletcher.build(), animating], ctx => useItemOnItem(ctx, feathers!, shafts!));
        expect(anim.result).toEqual({ ok: true });
    });

    test('"Nothing interesting happens." ends it at once; an older one does not count', async () => {
        const old = nothing(fletcher);
        const { result, driver } = await runOp([old.build(), nothing(old.tick(3)).build()], ctx =>
            useItemOnItem(ctx, feathers!, shafts!),
        );
        expect(result).toEqual({ ok: false, reason: 'nothing-happened', message: 'Nothing interesting happens.' });
        expect(driver.state().tick).toBe(3);
    });

    test('no evidence within the wait is a timeout; a refused send is send-failed', async () => {
        const quiet = await runOp(fletcher.series(1), ctx => useItemOnItem(ctx, feathers!, shafts!));
        expect(quiet.result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Timeout using Feather on Arrow shaft',
        });
        expect(quiet.driver.state().tick).toBe(1 + USE_WAIT_TICKS);

        const refused = await runOp(fletcher.series(1), ctx => useItemOnItem(ctx, feathers!, shafts!), {
            respond: refuse,
        });
        expect(refused.result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

describe('useItemOnLoc', () => {
    const fountain = world().inv('Bucket', 1).loc('Fountain', 3221, 3210).tick(1);
    const bucket = fountain.build().inventory[0]!;
    const loc = fountain.build().nearbyLocs[0]!;

    test('sends the use on the loc and succeeds on an inventory change', async () => {
        const filled = fountain.inv('Bucket', 0).inv('Bucket of water', 1, { id: BUCKET_OF_WATER }).tick(2);
        const { result, sends } = await runOp([fountain.build(), filled.build()], ctx =>
            useItemOnLoc(ctx, bucket, loc),
        );
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            { type: 'useItemOnLoc', itemSlot: 0, x: 3221, z: 3210, locId: loc.id, reason: 'use Bucket on Fountain' },
        ]);
    });

    test("I can't reach that! is cant-reach", async () => {
        const blocked = fountain.tick(2).message("I can't reach that!");
        const { result } = await runOp([fountain.build(), blocked.build()], ctx => useItemOnLoc(ctx, bucket, loc));
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Fountain' });
    });
});
