// A plan's source as the viewer reads it: where each phase is declared, and the conditions its
// author gave it. Text only: the viewer has the copy of the plan that ran, not its module, so it
// shows what was written rather than evaluating it. Pure, for the page and its tests.

/** The line declaring a phase: its `name:`, or for a phase named after its task, the phase(<task>, ...) call. */
export function sourceLine(lines: string[], phase: string, task: string): number {
    const named = lines.findIndex(l => l.includes(`name: '${phase}'`));
    if (named >= 0) return named;
    // The call may break after `phase(`: match across lines, then count the lines before it.
    const at = new RegExp(`phase\\(\\s*${escapeRe(toIdent(task))}\\b`).exec(lines.join('\n'))?.index;
    return at === undefined ? -1 : lines.join('\n').slice(0, at).split('\n').length - 1;
}
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Task name -> the identifier plans import it as: "fish-cook" -> "fishCook". */
const toIdent = (task: string) => task.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A phase's options as written, each with its arrow's parameter dropped (`v => v.inv(x) > 0` -> `v.inv(x) > 0`). */
export interface PhaseConditions {
    when: string | null;
    until: string | null;
    onFail: string | null;
}

/**
 * Each phase's when, until and onFail from the options of its phase(...) call; null for a phase whose
 * call is not found (built by a helper of the plan's, say), rather than guess another call's.
 */
export function phaseConditions(
    source: string,
    phases: readonly { phase: string; task: string }[],
): Record<string, PhaseConditions | null> {
    const lines = source.split('\n');
    const starts: number[] = [];
    let at = 0;
    for (const l of lines) {
        starts.push(at);
        at += l.length + 1;
    }
    const out: Record<string, PhaseConditions | null> = {};
    for (const { phase, task } of phases) {
        out[phase] = null;
        // A phase named apart from its task is found by its name only: its task's call may be another phase's.
        const line =
            phase === task || lines.some(l => l.includes(`name: '${phase}'`)) ? sourceLine(lines, phase, task) : -1;
        if (line < 0) continue;
        // The call this line belongs to: on it, or (a `name:` line) the nearest one above it.
        const call = source.lastIndexOf('phase(', starts[line]! + lines[line]!.length);
        if (call < 0) continue;
        const conditions: PhaseConditions = { when: null, until: null, onFail: null };
        out[phase] = conditions;
        const opts = spans(source, call + 'phase('.length)[2];
        if (!opts) continue;
        const props = properties(source, opts);
        for (const key of ['when', 'until', 'onFail'] as const) conditions[key] = props[key] ?? null;
    }
    return out;
}

/** The plan's own until, as written in its definePlan({ ... }); null without one. */
export function planUntil(source: string): string | null {
    const call = source.indexOf('definePlan(');
    if (call < 0) return null;
    const def = spans(source, call + 'definePlan('.length)[0];
    return def ? (properties(source, def).until ?? null) : null;
}

/** An object literal's properties as one-line text, when the span holds one. */
function properties(source: string, [start, end]: [number, number]): Record<string, string> {
    const out: Record<string, string> = {};
    const brace = source.indexOf('{', start);
    if (brace < 0 || brace >= end) return out;
    for (const [from, to] of spans(source, brace + 1)) {
        const m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(source.slice(from, to).replace(LEADING_COMMENTS, ''));
        if (m) out[m[1]!] = tidy(m[2]!);
    }
    return out;
}

/**
 * The reads a condition's text makes off its view with literal arguments, keyed as the engine's
 * recordReads notes them (`v.inv("Coins")` -> `inv('Coins')`, `v.free` -> `free`), in order. A call
 * with a variable argument is left out: its key holds the variable's value, which text can't know.
 */
export function conditionReads(expr: string): string[] {
    const out: string[] = [];
    const add = (key: string) => {
        if (!out.includes(key)) out.push(key);
    };
    const re = /\bv\.([A-Za-z_$][\w$]*)(\s*\()?/g;
    for (let m = re.exec(expr); m; m = re.exec(expr)) {
        if (m[2] === undefined) {
            if (m[1] !== 'state') add(m[1]!);
            continue;
        }
        const args = spans(expr, m.index + m[0].length).map(([a, b]) => literal(expr.slice(a, b).trim()));
        if (args.every(a => a !== null)) add(`${m[1]}(${args.join(', ')})`);
    }
    return out;
}
/** A literal argument as recordReads writes it (strings single-quoted); null for anything else. */
function literal(arg: string): string | null {
    const str = /^(['"`])((?:(?!\1)[^\\]|\\.)*)\1$/.exec(arg);
    if (str) return `'${str[2]}'`;
    return /^\/.+\/[a-z]*$/.test(arg) || /^-?\d+(\.\d+)?$/.test(arg) ? arg : null;
}

/** Whitespace and the comments a property follows. */
const LEADING_COMMENTS = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;

/** One line, without the arrow's parameter. */
const tidy = (expr: string) =>
    expr
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:\(\s*)?[A-Za-z_$][\w$]*(?:\s*\))?\s*=>\s*/, '');

const OPEN = '([{';
const CLOSE = ')]}';

/**
 * The comma-separated parts of a bracketed list whose contents start at `from`, as [start, end)
 * spans, up to the bracket that closes it; empty parts (a trailing comma) are left out.
 */
function spans(src: string, from: number): [number, number][] {
    const out: [number, number][] = [];
    const push = (a: number, b: number) => {
        if (src.slice(a, b).trim()) out.push([a, b]);
    };
    let depth = 0;
    let start = from;
    for (let i = from; i < src.length;) {
        const next = skipLiteral(src, i);
        if (next !== i) {
            i = next;
            continue;
        }
        const c = src[i]!;
        if (OPEN.includes(c)) depth++;
        else if (CLOSE.includes(c)) {
            if (depth === 0) {
                push(start, i);
                return out;
            }
            depth--;
        } else if (c === ',' && depth === 0) {
            push(start, i);
            start = i + 1;
        }
        i++;
    }
    return out;
}

/** The index past a string, comment or regex literal starting at `i`; `i` when none starts there. */
function skipLiteral(src: string, i: number): number {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
        const end = src.indexOf('\n', i);
        return end < 0 ? src.length : end;
    }
    if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        return end < 0 ? src.length : end + 2;
    }
    if (c === "'" || c === '"' || c === '`') {
        for (let j = i + 1; j < src.length; j++) {
            if (src[j] === '\\') j++;
            else if (src[j] === c) return j + 1;
        }
        return src.length;
    }
    // A slash starts a regex where an expression may start, i.e. not after a value.
    if (c === '/' && /[(,=:[!&|?{};>]|^$/.test(prevChar(src, i))) {
        let inClass = false;
        for (let j = i + 1; j < src.length && src[j] !== '\n'; j++) {
            if (src[j] === '\\') j++;
            else if (src[j] === '[') inClass = true;
            else if (src[j] === ']') inClass = false;
            else if (src[j] === '/' && !inClass) {
                while (/[a-z]/.test(src[j + 1] ?? '')) j++;
                return j + 1;
            }
        }
    }
    return i;
}

/** The last non-space character before `i`, or '' at the start. */
function prevChar(src: string, i: number): string {
    for (let j = i - 1; j >= 0; j--) if (!/\s/.test(src[j]!)) return src[j]!;
    return '';
}
