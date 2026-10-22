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
};

test('at Mining 60 with an adamant pickaxe the seed iron methods rank, the bank one below the drop one', () => {
    const ranked = bestMethods('mining', profile, { met: () => false, maxWilderness: 0, multiway: false });
    expect(ranked.map(r => r.method.def.id)).toEqual(['iron-se-varrock-drop', 'iron-se-varrock-bank']);
    for (const r of ranked) {
        expect(r.xpPerHour).toBe(methodRate(r.method.def.id, profile).xpPerHour.mining!);
        // Each seed's one measured figure, below its floor (methods.real.test.ts checks every figure).
        expect(r.measured.map(x => x.xpPerHour < x.floor)).toEqual([true]);
    }
    expect(bestMethods('mining', profile)).toEqual(ranked);
});

test('no pickaxe, no mining method', () => {
    expect(bestMethods('mining', { ...profile, pickaxe: null })).toEqual([]);
});
