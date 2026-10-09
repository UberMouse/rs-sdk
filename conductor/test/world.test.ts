import { describe, expect, test } from 'bun:test';
import { loadFixture, world, worldState } from './world';

describe('world', () => {
    test('a bare world is a logged-in bot at Lumbridge with nothing around', () => {
        const s = world().build();
        expect(s.inGame).toBe(true);
        expect(s.player).toMatchObject({ worldX: 3222, worldZ: 3218, hp: 10, maxHp: 10 });
        expect([s.inventory, s.nearbyLocs, s.nearbyNpcs, s.groundItems, s.skills]).toEqual([[], [], [], [], []]);
    });

    test('methods return new worlds and never change the one they were called on', () => {
        const base = world();
        base.player({ hp: 1 }).inv('Logs', 3);
        expect(base.build().player?.hp).toBe(10);
        expect(base.build().inventory).toEqual([]);
        const built = base.build();
        built.inventory.push({ slot: 0, id: 1, name: 'x', count: 1, optionsWithIndex: [] });
        expect(base.build().inventory).toEqual([]);
    });

    test('player sets hp and combat, and moving it re-measures what is nearby', () => {
        const w = world().loc('Tree', 3225, 3218).npc('Man', 3222, 3221).ground('Logs', 3220, 3218);
        expect(w.build().nearbyLocs[0]?.distance).toBe(3);
        const moved = w.player({ at: { x: 3225, z: 3220 }, hp: 0, inCombat: true }).build();
        expect(moved.player).toMatchObject({ worldX: 3225, worldZ: 3220, isDead: true });
        expect(moved.player?.combat.inCombat).toBe(true);
        expect(moved.nearbyLocs[0]?.distance).toBe(2);
        expect(moved.nearbyNpcs[0]?.distance).toBe(3);
        expect(moved.groundItems[0]?.distance).toBe(5);
    });

    test('inv gives ids and options: food can be eaten, logs take a slot each, coins stack', () => {
        const s = world().inv('Shrimps', 2).inv('Logs', 3).inv('Coins', 500).build();
        expect(s.inventory.map(i => [i.slot, i.name, i.id, i.count])).toEqual([
            [0, 'Shrimps', 315, 1],
            [1, 'Shrimps', 315, 1],
            [2, 'Logs', 1511, 1],
            [3, 'Logs', 1511, 1],
            [4, 'Logs', 1511, 1],
            [5, 'Coins', 995, 500],
        ]);
        expect(s.inventory[0]?.optionsWithIndex).toEqual([{ text: 'Eat', opIndex: 1 }]);
    });

    test('inv replaces the count it had, and 0 removes the item', () => {
        const w = world().inv('Logs', 4).inv('Shrimps', 1).inv('Logs', 2);
        expect(w.build().inventory.map(i => i.name)).toEqual(['Shrimps', 'Logs', 'Logs']);
        expect(
            w
                .inv('Logs', 0)
                .build()
                .inventory.map(i => [i.slot, i.name]),
        ).toEqual([[0, 'Shrimps']]);
    });

    test('inv takes an id and options for an item the save generator does not know', () => {
        const s = world()
            .inv('Mystery', 1, { id: 9999, options: [{ text: 'Poke', opIndex: 3 }] })
            .build();
        expect(s.inventory[0]).toMatchObject({ id: 9999, optionsWithIndex: [{ text: 'Poke', opIndex: 3 }] });
        expect(() => world().inv('Mystery')).toThrow('unknown item "Mystery"');
    });

    test('inv refuses more than the 28 slots', () => {
        expect(() => world().inv('Logs', 29)).toThrow('no room');
    });

    test('loc, npc and ground list their options with 1-based op indexes', () => {
        const s = world()
            .loc('Tree', 3224, 3220, { options: ['Chop down', 'Examine'], reachable: false })
            .npc('Man', 3219, 3221, { options: ['Talk-to', 'Attack'], combatLevel: 2 })
            .npc('Goblin', 3220, 3221)
            .ground('Bones', 3222, 3219, 2)
            .build();
        expect(s.nearbyLocs[0]).toMatchObject({
            name: 'Tree',
            options: ['Chop down', 'Examine'],
            optionsWithIndex: [
                { text: 'Chop down', opIndex: 1 },
                { text: 'Examine', opIndex: 2 },
            ],
            distance: 2,
            reachable: false,
            level: 0,
        });
        expect(s.nearbyNpcs.map(n => [n.name, n.index, n.distance])).toEqual([
            ['Man', 1, 3],
            ['Goblin', 2, 3],
        ]);
        expect(s.groundItems[0]).toMatchObject({ name: 'Bones', id: 526, count: 2, distance: 1 });
    });

    test('dialog opens with options and closes again', () => {
        const open = world().dialog({ text: 'Hello', options: ['Yes', 'No'] });
        expect(open.build().dialog).toMatchObject({ isOpen: true, text: 'Hello' });
        expect(open.build().dialog.options.map(o => [o.index, o.text])).toEqual([
            [0, 'Yes'],
            [1, 'No'],
        ]);
        expect(open.dialog(false).build().dialog).toEqual({ isOpen: false, options: [], isWaiting: false });
    });

    test('skill adds a skill or updates it, keeping its xp unless given', () => {
        const w = world().skill('Woodcutting', 5, 388);
        expect(w.skill('Woodcutting', 6).build().skills).toEqual([
            { name: 'Woodcutting', level: 6, baseLevel: 6, experience: 388 },
        ]);
        expect(
            w
                .skill('Woodcutting', 5, 400)
                .skill('Mining', 1)
                .build()
                .skills.map(k => [k.name, k.experience]),
        ).toEqual([
            ['Woodcutting', 400],
            ['Mining', 0],
        ]);
    });

    test('a message carries the tick it was added on', () => {
        const s = world().tick(7).message('Oh dear, you are dead!').tick(8).build();
        expect(s.tick).toBe(8);
        expect(s.gameMessages).toEqual([
            { type: 0, text: 'Oh dear, you are dead!', sender: '', tick: 7, fromSelf: false },
        ]);
    });

    test('series makes one state per tick, varied by the edit', () => {
        const states = world()
            .tick(3)
            .series(4, (w, i) => w.skill('Woodcutting', 1, i * 25));
        expect(states.map(s => s.tick)).toEqual([3, 4, 5, 6]);
        expect(states.map(s => s.skills[0]?.experience)).toEqual([0, 25, 50, 75]);
    });

    test('worldState is the one-state shorthand', () => {
        const s = worldState(4, { hp: 3, food: 2, z: 3200, dead: true, dialog: true, xp: 10, level: 2 });
        expect(s.tick).toBe(4);
        expect(s.player).toMatchObject({ hp: 3, worldZ: 3200 });
        expect(s.inventory.map(i => i.name)).toEqual(['Shrimps', 'Shrimps']);
        expect(s.gameMessages[0]).toMatchObject({ text: 'Oh dear, you are dead!', tick: 4 });
        expect(s.dialog.isOpen).toBe(true);
        expect(s.skills).toEqual([{ name: 'Woodcutting', level: 2, baseLevel: 2, experience: 10 }]);
    });
});

describe('fixtures', () => {
    test('a captured fixture is a complete state to build on', () => {
        const base = loadFixture('lumbridge');
        expect(base.player).not.toBeNull();
        const s = world('lumbridge').player({ hp: 2 }).inv('Bread', 1).build();
        expect(s.player?.hp).toBe(2);
        expect(s.nearbyLocs.length).toBe(base.nearbyLocs.length);
        expect(s.inventory.some(i => i.name === 'Bread')).toBe(true);
    });
});
