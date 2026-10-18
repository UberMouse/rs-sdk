// A curated method (methods.ts) resolved against the world: its site, its sink sites, the legs of its cycle in run
// ticks under each requirement set that gets to all of them, and the lowest level its families can model it at;
// then its floor at a profile (cycle.ts).
import type { Measured, MethodDef } from '../methods';
import { SINKS, type wayFinder } from '../distance';
import { canonicalSet, minimalSets, type QuestFacts } from '../requirements';
import {
    SINK_KINDS,
    type FeatureKind,
    type SinkKind,
    type Site,
    type Tile,
    type World,
    type WorldMethod,
} from '../types';
import { cmp } from '../util';
import { cycle, type CycleRates, type CycleSink } from './cycle';
import { ModelError, type ActionModel, type Family } from './family';
import { buildFamilies, type GameData } from './families/index';
import { readFoods, readItems, type Items } from './items';
import { profileAt, profileOf, readTools, type Profile, type Tools } from './profile';
import { SKILLS, type Skill } from './server';

/** A method record the build can't resolve: the message names the record and the reason. */
export class MethodError extends Error {
    constructor(id: string, reason: string) {
        super(`methods.ts ${id}: ${reason}`);
    }
}

/** One walk of the cycle: between two sites' stands, in run ticks, and the requirement set its crossings take. */
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
}

export interface ResolvedMethod {
    def: MethodDef;
    site: Site;
    sink: { mode: 'drop' } | { mode: 'bank'; bank: Site } | { mode: 'process-bank'; processor: Site; bank: Site };
    /** One per minimal set that reaches the method's sites and walks its legs; shortest travel first. */
    ways: MethodWay[];
    /** The family's first skill, which a level column trains. */
    skill: Skill;
    /**
     * The lowest level of `skill` (every other skill at it too) at which the families model the method. The floor
     * assumes tools are wielded and does not check their wield level (a rune pickaxe needs Attack 40).
     */
    minLevel: number;
    /**
     * Each skill the method trains (the gather family's, then the process step's), and the lowest level of it at which
     * the families model the method with the other skills of the method at 99: what each skill itself needs (fly
     * fishing and cooking trout and salmon: Fishing 20, Cooking 25, where `minLevel`, every skill at once, is 25).
     */
    levels: Partial<Record<Skill, number>>;
}

/** What resolving and modelling a method reads. */
export interface MethodContext {
    world: Pick<World, 'sites' | 'features'>;
    families: ReadonlyMap<string, Family>;
    items: Items;
    /** Hitpoints each food heals (items.ts readFoods). */
    foods: ReadonlyMap<string, number>;
    tools: Tools;
    quests?: QuestFacts;
}

/** What the model reads besides the world and the quests: the families, items, foods and tool tiers. */
export type MethodModel = Omit<MethodContext, 'world' | 'quests'>;

/** The model from the game data; build.ts builds it once, for resolving the methods and for the training pages. */
export const methodModel = (data: GameData): MethodModel => ({
    families: buildFamilies(data),
    items: readItems(data.objs),
    foods: readFoods(data.dbrows),
    tools: readTools(data.objs),
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
 * The site `nearest` names for the first sink kind of `kinds` (a cooking family's ['range', 'fire'] searches ranges
 * only: phase 3 models ranges, not fires) the site's kind sinks to, or a ModelError.
 */
function nearestOf(world: MethodContext['world'], from: Site, kinds: readonly FeatureKind[]): Site {
    const kind = kinds.find((k): k is SinkKind => (SINK_KINDS as readonly string[]).includes(k));
    const id = kind && SINKS[from.kind]?.includes(kind) ? from.nearest?.[kind]?.site : undefined;
    const site = id === undefined ? undefined : world.sites.find(s => s.id === id);
    if (!site)
        throw new ModelError(
            `site ${from.id} has no nearest ${kind ?? kinds.join('/')} (phase 3 searches only the first of ${kinds.join('/')}): give its tile`,
        );
    return site;
}

/** The sites a sink stops at, in the order the cycle visits them: none, the bank, or the processor then the bank. */
export const sinkSites = (sink: ResolvedMethod['sink']): Site[] =>
    sink.mode === 'drop' ? [] : sink.mode === 'bank' ? [sink.bank] : [sink.processor, sink.bank];

/** The method's sites and its legs under each requirement set, before the levels are checked. */
function locate(
    def: MethodDef,
    ctx: MethodContext,
    finder: ReturnType<typeof wayFinder>,
): Pick<ResolvedMethod, 'site' | 'sink' | 'ways'> {
    const family = familyOf(ctx, def.family);
    const site = siteAt(ctx.world, family.kinds, def.at);
    if (!site.stand || !site.reach.length) throw new ModelError(`site ${site.id} has no stand a walk reaches`);
    let sink: ResolvedMethod['sink'];
    if (def.sink.mode === 'drop') sink = { mode: 'drop' };
    else if (def.sink.mode === 'bank')
        sink = {
            mode: 'bank',
            bank: def.sink.bank ? siteAt(ctx.world, ['bank'], def.sink.bank) : nearestOf(ctx.world, site, ['bank']),
        };
    else {
        const step = def.sink.process;
        const kinds = familyOf(ctx, step.family).kinds;
        const processor = step.at ? siteAt(ctx.world, kinds, step.at) : nearestOf(ctx.world, site, kinds);
        const bank = def.sink.bank
            ? siteAt(ctx.world, ['bank'], def.sink.bank)
            : nearestOf(ctx.world, processor, ['bank']);
        sink = { mode: 'process-bank', processor, bank };
    }
    const stops = sinkSites(sink);
    for (const s of stops)
        if (!s.stand || !s.reach.length) throw new ModelError(`sink site ${s.id} has no stand a walk reaches`);
    // Every set that gets to all the method's sites: one reach set of each, joined, the minimal ones kept.
    const joined = [site, ...stops].reduce<string[][]>(
        (acc, s) => acc.flatMap(a => s.reach.map(r => canonicalSet([...a, ...r], ctx.quests))),
        [[]],
    );
    const tour = stops.length ? [site, ...stops, site] : [];
    const ways: MethodWay[] = [];
    for (const reach of minimalSets(joined, ctx.quests)) {
        const legs: Leg[] = [];
        for (let i = 0; i + 1 < tour.length; i++) {
            const [a, b] = [tour[i]!, tour[i + 1]!];
            const way = finder.runTicksBetween(a.stand!, b.stand!, reach);
            if (!way) break;
            legs.push({ from: a.id, to: b.id, ...way });
        }
        if (legs.length === Math.max(tour.length - 1, 0)) ways.push({ reach, legs });
    }
    if (!ways.length) throw new ModelError(`no requirement set gets to every site and walks each leg`);
    const travel = (w: MethodWay) => w.legs.reduce((t, l) => t + l.runTicks, 0);
    ways.sort(
        (a, b) => travel(a) - travel(b) || a.reach.length - b.reach.length || cmp(a.reach.join(), b.reach.join()),
    );
    return { site, sink, ways };
}

/** The process step's params as a list: one entry, or each of a list. */
const paramList = (params: unknown): unknown[] => (Array.isArray(params) ? params : [params]);

/** The gather and process models of a located method at `profile`; throws a ModelError when a family can't. */
export function methodModels(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink'>,
    profile: Profile,
    ctx: MethodContext,
): { gather: ActionModel; process: ActionModel[] } {
    const { world } = ctx;
    const gather = familyOf(ctx, m.def.family).model(m.site, m.def.params, profile, world);
    if (m.sink.mode !== 'process-bank' || m.def.sink.mode !== 'process-bank') return { gather, process: [] };
    const step = m.def.sink.process;
    const family = familyOf(ctx, step.family);
    const processor = m.sink.processor;
    return { gather, process: paramList(step.params).map(p => family.model(processor, p, profile, world)) };
}

/** Whether a method trains `skill`: its `levels` name it (the gather family's skills, then the process step's). */
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
 * `way`th way (the shortest by default): the way the figure is set beside.
 */
export function measuredFigures(m: ResolvedMethod, skill: Skill, ctx: MethodContext, way = 0): MeasuredFigure[] {
    return (m.def.measured ?? []).flatMap(measured => {
        const xpPerHour = measured.xpPerHour[skill];
        if (xpPerHour === undefined) return [];
        const floor = methodRate(m, measuredProfile(m, measured, ctx.tools), ctx, way).xpPerHour[skill] ?? 0;
        return [{ measured, xpPerHour, floor }];
    });
}

/** The floor of a resolved method at `profile`, over its `way`th way (the shortest by default). */
export function methodRate(m: ResolvedMethod, profile: Profile, ctx: MethodContext, way = 0): CycleRates {
    const chosen = m.ways[way];
    if (!chosen) throw new MethodError(m.def.id, `no way ${way} (${m.ways.length} ways)`);
    return rate(m, profile, ctx, chosen);
}

function rate(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink'>,
    profile: Profile,
    ctx: MethodContext,
    way: MethodWay,
): CycleRates {
    const { gather, process } = methodModels(m, profile, ctx);
    const legs = way.legs.map(l => l.runTicks);
    const sink: CycleSink =
        m.sink.mode === 'drop'
            ? { mode: 'drop' }
            : m.sink.mode === 'bank'
              ? { mode: 'bank', legs }
              : { mode: 'process-bank', process, legs };
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
export function resolveMethod(
    def: MethodDef,
    ctx: MethodContext,
    finder: ReturnType<typeof wayFinder>,
): ResolvedMethod {
    try {
        if (!KEBAB.test(def.id)) throw new ModelError('the id is not kebab-case');
        const located = locate(def, ctx, finder);
        const skill = familyOf(ctx, def.family).skills[0]!;
        // A process step whose input the gather never gives (a misnamed food) would do nothing at every level.
        const top = methodModels({ def, ...located }, profileAt(skill, 99, { tools: ctx.tools }), ctx);
        for (const step of top.process)
            for (const c of step.consumes)
                if (!top.gather.products.some(x => x.obj === c.obj))
                    throw new ModelError(`a process step takes ${c.obj}, which the gather does not give at 99`);
        // The lowest level of `skill` at which it models, the skills of `atLeast` raised to theirs; with the reason the
        // last level failed when none does.
        const lowest = (s: Skill, atLeast: Partial<Record<Skill, number>>): { level?: number; reason: string } => {
            let reason = '';
            for (let level = 1; level <= 99; level++) {
                try {
                    rate(
                        { def, ...located },
                        profileAt(s, level, { tools: ctx.tools, atLeast }),
                        ctx,
                        located.ways[0]!,
                    );
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
        const skills = [...new Set([skill, ...methodSkills(def, ctx)])];
        const levels: Partial<Record<Skill, number>> = {};
        for (const s of skills) {
            // It models at minLevel with every skill there, so with the others at 99 some level of `s` does too.
            const own = lowest(s, Object.fromEntries(skills.filter(o => o !== s).map(o => [o, 99])));
            if (own.level === undefined)
                throw new ModelError(`no ${s} level models it with the others at 99 (${own.reason})`);
            levels[s] = own.level;
        }
        return { def, ...located, skill, minLevel: all.level, levels };
    } catch (e) {
        if (e instanceof MethodError) throw e;
        // Any other error (rate.ts rejecting a bad model, say) is the record's failure too: name it.
        if (e instanceof Error) throw new MethodError(def.id, e.message);
        throw e;
    }
}

/** The skills a record trains: its family's, then its process step's, each once. */
function methodSkills(def: MethodDef, ctx: MethodContext): Skill[] {
    const step = def.sink.mode === 'process-bank' ? [def.sink.process.family] : [];
    return [...new Set([def.family, ...step].flatMap(f => familyOf(ctx, f).skills))];
}

/**
 * The profile a measured figure was taken at: each skill the figure names at exactly its measured level (one below
 * the method's skill stays below it), every other skill at the method's skill's level, and the axe or pickaxe the
 * runs used in place of the best one usable at those levels. Throws when the figure has no level for the method's
 * skill or names a tool that is neither.
 */
export function measuredProfile(m: Pick<ResolvedMethod, 'def' | 'skill'>, measured: Measured, tools: Tools): Profile {
    const level = measured.level[m.skill];
    if (level === undefined)
        throw new MethodError(m.def.id, `a measured figure (${measured.bot} ${measured.date}) has no ${m.skill} level`);
    const levels = Object.fromEntries(SKILLS.map(s => [s, measured.level[s] ?? level])) as Record<Skill, number>;
    const profile = profileOf(levels, { tools });
    if (measured.tool?.endsWith('_pickaxe')) profile.pickaxe = measured.tool;
    else if (measured.tool?.endsWith('_axe')) profile.axe = measured.tool;
    else if (measured.tool) throw new MethodError(m.def.id, `measured tool ${measured.tool} is no axe or pickaxe`);
    return profile;
}

/** A resolved method as world.json holds it: the record, then what the build resolved (WorldMethod). */
export function toWorldMethod(m: ResolvedMethod): WorldMethod {
    return {
        ...m.def,
        site: m.site.id,
        stand: m.site.stand!,
        ...(m.sink.mode === 'drop' ? {} : { bank: m.sink.bank.id }),
        ...(m.sink.mode === 'process-bank' ? { processor: m.sink.processor.id } : {}),
        skill: m.skill,
        minLevel: m.minLevel,
        levels: m.levels,
        ways: m.ways,
    };
}

/** What fromWorldMethod's errors end with: the fix. */
const STALE = '; world.json is stale or hand-edited: run `bun run world`';

/**
 * A world.json method back as a ResolvedMethod over `world`'s sites, for the model to rate. Throws when it names a
 * site world.json has not, or one whose stand has moved: the file is not one build.ts wrote.
 */
export function fromWorldMethod(wm: WorldMethod, world: Pick<World, 'sites'>): ResolvedMethod {
    const { site, stand, bank, processor, skill, minLevel, levels, ways, ...def } = wm;
    const byId = (id: string | undefined, what: string): Site => {
        const s = id === undefined ? undefined : world.sites.find(x => x.id === id);
        if (!s)
            throw new MethodError(wm.id, `world.json names no ${what} site${id === undefined ? '' : ` ${id}`}${STALE}`);
        return s;
    };
    const at = byId(site, 'method');
    if (!at.stand || at.stand.x !== stand.x || at.stand.z !== stand.z || at.stand.level !== stand.level)
        throw new MethodError(wm.id, `site ${site}'s stand is not the method's ${coord(stand)}${STALE}`);
    const sink: ResolvedMethod['sink'] =
        def.sink.mode === 'drop'
            ? { mode: 'drop' }
            : def.sink.mode === 'bank'
              ? { mode: 'bank', bank: byId(bank, 'bank') }
              : { mode: 'process-bank', processor: byId(processor, 'processor'), bank: byId(bank, 'bank') };
    return { def, site: at, sink, ways, skill, minLevel, levels };
}

/** Every record resolved, and the failures as MethodError messages; two records with one id fail both. */
export function resolveMethods(
    defs: readonly MethodDef[],
    ctx: MethodContext,
    finder: ReturnType<typeof wayFinder>,
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
