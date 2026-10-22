// A curated method (methods.ts) resolved against the world: its site, its sink sites, the legs of its cycle in run
// ticks under each requirement set that gets to all of them, and the lowest level its families can model it at;
// then its floor at a profile (cycle.ts).
import type { Measured, MethodDef } from '../methods';
import { SINKS, type Way, type wayFinder } from '../distance';
import { isMultiway, readZones, wildernessLevel, type Zones } from '../sources/zones';
import { canonicalSet, minimalSets, type QuestFacts } from '../requirements';
import { lowestLevel } from '../roll';
import {
    SINK_KINDS,
    type FeatureKind,
    type SinkKind,
    type Site,
    type Tile,
    type World,
    type WorldMethod,
} from '../types';
import { cmp, tileKey } from '../util';
import { cycle, type CycleRates, type CycleSink, type Withdraw } from './cycle';
import { ModelError, type ActionModel, type Family } from './family';
import { buildFamilies, type GameData } from './families/index';
import { tourLegs, type LegFinder } from './legs';
import { readFoods, readItems, type Items } from './items';
import { profileAt, profileOf, readTools, toolKindOfObj, type Profile, type Tools } from './profile';
import { SKILLS, type Skill } from './server';

/** A method record the build can't resolve: the message names the record and the reason. */
export class MethodError extends Error {
    constructor(id: string, reason: string) {
        super(`methods.ts ${id}: ${reason}`);
    }
}

/**
 * One walk of the cycle: between two sites' stands, in run ticks, and the requirement set its crossings take. A leg over
 * a random landing is its mean (model/legs.ts), so its run ticks need not be whole.
 */
export interface Leg {
    from: string;
    to: string;
    runTicks: number;
    requires: string[];
}

/** The legs under one requirement set that gets to every site of the method. */
export interface MethodWay {
    reach: string[];
    legs: Leg[];
    /**
     * When the gather family has `walks`: the run ticks of each, under `reach`, in the family's order; `null` for a pair
     * no walk joins.
     */
    walks?: (number | null)[];
}

/**
 * A process step's stop at a bare tile: the family has no site kinds (firemaking), so the record's tile is the stop
 * itself, priced like any tile under each way's requirement set. Its hazard is the tile's, as a site's is its tiles'.
 */
export interface TileStop {
    tile: Tile;
    wildernessLevel: number;
    multiway: boolean;
}

/** The stop at `tile`, with its Wilderness level and whether its zone is multiway (sources/zones.ts). */
export const tileStop = (tile: Tile, zones: Zones): TileStop => ({
    tile,
    wildernessLevel: wildernessLevel(tile),
    multiway: isMultiway(zones, tile),
});

/** Whether a stop is a bare tile rather than a site. */
export const isTileStop = (s: Site | TileStop): s is TileStop => 'tile' in s;

/** A process step's place: a site, a bare tile, or `'here'`, where the previous action stands. */
export type Stop = Site | TileStop | 'here';

/** The id a tile stop goes by in a leg and in world.json's `processors`. */
export const tileStopId = (t: Tile): string => `tile:${t.x},${t.z},${t.level}`;

/** The `family` of a method whose load is withdrawn from the bank it starts at (cycle.ts Withdraw). */
export const WITHDRAW = 'withdraw';

export interface ResolvedMethod {
    def: MethodDef;
    site: Site;
    /** A process sink's steps, one per step of the record, and its bank when it banks at another site than `site`. */
    sink: { mode: 'drop' } | { mode: 'bank'; bank: Site } | { mode: 'process'; steps: Stop[]; bank?: Site };
    /** One per minimal set that reaches the method's sites and walks its legs; shortest travel first. */
    ways: MethodWay[];
    /** The family's first skill, which a level column trains. */
    skill: Skill;
    /**
     * The lowest level of `skill` (every other skill at it too) at which the families model the method and some way's
     * reach lets the account in (its `skill:<stat>:<n>` tokens; the Barbarian course's 35 Agility). The floor assumes
     * tools are wielded and does not check their wield level (a rune pickaxe needs Attack 40).
     */
    minLevel: number;
    /**
     * Each skill the method trains (the gather family's, then the process steps'), and the lowest level of it at which
     * the families model the method with the other skills of the method at 99: what each skill itself needs (fly
     * fishing and cooking trout and salmon: Fishing 20, Cooking 25, where `minLevel`, every skill at once, is 25),
     * raised to the lowest level of it any way's reach asks.
     */
    levels: Partial<Record<Skill, number>>;
}

/** What resolving and modelling a method reads. */
export interface MethodContext {
    /** The crossing and gate rows where a family reads them (ModelWorld). */
    world: Pick<World, 'sites' | 'features'> & Partial<Pick<World, 'crossings' | 'gates'>>;
    families: ReadonlyMap<string, Family>;
    items: Items;
    /** Hitpoints each food heals (items.ts readFoods). */
    foods: ReadonlyMap<string, number>;
    tools: Tools;
    /** The free-to-play and multiway zones: a bare tile stop's hazard. */
    zones: Zones;
    quests?: QuestFacts;
}

/** What the model reads besides the world and the quests: the families, items, foods, tool tiers and zones. */
export type MethodModel = Omit<MethodContext, 'world' | 'quests'>;

/**
 * The model from the game data and the zones (read from the maps when not given); build.ts builds it once, for
 * resolving the methods and for the training pages.
 */
export const methodModel = (data: GameData, zones: Zones = readZones()): MethodModel => ({
    families: buildFamilies(data),
    items: readItems(data.objs),
    foods: readFoods(data.dbrows),
    tools: readTools(data.objs),
    zones,
});

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const coord = (t: Tile): string => `(${t.x}, ${t.z}, ${t.level})`;

/** The one site of `kinds` whose bbox holds `t`; throws a ModelError when none or several do. */
function siteAt(world: MethodContext['world'], kinds: readonly FeatureKind[], t: Tile): Site {
    const holding = world.sites.filter(
        s =>
            kinds.includes(s.kind) &&
            (s.bbox.level ?? t.level) === t.level &&
            t.x >= s.bbox.x1 &&
            t.x <= s.bbox.x2 &&
            t.z >= s.bbox.z1 &&
            t.z <= s.bbox.z2,
    );
    // Bboxes overlap (a sparse site's spans others): one of a target's own tiles names its site.
    const own = holding.filter(s =>
        s.features.some(i => {
            const f = world.features[i]!.tile;
            return f.x === t.x && f.z === t.z && f.level === t.level;
        }),
    );
    if (own.length === 1) return own[0]!;
    if (holding.length !== 1)
        throw new ModelError(
            holding.length
                ? `${coord(t)} lies in several ${kinds.join('/')} sites: ${holding.map(s => s.id).join(', ')}`
                : `no ${kinds.join('/')} site holds ${coord(t)}`,
        );
    return holding[0]!;
}

/** The family by id; throws a ModelError naming the known ones. */
function familyOf(ctx: MethodContext, id: string): Family {
    const f = ctx.families.get(id);
    if (!f) throw new ModelError(`no family ${id} (${[...ctx.families.keys()].join(', ')})`);
    return f;
}

/**
 * The site `nearest` names for the first sink kind of `kinds` the site's kind sinks to, or a ModelError: only that
 * first kind is searched (a cooking family's ['range', 'fire'] searches ranges, never fires).
 */
function nearestOf(world: MethodContext['world'], from: Site, kinds: readonly FeatureKind[]): Site {
    const kind = kinds.find((k): k is SinkKind => (SINK_KINDS as readonly string[]).includes(k));
    const id = kind && SINKS[from.kind]?.includes(kind) ? from.nearest?.[kind]?.site : undefined;
    const site = id === undefined ? undefined : world.sites.find(s => s.id === id);
    if (!site)
        throw new ModelError(
            `site ${from.id} has no nearest ${kind ?? kinds.join('/')} (only the first sink kind of ${kinds.join('/')} is searched): give its tile`,
        );
    return site;
}

/** The stops a sink makes, in the order the cycle visits them: none, the bank, or the steps' stops then the bank. */
export const sinkStops = (sink: ResolvedMethod['sink']): (Site | TileStop)[] =>
    sink.mode === 'drop'
        ? []
        : sink.mode === 'bank'
          ? [sink.bank]
          : [...sink.steps.filter((s): s is Site | TileStop => s !== 'here'), ...(sink.bank ? [sink.bank] : [])];

/** The sites among a sink's stops: its tile stops left out. */
export const sinkSites = (sink: ResolvedMethod['sink']): Site[] =>
    sinkStops(sink).filter((s): s is Site => !isTileStop(s));

/** A stop's id and the tile its legs start and end at. */
const stopId = (s: Site | TileStop): string => (isTileStop(s) ? tileStopId(s.tile) : s.id);
const standOf = (s: Site | TileStop): Tile => (isTileStop(s) ? s.tile : s.stand!);

/** A withdraw record's obj, or a ModelError. */
function withdrawObj(def: MethodDef): string {
    const obj = (def.params as { obj?: unknown } | null)?.obj;
    if (typeof obj !== 'string' || obj === '') throw new ModelError('a withdraw method needs params { obj }');
    return obj;
}

type Finder = ReturnType<typeof wayFinder>;

/**
 * Finder.runTicksBetween by (from, to, requirement set), kept per finder: the methods and ways of one build share a
 * graph and its finder, so a leg or walk two of them price is searched once.
 */
const memos = new WeakMap<Finder, Map<string, Way | null>>();
function wayBetween(finder: Finder, from: Tile, to: Tile, reach: readonly string[]): Way | null {
    let memo = memos.get(finder);
    if (!memo) memos.set(finder, (memo = new Map()));
    const key = `${tileKey(from)} ${tileKey(to)} ${reach.join('\n')}`;
    let way = memo.get(key);
    if (way === undefined) memo.set(key, (way = finder.runTicksBetween(from, to, reach)));
    return way;
}

/**
 * The run ticks of each of a family's walk pairs (Family.walks) under `reach`, null for a pair no walk joins. A pair
 * no walk joins searches all the graph its `to` is reached from; so when `from` reaches no `to` of an earlier pair,
 * a later `to` that walks to that one is not searched: `from` reaching it would reach the earlier one through it.
 */
function pairWalks(
    finder: Finder,
    pairs: readonly { from: Tile; to: Tile }[],
    reach: readonly string[],
): (number | null)[] {
    const unreached = new Map<string, Tile[]>();
    return pairs.map(({ from, to }) => {
        const dead = unreached.get(tileKey(from)) ?? [];
        if (dead.some(t => wayBetween(finder, to, t, reach))) return null;
        const way = wayBetween(finder, from, to, reach);
        if (!way) unreached.set(tileKey(from), [...dead, to]);
        return way?.runTicks ?? null;
    });
}

/** The method's sites and its legs under each requirement set, before the levels are checked. */
function locate(
    def: MethodDef,
    ctx: MethodContext,
    legFinder: LegFinder,
): Pick<ResolvedMethod, 'site' | 'sink' | 'ways'> {
    const withdraw = def.family === WITHDRAW;
    const family = withdraw ? undefined : familyOf(ctx, def.family);
    const site = siteAt(ctx.world, family?.kinds ?? ['bank'], def.at);
    if (!site.stand || !site.reach.length) throw new ModelError(`site ${site.id} has no stand a walk reaches`);
    let sink: ResolvedMethod['sink'];
    if (def.sink.mode !== 'process') {
        if (withdraw) throw new ModelError('a withdraw method needs a process sink');
        sink =
            def.sink.mode === 'drop'
                ? { mode: 'drop' }
                : {
                      mode: 'bank',
                      bank: def.sink.bank
                          ? siteAt(ctx.world, ['bank'], def.sink.bank)
                          : nearestOf(ctx.world, site, ['bank']),
                  };
    } else {
        const { end, bank: tile } = def.sink;
        if (!def.sink.steps.length) throw new ModelError('a process sink needs a step');
        if (tile && withdraw) throw new ModelError('a withdraw method banks where it withdraws: give no sink bank');
        if (tile && end !== 'bank') throw new ModelError(`a sink bank is never visited when the sink ends in ${end}`);
        // Each step's site; an omitted `at` is the nearest to the previous step's site (the gather's for the first). A
        // family with no site kinds stops at its tile; what follows one names its own tile, as no nearest is known
        // from a bare tile.
        let last: Site | undefined = site;
        const nearest = (kinds: readonly FeatureKind[]): Site => {
            if (!last) throw new ModelError(`nothing is nearest a bare tile step: give the ${kinds.join('/')} tile`);
            return nearestOf(ctx.world, last, kinds);
        };
        const steps = def.sink.steps.map((step): Stop => {
            const { kinds, walks } = familyOf(ctx, step.family);
            // Only the gather family's walks are priced (below) and passed to its model.
            if (walks) throw new ModelError(`the process step family ${step.family} has walks: not modelled`);
            if (step.at === 'here') return 'here';
            if (!kinds.length) {
                if (!step.at)
                    throw new ModelError(
                        `the process step family ${step.family} has no site kinds: give its tile or 'here'`,
                    );
                last = undefined;
                return tileStop(step.at, ctx.zones);
            }
            last = step.at ? siteAt(ctx.world, kinds, step.at) : nearest(kinds);
            return last;
        });
        const bank =
            end !== 'bank' || withdraw ? undefined : tile ? siteAt(ctx.world, ['bank'], tile) : nearest(['bank']);
        sink = { mode: 'process', steps, ...(bank ? { bank } : {}) };
    }
    const stops = sinkStops(sink);
    for (const s of sinkSites(sink))
        if (!s.stand || !s.reach.length) throw new ModelError(`sink site ${s.id} has no stand a walk reaches`);
    // Every set that gets to all the method's sites: one reach set of each, joined, the minimal ones kept. A tile stop
    // adds none of its own: a way that can't walk to it is dropped below.
    const joined = [site, ...sinkSites(sink)].reduce<string[][]>(
        (acc, s) => acc.flatMap(a => s.reach.map(r => canonicalSet([...a, ...r], ctx.quests))),
        [[]],
    );
    // site -> each stop -> site, a stop the same as the one before it (two steps at one anvil) walked to once.
    const tour = [site, ...stops, site].filter((s, i, all) => i === 0 || stopId(s) !== stopId(all[i - 1]!));
    const pairs = family?.walks?.(site, def.params, ctx.world);
    const ways: MethodWay[] = [];
    // The legs no set walks, to name in the error when none does.
    const unwalked = new Set<string>();
    for (const reach of minimalSets(joined, ctx.quests)) {
        const legs: Leg[] = [];
        const priced = tourLegs(legFinder, tour.map(standOf), reach);
        for (let i = 0; i < priced.length; i++) {
            const [a, b, way] = [tour[i]!, tour[i + 1]!, priced[i]];
            if (!way) {
                unwalked.add(`${stopId(a)} to ${stopId(b)}`);
                break;
            }
            legs.push({ from: stopId(a), to: stopId(b), runTicks: way.runTicks, requires: way.requires });
        }
        if (legs.length !== tour.length - 1) continue;
        if (!pairs) {
            ways.push({ reach, legs });
            continue;
        }
        // The family picks among its pairs (Family.walks), so one no walk joins is kept as null, not a dropped way.
        ways.push({
            reach,
            legs,
            walks: pairWalks(legFinder.finder, pairs, reach),
        });
    }
    if (!ways.length)
        throw new ModelError(
            `no requirement set gets to every site and walks each leg${unwalked.size ? ` (no walk from ${[...unwalked].join(', or ')})` : ''}`,
        );
    const travel = (w: MethodWay) => w.legs.reduce((t, l) => t + l.runTicks, 0);
    ways.sort(
        (a, b) => travel(a) - travel(b) || a.reach.length - b.reach.length || cmp(a.reach.join(), b.reach.join()),
    );
    return { site, sink, ways };
}

/** The process step's params as a list: one entry, or each of a list. */
const paramList = (params: unknown): unknown[] => (Array.isArray(params) ? params : [params]);

/**
 * The gather (or withdrawn obj) and each process step's models of a located method at `profile`, the gather's walks
 * from `way`; throws a ModelError when a family can't. With no `way`, the first of the method's ways (in their order)
 * whose gather models, the first's error when none does: a family that picks among walk pairs (Family.walks) may close
 * a lap over one way's walks and not another's. A step `'here'` or at a bare tile is modelled at the previous step's
 * site.
 */
export function methodModels(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink' | 'ways'>,
    profile: Profile,
    ctx: MethodContext,
    way?: MethodWay,
): { gather: ActionModel | Withdraw; steps: ActionModel[][]; way: MethodWay | undefined } {
    const { world } = ctx;
    const gatherOver = (w: MethodWay | undefined): ActionModel | Withdraw =>
        m.def.family === WITHDRAW
            ? { withdraw: withdrawObj(m.def) }
            : familyOf(ctx, m.def.family).model(m.site, m.def.params, profile, world, w?.walks);
    let chosen = way ?? m.ways[0];
    let gather: ActionModel | Withdraw | undefined;
    if (way || !m.ways.some(w => w.walks)) gather = gatherOver(chosen);
    else {
        let first: unknown;
        for (const w of m.ways) {
            try {
                gather = gatherOver(w);
                chosen = w;
                break;
            } catch (e) {
                if (!(e instanceof ModelError)) throw e;
                first ??= e;
            }
        }
        if (!gather) throw first;
    }
    if (m.sink.mode !== 'process' || m.def.sink.mode !== 'process') return { gather, steps: [], way: chosen };
    let last = m.site;
    const stops = m.sink.steps;
    const steps = m.def.sink.steps.map((step, i) => {
        const stop = stops[i];
        if (stop === undefined) throw new ModelError(`no site for process step ${i + 1}`);
        // A tile stop's family has no site kinds and reads no site: it is handed the last one.
        if (stop !== 'here' && !isTileStop(stop)) last = stop;
        const family = familyOf(ctx, step.family);
        return paramList(step.params).map(p => family.model(last, p, profile, world));
    });
    return { gather, steps, way: chosen };
}

/** Whether a method trains `skill`: its `levels` name it (the gather family's skills, then the process steps'). */
export const trains = (m: Pick<ResolvedMethod, 'levels'>, skill: Skill): boolean => m.levels[skill] !== undefined;

/**
 * `f()`, naming the method in what it throws: rating a resolved method at a profile the build never rated (a page's
 * level column, a query's profile) can fail in a family or in rate.ts, and the error says which record.
 */
export function forMethod<T>(m: Pick<ResolvedMethod, 'def'>, f: () => T): T {
    try {
        return f();
    } catch (e) {
        if (e instanceof MethodError || !(e instanceof Error)) throw e;
        throw new MethodError(m.def.id, e.message);
    }
}

/** A measured figure's XP/hr of one skill, beside the floor's XP/hr of it at the figure's profile. */
export interface MeasuredFigure {
    measured: Measured;
    xpPerHour: number;
    /** The floor at measuredProfile (the figure's levels and tool), over measuredFigures' way; 0 when it gives none. */
    floor: number;
}

/**
 * The method's measured figures that have an XP/hr for `skill`, in the record's order, each with its floor over its
 * `way`th way (by default methodRate's): the way the figure is set beside.
 */
export function measuredFigures(m: ResolvedMethod, skill: Skill, ctx: MethodContext, way?: number): MeasuredFigure[] {
    return (m.def.measured ?? []).flatMap(measured => {
        const xpPerHour = measured.xpPerHour[skill];
        if (xpPerHour === undefined) return [];
        const floor = methodRate(m, measuredProfile(m, measured, ctx.tools), ctx, way).xpPerHour[skill] ?? 0;
        return [{ measured, xpPerHour, floor }];
    });
}

/**
 * The floor of a resolved method at `profile`, over its `way`th way; by default the first, in order (the shortest),
 * whose gather models (methodModels).
 */
export function methodRate(m: ResolvedMethod, profile: Profile, ctx: MethodContext, way?: number): CycleRates {
    if (way === undefined) return rate(m, profile, ctx);
    const chosen = m.ways[way];
    if (!chosen) throw new MethodError(m.def.id, `no way ${way} (${m.ways.length} ways)`);
    return rate(m, profile, ctx, chosen);
}

function rate(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink' | 'ways'>,
    profile: Profile,
    ctx: MethodContext,
    over?: MethodWay,
): CycleRates {
    const { gather, steps, way } = methodModels(m, profile, ctx, over);
    if (!way) throw new ModelError('it has no way to walk');
    const legs = way.legs.map(l => l.runTicks);
    const sink: CycleSink =
        m.def.sink.mode === 'process' && m.sink.mode === 'process'
            ? { mode: 'process', steps, end: m.def.sink.end, legs, here: m.sink.steps.map(s => s === 'here') }
            : m.def.sink.mode === 'bank'
              ? { mode: 'bank', legs }
              : { mode: 'drop' };
    let food: { obj: string; heal: number } | undefined;
    if (m.def.food !== undefined) {
        const heal = ctx.foods.get(m.def.food);
        if (heal === undefined) throw new ModelError(`${m.def.food} is not a food with a fixed heal`);
        food = { obj: m.def.food, heal };
    }
    return cycle({ gather, sink, items: ctx.items, food });
}

/**
 * Resolves a record: its `at` in a site of its family's kind, explicit sink tiles in a bank or processor site, a
 * requirement set that walks every leg, and a level (1-99) at which every family models it, every skill at that level
 * with the best tools usable there. Throws a MethodError naming the record and the reason.
 */
export function resolveMethod(def: MethodDef, ctx: MethodContext, finder: LegFinder): ResolvedMethod {
    try {
        if (!KEBAB.test(def.id)) throw new ModelError('the id is not kebab-case');
        const located = locate(def, ctx, finder);
        const skills = methodSkills(def, ctx);
        const skill = skills[0];
        if (skill === undefined) throw new ModelError('it trains no skill');
        // A process step whose input neither the gather nor an earlier step gives (a misnamed food) would do nothing
        // at every level. A step's input is its first consumes; the others are supplies.
        const top = methodModels({ def, ...located }, profileAt(skill, 99, { tools: ctx.tools }), ctx);
        const given = new Set('withdraw' in top.gather ? [top.gather.withdraw] : top.gather.products.map(x => x.obj));
        for (const step of top.steps) {
            for (const m of step) {
                const input = m.consumes[0]?.obj;
                if (input !== undefined && !given.has(input))
                    throw new ModelError(
                        `a process step takes ${input}, which neither the gather nor an earlier step gives at 99`,
                    );
            }
            for (const x of step.flatMap(m => m.products)) given.add(x.obj);
        }
        // The lowest level of `skill` at which it models, the skills of `atLeast` raised to theirs; with the reason the
        // last level failed when none does.
        const lowest = (s: Skill, atLeast: Partial<Record<Skill, number>>): { level?: number; reason: string } => {
            let reason = '';
            for (let level = 1; level <= 99; level++) {
                try {
                    rate({ def, ...located }, profileAt(s, level, { tools: ctx.tools, atLeast }), ctx);
                    return { level, reason };
                } catch (e) {
                    if (!(e instanceof ModelError)) throw e;
                    reason = e.message;
                }
            }
            return { reason };
        };
        const all = lowest(skill, {});
        if (all.level === undefined) throw new ModelError(`no level models it (at 99: ${all.reason})`);
        // A level no way's reach lets in (a course behind a skill gate) is no level of the method either.
        const reaches = located.ways.map(w => w.reach);
        const minLevel = Math.max(
            all.level,
            Math.min(...reaches.map(r => Math.max(...SKILLS.map(s => lowestLevel([r], s))))),
        );
        const levels: Partial<Record<Skill, number>> = {};
        for (const s of skills) {
            // It models at minLevel with every skill there, so with the others at 99 some level of `s` does too.
            const own = lowest(s, Object.fromEntries(skills.filter(o => o !== s).map(o => [o, 99])));
            if (own.level === undefined)
                throw new ModelError(`no ${s} level models it with the others at 99 (${own.reason})`);
            levels[s] = Math.max(own.level, lowestLevel(reaches, s));
        }
        return { def, ...located, skill, minLevel, levels };
    } catch (e) {
        if (e instanceof MethodError) throw e;
        // Any other error (rate.ts rejecting a bad model, say) is the record's failure too: name it.
        if (e instanceof Error) throw new MethodError(def.id, e.message);
        throw e;
    }
}

/** The skills a record trains: its family's (none for a withdrawal), then its process steps', each once. */
function methodSkills(def: MethodDef, ctx: MethodContext): Skill[] {
    const steps = def.sink.mode === 'process' ? def.sink.steps.map(s => s.family) : [];
    const families = [...(def.family === WITHDRAW ? [] : [def.family]), ...steps];
    return [...new Set(families.flatMap(f => familyOf(ctx, f).skills))];
}

/**
 * The profile a measured figure was taken at: each skill the figure names at exactly its measured level (one below
 * the method's skill stays below it), every other skill at the method's skill's level, the axe or pickaxe the runs
 * used in place of the best one usable at those levels, and the objs the runs wore. Throws when the figure has no level for the method's
 * skill or names a tool that is neither.
 */
export function measuredProfile(m: Pick<ResolvedMethod, 'def' | 'skill'>, measured: Measured, tools: Tools): Profile {
    const level = measured.level[m.skill];
    if (level === undefined)
        throw new MethodError(m.def.id, `a measured figure (${measured.bot} ${measured.date}) has no ${m.skill} level`);
    const levels = Object.fromEntries(SKILLS.map(s => [s, measured.level[s] ?? level])) as Record<Skill, number>;
    const profile = profileOf(levels, { tools, ...(measured.worn ? { worn: measured.worn } : {}) });
    if (measured.tool !== undefined) {
        const kind = toolKindOfObj(tools, measured.tool);
        if (kind === null) throw new MethodError(m.def.id, `measured tool ${measured.tool} is no axe or pickaxe`);
        profile[kind] = measured.tool;
    }
    return profile;
}

/** A resolved method as world.json holds it: the record, then what the build resolved (WorldMethod). */
export function toWorldMethod(m: ResolvedMethod): WorldMethod {
    return {
        ...m.def,
        site: m.site.id,
        stand: m.site.stand!,
        ...(m.sink.mode !== 'drop' && m.sink.bank ? { bank: m.sink.bank.id } : {}),
        ...(m.sink.mode === 'process'
            ? { processors: m.sink.steps.map(s => (s === 'here' ? 'here' : stopId(s))) }
            : {}),
        skill: m.skill,
        minLevel: m.minLevel,
        levels: m.levels,
        ways: m.ways,
    };
}

/** What fromWorldMethod's errors end with: the fix. */
const STALE = '; world.json is stale or hand-edited: run `bun run world`';

/**
 * A world.json method back as a ResolvedMethod over `world`'s sites, for the model to rate; a bare tile stop's hazard
 * from `zones` (read from the maps when not given and a tile stop needs them). Throws when it names a site world.json
 * has not, or one whose stand has moved: the file is not one build.ts wrote.
 */
export function fromWorldMethod(wm: WorldMethod, world: Pick<World, 'sites'>, zones?: Zones): ResolvedMethod {
    const { site, stand, bank, processors, skill, minLevel, levels, ways, ...def } = wm;
    const byId = (id: string | undefined, what: string): Site => {
        const s = id === undefined ? undefined : world.sites.find(x => x.id === id);
        if (!s)
            throw new MethodError(wm.id, `world.json names no ${what} site${id === undefined ? '' : ` ${id}`}${STALE}`);
        return s;
    };
    const at = byId(site, 'method');
    if (!at.stand || at.stand.x !== stand.x || at.stand.z !== stand.z || at.stand.level !== stand.level)
        throw new MethodError(wm.id, `site ${site}'s stand is not the method's ${coord(stand)}${STALE}`);
    let sink: ResolvedMethod['sink'];
    if (def.sink.mode === 'drop') sink = { mode: 'drop' };
    else if (def.sink.mode === 'bank') sink = { mode: 'bank', bank: byId(bank, 'bank') };
    else {
        if (processors?.length !== def.sink.steps.length)
            throw new MethodError(wm.id, `world.json names no site for each process step${STALE}`);
        const steps = processors.map((id, i): Stop => {
            if (id === 'here') return 'here';
            if (!id.startsWith('tile:')) return byId(id, 'process step');
            // A tile stop is the record's own tile.
            const tile = (def.sink.mode === 'process' ? def.sink.steps[i]?.at : undefined) ?? 'here';
            if (tile === 'here' || tileStopId(tile) !== id)
                throw new MethodError(wm.id, `world.json's process step ${id} is not the record's tile${STALE}`);
            return tileStop(tile, (zones ??= readZones()));
        });
        // A process sink that banks names its bank, but a withdrawal's, which is its site.
        const banks = def.sink.end === 'bank' && def.family !== WITHDRAW;
        sink = { mode: 'process', steps, ...(banks ? { bank: byId(bank, 'bank') } : {}) };
    }
    return { def, site: at, sink, ways, skill, minLevel, levels };
}

/** Every record resolved, and the failures as MethodError messages; two records with one id fail both. */
export function resolveMethods(
    defs: readonly MethodDef[],
    ctx: MethodContext,
    finder: LegFinder,
): { methods: ResolvedMethod[]; errors: string[] } {
    const methods: ResolvedMethod[] = [];
    const errors: string[] = [];
    const seen = new Map<string, number>();
    for (const d of defs) seen.set(d.id, (seen.get(d.id) ?? 0) + 1);
    for (const def of defs) {
        if (seen.get(def.id)! > 1) {
            errors.push(new MethodError(def.id, 'the id is used by more than one record').message);
            continue;
        }
        try {
            methods.push(resolveMethod(def, ctx, finder));
        } catch (e) {
            if (!(e instanceof MethodError)) throw e;
            errors.push(e.message);
        }
    }
    return { methods, errors };
}
