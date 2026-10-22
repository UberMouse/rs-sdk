import { describe, expect, test } from 'bun:test';
import { readGameData } from '../model/families/index';
import { parseConfigs } from '../sources/configs';
import { readDropTables, type DropContext } from '../sources/droptables';

// Paths are under server/content/scripts/drop tables/scripts/ unless they say otherwise.
const data = readGameData();
const tables = readDropTables(data);

/** The counts are `expected` exactly (to float rounding), no obj more or less. */
function expectCounts(npc: string, ctx: DropContext, expected: Record<string, number>): void {
    const got = Object.fromEntries(tables(npc, ctx).counts);
    expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort());
    for (const [obj, n] of Object.entries(expected)) expect([obj, got[obj]!]).toEqual([obj, expect.closeTo(n, 12)]);
}

/** `~randomherb` (shared_droptables.rs2:2-34): random(128), members, each herb its slice; times `share`. */
const herbs = (share: number): Record<string, number> => {
    const slices: [string, number][] = [
        ['unidentified_guam', 32],
        ['unidentified_marentill', 24],
        ['unidentified_tarromin', 18],
        ['unidentified_harralander', 14],
        ['unidentified_ranarr', 11],
        ['unidentified_irit', 8],
        ['unidentified_avantoe', 6],
        ['unidentified_kwuarm', 5],
        ['unidentified_cadantine', 4],
        ['unidentified_lantadyme', 3],
        ['unidentified_dwarf_weed', 3],
    ];
    return Object.fromEntries(slices.map(([o, n]) => [o, (share * n) / 128]));
};

/**
 * `~randomjewel` (shared_droptables.rs2:37-77) with no ring of wealth: random(128); sapphire 0-31, emerald 32-47, ruby
 * 48-55, diamond 56-57, 5 rune javelins 58, keyhalf1 59, keyhalf2 60, and 61-64 a talisman (legends not complete, so
 * :68 passes 61 on), chaos below the surface (z > 6400, :71-72); 65-127 return nothing. Times `share`.
 */
const jewels = (share: number): Record<string, number> => ({
    uncut_sapphire: (share * 32) / 128,
    uncut_emerald: (share * 16) / 128,
    uncut_ruby: (share * 8) / 128,
    uncut_diamond: (share * 2) / 128,
    rune_javelin: (share * 5) / 128,
    keyhalf1: share / 128,
    keyhalf2: share / 128,
    chaos_talisman: (share * 4) / 128,
});

/** Underground (Edgeville dungeon's moss giants are at z 9903, phase 4 survey §5), legends quest not done. */
const DUNGEON: DropContext = { varps: { legendsquest: 0 }, coord: { level: 0, x: 3158, z: 9903 } };

describe('drop tables of the seed NPCs (phase 4 survey §1.8)', () => {
    test('giant (hill giant): giant.rs2, by hand', () => {
        // :7 big_bones (all.npc's death_drop for giant); then random(128) (:9), each branch its slice:
        // 0-4 iron_full_helm (:11-12), 5-8 iron_dagger, 9-11 iron_kiteshield, 12-13 steel_longsword, 14-19 3 iron_arrow,
        // 20-22 15 firerune, 23-25 7 waterrune, 26-28 2 lawrune, 29-30 10 steel_arrow, 31-32 3 mindrune, 33-34 2
        // cosmicrune, 35-36 6 naturerune, 37 2 chaosrune, 38 2 deathrune, 39-45 ~randomherb (:39-40), coins 46-59 x38,
        // 60-67 x15, 68-69 x52, 70-73 x8, 74-75 x88 (:41-50: 532 + 120 + 104 + 32 + 176 = 964), 76-86 limpwurt_root,
        // 87-92 beer, 93-94 body_talisman, 95-97 ~randomjewel (:57-58), 98-127 nothing.
        expectCounts('giant', DUNGEON, {
            big_bones: 1,
            iron_full_helm: 5 / 128,
            iron_dagger: 4 / 128,
            iron_kiteshield: 3 / 128,
            steel_longsword: 2 / 128,
            iron_arrow: (6 * 3) / 128,
            firerune: (3 * 15) / 128,
            waterrune: (3 * 7) / 128,
            lawrune: (3 * 2) / 128,
            steel_arrow: (2 * 10) / 128,
            mindrune: (2 * 3) / 128,
            cosmicrune: (2 * 2) / 128,
            naturerune: (2 * 6) / 128,
            chaosrune: 2 / 128,
            deathrune: 2 / 128,
            ...herbs(7 / 128),
            coins: 964 / 128,
            limpwurt_root: 11 / 128,
            beer: 6 / 128,
            body_talisman: 2 / 128,
            ...jewels(3 / 128),
        });
        expect(tables('giant', DUNGEON).at).toBe('drop tables/scripts/giant.rs2:1');
    });

    test('mossgiant: moss_giant.rs2, by hand', () => {
        // :8 big_bones; random(128) (:10): 0-4 black_sq_shield, 5-6 magic_staff, 7-8 steel_med_helm, 9-10 mithril_sword,
        // 11-12 mithril_spear (members, :20-22), 13 steel_kiteshield, 14-17 3 lawrune, 18-20 18 airrune, 21-23 27
        // earthrune, 24-26 7 chaosrune, 27-29 6 naturerune, 30-31 2 cosmicrune, 32-33 15 iron_arrow, 34 30 steel_arrow,
        // 35 3 deathrune, 36 bloodrune (members, :46-48), 37-41 ~randomherb, coins 42-60 x37, 61-68 x2, 69-78 x119,
        // 79-80 x300 (703 + 16 + 1190 + 600 = 2509), 81-86 steel_bar, 87 coal, 88 spinach_roll, 89-92 ~randomjewel
        // (:68-69), 93-127 nothing.
        expectCounts('mossgiant', DUNGEON, {
            big_bones: 1,
            black_sq_shield: 5 / 128,
            magic_staff: 2 / 128,
            steel_med_helm: 2 / 128,
            mithril_sword: 2 / 128,
            mithril_spear: 2 / 128,
            steel_kiteshield: 1 / 128,
            lawrune: (4 * 3) / 128,
            airrune: (3 * 18) / 128,
            earthrune: (3 * 27) / 128,
            chaosrune: (3 * 7) / 128,
            naturerune: (3 * 6) / 128,
            cosmicrune: (2 * 2) / 128,
            iron_arrow: (2 * 15) / 128,
            steel_arrow: 30 / 128,
            deathrune: 3 / 128,
            bloodrune: 1 / 128,
            ...herbs(5 / 128),
            coins: 2509 / 128,
            steel_bar: 6 / 128,
            coal: 1 / 128,
            spinach_roll: 1 / 128,
            ...jewels(4 / 128),
        });
    });

    test('chicken: the _chicken category trigger, chicken.rs2, by hand', () => {
        // :7 bones (the .param default), :11 the medium clue left out, :14 one raw_chicken, then random(128): 0-31 15
        // feathers, 32-63 5 feathers (:16-21): 32/128 x 15 + 32/128 x 5 = 3.75 + 1.25 = 5.
        expectCounts('chicken', {}, { bones: 1, raw_chicken: 1, feather: 5 });
        expect(tables('chicken').at).toBe('drop tables/scripts/chicken.rs2:2');
    });

    test('goblin: the @goblin_drop_table label, goblin.rs2, by hand', () => {
        // :2 jumps to the label (:7); :14 bones; random(128) (:19): 0 1 coin, 1 brass_necklace, 2 air_talisman, 3-4 beer,
        // 5-6 20 coins, 7-9 15 coins, 10-12 9 coins, 13-15 bronze_sq_shield, 16-18 4 earthrune, 19-21 8 bolt, 22-24
        // chefs_hat, 25-28 bronze_spear (members, :46-48), 29-33 7 bodyrune, 34-38 goblin_armour, 39-44 6 waterrune,
        // 45-62 5 coins (:56-57), 63-127 nothing. Coins: 1 + 40 + 45 + 27 + 90 = 203.
        expectCounts(
            'goblin',
            {},
            {
                bones: 1,
                coins: 203 / 128,
                brass_necklace: 1 / 128,
                air_talisman: 1 / 128,
                beer: 2 / 128,
                bronze_sq_shield: 3 / 128,
                earthrune: (3 * 4) / 128,
                bolt: (3 * 8) / 128,
                chefs_hat: 3 / 128,
                bronze_spear: 4 / 128,
                bodyrune: (5 * 7) / 128,
                goblin_armour: 5 / 128,
                waterrune: (6 * 6) / 128,
            },
        );
        expect(tables('goblin').at).toBe('drop tables/scripts/goblin.rs2:2');
    });

    test('~randomjewel with a ring of wealth, the legends quest done, and above ground', () => {
        // A giant's 3/128 jewel share. Ring: random(65) (:40-41), so 0-64 all drop. 61 with legends complete
        // (^legends_complete = 75, :68) is ~megararetable: random(128), 0-7 rune_spear (:128). 62-64 a talisman, nature
        // at z 3500 (:73-74).
        const ctx: DropContext = {
            worn: ['ring_of_wealth'],
            varps: { legendsquest: 75 },
            coord: { level: 0, x: 3100, z: 3500 },
        };
        const got = tables('giant', ctx).counts;
        expect(got.get('uncut_sapphire')).toBeCloseTo((3 / 128) * (32 / 65), 12);
        expect(got.get('rune_spear')).toBeCloseTo((3 / 128) * (1 / 65) * (8 / 128), 12);
        expect(got.get('nature_talisman')).toBeCloseTo((3 / 128) * (3 / 65), 12);
        expect(got.has('chaos_talisman')).toBe(false);
    });

    test('~roll_on_drop_table on the one drop_table row the game has (skill_mining gem_rock_table)', () => {
        // No NPC's death script calls it; a scripted trigger runs the real proc (drop_table.rs2:1-20) on the real row
        // (skill_mining/configs/gem_rock_table.dbrow): total 128, opal 60, jade 30, red topaz 15, sapphire 9, emerald 5,
        // ruby 5, diamond 4 (sum 128), each one gem.
        const gems = readDropTables({
            ...data,
            npcs: new Map([...data.npcs, ...parseConfigs('[gem_tester]')]),
            scripts: [
                ...data.scripts,
                [
                    'test.rs2',
                    '[ai_queue3,gem_tester]\ndef_namedobj $gem;\ndef_int $count;\n' +
                        '$gem, $count = ~roll_on_drop_table(gem_rock_table);\n' +
                        'obj_add(npc_coord, $gem, $count, ^lootdrop_duration);',
                ],
            ],
        });
        expect(Object.fromEntries(gems('gem_tester').counts)).toEqual({
            uncut_opal: 60 / 128,
            uncut_jade: 30 / 128,
            uncut_red_topaz: 15 / 128,
            uncut_sapphire: 9 / 128,
            uncut_emerald: 5 / 128,
            uncut_ruby: 5 / 128,
            uncut_diamond: 4 / 128,
        });
    });

    test('coverage: how many npcs have a table the evaluator settles (reported, not asserted)', () => {
        let settled = 0;
        const raised = new Map<string, number>();
        for (const npc of [...data.npcs.keys()].sort()) {
            try {
                tables(npc, DUNGEON);
                settled++;
            } catch (e) {
                const why = (e as Error).message.match(/\(([^)]+:\d+)\)/)?.[1] ?? (e as Error).message;
                raised.set(why, (raised.get(why) ?? 0) + 1);
            }
        }
        const count = [...raised.values()].reduce((a, b) => a + b, 0);
        console.log(`drop tables: ${settled} npcs settle, ${count} raise, at ${raised.size} script lines`);
        expect(settled + count).toBe(data.npcs.size);
    });
});
