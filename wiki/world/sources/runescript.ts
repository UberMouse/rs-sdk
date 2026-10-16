// A small recursive-descent parser for the RuneScript (.rs2) that the world index reads offline: the
// connector scripts (sources/connectors.ts), the sail scripts (sources/transports.ts), the loadout
// procs (sources/loadout.ts) and the quest varp assignments (sources/quests.ts). It reads statements
// (`switch_*` with `case` lists, `if`/`else` with or without braces, `def_*` with or without a value,
// `$local =` and `%varp =`, `while`, `return`, calls) and expressions (calls, names,
// `interface:component` references, numbers, coords, strings, comparisons and arithmetic, joined by `&`
// and `|`). Anything else is a ParseError naming its line, which a reader reports, never guesses past.
import { codeOf } from '../classify';
import type { Tile } from '../types';

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

// Whitespace or a `/* */` comment, a coord literal (level_mx_mz_x_z), a name (`$local`, `%varp`,
// `^constant`, `~proc`, `@label`, `.command` or `~.proc` on the second npc or loc, a command, or a config name, which
// may start with digits: `1dose2strength`), a number, a string (an interpolation in it, `<...>`, may
// hold quotes: `"<text_gender("Sir", "Madam")>"`), an operator or bracket.
const TOKEN =
    /\s+|\/\*[\s\S]*?\*\/|(\d+_\d+_\d+_\d+_\d+)|((?:~\.|[$%^~@.])?\d*[A-Za-z_][A-Za-z0-9_]*)|(\d+)|("(?:[^"\\<]|\\.|<[^>]*>)*")|(<=|>=|[(){},;:=!<>&|+\-*/])/y;

function tokenize(code: string, firstLine: number): Token[] {
    const out: Token[] = [];
    let line = firstLine;
    for (let at = 0; at < code.length;) {
        TOKEN.lastIndex = at;
        const m = TOKEN.exec(code);
        if (!m) throw new ParseError(line, `\`${code[at]}\``);
        const k = m[1] ? 'coord' : m[2] ? 'name' : m[3] ? 'num' : m[4] ? 'str' : m[5] ? 'punct' : undefined;
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

/** Whether a string is a packed coord literal. */
export const isCoordLiteral = (s: string): boolean => /^\d+_\d+_\d+_\d+_\d+$/.test(s);

export interface Node {
    /** The source text, whitespace collapsed. */
    text: string;
    line: number;
}

export type Expr = Node &
    (
        | { t: 'num'; n: number }
        | { t: 'coord'; tile: Tile }
        | { t: 'str' }
        /**
         * A local, varp, constant, command, call or `interface:component` reference; `args` null when
         * written without parentheses.
         */
        | { t: 'name'; name: string; args: Expr[] | null }
        | { t: 'bin'; op: string; l: Expr; r: Expr }
    );

export interface Case {
    /** null for `case default`. */
    keys: Expr[] | null;
    body: Stmt[];
}

export type Stmt = Node &
    (
        | { t: 'switch'; subject: Expr; cases: Case[] }
        | { t: 'if'; cond: Expr; yes: Stmt[]; no: Stmt[] }
        /** A loop; its `text` is the whole source line it starts on, as a ParseError would name it. */
        | { t: 'while'; cond: Expr; body: Stmt[] }
        | { t: 'return'; value: Expr | null }
        /** `$local = ...`, `def_<type> $local = ...` or `%varp = ...`. */
        | { t: 'set'; name: string; value: Expr }
        /**
         * Locals given no value the parser computes: `def_<type> $local;` (value null), or several
         * assigned from one call, `$x, $z = ~door_open(...)`.
         */
        | { t: 'def'; names: string[]; value: Expr | null }
        | { t: 'call'; call: Expr & { t: 'name' } }
    );

const COMPARE = new Set(['=', '!', '<', '>', '<=', '>=']);

/** The binary operators by precedence, lowest first: `|`, `&`, the comparisons, `+ -`, `* /`. */
const LEVELS: ((v: string) => boolean)[] = [
    v => v === '|',
    v => v === '&',
    v => COMPARE.has(v),
    v => v === '+' || v === '-',
    v => v === '*' || v === '/',
];

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

    /** The `(type $name, ...)` list a label or proc body starts with, and a proc's `(type)` return list. */
    params(): string[] {
        if (this.peek()?.v !== '(') return [];
        const out: string[] = [];
        for (let t = this.next(); t.v !== ')'; t = this.next()) if (t.v.startsWith('$')) out.push(t.v);
        // A proc's return types, `[proc,x](int $a)(boolean)`: no statement starts with `(`.
        if (this.peek()?.v === '(') while (this.next().v !== ')');
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

    /** A `{ ... }` block, or the one statement an `if` or `else` takes without braces. */
    private braced(): Stmt[] {
        if (!this.is('{')) return [this.statement()];
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
        if (t.v === 'while') {
            const { message } = this.error(t);
            this.next();
            this.expect('(');
            const cond = this.expr();
            this.expect(')');
            return { t: 'while', cond, body: this.braced(), text: message.slice(1, -1), line: t.line };
        }
        if (t.v === 'return') {
            this.i++;
            let value: Expr | null = null;
            if (this.is('(')) {
                this.next();
                if (!this.is(')')) value = this.expr();
                this.expect(')');
            }
            this.expect(';');
            return { t: 'return', value, text: 'return', line: t.line };
        }
        if (t.v.startsWith('$') && this.peek(1)?.v === ',') {
            const names: string[] = [];
            do {
                const name = this.next();
                if (!name.v.startsWith('$')) throw this.error(name);
                names.push(name.v);
            } while (this.is(',') && this.next());
            this.expect('=');
            const value = this.expr();
            this.expect(';');
            return { t: 'def', names, value, text: this.text(t), line: t.line };
        }
        const def = t.v.startsWith('def_');
        if (def || ((t.v.startsWith('$') || t.v.startsWith('%')) && this.peek(1)?.v === '=')) {
            if (def) this.i++;
            const name = this.next();
            if (!name.v.startsWith('$') && !name.v.startsWith('%')) throw this.error(name);
            if (def && this.is(';')) {
                this.next();
                return { t: 'def', names: [name.v], value: null, text: this.text(t), line: t.line };
            }
            this.expect('=');
            const value = this.expr();
            this.expect(';');
            return { t: 'set', name: name.v, value, text: this.text(t), line: t.line };
        }
        if (!['(', ';', '*'].includes(this.peek(1)?.v ?? '')) throw this.error(t);
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

    private binary(level: number): Expr {
        if (level === LEVELS.length) return this.primary();
        const start = this.peek()!;
        let l = this.binary(level + 1);
        while (this.peek() && LEVELS[level]!(this.peek()!.v)) {
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
        let name = t.v;
        // `questlist:zanaris`, written with no space: a `case x :` key has one before its colon.
        const colon = this.peek();
        const component = this.peek(1);
        if (colon?.v === ':' && colon.at === t.end && component?.k === 'name' && component.at === colon.end) {
            this.i += 2;
            name = `${t.v}:${component.v}`;
        }
        // `queue*(name, delay)(args)`: a command whose script takes arguments of its own, in a second list.
        const star = this.peek();
        const starred = star?.v === '*' && star.at === this.toks[this.i - 1]!.end && this.peek(1)?.v === '(';
        if (starred) this.i++;
        let args: Expr[] | null = null;
        for (let lists = 0; this.is('(') && lists < (starred ? 2 : 1); lists++) {
            this.next();
            args ??= [];
            const first = args.length;
            while (!this.is(')')) {
                if (args.length > first) this.expect(',');
                args.push(this.expr());
            }
            this.next();
        }
        return { t: 'name', name, args, text: this.text(t), line: t.line };
    }
}

export interface Script {
    file: string;
    params: string[];
    body: Stmt[];
}

/** A trigger's or callable's body parsed, or the construct that stopped the parser. */
export function parseScript(file: string, line: number, raw: string): Script | { error: string } {
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
