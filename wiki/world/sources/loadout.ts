// Loadout rules: a ban on carrying or wearing any obj of some categories (and some objs by name), read
// from the proc that checks it. Entrana's (`[proc,has_entrana_restricted_items]`,
// areas/area_port_sarim/scripts/monk_of_entrana.rs2:26) is one `if` over `inv_totalcat(inv, <category>) >
// 0 | inv_totalcat(worn, <category>) > 0` terms that returns true, then `return(false)`; the Mage Arena's
// (`[proc,can_enter_mage_arena]`, areas/area_mage_arena/scripts/mage_arena.rs2:100) is the same with the
// returns swapped (true when the player is clear) and some `inv_total(inv, <obj>) > 0` terms too. The ban
// is by category or obj, not equip slot: an obj in neither (ice gloves) passes.
import type { LoadoutRule, LoadoutScope } from '../types';
import { cmp } from '../util';
import { parseScript, type Expr } from './runescript';
import type { Callable } from './triggers';

/**
 * A proc that checks a loadout rule: `call`, and what its `true` means: the player carries something
 * banned (`banned`, Entrana's), or is clear of it (`clear`, the Mage Arena's).
 */
export interface LoadoutProc {
    call: string;
    trueWhen: 'banned' | 'clear';
}

const scopeOf = (s: ReadonlySet<'inv' | 'worn'>): LoadoutScope =>
    s.size === 2 ? 'both' : s.has('inv') ? 'carried' : 'worn';

const sorted = (m: ReadonlyMap<string, ReadonlySet<'inv' | 'worn'>>): Record<string, LoadoutScope> =>
    Object.fromEntries([...m].sort(([a], [b]) => cmp(a, b)).map(([c, s]) => [c, scopeOf(s)]));

/**
 * The rule a proc of that form holds; throws naming the construct (and its line) when the proc is any
 * other form, so a changed proc fails the build instead of yielding a partial rule.
 */
export function deriveLoadoutRule(proc: Callable, trueWhen: LoadoutProc['trueWhen'] = 'banned'): LoadoutRule {
    const where = `${proc.file}:${proc.line}`;
    const script = parseScript(proc.file, proc.line, proc.body);
    if ('error' in script) throw new Error(`loadout proc ${proc.call} (${where}): ${script.error}`);
    const [check, last, ...rest] = script.body;
    const returns = (s: (typeof script.body)[number] | undefined, b: string): boolean =>
        s?.t === 'return' && s.value?.t === 'name' && s.value.name === b && s.value.args === null;
    const [banned, clear] = trueWhen === 'banned' ? ['true', 'false'] : ['false', 'true'];
    if (
        check?.t !== 'if' ||
        check.no.length ||
        check.yes.length !== 1 ||
        !returns(check.yes[0], banned) ||
        !returns(last, clear) ||
        rest.length
    )
        throw new Error(
            `loadout proc ${proc.call} (${where}) is not \`if (<category terms>) { return(${banned}); } return(${clear});\``,
        );

    const categories = new Map<string, Set<'inv' | 'worn'>>();
    const objs = new Map<string, Set<'inv' | 'worn'>>();
    const term = (e: Expr): void => {
        if (e.t === 'bin' && e.op === '|') {
            term(e.l);
            term(e.r);
            return;
        }
        const call = e.t === 'bin' && e.op === '>' && e.r.t === 'num' && e.r.n === 0 ? e.l : undefined;
        const by = call?.t === 'name' ? { inv_totalcat: categories, inv_total: objs }[call.name] : undefined;
        const [inv, name] = by && call?.t === 'name' ? (call.args ?? []) : [];
        if (
            !by ||
            inv?.t !== 'name' ||
            (inv.name !== 'inv' && inv.name !== 'worn') ||
            name?.t !== 'name' ||
            name.args !== null
        )
            throw new Error(
                `loadout proc ${proc.call}: \`${e.text}\` (${proc.file}:${e.line}) is not inv_totalcat(inv|worn, <category>) > 0 or inv_total(inv|worn, <obj>) > 0`,
            );
        const set = by.get(name.name) ?? new Set();
        set.add(inv.name);
        by.set(name.name, set);
    };
    term(check.cond);

    return {
        forbidCategories: sorted(categories),
        ...(objs.size ? { forbidObjs: sorted(objs) } : {}),
        source: where,
    };
}

/** Every rule in `procs` (id -> its proc), from the callables; throws on a proc no script defines. */
export function deriveLoadoutRules(
    procs: Readonly<Record<string, LoadoutProc>>,
    callables: readonly Callable[],
): Record<string, LoadoutRule> {
    const byCall = new Map(callables.map(c => [c.call, c]));
    return Object.fromEntries(
        Object.entries(procs)
            .sort(([a], [b]) => cmp(a, b))
            .map(([id, { call, trueWhen }]) => {
                const proc = byCall.get(call);
                if (!proc) throw new Error(`loadout rule ${id}: no script defines ${call}`);
                return [id, deriveLoadoutRule(proc, trueWhen)];
            }),
    );
}
