// What one script condition says about the player, shared by the walkers that turn conditions into
// requirements (sources/transports.ts, sources/gate-scan.ts). A condition is read as `subject op value`,
// the subject on the left (`^stage > %varp` reads as `%varp < ^stage`) and the op negated when the path
// takes it false; each walker then maps the reading to what it means on its paths.
import type { Quest } from '../types';
import { cmp } from '../util';
import { truthOf, type Value } from './evaluate';
import type { LoadoutProc } from './loadout';
import { parseScript, type Expr, type Stmt } from './runescript';
import type { Callable } from './triggers';

/** A quest varp by the name the scripts use, with the value that completes the quest on it. */
export interface QuestRef {
    quest: Quest;
    /** The varp (or varbit) as the scripts name it, `%zanaris`. */
    varp: string;
    complete: number;
    /** Whether it is the quest's own varp, not one of its `or` (Shield of Arrav's other gang). */
    own: boolean;
}

export type Reading =
    /** `map_members`: the path is on a members world (`holds`) or not. */
    | { k: 'members'; holds: boolean }
    /** A loadout proc (gates.ts LOADOUT_PROCS): the player carries none of the rule's categories (`clear`). */
    | { k: 'loadout'; rule: string; clear: boolean }
    /** A quest varp compared with a number: `%varp op n`, `name` the constant n was written as (`^prince_saved`). */
    | { k: 'quest'; ref: QuestRef; op: string; n: number; name?: string }
    /**
     * `inv_total(inv|worn, obj)`, or `inv_getobj(worn, slot) = obj`: the player holds (or wears) at least
     * `least` of it; 0 when the path allows none.
     */
    | { k: 'inv'; where: 'inv' | 'worn'; obj: string; least: number }
    /** `stat(skill)` or `stat_base(skill)`: at least `least`; 0 when the path allows any level. */
    | { k: 'stat'; skill: string; least: number }
    /** `last_useitem` (a use-item op): the item used is (`is`) or is not `obj`. */
    | { k: 'useitem'; obj: string; is: boolean }
    /**
     * Any obj of a category, worn or carried: `inv_totalcat(inv|worn, category)`, or a tool-checker proc's
     * result (toolCheckers) against `null`. `ways` are the alternatives, any one of which does; `has` when
     * the path needs one, false when it allows none.
     */
    | { k: 'category'; ways: { category: string; where: 'inv' | 'worn' }[]; has: boolean }
    /** `%qp`, the player's quest points: at least `least`; 0 when the path allows any. */
    | { k: 'questpoints'; least: number }
    /**
     * Any other condition. `subject` when it is about one of the subjects above but its value is not
     * known offline (`stat(agility) < loc_param(agil_level_req)`).
     */
    | { k: 'other'; subject: boolean };

/** The comparison `!(l op r)` is, as `l op' r`. */
export const NEGATE: Readonly<Record<string, string>> = {
    '=': '!',
    '!': '=',
    '<': '>=',
    '>=': '<',
    '>': '<=',
    '<=': '>',
};
/** The comparison `r op l` is, as `l op' r`. */
export const FLIP: Readonly<Record<string, string>> = {
    '=': '=',
    '!': '!',
    '<': '>',
    '>': '<',
    '<=': '>=',
    '>=': '<=',
};

const TRUE: Expr = { t: 'name', name: 'true', args: null, text: 'true', line: 0 };

/** The least value `x op n` lets x be, among whole numbers from 0; 0 when it allows 0 (`<`, `<=`). */
const leastOf = (op: string, n: number): number =>
    (({ '>=': n, '>': n + 1, '=': n, '!': n === 0 ? 1 : 0 }) as Record<string, number>)[op] ?? 0;

/** The config an argument names: a bare name (an obj in `inv_total(inv, coins)`), or a local holding one. */
export function nameOf(e: Expr | undefined, env: ReadonlyMap<string, Value>): string | undefined {
    if (e?.t !== 'name' || e.args !== null) return undefined;
    if (e.name.startsWith('$')) {
        const v = env.get(e.name);
        return v?.t === 'name' ? v.v : undefined;
    }
    return /^[a-z0-9_]+$/.test(e.name) ? e.name : undefined;
}

/** How a walker evaluates an expression and reads a config name (`inv`, an obj) on one path. */
export interface ConditionContext {
    evaluate(e: Expr): Value;
    /** The config a bare name or a local holding one names; undefined for anything else. */
    nameOf(e: Expr | undefined): string | undefined;
}

/** The quest points varp (general/scripts/quests.rs2 counts them into it). */
const QUEST_POINTS = '%qp';

/**
 * Tool-checker procs, by `~name`, with the obj categories they accept: a proc whose returns are each an obj
 * (`return(rune_axe);`) under an `if` that tests that obj (worn in the right hand or carried), but the
 * last, `return(null);`, and whose objs all have a category in their config. `~pickaxe_checker`
 * (skill_mining/scripts/pickaxe_checker.rs2:1) returns one of six pickaxes, all `weapon_pickaxe`; a script
 * that tests its result against `null` needs one. A `*_checker` proc of that shape that fails any of this
 * is listed in `skipped` with why (`~god_staff_checker` returns a staff for a god cape held,
 * areas/area_mage_arena/scripts/chamber_guardian.rs2:51), for the build to warn of.
 */
export function toolCheckers(
    callables: readonly Callable[],
    objCategory: ReadonlyMap<string, string>,
): { tools: Map<string, string[]>; skipped: string[] } {
    const tools = new Map<string, string[]>();
    const skipped: string[] = [];
    for (const c of callables) {
        if (!c.call.startsWith('~') || !/\breturn\s*\(\s*null\s*\)/.test(c.body)) continue;
        const named = c.call.endsWith('_checker');
        const skip = (why: string) => {
            if (named) skipped.push(`${c.call} (${c.file}:${c.line}): ${why}`);
        };
        const script = parseScript(c.file, c.line, c.body);
        if ('error' in script) {
            skip(`not read: ${script.error}`);
            continue;
        }
        const returned: string[] = [];
        let other: string | undefined;
        const walk = (stmts: readonly Stmt[], guard: string | undefined): void => {
            for (const st of stmts)
                if (st.t === 'return') {
                    const v = st.value;
                    if (v?.t === 'name' && v.args === null && v.name === 'null') continue;
                    if (v?.t !== 'name' || v.args !== null) other ??= `returns \`${v?.text ?? ''}\``;
                    else if (!guard || !new RegExp(`\\b${v.name}\\b`).test(guard))
                        other ??= `returns ${v.name} under \`${guard ?? 'no if'}\`, which does not test it`;
                    else returned.push(v.name);
                } else if (st.t === 'if') {
                    walk(st.yes, st.cond.text);
                    walk(st.no, undefined);
                } else if (st.t === 'switch' || st.t === 'while') other ??= `has a ${st.t}`;
        };
        walk(script.body, undefined);
        const last = script.body.at(-1);
        const missing = returned.filter(o => !objCategory.has(o));
        if (other) skip(other);
        else if (!returned.length || last?.t !== 'return') skip('returns no obj, or does not end in return(null)');
        else if (missing.length) skip(`${missing.join(', ')} has no category`);
        else tools.set(c.call, [...new Set(returned.map(o => objCategory.get(o)!))].sort(cmp));
    }
    return { tools, skipped };
}

/** The commands the reader takes as a condition's subject, beside varps (`%name`) and the procs it is given. */
const SUBJECTS = ['map_members', 'inv_total', 'inv_totalcat', 'inv_getobj', 'stat', 'stat_base', 'last_useitem'];
/** The SUBJECTS written without arguments; the others are calls (`stat(`, not the `stat` type). */
const WORD_SUBJECTS = new Set(['map_members', 'last_useitem']);
/**
 * The SUBJECTS that don't make a callee's code a condition: `inv_getobj` reads the equipment in the procs
 * every move runs through (`~playerwalk`, `~update_bas`, `~player_teleport_normal`) to pick animations, and
 * walking those takes each crossing past the walker's path bound. A trigger's own `inv_getobj(worn, slot)
 * = obj` is still read.
 */
const NOT_IN_CALLEES = new Set(['inv_getobj']);

/**
 * Whether a callee's code names a subject conditionReader reads: a varp (quest progress, `%qp`), one of
 * SUBJECTS (but NOT_IN_CALLEES), a loadout proc or a tool checker. The gate scan (sources/gate-scan.ts)
 * treats a moving proc whose code (and callees) names none as one move, so the two share this list.
 */
export function readsSubjects(
    loadoutProcs: Readonly<Record<string, LoadoutProc>>,
    tools: ReadonlyMap<string, readonly string[]> = new Map(),
): RegExp {
    const subjects = SUBJECTS.filter(s => !NOT_IN_CALLEES.has(s));
    const calls = subjects.filter(s => !WORD_SUBJECTS.has(s));
    const words = [
        ...subjects.filter(s => WORD_SUBJECTS.has(s)),
        ...Object.values(loadoutProcs).map(p => p.call),
        ...tools.keys(),
    ];
    return new RegExp(
        `%[a-z]|(?<![a-z0-9_])(?:${calls.join('|')})\\s*\\(|(?<![a-z0-9_])(?:${words.join('|')})(?![a-z0-9_])`,
    );
}

/**
 * Reads conditions against the quest table, the loadout procs and the tool checkers (toolCheckers):
 * `read(e, want, ctx)` is what `e` taken as `want` says (Reading).
 */
export function conditionReader(
    quests: readonly Quest[],
    loadoutProcs: Readonly<Record<string, LoadoutProc>>,
    tools: ReadonlyMap<string, readonly string[]> = new Map(),
): (e: Expr, want: boolean, ctx: ConditionContext) => Reading {
    // Quest varps by the name the scripts use (a varbit's, or the varp's when progress is the whole varp).
    const questOf = new Map<string, QuestRef>();
    for (const q of quests)
        for (const v of [q, ...(q.or ?? [])]) {
            const name = v.varbit ? `%${v.varbit}` : v.bits ? undefined : `%${v.varp}`;
            if (name) questOf.set(name, { quest: q, varp: name, complete: v.complete, own: v === q });
        }
    const loadoutOf = new Map(Object.entries(loadoutProcs).map(([id, p]) => [p.call, { id, ...p }]));
    const isSubject = (x: Expr): boolean =>
        x.t === 'name' &&
        (questOf.has(x.name) || SUBJECTS.includes(x.name) || x.name === QUEST_POINTS || loadoutOf.has(x.name));

    return (e, want, ctx) => {
        // A bare boolean (`if (~has_x)`) reads as `~has_x = true`.
        const [l, op0, r] = e.t === 'bin' && NEGATE[e.op] ? [e.l, e.op, e.r] : [e, '=', TRUE];
        const [lhs, rhs, op1] = !isSubject(l) && isSubject(r) ? [r, l, FLIP[op0]!] : [l, r, op0];
        const op = want ? op1 : NEGATE[op1]!;
        if (lhs.t !== 'name') return { k: 'other', subject: false };
        const eq = op === '=' || op === '!';

        // A tool checker's result (called here, or held in a local) against null: the obj it finds is worn
        // in the right hand or carried (skill_mining/scripts/pickaxe_checker.rs2:3).
        const held = ctx.evaluate(lhs);
        const checker = held.t === 'unknown' ? held.text.match(/^~[a-z0-9_]+/)?.[0] : undefined;
        const categories = checker ? tools.get(checker) : undefined;
        if (categories && eq && rhs.t === 'name' && rhs.name === 'null' && rhs.args === null)
            return {
                k: 'category',
                ways: categories.flatMap(category => [
                    { category, where: 'inv' as const },
                    { category, where: 'worn' as const },
                ]),
                has: op === '!',
            };
        const unread: Reading = { k: 'other', subject: isSubject(lhs) || !!categories };

        if (lhs.name === 'map_members' && lhs.args === null && eq) {
            const truth = truthOf(ctx.evaluate(rhs));
            return truth === undefined ? unread : { k: 'members', holds: truth === (op === '=') };
        }

        const loadout = loadoutOf.get(lhs.name);
        if (loadout && !lhs.args?.length && eq) {
            const truth = truthOf(ctx.evaluate(rhs));
            // Whether the path takes the proc as returning true; what true means is the proc's polarity.
            const isTrue = truth === (op === '=');
            return truth === undefined
                ? unread
                : { k: 'loadout', rule: loadout.id, clear: loadout.trueWhen === 'clear' ? isTrue : !isTrue };
        }

        const ref = questOf.get(lhs.name);
        if (ref && lhs.args === null) {
            const v = ctx.evaluate(rhs);
            if (v.t !== 'int') return unread;
            // The constant it was written as, here or where the value was passed in (a proc's argument).
            const name = rhs.t === 'name' && rhs.name.startsWith('^') ? rhs.name : v.name;
            return { k: 'quest', ref, op, n: v.n, ...(name ? { name } : {}) };
        }

        // A count to compare with: a number, or a range's top (`~random_range`).
        const count = (): number | undefined => {
            const v = ctx.evaluate(rhs);
            return v.t === 'int' ? v.n : v.t === 'range' ? v.hi : undefined;
        };

        if (lhs.name === QUEST_POINTS && lhs.args === null) {
            const n = count();
            return n === undefined ? unread : { k: 'questpoints', least: leastOf(op, n) };
        }

        if (lhs.name === 'inv_totalcat' && lhs.args?.length === 2) {
            const where = ctx.nameOf(lhs.args[0]);
            const category = ctx.nameOf(lhs.args[1]);
            const n = count();
            if ((where !== 'inv' && where !== 'worn') || !category || n === undefined) return unread;
            return { k: 'category', ways: [{ category, where }], has: leastOf(op, n) > 0 };
        }

        if (lhs.name === 'inv_total' && lhs.args?.length === 2) {
            const where = ctx.nameOf(lhs.args[0]);
            const obj = ctx.nameOf(lhs.args[1]);
            const n = count();
            if ((where !== 'inv' && where !== 'worn') || !obj || n === undefined) return unread;
            return { k: 'inv', where, obj, least: leastOf(op, n) };
        }

        // `inv_getobj(worn, <slot>) = obj`: wearing obj (in that slot), as the sewer pipe's gas mask check
        // (quests/quest_elena/scripts/sewerpipe.rs2:5).
        if (lhs.name === 'inv_getobj' && lhs.args?.length === 2 && eq && ctx.nameOf(lhs.args[0]) === 'worn') {
            const obj = ctx.nameOf(rhs);
            return obj && obj !== 'null' ? { k: 'inv', where: 'worn', obj, least: op === '=' ? 1 : 0 } : unread;
        }

        if ((lhs.name === 'stat' || lhs.name === 'stat_base') && lhs.args?.length === 1) {
            const skill = lhs.args[0]?.t === 'name' && lhs.args[0].args === null ? lhs.args[0].name : undefined;
            const n = count();
            if (!skill || !/^[a-z]+$/.test(skill) || n === undefined) return unread;
            return { k: 'stat', skill, least: leastOf(op, n) };
        }

        if (lhs.name === 'last_useitem' && lhs.args === null && eq) {
            const obj = ctx.nameOf(rhs);
            return obj ? { k: 'useitem', obj, is: op === '=' } : unread;
        }
        return unread;
    };
}
