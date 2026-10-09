const MAX_LEVEL = 99;
/** The game's XP curve: each level adds `level + XP_BASE * 2^(level / XP_DOUBLING_LEVELS)` points, and the running total is divided by `XP_DIVISOR`. */
const XP_BASE = 300;
const XP_DOUBLING_LEVELS = 7;
const XP_DIVISOR = 4;

/** Total XP needed for each level, indexed by level (1..MAX_LEVEL), per the game's formula. */
const XP_FOR_LEVEL: number[] = [0, 0];
{
    let points = 0;
    for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
        points += Math.floor(lvl + XP_BASE * 2 ** (lvl / XP_DOUBLING_LEVELS));
        XP_FOR_LEVEL[lvl + 1] = Math.floor(points / XP_DIVISOR);
    }
}

/** XP at level 99. */
export const MAX_XP = XP_FOR_LEVEL[MAX_LEVEL]!;
