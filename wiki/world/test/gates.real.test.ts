// The gate scan on the real scripts (sources/gate-scan.ts), the curated verdicts (gates.ts GATES) and their
// placed locs.
import { describe, expect, test } from 'bun:test';
import { GATES, LOADOUT_PROCS, QUEST_OVERRIDES } from '../gates';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { CROSS, gatedSets, placeGates, reviewGates, scanGates, type CuratedGate } from '../sources/gate-scan';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { deriveQuests, scanQuestCalls } from '../sources/quests';
import { parseCallables, parseTriggers, readScripts } from '../sources/triggers';

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
const candidates = scanGates({
    triggers,
    callables,
    constants,
    quests,
    loadoutProcs: LOADOUT_PROCS,
    names: new Set([...readConfigs('obj').keys(), ...locConfigs.keys(), ...readConfigs('npc').keys()]),
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

describe('gates.ts', () => {
    test('reviews every candidate, and every entry agrees with the scan or says why', () => {
        const review = reviewGates(candidates, GATES, new Map(scripts));
        expect(review).toEqual({ unreviewed: [], stale: [], invalid: [] });
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
