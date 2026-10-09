import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { BotWorldState } from '../../sdk/types';
import type { Counter } from './task';

type Skill = BotWorldState['skills'][number];

export function errMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** CLI tools: print the message to stderr and exit (1: failed, 2: usage). */
export function fail(message: string, code = 1): never {
    console.error(message);
    process.exit(code);
}

/** parseArgs for CLI tools: an unknown or malformed flag is a usage error (exit 2), not a stack trace. */
export function parseCli<T extends ParseArgsConfig['options']>(options: T, usage: string) {
    try {
        return parseArgs({ args: process.argv.slice(2), allowPositionals: true, options });
    } catch (e) {
        fail(`${errMessage(e)}\n${usage}`, 2);
    }
}

/** Skill by name, ignoring case (`--until level:woodcutting:15` vs the game's "Woodcutting"). */
export function findSkill(state: BotWorldState, name: string): Skill | undefined {
    return state.skills.find(k => k.name.toLowerCase() === name.toLowerCase());
}

/** XP a skill has gained since `xpBefore` (skill name -> XP at the start of the run). */
export function skillXpGained(skill: Skill, xpBefore: Record<string, number>): number {
    return skill.experience - (xpBefore[skill.name] ?? skill.experience);
}

/** Skill name -> XP gained since `xpBefore`, only for skills that gained. */
export function xpGainedSince(state: BotWorldState, xpBefore: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of state.skills) {
        const d = skillXpGained(k, xpBefore);
        if (d > 0) out[k.name] = d;
    }
    return out;
}

/** Inventory slots in the backpack. */
export const INVENTORY_SLOTS = 28;

/** Straight-line distance in tiles between two world points. */
export function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A counter stored in a task's scratch memory under `key`; absent or non-numeric reads as 0. */
export function memoryCounter(memory: Record<string, unknown>, key: string): Counter {
    const read = () => {
        const v = memory[key];
        return typeof v === 'number' ? v : 0;
    };
    return {
        add(by = 1) {
            const next = read() + by;
            memory[key] = next;
            return next;
        },
        reset() {
            memory[key] = 0;
        },
    };
}

/** Filename-safe UTC timestamp: the ISO string with `:` and `.` replaced by `-`. */
export function fileStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Matches the `fileStamp()` prefix, including its trailing `-`, of a filename. */
export const FILE_STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
