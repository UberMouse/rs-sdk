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

const playing = (w: World, animId: number) => {
    const b = w.build();
    return { ...b, player: { ...b.player!, animId } };
};

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

    test('an animation already playing at the send is not evidence; a new one is', async () => {
        const states = [playing(fletcher, 808), playing(fletcher.tick(2), 808), playing(fletcher.tick(3), 808)];
        const stale = await runOp(states, ctx => useItemOnItem(ctx, feathers!, shafts!));
        expect(stale.result).toEqual({
            ok: false,
            reason: 'timeout',
            message: 'Timeout using Feather on Arrow shaft',
        });
        const changed = [playing(fletcher, 808), playing(fletcher.tick(2), 1248)];
        const fresh = await runOp(changed, ctx => useItemOnItem(ctx, feathers!, shafts!));
        expect(fresh.result).toEqual({ ok: true });
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

describe('a use that moves the player', () => {
    const tomb = world().inv("Glarial's pebble", 1, { id: 294 }).loc("Glarial's tombstone", 2560, 3445).tick(1);
    const pebble = tomb.build().inventory[0]!;
    const stone = tomb.build().nearbyLocs[0]!;
    const jumped = (n: number, at: { x: number; z: number; level?: number }) =>
        Array.from({ length: n }, (_, i) =>
            tomb
                .tick(2 + i)
                .player({ at })
                .build(),
        );

    test('a teleport onto the tomb floor is the effect of a use on a loc', async () => {
        const { result } = await runOp([tomb.build(), ...jumped(3, { x: 2554, z: 9844 })], ctx =>
            useItemOnLoc(ctx, pebble, stone),
        );
        expect(result).toEqual({ ok: true });
    });

    test('a change of floor alone is an effect', async () => {
        const { result } = await runOp([tomb.build(), ...jumped(3, { x: 2560, z: 3446, level: 1 })], ctx =>
            useItemOnLoc(ctx, pebble, stone),
        );
        expect(result).toEqual({ ok: true });
    });

    test('a teleport is also the effect of an item used on an item, and one step is too', async () => {
        const [a, b] = world()
            .inv('Feather', 1, { id: FEATHER })
            .inv('Arrow shaft', 1, { id: SHAFT })
            .tick(1)
            .build().inventory;
        const start = world().inv('Feather', 1, { id: FEATHER }).inv('Arrow shaft', 1, { id: SHAFT }).tick(1);
        for (const dest of [
            { x: 3300, z: 3200 },
            { x: 3201, z: 3200 },
        ]) {
            const states = [
                start.player({ at: { x: 3200, z: 3200 } }).build(),
                start.tick(2).player({ at: dest }).build(),
            ];
            const { result } = await runOp(states, ctx => useItemOnItem(ctx, a!, b!));
            expect(result).toEqual({ ok: true });
        }
    });

    test('a bot running toward the loc is a walk, so the use times out', async () => {
        const walking = Array.from({ length: USE_WAIT_TICKS + 2 }, (_, i) =>
            tomb
                .tick(2 + i)
                .player({ at: { x: 3222 + 2 * (i + 1), z: 3218 } })
                .build(),
        );
        const { result } = await runOp([tomb.build(), ...walking], ctx => useItemOnLoc(ctx, pebble, stone));
        expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    });
});
