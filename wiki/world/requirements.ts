// What a way through the world needs: a gate's condition, a transport's fare, a quest. A requirement has
// a canonical string form, which world.json writes; a set of them is written sorted and each once
// (requirementSet), so two sets compare as string lists:
//
//   quest:<id>             the quest is done: its varp >= complete (World.quests)
//   quest:<id>>=<stage>    the quest's varp has reached <stage>: a stage below complete opens part-way
//                          (completion meets it too), one above complete is a step after it (Priest in
//                          Peril's holy barrier, areas/area_mausoleum/scripts/holy_barrier.rs2:2)
//   skill:<skill>:<level>  a base level
//   item:<obj>:worn|held   wearing, or carrying, the obj (the Zanaris shed checks a worn dramen staff)
//   coins:<n>              n coins taken per crossing (a toll, a fare)
//   consume:<obj>:<n>      n of the obj taken per crossing (a Shantay pass, a ship ticket)
//   members                a members world
//   loadout:<id>           carrying none of a loadout rule's categories (World.loadoutRules)
//   other:<text>           a condition none of these forms fit; the build report lists each one
import { cmp } from './util';

export type Requirement =
    | { kind: 'quest'; quest: string; stage?: number }
    | { kind: 'skill'; skill: string; level: number }
    | { kind: 'item'; obj: string; how: 'worn' | 'held' }
    | { kind: 'coins'; n: number }
    | { kind: 'consume'; obj: string; n: number }
    | { kind: 'members' }
    | { kind: 'loadout'; rule: string }
    | { kind: 'other'; text: string };

const ID = /^[a-z0-9_]+$/;

/** The canonical string of a requirement. Throws on a malformed one (an id that isn't `[a-z0-9_]+`). */
export function formatRequirement(r: Requirement): string {
    const ids = (...xs: string[]) => {
        for (const x of xs) if (!ID.test(x)) throw new Error(`requirement ${JSON.stringify(r)}: \`${x}\` is not an id`);
    };
    const count = (n: number) => {
        if (!Number.isSafeInteger(n) || n < 0)
            throw new Error(`requirement ${JSON.stringify(r)}: ${n} is not a whole number`);
    };
    switch (r.kind) {
        case 'quest':
            ids(r.quest);
            if (r.stage === undefined) return `quest:${r.quest}`;
            count(r.stage);
            return `quest:${r.quest}>=${r.stage}`;
        case 'skill':
            ids(r.skill);
            count(r.level);
            return `skill:${r.skill}:${r.level}`;
        case 'item':
            ids(r.obj);
            return `item:${r.obj}:${r.how}`;
        case 'coins':
            count(r.n);
            return `coins:${r.n}`;
        case 'consume':
            ids(r.obj);
            count(r.n);
            return `consume:${r.obj}:${r.n}`;
        case 'members':
            return 'members';
        case 'loadout':
            ids(r.rule);
            return `loadout:${r.rule}`;
        case 'other':
            if (!r.text.trim()) throw new Error('requirement other: the text is empty');
            return `other:${r.text}`;
    }
}

const FORMS: [RegExp, (m: RegExpMatchArray) => Requirement][] = [
    [/^quest:([a-z0-9_]+)$/, m => ({ kind: 'quest', quest: m[1]! })],
    [/^quest:([a-z0-9_]+)>=(\d+)$/, m => ({ kind: 'quest', quest: m[1]!, stage: Number(m[2]) })],
    [/^skill:([a-z0-9_]+):(\d+)$/, m => ({ kind: 'skill', skill: m[1]!, level: Number(m[2]) })],
    [/^item:([a-z0-9_]+):(worn|held)$/, m => ({ kind: 'item', obj: m[1]!, how: m[2] as 'worn' | 'held' })],
    [/^coins:(\d+)$/, m => ({ kind: 'coins', n: Number(m[1]) })],
    [/^consume:([a-z0-9_]+):(\d+)$/, m => ({ kind: 'consume', obj: m[1]!, n: Number(m[2]) })],
    [/^members$/, () => ({ kind: 'members' })],
    [/^loadout:([a-z0-9_]+)$/, m => ({ kind: 'loadout', rule: m[1]! })],
    [/^other:(.*\S.*)$/s, m => ({ kind: 'other', text: m[1]! })],
];

/** A requirement from its canonical string; throws on a string in none of the forms. */
export function parseRequirement(s: string): Requirement {
    for (const [re, make] of FORMS) {
        const m = s.match(re);
        if (m) {
            const r = make(m);
            // A number with a leading zero (`coins:010`) is not canonical: it would not round-trip.
            if (formatRequirement(r) !== s) break;
            return r;
        }
    }
    throw new Error(`\`${s}\` is not a requirement (see wiki/world/requirements.ts)`);
}

/**
 * A requirement set as world.json writes it: canonical strings, each once, in code-unit order. The
 * order is only for determinism (`coins:10` sorts before `coins:9`).
 */
export function requirementSet(rs: readonly (Requirement | string)[]): string[] {
    const strings = rs.map(r =>
        typeof r === 'string' ? formatRequirement(parseRequirement(r)) : formatRequirement(r),
    );
    return [...new Set(strings)].sort(cmp);
}

/** Whether set `a` asks for no more than set `b` (both canonical, as requirementSet gives them). */
export const subsetOf = (a: readonly string[], b: readonly string[]): boolean => a.every(x => b.includes(x));

/**
 * The minimal sets among `sets`: each canonical (requirementSet), each once, without any set that
 * another one asks less than (a strict superset of another is dropped). Sorted by size, then by the
 * strings, so the result is deterministic.
 */
export function minimalSets(sets: readonly (readonly (Requirement | string)[])[]): string[][] {
    const unique = new Map<string, string[]>();
    for (const s of sets) {
        const set = requirementSet(s);
        unique.set(set.join('\n'), set);
    }
    const all = [...unique.values()];
    return all
        .filter(s => !all.some(o => o !== s && o.length < s.length && subsetOf(o, s)))
        .sort((a, b) => a.length - b.length || cmp(a.join('\n'), b.join('\n')));
}
