import type { BotWorldState } from '../../sdk/types';

type Skill = BotWorldState['skills'][number];

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

/** A numeric counter kept in a task's scratch memory; absent or non-numeric reads as 0. */
export function readCount(memory: Record<string, unknown>, key: string): number {
    const v = memory[key];
    return typeof v === 'number' ? v : 0;
}

/** Filename-safe UTC timestamp: the ISO string with `:` and `.` replaced by `-`. */
export function fileStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Matches the `fileStamp()` prefix, including its trailing `-`, of a filename. */
export const FILE_STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
