import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import type { Effect } from '../../core/drivers/timeline';
import items from '../../tasks/items';
import { type Page, dialogScript } from '../dialog-script';
import { walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const WIELD = [{ text: 'Wield', opIndex: 2 }];
const WORN_SLOT: Record<string, number> = { 'Adamant full helm': 0, 'Rune scimitar': 3, 'Adamant platebody': 4 };

/** The worn items at the slots the game uses (the builder numbers them 0, 1, 2...). */
const slotted = (s: BotWorldState): BotWorldState => ({
    ...s,
    equipment: s.equipment.map(e => ({ ...e, slot: WORN_SLOT[e.name] ?? e.slot })),
});
const geared = (extra: (w: World) => World = w => w) =>
    slotted(
        extra(
            world()
                .equipment(
                    { name: 'Adamant full helm', id: 1161 },
                    { name: 'Rune scimitar', id: 1333 },
                    { name: 'Adamant platebody', id: 1123 },
                )
                .inv('Rope', 1, { id: 954 }),
        ).build(),
    );
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/** A worn item taken off lands in the inventory; a wielded one leaves it for the equipment, next tick. */
function gearReact(action: BotAction, state: BotWorldState): Effect | undefined {
    if (action.type === 'useEquipmentItem') {
        const item = state.equipment.find(e => e.slot === action.slot);
        if (!item) return undefined;
        return s => ({
            ...s,
            equipment: s.equipment.filter(e => e.slot !== item.slot),
            inventory: [...s.inventory, { ...item, slot: s.inventory.length, optionsWithIndex: WIELD }],
        });
    }
    if (action.type === 'useInventoryItem') {
        const item = state.inventory.find(i => i.slot === action.slot);
        if (!item) return undefined;
        return s => ({
            ...s,
            inventory: s.inventory.filter(i => i.slot !== item.slot).map((i, slot) => ({ ...i, slot })),
            equipment: [...s.equipment, { ...item, slot: WORN_SLOT[item.name] ?? 9 }],
        });
    }
    return undefined;
}

describe('items: combine', () => {
    const unlit = world().inv('Tinderbox', 1).inv('Black candle', 1, { id: 38 });
    const lit = world().inv('Tinderbox', 1).inv('Lit black candle', 1, { id: 32 });
    const params = { combine: { use: '^Tinderbox$', on: '^Black candle$', product: '^Lit black candle$' } };

    test('uses the first item on the second and is done once the product shows', async () => {
        const r = await simulate(items, {
            params,
            timeline: unlit.series(8, (w, i) => (i >= 3 ? lit.tick(i) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: used ^Tinderbox$ on ^Black candle$');
        expect(r.sends).toEqual(['use Tinderbox on Black candle']);
    });

    test('without a product the target being used up is enough', async () => {
        const r = await simulate(items, {
            params: { combine: { use: 'Tinderbox', on: 'Black candle' } },
            timeline: unlit.series(8, (w, i) => (i >= 3 ? world().inv('Tinderbox', 1).tick(i) : w)),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toHaveLength(1);
    });

    test('an item id pins which item matches', async () => {
        const two = world().inv('Tinderbox', 1).inv('Black candle', 1, { id: 38 });
        const other = two.inv('Black candle', 1, { id: 99 });
        const r = await simulate(items, {
            params: { combine: { use: 'Tinderbox', on: { name: 'Black candle', id: 99 } } },
            timeline: other.series(1),
        });
        const sent = r.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
        expect(sent[0]).toMatchObject({ type: 'useItemOnItem', sourceSlot: 0, targetSlot: 1 });
        const miss = await simulate(items, {
            params: { combine: { use: 'Tinderbox', on: { name: 'Black candle', id: 99 } } },
            timeline: two.series(1),
        });
        expect(miss.result.reason).toBe('preflight: no Black candle in the inventory');
    });

    test('"nothing interesting happens" fails at once', async () => {
        const r = await simulate(items, {
            params,
            timeline: unlit.series(6, (w, i) => (i >= 2 ? w.message('Nothing interesting happens.') : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('combine: Nothing interesting happens.');
        expect(r.sends).toHaveLength(1);
    });

    test('an unrelated inventory change ending the use wait does not send a second use', async () => {
        const grind = { combine: { use: '^Pestle and mortar$', on: '^Charcoal$' } };
        const before = world().inv('Pestle and mortar', 1, { id: 233 }).inv('Charcoal', 1, { id: 973 });
        const r = await simulate(items, {
            params: grind,
            timeline: before.series(10, (w, i) =>
                i >= 3
                    ? world().inv('Pestle and mortar', 1, { id: 233 }).inv('Ground charcoal', 1, { id: 704 }).tick(i)
                    : i >= 2
                      ? world()
                            .inv('Pestle and mortar', 1, { id: 233 })
                            .inv('Charcoal', 1, { id: 973 })
                            .inv('Pottery', 1, { id: 1931 })
                            .tick(i)
                      : w,
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['use Pestle and mortar on Charcoal']);
    });

    test('a refusal message alongside the made product is not a failure', async () => {
        const grind = { combine: { use: '^Pestle and mortar$', on: '^Charcoal$' } };
        const r = await simulate(items, {
            params: grind,
            timeline: world()
                .inv('Pestle and mortar', 1, { id: 233 })
                .inv('Charcoal', 1, { id: 973 })
                .series(8, (w, i) =>
                    i >= 3
                        ? world()
                              .inv('Pestle and mortar', 1, { id: 233 })
                              .inv('Ground charcoal', 1, { id: 704 })
                              .message('Nothing interesting happens.')
                              .tick(i)
                        : w,
                ),
        });
        expect(r.result.status).toBe('done');
    });

    test('three uses in a row that show nothing fail', async () => {
        const r = await simulate(items, { params, timeline: unlit.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^combine: 3 tries in a row failed \(last: Timeout using Tinderbox/);
        expect(r.sends).toHaveLength(3);
    });

    test('uses that show an animation but change nothing fail naming the combine', async () => {
        const r = await simulate(items, {
            params: { combine: { use: '^Tinderbox$', on: '^Black candle$' } },
            timeline: unlit
                .series(40)
                .map((b, i) => (i >= 2 ? { ...b, player: { ...b.player!, animId: 1000 + i } } : b)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'combine: used Tinderbox on Black candle 3 times: nothing was used up and no product appeared (give `product` if both items are kept)',
        );
        expect(r.sends).toHaveLength(3);
    });

    test('a name matching different items is refused; an id pins it', async () => {
        const both = unlit.inv('Lit black candle', 1, { id: 32 });
        const vague = await simulate(items, {
            params: { combine: { use: 'Tinderbox', on: 'candle' } },
            timeline: both.series(1),
        });
        expect(vague.result.reason).toMatch(
            /^preflight: candle matches several different items \(Black candle, Lit black candle\): name one exactly or give \{name, id\}/,
        );
        const pinned = await simulate(items, {
            params: { combine: { use: 'Tinderbox', on: { name: 'candle', id: 38 } } },
            timeline: both.series(1),
        });
        expect(pinned.result.reason).not.toMatch(/^preflight/);
        expect(pinned.commands.flatMap(c => (c.type === 'send' ? [c.action] : []))[0]).toMatchObject({
            type: 'useItemOnItem',
            sourceSlot: 0,
            targetSlot: 1,
        });
    });

    test('refuses a missing item', async () => {
        const r = await simulate(items, { params, timeline: world().inv('Tinderbox', 1).series(1) });
        expect(r.result.reason).toBe('preflight: no ^Black candle$ in the inventory');
    });

    test('a leftover message box is cleared before the use', async () => {
        const r = await simulate(items, {
            params,
            timeline: unlit.dialog({ text: 'Well done', options: [] }).series(6, (w, i) => (i >= 2 ? lit.tick(i) : w)),
        });
        expect(r.steps[0]).toBe('baseline');
        expect(r.steps).toContain('clear-dialog');
    });
});

describe('items: params', () => {
    test('exactly one action', async () => {
        const none = await simulate(items, { params: {}, timeline: world().series(1) });
        expect(none.result.status).toBe('error');
        const two = await simulate(items, {
            params: { unequip: ['all'], equip: ['Rope'] },
            timeline: world().series(1),
        });
        expect(two.result.status).toBe('error');
    });

    test('choices belong to drop', async () => {
        const r = await simulate(items, {
            params: { unequip: ['all'], choices: ['x'] },
            timeline: [geared()],
        });
        expect(r.result.status).toBe('error');
    });
});

describe('items: drop', () => {
    const bones = world().inv('Bat bones', 1, { id: 530 }).inv('Tinderbox', 1);
    const params = { drop: [{ item: '^Bat bones$' }] };

    test('drops the named item and is done when it has left the inventory', async () => {
        const r = await simulate(items, { params, timeline: bones.series(10) });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['drop Bat bones']);
        expect(r.result.inventoryDelta).toEqual({ 'Bat bones': -1 });
    });

    test('never drops what is not named', async () => {
        const r = await simulate(items, {
            params: { drop: [{ item: '^Bat bones$', count: 2 }] },
            timeline: bones.inv('Bat bones', 3, { id: 530 }).series(10),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['drop Bat bones', 'drop Bat bones']);
        expect(r.driver.state().inventory.map(i => i.name)).toEqual(['Tinderbox', 'Bat bones']);
    });

    test('refuses a name that matches different items', async () => {
        const r = await simulate(items, {
            params: { drop: [{ item: 'bones' }] },
            timeline: bones.inv('Big bones', 1, { id: 532 }).series(1),
        });
        expect(r.result.reason).toMatch(/^preflight: bones matches several different items/);
    });

    test('another item matching the name that enters the pack mid-run is not dropped', async () => {
        const r = await simulate(items, {
            params: { drop: [{ item: 'bones', count: 2 }] },
            // Pinned to Bat bones at tick 0; a leftover dialog delays the drop; Big bones are in the pack by the time the drop step runs.
            timeline: [
                bones.inv('Bat bones', 2, { id: 530 }).dialog({ text: 'Well done', options: [] }).build(),
                ...bones.inv('Bat bones', 2, { id: 530 }).inv('Big bones', 1, { id: 532 }).series(6),
            ],
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('drop: bones matches several different items now: name one exactly');
        expect(r.sends.filter(x => x.startsWith('drop'))).toEqual([]);
    });

    test('refuses more slots than held, and an item not carried', async () => {
        const more = await simulate(items, {
            params: { drop: [{ item: 'Bat bones', count: 2 }] },
            timeline: bones.series(1),
        });
        expect(more.result.reason).toBe('preflight: 1 slots of Bat bones in the inventory, 2 to drop');
        const none = await simulate(items, { params: { drop: [{ item: 'Rope' }] }, timeline: bones.series(1) });
        expect(none.result.reason).toBe('preflight: no Rope in the inventory to drop');
    });

    test('walks to the spot first', async () => {
        const r = await simulate(items, {
            params: { ...params, at: { x: 2780, z: 3515, tolerance: 1 } },
            timeline: bones.player({ at: { x: 2790, z: 3515 } }).series(60),
            react: walking(),
        });
        expect(r.steps).toContain('walk');
        expect(r.sends.at(-1)).toBe('drop Bat bones');
    });

    test('a dialog the drop opens ends the wait, and stays open for the next task', async () => {
        const script = dialogScript([[]], a => a.type === 'dropItem');
        const r = await simulate(items, { params, timeline: bones.series(30), react: script.react });
        // The bones are not consumed: only the dialog says the drop did something.
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: dropping opened a dialog (left open)');
        expect(r.sends).toEqual(['drop Bat bones']);
        expect(r.driver.state().dialog.isOpen).toBe(true);
        expect(logged(r)).toEqual(['dropping ^Bat bones$ opened a dialog']);
    });

    test('with choices it answers the dialog the drop opens', async () => {
        const pages: Page[] = [
            [],
            ['Snarthtrick Candanto Termon', 'Snarthon Candtrick Termanto', 'Snarthanto Candon Termtrick'],
            [],
            null,
        ];
        const script = dialogScript(pages, a => a.type === 'dropItem');
        const r = await simulate(items, {
            params: { ...params, choices: ['Snarthon Candtrick Termanto'] },
            timeline: bones.series(40),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: dropping opened a dialog (answered)');
        expect(logged(r)).toContain('dialog: choosing "Snarthon Candtrick Termanto"');
    });

    test('a choice the dialog does not offer fails with its options', async () => {
        const script = dialogScript([['A', 'B'], null], a => a.type === 'dropItem');
        const r = await simulate(items, {
            params: { ...params, choices: ['Snarthon'] },
            timeline: bones.series(30),
            react: script.react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^answer: no option matching/);
    });

    test('a drop that shows nothing fails after three tries', async () => {
        const r = await simulate(items, { params, timeline: bones.series(1), react: () => undefined });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^drop: 3 drops in a row failed/);
    });
});

describe('items: unequip', () => {
    test('all takes every worn item off into the inventory', async () => {
        const r = await simulate(items, { params: { unequip: ['all'] }, timeline: [geared()], react: gearReact });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['remove Adamant full helm', 'remove Rune scimitar', 'remove Adamant platebody']);
        expect(r.driver.state().equipment).toEqual([]);
        expect(r.result.reason).toBe('finish: nothing worn matches all (3 taken off)');
    });

    test('a slot name takes off only that slot, an item name only that item', async () => {
        const slot = await simulate(items, { params: { unequip: ['weapon'] }, timeline: [geared()], react: gearReact });
        expect(slot.sends).toEqual(['remove Rune scimitar']);
        const named = await simulate(items, {
            params: { unequip: ['platebody', 'helm'] },
            timeline: [geared()],
            react: gearReact,
        });
        expect(named.sends).toEqual(['remove Adamant full helm', 'remove Adamant platebody']);
        expect(named.driver.state().equipment.map(e => e.name)).toEqual(['Rune scimitar']);
    });

    test('nothing worn there is already done', async () => {
        const r = await simulate(items, { params: { unequip: ['ring'] }, timeline: [geared()], react: gearReact });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
    });

    test('refuses when the inventory has no room for the worn items', async () => {
        const full = geared(w => w.inv('Logs', 26, { id: 1511 }));
        const r = await simulate(items, { params: { unequip: ['all'] }, timeline: [full], react: gearReact });
        expect(r.result.reason).toBe('preflight: the inventory has no room for 2 more worn items');
    });

    test('a pack that fills mid-run is reported as no room', async () => {
        const nearly = geared(w => w.inv('Logs', 26, { id: 1511 }));
        const r = await simulate(items, {
            params: { unequip: ['weapon'] },
            timeline: [nearly],
            react: a =>
                a.type === 'useEquipmentItem'
                    ? s =>
                          world(s)
                              .inv('Logs', 27, { id: 1511 })
                              .message('You do not have enough inventory space.')
                              .build()
                    : undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('unequip: No inventory room to take off Rune scimitar');
    });

    test('a name matching nothing worn or carried is refused', async () => {
        const r = await simulate(items, { params: { unequip: ['Dragon'] }, timeline: [geared()] });
        expect(r.result.reason).toBe('preflight: nothing named Dragon is worn or carried');
    });

    test('three takes off that show nothing fail', async () => {
        const r = await simulate(items, { params: { unequip: ['weapon'] }, timeline: [geared()] });
        expect(r.result.reason).toMatch(/^unequip: 3 tries in a row failed \(last: Failed to take off Rune scimitar/);
    });
});

describe('items: equip', () => {
    test('a shield and a two-handed weapon that push each other off fail instead of swapping forever', async () => {
        const gear = world()
            .inv('Rune kiteshield', 1, { id: 1201, options: WIELD })
            .inv('Rune 2h sword', 1, { id: 1319, options: WIELD });
        const r = await simulate(items, {
            params: { equip: ['kiteshield', '2h sword'] },
            timeline: [gear.build()],
            react: (action, state) => {
                if (action.type !== 'useInventoryItem') return undefined;
                const item = state.inventory.find(i => i.slot === action.slot);
                if (!item) return undefined;
                const shield = item.name.includes('shield');
                return s => {
                    const pushed = s.equipment.filter(e => e.name.includes('shield') !== shield);
                    return {
                        ...s,
                        inventory: [
                            ...s.inventory.filter(i => i.slot !== item.slot),
                            ...pushed.map(e => ({ ...e, optionsWithIndex: WIELD })),
                        ].map((i, slot) => ({ ...i, slot })),
                        equipment: [...s.equipment.filter(e => !pushed.includes(e)), { ...item, slot: shield ? 5 : 3 }],
                    };
                };
            },
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^equip: wearing Rune \S+ took .* off: they can't be worn together/);
        expect(r.sends.length).toBe(5);
    });

    const bag = world()
        .inv('Rune scimitar', 1, { id: 1333, options: WIELD })
        .inv('Adamant full helm', 1, { id: 1161, options: WIELD });

    test('wears each named item', async () => {
        const r = await simulate(items, {
            params: { equip: ['^Rune scimitar$', { name: 'full helm' }] },
            timeline: [bag.build()],
            react: gearReact,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['Wield Rune scimitar', 'Wield Adamant full helm']);
        expect(r.driver.state().equipment.map(e => e.name)).toEqual(['Rune scimitar', 'Adamant full helm']);
    });

    test('items already worn need nothing', async () => {
        const r = await simulate(items, { params: { equip: ['scimitar'] }, timeline: [geared()] });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([]);
    });

    test('an item not carried is refused; one that will not go on fails after three tries', async () => {
        const none = await simulate(items, { params: { equip: ['Dragon'] }, timeline: [geared()] });
        expect(none.result.reason).toBe('preflight: no Dragon in the inventory to wear');
        const stuck = await simulate(items, {
            params: { equip: ['scimitar'] },
            timeline: [bag.build()],
            react: () => undefined,
        });
        expect(stuck.result.reason).toMatch(/^equip: 3 tries in a row failed \(last: Failed to equip Rune scimitar/);
    });

    test('an item with no wield option fails at once', async () => {
        const r = await simulate(items, {
            params: { equip: ['Rope'] },
            timeline: [world().inv('Rope', 1, { id: 954 }).build()],
        });
        expect(r.result.reason).toBe('equip: No equip option on Rope');
    });
});

describe('items: combine choice', () => {
    const dough = world().inv('Pot of flour', 1, { id: 1933 }).inv('Bucket of water', 1, { id: 1929 });
    const made = world().inv('Pastry dough', 1, { id: 1953 });
    const MENU = ['Bread dough.', 'Pastry dough.', 'Pizza dough.', 'Pitta dough.'];
    const params = { combine: { use: '^Pot of flour$', on: '^Bucket of water$' } };
    const scripted = () => {
        const script = dialogScript([MENU, null], a => a.type === 'useItemOnItem');
        return {
            script,
            react: (a: BotAction, st: BotWorldState): Effect | undefined => {
                const eff = script.react(a, st);
                if (a.type !== 'clickDialogOption' || !eff) return eff;
                const chosen = st.dialog.options.find(o => o.index === a.optionIndex)?.text;
                return chosen === 'Pastry dough.' ? s => ({ ...eff(s), inventory: made.build().inventory }) : eff;
            },
        };
    };

    test('answers the menu the use opens with `choice`', async () => {
        const { react } = scripted();
        const r = await simulate(items, {
            params: { combine: { ...params.combine, choice: 'Pastry dough' } },
            timeline: dough.series(40),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual(['use Pot of flour on Bucket of water', 'dialog choice']);
        expect(r.driver.state().dialog.isOpen).toBe(false);
    });

    test('a menu with no `choice` fails naming the options and leaves it open', async () => {
        const { react } = scripted();
        const r = await simulate(items, { params, timeline: dough.series(40), react });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^combine: using Pot of flour on Bucket of water opened a choice \(Bread dough/,
        );
        expect(r.result.reason).toContain('give `choice`');
    });

    test('a `choice` the menu does not offer fails with its options', async () => {
        const { react } = scripted();
        const r = await simulate(items, {
            params: { combine: { ...params.combine, choice: 'Cake' } },
            timeline: dough.series(40),
            react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^answer: no option matching/);
    });

    /** Every use opens the menu; a click closes it and, from the `makeOn`th answer on, makes the product. */
    const everyUse = (makeOn: number) => {
        let answers = 0;
        return (a: BotAction): Effect | undefined => {
            if (a.type === 'useItemOnItem') return s => world(s).dialog({ text: 'menu', options: MENU }).build();
            if (a.type !== 'clickDialogOption') return undefined;
            const make = ++answers >= makeOn;
            return s => ({
                ...world(s).dialog(false).build(),
                ...(make ? { inventory: made.build().inventory } : {}),
            });
        };
    };

    test('a menu answered every time that never makes the product fails after three cycles', async () => {
        const r = await simulate(items, {
            params: { combine: { ...params.combine, choice: 'Pastry dough' } },
            timeline: dough.series(80),
            react: everyUse(Infinity),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('answered its menu 3 times');
        expect(r.sends.filter(x => x.startsWith('use '))).toHaveLength(3);
    });

    test('the menu is answered again on a second use when the first answer made nothing', async () => {
        const r = await simulate(items, {
            params: { combine: { ...params.combine, choice: 'Pastry dough' } },
            timeline: dough.series(80),
            react: everyUse(2),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([
            'use Pot of flour on Bucket of water',
            'dialog choice',
            'use Pot of flour on Bucket of water',
            'dialog choice',
        ]);
    });
});
