// A melee method end to end over the committed world.json and the real game data: a test-only hill giant record
// (methods.ts seeds none yet) resolved over the Edgeville dungeon's three giant sites, then rated through methodQuery
// on the style each skill picks, with its aggression hazard at two combat levels and its uncalibrated food.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { loadWorld } from '../load';
import type { MethodDef } from '../methods';
import { combatLevel } from '../model/combat';
import { readGameData } from '../model/families/index';
import { legFinder } from '../model/legs';
import { methodModel, resolveMethod, styleParams, toWorldMethod, type MethodContext } from '../model/method';
import { profileAt, type Profile } from '../model/profile';
import type { Skill } from '../model/server';
import { locSizes } from '../place';
import { methodQuery } from '../query';
import { reachGraph } from '../reach';
import { questFacts } from '../requirements';
import { readConfigs } from '../sources/configs';

const world = loadWorld();
const data = readGameData();
const model = methodModel(data);
const ctx: MethodContext = { world, ...model, quests: questFacts(world.quests) };
const legs = legFinder(
    reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) }),
    world.crossings,
);

/** The twelve hill giants of the Edgeville dungeon: within 14 tiles of (3113, 9840), across three npc sites. */
const giants: MethodDef = {
    id: 'test-hill-giants-edgeville',
    name: 'Hill giants in the Edgeville dungeon (test only)',
    family: 'combat',
    at: { level: 0, x: 3113, z: 9840 },
    area: 14,
    params: { npc: 'giant' },
    gear: ['rune_scimitar'],
    loot: { bones: 'bury' },
    food: 'lobster',
    sink: { mode: 'bank' },
};
const resolved = resolveMethod(giants, ctx, legs);
const query = methodQuery({ ...world, methods: [toWorldMethod(resolved)] }, model);

/** Every skill at `level`, the record's scimitar worn (its gear, as the profile names none). */
const at = (level: number): Profile => profileAt('attack', level, { tools: model.tools });

/** The styles styleParams gives the record for `skill`, at 60 in every skill. */
const styles = (skill: Skill) => styleParams(giants, at(60), ctx, skill).map(p => (p as { style: string }).style);

/** Every combat-level skill at `n`. */
const levels = (n: number) => ({
    attack: n,
    strength: n,
    defence: n,
    hitpoints: n,
    prayer: n,
    ranged: n,
    magic: n,
});

describe('the record resolves', () => {
    test('its area gathers the spawns of three sites', () => {
        const sites = new Set(
            world.sites
                .filter(s => s.kind === 'npc' && s.features.some(i => world.features[i]!.subtype === 'giant'))
                .filter(s => s.id.startsWith('npc:edgeville-dungeon:'))
                .map(s => s.id),
        );
        expect([...sites].sort()).toEqual([
            'npc:edgeville-dungeon:5',
            'npc:edgeville-dungeon:7',
            'npc:edgeville-dungeon:8',
        ]);
        expect(sites.has(resolved.site.id)).toBe(true);
        // One walk per ordered pair of the 12 spawns: 12 x 11.
        expect(resolved.ways[0]!.walks).toHaveLength(132);
    });

    test("its skills are the scimitar's styles' and Prayer for the buried bones, in SKILLS order", () => {
        expect(resolved.skill).toBe('attack');
        expect(Object.keys(resolved.levels)).toEqual(['attack', 'defence', 'strength', 'hitpoints', 'prayer']);
        // The rune scimitar needs Attack 40 to wield (levelrequire/scripts/tier40.rs2:8).
        expect(resolved.levels.attack).toBe(40);
        expect(resolved.minLevel).toBe(40);
    });

    test('its npcs: the giants hunt up to combat 56, and hit for at most 4', () => {
        // giant: huntmode=cowardly (check_nottoostrong=outside_wilderness, all.hunt:37-45), huntrange 2, vislevel 28:
        // 28 x 2 = 56 (Npc.ts:1011). Max hit (npc_combat_melee.rs2:2-8, combat.rs2:7-8): strength 22 + 9 = 31,
        // 31 x (16 + 64) = 2480, (2480 + 320) / 640 = 4.375, 4.
        expect(resolved.npcs).toEqual({ maxHit: 4, hunters: [{ npc: 'giant', upTo: 56 }] });
    });
});

describe('the style follows the queried skill', () => {
    test('styleParams: Attack accurate, Strength aggressive, Defence defensive; Hitpoints and Prayer every style', () => {
        expect(styles('attack')).toEqual(['accurate']);
        expect(styles('strength')).toEqual(['aggressive']);
        expect(styles('defence')).toEqual(['defensive']);
        // The scimitar's four, controlled (stab) among them (combat.dbrow's weapon_slash table).
        expect(styles('hitpoints')).toEqual(['accurate', 'aggressive', 'controlled', 'defensive']);
        expect(styles('prayer')).toEqual(['accurate', 'aggressive', 'controlled', 'defensive']);
    });

    test('bestMethods rates each melee skill on its own style: only that skill and Hitpoints gain XP', () => {
        const rated = (skill: Skill) => {
            const [r] = query.bestMethods(skill, at(60));
            expect(r?.method.def.id).toBe(giants.id);
            return r!;
        };
        for (const skill of ['attack', 'strength', 'defence'] as const) {
            const r = rated(skill);
            expect(Object.keys(r.rates.xpPerHour).sort()).toEqual([skill, 'hitpoints', 'prayer'].sort());
            expect(r.xpPerHour).toBeGreaterThan(0);
        }
        // Hitpoints XP is 4/3 per damage whatever the style (combat.rs2:167): the best style deals the most per hour.
        const hp = rated('hitpoints').xpPerHour;
        for (const skill of ['attack', 'strength', 'defence'] as const)
            expect(hp).toBeGreaterThanOrEqual(rated(skill).rates.xpPerHour.hitpoints!);
        expect(rated('prayer').xpPerHour).toBeGreaterThan(0);
        // methodRate by id rates the method's own skill, Attack, unless asked for another.
        expect(query.methodRate(giants.id, at(60)).xpPerHour.attack).toBe(rated('attack').xpPerHour);
        expect(query.methodRate(giants.id, at(60), 'strength').xpPerHour.strength).toBe(rated('strength').xpPerHour);
    });

    test('a profile wearing objs of its own wears them in place of the record gear', () => {
        // Unarmed (the profile's iron med helm is no weapon) swings every 4 ticks, the scimitar also 4; the scimitar's
        // slash bonus makes the record's kill faster.
        const own = { ...at(60), worn: ['iron_med_helm'] };
        expect(query.methodRate(giants.id, own).xpPerHour.attack!).toBeLessThan(
            query.methodRate(giants.id, at(60)).xpPerHour.attack!,
        );
    });
});

describe('hazard and food', () => {
    test('aggressive at combat 56, not at 57: bestMethods({ aggressive: false }) keeps it only at 57', () => {
        // Every skill at 44: 10 x (44 + 44 + 22) + 13 x 88 = 2244, / 40 = 56; at 45: 1120 + 1170 = 2290, / 40 = 57
        // (combat_level.rs2:1-10).
        expect([combatLevel(levels(44)), combatLevel(levels(45))]).toEqual([56, 57]);
        const ids = (p: Profile) => query.bestMethods('attack', p, { aggressive: false }).map(r => r.method.def.id);
        expect(query.bestMethods('attack', at(44))[0]!.hazard).toEqual({
            wildernessLevel: 0,
            multiway: false,
            aggressive: true,
            maxHit: 4,
        });
        expect(ids(at(44))).toEqual([]);
        expect(ids(at(45))).toEqual([giants.id]);
        expect(query.bestMethods('attack', at(45))[0]!.hazard.aggressive).toBe(false);
    });

    test('the kill is uncalibrated: the named lobster is not eaten and no Food/hr shows', () => {
        const r = query.methodRate(giants.id, at(60));
        expect(r.suppliesPerHour).toEqual([]);
        expect(r.trip.eat).toBe(0);
    });

    test('a wield check that reads a quest varp joins the quest into every way', () => {
        // dragon_longsword: Attack 60 and %zanaris, Lost City (levelrequire/scripts/tier60.rs2:5).
        const lostCity = world.quests.find(q => q.varp === 'zanaris')!;
        const dragon = resolveMethod({ ...giants, id: 'test-dragon-giants', gear: ['dragon_longsword'] }, ctx, legs);
        expect(dragon.ways.length).toBeGreaterThan(0);
        for (const w of dragon.ways) expect(w.reach).toContain(`quest:${lostCity.id}`);
    });
});

describe('npc sites carry a nearest bank (distance.ts SINKS)', () => {
    test("every npc site has a nearest object; the giants' is Edgeville bank", () => {
        const npcSites = world.sites.filter(s => s.kind === 'npc');
        expect(npcSites.every(s => s.nearest !== undefined)).toBe(true);
        // Most have a bank: those with no stand, no reach, or no bank their reach gets to have {}.
        expect(npcSites.filter(s => s.nearest?.bank).length).toBeGreaterThan(npcSites.length / 2);
        const giantsSite = world.sites.find(s => s.id === 'npc:edgeville-dungeon:8')!;
        expect(giantsSite.nearest?.bank?.site).toBe('bank:edgeville-bank:0');
        expect(giantsSite.nearest?.bank?.runTicks).toBeGreaterThan(0);
        expect(resolved.sink).toEqual({ mode: 'bank', bank: world.sites.find(s => s.id === 'bank:edgeville-bank:0')! });
    });
});
