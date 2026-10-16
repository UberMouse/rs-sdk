// Where each ladder and staircase puts the player: the landings of every `connector` feature (a loc with an
// op trigger under scripts/ladders+stairs/, classify.ts), read from its op scripts by running them offline
// for that one loc. The scripts pick a landing three ways (ladders+stairs/scripts/ladders.rs2, stairs.rs2):
// a jump relative to the player's tile or the loc's (`~climb_ladder(movecoord(coord(), 0, 1, 0), true)`,
// per op or per `switch_int (loc_angle)`); a table keyed by the loc's tile (`switch_coord (loc_coord) { case
// 0_50_50_4_7 : p_telejump(1_50_50_5_9); ... }`); and a label several locs call with their coords
// (`@stair_options(<up>, <down>)`). A small parser reads the RuneScript those use, and an evaluator runs a
// trigger with `loc_coord` and `loc_angle` known and the player's `coord` symbolic. A condition it can't
// settle (a dialog choice, a quest varp) is taken both ways, so an op can have several landings; a
// landing it can't compute, or an op that never moves the player, is reported with the construct that
// stopped it, never guessed.
import { codeOf } from '../classify';
import { footprint, reachTiles, type SiteCollision, type SiteOptions } from '../place';
import type { Connector, Feature, Tile } from '../types';
import { cmp, push } from '../util';
import { first, type Config } from './configs';
import type { Callable, Trigger } from './triggers';

/** The script directory whose op triggers make a loc a connector (classify.ts). */
const DIR = 'ladders+stairs/';

/** z from which a level-0 tile is underground: those areas are drawn at the surface's x and z + 6400. */
export const UNDERGROUND_Z = 6400;

/**
 * How near (Chebyshev, in tiles) a way back must be: a connector on the landing's level within this of
 * the landing, whose own landing is within this of the first loc. Nearness only, no walk between them is
 * checked. The furthest-apart pair is 4 tiles (the Yanille dungeon stairs, stairs.rs2 yanillestairsdown
 * and yanillestairsup); past 5 the nearest candidates are other ladders, whose partners are missing.
 * So two unrelated connectors that near each other's landings can falsely pair, and hide a one-way one.
 */
export const WAY_BACK = 5;

/** How near a loc's footprint another connector's landing must be to count as an arrival there. */
const ARRIVAL = 2;

/** Bounds label and proc calls, so a cycle can't recurse forever. */
const MAX_DEPTH = 12;

/**
 * Bounds the paths one op's run follows: each condition not settled offline doubles them. Past it the op
 * is underived ("too many paths"), its landings dropped rather than a partial set kept. The scripts
 * reach at most 3.
 */
export const MAX_PATHS = 64;

export interface ConnectorCollision extends SiteCollision {
    /**
     * The tile's zone is in the collision data: sdk/pathfinding.ts initPathfinding allocates every
     * empty mainland zone as open so its search can cross gaps, and those zones are not land.
     */
    land(level: number, x: number, z: number): boolean;
}

/** A connector op whose landing the scripts don't give offline. */
export interface Underived {
    feature: number;
    loc: Tile;
    config: string;
    /** 1-5; 0 when the config has no trigger under ladders+stairs/ at all. */
    op: number;
    /** The construct that stopped it, with its script line. */
    reason: string;
}

export interface ConnectorInput {
    features: readonly Feature[];
    triggers: readonly Trigger[];
    callables: readonly Callable[];
    locConfigs: ReadonlyMap<string, Config>;
    collision: ConnectorCollision;
    size: SiteOptions['size'];
}

export interface Connectors {
    connectors: Connector[];
    underived: Underived[];
    /** Indexes into `connectors` of those with no connector back (WAY_BACK). */
    oneWay: number[];
}

// ---- Tokens and syntax ------------------------------------------------------------------------------

interface Token {
    k: 'coord' | 'num' | 'name' | 'str' | 'punct';
    v: string;
    line: number;
    at: number;
    end: number;
}

/** A construct the parser does not read, at a line of its script. */
class ParseError extends Error {
    constructor(
        readonly line: number,
        message: string,
    ) {
        super(message);
    }
}

// Whitespace, a coord literal (level_mx_mz_x_z), a number, a name (`$local`, `%varp`, `^constant`,
// `~proc`, `@label` or a command), a string, an operator or bracket.
const TOKEN =
    /\s+|(\d+_\d+_\d+_\d+_\d+)|(\d+)|([$%^~@]?[A-Za-z_][A-Za-z0-9_]*)|("(?:[^"\\]|\\.)*")|(<=|>=|[(){},;:=!<>&|+\-*/])/y;

function tokenize(code: string, firstLine: number): Token[] {
    const out: Token[] = [];
    let line = firstLine;
    for (let at = 0; at < code.length;) {
        TOKEN.lastIndex = at;
        const m = TOKEN.exec(code);
        if (!m) throw new ParseError(line, `\`${code[at]}\``);
        const k = m[1] ? 'coord' : m[2] ? 'num' : m[3] ? 'name' : m[4] ? 'str' : m[5] ? 'punct' : undefined;
        if (k) out.push({ k, v: m[0], line, at, end: at + m[0].length });
        line += m[0].split('\n').length - 1;
        at += m[0].length;
    }
    return out;
}

/** A packed coord literal, level_mx_mz_x_z, as a tile: x = 64 * mx + x, z = 64 * mz + z. */
export function coordTile(literal: string): Tile {
    const [level, mx, mz, x, z] = literal.split('_').map(Number) as [number, number, number, number, number];
    return { level, x: mx * 64 + x, z: mz * 64 + z };
}

/** A tile as a coord literal, as the scripts' `case` keys write it. */
export const tileCoord = (t: Tile): string => `${t.level}_${t.x >> 6}_${t.z >> 6}_${t.x & 63}_${t.z & 63}`;

interface Node {
    /** The source text, whitespace collapsed. */
    text: string;
    line: number;
}

type Expr = Node &
    (
        | { t: 'num'; n: number }
        | { t: 'coord'; tile: Tile }
        | { t: 'str' }
        /** A local, varp, constant, command or call; `args` null when written without parentheses. */
        | { t: 'name'; name: string; args: Expr[] | null }
        | { t: 'bin'; op: string; l: Expr; r: Expr }
    );

interface Case {
    /** null for `case default`. */
    keys: Expr[] | null;
    body: Stmt[];
}

type Stmt = Node &
    (
        | { t: 'switch'; subject: Expr; cases: Case[] }
        | { t: 'if'; cond: Expr; yes: Stmt[]; no: Stmt[] }
        | { t: 'return' }
        | { t: 'set'; name: string; value: Expr }
        | { t: 'call'; call: Expr & { t: 'name' } }
    );

const COMPARE = new Set(['=', '!', '<', '>', '<=', '>=']);

/**
 * A recursive-descent parser for the RuneScript the connector scripts use: `switch_*` with `case` lists,
 * `if`/`else`, `def_*` and `$local =`, `return`, and call statements; expressions are calls, names,
 * numbers, coords, strings and comparisons joined by `&` and `|`. Anything else (a `while` loop,
 * arithmetic) is a ParseError naming its line.
 */
class Parser {
    private i = 0;

    constructor(
        private readonly toks: Token[],
        private readonly code: string,
    ) {}

    /** The statements up to the end of the tokens. */
    script(): Stmt[] {
        return this.block(() => false);
    }

    /** The `(type $name, ...)` list a label or proc body starts with. */
    params(): string[] {
        if (this.peek()?.v !== '(') return [];
        const out: string[] = [];
        for (let t = this.next(); t.v !== ')'; t = this.next()) if (t.v.startsWith('$')) out.push(t.v);
        return out;
    }

    private peek(ahead = 0): Token | undefined {
        return this.toks[this.i + ahead];
    }

    private next(): Token {
        const t = this.toks[this.i++];
        if (!t) throw new ParseError(this.toks.at(-1)?.line ?? 0, 'the script ends mid-statement');
        return t;
    }

    private is(v: string): boolean {
        return this.peek()?.v === v;
    }

    private expect(v: string): Token {
        const t = this.next();
        if (t.v !== v) throw this.error(t);
        return t;
    }

    /** The source line a token is on, as the construct a ParseError names. */
    private error(t: Token): ParseError {
        const start = this.code.lastIndexOf('\n', t.at - 1) + 1;
        const end = this.code.indexOf('\n', t.at);
        return new ParseError(t.line, `\`${this.code.slice(start, end < 0 ? undefined : end).trim()}\``);
    }

    private text(from: Token): string {
        return this.code.slice(from.at, this.toks[this.i - 1]!.end).replace(/\s+/g, ' ');
    }

    private block(stop: (t: Token) => boolean): Stmt[] {
        const out: Stmt[] = [];
        for (let t = this.peek(); t && !stop(t); t = this.peek()) {
            if (t.v === ';') this.i++;
            else out.push(this.statement());
        }
        return out;
    }

    private braced(): Stmt[] {
        this.expect('{');
        const body = this.block(t => t.v === '}');
        this.expect('}');
        return body;
    }

    private statement(): Stmt {
        const t = this.peek()!;
        if (t.k !== 'name') throw this.error(t);
        if (t.v.startsWith('switch_')) return this.switch();
        if (t.v === 'if') return this.if();
        if (t.v === 'return') {
            this.i++;
            if (this.is('(')) {
                this.next();
                this.expr();
                this.expect(')');
            }
            this.expect(';');
            return { t: 'return', text: 'return', line: t.line };
        }
        const def = t.v.startsWith('def_');
        if (def || (t.v.startsWith('$') && this.peek(1)?.v === '=')) {
            if (def) this.i++;
            const name = this.next();
            if (!name.v.startsWith('$')) throw this.error(name);
            this.expect('=');
            const value = this.expr();
            this.expect(';');
            return { t: 'set', name: name.v, value, text: this.text(t), line: t.line };
        }
        if (this.peek(1)?.v !== '(' && this.peek(1)?.v !== ';') throw this.error(t);
        const call = this.primary();
        this.expect(';');
        if (call.t !== 'name') throw this.error(t);
        return { t: 'call', call, text: call.text, line: t.line };
    }

    private switch(): Stmt {
        const start = this.next();
        this.expect('(');
        const subject = this.expr();
        this.expect(')');
        this.expect('{');
        const cases: Case[] = [];
        while (!this.is('}')) {
            this.expect('case');
            let keys: Expr[] | null = null;
            if (this.is('default')) this.next();
            else {
                keys = [this.expr()];
                while (this.is(',')) {
                    this.next();
                    keys.push(this.expr());
                }
            }
            this.expect(':');
            cases.push({ keys, body: this.block(t => t.v === 'case' || t.v === '}') });
        }
        this.expect('}');
        return { t: 'switch', subject, cases, text: `${start.v} (${subject.text})`, line: start.line };
    }

    private if(): Stmt {
        const start = this.expect('if');
        this.expect('(');
        const cond = this.expr();
        this.expect(')');
        const yes = this.braced();
        let no: Stmt[] = [];
        if (this.is('else')) {
            this.next();
            no = this.is('if') ? [this.if()] : this.braced();
        }
        return { t: 'if', cond, yes, no, text: `if (${cond.text})`, line: start.line };
    }

    private expr(): Expr {
        return this.binary(0);
    }

    // Lowest first: `|`, `&`, then the comparisons.
    private binary(level: number): Expr {
        if (level === 3) return this.primary();
        const start = this.peek()!;
        let l = this.binary(level + 1);
        const joins = (v: string) => (level === 0 ? v === '|' : level === 1 ? v === '&' : COMPARE.has(v));
        while (this.peek() && joins(this.peek()!.v)) {
            const op = this.next().v;
            const r = this.binary(level + 1);
            l = { t: 'bin', op, l, r, text: this.text(start), line: start.line };
        }
        return l;
    }

    private primary(): Expr {
        const t = this.next();
        if (t.v === '(') {
            const e = this.expr();
            this.expect(')');
            return e;
        }
        if (t.v === '-' && this.peek()?.k === 'num')
            return { t: 'num', n: -Number(this.next().v), text: this.text(t), line: t.line };
        if (t.k === 'num') return { t: 'num', n: Number(t.v), text: t.v, line: t.line };
        if (t.k === 'coord') return { t: 'coord', tile: coordTile(t.v), text: t.v, line: t.line };
        if (t.k === 'str') return { t: 'str', text: t.v, line: t.line };
        if (t.k !== 'name') throw this.error(t);
        let args: Expr[] | null = null;
        if (this.is('(')) {
            this.next();
            args = [];
            while (!this.is(')')) {
                if (args.length) this.expect(',');
                args.push(this.expr());
            }
            this.next();
        }
        return { t: 'name', name: t.v, args, text: this.text(t), line: t.line };
    }
}

interface Script {
    file: string;
    params: string[];
    body: Stmt[];
}

/** A trigger's or callable's body parsed, or the construct that stopped the parser. */
function parseScript(file: string, line: number, raw: string): Script | { error: string } {
    const code = codeOf(raw);
    try {
        const p = new Parser(tokenize(code, line), code);
        const params = p.params();
        return { file, params, body: p.script() };
    } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        return { error: `${e.message} (${file}:${e.line}) is not read` };
    }
}

// ---- Evaluation -------------------------------------------------------------------------------------

/** A coord the script computed: a tile, or (`relative`) a shift of the player's tile. */
interface CoordValue {
    t: 'coord';
    relative: boolean;
    level: number;
    x: number;
    z: number;
    /** The script line it was written on, as `file:line`. */
    at: string;
}

type Value = { t: 'int'; n: number } | { t: 'bool'; b: boolean } | CoordValue | { t: 'unknown'; text: string };

/** What one placed loc's op does: its landings, and why a path through it lands nowhere. */
interface Run {
    landings: CoordValue[];
    /**
     * Landings the evaluator can't compute: the call and what is unknown. A set, as several paths can
     * reach one call: each reason once, in the order first met.
     */
    unknown: Set<string>;
    /** Why each path that never moved the player stopped, when none did. */
    dead: string[];
}

interface Path {
    env: ReadonlyMap<string, Value>;
    notes: readonly string[];
}

/** A path the evaluator can't follow past an expression (a proc that can move the player, as a value). */
class Unfollowed extends Error {}

/** An op whose run passed MAX_PATHS. */
class TooManyPaths extends Error {}

interface Flow {
    /** Paths that run on past the statement. */
    live: Path[];
    /** Paths that ended the script in it (a `return`, or a label jumped to). */
    ended: Path[];
}

const unknown = (text: string): Value => ({ t: 'unknown', text });

/** Where a node is, as `file:line`. */
const at = (file: string, n: Node): string => `${file}:${n.line}`;

const merge = (...flows: Flow[]): Flow => ({
    live: flows.flatMap(f => f.live),
    ended: flows.flatMap(f => f.ended),
});

/** Whether two values are equal; undefined when either isn't known. */
function equal(a: Value, b: Value): boolean | undefined {
    if (a.t === 'int' && b.t === 'int') return a.n === b.n;
    if (a.t === 'bool' && b.t === 'bool') return a.b === b.b;
    if (a.t === 'coord' && b.t === 'coord' && !a.relative && !b.relative)
        return a.level === b.level && a.x === b.x && a.z === b.z;
    return undefined;
}

const MOVES = /\b(?:p_telejump|p_teleport)\s*\(/;
const CALL = /[@~][a-z0-9_]+|\bjump\(\s*([a-z0-9_]+)/g;

/** Runs connector op scripts for one loc at a time, over the triggers' callables. */
function evaluator(callables: readonly Callable[]): (trigger: Trigger, loc: Tile, angle: number) => Run {
    const byCall = new Map(callables.map(c => [c.call, c]));
    const parsed = new Map<string, Script | { error: string }>();
    const scriptOf = (key: string, file: string, line: number, raw: string) => {
        let s = parsed.get(key);
        if (!s) parsed.set(key, (s = parseScript(file, line, raw)));
        return s;
    };

    // Whether a callable, or one it calls, moves the player: the others (mes, an npc's taunt) can't
    // change a landing and are passed over without parsing.
    const moving = new Map<string, boolean>();
    const moves = (call: string): boolean => {
        const known = moving.get(call);
        if (known !== undefined) return known;
        const seen = new Set([call]);
        const queue = [call];
        let found = false;
        while (queue.length && !found) {
            const c = byCall.get(queue.shift()!);
            if (!c) continue;
            const code = codeOf(c.body);
            if (MOVES.test(code)) found = true;
            for (const m of code.matchAll(CALL)) {
                const next = m[1] ? `@${m[1]}` : m[0];
                if (!seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        moving.set(call, found);
        return found;
    };

    return (trigger, loc, angle) => {
        const run: Run = { landings: [], unknown: new Set(), dead: [] };

        const evaluate = (e: Expr, env: ReadonlyMap<string, Value>, file: string): Value => {
            switch (e.t) {
                case 'num':
                    return { t: 'int', n: e.n };
                case 'coord':
                    return { t: 'coord', relative: false, ...e.tile, at: at(file, e) };
                case 'str':
                    return unknown(e.text);
                case 'bin': {
                    const [l, r] = [evaluate(e.l, env, file), evaluate(e.r, env, file)];
                    if (e.op === '&' || e.op === '|') {
                        const short = e.op === '|';
                        if ((l.t === 'bool' && l.b === short) || (r.t === 'bool' && r.b === short))
                            return { t: 'bool', b: short };
                        return l.t === 'bool' && r.t === 'bool' ? { t: 'bool', b: !short } : unknown(e.text);
                    }
                    if (e.op === '=' || e.op === '!') {
                        const same = equal(l, r);
                        return same === undefined ? unknown(e.text) : { t: 'bool', b: same === (e.op === '=') };
                    }
                    if (l.t !== 'int' || r.t !== 'int') return unknown(e.text);
                    const b = { '<': l.n < r.n, '>': l.n > r.n, '<=': l.n <= r.n, '>=': l.n >= r.n }[e.op];
                    return b === undefined ? unknown(e.text) : { t: 'bool', b };
                }
                case 'name':
                    break;
            }
            const args = e.args ?? [];
            if (e.name.startsWith('$')) {
                const v = env.get(e.name);
                return v && v.t !== 'unknown' ? v : unknown(e.name);
            }
            // Engine commands (server/engine/src/engine/script/handlers): COORD is the player's tile
            // (PlayerOps.ts), LOC_COORD and LOC_ANGLE the active loc's (LocOps.ts), and MOVECOORD adds
            // (x, level, z) to a coord (ServerOps.ts).
            if (e.name === 'coord' && !args.length)
                return { t: 'coord', relative: true, level: 0, x: 0, z: 0, at: at(file, e) };
            if (e.name === 'loc_coord' && !args.length) return { t: 'coord', relative: false, ...loc, at: at(file, e) };
            if (e.name === 'loc_angle' && !args.length) return { t: 'int', n: angle };
            if ((e.name === 'true' || e.name === 'false') && e.args === null)
                return { t: 'bool', b: e.name === 'true' };
            if (e.name === 'movecoord' && args.length === 4) {
                const [base, dx, dlevel, dz] = args.map(a => evaluate(a, env, file)) as [Value, Value, Value, Value];
                const off = [dx, dlevel, dz];
                const stuck = [base, ...off].find(v => v.t === 'unknown');
                if (stuck) return stuck;
                if (base.t !== 'coord' || !off.every(v => v.t === 'int')) return unknown(e.text);
                const [x, level, z] = off.map(v => (v as { n: number }).n) as [number, number, number];
                return { ...base, level: base.level + level, x: base.x + x, z: base.z + z, at: at(file, e) };
            }
            // A proc's value isn't computed: one that can move the player would land somewhere unseen.
            if (e.name.startsWith('~') && moves(e.name))
                throw new Unfollowed(`\`${e.text}\` (${at(file, e)}) moves the player inside a value`);
            return unknown(e.text);
        };

        const block = (stmts: readonly Stmt[], paths: Path[], file: string, depth: number): Flow => {
            const ended: Path[] = [];
            let live = paths;
            for (const s of stmts) {
                const next: Path[] = [];
                for (const p of live) {
                    let f: Flow;
                    try {
                        f = statement(s, p, file, depth);
                    } catch (e) {
                        if (!(e instanceof Unfollowed)) throw e;
                        // That path ends unfollowed; the others still run.
                        run.unknown.add(e.message);
                        f = { live: [], ended: [p] };
                    }
                    next.push(...f.live);
                    ended.push(...f.ended);
                }
                live = next;
                if (live.length + ended.length > MAX_PATHS) throw new TooManyPaths();
            }
            return { live, ended };
        };

        const statement = (s: Stmt, p: Path, file: string, depth: number): Flow => {
            const note = (text: string): Path => ({ ...p, notes: [...p.notes, text] });
            switch (s.t) {
                case 'set':
                    return {
                        live: [{ ...p, env: new Map(p.env).set(s.name, evaluate(s.value, p.env, file)) }],
                        ended: [],
                    };
                case 'return':
                    return { live: [], ended: [p] };
                case 'if': {
                    const c = evaluate(s.cond, p.env, file);
                    if (c.t === 'bool') return block(c.b ? s.yes : s.no, [p], file, depth);
                    // Not settled offline (a dialog choice, a varp, the player's side): both ways.
                    return merge(block(s.yes, [p], file, depth), block(s.no, [p], file, depth));
                }
                case 'switch': {
                    const subject = evaluate(s.subject, p.env, file);
                    const fallback = s.cases.find(c => c.keys === null);
                    const matches = s.cases.filter(c => c.keys !== null);
                    const hits = matches.map(c => c.keys!.map(k => equal(evaluate(k, p.env, file), subject)));
                    if (hits.every(h => h.every(x => x !== undefined))) {
                        const hit = matches.find((_, i) => hits[i]!.includes(true));
                        if (hit) return block(hit.body, [p], file, depth);
                        const missed = note(`\`${s.text}\` (${at(file, s)}) has no case for it`);
                        return fallback ? block(fallback.body, [missed], file, depth) : { live: [missed], ended: [] };
                    }
                    // A subject or key not known offline: every case may run.
                    const flows = s.cases.map(c => block(c.body, [p], file, depth));
                    return merge(...flows, fallback ? { live: [], ended: [] } : { live: [p], ended: [] });
                }
                case 'call':
                    break;
            }
            const { name, args } = s.call;
            if (name === 'p_telejump' || name === 'p_teleport') {
                const v = args?.length === 1 ? evaluate(args[0]!, p.env, file) : unknown(s.text);
                if (v.t === 'coord') run.landings.push(v);
                else
                    run.unknown.add(
                        `\`${s.text}\` (${at(file, s)}): ${v.t === 'unknown' ? v.text : s.text} is not known offline`,
                    );
                return { live: [p], ended: [] };
            }
            const jump = name === 'jump' && args?.[0]?.t === 'name' ? `@${args[0].name}` : undefined;
            const call = jump ?? (name.startsWith('@') || name.startsWith('~') ? name : undefined);
            // Any other command can't move the player in these scripts.
            if (!call) return { live: [p], ended: [] };
            const isLabel = call.startsWith('@');
            const callee = byCall.get(call);
            if (!callee || !moves(call)) {
                // A proc that never moves the player returns to the script; a label never does.
                if (!isLabel) return { live: [p], ended: [] };
                const why = callee ? 'does not move the player' : 'jumps to a label no script defines';
                return { live: [], ended: [note(`\`${s.text}\` (${at(file, s)}) ${why}`)] };
            }
            const script = scriptOf(call, callee.file, callee.line, callee.body);
            if ('error' in script || depth >= MAX_DEPTH) {
                run.unknown.add('error' in script ? script.error : `\`${s.text}\` (${at(file, s)}) calls too deep`);
                return { live: [], ended: [p] };
            }
            const env = new Map(
                script.params.map((param, i) => [param, args?.[i] ? evaluate(args[i]!, p.env, file) : unknown(param)]),
            );
            const flow = block(script.body, [{ env, notes: p.notes }], script.file, depth + 1);
            const out = [...flow.live, ...flow.ended];
            // A label is a jump: the script ends where it does. A proc returns, to the caller's locals.
            return isLabel ? { live: [], ended: out } : { live: out.map(q => ({ ...q, env: p.env })), ended: [] };
        };

        const script = scriptOf(`${trigger.file}:${trigger.line}`, trigger.file, trigger.line, trigger.body);
        if ('error' in script) {
            run.unknown.add(script.error);
            return run;
        }
        let flow: Flow;
        try {
            flow = block(script.body, [{ env: new Map(), notes: [] }], script.file, 0);
        } catch (e) {
            if (!(e instanceof TooManyPaths)) throw e;
            return {
                landings: [],
                unknown: new Set([`too many paths: ${trigger.file}:${trigger.line} branches past ${MAX_PATHS} ways`]),
                dead: [],
            };
        }
        if (!run.landings.length && !run.unknown.size)
            run.dead = [
                ...new Set(
                    [...flow.live, ...flow.ended].map(p =>
                        p.notes.length
                            ? p.notes.join(', then ')
                            : `${trigger.file}:${trigger.line} never moves the player`,
                    ),
                ),
            ].sort(cmp);
        return run;
    };
}

// ---- Connectors -------------------------------------------------------------------------------------

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const tileKey = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;
/** A tile moved by a relative coord. */
const shift = (t: Tile, v: CoordValue): Tile => ({ level: t.level + v.level, x: t.x + v.x, z: t.z + v.z });

/** `up` or `down` by level; on one level, out of or into the underground. */
export function directionOf(loc: Tile, landing: Tile): Connector['direction'] {
    if (landing.level !== loc.level) return landing.level > loc.level ? 'up' : 'down';
    const [below, under] = [loc.z >= UNDERGROUND_Z, landing.z >= UNDERGROUND_Z];
    return below === under ? 'other' : below ? 'up' : 'down';
}

interface Pending {
    feature: number;
    op: number;
    landing: CoordValue;
}

/**
 * Every connector's landings (sources/connectors.ts header), each with a stand tile: a walkable tile on
 * land that reaches the loc (place.ts reachTiles, the engine's reach test), nearest another connector's
 * landing beside the loc (where the way back puts a player), then nearest the loc's middle. A jump
 * relative to the player lands as far from the stand as the script shifts it, so its stand is first one
 * whose landing is walkable land, then one whose landing reaches a connector (the way back, usable where
 * the player arrives). Rows come out by feature, op and landing.
 */
export function deriveConnectors(input: ConnectorInput): Connectors {
    const { features, locConfigs, collision, size } = input;
    const run = evaluator(input.callables);
    const byTarget = new Map<string, Trigger[]>();
    // Every config's own loc triggers, as `config oploc1` / `config aploc1`, under any directory.
    const own = new Set<string>();
    for (const t of input.triggers) {
        if (t.on !== 'loc') continue;
        if (!t.category) own.add(`${t.target} ${t.kind}loc${t.op}`);
        if (t.file.startsWith(DIR)) push(byTarget, `${t.category ? '_' : ''}${t.target}`, t);
    }

    const underived: Underived[] = [];
    const pending: Pending[] = [];
    features.forEach((f, feature) => {
        if (f.kind !== 'connector') return;
        const cfg = locConfigs.get(f.config);
        const category = first(cfg, 'category');
        // The engine runs a config's own trigger over its category's for the same trigger type (oploc1 and
        // aploc1 are two), wherever that trigger's script lives (server/engine/src/engine/script/
        // ScriptProvider.ts getByTrigger, ServerTriggerType.ts).
        const shadowed = (t: Trigger) => own.has(`${f.config} ${t.kind}loc${t.op}`);
        const triggers = [
            ...(byTarget.get(f.config) ?? []),
            ...(category ? (byTarget.get(`_${category}`) ?? []).filter(t => !shadowed(t)) : []),
        ];
        const fail = (op: number, reason: string) =>
            underived.push({ feature, loc: f.tile, config: f.config, op, reason });
        if (!triggers.length) fail(0, `no op trigger under ${DIR}`);
        for (const t of triggers.sort((a, b) => cmp(a.op, b.op))) {
            const op = Number(t.op);
            const r = run(t, f.tile, f.rotation ?? 0);
            for (const landing of r.landings) pending.push({ feature, op, landing });
            for (const reason of r.unknown) fail(op, reason);
            if (!r.landings.length && !r.unknown.size) fail(op, r.dead.join(' / '));
        }
    });

    // The landings that don't depend on a stand, per level: where a player arrives beside a loc.
    const arrivals = new Map<number, { feature: number; tile: Tile }[]>();
    for (const p of pending)
        if (!p.landing.relative) push(arrivals, p.landing.level, { feature: p.feature, tile: p.landing });

    const onLand = (t: Tile) => collision.land(t.level, t.x, t.z) && collision.walkable(t.level, t.x, t.z);
    // The tiles on land each connector is used from, and all of them together.
    const reach = new Map<number, Tile[]>();
    features.forEach((f, i) => {
        if (f.kind === 'connector')
            reach.set(
                i,
                reachTiles(f, collision, size).filter(t => collision.land(t.level, t.x, t.z)),
            );
    });
    const usedFrom = new Set([...reach.values()].flatMap(ts => ts.map(tileKey)));

    const rows: Connector[] = [];
    const seen = new Set<string>();
    for (const p of pending) {
        const f = features[p.feature]!;
        const { w, l } = footprint(f, size);
        const middle = { x: f.tile.x + (w - 1) / 2, z: f.tile.z + (l - 1) / 2 };
        const near = (arrivals.get(f.tile.level) ?? []).filter(
            a =>
                a.feature !== p.feature &&
                a.tile.x >= f.tile.x - ARRIVAL &&
                a.tile.x <= f.tile.x + w - 1 + ARRIVAL &&
                a.tile.z >= f.tile.z - ARRIVAL &&
                a.tile.z <= f.tile.z + l - 1 + ARRIVAL,
        );
        const arrival = (t: Tile) => (near.length ? Math.min(...near.map(a => dist2(t, a.tile))) : 0);
        // 0 for a tile whose relative landing reaches a connector, 1 for one that doesn't, 0 when absolute.
        const back = (t: Tile) => (p.landing.relative && !usedFrom.has(tileKey(shift(t, p.landing))) ? 1 : 0);
        let tiles = [...reach.get(p.feature)!];
        if (p.landing.relative) {
            const landed = tiles.filter(t => onLand(shift(t, p.landing)));
            if (landed.length) tiles = landed;
        }
        tiles.sort(
            (a, b) =>
                back(a) - back(b) ||
                arrival(a) - arrival(b) ||
                dist2(a, middle) - dist2(b, middle) ||
                a.x - b.x ||
                a.z - b.z,
        );
        const stand = tiles[0] ?? null;
        if (p.landing.relative && !stand) {
            underived.push({
                feature: p.feature,
                loc: f.tile,
                config: f.config,
                op: p.op,
                reason: `the landing is the player's tile shifted (${p.landing.at}), and no tile on land reaches the loc`,
            });
            continue;
        }
        const landing = p.landing.relative
            ? shift(stand!, p.landing)
            : { level: p.landing.level, x: p.landing.x, z: p.landing.z };
        const row = `${p.feature} ${p.op} ${tileKey(landing)}`;
        if (seen.has(row)) continue;
        seen.add(row);
        const opName = first(locConfigs.get(f.config), `op${p.op}`) ?? `op${p.op}`;
        rows.push({
            feature: p.feature,
            loc: f.tile,
            op: p.op,
            opName,
            direction: directionOf(f.tile, landing),
            landing,
            stand,
            ...(p.landing.relative ? { relative: true as const } : {}),
            source: p.landing.at,
        });
    }
    rows.sort(
        (a, b) =>
            a.feature - b.feature ||
            a.op - b.op ||
            a.landing.level - b.landing.level ||
            a.landing.x - b.landing.x ||
            a.landing.z - b.landing.z,
    );

    // The way back: a connector on the landing's level near the landing, landing near this loc.
    const byLevel = new Map<number, Connector[]>();
    for (const r of rows) push(byLevel, r.loc.level, r);
    const oneWay = rows.flatMap((r, i) =>
        (byLevel.get(r.landing.level) ?? []).some(
            b =>
                b.feature !== r.feature &&
                cheb(b.loc, r.landing) <= WAY_BACK &&
                b.landing.level === r.loc.level &&
                cheb(b.landing, r.loc) <= WAY_BACK,
        )
            ? []
            : [i],
    );
    underived.sort((a, b) => a.feature - b.feature || a.op - b.op || cmp(a.reason, b.reason));
    return { connectors: rows, underived, oneWay };
}
