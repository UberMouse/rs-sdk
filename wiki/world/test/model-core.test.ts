import { describe, expect, test } from 'bun:test';
import type { ActionModel } from '../model/family';
import { bestTool, profileAt, readTools, toolKindOfObj, toolKindOfSkill, type Tools } from '../model/profile';
import { gatherRate, resourceCap, ticksPerItem } from '../model/rate';
import { levelForXp, readDefault, xpForLevel } from '../model/server';
import { parseConfigs } from '../sources/configs';

describe('level curve', () => {
    // Player.ts:79-85: acc += floor(l + 2^(l/10) * 300) for l = 1..level-1; the level's XP is floor(acc/4)*10
    // tenths. These are whole XP (the tenths / 10), as the SDK reports them.
    test('xpForLevel at 2, 50, 99', () => {
        // Level 2: floor(1 + 2^0.1 * 300) = floor(322.53) = 322; floor(322/4) = 80.
        expect(xpForLevel(2)).toBe(80);
        // Level 50: acc over l = 1..49 is 130477; floor(130477/4) = 32619.
        expect(xpForLevel(50)).toBe(32619);
        // Level 99: acc over l = 1..98 is 3993834; floor(3993834/4) = 998458.
        expect(xpForLevel(99)).toBe(998458);
        expect(xpForLevel(1)).toBe(0);
    });

    test('levelForXp is the highest level whose XP is reached', () => {
        expect(levelForXp(0)).toBe(1);
        expect(levelForXp(79)).toBe(1);
        expect(levelForXp(80)).toBe(2);
        expect(levelForXp(32618)).toBe(49);
        expect(levelForXp(32619)).toBe(50);
        expect(levelForXp(998458)).toBe(99);
        expect(levelForXp(2_000_000)).toBe(99);
    });
});

describe('readDefault', () => {
    const line = /^\s*xpRate:\s*(\d+),/;

    test('reads the one matching line, with where it is', () => {
        expect(readDefault('f.ts', 'node: {\n    xpRate: 7, // note\n}', line)).toEqual({ value: 7, at: 'f.ts:2' });
    });

    test('throws when the line is gone or there are two', () => {
        expect(() => readDefault('f.ts', 'xpRate = 7', line)).toThrow(/found 0/);
        expect(() => readDefault('f.ts', 'xpRate: 7,\nxpRate: 8,', line)).toThrow(/found 2/);
    });
});

describe('profile', () => {
    const tools: Tools = readTools(
        parseConfigs(
            [
                ['rune_pickaxe', 41],
                ['adamant_pickaxe', 31],
                ['mithril_pickaxe', 21],
                ['steel_pickaxe', 6],
                ['iron_pickaxe', 0],
                ['bronze_pickaxe', 0],
            ]
                .map(([obj, level]) => `[${obj}]\nparam=mining_rate,3\nparam=levelrequire,${level}\n`)
                .join(''),
        ),
    );

    test('readTools takes the pickaxe levels from the configs; axes ask none', () => {
        expect(tools.pickaxe.map(t => t.level)).toEqual([41, 31, 21, 6, 0, 0]);
        expect(tools.axe.every(t => t.level === 0)).toBe(true);
        expect(() => readTools(parseConfigs('[rune_pickaxe]\nparam=mining_rate,2\n'))).toThrow(/levelrequire/);
    });

    test('bestTool is the first of the tier the level reaches', () => {
        expect(bestTool(tools.pickaxe, 41)).toBe('rune_pickaxe');
        expect(bestTool(tools.pickaxe, 40)).toBe('adamant_pickaxe');
        expect(bestTool(tools.pickaxe, 5)).toBe('iron_pickaxe');
        expect(bestTool([{ obj: 'x', level: 10 }], 9)).toBeNull();
    });

    test('profileAt: the skill at the level, the others at it or their floor, the best tools there', () => {
        const p = profileAt('mining', 30, { tools, atLeast: { mining: 60, cooking: 40, fishing: 20 } });
        // The column's own skill is not raised by a floor; the others are, and never lowered.
        expect(p.levels.mining).toBe(30);
        expect(p.levels.cooking).toBe(40);
        expect(p.levels.fishing).toBe(30);
        expect(p.levels.thieving).toBe(30);
        expect(p.pickaxe).toBe('mithril_pickaxe');
        expect(p.axe).toBe('rune_axe');
        expect(p.glory).toBe(false);
        expect(profileAt('mining', 30, { tools, glory: true }).glory).toBe(true);
    });

    test('a tool kind: the one its skill reads, and the tier an obj is in', () => {
        expect([toolKindOfSkill('woodcutting'), toolKindOfSkill('mining'), toolKindOfSkill('fishing')]).toEqual([
            'axe',
            'pickaxe',
            null,
        ]);
        expect(toolKindOfObj(tools, 'rune_axe')).toBe('axe');
        expect(toolKindOfObj(tools, 'iron_pickaxe')).toBe('pickaxe');
        expect(toolKindOfObj(tools, 'harpoon')).toBeNull();
    });
});

/** An ActionModel with one 3-tick attempt per success and no XP or items, overridden by `m`. */
const model = (m: Partial<ActionModel>): ActionModel => ({
    ticksPerAttempt: 3,
    success: 1,
    xpTenths: {},
    products: [],
    consumes: [],
    ...m,
});

const dep = (chance: number, respawnTicks = 9) => model({ deplete: { chance, respawnTicks } });

describe('rate', () => {
    test('ticksPerItem: attempts per success, and the failures among them', () => {
        // 1/0.25 = 4 attempts of 3 ticks.
        expect(ticksPerItem(model({ success: 0.25 }))).toBe(12);
        // 2 attempts of 2 ticks, and the one failure among them stuns 8: (2 + 0.5*8)/0.5 = 12.
        expect(ticksPerItem(model({ ticksPerAttempt: 2, success: 0.5, failTicks: 8 }))).toBe(12);
        expect(() => ticksPerItem(model({ success: 0 }))).toThrow(/not in/);
    });

    test('ticksPerItem: a success adds its successTicks once', () => {
        // A normal rock: 4 attempts of 4 ticks for one ore at success 1/4, then its 1-tick p_delay: 16 + 1 = 17.
        expect(ticksPerItem(model({ ticksPerAttempt: 4, success: 0.25, successTicks: 1 }))).toBe(17);
        expect(() => ticksPerItem(model({ successTicks: -1 }))).toThrow(/successTicks -1/);
        expect(() => ticksPerItem(model({ successTicks: NaN }))).toThrow(/successTicks NaN/);
    });

    test('one feature that depletes every success binds the player to its respawn', () => {
        // A rock: 1 ore in 3 ticks, then down 9 ticks: 1 ore per 12 ticks, though the player could take 1 per 3.
        const m = model({ deplete: { chance: 1, respawnTicks: 9 } });
        expect(resourceCap(m, 1)).toBe(1 / 12);
        expect(gatherRate(m, 1)).toEqual({ itemsPerTick: 1 / 12, binding: 'resource' });
    });

    test('three features, each taking several items to deplete', () => {
        // Trees depleting 1 in 8 logs: 8 logs at 4 ticks = 32 ticks, then down 100: one tree's cycle is 132 ticks,
        // and three give 24 logs per 132 ticks = 2/11 a tick, under the player's 1/4.
        const m = model({ ticksPerAttempt: 4, deplete: { chance: 1 / 8, respawnTicks: 100 } });
        expect(resourceCap(m, 3)).toBeCloseTo(2 / 11, 12);
        expect(gatherRate(m, 3).binding).toBe('resource');
        // Three rocks down 5 ticks after each 3-tick ore: the first is back while the other two are mined (6 ticks),
        // so the cap, 3/(3 + 5) = 3/8, is over the player's 1/3 and the player binds.
        const rocks = model({ deplete: { chance: 1, respawnTicks: 5 } });
        expect(resourceCap(rocks, 3)).toBe(3 / 8);
        expect(gatherRate(rocks, 3)).toEqual({ itemsPerTick: 1 / 3, binding: 'player' });
    });

    test('rejects NaN and out-of-range inputs, naming the field and value', () => {
        expect(() => ticksPerItem(model({ success: NaN }))).toThrow(/success NaN/);
        expect(() => ticksPerItem(model({ success: 1.5 }))).toThrow(/success 1.5/);
        expect(() => ticksPerItem(model({ ticksPerAttempt: 0 }))).toThrow(/ticksPerAttempt 0/);
        expect(() => ticksPerItem(model({ ticksPerAttempt: NaN }))).toThrow(/ticksPerAttempt NaN/);
        expect(() => ticksPerItem(model({ ticksPerAttempt: Infinity }))).toThrow(/ticksPerAttempt Infinity/);
        expect(() => ticksPerItem(model({ failTicks: -1 }))).toThrow(/failTicks -1/);
        expect(() => ticksPerItem(model({ failTicks: NaN }))).toThrow(/failTicks NaN/);
        for (const chance of [NaN, 0, -0.5, 1.5]) {
            expect(() => resourceCap(dep(chance), 1)).toThrow(new RegExp(`deplete.chance ${chance}`));
            expect(() => gatherRate(dep(chance), 1)).toThrow(/deplete.chance/);
        }
        expect(() => resourceCap(dep(1, -1), 1)).toThrow(/respawnTicks -1/);
        expect(() => resourceCap(dep(1, NaN), 1)).toThrow(/respawnTicks NaN/);
        expect(() => resourceCap(dep(1, Infinity), 1)).toThrow(/respawnTicks Infinity/);
    });

    test('a resource that never depletes has no cap', () => {
        expect(resourceCap(model({}), 1)).toBe(Infinity);
        expect(gatherRate(model({}), 1).binding).toBe('player');
    });
});
