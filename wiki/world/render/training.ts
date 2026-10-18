// wiki/training/<skill>.md: the curated methods (wiki/world/methods.ts, world.json `methods`) that train a skill, each
// with its floor XP/hr by level, which the model (model/cycle.ts) computes here from the resolved record, so a model
// fix shows in the pages without a world.json change; beside it what the bots measured. wiki/training/README.md lists
// the pages and says what the columns mean and how to add a method.
import {
    fromWorldMethod,
    measuredProfile,
    MethodError,
    methodModels,
    methodRate,
    type MethodContext,
    type MethodModel,
    type ResolvedMethod,
} from '../model/method';
import { profileAt, type Profile } from '../model/profile';
import { SKILLS, XP_RATE, type Skill } from '../model/server';
import { first } from '../sources/configs';
import type { Site, World } from '../types';
import { cmp } from '../util';
import { areaCell, areasOf, count, GENERATED, link, reachLabel, table, type Page, type PageData } from './common';

export interface TrainingData extends PageData {
    /** The model buildWorld resolved the methods with. */
    model: MethodModel;
}

export const TRAINING_DIR = 'wiki/training';
export const TRAINING_README = `${TRAINING_DIR}/README.md`;
export const trainingPath = (skill: Skill): string => `${TRAINING_DIR}/${skill}.md`;

/** The level columns after a method's minimum. */
export const LEVEL_COLUMNS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 99] as const;

/** `Fishing`. */
const skillName = (s: Skill): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A rate to three significant figures: `1.08M`, `659k`, `85.4`; trailing zeros dropped (`2M`). */
export function compact(n: number): string {
    const r = Number(n.toPrecision(3));
    const abs = Math.abs(r);
    if (abs >= 1e6) return `${Number((r / 1e6).toPrecision(3))}M`;
    if (abs >= 1e3) return `${Number((r / 1e3).toPrecision(3))}k`;
    return String(r);
}

/** `measured / floor` as a whole percent; `-` when the floor is 0 (the model gives the skill no XP there). */
export const percent = (measured: number, floor: number): string =>
    floor > 0 ? `${Math.round((100 * measured) / floor)}%` : '-';

/**
 * The methods each skill page lists, by skill id: every method whose `levels` name the skill, by minimum level, then
 * id.
 */
function bySkill(methods: readonly ResolvedMethod[]): Map<Skill, ResolvedMethod[]> {
    const out = new Map<Skill, ResolvedMethod[]>();
    for (const skill of [...SKILLS].sort(cmp)) {
        const ms = methods
            .filter(m => m.levels[skill] !== undefined)
            .sort((a, b) => a.minLevel - b.minLevel || cmp(a.def.id, b.def.id));
        if (ms.length) out.set(skill, ms);
    }
    return out;
}

/** Every training page and the README, as repo-relative paths and text. */
export function renderTraining(world: World, data: TrainingData): Page[] {
    const ctx: MethodContext = { world, ...data.model };
    const methods = world.methods.map(wm => fromWorldMethod(wm, world));
    const pages = bySkill(methods);
    const out: Page[] = [...pages].map(([skill, ms]) => [trainingPath(skill), skillPage(skill, ms, world, data, ctx)]);
    out.push([TRAINING_README, readme(pages)]);
    return out;
}

/**
 * `f()`, naming the method in what it throws: a page rates combinations of levels the build never did (the page's
 * skill at a column, the others raised to their own levels), so a family can refuse one here first.
 */
function forMethod<T>(m: ResolvedMethod, f: () => T): T {
    try {
        return f();
    } catch (e) {
        if (e instanceof MethodError || !(e instanceof Error)) throw e;
        throw new MethodError(m.def.id, e.message);
    }
}

/** The tool tiers a page's columns pick the best of, by the obj that is one. */
type Tier = 'axe' | 'pickaxe';

function skillPage(
    skill: Skill,
    methods: readonly ResolvedMethod[],
    world: World,
    data: TrainingData,
    ctx: MethodContext,
): string {
    const path = trainingPath(skill);
    const areas = areasOf(world);
    const reach = reachLabel(world, data);
    const obj = (id: string): string => first(data.objConfigs.get(id), 'name') ?? id;
    const name = skillName(skill);
    // The page's skill at `level`, every other skill at that level raised to the method's own level of it.
    const column = (m: ResolvedMethod, level: number): Profile =>
        profileAt(skill, level, { tools: ctx.tools, atLeast: m.levels });
    const xp = (m: ResolvedMethod, profile: Profile): number => methodRate(m, profile, ctx).xpPerHour[skill] ?? 0;
    const where = (s: Site): string => `${areaCell(path, areas, s.areaPath)} \`${s.id}\``;
    const tier = (t: string): Tier | undefined =>
        ctx.tools.axe.some(x => x.obj === t) ? 'axe' : ctx.tools.pickaxe.some(x => x.obj === t) ? 'pickaxe' : undefined;

    // The tools the method carries at 99: a tier stands for the best of it usable at each column.
    const held = (m: ResolvedMethod): string[] => {
        const { gather, process } = methodModels(m, column(m, 99), ctx);
        return [...new Set([gather, ...process].flatMap(a => a.tools ?? []))];
    };
    const tools = (ts: readonly string[]): string =>
        ts
            .map(t => {
                const k = tier(t);
                return k === 'axe' ? 'best axe (wielded)' : k === 'pickaxe' ? 'best pickaxe usable (wielded)' : obj(t);
            })
            .join(', ') || 'none';
    const levels = (m: ResolvedMethod): string => {
        const own = (Object.entries(m.levels) as [Skill, number][]).map(([s, l]) => `${skillName(s)} ${l}`);
        return own.length === 1
            ? own[0]!
            : `${own.join(', ')}, each with the other skills at 99; every skill at once: ${m.minLevel}`;
    };
    const requires = (m: ResolvedMethod, ts: readonly string[]): string => {
        const r = reach({ reach: m.ways.map(w => w.reach), stand: m.site.stand });
        return [
            `Reach: ${r === '-' ? 'none' : r}.`,
            `Levels: ${levels(m)}.`,
            `Tools: ${tools(ts)}.`,
            ...(m.def.food ? [`Food: ${obj(m.def.food)}.`] : []),
        ].join(' ');
    };
    const sink = (m: ResolvedMethod): string => {
        if (m.sink.mode === 'drop') return 'drop';
        const legs = m.ways[0]!.legs.map(l => l.runTicks);
        const bank = `bank at ${where(m.sink.bank)}`;
        const stops =
            m.sink.mode === 'bank'
                ? bank
                : `${m.def.sink.mode === 'process-bank' ? m.def.sink.process.family : 'process'} at ${where(m.sink.processor)}, then ${bank}`;
        return `${stops}; legs ${legs.join(' + ')} run ticks`;
    };
    // Each measured figure with the page's skill in it: the table cell (XP/hr, level, it over its floor) and who ran it.
    const measured = (m: ResolvedMethod): { cell: string; by: string }[] =>
        (m.def.measured ?? []).flatMap(x => {
            const got = x.xpPerHour[skill];
            if (got === undefined) return [];
            const at = x.level[skill] === undefined ? '' : ` at ${x.level[skill]}`;
            const of = percent(got, xp(m, measuredProfile(m, x, ctx.tools)));
            const tool = x.tool ? `, with the ${obj(x.tool)}` : '';
            return [
                { cell: `${compact(got)}${at} (${of})`, by: `${compact(got)}${at} by ${x.bot} on ${x.date}${tool}` },
            ];
        });

    const rated = methods.map(m =>
        forMethod(m, () => {
            const own = m.levels[skill]!;
            const top = methodRate(m, column(m, 99), ctx);
            const ts = held(m);
            const ms = measured(m);
            const supplies = top.suppliesPerHour.map(x => `${compact(x.count)} ${obj(x.obj)}`);
            const plans = m.def.plans?.length ? ` Plans: ${m.def.plans.join(', ')}.` : '';
            return {
                tiers: ts.flatMap(t => tier(t) ?? []),
                row: [
                    `\`${m.def.id}\``,
                    where(m.site),
                    `${compact(xp(m, column(m, m.minLevel)))} at ${m.minLevel}`,
                    ...LEVEL_COLUMNS.map(l => (l < own ? '-' : compact(xp(m, column(m, l))))),
                    compact(top.gpPerHour),
                    top.binding,
                    ms.map(x => x.cell).join('; ') || '-',
                ],
                bullet: [
                    `- \`${m.def.id}\`: ${m.def.name}.${plans}${m.def.notes ? ` ${m.def.notes}` : ''}`,
                    `  - **Requires**: ${requires(m, ts)}`,
                    `  - **Sink**: ${sink(m)}.`,
                    `  - **Supplies/hr** at 99: ${supplies.length ? `${supplies.join(', ')}; ${compact(top.suppliesGpPerHour)} gp` : 'none'}.`,
                    ...(ms.length ? [`  - **Measured**: ${ms.map(x => x.by).join('; ')}.`] : []),
                ],
            };
        }),
    );
    const tiers = [...new Set(rated.flatMap(r => r.tiers))].sort(cmp);
    return [
        GENERATED,
        `# ${name}`,
        '',
        `${count(methods.length, 'method')} ${methods.length === 1 ? 'trains' : 'train'} ${name}, from wiki/world/methods.ts. Every XP/hr is the floor: the ` +
            `tick-perfect rate, not a forecast ([README](${link(path, TRAINING_README)}) says what each column means). ` +
            `XP/hr is game XP, the server's XP rate (x${XP_RATE}) included; gp/hr is the products kept at item value ` +
            '(obj `cost`); Supplies/hr is how many of each supply an hour uses, and their gp value.',
        '',
        `Min is the level the whole method needs, every skill of it at that level together; a level column has ${name} ` +
            `at that level and every other skill at it or at the method's own level of it, whichever is higher` +
            `${tiers.length ? `, with the best ${tiers.join(' and ')} usable there` : ''}, and \`-\` under the ` +
            `method's ${name} level. gp/hr, the binding term and Supplies/hr are at 99. Measured is a bot's XP/hr at the ` +
            'level its runs started at, and in brackets it over the floor there. Below the table, each method: what it ' +
            'requires, its sink, its supplies, and who measured it.',
        '',
        ...table(
            ['Method', 'Where', 'Min', ...LEVEL_COLUMNS.map(String), 'gp/hr', 'Binding', 'Measured'],
            rated.map(r => r.row),
        ),
        '',
        ...rated.flatMap(r => r.bullet),
        '',
    ].join('\n');
}

/** The link from the README to a repo path. */
const fromReadme = (p: string): string => link(TRAINING_README, p);

function readme(pages: ReadonlyMap<Skill, readonly ResolvedMethod[]>): string {
    const at = fromReadme;
    return [
        GENERATED,
        '# Training methods',
        '',
        `One page per skill a curated method trains: ${count(new Set([...pages.values()].flat()).size, 'method')} ` +
            `in [wiki/world/methods.ts](${at('wiki/world/methods.ts')}), resolved into world.json \`methods\` by ` +
            '`bun run world`. A method that trains two skills (fishing and cooking) has a row on both pages.',
        '',
        ...table(
            ['Skill', 'Methods'],
            [...pages].map(([skill, ms]) => [`[${skillName(skill)}](${at(trainingPath(skill))})`, String(ms.length)]),
        ),
        '',
        '## What the floor is',
        '',
        "The floor is the tick-perfect rate: the game's own formulas (wiki/world/model/) for ideal play, no tick " +
            'wasted, every leg run over the shortest way, banking at its minimum tick cost. It is not a forecast: what a ' +
            'bot measures sits at or below it, and the gap is the headroom a tick-perfect pass works on. A measured ' +
            'figure above its floor is a model bug, not a figure to edit.',
        '',
        "- **Min** and the level columns: game XP/hr (XP rate included) of the page's skill. Min is the level " +
            "every skill of the method needs together; a level column has the page's skill at that level, the others " +
            "at it or their own level, the best tools usable there, no amulet of glory; `-` under the page's skill's " +
            'own level.',
        '- **gp/hr**: the products kept, at item value (`cost`), at 99; a drop sink keeps only stackable ones.',
        '- **Binding**, at 99: `player` (the actions are most of a trip), `travel` (the legs and drops are), or ' +
            "`resource` (the features can't respawn fast enough).",
        '- **Measured**: XP/hr from conductor/tools/stats.ts at the level the runs started at, and in brackets it over ' +
            'the floor at those levels and that tool (`-` where the floor gives the skill no XP).',
        '- Rows are by Min, then method id.',
        '',
        'Below the table, each method has its name, plans and notes, then:',
        '',
        '- **Requires**: what a walk from the Lumbridge spawn needs to get to every site of the method (as the place ' +
            'pages read Requires; `none` for nothing); each skill at its own lowest level, the others at 99, and the ' +
            'level every skill needs at once (Min); the tools (an axe or pickaxe is the best usable at the level, ' +
            'wielded, its Attack level not checked); the food it eats.',
        '- **Sink**: drop, bank, or a process step then bank, with the run ticks of each leg.',
        '- **Supplies/hr**: bait, feathers and food used an hour, and their value, at 99.',
        '- **Measured**: each figure with the bot that ran it, the date, and the axe or pickaxe it used, if any.',
        '',
        '## Adding a method',
        '',
        '1. Write its record in [wiki/world/methods.ts](' +
            at('wiki/world/methods.ts') +
            "): a tile in the site (`at`), the family's params, the sink, the plans that run it.",
        '2. A new kind of action needs a family module in wiki/world/model/families/ (one file, its registry line), ' +
            'with a test worked by hand from its script.',
        '3. `bun run world`, and read its row here.',
        '4. Once bots have run it, add a `measured` entry with the figures from conductor/tools/stats.ts (a per-method ' +
            'view there is coming).',
        '',
    ].join('\n');
}
