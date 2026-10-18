// The curated crossings in the committed world.json (sources/curated-crossings.ts, gates.ts CURATED_CROSSINGS) and the
// Miscellania longship (gates.ts CURATED_TRANSPORTS): Ape Atoll by Monkey Madness's rides, Miscellania's bank by the
// longship, the Fisher Realm by the whistle, the spirit trees, the gliders and the Burthorpe Games Room stairs, with
// what each needs; and the transports left out of scope are only the Trawler's and Holgart's.
import { describe, expect, test } from 'bun:test';
import { TRANSPORTS_OUT_OF_SCOPE } from '../gates';
import { loadWorld } from '../load';
import type { Crossing } from '../types';

const world = loadWorld();
const site = (id: string) => world.sites.find(s => s.id === id)!;
const rowsBy = (source: string): Crossing[] => world.crossings.filter(c => c.source.startsWith(source));
const button = (c: Crossing) => (c.act.kind === 'interface' ? c.act.component : '');

describe('Ape Atoll, by Monkey Madness', () => {
    test('its beach is reached once the quest and its training are done, its town with a greegree worn too', () => {
        // Daero takes a player past the training to the hangar (mm_daero.rs2:8, :235), Waydar flies them to Crash
        // Island, Lumdo rows them to the atoll; the town's gates ask a greegree (quest_mm.rs2:1114).
        expect(site('tree:ape-atoll:22').reach).toEqual([['quest:mm>=10']]);
        expect(site('fishing-spot:ape-atoll:0').reach).toEqual([['quest:mm>=10']]);
        expect(site('shop:ape-atoll:0').reach).toEqual([['category:mm_greegree:worn', 'quest:mm>=10']]);
    });

    test('the way back: Lumdo on the atoll rows to Crash Island free, Waydar there flies to the Gnomeball pitch', () => {
        const [lumdo, ...moreLumdo] = rowsBy('quests/quest_mm/scripts/mm_lumdo.rs2:11');
        expect(moreLumdo).toEqual([]);
        expect(lumdo).toMatchObject({ act: { kind: 'npc-op', npc: 'mm_lumdo', op: 1 }, requires: [[]] });
        expect(lumdo!.landings.map(l => l.tile)).toEqual([{ level: 0, x: 2894, z: 2726 }]);
        const [waydar, ...moreWaydar] = rowsBy('quests/quest_mm/scripts/mm_waydar.rs2:125');
        expect(moreWaydar).toEqual([]);
        expect(waydar!.act).toEqual({
            kind: 'npc-op',
            npc: 'mm_waydar',
            op: 1,
            choices: ['I need to return to your kingdom.'],
        });
        expect(waydar!.landings.map(l => l.tile)).toEqual([{ level: 0, x: 2393, z: 3466 }]);
    });

    test("Waydar flies to Crash Island from each hangar's spawn, not from the island", () => {
        const rows = rowsBy('quests/quest_mm/scripts/mm_waydar.rs2:116');
        expect(rows.map(c => c.at.z).sort()).toEqual([4519, 4519, 9895]);
        for (const c of rows) expect(c.requires).toEqual([['quest:mm']]);
    });
});

describe('Miscellania, by the longship', () => {
    test("its bank is reached by the Rellekka sailor's longship once The Fremennik Trials is done", () => {
        expect(site('bank:miscellania-bank:0').reach).toEqual([['quest:viking']]);
        const ships = world.transports.filter(t => t.npc === 'viking_sailor' || t.npc === 'misc_sailor');
        expect(ships.map(t => [t.npc, t.requires])).toEqual([
            ['misc_sailor', []],
            ['viking_sailor', ['quest:viking']],
        ]);
    });
});

describe('the Fisher Realm, by the whistle', () => {
    test("its fishing spot is reached with the whistle and Holy Grail done, on Karamja's ways (the ship or the glider)", () => {
        expect(site('fishing-spot:fisher-realm:0').reach).toEqual([
            ['coins:30', 'item:magic_whistle:held', 'quest:grail'],
            ['item:magic_whistle:held', 'quest:grail', 'quest:grandtree'],
        ]);
        // Out by the whistle again, to a bank.
        expect(site('fishing-spot:fisher-realm:0').nearest?.bank?.requires).toContain('item:magic_whistle:held');
    });

    test('the way in lands on the tiles the player steps to out of the oak the script puts them in', () => {
        const [into] = rowsBy('quests/quest_grail/scripts/quest_grail.rs2:41');
        expect(into!.act).toEqual({ kind: 'item-op', obj: 'magic_whistle', op: 1 });
        // inzone(0_42_50_52_34, 0_42_50_55_37, coord) (quest_grail.rs2:37): its tiles on walkable land.
        expect(into!.from.every(t => t.x >= 2740 && t.x <= 2743 && t.z >= 3234 && t.z <= 3237)).toBe(true);
        const oak = { level: 0, x: 2678, z: 4715 };
        expect(into!.landings.map(l => l.tile)).not.toContainEqual(oak);
        for (const l of into!.landings)
            expect(Math.max(Math.abs(l.tile.x - oak.x), Math.abs(l.tile.z - oak.z))).toBe(1);
    });
});

describe('the spirit trees and the gliders', () => {
    test('each spirit tree sends the player to the trees its menu names, under its quest on a members world', () => {
        const trees = rowsBy('areas/area_gnome/scripts/spirit_tree.rs2:74');
        const ent = trees.filter(c => c.act.kind === 'loc-op' && c.act.loc === 'ent');
        expect(ent.map(c => c.act.kind === 'loc-op' && c.act.choices)).toEqual([
            ['Where can I go?', 'Tree Gnome Village.'],
            ['Where can I go?', 'Forest north of Varrock.'],
            ['Where can I go?', 'Battlefield of Khazard.'],
        ]);
        for (const c of ent) expect(c.requires).toEqual([['members', 'quest:grandtree']]);
    });

    test('the gliders fly from Ta Quir Priw to the four others, and from three of them back', () => {
        const flights = rowsBy('areas/area_gnome/scripts/gnome_glider.rs2:22');
        const fromHub = flights.filter(c => c.at.level === 3).map(button);
        expect(fromHub.sort()).toEqual([
            'glidermap:com_21',
            'glidermap:com_23',
            'glidermap:com_24',
            'glidermap:com_25',
        ]);
        const back = flights.filter(c => c.at.level === 0);
        expect(back.map(button)).toEqual(['glidermap:com_22', 'glidermap:com_22', 'glidermap:com_22']);
        for (const c of flights) expect(c.requires).toEqual([['members', 'quest:grandtree']]);
    });
});

test('the Burthorpe Games Room stairs land on the six tiles their random draw gives, each way', () => {
    for (const source of ['ladders+stairs/scripts/stairs.rs2:491', 'ladders+stairs/scripts/stairs.rs2:515']) {
        const [row, ...more] = rowsBy(source);
        expect(more).toEqual([]);
        expect(row!.landings).toHaveLength(6);
    }
    expect(site('shop:burthorpe-games-room:1').reach).toEqual([[]]);
});

test('the transports left out of scope are the Fishing Trawler and Holgart', () => {
    expect(TRANSPORTS_OUT_OF_SCOPE.map(o => o.what)).toEqual([
        'the Fishing Trawler boat (journey 11)',
        'the Fishing Trawler return (journey 12)',
        'Holgart’s boats to the fishing platform and back',
    ]);
});
