import type { BotWorldState } from '../../sdk/types';
import type { Counter } from './task';

type Skill = BotWorldState['skills'][number];

/**
 * Milliseconds per game tick on the local server (400, not the classic 600).
 * See learnings/local-server.md; set by NODE_TICKRATE in server/engine/src/util/Environment.ts.
 */
export const TICK_MS = 400;

export function errMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
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

/** Filename-safe UTC timestamp: the ISO string with `:` and `.` replaced by `-`. */
export function fileStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Matches the `fileStamp()` prefix, including its trailing `-`, of a filename. */
export const FILE_STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
