import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { INTERACT_WAIT_TICKS, interact, type InteractTarget } from '../../actions/interaction';
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
