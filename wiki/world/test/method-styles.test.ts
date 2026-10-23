// A method whose family takes a style from the gear (Family.styles, as combat does), on a made-up family with round
// numbers: the style each queried skill picks, the record's gear against the profile's, an area's features and the
// uncalibrated kill's food. The real hill giants are in combat-method.real.test.ts.
import { describe, expect, test } from 'bun:test';
import { ModelError, ProfileError, type Family, type StyleChoice } from '../model/family';
import { CALIBRATED_NPCS, gatherSite, styleParams, wearing, type MethodModel } from '../model/method';
import { profileAt, type Profile } from '../model/profile';
import type { Skill } from '../model/server';
import { methodQuery } from '../query';
import type { Feature, Site, WorldMethod } from '../types';

/** Ticks per kill by style; each style pays 40 XP (400 tenths) to its skills and 10 to Hitpoints. */
const TICKS: Record<string, number> = { accurate: 4, aggressive: 2, controlled: 3, defensive: 8 };
const SKILLS_OF: Record<string, Skill[]> = {
    accurate: ['attack'],
    aggressive: ['strength'],
    controlled: ['attack', 'strength', 'defence'],
    defensive: ['defence'],
};
/** A sword's four styles; a spear's two; no weapon's three. */
const WEAPONS: Record<string, string[]> = {
    sword: ['accurate', 'aggressive', 'controlled', 'defensive'],
    spear: ['controlled', 'aggressive'],
    '': ['accurate', 'aggressive', 'defensive'],
};

const melee: Family = {
    id: 'melee',
    skills: ['attack', 'strength', 'defence', 'hitpoints'],
    kinds: ['npc'],
    styles: (params, profile) => ({
        styles: WEAPONS[profile.worn[0] ?? '']!.map((style): StyleChoice => ({
            params: { ...(params as object), style },
            skills: [...SKILLS_OF[style]!, 'hitpoints'],
        })),
        quests: [],
    }),
    model: (_site, params, profile) => {
        const { style } = params as { style: string };
        // Controlled needs Attack 10 here: a candidate the profile can't swing.
        if (style === 'controlled' && profile.levels.attack < 10) throw new ProfileError('controlled needs Attack 10');
        return {
            ticksPerAttempt: TICKS[style]!,
            success: 1,
            xpTenths: { ...Object.fromEntries(SKILLS_OF[style]!.map(s => [s, 400])), hitpoints: 100 },
            products: [],
            consumes: [],
            attackRate: 2,
            damage: 3,
        };
    },
};

/** The slots each obj here takes worn: the greatsword both hands, as a two-handed sword's wearpos and wearpos2 do. */
const WEARPOS: Record<string, string[]> = {
    sword: ['righthand'],
    spear: ['righthand'],
    greatsword: ['righthand', 'lefthand'],
    shield: ['lefthand'],
    ring: ['ring'],
};

const model: MethodModel = {
    families: new Map([['melee', melee]]),
    items: obj => {
        if (obj === 'trout') return { stackable: false, cost: 1, wearable: false, category: 'category_58' };
        const wearpos = WEARPOS[obj];
        if (!wearpos) throw new ModelError(`no item ${obj} here`);
        return { stackable: false, cost: 1, wearable: true, wearpos };
    },
    foods: new Map([['trout', 7]]),
    zones: { f2p: new Set(), multiway: new Set() },
    tools: { axe: [], pickaxe: [] },
};

const pen: Site = {
    id: 'npc:pen:0',
    kind: 'npc',
    areaPath: [],
    centre: { level: 0, x: 10, z: 10 },
    bbox: { x1: 10, z1: 10, x2: 10, z2: 10, level: 0 },
    stand: { level: 0, x: 10, z: 11 },
    counts: {},
    features: [0],
    f2p: false,
    multiway: false,
    wildernessLevel: 0,
    reach: [[]],
};

const method: WorldMethod = {
    id: 'pen-kill',
    name: 'pen-kill',
    family: 'melee',
    at: pen.centre,
    params: { npc: 'cow' },
    gear: ['sword'],
    food: 'trout',
    sink: { mode: 'drop' },
    site: pen.id,
    stand: pen.stand!,
    skill: 'attack',
    minLevel: 1,
    levels: { attack: 1, defence: 1, strength: 1, hitpoints: 1 },
    ways: [{ reach: [], legs: [] }],
};

const at = (level: number, worn: string[] = []): Profile => ({
    ...profileAt('attack', level, { tools: model.tools }),
    worn,
});
const styles = (skill: Skill, profile: Profile) =>
    styleParams(method, profile, model, skill).map(p => (p as { style: string }).style);

describe('styleParams: the style follows the skill', () => {
    test("with the record's sword: Attack accurate, Strength aggressive, Defence defensive", () => {
        // controlled trains all three too, but more skills than the one that trains the skill alone.
        expect(styles('attack', at(50))).toEqual(['accurate']);
        expect(styles('strength', at(50))).toEqual(['aggressive']);
        expect(styles('defence', at(50))).toEqual(['defensive']);
    });

    test('Hitpoints, which every style trains, and Prayer, which none does: every style', () => {
        expect(styles('hitpoints', at(50))).toEqual(['accurate', 'aggressive', 'controlled', 'defensive']);
        expect(styles('prayer', at(50))).toEqual(['accurate', 'aggressive', 'controlled', 'defensive']);
    });

    test("a profile's own weapon in place of the record's: the spear trains Attack and Defence only on controlled", () => {
        expect(styles('attack', at(50, ['spear']))).toEqual(['controlled']);
        expect(styles('defence', at(50, ['spear']))).toEqual(['controlled']);
        // Both its styles train Strength: both are candidates, and the rate takes the better.
        expect(styles('strength', at(50, ['spear']))).toEqual(['controlled', 'aggressive']);
    });

    test('a family with no styles: the record params as they are', () => {
        const plain = { ...model, families: new Map([['melee', { ...melee, styles: undefined }]]) };
        expect(styleParams(method, at(50), plain, 'attack')).toEqual([{ npc: 'cow' }]);
    });
});

/** What a profile wearing `own` wears for a record of `gear`. */
const worn = (gear: string[] | undefined, own: string[] = []) => wearing({ gear }, at(50, own), model.items).worn;

describe("wearing: the profile's worn objs over the record's gear, slot by slot", () => {
    test("the record's gear when the profile names none; none when neither does", () => {
        expect(worn(['sword'])).toEqual(['sword']);
        expect(worn(undefined, ['ring'])).toEqual(['ring']);
        expect(worn([])).toEqual([]);
    });

    test('a worn obj the game has no config for is a ProfileError, not the item lookup ModelError', () => {
        expect(() => worn(['sword'], ['no_such_obj'])).toThrow(ProfileError);
        expect(() => worn(['no_such_obj'], ['ring'])).toThrow(ProfileError);
    });

    test("a ring alone keeps the record's weapon; the profile's own weapon replaces it", () => {
        expect(worn(['sword'], ['ring'])).toEqual(['sword', 'ring']);
        expect(worn(['sword', 'ring'], ['spear'])).toEqual(['ring', 'spear']);
    });

    test('a two-handed sword and a shield take each other off, whichever side wears it', () => {
        expect(worn(['sword', 'shield', 'ring'], ['greatsword'])).toEqual(['ring', 'greatsword']);
        expect(worn(['greatsword', 'ring'], ['shield'])).toEqual(['ring', 'shield']);
    });

    test("a ring alone swings the record's sword's styles; a spear its own", () => {
        expect(styles('attack', at(50, ['ring']))).toEqual(['accurate']);
        expect(styles('attack', at(50, ['spear']))).toEqual(['controlled']);
    });
});

/** A 5 run tick leg. */
const leg = (from: Site, to: Site) => ({ from: from.id, to: to.id, runTicks: 5, requires: [] });

describe('the rate on the chosen style', () => {
    const q = methodQuery({ sites: [pen], features: [], methods: [method] }, model);

    test('each melee skill is rated on its style; Hitpoints on the fastest kill', () => {
        // A kill each `ticks`, 9000 ticks an hour (TICKS_PER_HOUR), XP x 25 (XP_RATE): accurate, 4 ticks, 2250 kills of
        // 40 XP: 2,250,000 Attack, and 2250 x 10 x 25 = 562,500 Hitpoints.
        expect(q.methodRate('pen-kill', at(50)).xpPerHour).toEqual({ attack: 2_250_000, hitpoints: 562_500 });
        // aggressive, 2 ticks: 4500 kills, 4,500,000 Strength and 1,125,000 Hitpoints.
        expect(q.methodRate('pen-kill', at(50), 'strength').xpPerHour).toEqual({
            strength: 4_500_000,
            hitpoints: 1_125_000,
        });
        // Hitpoints: the best of the four is aggressive's 1,125,000 (controlled, 3 ticks: 750,000).
        expect(q.bestMethods('hitpoints', at(50)).map(r => r.xpPerHour)).toEqual([1_125_000]);
    });

    test("a style the profile can't swing is passed over, unless it is the only one", () => {
        // The spear at Attack 5: controlled is refused, so Hitpoints takes aggressive; Attack has no other style.
        expect(q.methodRate('pen-kill', at(5, ['spear']), 'hitpoints').xpPerHour.hitpoints).toBe(1_125_000);
        expect(() => q.methodRate('pen-kill', at(5, ['spear']), 'attack')).toThrow(/controlled needs Attack 10/);
        expect(q.bestMethods('attack', at(5, ['spear']))).toEqual([]);
    });

    test('a kill is uncalibrated: the named trout is not eaten for its damage', () => {
        const r = q.methodRate('pen-kill', at(50));
        expect(r.suppliesPerHour).toEqual([]);
        expect(r.trip.eat).toBe(0);
    });

    test('a calibrated npc is eaten for, by params.npc or, with none, the npc of the site', () => {
        // The kill banked 5 run ticks off, so the trout is restocked.
        const booth: Site = { ...pen, id: 'bank:booth:0', kind: 'bank', features: [] };
        const banked = (params: unknown): WorldMethod => ({
            ...method,
            params,
            sink: { mode: 'bank' },
            bank: booth.id,
            ways: [{ reach: [], legs: [leg(pen, booth), leg(booth, pen)] }],
        });
        const cows = [{ kind: 'npc', subtype: 'cow', tile: pen.centre } as Feature];
        const eaten = (params: unknown) =>
            methodQuery({ sites: [pen, booth], features: cows, methods: [banked(params)] }, model)
                .methodRate('pen-kill', at(50))
                .suppliesPerHour.map(x => x.obj);
        expect(eaten({ npc: 'cow' })).toEqual([]);
        const calibrated = CALIBRATED_NPCS as Set<string>;
        calibrated.add('cow');
        try {
            expect(eaten({ npc: 'cow' })).toEqual(['trout']);
            expect(eaten({})).toEqual(['trout']);
            expect(eaten({ npc: 'bull' })).toEqual([]);
            expect(() => eaten({ npc: 7 })).toThrow(/pen-kill: a combat method's params.npc is not an npc config: 7/);
        } finally {
            calibrated.delete('cow');
        }
    });

    test('Prayer, which a kill that buries no bones does not train, is no rate', () => {
        expect(() => q.methodRate('pen-kill', at(50), 'prayer')).toThrow(/pen-kill: it does not train prayer/);
        expect(q.bestMethods('prayer', at(50))).toEqual([]);
    });
});

/** A cow at (x, z). */
const npc = (x: number, z: number, level = 0): Feature =>
    ({ kind: 'npc', subtype: 'cow', tile: { level, x, z } }) as Feature;
describe('gatherSite', () => {
    const features = [
        npc(10, 10),
        npc(12, 10),
        npc(13, 10),
        npc(8, 8),
        npc(11, 11, 1),
        { ...npc(10, 9), kind: 'tree' } as Feature,
    ];

    test('the features of its kind within `area` tiles (Chebyshev) of `at`, on its level, across sites', () => {
        // (12, 10) and (8, 8) are 2 off; (13, 10) is 3; (11, 11) is on level 1; (10, 9) is a tree.
        expect(gatherSite({ at: pen.centre, area: 2 }, pen, { features }).features).toEqual([0, 1, 3]);
        expect(gatherSite({ at: pen.centre }, pen, { features })).toBe(pen);
    });

    test('an area that is not a whole number of tiles is a ModelError', () => {
        expect(() => gatherSite({ at: pen.centre, area: 1.5 }, pen, { features })).toThrow(
            /area 1.5 is not a whole number of tiles/,
        );
    });
});
