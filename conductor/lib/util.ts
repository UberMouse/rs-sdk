import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { BotWorldState } from '../../sdk/types';
import type { Counter } from './task';

type Skill = BotWorldState['skills'][number];

/**
 * Milliseconds per game tick on the local server (400, not the classic 600).
 * See learnings/local-server.md; set by NODE_TICKRATE in server/engine/src/util/Environment.ts.
 */
export const TICK_MS = 400;

/** JSON with sorted keys, so equal values always give the same string (params grouping, command matching). */
export function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        return `{${Object.keys(obj)
            .sort()
            .map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v);
}

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

/** How many items matching `pattern` the inventory holds, counting a stack as its size. */
export function countItems(state: BotWorldState, pattern: RegExp): number {
    return state.inventory.filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

/** How many of item `id` the inventory holds, counting a stack as its size. */
export function countItemId(state: BotWorldState, id: number): number {
    return state.inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
}

/** Straight-line distance in tiles between two world points. */
export function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The counter stored in `counts` under `key`; absent reads as 0. */
export function mapCounter(counts: Map<string, number>, key: string): Counter {
    return {
        add(by = 1) {
            const next = (counts.get(key) ?? 0) + by;
            counts.set(key, next);
            return next;
        },
        reset() {
            counts.delete(key);
        },
    };
}

// The stamp format lives in its own module so the plan viewer's page can bundle it without Node.
export { FILE_STAMP_PREFIX, fileStamp } from './stamp';

/** A pattern for exactly this item name (case-insensitive), for names that come in as task params. */
export function exactName(name: string): RegExp {
    return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}
