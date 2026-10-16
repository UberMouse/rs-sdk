// Runecrafting geography and numbers, from server/content/scripts/skill_runecraft/configs/
// (runecraft.dbrow, essence_mine_teleports.enum) and the ruins locs in wiki/world.json.
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import type { TaskContext } from './task';

/**
 * The F2P altars. `square` is the temple's map square x (enter_coord 0_<square>_75_*, so x
 * square*64..+63, z 4800-4863); `ruins` the Mysterious ruins loc on the surface; `level` is from runecraft.dbrow.
 */
export const ALTARS = {
    air: {
        talisman: 'Air talisman',
        level: 1,
        square: 44,
        ruins: { x: 2984, z: 3291 },
    },
    mind: {
        talisman: 'Mind talisman',
        level: 2,
        square: 43,
        ruins: { x: 2981, z: 3513 },
    },
    water: {
        talisman: 'Water talisman',
        level: 5,
        square: 42,
        ruins: { x: 3184, z: 3164 },
    },
    earth: {
        talisman: 'Earth talisman',
        level: 9,
        square: 41,
        ruins: { x: 3305, z: 3473 },
    },
    fire: {
        talisman: 'Fire talisman',
        level: 14,
        square: 40,
        ruins: { x: 3312, z: 3254 },
    },
    body: {
        talisman: 'Body talisman',
        level: 20,
        square: 39,
        ruins: { x: 3052, z: 3444 },
    },
} as const;
export type AltarName = keyof typeof ALTARS;

/** The bot stands in the 64x64 map square (sx, 75), the altar temples' and essence mine's row. */
const inSquare = (s: BotWorldState, sx: number): boolean =>
    !!s.player &&
    s.player.worldX >= sx * 64 &&
    s.player.worldX < sx * 64 + 64 &&
    s.player.worldZ >= 4800 &&
    s.player.worldZ < 4864;

/** The Rune Essence Mine is map square 45_75 (every essence_mine_teleports entry is 0_45_75_*). */
export const inEssenceMine = (s: BotWorldState): boolean => inSquare(s, 45);
export const inTemple = (s: BotWorldState, altar: AltarName): boolean => inSquare(s, ALTARS[altar].square);

/** Rune essence as the game names it in this revision (no pure essence). */
export const ESSENCE = /^rune essence$/i;

export const ALTAR_NAMES = Object.keys(ALTARS) as [AltarName, ...AltarName[]];

export const PORTAL = /^portal$/i;
export const USE_OPTION = /^use$/i;

/** The nearest reachable loc in view that `ok` accepts. */
export const nearestReachableLoc = (
    ctx: TaskContext<unknown, object>,
    ok: (l: NearbyLoc) => boolean,
): NearbyLoc | undefined =>
    ctx
        .state()
        .nearbyLocs.filter(l => l.reachable === true && ok(l))
        .sort((a, b) => a.distance - b.distance)[0];

/**
 * The Rune Essence Mine's exit portals (blankrunestone_exit_portal, id 2492; m45_75.jm2 locs). A portal leads out beside Aubury if the mine was entered through him, else to Sedridor.
 */
export const ESSENCE_PORTALS = [
    { x: 2885, z: 4850 },
    { x: 2889, z: 4813 },
    { x: 2932, z: 4854 },
    { x: 2933, z: 4815 },
] as const;

/** The mine's Rune Essence rocks (id 2491), in four clusters; a teleport lands up to 25 tiles from the nearest. */
export const ESSENCE_ROCK_SPOTS = [
    { x: 2891, z: 4847 },
    { x: 2893, z: 4812 },
    { x: 2925, z: 4848 },
    { x: 2927, z: 4814 },
] as const;

/** The point of a non-empty list nearest the bot. */
export const nearestPoint = <P extends { x: number; z: number }>(
    ctx: TaskContext<unknown, object>,
    points: readonly P[],
): P => points.reduce((best, p) => (ctx.distanceTo(p.x, p.z) < ctx.distanceTo(best.x, best.z) ? p : best));
