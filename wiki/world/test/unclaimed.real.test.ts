// Check 1, unclaimed triggers, over server/content as the build reads it, before allow.ts is applied: it finds the
// audit's uses the index has no rule for (conductor/docs/world-index-data-audit.md §1.2 B1-B2, §1.3 C1-C2, C4-C5),
// and UNCLAIMED_ALLOW leaves nothing and matches every entry.
import { describe, expect, test } from 'bun:test';
import { UNCLAIMED_ALLOW } from '../allow';
import { applyConfigAllow, crossedConfigs, placedConfigs, unclaimedTriggers } from '../checks';
import { classification } from '../classify';
import { loadWorld } from '../load';
import { first, readConfigs } from '../sources/configs';
import { readCourses } from '../sources/courses';
import { readDbrows } from '../sources/dbrows';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { parseCallables, parseTriggers, readScripts } from '../sources/triggers';

const configs = { loc: readConfigs('loc'), npc: readConfigs('npc') };
const scripts = readScripts();
const triggers = scripts.flatMap(([f, text]) => parseTriggers(f, text));
const callables = scripts.flatMap(([f, text]) => parseCallables(f, text));
const classified = classification({
    locConfigs: configs.loc,
    npcConfigs: configs.npc,
    dbrows: readDbrows(),
    triggers,
    callables,
    courses: readCourses(triggers, callables),
});
const map = readAllMapSquares();
const packs = { loc: readPack('loc'), npc: readPack('npc') };
const placed = placedConfigs(map, packs);
// The crossings the build modelled, as world.json has them.
const found = unclaimedTriggers({ placed, configs, classification: classified, crossed: crossedConfigs(loadWorld()) });
const detail = new Map(found.map(f => [f.config, f.detail]));

/** The placed configs of `on` with a trigger in `file`. */
const triggeredIn = (on: 'loc' | 'npc', file: string): string[] =>
    [...new Set(triggers.filter(t => t.on === on && t.file === file && !t.category).map(t => t.target))]
        .filter(c => placed[on].has(c))
        .sort();

describe('unclaimed triggers', () => {
    test("finds Ape Atoll's five market stalls, which the stall rule's directory leaves out (audit B1)", () => {
        const stalls = triggeredIn('loc', 'quests/quest_mm/scripts/aa_market.rs2');
        expect(stalls).toHaveLength(5);
        for (const c of stalls) expect(detail.get(`loc ${c}`)).toContain('quests/quest_mm/scripts/aa_market.rs2:');
    });

    test('finds every placed loc of category well (audit B2)', () => {
        const wells = [...placed.loc].filter(c => first(configs.loc.get(c), 'category') === 'well');
        expect(wells.sort()).toEqual(['desertwell', 'well']);
        for (const c of wells) expect(detail.get(`loc ${c}`)).toContain('[oplocu,_well] use');
    });

    test('finds the crops of pickables.rs2 but flax, which is a kind (audit C1)', () => {
        const crops = triggeredIn('loc', 'general_use/scripts/pickables.rs2').filter(c => c !== 'flax');
        expect(crops).toEqual(['cabbage', 'onion', 'potato', 'wheat']);
        for (const c of crops) expect(detail.get(`loc ${c}`)).toContain('pickup');
        expect(detail.has('loc flax')).toBe(false);
    });

    test('finds the banana trees and Kharidian cacti (audit C2)', () => {
        for (const c of ['bananatreefull', 'mm_bananatreefull']) expect(detail.get(`loc ${c}`)).toContain('gather');
        expect(detail.get('loc desert_cactus_full')).toContain('kharidian_cactus.rs2');
    });

    test("finds each mill's hopper and its flour bin (audit C4)", () => {
        for (const c of ['hopper_ardougne', 'hopper_lumbridge', 'hopper_varrock', 'hopper_zanaris'])
            expect(detail.get(`loc ${c}`)).toContain('windmills.rs2:94 [oplocu,_hopper_nonfull] use');
        expect(detail.get('loc millbase')).toContain('gather');
    });

    test("finds sheep to shear and cows to milk, a cow's Attack left to its npc kind (audit C5)", () => {
        expect(detail.get('npc sheepunsheered')).toContain('[opnpcu,sheepunsheered]');
        expect(detail.get('npc cow')).toBe('npc/scripts/cow_milking.rs2:1 [opnpcu,cow] use');
    });

    test("finds Varrock's sword dummy, an Attack op on a loc", () =>
        expect(detail.get('loc sworddummy')).toBe(
            'areas/area_varrock/scripts/attack_dummy.rs2:1 [oploc2,sworddummy] xp',
        ));

    test('finds the rope swing no gate row writes, but not its siblings World.gates has', () => {
        expect(detail.get('loc tree_ropeswing2')).toContain('[oploc1,_island_rope_swing] agility');
        for (const c of ['tree_ropeswing1', 'tree_ropeswing3']) expect(detail.has(`loc ${c}`)).toBe(false);
    });

    test('UNCLAIMED_ALLOW leaves no finding, and every entry names placed configs and matches', () => {
        const r = applyConfigAllow(found, UNCLAIMED_ALLOW, placed);
        expect(r.left).toEqual([]);
        expect(r.invalid).toEqual([]);
        expect(r.stale).toEqual([]);
        expect(r.allowed).toBe(found.length);
    });

    test('every entry has a reason and a source on a trigger line of the config it names', () => {
        for (const e of UNCLAIMED_ALLOW) {
            expect(e.reason).not.toBe('');
            expect(e.configs.some(c => detail.get(c)?.includes(`${e.source} `))).toBe(true);
        }
    });
});
