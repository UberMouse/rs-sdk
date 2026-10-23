// wiki/training/<skill>.md: the curated methods (wiki/world/methods.ts, world.json `methods`) that train a skill, each
// with its floor XP/hr by level, which the model (model/cycle.ts) computes here from the resolved record, so a model
// fix shows in the pages without a world.json change; beside it what the bots measured. wiki/training/README.md lists
// the pages and says what the columns mean and how to add a method.
import {
    forMethod,
    fromWorldMethod,
    isTileStop,
    measuredFigures,
    methodModels,
    methodRate,
    styleParams,
    trains,
    uncalibrated,
    type MethodContext,
    type MethodModel,
    type ResolvedMethod,
    type Stop,
} from '../model/method';
import { profileAt, toolKindOfObj, type Profile, type Tools } from '../model/profile';
import { SKILLS, TICKS_PER_HOUR, XP_RATE, type Skill } from '../model/server';
import { methodHazard } from '../query';
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
            .filter(m => trains(m, skill))
            .sort((a, b) => a.minLevel - b.minLevel || cmp(a.def.id, b.def.id));
        if (ms.length) out.set(skill, ms);
    }
    return out;
}

/** Every training page and the README, as repo-relative paths and text. */
export function renderTraining(world: World, data: TrainingData): Page[] {
    const ctx: MethodContext = { world, ...data.model };
    const methods = world.methods.map(wm => fromWorldMethod(wm, world, data.model.zones));
    const pages = bySkill(methods);
    const out: Page[] = [...pages].map(([skill, ms]) => [trainingPath(skill), skillPage(skill, ms, world, data, ctx)]);
    out.push([TRAINING_README, readme(pages)]);
    return out;
}

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
    // Rated for the page's skill: a kill swings the style that suits it (methodRate).
    const rateFor = (m: ResolvedMethod, profile: Profile) => methodRate(m, profile, ctx, undefined, skill);
    const xp = (m: ResolvedMethod, profile: Profile): number => rateFor(m, profile).xpPerHour[skill] ?? 0;
    const npcName = (id: string): string => first(data.npcConfigs.get(id), 'name') ?? id;
    const where = (s: Site): string => `${areaCell(path, areas, s.areaPath)} \`${s.id}\``;
    const bankAt = (s: Site): string => `bank at ${where(s)}`;
    // The tool tier a page's columns pick the best of, by the obj that is one.
    const tier = (t: string): keyof Tools | null => toolKindOfObj(ctx.tools, t);

    // Each method's models at 99, a kill's on the first style the page's skill rates: built once per method.
    type Models = ReturnType<typeof methodModels>;
    const at99 = new Map(
        methods.map(m =>
            forMethod(m, () => {
                const top = column(m, 99);
                return [m, methodModels(m, top, ctx, undefined, styleParams(m.def, top, ctx, skill)[0])] as const;
            }),
        ),
    );
    // The tools the method carries at 99: a tier stands for the best of it usable at each column.
    const held = ({ gather, steps }: Models): string[] => {
        const actions = [...('withdraw' in gather ? [] : [gather]), ...steps.flat()];
        return [...new Set(actions.flatMap(a => a.tools ?? []))];
    };
    // A kill: a gather on an attack rate (the combat family).
    const isKill = ({ gather }: Models): boolean => !('withdraw' in gather) && gather.attackRate !== undefined;
    const kills = [...at99.values()].some(isKill);
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
            ...(m.def.gear?.length ? [`Gear: ${m.def.gear.map(obj).join(', ')}.`] : []),
            ...(m.def.food ? [`Food: ${obj(m.def.food)}.`] : []),
        ].join(' ');
    };
    const sink = (m: ResolvedMethod): string => {
        if (m.sink.mode === 'drop') return 'drop';
        // A leg over random landings runs their mean (model/legs.ts): one decimal.
        const legs = m.ways[0]!.legs.map(l => Number(l.runTicks.toFixed(1)));
        let stops = '';
        if (m.sink.mode === 'bank') stops = bankAt(m.sink.bank);
        else if (m.def.sink.mode === 'process') {
            const { steps, end } = m.def.sink;
            const stop = (s: Stop): string =>
                s === 'here'
                    ? 'here'
                    : isTileStop(s)
                      ? `at (${s.tile.x}, ${s.tile.z}, ${s.tile.level})`
                      : `at ${where(s)}`;
            const at = m.sink.steps.map((s, i) => `${steps[i]!.family} ${stop(s)}`);
            // A withdrawal banks at its own site.
            stops = [...at, end === 'bank' ? bankAt(m.sink.bank ?? m.site) : end].join(', then ');
        }
        return legs.length ? `${stops}; legs ${legs.join(' + ')} run ticks` : stops;
    };
    // Each measured figure with the page's skill in it: the table cell (XP/hr, level, it over its floor) and who ran it.
    const measured = (m: ResolvedMethod): { cell: string; by: string }[] =>
        measuredFigures(m, skill, ctx).map(({ measured: x, xpPerHour: got, floor }) => {
            const at = x.level[skill] === undefined ? '' : ` at ${x.level[skill]}`;
            const tool = x.tool ? `, with the ${obj(x.tool)}` : '';
            const worn = x.worn?.length ? `, wearing ${x.worn.map(obj).join(', ')}` : '';
            return {
                cell: `${compact(got)}${at} (${percent(got, floor)})`,
                by: `${compact(got)}${at} by ${x.bot} on ${x.date}${tool}${worn}`,
            };
        });

    // A kill's npcs as a hazard (ResolvedMethod.npcs, methodHazard at 99): who hunts, how hard they hit, the zones,
    // and the target's retreat, which the floor leaves out. In the Wilderness a hunter hunts every combat level, as
    // methodHazard has it.
    const hazard = (m: ResolvedMethod): string[] => {
        if (!m.npcs) return [];
        const h = methodHazard(m, column(m, 99));
        const wild = Math.max(m.site.wildernessLevel, m.areaHazard?.wildernessLevel ?? 0) > 0;
        const upTo = (n: number | null): string =>
            wild ? 'every combat level (Wilderness)' : n === null ? 'any combat level' : `combat ${n} and below`;
        const hunters = m.npcs.hunters.length
            ? m.npcs.hunters.map(x => `${npcName(x.npc)} hunts players of ${upTo(x.upTo)}`).join('; ')
            : 'no npc there hunts players';
        // An npc that can't hit (max hit 0) has no hit to state and no retreat that spares the player.
        const hits = m.npcs.maxHit > 0;
        const zone = h.wildernessLevel > 0 ? `, Wilderness level ${h.wildernessLevel}` : '';
        const retreat =
            m.npcs.retreat === undefined || !hits
                ? ''
                : ` The target retreats at ${m.npcs.retreat} HP and stops hitting back; the floor prices the kill as if it fought on.`;
        const maxHit = hits ? `; the npcs there hit for at most ${m.npcs.maxHit}` : '';
        return [`  - **Hazard**: ${hunters}${maxHit}; ${h.multiway ? 'multiway' : 'single-way'}${zone}.${retreat}`];
    };
    // The food gate (model/method.ts uncalibrated): a kill that takes damage, of an npc no run has calibrated, eats
    // nothing in its floor. An npc that can't hit (the chicken's max hit 0) has no damage to gate.
    const gated = (m: ResolvedMethod, { gather }: Models): string =>
        !('withdraw' in gather) && gather.attackRate !== undefined && (gather.damage ?? 0) > 0 && uncalibrated(m, ctx)
            ? 'Food/hr uncalibrated: no worker run has checked the damage these kills take (wiki/world/methods.ts ' +
              'CALIBRATIONS), so the XP/hr leaves out food trips'
            : '';
    const rated = methods.map(m =>
        forMethod(m, () => {
            const own = m.levels[skill]!;
            const top = rateFor(m, column(m, 99));
            const models = at99.get(m)!;
            const ts = held(models);
            const ms = measured(m);
            const supplies = top.suppliesPerHour.map(x => `${compact(x.count)} ${obj(x.obj)}`);
            const plans = m.def.plans?.length ? ` Plans: ${m.def.plans.join(', ')}.` : '';
            const gate = gated(m, models);
            const supplied = supplies.length ? `${supplies.join(', ')}; ${compact(top.suppliesGpPerHour)} gp` : 'none';
            return {
                tiers: ts.flatMap(t => tier(t) ?? []),
                row: [
                    `\`${m.def.id}\``,
                    where(m.site),
                    `${compact(xp(m, column(m, m.minLevel)))} at ${m.minLevel}`,
                    ...LEVEL_COLUMNS.map(l => (l < own ? '-' : compact(xp(m, column(m, l))))),
                    ...(kills
                        ? [isKill(models) ? compact((TICKS_PER_HOUR / top.trip.total) * top.trip.successes) : '-']
                        : []),
                    compact(top.gpPerHour),
                    top.binding,
                    ms.map(x => x.cell).join('; ') || '-',
                ],
                bullet: [
                    `- \`${m.def.id}\`: ${m.def.name}.${plans}${m.def.notes ? ` ${m.def.notes}` : ''}`,
                    `  - **Requires**: ${requires(m, ts)}`,
                    `  - **Sink**: ${sink(m)}.`,
                    ...hazard(m),
                    `  - **Supplies/hr** at 99: ${supplied}${gate ? `; ${gate}` : ''}.`,
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
            `method's ${name} level. ${kills ? 'kills/hr, ' : ''}gp/hr, the binding term and Supplies/hr are at 99. ` +
            (kills
                ? `A kill swings the weapon's style that suits ${name} (Attack accurate, Strength aggressive, Defence ` +
                  'defensive; Hitpoints and Prayer the best of its styles). '
                : '') +
            "Measured is a bot's XP/hr at the " +
            'level its runs started at, and in brackets it over the floor there. Below the table, each method: what it ' +
            `requires, its sink, ${kills ? "a kill's hazard, " : ''}its supplies, and who measured it.`,
        '',
        ...table(
            [
                'Method',
                'Where',
                'Min',
                ...LEVEL_COLUMNS.map(String),
                ...(kills ? ['kills/hr'] : []),
                'gp/hr',
                'Binding',
                'Measured',
            ],
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
        "- **kills/hr**, on a page with a kill (the combat family): the kills an hour at 99, on the style the page's " +
            'skill swings (Attack accurate, Strength aggressive, Defence defensive; Hitpoints and Prayer the best of ' +
            "the weapon's styles); `-` for a method that is no kill.",
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
            "wielded, its Attack level not checked); the gear it wears (a kill's weapon and armour); the food it eats.",
        '- **Sink**: drop, bank, or a process step then bank, with the run ticks of each leg.',
        "- **Hazard**, a kill's: the npcs there that hunt players and up to which combat level (every one in the " +
            'Wilderness), the largest max hit among them, whether it is multiway or in the Wilderness, and the ' +
            "target's retreat HP, which the floor leaves out; an npc that can't hit has neither.",
        '- **Supplies/hr**: bait, feathers and food used an hour, and their value, at 99. A kill eats food only once a ' +
            "worker run has checked the model's damage on its npc (wiki/world/methods.ts CALIBRATIONS); until then, " +
            'where the npc can hit, it says Food/hr uncalibrated, and its XP/hr leaves out food trips.',
        '- **Measured**: each figure with the bot that ran it, the date, the axe or pickaxe it used, if any, and the ' +
            'objs it wore, if recorded.',
        '',
        '## Adding a method',
        '',
        '1. Write its record in [wiki/world/methods.ts](' +
            at('wiki/world/methods.ts') +
            "): a tile in the site (`at`), the family's params, the sink, the plans that run it.",
        '2. A new kind of action needs a family module in wiki/world/model/families/ (one file, its registry line), ' +
            'with a test worked by hand from its script.',
        '3. `bun run world`, and read its row here.',
        '4. Once bots have run it, paste the entry that `bun conductor/tools/stats.ts <bot> --methods` prints into its ' +
            '`measured`.',
        '',
    ].join('\n');
}
