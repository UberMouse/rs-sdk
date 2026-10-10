// Ground-floor banks on the surface that a free-to-walk account can use, for tasks that bank "at the
// nearest bank" when given no area.
import { distance } from './util';
import type { Area } from './area';

export interface BankSite {
    name: string;
    /** The public side of the booths (the tile a player stands on), not the banker's side. */
    stand: { x: number; z: number };
    /** False: never picked as "nearest"; the reason is in `skip`. A caller can still pass it as an area. */
    auto: boolean;
    skip?: string;
}

/** Radius of the area a bank walk aims for; `walkToArea` walks to within radius - 1 tiles of `stand`. */
export const BANK_STAND_RADIUS = 3;

/**
 * Booths (loc `bankbooth`, id 2213) and bankers (npc `banker1`/`banker2`, `kharidbanker1`/`2`) read
 * from server/content/maps/*.jm2, level 0. The stand tile is the side of the booths opposite the bankers.
 * Left out: the members-region banks (Ardougne, Yanille, Seers, Catherby, Fishing Guild, ...), none of
 * which a free account is sent to, and every bank in the Wilderness (there is none on the surface).
 */
export const BANKS: readonly BankSite[] = [
    { name: 'Varrock West', stand: { x: 3185, z: 3436 }, auto: true },
    { name: 'Varrock East', stand: { x: 3254, z: 3420 }, auto: true },
    { name: 'Falador West', stand: { x: 2947, z: 3368 }, auto: true },
    { name: 'Falador East', stand: { x: 3013, z: 3355 }, auto: true },
    { name: 'Edgeville', stand: { x: 3094, z: 3491 }, auto: true },
    {
        name: 'Draynor',
        stand: { x: 3092, z: 3243 },
        auto: false,
        skip: 'dark wizards spawn around (3084,3236), 8 tiles away (learnings/hazards.md)',
    },
    {
        name: 'Al Kharid',
        stand: { x: 3269, z: 3167 },
        auto: false,
        skip: 'behind the 10 gp toll gate, which a walk does not pay',
    },
];

/** The nearest bank a task may pick on its own to the point (straight-line, Euclidean), or undefined. */
export function nearestBank(from: { x: number; z: number }): BankSite | undefined {
    let best: BankSite | undefined;
    for (const b of BANKS) {
        if (!b.auto) continue;
        if (!best || distance(from, b.stand) < distance(from, best.stand)) best = b;
    }
    return best;
}

export const bankArea = (b: BankSite): Area => ({ ...b.stand, radius: BANK_STAND_RADIUS });
