// Loadout rules: a ban on carrying or wearing any obj of some categories, read from the proc that checks
// it. Entrana's (`[proc,has_entrana_restricted_items]`, areas/area_port_sarim/scripts/monk_of_entrana.rs2:26)
// is one `if` over `inv_totalcat(inv, <category>) > 0 | inv_totalcat(worn, <category>) > 0` terms that
// returns true, then `return(false)`. The ban is by category, not equip slot: an obj with no category
// (ice gloves) passes.
import type { LoadoutRule, LoadoutScope } from '../types';
import { cmp } from '../util';
import { parseScript, type Expr } from './runescript';
import type { Callable } from './triggers';

const scopeOf = (s: ReadonlySet<'inv' | 'worn'>): LoadoutScope =>
    s.size === 2 ? 'both' : s.has('inv') ? 'carried' : 'worn';

/**
 * The rule a proc of that form holds; throws naming the construct (and its line) when the proc is any
 * other form, so a changed proc fails the build instead of yielding a partial rule.
 */
export function deriveLoadoutRule(proc: Callable): LoadoutRule {
    const where = `${proc.file}:${proc.line}`;
    const script = parseScript(proc.file, proc.line, proc.body);
    if ('error' in script) throw new Error(`loadout proc ${proc.call} (${where}): ${script.error}`);
    const [check, last, ...rest] = script.body;
    const returns = (s: (typeof script.body)[number] | undefined, b: string): boolean =>
        s?.t === 'return' && s.value?.t === 'name' && s.value.name === b && s.value.args === null;
    if (
        check?.t !== 'if' ||
        check.no.length ||
        check.yes.length !== 1 ||
        !returns(check.yes[0], 'true') ||
        !returns(last, 'false') ||
        rest.length
    )
        throw new Error(
            `loadout proc ${proc.call} (${where}) is not \`if (<category terms>) { return(true); } return(false);\``,
        );

    const scopes = new Map<string, Set<'inv' | 'worn'>>();
    const term = (e: Expr): void => {
        if (e.t === 'bin' && e.op === '|') {
            term(e.l);
            term(e.r);
            return;
        }
        const call = e.t === 'bin' && e.op === '>' && e.r.t === 'num' && e.r.n === 0 ? e.l : undefined;
        const [inv, category] = call?.t === 'name' && call.name === 'inv_totalcat' ? (call.args ?? []) : [];
        if (
            inv?.t !== 'name' ||
            (inv.name !== 'inv' && inv.name !== 'worn') ||
            category?.t !== 'name' ||
            category.args !== null
        )
            throw new Error(
                `loadout proc ${proc.call}: \`${e.text}\` (${proc.file}:${e.line}) is not inv_totalcat(inv|worn, <category>) > 0`,
            );
        const set = scopes.get(category.name) ?? new Set();
        set.add(inv.name);
        scopes.set(category.name, set);
    };
    term(check.cond);

    return {
        forbidCategories: Object.fromEntries(
            [...scopes].sort(([a], [b]) => cmp(a, b)).map(([c, s]) => [c, scopeOf(s)]),
        ),
        source: where,
    };
}

/** Every rule in `procs` (id -> `~proc`), from the callables; throws on a proc no script defines. */
export function deriveLoadoutRules(
    procs: Readonly<Record<string, string>>,
    callables: readonly Callable[],
): Record<string, LoadoutRule> {
    const byCall = new Map(callables.map(c => [c.call, c]));
    return Object.fromEntries(
        Object.entries(procs)
            .sort(([a], [b]) => cmp(a, b))
            .map(([id, call]) => {
                const proc = byCall.get(call);
                if (!proc) throw new Error(`loadout rule ${id}: no script defines ${call}`);
                return [id, deriveLoadoutRule(proc)];
            }),
    );
}
