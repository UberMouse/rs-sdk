// The curated methods (world.json `methods`) rated at a player's profile, for the conductor and agents: one
// method's floor (methodRate), and the methods that train a skill, filtered by what the account can reach and the
// hazards it accepts and ranked by floor XP/hr, each with its measured figures (bestMethods). A thin layer over
// model/method.ts: the floor, the levels and tools a family asks for and the measured figures are its, as the
// training pages read them.
//
// - Levels and tools: a method counts when its families model it at the profile (no ProfileError): each family refuses
//   a level under its requirement itself, and woodcutting and mining an axe or pickaxe the profile lacks (mining one
//   above its Mining level too) (model/families/), so the query keeps no copy of those rules. A method with walk pairs
//   (Family.walks) none of whose accepted ways models (a lap that closes over none) drops out too; any other error
//   stops the query as a MethodError naming the method. The profile's tools are its axe and pickaxe, the ones the
//   checkers would pick, and its worn objs (a staff, a ring of forging, goldsmith gauntlets) that smelting and
//   superheat read (profile.ts): the caller's to set. A measured figure is rated at the tool and worn objs its runs
//   used instead (model/method.ts measuredProfile).
// - Reach: a method's `ways` are the requirement sets that get to all of its sites, shortest travel first; the query
//   rates the first one `met` accepts every token of that models (conductor/lib/account.ts meetsOneOf's semantics:
//   `[]` needs nothing). A way's `skill:<stat>:<n>` tokens are held to the profile's levels as well, `met` or not: a
//   profile under a course's Agility gate gets no rate from it. With `met` omitted every other token counts as met, so
//   each method is rated over its shortest way the profile's levels let in: the query can't know the account, and
//   each result names the way it rated.
// - Hazards: the deepest Wilderness level of the sites and tiles the method stands at (its site, processors and
//   bank, and an `area` record's sites its spawns are in), and whether any of them is multiway. The legs between them don't count: world.json keeps a leg's run ticks and
//   requirement set, not the tiles it crosses. A method at npcs (combat) adds whether one there hunts the profile, at
//   its combat level, and the largest max hit there (ResolvedMethod.npcs); neither adds modelled damage.
// - Style: a combat method is rated on the style of its gear that suits the queried skill (model/method.ts
//   styleParams): Attack accurate, Strength aggressive, Defence defensive, Hitpoints and Prayer the best of them. The
//   gear is the record's, with the profile's worn objs in the slots they take (model/method.ts wearing).
import { loadFreshWorld } from './load';
import type { CycleRates } from './model/cycle';
import { readGameData } from './model/families/index';
import { ModelError, ProfileError } from './model/family';
import {
    forMethod,
    fromWorldMethod,
    measuredFigures,
    methodModel,
    methodRate as rateMethod,
    sinkStops,
    trains,
    type MeasuredFigure,
    type MethodContext,
    type MethodModel,
    type ResolvedMethod,
} from './model/method';
import { combatLevelOf, type Profile } from './model/profile';
import { SKILLS, type Skill } from './model/server';
import { lowestLevel } from './roll';
import type { World } from './types';
import { cmp } from './util';

export interface BestOptions {
    /**
     * Whether the account meets a requirement token (conductor/lib/account.ts tokens: `quest:<id>`,
     * `skill:<stat>:<level>`, `coins:<n>`, ...). Omitted: every token is met but a skill token, which the profile's
     * levels judge either way.
     */
    met?: (token: string) => boolean;
    /** The deepest Wilderness level a method's sites may be at (0: none in the Wilderness). Omitted: no limit. */
    maxWilderness?: number;
    /** false: no method with a multiway site or tile. Omitted or true: multiway ones count. */
    multiway?: boolean;
    /** false: no method where an npc hunts the profile (Hazard.aggressive). Omitted or true: those count. */
    aggressive?: boolean;
}

export interface Hazard {
    /** The deepest Wilderness level of the method's sites and tiles, 0 outside it. */
    wildernessLevel: number;
    /** Whether any of the method's sites and tiles is multiway. */
    multiway: boolean;
    /**
     * Whether an npc where the method acts hunts the profile: one that hunts players with its combat level at most
     * the npc's limit, or any level in the Wilderness (model/npcs.ts huntsUpTo). False for a method at no npcs.
     */
    aggressive: boolean;
    /** The largest max hit of the npcs where the method acts; absent for a method at none. */
    maxHit?: number;
    /** The target npc's `retreat` HP, at which it runs instead of fighting back (not priced); absent when none. */
    retreat?: number;
}

export interface RankedMethod {
    method: ResolvedMethod;
    /** The way rated, an index into `method.ways`: the shortest one whose reach `met` and the profile's levels accept. */
    way: number;
    /** The floor's XP/hr of the queried skill at the profile, over that way. */
    xpPerHour: number;
    /**
     * The whole floor at the profile over that way (model/cycle.ts). Its `uncalibrated` marks a kill whose rates leave
     * out food trips (xpPerHour and gpPerHour overstated): weigh it against the calibrated methods.
     */
    rates: CycleRates;
    hazard: Hazard;
    /** The method's measured figures for the queried skill, each beside the floor at its own levels and tool over `way`. */
    measured: MeasuredFigure[];
}

export interface MethodQuery {
    /**
     * The floor of method `id` at `profile`, over its shortest way, rated for `skill` (by default the method's: the
     * style a combat method swings). Throws for an unknown id, a skill it does not train (Prayer for a kill that buries no
     * bones) or a profile it can't model.
     */
    methodRate(id: string, profile: Profile, skill?: Skill): CycleRates;
    /** The methods that train `skill` and pass `opts` at `profile`, by floor XP/hr of it (highest first), then id. */
    bestMethods(skill: Skill, profile: Profile, opts?: BestOptions): RankedMethod[];
}

/**
 * Whether a method's npcs are fought in the Wilderness: its gather site is there, or with an area its deepest site.
 * The player stands there to fight them, so there a hunter hunts every combat level (methodHazard).
 */
export function fightsInWilderness(m: Pick<ResolvedMethod, 'site' | 'areaHazard'>): boolean {
    return Math.max(m.site.wildernessLevel, m.areaHazard?.wildernessLevel ?? 0) > 0;
}

/**
 * The hazard of a method's stops (the gather site and the sites and bare tiles its sink stops at, and an `area`
 * record's sites, ResolvedMethod.areaHazard) and its npcs, at `profile`'s combat level (from its base levels, as
 * `~player_combat_level` reads `stat_base`). An npc's Wilderness test is fightsInWilderness.
 */
export function methodHazard(
    m: Pick<ResolvedMethod, 'site' | 'sink' | 'npcs' | 'areaHazard'>,
    profile: Profile,
): Hazard {
    const stops = [m.site, ...sinkStops(m.sink), ...(m.areaHazard ? [m.areaHazard] : [])];
    const combat = combatLevelOf(profile);
    const wild = fightsInWilderness(m);
    return {
        wildernessLevel: Math.max(...stops.map(s => s.wildernessLevel)),
        multiway: stops.some(s => s.multiway),
        aggressive: (m.npcs?.hunters ?? []).some(h => h.upTo === null || wild || combat <= h.upTo),
        ...(m.npcs ? { maxHit: m.npcs.maxHit } : {}),
        ...(m.npcs?.retreat !== undefined ? { retreat: m.npcs.retreat } : {}),
    };
}

/** The query over `world`'s methods, rated with `model` (methodModel). */
export function methodQuery(
    world: Pick<World, 'sites' | 'features' | 'methods'> & Partial<Pick<World, 'crossings' | 'gates'>>,
    model: MethodModel,
): MethodQuery {
    const ctx: MethodContext = { world, ...model };
    const methods = world.methods.map(wm => fromWorldMethod(wm, world, model.zones));
    const byId = new Map(methods.map(m => [m.def.id, m]));
    return {
        methodRate(id, profile, skill) {
            const m = byId.get(id);
            if (!m) throw new Error(`No method ${id} in world.json (it has ${[...byId.keys()].join(', ')})`);
            return forMethod(m, () => {
                if (skill !== undefined && !trains(m, skill)) throw new ModelError(`it does not train ${skill}`);
                return rateMethod(m, profile, ctx, undefined, skill);
            });
        },
        bestMethods(skill, profile, opts = {}) {
            const met = opts.met ?? (() => true);
            const ranked: RankedMethod[] = [];
            for (const m of methods) {
                if (!trains(m, skill)) continue;
                const hazard = methodHazard(m, profile);
                if (opts.maxWilderness !== undefined && hazard.wildernessLevel > opts.maxWilderness) continue;
                if (opts.multiway === false && hazard.multiway) continue;
                if (opts.aggressive === false && hazard.aggressive) continue;
                // The first way `met` accepts that models: a family that picks among walk pairs may close its lap over
                // one way's walks and not another's.
                const found = forMethod(m, () => {
                    let first: ModelError | undefined;
                    for (const [i, w] of m.ways.entries()) {
                        if (!w.reach.every(met)) continue;
                        if (!SKILLS.every(s => profile.levels[s] >= lowestLevel([w.reach], s))) continue;
                        try {
                            return { way: i, rates: rateMethod(m, profile, ctx, i, skill) };
                        } catch (e) {
                            // A family refusing the profile (a level under its requirement, no axe or pickaxe, a
                            // pickaxe above its Mining level) drops the method; any other error is a fault, named by
                            // forMethod.
                            if (e instanceof ProfileError) return undefined;
                            if (!(e instanceof ModelError)) throw e;
                            first ??= e;
                        }
                    }
                    // A method with walk pairs may close over none of its accepted ways: out, as a lap that does not
                    // close is not a fault. Any other method's ModelError is one.
                    if (first && !m.ways.some(w => w.walks)) throw first;
                    return undefined;
                });
                if (!found) continue;
                const { way, rates } = found;
                const xpPerHour = rates.xpPerHour[skill] ?? 0;
                const measured = forMethod(m, () => measuredFigures(m, skill, ctx, way));
                ranked.push({ method: m, way, xpPerHour, rates, hazard, measured });
            }
            return ranked.sort((a, b) => b.xpPerHour - a.xpPerHour || cmp(a.method.def.id, b.method.def.id));
        },
    };
}

let shared: MethodQuery | undefined;

/**
 * The query over the committed world.json (loadFreshWorld: it refuses one built from other game data than
 * server/content holds) and the model from the game data, built on first use.
 */
const defaultQuery = (): MethodQuery => (shared ??= methodQuery(loadFreshWorld(), methodModel(readGameData())));

/** methodRate over the committed world.json (defaultQuery). */
export const methodRate = (id: string, profile: Profile): CycleRates => defaultQuery().methodRate(id, profile);

/** bestMethods over the committed world.json (defaultQuery). */
export const bestMethods = (skill: Skill, profile: Profile, opts?: BestOptions): RankedMethod[] =>
    defaultQuery().bestMethods(skill, profile, opts);
