// The quest table: how a save shows each quest done. Each quest's journal button calls
// `~send_quest_progress(questlist:<id>, %<varp>, ^<x>_complete)` (or `~send_quest_progress_colour`, the
// same arguments), and general/scripts/quests.rs2:5 shows the quest done at `progress >= complete`. So
// the table is read from those calls, with no per-quest list: the varp's id from pack/varp.pack, the
// constant's value from its .constant file. A quest whose calls pass something else (a computed
// progress, a literal, two varps) needs a curated override (gates.ts QUEST_OVERRIDES), and the build
// fails on a quest that has neither.
//
// A `quest:<id>>=<stage>` requirement assumes a quest varp only grows. questVarpDecreases checks that on
// the scripts' `%varp = <stage>` assignments: none sets a quest varp below a stage the conditions around
// it (or an earlier assignment in the same script) have shown it at.
import { codeOf } from '../classify';
import type { Quest, QuestVarp } from '../types';
import { cmp, push } from '../util';
import { first, type Config } from './configs';
import { constantInt, type Constant } from './constants';
import type { Pack } from './packs';
import { parseScript, type Expr, type Stmt } from './runescript';
import { blocks } from './triggers';

/** One `~send_quest_progress(...)` call, its arguments as written. */
export interface QuestCall {
    /** The questlist component: `zanaris` for `questlist:zanaris`. */
    id: string;
    progress: string;
    complete: string;
    /** `file:line`. */
    at: string;
}

/** A curated quest whose journal calls the scan can't read (gates.ts QUEST_OVERRIDES). */
export interface QuestOverride {
    id: string;
    varp: string;
    /** As QuestVarp.bits; a number or a `^constant`. */
    bits?: [lo: number | string, hi: number | string];
    /** A number or a `^constant`. */
    complete: number | string;
    or?: { varp: string; bits?: [number | string, number | string]; complete: number | string }[];
    /** The script that shows how the quest is read, as `file:line`. */
    source: string;
    notes: string;
}

const CALL = /~send_quest_progress(?:_colour)?\(/g;

/** The top-level comma-separated arguments of the call whose `(` is at `open`, or null if unclosed. */
function argsAt(code: string, open: number): string[] | null {
    const out: string[] = [];
    let depth = 0;
    let from = open + 1;
    for (let i = open; i < code.length; i++) {
        const ch = code[i];
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) {
            out.push(code.slice(from, i).trim());
            return out;
        } else if (ch === ',' && depth === 1) {
            out.push(code.slice(from, i).trim());
            from = i + 1;
        }
    }
    return null;
}

/** The journal calls in the scripts, and those that name a quest but can't be read. */
export interface QuestScan {
    calls: QuestCall[];
    /**
     * Calls that name a `questlist:` component but aren't `(questlist:<id>, <progress>, <complete>)`,
     * as `` `<call>` (file:line) ``: each fails the build as an unread quest does.
     */
    unread: string[];
}

/**
 * Every journal call in the scripts, read over the whole text so a call split across lines counts.
 * A call that names no `questlist:` component (the procs passing their own parameters on) is skipped.
 */
export function scanQuestCalls(files: readonly [file: string, text: string][]): QuestScan {
    const calls: QuestCall[] = [];
    const unread: string[] = [];
    for (const [file, text] of files) {
        const code = codeOf(text);
        const lineAt = (index: number) => code.slice(0, index).split('\n').length;
        for (const m of code.matchAll(CALL)) {
            const open = m.index + m[0].length - 1;
            const args = argsAt(code, open);
            const at = `${file}:${lineAt(m.index)}`;
            const component = args?.[0]?.match(/^questlist:([a-z0-9_]+)$/);
            if (args && args.length === 3 && component)
                calls.push({ id: component[1]!, progress: args[1]!, complete: args[2]!, at });
            else {
                const call = code.slice(m.index, args ? code.indexOf(')', open) + 1 : code.indexOf('\n', open));
                if (/\bquestlist:/.test(call) || args === null)
                    unread.push(
                        `\`${call.replace(/\s+/g, ' ').trim()}\` (${at}) is not ` +
                            '~send_quest_progress(questlist:<id>, <progress>, <complete>)',
                    );
            }
        }
    }
    return { calls, unread };
}

export interface QuestInput {
    scan: QuestScan;
    constants: ReadonlyMap<string, Constant>;
    varps: Pack;
    /** The `.varbit` configs: a `basevar`, `startbit` and `endbit` each. */
    varbits: ReadonlyMap<string, Config>;
    overrides: readonly QuestOverride[];
    /** Quests whose varp a script sets back below a stage (gates.ts QUEST_VARP_EXCEPTIONS): id -> why. */
    decreasing: Readonly<Record<string, string>>;
}

export interface Quests {
    quests: Quest[];
    /**
     * Quests the calls don't give and no override covers, as `<id>: <why>`, and the journal calls the
     * scan can't read (QuestScan.unread): the build fails on any.
     */
    unread: string[];
    /**
     * Overrides whose quest the calls give as they are, or that no call names, and decreasing quests
     * that aren't in the table: the build fails on any.
     */
    stale: string[];
}

/**
 * Where a `%name` the scripts use is stored: a varp in pack/varp.pack, or a varbit (bits `startbit` to
 * `endbit` of its `basevar`); else why not.
 */
function storage(
    name: string,
    at: string,
    varps: Pack,
    varbits: ReadonlyMap<string, Config>,
): Omit<QuestVarp, 'complete'> | string {
    const varpId = varps.id.get(name);
    if (varpId !== undefined) return { varp: name, varpId };
    const vb = varbits.get(name);
    if (!vb) return `%${name} is neither in pack/varp.pack nor a varbit (${at})`;
    const base = first(vb, 'basevar');
    const baseId = base === undefined ? undefined : varps.id.get(base);
    const [lo, hi] = [Number(first(vb, 'startbit')), Number(first(vb, 'endbit'))];
    if (base === undefined || baseId === undefined || !Number.isInteger(lo) || !Number.isInteger(hi))
        return `varbit %${name} has no basevar in pack/varp.pack, or no startbit and endbit (${at})`;
    return { varp: base, varpId: baseId, bits: [lo, hi], varbit: name };
}

/** The varp and complete value a call passes, or why the scan can't read it. */
function readCall(
    c: QuestCall,
    constants: ReadonlyMap<string, Constant>,
    varps: Pack,
    varbits: ReadonlyMap<string, Config>,
): QuestVarp | string {
    const name = c.progress.match(/^%([a-z0-9_]+)$/)?.[1];
    if (!name) return `\`${c.progress}\` is not a varp (${c.at})`;
    const where = storage(name, c.at, varps, varbits);
    if (typeof where === 'string') return where;
    if (!/^\^[a-z0-9_]+_complete$/.test(c.complete))
        return `\`${c.complete}\` is not a ^<x>_complete constant (${c.at})`;
    const complete = constantInt(constants, c.complete);
    if (complete === undefined) return `${c.complete} is not a number in any .constant file (${c.at})`;
    return { ...where, complete };
}

const sameVarp = (a: QuestVarp, b: QuestVarp): boolean =>
    a.varp === b.varp && a.varbit === b.varbit && a.complete === b.complete && a.bits?.join() === b.bits?.join();

/** An override's number or `^constant` as a number; throws naming the override when it is neither. */
function resolve(o: QuestOverride, x: number | string, constants: ReadonlyMap<string, Constant>): number {
    if (typeof x === 'number') return x;
    const n = constantInt(constants, x);
    if (n === undefined) throw new Error(`quest override ${o.id}: ${x} is not a number in any .constant file`);
    return n;
}

function overrideVarp(
    o: QuestOverride,
    v: { varp: string; bits?: [number | string, number | string]; complete: number | string },
    constants: ReadonlyMap<string, Constant>,
    varps: Pack,
): QuestVarp {
    const varpId = varps.id.get(v.varp);
    if (varpId === undefined) throw new Error(`quest override ${o.id}: %${v.varp} is not in pack/varp.pack`);
    return {
        varp: v.varp,
        varpId,
        ...(v.bits ? { bits: [resolve(o, v.bits[0], constants), resolve(o, v.bits[1], constants)] } : {}),
        complete: resolve(o, v.complete, constants),
    };
}

/**
 * The quest table (sources/quests.ts header): one row per questlist component a journal call names,
 * from its calls when every one reads as `(%varp, ^x_complete)` and they agree, else from its override.
 * Sorted by id.
 */
export function deriveQuests({ scan, constants, varps, varbits, overrides, decreasing }: QuestInput): Quests {
    const byId = new Map<string, QuestCall[]>();
    for (const c of [...scan.calls].sort((a, b) => cmp(a.at, b.at))) push(byId, c.id, c);
    const overrideOf = new Map(overrides.map(o => [o.id, o]));
    const quests: Quest[] = [];
    const unread: string[] = [...scan.unread];
    const stale: string[] = [];
    for (const [id, cs] of [...byId].sort(([a], [b]) => cmp(a, b))) {
        const read = cs.map(c => readCall(c, constants, varps, varbits));
        const problems = read.filter((r): r is string => typeof r === 'string');
        const readable = read.filter((r): r is QuestVarp => typeof r !== 'string');
        const disagree = readable.some(r => !sameVarp(r, readable[0]!));
        const o = overrideOf.get(id);
        if (o) {
            if (!problems.length && !disagree)
                stale.push(
                    `${id}: its calls read as %${readable[0]!.varp} >= ${readable[0]!.complete} without the override`,
                );
            quests.push({
                id,
                ...overrideVarp(o, o, constants, varps),
                ...(o.or ? { or: o.or.map(v => overrideVarp(o, v, constants, varps)) } : {}),
                stages: {},
                source: o.source,
            });
        } else if (problems.length || disagree) {
            const why = disagree
                ? `its calls pass different varps or values (${cs.map(c => `${c.progress}, ${c.complete} at ${c.at}`).join('; ')})`
                : problems.join('; ');
            unread.push(`${id}: ${why}`);
        } else quests.push({ id, ...readable[0]!, stages: {}, source: cs[0]!.at });
    }
    for (const o of overrides) if (!byId.has(o.id)) stale.push(`${o.id}: no journal call names questlist:${o.id}`);
    for (const [id, why] of Object.entries(decreasing)) {
        const q = quests.find(x => x.id === id);
        if (q) q.varpDecreases = why;
        else stale.push(`${id}: listed as decreasing, but no journal call names questlist:${id}`);
    }
    return { quests, unread: unread.sort(cmp), stale: stale.sort(cmp) };
}

// ---- Quest varps only grow ---------------------------------------------------------------------------

/** An assignment that sets a quest varp below a stage it was shown at. */
export interface Decrease {
    quest: string;
    varp: string;
    /** The stage the conditions or an earlier assignment showed, and the value set. */
    from: number;
    to: number;
    /** `file:line`. */
    at: string;
}

export interface VarpCheck {
    decreases: Decrease[];
    /** Scripts that assign a quest varp and that the parser does not read, as their parse error. */
    unread: string[];
}

/** Lower bounds of varps, by name with its `%`. */
type Bounds = ReadonlyMap<string, number>;

/**
 * Every quest varp assignment in `files` that lowers the varp (sources/quests.ts header). A bound comes
 * from a condition around the assignment (`if (%v >= ^stage)`, `case ^stage :` of `switch_int (%v)`, the
 * `else` of `if (%v < ^stage)`) or an earlier `%v = <value>` in the same script; an assignment of a value
 * below it is a decrease; an assignment of a computed value is not checked. A quest read from bits of a
 * varp is checked when they are a varbit, which the scripts assign whole; a computed progress (an
 * override's `bits`) is left out.
 */
export function questVarpDecreases(
    files: readonly [file: string, text: string][],
    quests: readonly Quest[],
    constants: ReadonlyMap<string, Constant>,
): VarpCheck {
    // By the name the scripts assign: the varbit's, or the varp's when its progress is the whole varp.
    const questOf = new Map<string, string>();
    for (const q of quests)
        for (const v of [q, ...(q.or ?? [])])
            if (v.varbit) questOf.set(`%${v.varbit}`, q.id);
            else if (!v.bits) questOf.set(`%${v.varp}`, q.id);
    const decreases: Decrease[] = [];
    const unread: string[] = [];

    const value = (e: Expr): number | undefined =>
        e.t === 'num'
            ? e.n
            : e.t === 'name' && e.args === null && e.name.startsWith('^')
              ? constantInt(constants, e.name)
              : undefined;
    const varpOf = (e: Expr): string | undefined =>
        e.t === 'name' && e.args === null && questOf.has(e.name) ? e.name : undefined;

    /** The bounds a condition shows on its `want` branch. */
    const shown = (e: Expr, want: boolean, into: Map<string, number>): void => {
        if (e.t !== 'bin') return;
        if ((e.op === '&' && want) || (e.op === '|' && !want)) {
            shown(e.l, want, into);
            shown(e.r, want, into);
            return;
        }
        const v = varpOf(e.l);
        const n = value(e.r);
        if (!v || n === undefined) return;
        // The least value of the varp the branch implies.
        const least = want ? { '=': n, '>=': n, '>': n + 1 }[e.op] : { '<': n, '<=': n + 1, '!': n }[e.op];
        if (least !== undefined) into.set(v, Math.max(into.get(v) ?? 0, least));
    };

    // Limit: a bound shown or set inside an `if`, `switch` or loop does not carry past it.
    const walk = (stmts: readonly Stmt[], bounds: Bounds, file: string): void => {
        const local = new Map(bounds);
        for (const s of stmts) {
            if (s.t === 'set' && questOf.has(s.name)) {
                const n = value(s.value);
                // A computed value (`calc(...)`, `setbit(...)`) is not checked, and leaves the varp unknown.
                if (n === undefined) {
                    local.delete(s.name);
                    continue;
                }
                const least = local.get(s.name);
                if (least !== undefined && n < least)
                    decreases.push({
                        quest: questOf.get(s.name)!,
                        varp: s.name.slice(1),
                        from: least,
                        to: n,
                        at: `${file}:${s.line}`,
                    });
                local.set(s.name, n);
            } else if (s.t === 'if') {
                const yes = new Map(local);
                shown(s.cond, true, yes);
                walk(s.yes, yes, file);
                const no = new Map(local);
                shown(s.cond, false, no);
                walk(s.no, no, file);
            } else if (s.t === 'while') {
                const inLoop = new Map(local);
                shown(s.cond, true, inLoop);
                walk(s.body, inLoop, file);
            } else if (s.t === 'switch') {
                const v = varpOf(s.subject);
                for (const c of s.cases) {
                    const keys = c.keys?.map(value);
                    const inCase = new Map(local);
                    if (v && keys?.every(k => k !== undefined))
                        inCase.set(v, Math.max(local.get(v) ?? 0, Math.min(...(keys as number[]))));
                    walk(c.body, inCase, file);
                }
            }
        }
    };

    // A `%varp =` where a statement starts: after `;`, a brace, a `case` colon, an `if (...)` or `else`.
    const assigns = /(?:^|[;{}:)]|\belse)\s*%([a-z0-9_]+)\s*=/gm;
    for (const [file, text] of files)
        for (const b of blocks(file, text)) {
            const code = codeOf(b.body);
            if (![...code.matchAll(assigns)].some(m => questOf.has(`%${m[1]}`))) continue;
            const script = parseScript(file, b.line, b.body);
            if ('error' in script) unread.push(`${b.header} ${script.error}`);
            else walk(script.body, new Map(), file);
        }
    return { decreases, unread: unread.sort(cmp) };
}
