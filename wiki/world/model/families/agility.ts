// An agility course's lap (survey §4, "Agility as a lap"): one attempt is a whole lap of an `agility-course` site
// (Site.course), from its first obstacle round to it again. Each step's moves are the crossing rows on its placed
// obstacles (World.crossings) and the gate rows with a landing read from the script (World.gates, the Wilderness pipe);
// each row's stand is a tile the move is made from, and its success ticks are its script's delays (Crossing.ticks,
// Gate.standTicks). A placement of a stepped obstacle's loc config that sets no step (the Barbarian course's first two
// crumbling walls, barbarian_course.rs2:114-123) stands in the way, so it is crossed before that step. The lap is the
// cheapest round of one move per placement over the walks between them (Family.walks), the rolled moves' falls priced
// in.
import { codeOf } from '../../classify';
import { parseRequirement } from '../../requirements';
import { damageAt, expectedTicks, statRandomChance } from '../../roll';
import { first } from '../../sources/configs';
import { triggerKey } from '../../sources/gate-scan';
import { parseCallables, parseTriggers, type Callable, type Trigger } from '../../sources/triggers';
import type { Course, Crossing, Gate, Rect, Roll, Site, Tile } from '../../types';
import { byTile, tileKey } from '../../util';
import { ModelError, ProfileError, type ActionModel, type ModelWorld } from '../family';
import type { Profile } from '../profile';
import { SKILLS, type Skill } from '../server';
import { stringParams, type FamilyFactory, type GameData } from './common';

/** One way over one placed obstacle: from `stand` to `landing` in `ticks`, behind `roll` when it has one. */
export interface Move {
    /** The op trigger that makes it (`oploc1,obstical_pipe2`), for its xp. */
    trigger: string;
    loc: string;
    stand: Tile;
    landing: Tile;
    ticks: number;
    requires: string[][];
    roll?: Roll;
}

/** One step of the lap: the placements crossed before it (each its moves), then its own obstacles' moves. */
export interface Step {
    step: number;
    before: Move[][];
    moves: Move[];
}

const same = (a: Tile, b: Tile): boolean => tileKey(a) === tileKey(b);
const inRect = (r: Rect, t: Tile): boolean =>
    (r.level === undefined || r.level === t.level) && t.x >= r.x1 && t.x <= r.x2 && t.z >= r.z1 && t.z <= r.z2;
const byMove = (a: Move, b: Move): number => byTile(a.stand, b.stand) || byTile(a.landing, b.landing);

/** The moves of the placed `loc` on `tile`: its crossing rows' stands, and a gate row's stands that land on its `to`. */
function movesAt(loc: string, tile: Tile, world: Required<ModelWorld>): Move[] {
    const out: Move[] = [];
    for (const c of world.crossings) {
        if (c.act.kind !== 'loc-op' || c.act.loc !== loc || !same(c.at, tile)) continue;
        out.push(...crossingMoves(c, loc, c.act.op));
    }
    for (const g of world.gates) {
        if (g.loc !== loc || !same(g.tile, tile) || g.kind !== 'gate') continue;
        out.push(...gateMoves(g));
    }
    return out.sort(byMove);
}

/** A crossing row's moves: one per tile it is made from, to its one landing. */
function crossingMoves(c: Crossing, loc: string, op: number): Move[] {
    const at = `${loc} at (${c.at.x}, ${c.at.z}, ${c.at.level})`;
    if (c.ticks === undefined) throw new ModelError(`the crossing row of ${at} has no success ticks`);
    if (c.landings.length !== 1) throw new ModelError(`the crossing row of ${at} lands at random: not modelled`);
    const landing = c.landings[0]!.tile;
    return c.from.map(stand => ({
        trigger: `oploc${op},${loc}`,
        loc,
        stand,
        landing,
        ticks: c.ticks!,
        requires: c.requires,
        ...(c.roll ? { roll: c.roll } : {}),
    }));
}

/** A gate row's moves: one per stand of `standTicks` to its `to`; a row with no landing read (the far pipe end) has none. */
function gateMoves(g: Gate): Move[] {
    if (g.landings) throw new ModelError(`the gate row of ${g.loc} lands by stand (landings): not modelled`);
    if (!g.to) return [];
    if (!g.standTicks) throw new ModelError(`the gate row of ${g.loc} has no success ticks by stand`);
    return g.standTicks.map(s => ({
        trigger: g.trigger,
        loc: g.loc,
        stand: s.stand,
        landing: g.to!,
        ticks: s.ticks,
        requires: g.requires,
        ...(g.roll ? { roll: g.roll } : {}),
    }));
}

/**
 * The most placements that set no step one step may have in the way: the lap tries every order of them (rounds), k! of
 * them (the Barbarian course's two walls, 2).
 */
const MAX_BEFORE = 5;

/** The lap of an `agility-course` site, step by step; throws when the site or world can't give one. */
export function lapOf(site: Site, world: ModelWorld): Step[] {
    if (site.kind !== 'agility-course' || !site.course)
        throw new ModelError(`site ${site.id} is a ${site.kind} site, not an agility-course site`);
    const { crossings, gates } = world;
    if (!crossings || !gates) throw new ModelError(`a lap of ${site.id} needs the world's crossing and gate rows`);
    const full = { features: world.features, crossings, gates };
    const { obstacles } = site.course;
    const last = Math.max(...obstacles.map(o => o.step));
    const steps: Step[] = [];
    for (let step = 1; step <= last; step++) {
        const own = obstacles.filter(o => o.step === step);
        const moves = own.flatMap(o => movesAt(o.loc, o.tile, full)).sort(byMove);
        if (!moves.length) throw new ModelError(`step ${step} of ${site.id} has no crossing or gate row to make it by`);
        const locs = new Set(own.map(o => o.loc));
        // The other placements of the step's loc configs in the site, which set no step (stepAt, sources/courses.ts),
        // by loc and tile. Each is crossed by its crossing rows: one with only a gate row is not modelled.
        const inSite = (loc: string, tile: Tile) =>
            locs.has(loc) && inRect(site.bbox, tile) && !obstacles.some(o => same(o.tile, tile));
        for (const g of gates)
            if (inSite(g.loc, g.tile))
                throw new ModelError(
                    `${g.loc} at (${g.tile.x}, ${g.tile.z}, ${g.tile.level}) in ${site.id} sets no step and has a gate row: not modelled`,
                );
        const others = new Map<string, { loc: string; tile: Tile }>();
        for (const c of crossings)
            if (c.act.kind === 'loc-op' && inSite(c.act.loc, c.at))
                others.set(`${c.act.loc} ${tileKey(c.at)}`, { loc: c.act.loc, tile: c.at });
        if (others.size > MAX_BEFORE)
            throw new ModelError(
                `step ${step} of ${site.id} has ${others.size} placements that set no step: more than ${MAX_BEFORE} orders them past reading`,
            );
        const before = [...others.values()]
            .sort((a, b) => byTile(a.tile, b.tile))
            .map(o => movesAt(o.loc, o.tile, full));
        steps.push({ step, before, moves });
    }
    return steps;
}

/** Every order of `xs`. */
function orders<T>(xs: readonly T[]): T[][] {
    if (xs.length <= 1) return [[...xs]];
    return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
}

/** The lap's rounds: its placements in lap order, one for each order of every step's `before` placements. */
const rounds = (steps: readonly Step[]): Move[][][] =>
    steps.reduce<Move[][][]>((acc, s) => acc.flatMap(r => orders(s.before).map(o => [...r, ...o, s.moves])), [[]]);

/**
 * The tile pairs a lap may walk, in a fixed order: each move's landing to each stand of the placement after it, in
 * every round, and a fall's landing back to its move's stand. The index of each pair by `from to` key.
 */
function pairsOf(steps: readonly Step[]): { pairs: { from: Tile; to: Tile }[]; index: Map<string, number> } {
    const pairs: { from: Tile; to: Tile }[] = [];
    const index = new Map<string, number>();
    const add = (from: Tile, to: Tile) => {
        const key = `${tileKey(from)} ${tileKey(to)}`;
        if (index.has(key)) return;
        index.set(key, pairs.length);
        pairs.push({ from, to });
    };
    for (const round of rounds(steps))
        round.forEach((placement, i) => {
            const next = round[(i + 1) % round.length]!;
            for (const m of placement) for (const n of next) add(m.landing, n.stand);
        });
    for (const s of steps)
        for (const m of [...s.before.flat(), ...s.moves]) if (m.roll?.fail.to) add(m.roll.fail.to, m.stand);
    return { pairs, index };
}

const isSkill = (s: string): s is Skill => (SKILLS as readonly string[]).includes(s);

/**
 * Whether the profile meets one of a move's requirement sets. A set asking anything but a skill level is not
 * modelled (the courses' rows ask none).
 */
function meets(m: Move, profile: Profile): boolean {
    return m.requires.some(set =>
        set.every(s => {
            const r = parseRequirement(s);
            if (r.kind !== 'skill' || !isSkill(r.skill))
                throw new ModelError(`${m.trigger} asks ${s}: only a skill level is modelled`);
            return profile.levels[r.skill] >= r.level;
        }),
    );
}

/**
 * The loc op trigger the engine runs for `op` on a placed `loc`: the loc's own, else its category's
 * (ScriptProvider.getByTrigger, server/engine/src/engine/script/ScriptProvider.ts:124-134, looks up the type's
 * trigger first, then the category's).
 */
export function triggerFor(
    triggers: readonly Trigger[],
    locs: GameData['locs'],
    loc: string,
    op: string,
): Trigger | undefined {
    const ops = triggers.filter(x => x.on === 'loc' && x.kind === 'op' && x.op === op);
    const category = first(locs.get(loc), 'category');
    return ops.find(x => !x.category && x.target === loc) ?? ops.find(x => x.category && x.target === category);
}

const STAT_ADVANCE = /\bstat_advance\(\s*agility\s*,/g;

/**
 * The agility xp tenths a move's trigger gives on success, read from its script: each `stat_advance(agility, <n>)`
 * in its body, a label it jumps to, or a proc it calls (followed through), `<n>` a number or a parameter the call
 * gives one for (`~agility_climb_up(75, ...)`, skill_agility/scripts/agility.rs2:3-6; `~agility_force_move`, :11-16).
 * The one proc not followed is the course's lap proc, the one whose body holds the bonus's stat_advance
 * (Course.source): its bonus is Course.lapBonus. Throws when the xp a stat_advance gives is not read, or when the
 * trigger gives xp more than one way.
 */
function xpReader(data: GameData): (trigger: string, loc: string, course: Course) => number {
    let triggers: Trigger[] | undefined;
    let callables: Map<string, Callable> | undefined;
    const cache = new Map<string, number>();
    return (trigger, loc, course) => {
        const key = `${trigger} ${loc} ${course.source}`;
        const had = cache.get(key);
        if (had !== undefined) return had;
        triggers ??= data.scripts.flatMap(([f, text]) => parseTriggers(f, text));
        callables ??= new Map(data.scripts.flatMap(([f, text]) => parseCallables(f, text)).map(c => [c.call, c]));
        const procs = callables;
        const op = trigger.match(/^oploc([1-5]),/)?.[1];
        const t = op === undefined ? undefined : triggerFor(triggers, data.locs, loc, op);
        if (!t) throw new ModelError(`no script has the trigger ${trigger} for ${loc}`);
        const lapProc = lapProcOf(course, [...procs.values()]);
        // Whether a proc's body, or a proc it calls (the lap proc aside), has a stat_advance(agility, ...): the
        // procs followed.
        const advancing = new Map<string, boolean>();
        const open: string[] = [];
        const advances = (call: string): boolean => {
            const known = advancing.get(call);
            if (known !== undefined) return known;
            // A proc reached again while its body is still read closes a cycle through another proc (a proc calling
            // itself adds nothing and is skipped below): caching a guess for it would misread the procs on the cycle.
            if (open.includes(call))
                throw new ModelError(`${trigger}: procs call each other in a cycle (${[...open, call].join(' -> ')})`);
            open.push(call);
            const code = codeOf(procs.get(call)?.body ?? '');
            const yes =
                code.search(STAT_ADVANCE) >= 0 ||
                [...code.matchAll(/~([a-z0-9_]+)/g)].some(
                    m => `~${m[1]}` !== lapProc && `~${m[1]}` !== call && advances(`~${m[1]}`),
                );
            open.pop();
            advancing.set(call, yes);
            return yes;
        };
        const found: number[] = [];
        const labels = new Set<string>();
        // One body, its parameters bound to the calling code's arguments (`$xp` -> `75`); `stack` the procs it is in.
        const visit = (body: string, where: string, env: ReadonlyMap<string, string>, stack: readonly string[]) => {
            const code = codeOf(body);
            for (const m of code.matchAll(STAT_ADVANCE)) {
                const arg = argsAt(code, m.index + m[0].indexOf('(') + 1)[1] ?? '';
                const n = Number(env.get(arg) ?? arg);
                if (arg === '' || !Number.isInteger(n))
                    throw new ModelError(`${trigger}: stat_advance(agility, ${arg}) in ${where} gives xp not read`);
                found.push(n);
            }
            for (const m of code.matchAll(/~([a-z0-9_]+)(\()?/g)) {
                const call = `~${m[1]}`;
                const proc = procs.get(call);
                if (!proc || call === lapProc || stack.includes(call) || !advances(call)) continue;
                const listed = m[2] ? argsAt(code, m.index + m[0].length) : [];
                const args = listed.length === 1 && listed[0] === '' ? [] : listed;
                const params = paramsOf(proc);
                if (params.length !== args.length)
                    throw new ModelError(`${trigger}: ${call} is called with ${args.length} arguments in ${where}`);
                const bound = new Map(params.map((p, i) => [p, env.get(args[i]!) ?? args[i]!]));
                visit(proc.body, call, bound, [...stack, call]);
            }
            for (const m of code.matchAll(/@([a-z0-9_]+)|\bjump\(([a-z0-9_]+)\)/g)) {
                const label = procs.get(`@${m[1] ?? m[2]}`);
                if (!label || labels.has(label.call)) continue;
                labels.add(label.call);
                visit(label.body, label.call, new Map(), stack);
            }
        };
        visit(t.body, `[${triggerKey(t)}]`, new Map(), []);
        if (found.length > 1)
            throw new ModelError(`${trigger} gives agility xp ${found.length} ways: which runs is not read`);
        const xp = found[0] ?? 0;
        cache.set(key, xp);
        return xp;
    };
}

/** The `$name`s of a proc's parameters, in order. */
const paramsOf = (proc: Callable): string[] =>
    (proc.body.match(/^\s*\(([^)]*)\)/)?.[1] ?? '')
        .split(',')
        .map(p => p.trim().split(/\s+/)[1])
        .filter((p): p is string => p !== undefined);

/**
 * The course's lap proc: the proc in Course.source's file whose header is the last before that line, and whose body
 * has the bonus's stat_advance there. Throws when there is none.
 */
function lapProcOf(course: Course, callables: readonly Callable[]): string {
    const at = course.source.match(/^(.*):(\d+)$/);
    const [file, line] = [at?.[1], Number(at?.[2])];
    const proc = callables
        .filter(c => c.file === file && c.call.startsWith('~') && c.line <= line)
        .sort((a, b) => b.line - a.line)[0];
    const there = proc && codeOf(proc.body).split('\n')[line - proc.line];
    if (!proc || there === undefined || there.search(STAT_ADVANCE) < 0)
        throw new ModelError(`no proc has the lap bonus's stat_advance at ${course.source}`);
    return proc.call;
}

/** The literal arguments of a call whose `(` ends just before `from`, split at its top-level commas. */
function argsAt(code: string, from: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = from;
    for (let i = from; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(') depth++;
        else if (ch === ')' && depth > 0) depth--;
        else if ((ch === ',' && depth === 0) || ch === ')') {
            args.push(code.slice(start, i).trim());
            start = i + 1;
            if (ch === ')') break;
        }
    }
    return args;
}

/** A move's expected cost at a profile, or a lap's: ticks, hitpoints lost and xp tenths. */
interface Priced {
    ticks: number;
    damage: number;
    xp: number;
}

/** A move the profile can make, and its cost. */
interface Option {
    move: Move;
    cost: Priced;
}

/**
 * The cheapest way once round `placements` (one move of each, in order, then back to the first), each move's cost
 * plus the walks from each landing to the next stand; undefined when no way round walks. Of equal ways the first in
 * the placements' tile order is kept.
 */
function cheapestRound(
    placements: readonly Option[][],
    walk: (from: Tile, to: Tile) => number | null,
): Priced | undefined {
    if (placements.some(p => !p.length)) return undefined;
    let best: Priced | undefined;
    const add = (so: Priced, w: number, c: Priced): Priced => ({
        ticks: so.ticks + w + c.ticks,
        damage: so.damage + c.damage,
        xp: so.xp + c.xp,
    });
    const none: Priced = { ticks: 0, damage: 0, xp: 0 };
    for (const start of placements[0]!) {
        // The cheapest way from `start` to each move of the placement reached so far.
        let reached: (Priced | undefined)[] = placements[0]!.map(x => (x === start ? start.cost : undefined));
        let prev = placements[0]!;
        for (const here of placements.slice(1)) {
            reached = here.map(x => {
                let got: Priced | undefined;
                prev.forEach((p, i) => {
                    const w = walk(p.move.landing, x.move.stand);
                    if (!reached[i] || w === null) return;
                    const t = add(reached[i]!, w, x.cost);
                    if (!got || t.ticks < got.ticks) got = t;
                });
                return got;
            });
            prev = here;
        }
        prev.forEach((p, i) => {
            const w = walk(p.move.landing, start.move.stand);
            if (!reached[i] || w === null) return;
            const lap = add(reached[i]!, w, none);
            if (!best || lap.ticks < best.ticks) best = lap;
        });
    }
    return best;
}

export const agility: FamilyFactory = data => {
    const xpOf = xpReader(data);
    return {
        id: 'agility',
        skills: ['agility'],
        kinds: ['agility-course'],
        walks(site, params, world) {
            stringParams(params, 'agility', []);
            return pairsOf(lapOf(site, world)).pairs;
        },
        model(site, params, profile, world, walks): ActionModel {
            stringParams(params, 'agility', []);
            const steps = lapOf(site, world);
            const { pairs, index } = pairsOf(steps);
            if (!walks || walks.length !== pairs.length)
                throw new ModelError(`a lap of ${site.id} needs its ${pairs.length} walks priced (Family.walks)`);
            const walk = (from: Tile, to: Tile): number | null => {
                const i = index.get(`${tileKey(from)} ${tileKey(to)}`);
                if (i === undefined)
                    throw new ModelError(
                        `a lap of ${site.id} walks ${tileKey(from)} to ${tileKey(to)}, no pair of its walks`,
                    );
                return walks[i] ?? null;
            };
            const hp = profile.levels.hitpoints;
            // Each move at the profile: its cost, or why it can't be made (`profile`: the profile can't).
            const priced = (m: Move): Priced | { why: string; profile: boolean } => {
                if (!meets(m, profile))
                    return {
                        why: `${m.trigger} needs ${m.requires.map(set => set.join(' and ')).join(', or ')}`,
                        profile: true,
                    };
                // The next click's op runs a tick after the move's last delay ends: it is refused while the delay
                // holds the player (survey §0, families/common.ts clickTicks).
                const own = { ticks: m.ticks + 1, damage: 0, xp: xpOf(m.trigger, m.loc, site.course!) };
                if (!m.roll) return own;
                const stat = m.roll.stat;
                if (!isSkill(stat)) throw new ModelError(`${m.trigger} rolls ${stat}: not a skill`);
                const p = statRandomChance(profile.levels[stat], m.roll.low, m.roll.high);
                if (p <= 0)
                    return { why: `${m.trigger} never succeeds at ${stat} ${profile.levels[stat]}`, profile: true };
                // Each fall takes its failure's ticks, the walk back to the stand from where it leaves the player, and
                // the click again (roll.ts expectedTicks: (1 - p)/p falls before the success).
                const fail = m.roll.fail;
                const back = fail.to ? walk(fail.to, m.stand) : 0;
                if (back === null) return { why: `no walk back from ${m.trigger}'s fall`, profile: false };
                return {
                    ticks: expectedTicks(own.ticks, p, fail.ticks + 1, back),
                    damage: ((1 - p) / p) * damageAt(fail.hpDamage ?? { a: 0, b: 1, c: fail.damage }, hp),
                    xp: own.xp,
                };
            };
            const costs = new Map<Move, ReturnType<typeof priced>>();
            for (const st of steps) for (const m of [...st.before.flat(), ...st.moves]) costs.set(m, priced(m));
            const usable = (ms: readonly Move[]): Option[] =>
                ms.flatMap(m => {
                    const c = costs.get(m)!;
                    return 'why' in c ? [] : [{ move: m, cost: c }];
                });
            for (const st of steps)
                for (const ms of [...st.before, st.moves]) {
                    if (usable(ms).length) continue;
                    if (!ms.length) throw new ModelError(`step ${st.step} of ${site.id} has a placement with no move`);
                    const why = ms.map(m => costs.get(m)!).flatMap(c => ('why' in c ? [c] : []));
                    const text = [...new Set(why.map(w => w.why))].sort().join('; ');
                    if (why.every(w => w.profile)) throw new ProfileError(`step ${st.step} of ${site.id}: ${text}`);
                    throw new ModelError(`step ${st.step} of ${site.id}: ${text}`);
                }
            let best: Priced | undefined;
            for (const round of rounds(steps)) {
                const lap = cheapestRound(round.map(usable), walk);
                if (lap && (!best || lap.ticks < best.ticks)) best = lap;
            }
            if (!best) throw new ModelError(`no lap of ${site.id} closes over the walks between its obstacles`);
            return {
                ticksPerAttempt: best.ticks,
                success: 1,
                xpTenths: { agility: best.xp + site.course!.lapBonus },
                products: [],
                consumes: [],
                // A course with a fall that hurts says so with 0 where its rolls are certain, so a food named for
                // its lower levels is not refused (cycle.ts).
                ...(best.damage > 0 || [...costs.keys()].some(m => (m.roll?.fail.damage ?? 0) > 0)
                    ? { damage: best.damage }
                    : {}),
            };
        },
    };
};
