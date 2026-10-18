// A curated method (methods.ts) resolved against the world: its site, its sink sites, the legs of its cycle in run
// ticks under each requirement set that gets to all of them, and the lowest level its families can model it at;
// then its floor at a profile (cycle.ts).
import type { MethodDef } from '../methods';
import { SINKS, type wayFinder } from '../distance';
import { canonicalSet, minimalSets, type QuestFacts } from '../requirements';
import { SINK_KINDS, type FeatureKind, type SinkKind, type Site, type Tile, type World } from '../types';
import { cmp } from '../util';
import { cycle, type CycleRates, type CycleSink } from './cycle';
import { ModelError, type ActionModel, type Family } from './family';
import type { Items } from './items';
import { profileAt, type Profile, type Tools } from './profile';
import type { Skill } from './server';

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
    /** The lowest level of `skill` (every other skill at it too) at which the families model the method. */
    minLevel: number;
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

/** The site `nearest` names for the first sink kind of `kinds` the site's kind sinks to, or a ModelError. */
function nearestOf(world: MethodContext['world'], from: Site, kinds: readonly FeatureKind[]): Site {
    const kind = kinds.find((k): k is SinkKind => (SINK_KINDS as readonly string[]).includes(k));
    const id = kind && SINKS[from.kind]?.includes(kind) ? from.nearest?.[kind]?.site : undefined;
    const site = id === undefined ? undefined : world.sites.find(s => s.id === id);
    if (!site) throw new ModelError(`site ${from.id} has no nearest ${kinds.join('/')}: give its tile`);
    return site;
}

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
    const stops = sink.mode === 'drop' ? [] : sink.mode === 'bank' ? [sink.bank] : [sink.processor, sink.bank];
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
function models(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink'>,
    profile: Profile,
    ctx: MethodContext,
): { gather: ActionModel; process: ActionModel[] } {
    const world = ctx.world as World;
    const gather = familyOf(ctx, m.def.family).model(m.site, m.def.params, profile, world);
    if (m.sink.mode !== 'process-bank' || m.def.sink.mode !== 'process-bank') return { gather, process: [] };
    const step = m.def.sink.process;
    const family = familyOf(ctx, step.family);
    const processor = m.sink.processor;
    return { gather, process: paramList(step.params).map(p => family.model(processor, p, profile, world)) };
}

/** The floor of a resolved method at `profile`, over its `way`th way (the shortest by default). */
export function methodRate(m: ResolvedMethod, profile: Profile, ctx: MethodContext, way = 0): CycleRates {
    return rate(m, profile, ctx, m.ways[way]!);
}

function rate(
    m: Pick<ResolvedMethod, 'def' | 'site' | 'sink'>,
    profile: Profile,
    ctx: MethodContext,
    way: MethodWay,
): CycleRates {
    const { gather, process } = models(m, profile, ctx);
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
        const top = models({ def, ...located }, profileAt(skill, 99, { tools: ctx.tools }), ctx);
        for (const step of top.process)
            for (const c of step.consumes)
                if (!top.gather.products.some(x => x.obj === c.obj))
                    throw new ModelError(`a process step takes ${c.obj}, which the gather does not give at 99`);
        let reason = '';
        for (let level = 1; level <= 99; level++) {
            try {
                rate({ def, ...located }, profileAt(skill, level, { tools: ctx.tools }), ctx, located.ways[0]!);
                return { def, ...located, skill, minLevel: level };
            } catch (e) {
                if (!(e instanceof ModelError)) throw e;
                reason = e.message;
            }
        }
        throw new ModelError(`no level models it (at 99: ${reason})`);
    } catch (e) {
        if (e instanceof ModelError) throw new MethodError(def.id, e.message);
        throw e;
    }
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
