// What a way through the world needs: a gate's condition, a transport's fare, a quest. A requirement has
// a canonical string form, which world.json writes; a set of them is written sorted and each once
// (requirementSet), with the requirements another of the set implies merged away (canonicalSet), and one set
// asks no more than another when each of its requirements is implied by one of the other's (dominates):
//
//   quest:<id>             the quest is done: its varp >= complete (World.quests)
//   quest:<id>>=<stage>    the quest's varp has reached <stage>: a stage below complete opens part-way
//                          (completion meets it too), one above complete is a step after it (Priest in
//                          Peril's holy barrier, areas/area_mausoleum/scripts/holy_barrier.rs2:2)
//   skill:<skill>:<level>  a base level
//   item:<obj>:worn|held   wearing, or carrying, the obj (the Zanaris shed checks a worn dramen staff)
//   category:<category>:worn|held
//                          wearing, or carrying, any obj of an obj-config category: an `inv_totalcat`
//                          check, or a tool-checker proc's objs (`~pickaxe_checker` returns a weapon_pickaxe)
//   questpoints:<n>        at least n quest points (`%qp >= n`, the Champions' Guild door)
//   coins:<n>              n coins taken per crossing (a toll, a fare); in a set, the coins of every crossing
//                          on the way summed, as each spends its own
//   consume:<obj>:<n>      n of the obj taken per crossing (a Shantay pass, a ship ticket); in a set, as coins,
//                          each obj's count over every crossing on the way summed
//   members                a members world
//   loadout:<id>           carrying none of a loadout rule's categories (World.loadoutRules)
//   other:<text>           a condition none of these forms fit; the build report lists each one
//   other:came from <npc>  the way came in by the npc's teleport (cameFrom): a way out that returns to where the
//                          player came from (the essence mine's portals) has one per npc
//   other:came from *      (ANY_CAME_FROM) met by an account in the essence mine with no wizard on record: any
//                          wizard's way out; never a requirement of the index, only a token an account carries
import { cmp } from './util';

export type Requirement =
    | { kind: 'quest'; quest: string; stage?: number }
    | { kind: 'skill'; skill: string; level: number }
    | { kind: 'item'; obj: string; how: 'worn' | 'held' }
    | { kind: 'category'; category: string; how: 'worn' | 'held' }
    | { kind: 'questpoints'; n: number }
    | { kind: 'coins'; n: number }
    | { kind: 'consume'; obj: string; n: number }
    | { kind: 'members' }
    | { kind: 'loadout'; rule: string }
    | { kind: 'other'; text: string };

const ID = /^[a-z0-9_]+$/;

/** The prefix of a came-from requirement (cameFrom). */
export const CAME_FROM = 'other:came from ';
/**
 * The requirement of a way out that returns to the npc the way came in by (sources/npc-teleports.ts): no account
 * holds it, but a way that came in by the npc's op meets it, which distance.ts lets a context say
 * (NearestOptions.context).
 */
export const cameFrom = (npc: string): string => `${CAME_FROM}${npc}`;
/**
 * Met by an account standing in the essence mine that does not know which wizard it came in by: any wizard's way out
 * (lib/account.ts meetsToken). An account outside the mine meets no way out, as it could only come in by one wizard
 * and out by the same.
 */
export const ANY_CAME_FROM = `${CAME_FROM}*`;

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
        case 'category':
            ids(r.category);
            return `category:${r.category}:${r.how}`;
        case 'questpoints':
            count(r.n);
            return `questpoints:${r.n}`;
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
    [/^category:([a-z0-9_]+):(worn|held)$/, m => ({ kind: 'category', category: m[1]!, how: m[2] as 'worn' | 'held' })],
    [/^questpoints:(\d+)$/, m => ({ kind: 'questpoints', n: Number(m[1]) })],
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

/** Whether every string of `a` is in `b`. */
export const subsetOf = (a: readonly string[], b: readonly string[]): boolean => a.every(x => b.includes(x));

/**
 * What a set's canonical form needs to know of a quest (World.quests): the progress it is done at, and
 * whether another varp shows it done too (Quest.or), so that `quest:<id>` does not imply a stage of its varp.
 */
export type QuestFacts = ReadonlyMap<string, { complete: number; or: boolean }>;

export const questFacts = (quests: readonly { id: string; complete: number; or?: readonly unknown[] }[]): QuestFacts =>
    new Map(quests.map(q => [q.id, { complete: q.complete, or: (q.or?.length ?? 0) > 0 }]));

/**
 * A set with the requirements another of it implies merged away, as world.json writes it (requirementSet's
 * order): of a quest's stages the highest, of a skill's levels and the quest points the largest, the coins
 * and each obj's consume summed (each crossing on the way takes its own). With `quests`, a stage at or below
 * complete beside `quest:<id>` goes, as completion meets it, and `quest:<id>` beside a stage at or above
 * complete, as the stage meets it. A quest done by another varp too (QuestFacts.or) keeps a stage below
 * complete beside `quest:<id>`, which the other varp may meet instead; for any other, `quest:<id>>=<complete>`
 * is `quest:<id>`.
 */
export function canonicalSet(rs: readonly (Requirement | string)[], quests?: QuestFacts): string[] {
    const parsed = rs.map(r => (typeof r === 'string' ? parseRequirement(r) : r));
    let coins = 0;
    const consumed = new Map<string, number>();
    const most = new Map<string, Requirement>();
    const keepMost = (key: string, r: Requirement, n: number, of: (x: Requirement) => number): void => {
        const had = most.get(key);
        if (!had || n > of(had)) most.set(key, r);
    };
    const done = new Set<string>();
    const stage = new Map<string, number>();
    const rest: Requirement[] = [];
    for (const r of parsed)
        switch (r.kind) {
            case 'coins':
                coins += r.n;
                break;
            case 'skill':
                keepMost(`skill:${r.skill}`, r, r.level, x => (x.kind === 'skill' ? x.level : 0));
                break;
            case 'questpoints':
                keepMost('questpoints', r, r.n, x => (x.kind === 'questpoints' ? x.n : 0));
                break;
            case 'consume':
                consumed.set(r.obj, (consumed.get(r.obj) ?? 0) + r.n);
                break;
            case 'quest':
                if (r.stage === undefined) done.add(r.quest);
                else stage.set(r.quest, Math.max(stage.get(r.quest) ?? 0, r.stage));
                break;
            default:
                rest.push(r);
        }
    const out: Requirement[] = [...rest, ...most.values()];
    if (coins > 0) out.push({ kind: 'coins', n: coins });
    for (const [obj, n] of consumed) if (n > 0) out.push({ kind: 'consume', obj, n });
    for (const id of new Set([...done, ...stage.keys()])) {
        const facts = quests?.get(id);
        let [isDone, at] = [done.has(id), stage.get(id)];
        if (facts && at !== undefined) {
            if (!facts.or && at === facts.complete) [isDone, at] = [true, undefined];
            else if (isDone && !facts.or && at < facts.complete) at = undefined;
            else if (at >= facts.complete) isDone = false;
        }
        if (isDone) out.push({ kind: 'quest', quest: id });
        if (at !== undefined) out.push({ kind: 'quest', quest: id, stage: at });
    }
    return requirementSet(out);
}

/** Whether requirement `b` is met whenever `a` is (canonical strings; `quests` as canonicalSet takes them). */
function implies(a: Requirement, b: Requirement, quests?: QuestFacts): boolean {
    switch (b.kind) {
        case 'quest': {
            if (a.kind !== 'quest' || a.quest !== b.quest) return false;
            const facts = quests?.get(b.quest);
            if (b.stage === undefined)
                return a.stage === undefined || (facts !== undefined && a.stage >= facts.complete);
            if (a.stage !== undefined) return a.stage >= b.stage;
            return facts !== undefined && !facts.or && b.stage <= facts.complete;
        }
        case 'skill':
            return a.kind === 'skill' && a.skill === b.skill && a.level >= b.level;
        case 'questpoints':
            return a.kind === 'questpoints' && a.n >= b.n;
        case 'coins':
            return a.kind === 'coins' && a.n >= b.n;
        case 'consume':
            return a.kind === 'consume' && a.obj === b.obj && a.n >= b.n;
        default:
            return formatRequirement(a) === formatRequirement(b);
    }
}

/**
 * Whether set `a` asks for no more than set `b` (both canonical): each requirement of `a` is implied by one of
 * `b`'s (the same quest at a stage as high or done, the same skill as high, as many coins or more, an
 * identical requirement).
 */
export function dominates(a: readonly string[], b: readonly string[], quests?: QuestFacts): boolean {
    const bs = b.map(parseRequirement);
    return a.every(x => {
        const r = parseRequirement(x);
        return bs.some(y => implies(y, r, quests));
    });
}

/**
 * The ways to use a site: each set a walk gets there with (`walk`) joined with each set using it asks (`gated`),
 * the minimal ones. A site whose use asks nothing (`gated` the one empty set) keeps `walk` as it is, so `walk` must
 * be minimal already, as reach.ts Reach's setsAt and setsAny return it.
 */
export function joinUse(
    walk: readonly (readonly string[])[],
    gated: readonly (readonly string[])[],
    quests?: QuestFacts,
): string[][] {
    if (gated.length === 1 && !gated[0]!.length) return walk.map(w => [...w]);
    return minimalSets(
        walk.flatMap(w => gated.map(g => [...w, ...g])),
        quests,
    );
}

/** Sets by size, then by their strings. */
const bySizeThenStrings = (a: readonly string[], b: readonly string[]): number =>
    a.length - b.length || cmp(a.join('\n'), b.join('\n'));

/**
 * The minimal sets among `sets`: each canonical (canonicalSet), each once, without any set another dominates.
 * Sorted by size, then by the strings, so the result is deterministic.
 */
export function minimalSets(sets: readonly (readonly (Requirement | string)[])[], quests?: QuestFacts): string[][] {
    const unique = new Map<string, string[]>();
    for (const s of sets) {
        const set = canonicalSet(s, quests);
        unique.set(set.join('\n'), set);
    }
    const all = [...unique.values()].sort(bySizeThenStrings);
    // Two canonical sets that dominate each other keep the first in that order.
    return all.filter(
        (s, i) => !all.some((o, j) => j !== i && dominates(o, s, quests) && (j < i || !dominates(s, o, quests))),
    );
}
