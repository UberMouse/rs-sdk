// Ship routes, read from the sail scripts. A sail is `%journey_number = <route>` (the ship_journey
// interface's map, routes in interface_boat/scripts/sail.constant) then `p_telejump(<landing>)`:
// `[proc,set_sail]` (interface_boat/scripts/sail.rs2:1) and procs like it (`[proc,set_sail_cairn]`,
// areas/area_karamja/scripts/captain_shanks.rs2:47) do both, and the npc that sells the trip calls one,
// often from a dialogue label several npcs share (`@karamja_sailor_dialogue("Karamja", <landing>,
// ^sail_port_sarim_to_karamja)`, areas/area_port_sarim/scripts/sailors.rs2:10).
//
// The walker runs each npc op trigger that can reach a sail, once per spawn of each npc it serves (so
// `npc_coord` and `npc_type` are known: a customs officer's destination depends on which one it is),
// down every path, and records on each path the coins taken (`inv_del(inv, coins, n)`), the objs taken
// (net of any it gives), and the conditions the path took. A dialogue choice (`~p_choice*`) goes both
// ways and adds nothing. Each condition becomes a requirement (requirements.ts): a members check
// `members`, a quest varp `quest:<id>` or `quest:<id>>=<stage>`, holding an obj `item:<obj>:held`, a
// loadout proc (gates.ts LOADOUT_PROCS) returning false `loadout:<id>`; or nothing, when it only says the
// player lacks something (no coins, no rum, an F2P world, a quest not yet at a stage: a path for that
// player, not a requirement); or `other:<text>` when none fits. A path that needs a quest varp at one exact
// stage below complete is a quest window: it is left out and reported. A transport is a minimal set of
// the requirements of the paths that sail from one npc spawn to one landing.
import { codeOf } from '../classify';
import { coord as coordText } from '../render/common';
import { minimalSets, parseRequirement } from '../requirements';
import type { Quest, Tile, Transport } from '../types';
import { cmp, push } from '../util';
import { first, type Config } from './configs';
import type { Constant } from './constants';
import {
    equal,
    fold,
    merge,
    scriptCache,
    TooManyPaths,
    truthOf,
    unknown,
    type CoordValue,
    type Flow as SharedFlow,
    type Value,
} from './evaluate';
import { coordTile, isCoordLiteral, type Expr, type Stmt } from './runescript';
import { blocks, type Callable, type Trigger } from './triggers';

/** The varp a sail sets, which the ship_journey interface reads for its map. */
const JOURNEY = '%journey_number';

/** The file whose `^sail_*` constants name the routes. */
const ROUTES_FILE = 'interface_boat/scripts/sail.constant';

/** Bounds label and proc calls, so a cycle can't recurse forever. */
const MAX_DEPTH = 16;

/** Bounds the paths one trigger's run follows; past it the trigger is reported, its sails dropped. */
export const MAX_PATHS = 256;

export interface SailInput {
    /** Every script file, for the sail sites (sailSites). */
    files: readonly [file: string, text: string][];
    triggers: readonly Trigger[];
    callables: readonly Callable[];
    constants: ReadonlyMap<string, Constant>;
    npcConfigs: ReadonlyMap<string, Config>;
    /** Every npc map spawn. */
    spawns: readonly { config: string; tile: Tile }[];
    quests: readonly Quest[];
    /** Loadout rule id -> the proc that checks it (gates.ts LOADOUT_PROCS). */
    loadoutProcs: Readonly<Record<string, string>>;
}

export interface Sails {
    transports: Transport[];
    /** Paths left out as quest windows: `<npc> (x, z) -> <route>: `<condition>` (file:line)`. */
    windows: string[];
    /** Triggers reaching a sail that the walker could not finish, with the construct that stopped it. */
    underived: string[];
    /**
     * Sail sites (a call of a sail proc, or a `%journey_number =` outside one) no npc op trigger's run
     * reached, as `file:line`.
     */
    unreached: string[];
    /** Route constants in sail.constant no derived transport sails, by name without `^sail_`. */
    unusedRoutes: string[];
}

// ---- Sail sites -------------------------------------------------------------------------------------

/** `%journey_number =` where a statement starts: after `;`, a brace, a `case` colon, an `if (...)` or `else`. */
const SETS_JOURNEY = /(?:^|[;{}:)]|\belse)\s*%journey_number\s*=/m;

/** A call (`@label`, `~proc`, `jump(label)`), or a bare name a label may be passed as (`@multi2(..., label_a)`). */
const CALLS = /[@~][a-z0-9_]+|\bjump\(\s*([a-z0-9_]+)|\b[a-z][a-z0-9_]*\b/g;

/** Procs that set %journey_number in their own body: a call of one is a sail site. */
const sailProcsOf = (callables: readonly Callable[]): Set<string> =>
    new Set(callables.filter(c => c.call.startsWith('~') && SETS_JOURNEY.test(codeOf(c.body))).map(c => c.call));

/** Which scripts can reach a sail (sailReach). */
interface Reach {
    /** A trigger's body: it sets %journey_number, or calls or names a callable that can. */
    body(body: string): boolean;
    /** A callable, by `@label` or `~proc`. */
    call(call: string): boolean;
}

/**
 * Which scripts can reach a sail: one that sets %journey_number, or calls or names as a label
 * (`@multi2("...", customs_journey, ...)` jumps to its label arguments) a callable that can. Every
 * callable is marked once, back along the call graph from those that set it.
 */
function sailReach(callables: readonly Callable[]): Reach {
    const defined = new Set(callables.map(c => c.call));
    const calls = (code: string): string[] =>
        [...code.matchAll(CALLS)]
            .map(m => (m[1] ? `@${m[1]}` : /^[@~]/.test(m[0]) ? m[0] : `@${m[0]}`))
            .filter(n => defined.has(n));
    const callers = new Map<string, string[]>();
    const marked = new Set<string>();
    for (const c of callables) {
        const code = codeOf(c.body);
        if (SETS_JOURNEY.test(code)) marked.add(c.call);
        for (const callee of calls(code)) push(callers, callee, c.call);
    }
    const queue = [...marked];
    while (queue.length)
        for (const caller of callers.get(queue.pop()!) ?? [])
            if (!marked.has(caller)) {
                marked.add(caller);
                queue.push(caller);
            }
    return {
        body: body => {
            const code = codeOf(body);
            return SETS_JOURNEY.test(code) || calls(code).some(c => marked.has(c));
        },
        call: call => marked.has(call),
    };
}

/**
 * Every sail site in the scripts, as `file:line`: each call of a proc that sets %journey_number, and
 * each `%journey_number =` outside such a proc, in any script (a queue sets the trawler's).
 */
export function sailSites(files: readonly [file: string, text: string][], callables: readonly Callable[]): string[] {
    const procs = sailProcsOf(callables);
    const out: string[] = [];
    for (const [file, text] of files)
        for (const b of blocks(file, text)) {
            const inSailProc = procs.has(`~${b.header.match(/^\[proc,([a-z0-9_]+)\]$/)?.[1]}`);
            codeOf(b.body)
                .split('\n')
                .forEach((line, i) => {
                    const at = `${file}:${b.line + i}`;
                    if (!inSailProc && SETS_JOURNEY.test(line)) out.push(at);
                    for (const m of line.matchAll(/~[a-z0-9_]+(?=\s*\()/g)) if (procs.has(m[0])) out.push(at);
                });
        }
    return [...new Set(out)].sort(cmp);
}

// ---- Values and conditions -------------------------------------------------------------------------

/** What one condition a path took means for the player. */
type Cond =
    /** A requirement's canonical string. */
    | { k: 'req'; req: string }
    /** Holds at least n coins: met by the fare when the path takes as many, else other:<text>. */
    | { k: 'coins'; n: number; text: string }
    /** Says only that the player lacks something: a path for that player, no requirement. */
    | { k: 'free' }
    /** A quest varp at one stage short of complete: the path is left out. */
    | { k: 'window'; text: string }
    | { k: 'other'; text: string };
// A coins', window's or other's text is the condition and its line: `\`%q = ^stage\` (file:line)`.

/** The comparison `!(l op r)` is, as `l op' r`. */
const NEGATE: Readonly<Record<string, string>> = { '=': '!', '!': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
/** The comparison `r op l` is, as `l op' r`. */
const FLIP: Readonly<Record<string, string>> = { '=': '=', '!': '!', '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

const TRUE: Expr = { t: 'name', name: 'true', args: null, text: 'true', line: 0 };

// ---- The walker -------------------------------------------------------------------------------------

interface Path {
    env: ReadonlyMap<string, Value>;
    /** The route `%journey_number` was set to on this path. */
    journey?: number;
    conds: readonly Cond[];
    /** Coins taken, and how a fare that varies was counted. */
    fare: number;
    fareNotes: readonly string[];
    /** Objs taken, net of any given: obj -> count. */
    taken: ReadonlyMap<string, number>;
    /** The lines that took coins (`coins`) or each obj, as `file:line`. */
    paid: ReadonlyMap<string, readonly string[]>;
    /** The call of the sail proc this path is in, as `file:line`. */
    site?: string;
}

type Flow = SharedFlow<Path>;

/** Where a statement runs: its file, and whether its script is a sail proc (its own sets aren't sites). */
interface Where {
    file: string;
    sailProc: boolean;
}

/** One path per way a condition can hold, each with what that way means. */
const branch = (p: Path, ways: readonly Cond[][]): Path[] => ways.map(cs => ({ ...p, conds: [...p.conds, ...cs] }));

/** A sail one path made. */
interface Sailed {
    path: Path;
    landing: CoordValue;
    /** The script line that makes the move (Transport.source). */
    source: string;
}

/** The config an argument names: a bare name (an obj in `inv_total(inv, coins)`), or a local holding one. */
function nameOf(e: Expr | undefined, env: ReadonlyMap<string, Value>): string | undefined {
    if (e?.t !== 'name' || e.args !== null) return undefined;
    if (e.name.startsWith('$')) {
        const v = env.get(e.name);
        return v?.t === 'name' ? v.v : undefined;
    }
    return /^[a-z0-9_]+$/.test(e.name) ? e.name : undefined;
}

/** Runs npc op triggers for one spawn at a time, over the callables. */
function sailWalker(input: SailInput, reaches: Reach) {
    const byCall = new Map(input.callables.map(c => [c.call, c]));
    const sailProcs = sailProcsOf(input.callables);
    const scriptOf = scriptCache();

    // Quest varps by the name the scripts use (a varbit's, or the varp's when progress is the whole varp),
    // each with the value that completes the quest on it, and whether it is the quest's own (not an `or`).
    const questOf = new Map<string, { quest: Quest; complete: number; own: boolean }>();
    for (const q of input.quests)
        for (const v of [q, ...(q.or ?? [])]) {
            const ref = { quest: q, complete: v.complete, own: v === q };
            if (v.varbit) questOf.set(`%${v.varbit}`, ref);
            else if (!v.bits) questOf.set(`%${v.varp}`, ref);
        }
    const loadoutOf = new Map(Object.entries(input.loadoutProcs).map(([id, proc]) => [proc, id]));

    const constant = (name: string): Value | undefined => {
        const c = input.constants.get(name);
        if (!c) return undefined;
        if (/^-?\d+$/.test(c.value)) return { t: 'int', n: Number(c.value) };
        if (isCoordLiteral(c.value)) return { t: 'coord', relative: false, ...coordTile(c.value), at: c.at };
        return undefined;
    };
    /** A bare name the walker can compare: an npc config, a label, or an inventory. */
    const known = (name: string): boolean =>
        name === 'inv' || name === 'worn' || input.npcConfigs.has(name) || byCall.has(`@${name}`);
    return (trigger: Trigger, spawn: { config: string; tile: Tile }) => {
        const sailed: Sailed[] = [];
        const reached = new Set<string>();
        const underived = new Set<string>();

        const evaluate = (e: Expr, env: ReadonlyMap<string, Value>, file: string): Value => {
            switch (e.t) {
                case 'num':
                    return { t: 'int', n: e.n };
                case 'coord':
                    return { t: 'coord', relative: false, ...e.tile, at: `${file}:${e.line}` };
                case 'str':
                    return unknown(e.text);
                case 'bin': {
                    const [l, r] = [evaluate(e.l, env, file), evaluate(e.r, env, file)];
                    const folded = fold(e.op, l, r, e.text);
                    if (folded) return folded;
                    const choice = (l.t === 'unknown' && l.choice) || (r.t === 'unknown' && r.choice);
                    if (l.t !== 'int' || r.t !== 'int') return unknown(e.text, choice);
                    const n = { '+': l.n + r.n, '-': l.n - r.n, '*': l.n * r.n, '/': Math.trunc(l.n / r.n) }[e.op];
                    if (n !== undefined) return { t: 'int', n };
                    const b = { '<': l.n < r.n, '>': l.n > r.n, '<=': l.n <= r.n, '>=': l.n >= r.n }[e.op];
                    return b === undefined ? unknown(e.text) : { t: 'bool', b };
                }
                case 'name':
                    break;
            }
            if (e.name.startsWith('$')) return env.get(e.name) ?? unknown(e.name);
            if (e.name.startsWith('^')) return constant(e.name) ?? unknown(e.name);
            if (e.args === null) {
                if (e.name === 'true' || e.name === 'false') return { t: 'bool', b: e.name === 'true' };
                // Engine commands (server/engine/src/engine/script/handlers/NpcOps.ts): the active npc's
                // tile and config.
                if (e.name === 'npc_coord') return { t: 'coord', relative: false, ...spawn.tile, at: 'npc_coord' };
                if (e.name === 'npc_type') return { t: 'name', v: spawn.config };
                return known(e.name) ? { t: 'name', v: e.name } : unknown(e.text);
            }
            const [a0, a1] = e.args.map(a => evaluate(a, env, file));
            // COORDX, COORDY (the level) and COORDZ split a coord (handlers/ServerOps.ts).
            if (/^coord[xyz]$/.test(e.name) && a0?.t === 'coord')
                return {
                    t: 'int',
                    n: e.name === 'coordx' ? a0.x : e.name === 'coordz' ? a0.z : a0.level,
                };
            // `$min + randominc($max - $min)`: min to max inclusive (general/scripts/misc/random_range.rs2:2).
            if (e.name === '~random_range' && a0?.t === 'int' && a1?.t === 'int')
                return { t: 'range', lo: a0.n, hi: a1.n };
            if (e.name.startsWith('~p_choice')) return unknown(e.text, true);
            return unknown(e.text);
        };

        /** What a condition that is neither known nor a dialogue choice means (Cond), taken `want` way. */
        const classify = (e: Expr, want: boolean, env: ReadonlyMap<string, Value>, file: string): Cond => {
            const text = `\`${e.text}\` (${file}:${e.line})`;
            const other: Cond = { k: 'other', text };
            // A bare boolean (`if (~has_x)`) reads as `~has_x = true`.
            const [l, op0, r] = e.t === 'bin' && NEGATE[e.op] ? [e.l, e.op, e.r] : [e, '=', TRUE];
            // What the condition is about on the left: `^stage > %varp` reads as `%varp < ^stage`.
            const subject = (x: Expr) =>
                x.t === 'name' &&
                (x.name.startsWith('%') || x.name === 'map_members' || x.name === 'inv_total' || loadoutOf.has(x.name));
            const [lhs, rhs, op1] = !subject(l) && subject(r) ? [r, l, FLIP[op0]!] : [l, r, op0];
            const op = want ? op1 : NEGATE[op1]!;
            const v = evaluate(rhs, env, file);
            if (lhs.t !== 'name') return other;

            const truth = truthOf(v);
            if (lhs.name === 'map_members' && lhs.args === null && (op === '=' || op === '!')) {
                if (truth === undefined) return other;
                return truth === (op === '=') ? { k: 'req', req: 'members' } : { k: 'free' };
            }

            const loadout = loadoutOf.get(lhs.name);
            if (loadout && lhs.args === null && (op === '=' || op === '!')) {
                if (truth === undefined) return other;
                return truth === (op === '=') ? { k: 'free' } : { k: 'req', req: `loadout:${loadout}` };
            }

            const ref = questOf.get(lhs.name);
            if (ref && lhs.args === null) {
                if (v.t !== 'int') return other;
                // `! 0` is started, as `>= 1`; `! n` above 0 and `<` allow none at all.
                const least = ({ '>=': v.n, '>': v.n + 1, '=': v.n, '!': v.n === 0 ? 1 : 0 } as Record<string, number>)[
                    op
                ];
                if (least === undefined || least <= 0) return { k: 'free' };
                if (least >= ref.complete) return { k: 'req', req: `quest:${ref.quest.id}` };
                if (op === '=') return { k: 'window', text };
                // A stage counts on the quest's own varp: one of another varp that completes it has no form.
                return ref.own ? { k: 'req', req: `quest:${ref.quest.id}>=${least}` } : other;
            }

            if (lhs.name === 'inv_total' && lhs.args?.length === 2) {
                const where = nameOf(lhs.args[0], env);
                const obj = nameOf(lhs.args[1], env);
                if ((where !== 'inv' && where !== 'worn') || !obj) return other;
                const n = v.t === 'int' ? v.n : v.t === 'range' ? v.hi : undefined;
                if (n === undefined) return other;
                // The least count the path implies, 0 when it allows none.
                const least =
                    ({ '>': n + 1, '>=': n, '!': n === 0 ? 1 : 0, '=': n } as Record<string, number>)[op] ?? 0;
                if (least <= 0) return { k: 'free' };
                if (obj === 'coins' && where === 'inv') return { k: 'coins', n: least, text };
                return { k: 'req', req: `item:${obj}:${where === 'inv' ? 'held' : 'worn'}` };
            }
            return other;
        };

        /** The ways a condition can hold as `want`: each a list of what it means; [] when it can't. */
        const assume = (e: Expr, want: boolean, env: ReadonlyMap<string, Value>, file: string): Cond[][] => {
            const v = evaluate(e, env, file);
            if (v.t === 'bool') return v.b === want ? [[]] : [];
            if (v.t === 'unknown' && v.choice) return [[]];
            if (e.t === 'bin' && (e.op === '&' || e.op === '|')) {
                const [l, r] = [assume(e.l, want, env, file), assume(e.r, want, env, file)];
                // `a & b` holds when both do, and `a | b` fails when both do; otherwise either way will.
                if ((e.op === '&') === want) return l.flatMap(x => r.map(y => [...x, ...y]));
                return [...l, ...r];
            }
            return [[classify(e, want, env, file)]];
        };

        const block = (stmts: readonly Stmt[], paths: Path[], where: Where, depth: number): Flow => {
            const ended: Path[] = [];
            let live = paths;
            for (const s of stmts) {
                const next: Path[] = [];
                for (const p of live) {
                    const f = statement(s, p, where, depth);
                    next.push(...f.live);
                    ended.push(...f.ended);
                }
                live = next;
                if (live.length + ended.length > MAX_PATHS) throw new TooManyPaths();
            }
            return { live, ended };
        };

        const statement = (s: Stmt, p: Path, where: Where, depth: number): Flow => {
            const { file } = where;
            const at = `${file}:${s.line}`;
            switch (s.t) {
                case 'set': {
                    const value = evaluate(s.value, p.env, file);
                    if (s.name === JOURNEY) {
                        if (!where.sailProc) reached.add(at);
                        if (value.t !== 'int') {
                            underived.add(`\`${s.text}\` (${at}): the route is not known offline`);
                            return { live: [], ended: [p] };
                        }
                        return { live: [{ ...p, journey: value.n }], ended: [] };
                    }
                    if (!s.name.startsWith('$')) return { live: [p], ended: [] };
                    return { live: [{ ...p, env: new Map(p.env).set(s.name, value) }], ended: [] };
                }
                case 'def': {
                    const env = new Map(p.env);
                    for (const name of s.names) env.set(name, unknown(name));
                    return { live: [{ ...p, env }], ended: [] };
                }
                case 'return':
                    return { live: [], ended: [p] };
                case 'if':
                    return merge(
                        block(s.yes, branch(p, assume(s.cond, true, p.env, file)), where, depth),
                        block(s.no, branch(p, assume(s.cond, false, p.env, file)), where, depth),
                    );
                case 'while':
                    underived.add(`\`${s.text}\` (${at}): a loop is not followed`);
                    return { live: [], ended: [p] };
                case 'switch': {
                    const subject = evaluate(s.subject, p.env, file);
                    const keyed = s.cases.filter(c => c.keys !== null);
                    const fallback = s.cases.find(c => c.keys === null);
                    const hits = keyed.map(c => c.keys!.map(k => equal(evaluate(k, p.env, file), subject)));
                    if (hits.every(h => h.every(x => x !== undefined))) {
                        const hit = keyed.find((_, i) => hits[i]!.includes(true));
                        if (hit) return block(hit.body, [p], where, depth);
                        return fallback ? block(fallback.body, [p], where, depth) : { live: [p], ended: [] };
                    }
                    // A subject not known offline: each case runs on its own condition, `subject = key`.
                    const is = (k: Expr, want: boolean) =>
                        assume(
                            {
                                t: 'bin',
                                op: '=',
                                l: s.subject,
                                r: k,
                                text: `${s.subject.text} = ${k.text}`,
                                line: s.line,
                            },
                            want,
                            p.env,
                            file,
                        );
                    const flows = keyed.map(c =>
                        block(
                            c.body,
                            branch(
                                p,
                                c.keys!.flatMap(k => is(k, true)),
                            ),
                            where,
                            depth,
                        ),
                    );
                    // No case matched: every key's condition fails.
                    const none = keyed
                        .flatMap(c => c.keys!)
                        .reduce<Cond[][]>((ways, k) => ways.flatMap(x => is(k, false).map(y => [...x, ...y])), [[]]);
                    const rest = branch(p, none);
                    return merge(
                        ...flows,
                        fallback ? block(fallback.body, rest, where, depth) : { live: rest, ended: [] },
                    );
                }
                case 'call':
                    break;
            }
            const { name } = s.call;
            const raw = s.call.args ?? [];
            if (name === 'p_telejump' || name === 'p_teleport') {
                if (p.journey === undefined) return { live: [p], ended: [] };
                const landing = raw[0] && evaluate(raw[0], p.env, file);
                // Inside a sail proc the move is its call; else this line.
                const source = where.sailProc && p.site ? p.site : at;
                if (landing?.t === 'coord') sailed.push({ path: p, landing, source });
                else underived.add(`\`${s.text}\` (${at}): the landing is not known offline`);
                return { live: [], ended: [p] };
            }
            if (name === 'inv_del' || name === 'inv_add') {
                const obj = nameOf(raw[1], p.env);
                if (nameOf(raw[0], p.env) !== 'inv' || !obj) return { live: [p], ended: [] };
                const count = raw[2] && evaluate(raw[2], p.env, file);
                const n = count?.t === 'int' ? count.n : count?.t === 'range' ? count.hi : undefined;
                if (n === undefined) {
                    underived.add(`\`${s.text}\` (${at}): the count is not known offline`);
                    return { live: [], ended: [p] };
                }
                if (obj === 'coins' && name === 'inv_del') {
                    const note =
                        count?.t === 'range'
                            ? [`the fare is random, ${count.lo} to ${count.hi} coins (${at}): it counts as ${count.hi}`]
                            : [];
                    const paid = new Map(p.paid).set('coins', [...(p.paid.get('coins') ?? []), at]);
                    return {
                        live: [{ ...p, fare: p.fare + n, fareNotes: [...p.fareNotes, ...note], paid }],
                        ended: [],
                    };
                }
                const sign = name === 'inv_del' ? 1 : -1;
                const taken = new Map(p.taken).set(obj, (p.taken.get(obj) ?? 0) + sign * n);
                const paid = sign > 0 ? new Map(p.paid).set(obj, [...(p.paid.get(obj) ?? []), at]) : p.paid;
                return { live: [{ ...p, taken, paid }], ended: [] };
            }
            const args = raw.map(a => evaluate(a, p.env, file));
            const target = name === 'jump' ? args[0] : undefined;
            const call = target
                ? target.t === 'name'
                    ? `@${target.v}`
                    : undefined
                : /^[@~]/.test(name)
                  ? name
                  : undefined;
            if (name === 'jump' && !call) {
                underived.add(`\`${s.text}\` (${at}): the label is not known offline`);
                return { live: [], ended: [p] };
            }
            // Any other command can't sail.
            if (!call) return { live: [p], ended: [] };
            const isLabel = call.startsWith('@');
            const callee = byCall.get(call);
            if (sailProcs.has(call)) reached.add(at);
            // It sails if its body can, or a label it is passed can (`@multi2` jumps to its label arguments).
            const passed = args.flatMap(a => {
                const label = a.t === 'name' ? byCall.get(`@${a.v}`) : undefined;
                return label ? [label] : [];
            });
            if (!callee || !(reaches.call(call) || passed.some(l => reaches.call(l.call)))) {
                // A proc that never sails returns to the script; a label never does.
                return isLabel ? { live: [], ended: [p] } : { live: [p], ended: [] };
            }
            const script = scriptOf(call, callee.file, callee.line, callee.body);
            if ('error' in script || depth >= MAX_DEPTH) {
                underived.add('error' in script ? script.error : `\`${s.text}\` (${at}) calls too deep`);
                return { live: [], ended: [p] };
            }
            const env = new Map(script.params.map((param, i) => [param, args[i] ?? unknown(param)]));
            const site = sailProcs.has(call) && !where.sailProc ? at : p.site;
            const flow = block(
                script.body,
                [{ ...p, env, ...(site ? { site } : {}) }],
                { file: script.file, sailProc: sailProcs.has(call) },
                depth + 1,
            );
            const out = [...flow.live, ...flow.ended];
            // A label is a jump: the script ends where it does. A proc returns, to the caller's locals.
            return isLabel ? { live: [], ended: out } : { live: out.map(q => ({ ...q, env: p.env })), ended: [] };
        };

        const script = scriptOf(`${trigger.file}:${trigger.line}`, trigger.file, trigger.line, trigger.body);
        if ('error' in script) underived.add(script.error);
        else
            try {
                const start: Path = {
                    env: new Map(),
                    conds: [],
                    fare: 0,
                    fareNotes: [],
                    taken: new Map(),
                    paid: new Map(),
                };
                block(script.body, [start], { file: script.file, sailProc: false }, 0);
            } catch (e) {
                if (!(e instanceof TooManyPaths)) throw e;
                underived.add(`too many paths: ${trigger.file}:${trigger.line} branches past ${MAX_PATHS} ways`);
                // Its sails are dropped, so the sites it reached are unread: the build fails on them.
                sailed.length = 0;
                reached.clear();
            }
        return { sailed, reached, underived };
    };
}

/**
 * The requirement set a sailed path needs and the lines that take what it pays (coins:<n> and each
 * consume:<obj>:<n>), or the quest window that keeps it out.
 */
function requirementsOf(p: Path): { requires: string[]; paidAt: string[] } | { window: string } {
    const window = p.conds.find(c => c.k === 'window');
    if (window) return { window: window.text };
    const reqs = new Set<string>();
    for (const c of p.conds) {
        if (c.k === 'req') reqs.add(c.req);
        else if (c.k === 'other') reqs.add(`other:${c.text}`);
        else if (c.k === 'coins' && c.n > p.fare) reqs.add(`other:${c.text}`);
    }
    const paidAt: string[] = [];
    if (p.fare > 0) {
        reqs.add(`coins:${p.fare}`);
        paidAt.push(...(p.paid.get('coins') ?? []));
    }
    for (const [obj, n] of p.taken)
        if (n > 0) {
            reqs.add(`consume:${obj}:${n}`);
            paidAt.push(...(p.paid.get(obj) ?? []));
            // Taking it means holding it.
            reqs.delete(`item:${obj}:held`);
        }
    return { requires: [...reqs], paidAt };
}

/** The coins a requirement set takes: its `coins:<n>`, 0 when it has none. */
export function fareOf(requires: readonly string[]): number {
    for (const r of requires) {
        const req = parseRequirement(r);
        if (req.kind === 'coins') return req.n;
    }
    return 0;
}

const tileOrder = (a: Tile, b: Tile): number => a.level - b.level || a.x - b.x || a.z - b.z;

/** Transports in written order: route, kind, npc, boarding tile, landing, requirements. */
export const byTransport = (a: Transport, b: Transport): number =>
    cmp(a.route ?? '', b.route ?? '') ||
    cmp(a.kind, b.kind) ||
    cmp(a.npc, b.npc) ||
    tileOrder(a.from, b.from) ||
    tileOrder(a.to, b.to) ||
    cmp(a.requires.join('\n'), b.requires.join('\n'));

/**
 * Every ship route the npc op triggers sell (sources/transports.ts header), one transport per boarding
 * npc spawn, landing and minimal requirement set, in byTransport order.
 */
export function deriveSails(input: SailInput): Sails {
    const reaches = sailReach(input.callables);
    const run = sailWalker(input, reaches);
    const routeOf = new Map<number, string>();
    for (const [name, c] of input.constants)
        if (c.at.startsWith(`${ROUTES_FILE}:`) && name.startsWith('^sail_') && /^\d+$/.test(c.value))
            routeOf.set(Number(c.value), name.slice('^sail_'.length));

    // An npc config's own op trigger runs over its category's for the same trigger, as for locs
    // (server/engine/src/engine/script/ScriptProvider.ts getByTrigger).
    const own = new Set(
        input.triggers.filter(t => t.on === 'npc' && !t.category).map(t => `${t.target} ${t.kind}npc${t.op}`),
    );
    const byConfig = new Map<string, { config: string; tile: Tile }[]>();
    for (const s of input.spawns) push(byConfig, s.config, s);
    const configsOf = (t: Trigger): string[] =>
        t.category
            ? [...input.npcConfigs]
                  .filter(([name, c]) => first(c, 'category') === t.target && !own.has(`${name} ${t.kind}npc${t.op}`))
                  .map(([name]) => name)
                  .sort(cmp)
            : [t.target];

    type Row = {
        base: Omit<Transport, 'requires' | 'fare' | 'paidAt' | 'notes'>;
        sets: { requires: string[]; paidAt: string[]; notes: string[] }[];
    };
    const rows = new Map<string, Row>();
    const windows = new Set<string>();
    const underived = new Set<string>();
    const reached = new Set<string>();
    for (const t of input.triggers) {
        if (t.on !== 'npc' || !/^[1-5]$/.test(t.op) || !reaches.body(t.body)) continue;
        for (const config of configsOf(t))
            for (const spawn of byConfig.get(config) ?? []) {
                const r = run(t, spawn);
                for (const u of r.underived) underived.add(`${config} (${t.file}:${t.line}): ${u}`);
                for (const at of r.reached) reached.add(at);
                for (const s of r.sailed) {
                    const route = s.path.journey === undefined ? undefined : routeOf.get(s.path.journey);
                    const name = route ?? `journey ${s.path.journey}`;
                    const req = requirementsOf(s.path);
                    if ('window' in req) {
                        windows.add(`${config} ${coordText(spawn.tile)} -> ${name}: ${req.window}`);
                        continue;
                    }
                    const to = { level: s.landing.level, x: s.landing.x, z: s.landing.z };
                    const key = `${config} ${coordText(spawn.tile)} -> ${coordText(to)} ${name}`;
                    let row = rows.get(key);
                    if (!row) {
                        const base = { kind: 'ship' as const, ...(route ? { route } : {}), npc: config };
                        row = {
                            base: { ...base, from: spawn.tile, to, source: s.source },
                            sets: [],
                        };
                        rows.set(key, row);
                    }
                    row.sets.push({
                        requires: req.requires,
                        paidAt: req.paidAt,
                        notes: [
                            ...(route ? [] : [`journey ${s.path.journey} is not a route in ${ROUTES_FILE}`]),
                            ...s.path.fareNotes,
                        ],
                    });
                }
            }
    }

    const transports: Transport[] = [];
    for (const { base, sets } of rows.values()) {
        const canonical = sets.map(s => ({ ...s, key: [...new Set(s.requires)].sort(cmp).join('\n') }));
        for (const requires of minimalSets(sets.map(s => s.requires))) {
            const key = requires.join('\n');
            const same = canonical.filter(s => s.key === key);
            const paidAt = [...new Set(same.flatMap(s => s.paidAt))].sort(cmp);
            const notes = [...new Set(same.flatMap(s => s.notes))];
            transports.push({
                ...base,
                fare: fareOf(requires),
                requires,
                ...(paidAt.length ? { paidAt } : {}),
                ...(notes.length ? { notes: notes.join('; ') } : {}),
            });
        }
    }
    transports.sort(byTransport);

    const used = new Set(transports.map(t => t.route));
    return {
        transports,
        windows: [...windows].sort(cmp),
        underived: [...underived].sort(cmp),
        unreached: sailSites(input.files, input.callables).filter(at => !reached.has(at)),
        unusedRoutes: [...new Set(routeOf.values())].filter(r => !used.has(r)).sort(cmp),
    };
}

/**
 * The unreached sail sites (Sails.unreached) less those listed out of scope (`listed`, `file:line`), and
 * the listed ones that are no longer unreached sites: gone from the scripts, or reached by an npc op.
 */
export function outOfScopeSites(
    unreached: readonly string[],
    listed: readonly string[],
): { unreached: string[]; stale: string[] } {
    const out = new Set(listed);
    const left = new Set(unreached);
    return {
        unreached: unreached.filter(at => !out.has(at)),
        stale: [...out].filter(at => !left.has(at)).sort(cmp),
    };
}

/** A curated transport (gates.ts CURATED_TRANSPORTS) as written there. */
export interface CuratedTransport {
    kind: Transport['kind'];
    npc: string;
    /** The landing, a coord literal as the script writes it. */
    to: string;
    fare: number;
    /** Canonical requirement strings (requirements.ts), the fare's coins:<n> among them. */
    requires: string[];
    /** The script line that makes the move, and those that take the fare. */
    source: string;
    paidAt: string[];
    notes: string;
}

/**
 * The curated transports as rows, one per spawn of each one's npc. Throws on an entry whose npc never
 * spawns, whose landing is not a coord literal, whose requirements are not canonical, or whose fare is
 * not its coins:<n>, so a curated row can't drift from the form the derived ones have.
 */
export function curatedTransports(
    entries: readonly CuratedTransport[],
    spawns: readonly { config: string; tile: Tile }[],
): Transport[] {
    return entries.flatMap(e => {
        const at = spawns.filter(s => s.config === e.npc);
        const requires = minimalSets([e.requires])[0]!;
        const fail = (why: string) => new Error(`curated transport ${e.npc} (${e.source}): ${why}`);
        if (!at.length) throw fail('the npc has no spawn');
        if (!isCoordLiteral(e.to)) throw fail(`${e.to} is not a coord literal`);
        if (requires.join('\n') !== e.requires.join('\n')) throw fail(`write requires as ${JSON.stringify(requires)}`);
        if (fareOf(requires) !== e.fare) throw fail(`fare ${e.fare} is not its coins:<n>`);
        return at.map(s => ({
            kind: e.kind,
            npc: e.npc,
            from: s.tile,
            to: coordTile(e.to),
            source: e.source,
            fare: e.fare,
            requires,
            paidAt: e.paidAt,
            notes: e.notes,
        }));
    });
}
