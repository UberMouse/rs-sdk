const MAX_LEVEL = 99;
/**
 * This server's XP curve, mirroring `levelExperience` in
 * server/engine/src/engine/entity/Player.ts. The engine stores tenths of XP; the SDK reports
 * whole XP, so this table is unscaled. Doubling is every 10 levels, not the standard 7
 * (learnings/local-server.md, Rates).
 */
const XP_BASE = 300;
const XP_DOUBLING_LEVELS = 10;
const XP_DIVISOR = 4;

/** Total XP needed for each level, indexed by level (1..MAX_LEVEL), per the engine's formula. */
const XP_FOR_LEVEL: number[] = [0, 0];
{
    let points = 0;
    for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
        points += Math.floor(lvl + XP_BASE * 2 ** (lvl / XP_DOUBLING_LEVELS));
        XP_FOR_LEVEL[lvl + 1] = Math.floor(points / XP_DIVISOR);
    }
}

/** Total XP needed to reach `level` (1..99). */
export function xpForLevel(level: number): number {
    return XP_FOR_LEVEL[Math.min(Math.max(level, 1), MAX_LEVEL)]!;
}

/** The level `xp` gives (1..99). */
export function levelForXp(xp: number): number {
    for (let lvl = MAX_LEVEL; lvl > 1; lvl--) if (xp >= XP_FOR_LEVEL[lvl]!) return lvl;
    return 1;
}

/** XP at level 99. */
export const MAX_XP = XP_FOR_LEVEL[MAX_LEVEL]!;
