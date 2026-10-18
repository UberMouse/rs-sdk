// The server constants a rate rests on, read from the engine's defaults when the module loads (not hardcoded, so a
// changed default shows at the next build), the skill names, and the level curve.
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENGINE_SRC } from '../paths';

export { levelForXp, xpForLevel } from '../../../conductor/lib/xp';

/**
 * The skills, by the engine's stat names (server/engine/src/engine/entity/PlayerStat.ts, the enabled ones) in
 * lower case, as scripts (`stat(woodcutting)`) and requirement tokens (`skill:mining:60`) write them.
 */
export const SKILLS = [
    'attack',
    'defence',
    'strength',
    'hitpoints',
    'ranged',
    'prayer',
    'magic',
    'cooking',
    'woodcutting',
    'fletching',
    'fishing',
    'firemaking',
    'crafting',
    'smithing',
    'mining',
    'herblore',
    'agility',
    'thieving',
    'runecraft',
] as const;
export type Skill = (typeof SKILLS)[number];

export interface ServerDefault {
    value: number;
    /** `file:line`, the file relative to server/engine/src. */
    at: string;
}

/** The engine source a default is read from, and the line that sets it (group 1 the whole-number value). */
export const TICK_RATE_SOURCE = {
    file: 'util/Environment.ts',
    line: /^\s*NODE_TICKRATE:\s*tryParseInt\(process\.env\.NODE_TICKRATE,\s*(\d+)\),\s*$/,
};
export const XP_RATE_SOURCE = { file: 'util/WorldConfig.ts', line: /^\s*xpRate:\s*(\d+),/ };

/** The value on the one line of `text` that `line` matches; throws when none or more than one does. */
export function readDefault(file: string, text: string, line: RegExp): ServerDefault {
    const hits = text.split('\n').flatMap((raw, i) => {
        const m = raw.match(line);
        return m ? [{ value: Number(m[1]), at: `${file}:${i + 1}` }] : [];
    });
    if (hits.length !== 1)
        throw new Error(`Expected one line matching ${line} in ${file}, found ${hits.length}: has the default moved?`);
    return hits[0]!;
}

const fromEngine = (src: { file: string; line: RegExp }): ServerDefault =>
    readDefault(src.file, readFileSync(join(ENGINE_SRC, src.file), 'utf8'), src.line);

/**
 * Milliseconds per game tick: the `NODE_TICKRATE` default (World.ts:126 ticks at it); `conductor/local/up.sh` sets
 * no `NODE_TICKRATE`.
 */
export const TICK_MS_DEFAULT = fromEngine(TICK_RATE_SOURCE);
export const TICK_MS = TICK_MS_DEFAULT.value;
export const TICKS_PER_HOUR = 3_600_000 / TICK_MS;

/**
 * The XP multiplier: `node.xpRate`'s default (`NODE_XPRATE` overrides it, WorldConfig.ts; `up.sh` sets none).
 * `stat_advance` (PlayerOps.ts) passes a script's XP to `addXp` (entity/Player.ts), which adds it times this rate to
 * the stat, kept in tenths: a script's `175` is 17.5 XP before the rate.
 */
export const XP_RATE_DEFAULT = fromEngine(XP_RATE_SOURCE);
export const XP_RATE = XP_RATE_DEFAULT.value;
