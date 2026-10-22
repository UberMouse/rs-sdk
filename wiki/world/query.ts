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
//   stops the query as a MethodError naming the method. The profile's axe and pickaxe are the only tools it holds
//   (profile.ts), the ones the checker would pick: the caller's to set.
// - Reach: a method's `ways` are the requirement sets that get to all of its sites, shortest travel first; the query
//   rates the first one `met` accepts every token of that models (conductor/lib/account.ts meetsOneOf's semantics:
//   `[]` needs nothing). With `met` omitted every token counts as met, so nothing is filtered on reach and each method is rated
//   over its shortest way: the query can't know the account, and each result names the way it rated.
// - Hazards: the deepest Wilderness level of the sites and tiles the method stands at (its site, processors and
//   bank), and whether any of them is multiway. The legs between them don't count: world.json keeps a leg's run ticks and
//   requirement set, not the tiles it crosses.
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
import type { Profile } from './model/profile';
import type { Skill } from './model/server';
import type { World } from './types';
import { cmp } from './util';

export interface BestOptions {
    /**
     * Whether the account meets a requirement token (conductor/lib/account.ts tokens: `quest:<id>`,
     * `skill:<stat>:<level>`, `coins:<n>`, ...). Omitted: every token is met, nothing is filtered on reach.
     */
    met?: (token: string) => boolean;
    /** The deepest Wilderness level a method's sites may be at (0: none in the Wilderness). Omitted: no limit. */
    maxWilderness?: number;
    /** false: no method with a multiway site or tile. Omitted or true: multiway ones count. */
    multiway?: boolean;
}

export interface Hazard {
    /** The deepest Wilderness level of the method's sites and tiles, 0 outside it. */
    wildernessLevel: number;
    /** Whether any of the method's sites and tiles is multiway. */
    multiway: boolean;
}

export interface RankedMethod {
    method: ResolvedMethod;
    /** The way rated, an index into `method.ways`: the shortest one whose reach `met` accepts. */
    way: number;
    /** The floor's XP/hr of the queried skill at the profile, over that way. */
    xpPerHour: number;
    /** The whole floor at the profile over that way (model/cycle.ts). */
    rates: CycleRates;
    hazard: Hazard;
    /** The method's measured figures for the queried skill, each beside the floor at its own levels and tool over `way`. */
    measured: MeasuredFigure[];
}

export interface MethodQuery {
    /** The floor of method `id` at `profile`, over its shortest way. Throws for an unknown id or a profile it can't model. */
    methodRate(id: string, profile: Profile): CycleRates;
    /** The methods that train `skill` and pass `opts` at `profile`, by floor XP/hr of it (highest first), then id. */
    bestMethods(skill: Skill, profile: Profile, opts?: BestOptions): RankedMethod[];
}

/** The hazard of a method's stops: the gather site and the sites and bare tiles its sink stops at. */
export function methodHazard(m: Pick<ResolvedMethod, 'site' | 'sink'>): Hazard {
    const stops = [m.site, ...sinkStops(m.sink)];
    return {
        wildernessLevel: Math.max(...stops.map(s => s.wildernessLevel)),
        multiway: stops.some(s => s.multiway),
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
        methodRate(id, profile) {
            const m = byId.get(id);
            if (!m) throw new Error(`No method ${id} in world.json (it has ${[...byId.keys()].join(', ')})`);
            return forMethod(m, () => rateMethod(m, profile, ctx));
        },
        bestMethods(skill, profile, opts = {}) {
            const met = opts.met ?? (() => true);
            const ranked: RankedMethod[] = [];
            for (const m of methods) {
                if (!trains(m, skill)) continue;
                const hazard = methodHazard(m);
                if (opts.maxWilderness !== undefined && hazard.wildernessLevel > opts.maxWilderness) continue;
                if (opts.multiway === false && hazard.multiway) continue;
                // The first way `met` accepts that models: a family that picks among walk pairs may close its lap over
                // one way's walks and not another's.
                const found = forMethod(m, () => {
                    let first: ModelError | undefined;
                    for (const [i, w] of m.ways.entries()) {
                        if (!w.reach.every(met)) continue;
                        try {
                            return { way: i, rates: rateMethod(m, profile, ctx, i) };
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
