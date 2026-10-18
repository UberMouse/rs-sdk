// The contract a formula module implements: one kind of action (chop, mine, fish, pickpocket, cook ...) at a site,
// turned into what one attempt costs and yields. rate.ts and the cycle model take it from there.
import type { Site, World } from '../types';
import type { Profile } from './profile';
import type { Skill } from './server';

/** One action repeated at a site, as the game's script runs it. */
export interface ActionModel {
    /** Ticks between attempts. */
    ticksPerAttempt: number;
    /** Probability an attempt succeeds, in (0, 1]. */
    success: number;
    /** XP per success by skill, in the script's tenths, before XP_RATE. */
    xpTenths: Partial<Record<Skill, number>>;
    /** Items expected per success. */
    products: { obj: string; count: number }[];
    /** Items used per success (bait) or per attempt; the family says which. */
    consumes: { obj: string; count: number }[];
    /** Extra ticks a failed attempt costs (a stun). */
    failTicks?: number;
    /** A feature runs out: with `chance` (in (0, 1]) per success, then stays down `respawnTicks`. Absent: it never does. */
    deplete?: { chance: number; respawnTicks: number };
}

/** Thrown by `Family.model` when it can't model the case, with the reason. */
export class ModelError extends Error {}

export interface Family {
    /** `woodcutting`, `fishing`, ... */
    id: string;
    skills: Skill[];
    /** Throws a ModelError when the site, params or profile can't be modelled (an unknown subtype, no tool, a level under the requirement). */
    model(site: Site, params: unknown, profile: Profile, world: World): ActionModel;
}
