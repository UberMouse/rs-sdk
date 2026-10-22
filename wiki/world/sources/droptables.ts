// What an NPC drops per kill (phase 4 survey §1.8): the engine's death script for it, `[ai_queue3,<npc>]`, else its
// category's, else the global default (npc_combat.rs2:3, `npc_default_death`), run offline over every roll at once.
// Each path through the script carries its chance; a `random(n)` value is the set of whole numbers it can take, and a
// comparison splits it: `if ($random < 5)` sends 5/128 of the path one way with `$random` now 0-4, and the rest the
// other with 5-127. Each `obj_add` adds its path's chance times its count (the mean, for a rolled count) to the obj.
// Paths are under server/content/scripts/ unless they name the engine or the compiler; the engine is
// server/engine/src/engine, the compiler server/engine/node_modules/@lostcityrs/runescript/dist/runescript.js.
//
// Read as the engine runs them:
// - `random(n)` is 0 to n-1, each equally likely (script/handlers/NumberOps.ts:32-35: `nextDouble() * n`, truncated by
//   pushInt's toInt32, script/ScriptState.ts:304-305); `randominc(n)` is 0 to n (:37-40).
// - `map_members` is true (script/handlers/ServerOps.ts:20-22): bots play members worlds only.
// - `npc_findhero` is true: with one player fighting, the hero (the most damage) is that player.
// - `&` and `|` short-circuit: the compiler's generateCondition reads the right side only where the left did not settle
//   the condition.
// - A proc that ends without a `return` returns 0 for each `int` and -1 (null) for anything else, and a `def_<type>`
//   with no value holds the same (the compiler's generateDefaultReturns and visitDeclarationStatement): `~randomjewel`
//   past its last branch returns (null, 0).
// - `obj_add` of a null obj or a -1 count adds nothing (script/handlers/ObjOps.ts:20-25).
// Tertiary drops are left out: the `~trail_*` clue procs (`~trail_easycluedrop(128, npc_coord)`, drop
// tables/scripts/man.rs2:20-21; `gosub(trail_checkmediumdrop)`, chicken.rs2:11). So are the effects that drop nothing:
// `gosub(npc_death)` (the death animation and despawn, skill_combat/scripts/npc/npc_death.rs2:10-24), `npc_say`, `mes`
// and `session_log`. Anything else the evaluator can't settle is a ModelError naming its script line, raised only when
// the table that reaches it is asked for.
import { ModelError } from '../model/family';
import type { GameData } from '../model/families/common';
import { paramValue } from '../model/params';
import type { Tile } from '../types';
import { first } from './configs';
import { constantInt } from './constants';
import type { DbRow } from './dbrows';
import { scriptCache } from './evaluate';
import type { Expr, Script, Stmt } from './runescript';
import { blocks, parseCallables } from './triggers';

/** What a drop table can read about the player, beyond the members world. */
export interface DropContext {
    /** Objs worn, by config name: `inv_total(worn, ring_of_wealth)` counts them (shared_droptables.rs2:40). None by default. */
    worn?: readonly string[];
    /**
     * Varps by name without `%`, for a table that reads one (`%legendsquest`, shared_droptables.rs2:68). A table that
     * reads a varp not given here is a ModelError.
     */
    varps?: Readonly<Record<string, number>>;
    /**
     * The player's tile at the kill, for `coord` (`coordz(coord) > 6400`, shared_droptables.rs2:71). A table that reads
     * `coord` without it is a ModelError.
     */
    coord?: Tile;
}

export interface DropTable {
    npc: string;
    /** The death script the engine runs for it, `file:line`. */
    at: string;
    /** The expected count of each obj per kill, by obj config name, in name order. */
    counts: Map<string, number>;
}

/** An npc's drop table; throws a ModelError for an npc the game lacks or a script line the evaluator can't settle. */
export type DropTables = (npc: string, ctx?: DropContext) => DropTable;

/** A rolled whole number: the inclusive ranges it can be in, each value equally likely. */
type Ranges = [lo: number, hi: number][];

type Value =
    | { t: 'int'; n: number }
    | { t: 'roll'; ranges: Ranges }
    /** -1 for an obj or other config: `null`, a proc's default return (see the header). */
    | { t: 'null' }
    /** A bare name: an obj, an inventory (`worn`), a dbrow, a dbtable column (`drop_table:drop`), `npc_coord`. */
    | { t: 'name'; v: string }
    | { t: 'tile'; tile: Tile };

interface Path {
    /** The chance of reaching here, per kill. */
    p: number;
    /** The script's locals, by `$name`. */
    env: ReadonlyMap<string, Value>;
}

interface Ended extends Path {
    /** What a `return` returned; null for a path that ran off the end or returned nothing. */
    ret: Value[] | null;
}

interface Flow {
    live: Path[];
    ended: Ended[];
}

/** A value with the path it was computed on: a proc call or a tuple yields several values. */
interface Out {
    path: Path;
    vals: Value[];
}

const size = (r: Ranges): number => r.reduce((s, [lo, hi]) => s + hi - lo + 1, 0);
const set = (env: ReadonlyMap<string, Value>, name: string, v: Value): ReadonlyMap<string, Value> =>
    new Map(env).set(name, v);
const shift = (ranges: Ranges, k: number): Value => ({ t: 'roll', ranges: ranges.map(([lo, hi]) => [lo + k, hi + k]) });
const mean = (r: Ranges): number => r.reduce((s, [lo, hi]) => s + ((lo + hi) / 2) * (hi - lo + 1), 0) / size(r);

/** The whole numbers `x op k` holds for, as ranges. */
function allowed(op: string, k: number): Ranges {
    const inf = Number.MAX_SAFE_INTEGER;
    switch (op) {
        case '<':
            return [[-inf, k - 1]];
        case '<=':
            return [[-inf, k]];
        case '>':
            return [[k + 1, inf]];
        case '>=':
            return [[k, inf]];
        case '=':
            return [[k, k]];
        case '!':
            return [
                [-inf, k - 1],
                [k + 1, inf],
            ];
    }
    throw new Error(`no comparison ${op}`);
}

const NEGATE: Record<string, string> = { '<': '>=', '<=': '>', '>': '<=', '>=': '<', '=': '!', '!': '=' };
/** `k op x` as `x FLIP[op] k`. */
const FLIP: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=', '!': '!' };

function intersect(a: Ranges, b: Ranges): Ranges {
    const out: Ranges = [];
    for (const [alo, ahi] of a)
        for (const [blo, bhi] of b) {
            const lo = Math.max(alo, blo);
            const hi = Math.min(ahi, bhi);
            if (lo <= hi) out.push([lo, hi]);
        }
    return out.sort((x, y) => x[0] - y[0]);
}

function holds(op: string, a: number, b: number): boolean {
    return intersect([[a, a]], allowed(op, b)).length > 0;
}

/** Above this many steps of paths through one table the evaluator stops: no drop script comes near it. */
const MAX_STEPS = 100_000;

/** The scripts that drop nothing (see the header), by the name a `gosub` or a call statement gives. */
const NO_DROP = new Set(['npc_death', 'npc_say', 'mes', 'session_log']);
const tertiary = (name: string): boolean => name.replace(/^~/, '').startsWith('trail_');

export function readDropTables(
    data: Pick<GameData, 'npcs' | 'objs' | 'params' | 'constants' | 'scripts' | 'dbrows'>,
): DropTables {
    // `[ai_queue3,<subject>]` by subject (`giant`, `_chicken`, `_` for the global default), and the procs and labels.
    const deaths = new Map<string, { file: string; line: number; body: string }>();
    const callables = new Map<string, { file: string; line: number; body: string }>();
    for (const [file, text] of data.scripts) {
        for (const b of blocks(file, text)) {
            const m = b.header.match(/^\[ai_queue3,(_?[a-z0-9_]*)\]$/);
            if (m && !deaths.has(m[1]!)) deaths.set(m[1]!, b);
        }
        for (const c of parseCallables(file, text)) if (!callables.has(c.call)) callables.set(c.call, c);
    }
    const rows = new Map<string, DbRow>(data.dbrows.map(r => [r.row, r]));
    const parsed = scriptCache();

    return (npc, ctx = {}) => {
        const found = data.npcs.get(npc);
        if (!found) throw new ModelError(`no npc ${npc}`);
        const cfg = found;
        const what = `npc ${npc}'s drop table`;
        const category = first(cfg, 'category');
        // The npc's own trigger, else its category's, else the global one (engine/script/ScriptProvider.ts:124-134).
        const key = deaths.has(npc) ? npc : category !== undefined && deaths.has(`_${category}`) ? `_${category}` : '_';
        const death = deaths.get(key);
        if (!death) throw new ModelError(`${what}: the game has no [ai_queue3,${key}]`);

        const counts = new Map<string, number>();
        let steps = 0;

        const fail = (file: string, node: { text: string; line: number }, why: string): never => {
            throw new ModelError(`${what}: \`${node.text}\` (${file}:${node.line}) ${why}`);
        };
        const parse = (k: string, b: { file: string; line: number; body: string }): Script => {
            const s = parsed(k, b.file, b.line, b.body);
            if ('error' in s) throw new ModelError(`${what}: ${s.error}`);
            return s;
        };
        const fork = (path: Path, p: number, env = path.env): Path => {
            if (++steps > MAX_STEPS) throw new ModelError(`${what}: more than ${MAX_STEPS} steps of paths`);
            return { p, env };
        };

        /** A name, `^constant` or param value as a Value: a whole number, null, or a name. */
        const literal = (s: string, file: string, node: Expr): Value => {
            if (/^-?\d+$/.test(s)) return { t: 'int', n: Number(s) };
            if (s === 'null') return { t: 'null' };
            if (s.startsWith('^')) {
                const n = constantInt(data.constants, s);
                return n === undefined ? fail(file, node, `reads ${s}, which holds no whole number`) : { t: 'int', n };
            }
            return { t: 'name', v: s };
        };

        const int = (v: Value, file: string, node: Expr): number =>
            v.t === 'int' ? v.n : fail(file, node, `needs a known whole number, not a ${v.t}`);

        /** `l op r` for `+ - * /`: a roll may be shifted by a whole number, nothing more. */
        const arith = (op: string, l: Value, r: Value, file: string, node: Expr): Value => {
            if (l.t === 'int' && r.t === 'int') {
                if (op === '+') return { t: 'int', n: l.n + r.n };
                if (op === '-') return { t: 'int', n: l.n - r.n };
                if (op === '*') return { t: 'int', n: l.n * r.n };
                if (op === '/' && r.n !== 0) return { t: 'int', n: Math.trunc(l.n / r.n) };
            }
            if (l.t === 'roll' && r.t === 'int' && (op === '+' || op === '-'))
                return shift(l.ranges, op === '+' ? r.n : -r.n);
            if (l.t === 'int' && r.t === 'roll' && op === '+') return shift(r.ranges, l.n);
            return fail(file, node, `is arithmetic on a ${l.t} and a ${r.t}, which is not read`);
        };

        /** Every expression in order, each on every path the one before it left. */
        const evalAll = (exprs: readonly Expr[], path: Path, file: string): Out[] => {
            let outs: Out[] = [{ path, vals: [] }];
            for (const e of exprs)
                outs = outs.flatMap(o =>
                    evalExpr(e, o.path, file).map(r => ({ path: r.path, vals: [...o.vals, ...r.vals] })),
                );
            return outs;
        };

        /** One value from each path, as `evalAll` gives them. */
        const single = (outs: Out[], file: string, node: Expr): { path: Path; v: Value }[] =>
            outs.map(o =>
                o.vals.length === 1
                    ? { path: o.path, v: o.vals[0]! }
                    : fail(file, node, `gives ${o.vals.length} values`),
            );

        function evalExpr(e: Expr, path: Path, file: string): Out[] {
            if (e.t === 'num') return [{ path, vals: [{ t: 'int', n: e.n }] }];
            if (e.t === 'bin') {
                if (!['+', '-', '*', '/'].includes(e.op))
                    return fail(file, e, 'is a condition outside an if, which is not read');
                return evalAll([e.l, e.r], path, file).map(o => ({
                    path: o.path,
                    vals: [arith(e.op, o.vals[0]!, o.vals[1]!, file, e)],
                }));
            }
            if (e.t !== 'name') return fail(file, e, `is a ${e.t}, which is not read`);
            const { name, args } = e;
            const one = (v: Value): Out[] => [{ path, vals: [v] }];
            if (name.startsWith('$')) {
                const v = path.env.get(name);
                return v ? one(v) : fail(file, e, `reads ${name} before it is set`);
            }
            if (name.startsWith('%')) {
                const v = ctx.varps?.[name.slice(1)];
                return v === undefined
                    ? fail(file, e, `reads ${name}, which the context does not give`)
                    : one({ t: 'int', n: v });
            }
            if (name.startsWith('^')) return one(literal(name, file, e));
            if (name.startsWith('~')) return call(name, args ?? [], path, file, e);
            if (args === null) {
                if (name === 'map_members' || name === 'npc_findhero') return one({ t: 'int', n: 1 });
                if (name === 'npc_type') return one({ t: 'name', v: npc });
                if (name === 'coord')
                    return ctx.coord
                        ? one({ t: 'tile', tile: ctx.coord })
                        : fail(file, e, 'reads coord, which the context does not give');
                return one(literal(name, file, e));
            }
            const ofArgs = (f: (vals: Value[]) => Value): Out[] =>
                evalAll(args, path, file).map(o => ({ path: o.path, vals: [f(o.vals)] }));
            switch (name) {
                case 'random':
                case 'randominc':
                    return ofArgs(([n]) => {
                        const hi = int(n!, file, e) - (name === 'random' ? 1 : 0);
                        return hi < 0 ? fail(file, e, 'rolls an empty range') : { t: 'roll', ranges: [[0, hi]] };
                    });
                case 'calc':
                    return evalAll(args, path, file);
                case 'add':
                case 'sub':
                    return ofArgs(([l, r]) => arith(name === 'add' ? '+' : '-', l!, r!, file, e));
                case 'npc_param':
                    return ofArgs(([k]) =>
                        k?.t === 'name'
                            ? literal(paramValue(cfg, k.v, data, `npc ${npc}`), file, e)
                            : fail(file, e, 'names no param'),
                    );
                case 'inv_total':
                    return ofArgs(([inv, obj]) =>
                        inv?.t === 'name' && inv.v === 'worn' && obj?.t === 'name'
                            ? { t: 'int', n: (ctx.worn ?? []).filter(o => o === obj.v).length }
                            : fail(file, e, 'counts an inventory other than worn, which the context does not give'),
                    );
                case 'coordx':
                case 'coordy':
                case 'coordz':
                    return ofArgs(([c]) => {
                        if (c?.t !== 'tile') return fail(file, e, 'reads the coord of no tile');
                        return {
                            t: 'int',
                            n: name === 'coordx' ? c.tile.x : name === 'coordz' ? c.tile.z : c.tile.level,
                        };
                    });
                case 'db_getfield':
                case 'db_getfieldcount':
                    return evalAll(args, path, file).map(o => ({ path: o.path, vals: dbField(name, o.vals, file, e) }));
            }
            return fail(file, e, `calls ${name}, which is not read`);
        }

        /** `db_getfield(row, table:column, i)`: the column's i-th tuple; `db_getfieldcount`: how many it has. */
        function dbField(name: string, vals: Value[], file: string, e: Expr): Value[] {
            const [row, col, i] = vals;
            const r = row?.t === 'name' ? rows.get(row.v) : undefined;
            const [table, column] = col?.t === 'name' ? col.v.split(':') : [];
            if (!r || r.table !== table || !column) return fail(file, e, 'reads no dbrow column the game has');
            const tuples = r.data[column] ?? [];
            if (name === 'db_getfieldcount') return [{ t: 'int', n: tuples.length }];
            const tuple = tuples[int(i!, file, e)];
            return tuple
                ? tuple.map(s => literal(s, file, e))
                : fail(file, e, `reads past the ${tuples.length} values of ${column}`);
        }

        /** A proc (`~name`) or label (`@name`) run on `args`: each path out, with what it returned. */
        function call(name: string, args: readonly Expr[], path: Path, file: string, node: Expr): Out[] {
            const c = callables.get(name);
            if (!c) return fail(file, node, `calls ${name}, which the game does not have`);
            const script = parse(name, c);
            // The return types follow the parameter list in the header's tail: `()(namedobj, int)`.
            const types =
                c.body
                    .match(/^\s*\([^)]*\)\s*\(([^)]*)\)/)?.[1]
                    ?.split(',')
                    .map(s => s.trim()) ?? [];
            const defaults: Value[] = types.map(t => (t === 'int' ? { t: 'int', n: 0 } : { t: 'null' }));
            return evalAll(args, path, file).flatMap(o => {
                if (o.vals.length !== script.params.length)
                    return fail(file, node, `passes ${o.vals.length} values to ${script.params.length} parameters`);
                const env = new Map(script.params.map((p, i) => [p, o.vals[i]!]));
                const flow = run(script.body, [fork(o.path, o.path.p, env)], c.file);
                return [...flow.live.map(p => ({ ...p, ret: null })), ...flow.ended].map(end => ({
                    path: fork(o.path, end.p),
                    vals: end.ret ?? defaults,
                }));
            });
        }

        /** The paths on which `cond` holds and those on which it fails. */
        function split(cond: Expr, path: Path, file: string): { yes: Path[]; no: Path[] } {
            if (cond.t === 'bin' && (cond.op === '&' || cond.op === '|')) {
                const left = split(cond.l, path, file);
                const and = cond.op === '&';
                // The right side runs only where the left did not settle it (see the header).
                const rights = (and ? left.yes : left.no).map(p => split(cond.r, p, file));
                const settled = and ? left.no : left.yes;
                return and
                    ? { yes: rights.flatMap(r => r.yes), no: [...settled, ...rights.flatMap(r => r.no)] }
                    : { yes: [...settled, ...rights.flatMap(r => r.yes)], no: rights.flatMap(r => r.no) };
            }
            if (cond.t !== 'bin' || !(cond.op in NEGATE)) return fail(file, cond, 'is no comparison');
            const yes: Path[] = [];
            const no: Path[] = [];
            for (const o of evalAll([cond.l, cond.r], path, file)) {
                const [l, r] = o.vals as [Value, Value];
                if (l.t === 'roll' || r.t === 'roll') {
                    const [roll, k, op] =
                        l.t === 'roll' ? [l, r, cond.op] : [r as Value & { t: 'roll' }, l, FLIP[cond.op]!];
                    const n = int(k, file, cond);
                    const all = size(roll.ranges);
                    for (const [out, o2] of [
                        [yes, op],
                        [no, NEGATE[op]!],
                    ] as const) {
                        const ranges = intersect(roll.ranges, allowed(o2, n));
                        if (!ranges.length) continue;
                        // Every local holding this roll (the same object, copies included) stays narrowed on the
                        // paths it split: the next else-if sees the rest.
                        const narrowed: Value = { t: 'roll', ranges };
                        let env = o.path.env;
                        for (const [name, v] of env) if (v === roll) env = set(env, name, narrowed);
                        out.push(fork(o.path, (o.path.p * size(ranges)) / all, env));
                    }
                    continue;
                }
                let truth: boolean;
                if (l.t === 'int' && r.t === 'int') truth = holds(cond.op, l.n, r.n);
                else if ((cond.op === '=' || cond.op === '!') && l.t !== 'tile' && r.t !== 'tile') {
                    // An int -1 is null: a proc's default return compared with `null`.
                    const id = (v: Value) =>
                        v.t === 'name'
                            ? v.v
                            : v.t === 'null' || (v.t === 'int' && v.n === -1)
                              ? null
                              : `#${v.t === 'int' ? v.n : ''}`;
                    truth = (id(l) === id(r)) === (cond.op === '=');
                } else return fail(file, cond, `compares a ${l.t} with a ${r.t}`);
                (truth ? yes : no).push(o.path);
            }
            return { yes, no };
        }

        /** `obj_add(coord, obj, count, duration)`: the path's chance times the count (its mean when rolled). */
        function objAdd(vals: Value[], path: Path, file: string, s: Stmt): void {
            if (vals.length !== 4) return fail(file, s, `gives obj_add ${vals.length} values`);
            const [, obj, count] = vals as [Value, Value, Value];
            if (obj.t === 'null' || (obj.t === 'int' && obj.n === -1) || (count.t === 'int' && count.n === -1)) return;
            if (obj.t !== 'name') return fail(file, s, `adds a ${obj.t}, not an obj`);
            // The packer makes `cert_<obj>`, the noted obj, for any obj it names (tools/pack/config/ObjConfig.ts:212-216).
            if (!data.objs.has(obj.v.replace(/^cert_/, '')))
                return fail(file, s, `adds ${obj.v}, which the game does not have`);
            const n =
                count.t === 'int' ? count.n : count.t === 'roll' ? mean(count.ranges) : fail(file, s, 'adds no count');
            counts.set(obj.v, (counts.get(obj.v) ?? 0) + path.p * n);
        }

        function stmt(s: Stmt, path: Path, file: string): Flow {
            switch (s.t) {
                case 'return':
                    return { live: [], ended: evalAll(s.values, path, file).map(o => ({ ...o.path, ret: o.vals })) };
                case 'if': {
                    const { yes, no } = split(s.cond, path, file);
                    const a = run(s.yes, yes, file);
                    const b = run(s.no, no, file);
                    return { live: [...a.live, ...b.live], ended: [...a.ended, ...b.ended] };
                }
                case 'switch': {
                    const out: Flow = { live: [], ended: [] };
                    for (const { path: p, v } of single(evalExpr(s.subject, path, file), file, s.subject)) {
                        if (v.t !== 'roll' && v.t !== 'int') return fail(file, s, 'switches on no whole number');
                        let rest: Ranges = v.t === 'roll' ? v.ranges : [[v.n, v.n]];
                        const all = size(rest);
                        for (const c of [...s.cases.filter(x => x.keys), ...s.cases.filter(x => !x.keys)]) {
                            const keys = c.keys?.map(k => int(single(evalExpr(k, p, file), file, k)[0]!.v, file, k));
                            const taken = keys
                                ? intersect(
                                      rest,
                                      keys.flatMap(k => allowed('=', k)),
                                  )
                                : rest;
                            if (keys) rest = keys.reduce((r, k) => intersect(r, allowed('!', k)), rest);
                            if (!taken.length) continue;
                            const f = run(c.body, [fork(p, (p.p * size(taken)) / all)], file);
                            out.live.push(...f.live);
                            out.ended.push(...f.ended);
                        }
                        // A value no case takes, with no default, runs on past the switch.
                        if (size(rest) && !s.cases.some(c => !c.keys)) out.live.push(fork(p, (p.p * size(rest)) / all));
                    }
                    return out;
                }
                case 'while': {
                    const out: Flow = { live: [], ended: [] };
                    let looping = [path];
                    for (let i = 0; looping.length; i++) {
                        if (i > 1000) return fail(file, s, 'loops more than 1000 times');
                        const next: Path[] = [];
                        for (const p of looping) {
                            const { yes, no } = split(s.cond, p, file);
                            out.live.push(...no);
                            const f = run(s.body, yes, file);
                            next.push(...f.live);
                            out.ended.push(...f.ended);
                        }
                        looping = next;
                    }
                    return out;
                }
                case 'set':
                    if (!s.name.startsWith('$')) return fail(file, s, `sets ${s.name}, which is not read`);
                    return {
                        live: single(evalExpr(s.value, path, file), file, s.value).map(o =>
                            fork(o.path, o.path.p, set(o.path.env, s.name, o.v)),
                        ),
                        ended: [],
                    };
                case 'def': {
                    if (!s.value) {
                        // `def_int $x;` holds 0, any other type -1 (see the header).
                        const v: Value = s.text.startsWith('def_int ') ? { t: 'int', n: 0 } : { t: 'null' };
                        return { live: [fork(path, path.p, set(path.env, s.names[0]!, v))], ended: [] };
                    }
                    const live = evalAll([s.value], path, file).map(o => {
                        if (o.vals.length !== s.names.length)
                            return fail(file, s, `sets ${s.names.length} locals from ${o.vals.length} values`);
                        let env = o.path.env;
                        s.names.forEach((n, i) => (env = set(env, n, o.vals[i]!)));
                        return fork(o.path, o.path.p, env);
                    });
                    return { live, ended: [] };
                }
                case 'call': {
                    const { name, args } = s.call;
                    const target = name === 'gosub' ? args?.[0] : undefined;
                    const proc = target?.t === 'name' ? target.name : undefined;
                    if (NO_DROP.has(proc ?? name) || tertiary(proc ?? name)) return { live: [path], ended: [] };
                    if (proc) return { live: call(`~${proc}`, [], path, file, s.call).map(o => o.path), ended: [] };
                    if (name.startsWith('~'))
                        return { live: call(name, args ?? [], path, file, s.call).map(o => o.path), ended: [] };
                    // A jump: the label runs in place of the rest of the script, and returns nothing to it.
                    if (name.startsWith('@'))
                        return {
                            live: [],
                            ended: call(name, args ?? [], path, file, s.call).map(o => ({ ...o.path, ret: null })),
                        };
                    if (name === 'obj_add') {
                        for (const o of evalAll(args ?? [], path, file)) objAdd(o.vals, o.path, file, s);
                        return { live: [path], ended: [] };
                    }
                    return fail(file, s, `calls ${name}, which is not read`);
                }
            }
        }

        function run(stmts: readonly Stmt[], start: Path[], file: string): Flow {
            const out: Flow = { live: start, ended: [] };
            for (const s of stmts) {
                const next = out.live.map(p => stmt(s, p, file));
                out.live = next.flatMap(f => f.live);
                out.ended.push(...next.flatMap(f => f.ended));
            }
            return out;
        }

        run(parse(`ai_queue3 ${key}`, death).body, [{ p: 1, env: new Map() }], death.file);
        return {
            npc,
            at: `${death.file}:${death.line}`,
            counts: new Map([...counts].filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
        };
    };
}
