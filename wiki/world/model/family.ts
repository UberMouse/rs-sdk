// The contract a formula module implements: one kind of action (chop, mine, fish, pickpocket, cook ...) at a site,
// turned into what one attempt costs and yields. rate.ts and the cycle model take it from there.
import type { FeatureKind, Site, Tile, World } from '../types';
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
    /** Extra ticks a success costs (a `p_delay` after it, during which the next click is refused). */
    successTicks?: number;
    /**
     * Hitpoints a failed attempt costs (a pickpocket stun's hit). Food per hour is the damage per hour over the
     * food's heal, so the method that names the food turns it into a supply. Undefined when a fail costs none.
     */
    failDamage?: number;
    /**
     * Hitpoints a success is expected to cost besides failDamage's (an agility lap's falls, at the profile's
     * hitpoints). The food that covers it is eaten in no ticks of its own: an eat has no `p_delay`
     * (player/scripts/consumption/consume.rs2:115-131). 0: the action can hurt, not at this profile.
     */
    damage?: number;
    /**
     * On an action that swings on `%action_delay` (a kill): the ticks from one swing to the next, the weapon's
     * `attackrate` (skill_combat/scripts/player/player_melee.rs2:55-60). An eat adds to that delay, so the food
     * `damage` takes costs EAT_DELAY ticks each; a bury fits between two swings when this is at least
     * BURY_SWING_GAP (cycle.ts).
     */
    attackRate?: number;
    /**
     * Inputs one product of a process step takes (5 bars a platebody); default 1. A step's chained input is its
     * `consumes[0]`, whose count must be `batch`. The load rounds down to whole batches where the step's input per
     * success is a whole number.
     */
    batch?: number;
    /**
     * On a process step: ticks a trip spends starting the step again, `ticks` once it takes more than `upTo` actions
     * in the trip, and with `repeat` for every further `upTo` too (ceil(actions / upTo) - 1 times). A menu whose
     * largest button makes `upTo` repeats (the anvil's Make 10); one with a Make X pays its count dialog once.
     */
    restart?: { upTo: number; ticks: number; repeat?: boolean };
    /**
     * On a process step: ticks a trip spends once on the step besides its actions' `ticksPerAttempt`, where the first
     * action comes later after the step's arrival or click than the cadence does (the spinning menu's button tick).
     */
    start?: number;
    /**
     * On a process step: the most actions one tick runs, where an action takes no tick of its own (a bow strung each
     * user event). A trip's actions of the step take whole ticks, ceil(actions / perTick) of ticksPerItem, in place of
     * ticksPerItem each.
     */
    perTick?: number;
    /** A feature runs out: with `chance` (in (0, 1]) per success, then stays down `respawnTicks`. Absent: it never does. */
    deplete?: { chance: number; respawnTicks: number };
    /** With `deplete`: the site's features of the target, which the player works in turn (the resource cap's k). */
    features?: number;
    /** Objs the action needs held, worn or in the inventory (an axe, a pickaxe, a fishing rod); bait is in `consumes`. */
    tools?: string[];
}

/** Thrown by `Family.model` when it can't model the case, with the reason. */
export class ModelError extends Error {}

/**
 * The ModelError a family throws when the profile can't do the action: a level under its requirement (requireLevel,
 * a pickaxe above the profile's Mining level among them), or no axe or pickaxe. A query drops the method for that
 * profile; any other ModelError is a fault in the data or the record, and stops it.
 */
export class ProfileError extends ModelError {}

/**
 * What a family reads of the world: the features, and the crossing and gate rows where it has them (an agility lap's
 * obstacles); a family that needs those throws a ModelError without them.
 */
export type ModelWorld = Pick<World, 'features'> & Partial<Pick<World, 'crossings' | 'gates'>>;

export interface Family {
    /** `woodcutting`, `fishing`, ... */
    id: string;
    skills: Skill[];
    /** The kinds of site it acts at: a method's tile must lie in a site of one of them. */
    kinds: FeatureKind[];
    /**
     * Throws a ModelError when the site, params or game data can't be modelled (an unknown subtype, no row), and a
     * ProfileError when the profile can't do it (no axe or pickaxe, a level under the requirement).
     */
    model(site: Site, params: unknown, profile: Profile, world: ModelWorld, walks?: (number | null)[]): ActionModel;
    /**
     * Optional, for a method's gather family: the tile pairs it may walk inside its site (an agility lap's landing to
     * each stand of the next obstacle). method.ts prices each under the way's requirement set, in run ticks, `null`
     * for a pair no walk joins, and passes them to `model` as `walks`, in this order; the family picks among them and
     * throws a ModelError when the ones that walk don't do. A process step's family that has them fails the record.
     */
    walks?(site: Site, params: unknown, world: ModelWorld): { from: Tile; to: Tile }[];
}
