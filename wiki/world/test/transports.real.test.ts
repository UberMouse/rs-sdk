// Ship routes and the Entrana loadout rule read from the real scripts (sources/transports.ts,
// sources/loadout.ts), and the curated transports (gates.ts) placed on the real spawns.
import { describe, expect, test } from 'bun:test';
import { CURATED_TRANSPORTS, LOADOUT_PROCS, QUEST_OVERRIDES, TRANSPORTS_OUT_OF_SCOPE } from '../gates';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { deriveLoadoutRules } from '../sources/loadout';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { deriveQuests, scanQuestCalls } from '../sources/quests';
import { curatedTransports, deriveSails } from '../sources/transports';
import { parseCallables, parseTriggers, readScripts } from '../sources/triggers';
import type { Transport } from '../types';

const scripts = readScripts();
const triggers = scripts.flatMap(([f, t]) => parseTriggers(f, t));
const callables = scripts.flatMap(([f, t]) => parseCallables(f, t));
const constants = readConstants();
const npcPack = readPack('npc');
const locPack = readPack('loc');
const map = readAllMapSquares();
const spawns = map.npcs.flatMap(n => {
    const config = npcPack.name.get(n.id);
    return config ? [{ config, tile: n.tile }] : [];
});
const placed = map.locs.flatMap(l => {
    const config = locPack.name.get(l.id);
    return config ? [{ config, tile: l.tile }] : [];
});
const { quests } = deriveQuests({
    scan: scanQuestCalls(scripts),
    constants,
    varps: readPack('varp'),
    varbits: readConfigs('varbit'),
    overrides: QUEST_OVERRIDES,
    decreasing: {},
});
const sails = deriveSails({
    files: scripts,
    triggers,
    callables,
    constants,
    npcConfigs: readConfigs('npc'),
    spawns,
    quests,
    loadoutProcs: LOADOUT_PROCS,
});
const route = (r: string): Transport[] => sails.transports.filter(t => t.route === r);

describe('the Entrana loadout rule', () => {
    const { entrana } = deriveLoadoutRules(LOADOUT_PROCS, callables);

    test('is read from has_entrana_restricted_items', () =>
        expect(entrana?.source).toBe('areas/area_port_sarim/scripts/monk_of_entrana.rs2:26'));

    test('bans 23 armour and weapon categories carried or worn, and cannon parts carried', () => {
        const categories = Object.entries(entrana!.forbidCategories);
        expect(categories.filter(([, scope]) => scope === 'both').map(([c]) => c)).toHaveLength(23);
        expect(categories.filter(([c]) => !/^(armour|weapon)_/.test(c))).toEqual([['cannon_parts', 'carried']]);
        // By category, not equip slot: axes and pickaxes are weapons to the monk.
        expect(entrana!.forbidCategories).toMatchObject({ weapon_axe: 'both', weapon_pickaxe: 'both' });
    });
});

describe('ship routes', () => {
    test('Port Sarim to Karamja: 30 coins with any of the three sailors, landing on the ship at Musa Point', () =>
        expect(route('port_sarim_to_karamja').map(t => [t.npc, t.to, t.fare, t.requires, t.source, t.paidAt])).toEqual(
            ['captain_tobias', 'seaman_lorris', 'seaman_thresnor'].map(npc => [
                npc,
                { level: 1, x: 2956, z: 3143 },
                30,
                ['coins:30'],
                // The ~set_sail call, and the inv_del that takes the 30 coins.
                'areas/area_port_sarim/scripts/sailors.rs2:31',
                ['areas/area_port_sarim/scripts/sailors.rs2:29'],
            ]),
        ));

    test('the Entrana boat needs a members world and the Entrana loadout, and is free', () => {
        const rows = route('port_sarim_to_entrana');
        expect(rows.length).toBeGreaterThan(0);
        for (const t of rows)
            expect([t.npc, t.to, t.fare, t.requires]).toEqual([
                'shipmonk',
                { level: 1, x: 2834, z: 3331 },
                0,
                ['loadout:entrana', 'members'],
            ]);
    });

    test('Karamja back to Port Sarim is 30 coins with the customs officer at Musa Point', () => {
        const rows = route('karamja_to_port_sarim');
        expect(rows.length).toBeGreaterThan(0);
        for (const t of rows) {
            expect([t.npc, t.to, t.requires]).toEqual([
                'customs_officer',
                { level: 1, x: 3032, z: 3217 },
                ['coins:30'],
            ]);
            // The officer east of x 2815 (customs_officer.rs2:81); the Brimhaven one sails to Ardougne.
            expect(t.from.x).toBeGreaterThanOrEqual(2815);
        }
    });

    test('every route an npc sells is derived; the Crandor ones only sail in a quest window', () => {
        expect([...new Set(sails.transports.map(t => t.route))].sort()).toEqual([
            'ardougne_to_brimhaven',
            'brimhaven_to_ardougne',
            'cairn_to_port_khazard',
            'cairn_to_port_sarim',
            'entrana_to_port_sarim',
            'karamja_to_port_sarim',
            'port_sarim_to_entrana',
            'port_sarim_to_karamja',
        ]);
        expect(sails.unusedRoutes).toEqual(['crandor_to_port_sarim', 'port_sarim_to_crandor']);
        expect(sails.windows.every(w => w.startsWith('dragonslayer_ned '))).toBe(true);
        expect(sails.underived).toEqual([]);
    });

    test('Captain Shanks needs Shilo Village, and a ticket or the most his random price asks', () =>
        expect([...new Set(route('cairn_to_port_sarim').map(t => `${t.fare} ${t.requires.join(' ')}`))].sort()).toEqual(
            ['0 consume:shiloshipticket:1 quest:zombiequeen', '45 coins:45 quest:zombiequeen'],
        ));

    test('the only sail sites no npc op reaches are the ones gates.ts lists out of scope', () => {
        const outOfScope = new Set(TRANSPORTS_OUT_OF_SCOPE.map(o => o.script));
        expect(sails.unreached.filter(at => !outOfScope.has(at))).toEqual([]);
        expect(sails.unreached).toEqual([
            'minigames/game_trawler/scripts/trawler_start.rs2:36',
            'minigames/game_trawler/scripts/trawler_win.rs2:44',
        ]);
    });
});

test('the curated transports land on the spawns of their npcs and the placed locs of their locs', () =>
    expect(
        curatedTransports(CURATED_TRANSPORTS, spawns, placed).map(t => [t.npc ?? t.loc, t.from, t.to, t.requires]),
    ).toEqual([
        [
            'brimhavencartdriver',
            { level: 0, x: 2779, z: 3211 },
            { level: 0, x: 2834, z: 2951 },
            ['coins:10', 'quest:zombiequeen'],
        ],
        ['shilocartdriver', { level: 0, x: 2834, z: 2954 }, { level: 0, x: 2776, z: 3214 }, ['coins:10']],
        // Troll Romance's sled: each barrier tile rides to the foot of its own piste (quest_troll_love.rs2:219, 288).
        ...[
            [
                { level: 0, x: 2785, z: 3771 },
                { level: 0, x: 2794, z: 3719 },
            ],
            [
                { level: 0, x: 2786, z: 3771 },
                { level: 0, x: 2794, z: 3719 },
            ],
            [
                { level: 0, x: 2772, z: 3835 },
                { level: 0, x: 2790, z: 3794 },
            ],
            [
                { level: 0, x: 2773, z: 3835 },
                { level: 0, x: 2790, z: 3794 },
            ],
        ].map(([from, to]) => [
            'trollromance_piste_walk_barrier_down',
            from,
            to,
            ['item:trollromance_toboggon_waxed:worn', 'skill:agility:28'],
        ]),
    ]));
