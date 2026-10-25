// The method query over the committed world.json and the real game data (query.ts defaultQuery).
import { expect, test } from 'bun:test';
import type { Profile } from '../model/profile';
import { SKILLS, type Skill } from '../model/server';
import { bestMethods, methodRate } from '../query';

// Mining 60, every other skill 1, the adamant pickaxe (pickaxes.obj levelrequire 31: usable at 60).
const profile: Profile = {
    levels: Object.fromEntries(SKILLS.map(s => [s, s === 'mining' ? 60 : 1])) as Record<Skill, number>,
    axe: null,
    pickaxe: 'adamant_pickaxe',
    glory: false,
    worn: [],
};

test('at Mining 60 with an adamant pickaxe the iron methods rank, the seeds first and their bank one below the drop one', () => {
    const ranked = bestMethods('mining', profile, { met: () => false, maxWilderness: 0, multiway: false });
    // Al Kharid's three rocks bind on their respawn below the four south-east Varrock rocks' floors.
    expect(ranked.map(r => r.method.def.id)).toEqual([
        'iron-se-varrock-drop',
        'iron-se-varrock-bank',
        'iron-al-kharid-3rock-drop',
    ]);
    for (const r of ranked) {
        expect(r.xpPerHour).toBe(methodRate(r.method.def.id, profile).xpPerHour.mining!);
        // Each seed's one measured figure, below its floor (methods.real.test.ts checks every figure); Al Kharid's
        // record is unmeasured.
        expect(r.measured.map(x => x.xpPerHour < x.floor)).toEqual(r.method.def.measured ? [true] : []);
    }
    // The default query also ranks the methods with requirements (the Mining Guild's coal, the Dwarven Mine's
    // adamantite), so the iron seeds are compared by id.
    const seeds = new Set(ranked.map(r => r.method.def.id));
    expect(
        bestMethods('mining', profile)
            .filter(r => seeds.has(r.method.def.id))
            .map(r => r.method.def.id),
    ).toEqual(ranked.map(r => r.method.def.id));
});

test('no pickaxe, no mining method', () => {
    expect(bestMethods('mining', { ...profile, pickaxe: null })).toEqual([]);
});
