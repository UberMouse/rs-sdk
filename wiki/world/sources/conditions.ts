// What one script condition says about the player, shared by the walkers that turn conditions into
// requirements (sources/transports.ts, sources/gate-scan.ts). A condition is read as `subject op value`,
// the subject on the left (`^stage > %varp` reads as `%varp < ^stage`) and the op negated when the path
// takes it false; each walker then maps the reading to what it means on its paths.
import type { Quest } from '../types';
import { truthOf, type Value } from './evaluate';
import type { Expr } from './runescript';

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

/**
 * Reads conditions against the quest table and the loadout procs: `read(e, want, ctx)` is what `e`
 * taken as `want` says (Reading).
 */
export function conditionReader(
    quests: readonly Quest[],
    loadoutProcs: Readonly<Record<string, string>>,
): (e: Expr, want: boolean, ctx: ConditionContext) => Reading {
    // Quest varps by the name the scripts use (a varbit's, or the varp's when progress is the whole varp).
    const questOf = new Map<string, QuestRef>();
    for (const q of quests)
        for (const v of [q, ...(q.or ?? [])]) {
            const name = v.varbit ? `%${v.varbit}` : v.bits ? undefined : `%${v.varp}`;
            if (name) questOf.set(name, { quest: q, varp: name, complete: v.complete, own: v === q });
        }
    const loadoutOf = new Map(Object.entries(loadoutProcs).map(([id, proc]) => [proc, id]));
    const isSubject = (x: Expr): boolean =>
        x.t === 'name' &&
        (questOf.has(x.name) ||
            x.name === 'map_members' ||
            x.name === 'inv_total' ||
            x.name === 'inv_getobj' ||
            x.name === 'stat' ||
            x.name === 'stat_base' ||
            x.name === 'last_useitem' ||
            loadoutOf.has(x.name));

    return (e, want, ctx) => {
        // A bare boolean (`if (~has_x)`) reads as `~has_x = true`.
        const [l, op0, r] = e.t === 'bin' && NEGATE[e.op] ? [e.l, e.op, e.r] : [e, '=', TRUE];
        const [lhs, rhs, op1] = !isSubject(l) && isSubject(r) ? [r, l, FLIP[op0]!] : [l, r, op0];
        const op = want ? op1 : NEGATE[op1]!;
        if (lhs.t !== 'name') return { k: 'other', subject: false };
        const unread: Reading = { k: 'other', subject: isSubject(lhs) };
        const eq = op === '=' || op === '!';

        if (lhs.name === 'map_members' && lhs.args === null && eq) {
            const truth = truthOf(ctx.evaluate(rhs));
            return truth === undefined ? unread : { k: 'members', holds: truth === (op === '=') };
        }

        const loadout = loadoutOf.get(lhs.name);
        if (loadout && lhs.args === null && eq) {
            const truth = truthOf(ctx.evaluate(rhs));
            return truth === undefined ? unread : { k: 'loadout', rule: loadout, clear: truth !== (op === '=') };
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
