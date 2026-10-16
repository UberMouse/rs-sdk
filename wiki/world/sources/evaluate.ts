// What the offline script walkers share (sources/connectors.ts, sources/transports.ts,
// sources/gate-scan.ts): the values they compute, equality and the boolean fold over them, the flow of
// paths through a statement, and a cache of parsed scripts.
import { parseScript, type Script } from './runescript';

/** A coord a script computed: a tile, or (`relative`) a shift of the player's tile. */
export interface CoordValue {
    t: 'coord';
    relative: boolean;
    level: number;
    x: number;
    z: number;
    /** The script line it was written on, as `file:line`. */
    at: string;
}

export type Value =
    /** A whole number; `name` the constant it was read from (`^prince_saved`), when it was. */
    | { t: 'int'; n: number; name?: string }
    /** `~random_range(lo, hi)`: lo to hi inclusive. */
    | { t: 'range'; lo: number; hi: number }
    | { t: 'bool'; b: boolean }
    | CoordValue
    /** A bare name a walker knows is a config: an npc, a label, or an inventory (`inv`, `worn`). */
    | { t: 'name'; v: string }
    /**
     * Not known offline; `choice` when it is a dialogue choice the player makes, `side` when it depends on
     * which side of a loc the player stands (sources/gate-scan.ts).
     */
    | { t: 'unknown'; text: string; choice?: true; side?: true };

export const unknown = (text: string, choice?: boolean): Value => ({
    t: 'unknown',
    text,
    ...(choice ? { choice: true as const } : {}),
});

/** A value as a truth: a bool, or an int (`^true` is 1); undefined for anything else. */
export const truthOf = (v: Value): boolean | undefined =>
    v.t === 'bool' ? v.b : v.t === 'int' ? v.n !== 0 : undefined;

/** Whether two values are equal; undefined when either isn't known (a relative coord isn't). */
export function equal(a: Value, b: Value): boolean | undefined {
    if (a.t === 'int' && b.t === 'int') return a.n === b.n;
    if (a.t === 'name' && b.t === 'name') return a.v === b.v;
    if (a.t === 'coord' && b.t === 'coord' && !a.relative && !b.relative)
        return a.level === b.level && a.x === b.x && a.z === b.z;
    if (a.t === 'bool' || b.t === 'bool') {
        const [x, y] = [truthOf(a), truthOf(b)];
        return x === undefined || y === undefined ? undefined : x === y;
    }
    return undefined;
}

/**
 * `l op r` for `&`, `|`, `=` and `!`: known when the operands settle it (`false & x` is false), else
 * unknown as `text`, a choice when either operand is one. Undefined for any other operator.
 */
export function fold(op: string, l: Value, r: Value, text: string): Value | undefined {
    const choice = (l.t === 'unknown' && l.choice) || (r.t === 'unknown' && r.choice);
    if (op === '&' || op === '|') {
        const short = op === '|';
        if ((l.t === 'bool' && l.b === short) || (r.t === 'bool' && r.b === short)) return { t: 'bool', b: short };
        return l.t === 'bool' && r.t === 'bool' ? { t: 'bool', b: !short } : unknown(text, choice);
    }
    if (op === '=' || op === '!') {
        const same = equal(l, r);
        return same === undefined ? unknown(text, choice) : { t: 'bool', b: same === (op === '=') };
    }
    return undefined;
}

/** Where a statement leaves the paths that ran it. */
export interface Flow<P> {
    /** Paths that run on past the statement. */
    live: P[];
    /** Paths that ended the script in it (a `return`, or a label jumped to). */
    ended: P[];
}

export const merge = <P>(...flows: Flow<P>[]): Flow<P> => ({
    live: flows.flatMap(f => f.live),
    ended: flows.flatMap(f => f.ended),
});

/** A run that passed its bound on paths. */
export class TooManyPaths extends Error {}

/** Parses each script once, by key: a trigger's `file:line`, or a callable's `@label` / `~proc`. */
export function scriptCache(): (key: string, file: string, line: number, raw: string) => Script | { error: string } {
    const parsed = new Map<string, Script | { error: string }>();
    return (key, file, line, raw) => {
        let s = parsed.get(key);
        if (!s) parsed.set(key, (s = parseScript(file, line, raw)));
        return s;
    };
}
