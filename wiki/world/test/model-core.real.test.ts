import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AXES, PICKAXES, readTools } from '../model/profile';
import { statRandomChance } from '../model/roll';
import { TICK_MS, TICK_MS_DEFAULT, TICKS_PER_HOUR, XP_RATE, XP_RATE_DEFAULT, xpForLevel } from '../model/server';
import { ENGINE_SRC, SCRIPTS } from '../paths';
import { readConfigs } from '../sources/configs';
import { readDbrows } from '../sources/dbrows';

const engine = (file: string) => readFileSync(join(ENGINE_SRC, file), 'utf8');

/** The text of `src` from the line starting `from` up to (not including) the line starting `to`. */
function between(src: string, from: string, to: string): string {
    const lines = src.split('\n');
    const a = lines.findIndex(l => l.trim().startsWith(from));
    const b = lines.findIndex((l, i) => i > a && l.trim().startsWith(to));
    if (a < 0 || b < 0) throw new Error(`No block from \`${from}\` to \`${to}\``);
    return lines.slice(a, b).join('\n');
}

describe('server constants from the engine', () => {
    test('the tick is 400 ms and XP is 25x, read from the defaults', () => {
        expect(TICK_MS).toBe(400);
        expect(TICK_MS_DEFAULT.at).toMatch(/^util\/Environment\.ts:\d+$/);
        expect(TICKS_PER_HOUR).toBe(9000);
        expect(XP_RATE).toBe(25);
        expect(XP_RATE_DEFAULT.at).toMatch(/^util\/WorldConfig\.ts:\d+$/);
    });

    test('the world ticks at NODE_TICKRATE and addXp multiplies by node.xpRate', () => {
        expect(engine('engine/World.ts')).toContain('TICKRATE: number = Environment.NODE_TICKRATE;');
        expect(engine('engine/entity/Player.ts')).toContain('const multi = allowMulti ? Environment.node.xpRate : 1;');
    });
});

describe('the ports match the engine code they port', () => {
    test("xpForLevel is the engine's levelExperience table, in whole XP", () => {
        // Player.ts's table loop is plain JS: run it and compare every level.
        const loop = between(
            engine('engine/entity/Player.ts'),
            'const levelExperience',
            'export function getLevelByExp',
        );
        const table = new Function(`${loop}\nreturn levelExperience;`)() as Int32Array;
        for (let level = 2; level <= 99; level++) expect(xpForLevel(level) * 10).toBe(table[level - 2]!);
    });

    test("statRandomChance is the engine's stat_random value over 256", () => {
        // PlayerOps.ts STAT_RANDOM's two value lines, run for every level and the pairs below.
        const body = between(
            engine('engine/script/handlers/PlayerOps.ts'),
            'const clampedLevel = Math.min(level, 99);',
            'const chance = Math.floor(JavaRandom.nextDouble() * 256);',
        );
        expect(engine('engine/script/handlers/PlayerOps.ts')).toContain('state.pushInt(value > chance ? 1 : 0);');
        const value = new Function('level', 'low', 'high', `${body}\nreturn value;`) as (...a: number[]) => number;
        for (const [low, high] of [
            [14, 44],
            [7, 75],
            [50, 240],
            [15, 160],
            [128, 512],
        ] as const)
            for (let level = 1; level <= 105; level++)
                expect(statRandomChance(level, low, high)).toBe(
                    Math.min(Math.max(value(level, low, high), 0), 256) / 256,
                );
    });

    test('the unit tests use the dbrows pairs as the game has them', () => {
        const rows = new Map(readDbrows().map(r => [r.row, r.data]));
        expect(rows.get('yew_tree_table')?.successchance).toContainEqual(['rune_axe', '14', '44']);
        expect(rows.get('gold_rock_table')?.rock_successchance).toEqual([['7', '75']]);
        expect(rows.get('pickpocket_guard')?.success_chance).toEqual([['50', '240']]);
        expect(rows.get('cooking_generic_beef')?.successchance).toEqual([['128', '512']]);
    });
});

/** The objs a proc returns, in order (`return(null)` left out). */
const returns = (file: string, proc: string): string[] => {
    const src = readFileSync(join(SCRIPTS, file), 'utf8');
    const body = src.slice(src.indexOf(`[proc,${proc}]`)).split(/\n\[/)[0]!;
    return [...body.matchAll(/^\s*return\s*\((\w+)\);/gm)].map(m => m[1]!).filter(o => o !== 'null');
};

describe('tools', () => {
    test("AXES and PICKAXES are their checkers' order", () => {
        expect(returns('skill_woodcutting/scripts/woodcut.rs2', 'woodcutting_axe_checker')).toEqual(AXES);
        expect(returns('skill_mining/scripts/pickaxe_checker.rs2', 'pickaxe_checker')).toEqual(PICKAXES);
    });

    test('the pickaxe levels are the configs', () => {
        const tools = readTools(readConfigs('obj'));
        expect(tools.pickaxe.map(t => [t.obj, t.level])).toEqual([
            ['rune_pickaxe', 41],
            ['adamant_pickaxe', 31],
            ['mithril_pickaxe', 21],
            ['steel_pickaxe', 6],
            ['iron_pickaxe', 0],
            ['bronze_pickaxe', 0],
        ]);
    });
});
