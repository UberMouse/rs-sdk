// The gate scan on the real scripts (sources/gate-scan.ts), the curated verdicts (gates.ts GATES) and their
// placed locs.
import { describe, expect, test } from 'bun:test';
import { GATES, LOADOUT_PROCS, QUEST_OVERRIDES, USE_GATES } from '../gates';
import { toolCheckers } from '../sources/conditions';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { CROSS, gatedSets, placeGates, reviewGates, scanGates, type CuratedGate } from '../sources/gate-scan';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { deriveQuests, scanQuestCalls } from '../sources/quests';
import { parseCallables, parseQueues, parseTriggers, readScripts } from '../sources/triggers';

const scripts = readScripts();
const triggers = scripts.flatMap(([f, t]) => parseTriggers(f, t));
const callables = scripts.flatMap(([f, t]) => parseCallables(f, t));
const constants = readConstants();
const { quests } = deriveQuests({
    scan: scanQuestCalls(scripts),
    constants,
    varps: readPack('varp'),
    varbits: readConfigs('varbit'),
    overrides: QUEST_OVERRIDES,
    decreasing: {},
});
const locConfigs = readConfigs('loc');
const objConfigs = readConfigs('obj');
const { tools, skipped } = toolCheckers(
    callables,
    new Map([...objConfigs].flatMap(([obj, cfg]) => (cfg.category?.[0] ? [[obj, cfg.category[0]]] : []))),
);
const candidates = scanGates({
    triggers,
    callables,
    queues: scripts.flatMap(([f, t]) => parseQueues(f, t)),
    constants,
    quests,
    loadoutProcs: LOADOUT_PROCS,
    names: new Set([...objConfigs.keys(), ...locConfigs.keys(), ...readConfigs('npc').keys()]),
    tools,
});
const scanned = (trigger: string) => candidates.find(c => c.trigger === trigger);
const curated = (trigger: string): CuratedGate | undefined => GATES.find(e => e.trigger === trigger);
const locPack = readPack('loc');
const { gates } = placeGates({
    curated: GATES,
    candidates,
    triggers,
    locConfigs,
    locs: readAllMapSquares().locs.flatMap(l => {
        const config = locPack.name.get(l.id);
        return config === undefined ? [] : [{ config, tile: l.tile, shape: l.shape, rotation: l.rotation }];
    }),
    quests,
    constants,
});

describe('the calibration gates: what the scan proposes and gates.ts confirms', () => {
    test('the Al Kharid toll gate: 10 coins, or free from ^prince_saved', () => {
        for (const side of ['left', 'right']) {
            const trigger = `oploc1,border_gate_toll_${side}`;
            const sets = [['coins:10'], ['quest:prince>=100']];
            expect(scanned(trigger)?.kind).toBe('gate');
            expect(gatedSets(scanned(trigger)?.moves.find(m => m.to === CROSS))).toEqual(sets);
            expect(scanned(trigger)?.stages).toEqual({ 'quest:prince>=100': '^prince_saved' });
            expect(curated(trigger)).toMatchObject({ kind: 'gate', requires: sets });
        }
    });

    test("the Cooking Guild: 32 Cooking and a chef's hat, from outside (across from the loc's tile)", () => {
        const sets = [['item:chefs_hat:worn', 'skill:cooking:32']];
        expect(gatedSets(scanned('oploc1,chefdoor')?.moves[0])).toEqual(sets);
        expect(curated('oploc1,chefdoor')).toMatchObject({ kind: 'gate', requires: sets, from: 'far' });
    });

    test("the Crafting Guild: 40 Crafting and a brown apron, from the loc's own tile", () => {
        const sets = [['item:brown_apron:worn', 'skill:crafting:40']];
        expect(gatedSets(scanned('oploc1,crafting_guild_door')?.moves[0])).toEqual(sets);
        expect(curated('oploc1,crafting_guild_door')).toMatchObject({ kind: 'gate', requires: sets, from: 'loc' });
    });

    test('the Ranging Guild: 40 Ranged, from outside its north-west door', () => {
        expect(gatedSets(scanned('oploc1,ranging_guild_door')?.moves[0])).toEqual([['skill:ranged:40']]);
        expect(curated('oploc1,ranging_guild_door')).toMatchObject({ kind: 'gate', requires: [['skill:ranged:40']] });
    });

    test('the Lost City shed: the door is free, the jump to Zanaris needs the staff worn on a members world', () => {
        const sets = [['item:dramen_staff:worn', 'members']];
        const c = scanned('oploc1,zanarisdoor');
        expect(gatedSets(c?.moves.find(m => m.to === CROSS))).toEqual([]);
        expect(gatedSets(c?.moves.find(m => m.to === '0_50_149_20_56'))).toEqual(sets);
        expect(curated('oploc1,zanarisdoor')).toMatchObject({ kind: 'gate', requires: sets, to: '0_50_149_20_56' });
    });

    test('the Shilo Village gates: Shilo Village done, from the east', () => {
        expect(gatedSets(scanned('oploc1,_shilo_metalgate')?.moves[0])).toEqual([['quest:zombiequeen']]);
        expect(curated('oploc1,_shilo_metalgate')).toMatchObject({
            kind: 'gate',
            requires: [['quest:zombiequeen']],
            from: 'east',
        });
    });

    test('the Dwarf Cannon cave: a side effect, the check only advances the quest', () => {
        expect(scanned('oploc1,mcannoncave')?.kind).toBe('side-effect');
        expect(curated('oploc1,mcannoncave')?.kind).toBe('side-effect');
    });

    test('the Gnome Stronghold gate: a temporary block during The Grand Tree', () => {
        expect(scanned('oploc1,gnome_areagate')?.kind).toBe('temporary-block');
        expect(curated('oploc1,gnome_areagate')?.kind).toBe('temporary-block');
    });

    test("the Lady Lumbridge's gangplank: a quest window, open only from the ship's purchase until Dragon Slayer is done", () => {
        expect(scanned('oploc1,dragonshipgangplank_on')?.kind).toBe('quest-window');
        expect(curated('oploc1,dragonshipgangplank_on')?.kind).toBe('quest-window');
    });

    test("Priest in Peril's holy barrier: a stage past complete, ^priestperil_access_holy_barrier", () =>
        expect(scanned('oploc1,pip_underground_wall_side_withportal')).toMatchObject({
            kind: 'gate',
            stages: { 'quest:priestperil>=61': '^priestperil_access_holy_barrier' },
        }));
});

describe('obj categories, quest points and conditions the scan cannot read', () => {
    test('the tool checker procs return objs of one category, each under an if that tests it, or null', () => {
        expect(tools).toEqual(
            new Map([
                ['~pickaxe_checker', ['weapon_pickaxe']],
                ['~woodcutting_axe_checker', ['weapon_axe']],
            ]),
        );
        // The god staff checker returns a staff for a god cape held: not a tool the player holds.
        expect(skipped).toEqual([
            '~god_staff_checker (areas/area_mage_arena/scripts/chamber_guardian.rs2:51): returns saradomin_staff under `~obj_gettotal(saradomin_cape) > 0`, which does not test it',
            '~slash_checker (general/scripts/slash_checker.rs2:1): returns $weapon under `oc_param($weapon, slashattack_anim) ! human_unarmedpunch`, which does not test it',
        ]);
    });

    test("loadout rules on gates: the Mage Arena's barrier and Glarial's tomb", () => {
        expect(gatedSets(scanned('oploc1,magearena_scan')?.moves[0])).toEqual([['loadout:mage_arena']]);
        expect(gatedSets(scanned('oplocu,glarials_tombstone_waterfall_quest')?.moves[0])).toEqual([
            ['item:glarials_pebble_waterfall_quest:held', 'loadout:glarials_tomb'],
        ]);
    });

    test("the Champions' Guild: 32 quest points", () => {
        expect(scanned('oploc1,championdoor')?.kind).toBe('gate');
        expect(gatedSets(scanned('oploc1,championdoor')?.moves[0])).toEqual([['questpoints:32']]);
        expect(curated('oploc1,championdoor')).toMatchObject({ kind: 'gate', requires: [['questpoints:32']] });
    });

    test('an axe or a pickaxe held or worn: the Brimhaven vines and the White Wolf Mountain rockslide', () => {
        const vine = scanned('oploc1,karam_dungeon_vineblocking1');
        for (const m of vine?.moves ?? [])
            expect(gatedSets(m)).toEqual([
                ['category:weapon_axe:held', 'skill:woodcutting:10'],
                ['category:weapon_axe:worn', 'skill:woodcutting:10'],
            ]);
        const sets = [
            ['category:weapon_pickaxe:held', 'skill:mining:50'],
            ['category:weapon_pickaxe:worn', 'skill:mining:50'],
        ];
        expect(gatedSets(scanned('oploc2,herorockslide')?.moves[0])).toEqual(sets);
        expect(curated('oploc2,herorockslide')).toMatchObject({ kind: 'gate', requires: sets });
    });

    test("Ape Atoll's bamboo gate: a monkey greegree worn", () => {
        expect(gatedSets(scanned('oploc1,mm_bamboo_largedoor')?.moves[0])).toEqual([['category:mm_greegree:worn']]);
        expect(curated('oploc1,mm_bamboo_largedoor')).toMatchObject({
            kind: 'gate',
            requires: [['category:mm_greegree:worn']],
        });
    });

    test('an unread condition that decides whether the gate opens makes a candidate', () =>
        expect(scanned('oploc1,_outpost_gate')).toMatchObject({
            kind: 'unclear',
            unread: [
                '`npc_find(coord, barbguard1, 5, 0) = true` (areas/area_barbarian_outpost/scripts/outpost_gate.rs2:3)',
            ],
        }));

    test('an unread condition that decides where the player lands makes a candidate', () =>
        expect(scanned('oploc1,skavid_cave2')).toMatchObject({
            kind: 'unclear',
            unread: [
                '`$outcome = 0` (quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:127)',
                '`$outcome = 1` (quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2:127)',
            ],
        }));

    test("Iban's temple: the robes route shuts once Underground Pass is done, so the gate is the Regicide stage", () => {
        const c = scanned('oploc1,upass_templedoor_closed_right');
        expect(gatedSets(c?.moves[0])).toEqual([['quest:regicide>=2']]);
        expect(c?.windows).toEqual([
            'cross: `%upass < ^upass_complete` (quests/quest_upass/scripts/quest_upass.rs2:592)',
        ]);
        expect(curated('oploc1,upass_templedoor_closed_right')).toMatchObject({
            kind: 'gate',
            requires: [['quest:regicide>=2']],
            from: 'east',
        });
    });

    test('a dialogue choice and a random draw are not unread conditions', () => {
        expect(scanned('oploc1,entranaladdertop')?.unread).not.toContainEqual(expect.stringContaining('$option'));
        // `$rand = random(20)`, then `$rand = 0`, `$rand = 1`, ...: a draw held in a local.
        expect(scanned('oploc1,vt_mazeportal_wrong')).toBeUndefined();
    });
});

describe('gates.ts', () => {
    test('reviews every candidate, and every entry agrees with the scan or says why', () => {
        const review = reviewGates(candidates, GATES, new Map(scripts));
        expect(review).toEqual({ unreviewed: [], stale: [], drifted: [], invalid: [] });
    });

    test('every confirmed gate has a placed loc, with its tile, shape and angle', () => {
        const placed = new Set(gates.map(g => g.trigger));
        expect(GATES.filter(e => e.kind === 'gate' && !placed.has(e.trigger)).map(e => e.trigger)).toEqual([]);
        for (const g of gates) {
            expect(Number.isInteger(g.tile.x) && Number.isInteger(g.tile.z) && Number.isInteger(g.tile.level)).toBe(
                true,
            );
            expect(g.shape).toBeGreaterThanOrEqual(0);
            expect(g.angle).toBeGreaterThanOrEqual(0);
            expect(g.angle).toBeLessThan(4);
        }
    });

    test("each use gate cites the line that tests its loc's config, its quest's varp read just after", () => {
        const text = new Map(scripts);
        for (const g of USE_GATES) {
            const [file, at] = g.source.split(':') as [string, string];
            const lines = text.get(file)!.split('\n');
            expect(lines[Number(at) - 1]).toContain(`loc_type = ${g.config}`);
            for (const r of g.requires) {
                const quest = quests.find(q => `quest:${q.id}` === r)!;
                expect(lines.slice(Number(at) - 1, Number(at) + 2).join('\n')).toContain(`%${quest.varp} `);
            }
        }
    });

    test("every quest check on a loc's config in a use gate's script has a row (the wheel's two ops, say)", () => {
        const text = new Map(scripts);
        const varps = quests.map(q => `%${q.varp} `);
        const checked: string[] = [];
        for (const file of new Set(USE_GATES.map(g => g.source.split(':')[0]!))) {
            const lines = text.get(file)!.split('\n');
            lines.forEach((line, i) => {
                const configs = line.match(/^if\s*\((loc_type = \w+(?: \| loc_type = \w+)*)\) \{$/)?.[1];
                if (!configs || !varps.some(v => lines[i + 1]!.includes(v))) return;
                for (const c of configs.split(' | ').map(x => x.slice('loc_type = '.length)))
                    checked.push(`${c} ${file}:${i + 1}`);
            });
        }
        expect(checked).toEqual([
            'doric_anvil skill_smithing/scripts/smithing/smithing.rs2:53',
            'viking_anvil skill_smithing/scripts/smithing/smithing.rs2:66',
            'viking_furnace skill_smithing/scripts/smelting/smelting.rs2:2',
            'viking_furnace2 skill_smithing/scripts/smelting/smelting.rs2:2',
            'viking_furnace skill_smithing/scripts/smelting/smelting.rs2:32',
            'viking_furnace2 skill_smithing/scripts/smelting/smelting.rs2:32',
            'viking_spinningwheel skill_crafting/scripts/spinning/spinning.rs2:2',
            'viking_spinningwheel skill_crafting/scripts/spinning/spinning.rs2:37',
        ]);
        const gated = new Set(USE_GATES.map(g => g.config));
        expect(checked.filter(c => !gated.has(c.split(' ')[0]!))).toEqual([]);
    });

    test('the toll gate is placed at the Al Kharid border, both leaves', () =>
        expect(
            gates
                .filter(g => g.trigger.startsWith('oploc1,border_gate_toll_'))
                .map(g => [g.loc, g.tile.x, g.tile.z, g.requires]),
        ).toEqual([
            ['border_gate_toll_left', 3268, 3227, [['coins:10'], ['quest:prince>=100']]],
            ['border_gate_toll_right', 3268, 3228, [['coins:10'], ['quest:prince>=100']]],
        ]));
});
