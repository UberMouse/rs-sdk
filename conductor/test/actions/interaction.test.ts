import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import {
    INTERACT_WAIT_TICKS,
    interact,
    type InteractTarget,
    SETTLE_MAX_TICKS,
    SETTLE_STABLE_TICKS,
    useOn,
    useOnNpc,
} from '../../actions/interaction';
import { ticks } from '../../core/op';
import type { Guard } from '../../core/interpret';
import { type World, world } from '../world';
import { refuse, runOp } from './harness';

const AMULET_ID = 552;
const START = world().tick(1);
const w = START.loc('Coffin', 3249, 3192, { options: ['Open', 'Search'] })
    .npc('Father Urhney', 3235, 3153, { options: ['Talk-to'], index: 7 })
    .inv('Ghostspeak amulet', 1, { id: AMULET_ID, options: [{ text: 'Wear', opIndex: 2 }] });
const bag = START.inv('Ghostspeak amulet', 1, { id: AMULET_ID, options: [{ text: 'Wear', opIndex: 2 }] });
const base = w.build();
const coffin: InteractTarget = { kind: 'loc', loc: base.nearbyLocs[0]! };
const urhney: InteractTarget = { kind: 'npc', npc: base.nearbyNpcs[0]! };
const amulet: InteractTarget = { kind: 'item', item: base.inventory[0]! };

/** The start state, then `n - 1` more ticks where `edit` is applied from tick 2 on. */
const after = (edit: (w: World) => World, n = 3): BotWorldState[] => [
    w.build(),
    ...Array.from({ length: n - 1 }, (_, i) => edit(w.tick(2 + i)).build()),
];

describe('interact: the effect', () => {
    test('a game message after the send is the effect of a loc interaction', async () => {
        const { result, sends } = await runOp(
            after(x => x.message('You open the coffin.'), 6),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toEqual({ ok: true, effect: 'game message "You open the coffin."' });
        expect(sends).toEqual([
            { type: 'interactLoc', x: 3249, z: 3192, locId: coffin.loc.id, optionIndex: 1, reason: 'Open Coffin' },
        ]);
    });

    test('a message already on screen before the send is not the effect', async () => {
        const old = START.message('Welcome.').loc('Coffin', 3249, 3192, { options: ['Open'] });
        const states = [
            old.build(),
            ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) => old.tick(2 + i).build()),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, coffin, /^open$/i));
        expect(result).toMatchObject({ ok: false, reason: 'no-effect' });
    });

    test('a dialog opening is the effect of an NPC interaction', async () => {
        const { result, sends } = await runOp(
            after(x => x.dialog({ options: [] })),
            ctx => interact(ctx, urhney, /talk/i),
        );
        expect(result).toEqual({ ok: true, effect: 'a dialog opened' });
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: 7, optionIndex: 1, reason: 'Talk-to Father Urhney' }]);
    });

    test('the inventory changing, or the loc changing into another, is an effect', async () => {
        const worn = await runOp(
            after(x => x.inv('Ghostspeak amulet', 0)),
            ctx => interact(ctx, amulet, /^wear/i),
        );
        expect(worn.result).toEqual({ ok: true, effect: 'the inventory changed' });
        expect(worn.sends).toEqual([
            { type: 'useInventoryItem', slot: 0, optionIndex: 2, reason: 'Wear Ghostspeak amulet' },
        ]);

        const open = bag.loc('Coffin', 3249, 3192, { options: ['Close', 'Search'], id: coffin.loc.id + 1 });
        const changed = await runOp([w.build(), open.tick(2).build()], ctx => interact(ctx, coffin, /^open$/i));
        expect(changed.result).toEqual({ ok: true, effect: 'the loc changed' });
    });

    test('the worn items changing is an effect', async () => {
        const { result } = await runOp(
            after(x => x.equipment({ name: 'Ghostspeak amulet', id: AMULET_ID })),
            ctx => interact(ctx, amulet, /^wear/i),
        );
        expect(result).toEqual({ ok: true, effect: 'the worn items changed' });
    });

    test('the loc vanishing is an effect; an NPC leaving view is not', async () => {
        const gone = await runOp([w.build(), bag.tick(2).build()], ctx => interact(ctx, coffin, /^search$/i));
        expect(gone.result).toEqual({ ok: true, effect: 'the loc is gone' });
        const left = await runOp(
            [
                w.build(),
                ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) =>
                    bag
                        .loc('Coffin', 3249, 3192, { options: ['Open'] })
                        .tick(2 + i)
                        .build(),
                ),
            ],
            ctx => interact(ctx, urhney, /talk/i),
        );
        expect(left.result).toMatchObject({ ok: false, reason: 'no-effect' });
    });

    test('a state change beats a message seen in the same window', async () => {
        const { result } = await runOp(
            after(x => x.message('You feel hungry.').inv('Ghostspeak amulet', 0)),
            ctx => interact(ctx, amulet, /^wear/i),
        );
        expect(result).toEqual({ ok: true, effect: 'the inventory changed' });
    });

    test('an index option works on an item', async () => {
        const { result, sends } = await runOp(
            after(x => x.inv('Ghostspeak amulet', 0)),
            ctx => interact(ctx, amulet, 2),
        );
        expect(result).toEqual({ ok: true, effect: 'the inventory changed' });
        expect(sends).toEqual([
            { type: 'useInventoryItem', slot: 0, optionIndex: 2, reason: 'Wear Ghostspeak amulet' },
        ]);
    });

    test('an animation that starts after the send is an effect', async () => {
        const busy = w.tick(2).build();
        const { result } = await runOp([w.build(), { ...busy, player: { ...busy.player!, animId: 536 } }], ctx =>
            interact(ctx, coffin, /^search$/i),
        );
        expect(result).toEqual({ ok: true, effect: 'an animation started' });
    });
});

/** The state with `n` op rejections counted. */
const feedback =
    (n: number) =>
    (s: BotWorldState): BotWorldState => ({
        ...s,
        opFeedback: {
            mapFlagUnsetCount: n,
            lastMapFlagUnsetTick: -1,
            opRejectedCount: n,
            lastOpRejectedTick: -1,
        },
    });

describe('interact: failures', () => {
    test("the server's can't-reach message is cant-reach", async () => {
        const { result } = await runOp(
            after(x => x.message("I can't reach that!")),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toEqual({ ok: false, reason: 'cant-reach', message: 'Cannot reach Coffin' });
    });

    test.each([
        'Maybe I should open it first.',
        'Nothing interesting happens.',
        "You can't do that.",
        'You need a key.',
        "You don't see that being any help.",
        "It's a little far with that strong current.",
        "You can't get a good shot from here.",
        'You remember putting that type of rune there.',
    ])('the refusal "%s" is refused, not an effect', async message => {
        const { result } = await runOp(
            after(x => x.message(message), 6),
            ctx => interact(ctx, coffin, /^search$/i),
        );
        expect(result).toEqual({ ok: false, reason: 'refused', message: `Coffin: "${message}"` });
    });

    test('an unrelated message alone waits out the grace, then counts as a weak effect', async () => {
        const { result } = await runOp(
            after(x => x.message('You feel hungry.'), 6),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toEqual({ ok: true, effect: 'game message "You feel hungry."' });
    });

    test('with `expect`, a state change alone is not the effect and an unrelated message neither', async () => {
        const opened = await runOp(
            after(x => x.dialog({ options: [] }), INTERACT_WAIT_TICKS + 3),
            ctx => interact(ctx, urhney, /talk/i, { expect: /coffin/i }),
        );
        expect(opened.result).toMatchObject({ ok: false, reason: 'no-effect' });
        const said = await runOp(
            after(x => x.message('You feel hungry.'), INTERACT_WAIT_TICKS + 3),
            ctx => interact(ctx, coffin, /^open$/i, { expect: /opens?/i }),
        );
        expect(said.result).toMatchObject({ ok: false, reason: 'no-effect' });
    });

    test('with `expect`, a matching message is the effect at once', async () => {
        const { result } = await runOp(
            after(x => x.message('You search the coffin and find a skull.')),
            ctx => interact(ctx, coffin, /^search$/i, { expect: /find a skull/i }),
        );
        expect(result).toEqual({ ok: true, effect: '"You search the coffin and find a skull."' });
    });

    test('an option the target lacks sends nothing', async () => {
        const { result, sends } = await runOp(
            after(x => x),
            ctx => interact(ctx, coffin, /^close$/i),
        );
        expect(result).toMatchObject({ ok: false, reason: 'no-option' });
        expect(sends).toEqual([]);
        const item = await runOp(
            after(x => x),
            ctx => interact(ctx, amulet, /^eat$/i),
        );
        expect(item.result).toMatchObject({ ok: false, reason: 'no-option' });
        expect(item.sends).toEqual([]);
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runOp(
            after(x => x),
            ctx => interact(ctx, coffin, /^open$/i),
            { respond: refuse },
        );
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });

    test('nothing shown within the wait is no-effect', async () => {
        const { result } = await runOp(
            after(x => x, INTERACT_WAIT_TICKS + 3),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'no-effect',
            message: `/^open$/i on Coffin showed no effect within ${INTERACT_WAIT_TICKS} ticks`,
        });
    });

    test('a discarded op with nothing else shown is rejected', async () => {
        const states = [w.build(), ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) => w.tick(2 + i).build())];
        const { result } = await runOp(
            states.map((s, i) => feedback(i === 0 ? 0 : 1)(s)),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    });
});

const at = (x: number, z: number, level?: number) => (m: World) => m.player({ at: { x, z, level } });

describe('interact: the player moved by the game, and an item used on a loc', () => {
    test('a jump of more than a run step in one tick is the effect of an option', async () => {
        const { result } = await runOp(after(at(3262, 3192), 5), ctx => interact(ctx, coffin, /^open$/i));
        expect(result).toEqual({ ok: true, effect: 'the player moved to (3262,3192)' });
    });

    test('steps of a run (two tiles a tick) are a walk, not an effect', async () => {
        const states = [
            w.build(),
            ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) =>
                at(3222 + 2 * (i + 1), 3218)(w.tick(2 + i)).build(),
            ),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, coffin, /^open$/i));
        expect(result).toMatchObject({ ok: false, reason: 'no-effect' });
    });

    test('a bot standing on the loc, moved one tile, is the effect', async () => {
        const door = START.player({ at: { x: 3249, z: 3192 } }).loc('Door', 3249, 3192, { options: ['Open'] });
        const target: InteractTarget = { kind: 'loc', loc: door.build().nearbyLocs[0]! };
        const states = [
            door.build(),
            ...Array.from({ length: 3 }, (_, i) =>
                door
                    .tick(2 + i)
                    .player({ at: { x: 3249, z: 3193 } })
                    .build(),
            ),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, target, /^open$/i));
        expect(result).toEqual({ ok: true, effect: 'the player moved to (3249,3193)' });
    });

    test('useOn sends useItemOnLoc once and takes the first effect, with no inventory change needed', async () => {
        const rope = START.inv('Rope', 1, { id: 954 }).loc('Rock', 3249, 3192, { options: ['Swim to'] });
        const item = rope.build().inventory[0]!;
        const loc = rope.build().nearbyLocs[0]!;
        const states = [
            rope.build(),
            ...Array.from({ length: 4 }, (_, i) =>
                rope
                    .tick(2 + i)
                    .message('You tie the rope.')
                    .build(),
            ),
        ];
        const { result, sends } = await runOp(states, ctx => useOn(ctx, item, loc, { expect: /tie the rope/ }));
        expect(result).toEqual({ ok: true, effect: '"You tie the rope."' });
        expect(sends).toEqual([
            { type: 'useItemOnLoc', itemSlot: 0, x: 3249, z: 3192, locId: loc.id, reason: 'use Rope on Rock' },
        ]);
    });

    test('useOn: a refusal message fails as refused, a quiet wait as no-effect', async () => {
        const rope = START.inv('Rope', 1, { id: 954 }).loc('Rock', 3249, 3192, { options: ['Swim to'] });
        const item = rope.build().inventory[0]!;
        const loc = rope.build().nearbyLocs[0]!;
        const refused = await runOp(
            [
                rope.build(),
                ...Array.from({ length: 3 }, (_, i) =>
                    rope
                        .tick(2 + i)
                        .message('Nothing interesting happens.')
                        .build(),
                ),
            ],
            ctx => useOn(ctx, item, loc),
        );
        expect(refused.result).toMatchObject({ ok: false, reason: 'refused' });
        const quiet = await runOp(
            [rope.build(), ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) => rope.tick(2 + i).build())],
            ctx => useOn(ctx, item, loc),
        );
        expect(quiet.result).toMatchObject({ ok: false, reason: 'no-effect' });
    });

    test('a state the client skipped does not turn a run into a jump (the threshold scales with the ticks elapsed)', async () => {
        // Four tiles over two ticks is a run; four tiles in one tick is not.
        const skipped = [
            w.build(),
            ...Array.from({ length: INTERACT_WAIT_TICKS + 2 }, (_, i) => at(3226, 3218)(w.tick(3 + i)).build()),
        ];
        const run = await runOp(skipped, ctx => interact(ctx, coffin, /^open$/i));
        expect(run.result).toMatchObject({ ok: false, reason: 'no-effect' });
        const jumped = [w.build(), ...Array.from({ length: 4 }, (_, i) => at(3226, 3218)(w.tick(2 + i)).build())];
        const jump = await runOp(jumped, ctx => interact(ctx, coffin, /^open$/i));
        expect(jump.result).toEqual({ ok: true, effect: 'the player moved to (3226,3218)' });
    });
});

describe('interact: settling after a game-driven move', () => {
    const rope = START.inv('Rope', 1, { id: 954 }).loc('Rock', 3249, 3192, { options: ['Swim to'] });
    const item = rope.build().inventory[0]!;
    const loc = rope.build().nearbyLocs[0]!;
    /** The rope world at tick `t` with the player at x and animation `anim`. */
    const frame = (t: number, x: number, anim: number): BotWorldState => {
        const s = at(x, 3218)(rope.tick(t)).build();
        return { ...s, player: s.player && { ...s.player, animId: anim } };
    };

    test('a use ends once position, floor and animation hold for three ticks after the effect', async () => {
        // The throw animation at tick 2 is the effect; the landing (a step and the end of the animation) follows.
        const states = [
            frame(1, 3222, -1),
            frame(2, 3222, 4),
            frame(3, 3223, 4),
            frame(4, 3223, -1),
            frame(5, 3223, -1),
        ];
        const run = await runOp(states, ctx => useOn(ctx, item, loc));
        expect(run.result).toEqual({ ok: true, effect: 'an animation started' });
        expect(run.driver.ticksElapsed).toBe(6);
    });

    test('an option does not settle unless asked; with settle it does', async () => {
        const states = [
            frame(1, 3222, -1),
            frame(2, 3222, 4),
            frame(3, 3223, 4),
            frame(4, 3223, -1),
            frame(5, 3223, -1),
        ];
        const quick = await runOp(states, ctx => interact(ctx, { kind: 'loc', loc }, /swim/i));
        expect(quick.driver.ticksElapsed).toBe(1);
        const settled = await runOp(states, ctx => interact(ctx, { kind: 'loc', loc }, /swim/i, { settle: true }));
        expect(settled.driver.ticksElapsed).toBe(6);
    });

    test('a move the game made settles too', async () => {
        const states = [
            frame(1, 3222, -1),
            frame(2, 3262, -1),
            frame(3, 3263, -1),
            frame(4, 3263, -1),
            frame(5, 3263, -1),
        ];
        const run = await runOp(states, ctx => interact(ctx, { kind: 'loc', loc }, /swim/i));
        expect(run.result).toEqual({ ok: true, effect: 'the player moved to (3262,3218)' });
        expect(run.driver.ticksElapsed).toBe(5);
    });

    test('a world that never settles is cut off at SETTLE_MAX_TICKS and still succeeds', async () => {
        const states = [
            frame(1, 3222, -1),
            frame(2, 3222, 4),
            ...Array.from({ length: SETTLE_MAX_TICKS + 3 }, (_, i) => frame(3 + i, 3223 + (i % 2), 4)),
        ];
        const run = await runOp(states, ctx => useOn(ctx, item, loc));
        expect(run.result).toEqual({
            ok: true,
            effect: `an animation started (still moving after ${SETTLE_MAX_TICKS} ticks)`,
        });
        expect(run.driver.ticksElapsed).toBe(1 + SETTLE_MAX_TICKS);
    });

    test('a two-tick pause and then eight single-tile moves settle at the last tile', async () => {
        // The rope on the Rock: the throw animation, a stationary pause, then the swim a tile a tick.
        const states = [
            frame(1, 3222, -1),
            frame(2, 3222, 4),
            frame(3, 3222, -1),
            frame(4, 3222, -1),
            ...Array.from({ length: 8 }, (_, i) => frame(5 + i, 3223 + i, -1)),
        ];
        const run = await runOp(states, ctx => useOn(ctx, item, loc));
        expect(run.result).toEqual({ ok: true, effect: 'an animation started' });
        expect(run.driver.ticksElapsed).toBe(1 + 2 + 8 + SETTLE_STABLE_TICKS);
    });
});

describe('useOnNpc', () => {
    const cows = START.inv('Bucket', 1, { id: 1925 }).npc('Cow', 3254, 3270, { index: 9 });
    const { inventory, nearbyNpcs } = cows.build();
    const bucket = inventory[0]!;
    const cow = nearbyNpcs[0]!;

    test('sends useItemOnNpc and settles on the inventory change', async () => {
        const milked = START.inv('Bucket of milk', 1, { id: 1927 }).npc('Cow', 3254, 3270, { index: 9 });
        const states = [cows.build(), ...Array.from({ length: 8 }, (_, i) => milked.tick(2 + i).build())];
        const { result, sends } = await runOp(states, ctx => useOnNpc(ctx, bucket, cow));
        expect(result).toEqual({ ok: true, effect: 'the inventory changed' });
        expect(sends).toEqual([{ type: 'useItemOnNpc', itemSlot: 0, npcIndex: 9, reason: 'use Bucket on Cow' }]);
    });

    test("the cow's refusal is a refusal", async () => {
        const states = [
            cows.build(),
            ...Array.from({ length: 3 }, (_, i) =>
                cows
                    .tick(2 + i)
                    .message("The cow doesn't want that.")
                    .build(),
            ),
        ];
        const { result } = await runOp(states, ctx => useOnNpc(ctx, bucket, cow));
        expect(result).toMatchObject({ ok: false, reason: 'refused' });
    });
});

describe('interact: dialog pages the client recorded', () => {
    const levelUp = ['Congratulations, you just advanced a Woodcutting level.'];

    test('a message box page alone is the effect (the Chaos altar)', async () => {
        const { result } = await runOp(
            after(x => x.recentDialog(['Snarthon Candtrick Termanto'])),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toEqual({ ok: true, effect: 'a dialog page appeared: "Snarthon Candtrick Termanto"' });
    });

    test('a level-up page alone is not the effect of a discarded op', async () => {
        const states = after(x => x.recentDialog(levelUp), INTERACT_WAIT_TICKS + 3).map((s, i) =>
            feedback(i === 0 ? 0 : 1)(s),
        );
        const { result } = await runOp(states, ctx => interact(ctx, coffin, /^open$/i));
        expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    });

    test('a refusal message beside a stray page is a failure, not the effect', async () => {
        const { result } = await runOp(
            after(x => x.message('Nothing interesting happens.').recentDialog(['Some NPC line'])),
            ctx => interact(ctx, coffin, /^open$/i),
        );
        expect(result).toMatchObject({ ok: false, reason: 'refused' });
    });
});

describe('interact: a move the game made across a guard interrupt', () => {
    // The dialog guard clicks a message box away: its handler's ticks never reach the wait's predicate.
    const dialogGuard: Guard = {
        name: 'dialog',
        policy: 'suspend',
        when: s => s.dialog.isOpen,
        *run() {
            yield* ticks(3);
        },
    };
    const ringer = START.player({ at: { x: 2762, z: 4694 } }).inv('Grail bell', 1, {
        id: 1234,
        options: [{ text: 'Ring', opIndex: 1 }],
    });
    const bell: InteractTarget = { kind: 'item', item: ringer.build().inventory[0]! };

    test('a two-tile teleport after a message box the guard handled is the effect of an item option', async () => {
        const states = [
            ringer.build(),
            ringer.tick(2).dialog({ options: [] }).build(),
            ...Array.from({ length: 6 }, (_, i) =>
                ringer
                    .tick(3 + i)
                    .player({ at: { x: 2761, z: 4692 } })
                    .build(),
            ),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, bell, /^ring$/i), {
            guards: [dialogGuard],
        });
        expect(result).toEqual({ ok: true, effect: 'the player moved to (2761,4692)' });
    });

    test('with no move the same item option is still no-effect', async () => {
        const states = [
            ringer.build(),
            ringer.tick(2).dialog({ options: [] }).build(),
            ...Array.from({ length: INTERACT_WAIT_TICKS + 6 }, (_, i) => ringer.tick(3 + i).build()),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, bell, /^ring$/i), { guards: [dialogGuard] });
        expect(result).toMatchObject({ ok: false });
    });

    test('a small step of the bot toward a loc over the guard ticks is not a move', async () => {
        const states = [
            w.build(),
            w.tick(2).dialog({ options: [] }).build(),
            ...Array.from({ length: INTERACT_WAIT_TICKS + 6 }, (_, i) => at(3224, 3218)(w.tick(3 + i)).build()),
        ];
        const { result } = await runOp(states, ctx => interact(ctx, coffin, /^open$/i), { guards: [dialogGuard] });
        expect(result).toMatchObject({ ok: false });
    });
});
