// What a loc or npc config is for, read from the game data that uses it: the dbrows that list it
// and the script triggers on it (or on its category), and what those triggers change it into. A
// config no rule claims is scenery.
import type { Config } from './sources/configs';
import { first } from './sources/configs';
import type { DbRow } from './sources/dbrows';
import type { Callable, Trigger } from './sources/triggers';
import type { FeatureKind } from './types';

export interface ClassifyInput {
    locConfigs: Map<string, Config>;
    npcConfigs: Map<string, Config>;
    dbrows: DbRow[];
    triggers: Trigger[];
    /** The labels and procs trigger bodies call, followed through every call. Omitted: none. */
    callables?: Callable[];
}

export interface Classified {
    kind: FeatureKind;
    subtype: string;
    name: string;
}

interface Match {
    kind: FeatureKind;
    subtype: string;
    /** The op slots ('1'-'5', 'u') whose triggers made the match; ANY_OP when no trigger did. */
    ops: string[];
}

type Rule = (on: 'loc' | 'npc', config: string, cfg: Config) => Match | null;

/** A match made by data rather than a trigger: it shares an op with every other match. */
const ANY_OP = '*';

// Loc categories whose triggers make the loc a station (skill_smithing, skill_cooking, skill_crafting,
// general_use/scripts/water_sources.rs2, skill_prayer, skill_runecraft). `cooking_oven` is the range:
// its locs are named Range (skill_cooking/configs/cooking_source/cooking_sources.loc).
const STATIONS: Record<string, FeatureKind> = {
    smithing_furnace: 'furnace',
    anvil: 'anvil',
    cooking_oven: 'range',
    cooking_fire: 'fire',
    spinning_wheel: 'spinning-wheel',
    potters_wheel: 'pottery-wheel',
    pottery_oven: 'pottery-oven',
    sand_pit: 'sand-pit',
    watersource: 'water-source',
    prayer_altar: 'altar',
    rc_altar: 'rc-altar',
    rc_ruins: 'rc-ruins',
};

const COMBAT_PARAMS = new Set([
    'attackbonus',
    'strengthbonus',
    'stabdefence',
    'slashdefence',
    'crushdefence',
    'magicdefence',
    'rangedefence',
]);

/** `param=key,value` lines as a map. */
const params = (cfg: Config): Map<string, string> =>
    new Map(
        (cfg.param ?? []).map(p => {
            const comma = p.indexOf(',');
            return [p.slice(0, comma), p.slice(comma + 1)];
        }),
    );

// The same predicate as hasCombatStats in wiki/generate-npcs.ts, which can't be imported (it runs main).
const hasCombatStats = (cfg: Config): boolean => [...params(cfg).keys()].some(k => COMBAT_PARAMS.has(k));

/**
 * A body as code only: its `//` comments dropped (a `//` inside a "string" is text) and its string
 * text blanked, so neither a commented-out call nor dialogue ("ask ~foo", the `@dbl@` colour tags of
 * levelup/scripts/levelup_unlocks_mining.rs2) counts as a call. A string's `<...>` is an
 * interpolation, which is code (`"<~pluralise(...)>"` calls a proc), so it stays. Inside a string a
 * backslash escapes the next character, so `\"` does not end it. Blanking keeps the quotes and every
 * column, so argsAt still splits a call's arguments where they are; a string argument is never bound
 * (only bare names are), so its text is not needed.
 */
function codeOf(body: string): string {
    return body
        .split('\n')
        .map(line => {
            let out = '';
            let quoted = false;
            let interpolated = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i]!;
                if (!quoted) {
                    if (line.startsWith('//', i)) break;
                    if (ch === '"') quoted = true;
                    out += ch;
                } else if (interpolated) {
                    if (ch === '>') interpolated = false;
                    out += ch;
                } else if (ch === '\\') {
                    out += i + 1 < line.length ? '  ' : ' ';
                    i++;
                } else if (ch === '"') {
                    quoted = false;
                    out += ch;
                } else if (ch === '<') {
                    interpolated = true;
                    out += ch;
                } else out += ' ';
            }
            return out;
        })
        .join('\n');
}

/** A callable's parameter names, from the `(type $name, ...)` list that starts its body. */
const paramsOf = (body: string): string[] =>
    [...(body.match(/^\(([^)]*)\)/)?.[1] ?? '').matchAll(/\$([a-z0-9_]+)/g)].map(m => m[1]!);

/** The arguments of the call whose `(` is at `body[open]`, split at top-level commas; [] when none. */
function argsAt(body: string, open: number): string[] {
    if (body[open] !== '(') return [];
    const args: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = open + 1;
    for (let i = open; i < body.length; i++) {
        const ch = body[i];
        if (quoted) {
            if (ch === '\\') i++;
            else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) {
            args.push(body.slice(start, i).trim());
            break;
        } else if (ch === ',' && depth === 1) {
            args.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    return args.length === 1 && args[0] === '' ? [] : args;
}

/** A tree's subtype: its woodcutting_trees row without `_tree_table` (`yew_tree_table` is `yew`). */
export const treeSubtype = (row: DbRow): string => row.row.replace(/(_tree)?_table$/, '');

/** A rock's subtype: its mining_table row's ore_name, which several rows can share (limestone). */
export const rockSubtype = (row: DbRow): string => row.data.ore_name?.[0]?.[0] ?? '';

const BARE_NAME = /^[a-z0-9_]+$/;

// Labels whose @openbank serves another flow, not banking: Shantay's jail fine is paid through the
// bank ("you'll need access to your bank", areas/area_alkharid/scripts/shantay.rs2
// [label,shantay_ill_pay_the_fine]), which his Talk-to and his prison door both reach.
const BANK_SIDE_EFFECTS: ReadonlySet<string> = new Set(['@shantay_ill_pay_the_fine']);

interface Reached {
    body: string;
    /** False below a BANK_SIDE_EFFECTS label: an @openbank here is not a bank service. */
    banking: boolean;
}

const OPS = ['op1', 'op2', 'op3', 'op4', 'op5'];

const opsOf = (triggers: Trigger[]): string[] => [...new Set(triggers.map(t => t.op))].sort();

/** The ops of `a` that `b` does not also match through. */
const ownOps = (a: string[], b: string[]): string[] =>
    b.includes(ANY_OP) ? [] : a.filter(op => op !== ANY_OP && !b.includes(op));

/**
 * Why two matches on one config can't both stand: an op they share, when either has no op of its
 * own. Both standing needs each to own an op, because a shared dialogue op is normal: Fadli's Talk-to
 * offers the bank and the shop (fadli.rs2 [opnpc1,duel_fadli]), while Bank (op3) and Buy (op4) are
 * each one use.
 */
function clash(a: string[], b: string[]): string | undefined {
    if (ownOps(a, b).length && ownOps(b, a).length) return undefined;
    return a.find(op => b.includes(op)) ?? (a.includes(ANY_OP) ? b[0] : a[0]);
}

// The fallback: an attackable npc no other rule claimed, so it never counts as a second match.
const npc: Rule = (on, config, cfg) =>
    on === 'npc' && OPS.some(op => first(cfg, op) === 'Attack') && hasCombatStats(cfg)
        ? { kind: 'npc', subtype: config, ops: [ANY_OP] }
        : null;

/**
 * Classifies a config into one kind per use. A config has several kinds only when each comes from an
 * op of its own (`duel_fadli`: Bank on op3, Buy on op4); otherwise two matches throw, since that
 * means a rule is too broad.
 */
export function classifier(input: ClassifyInput): (on: 'loc' | 'npc', config: string) => readonly Classified[] {
    const dbrowIndex = (table: string, column: string): Map<string, DbRow> => {
        const out = new Map<string, DbRow>();
        for (const row of input.dbrows.filter(r => r.table === table)) {
            for (const [v] of row.data[column] ?? []) {
                const prior = out.get(v!);
                if (prior) throw new Error(`${table}.${column} lists ${v} in both ${prior.row} and ${row.row}`);
                out.set(v!, row);
            }
        }
        return out;
    };
    const trees = dbrowIndex('woodcutting_trees', 'tree');
    const rocks = dbrowIndex('mining_table', 'rock');
    const runes = dbrowIndex('runecraft_table', 'type');

    const byTarget = new Map<string, Trigger[]>();
    for (const t of input.triggers) {
        const key = `${t.on}:${t.category ? '_' : ''}${t.target}`;
        const list = byTarget.get(key);
        if (list) list.push(t);
        else byTarget.set(key, [t]);
    }
    const callables = new Map(
        (input.callables ?? []).map(c => [c.call, { params: paramsOf(c.body), body: codeOf(c.body) }]),
    );

    /** The triggers on a config, by its name or its category. */
    const triggersOn = (on: 'loc' | 'npc', config: string, cfg: Config): Trigger[] => {
        const category = first(cfg, 'category');
        return [
            ...(byTarget.get(`${on}:${config}`) ?? []),
            ...(category ? (byTarget.get(`${on}:_${category}`) ?? []) : []),
        ];
    };
    /** The ops that make a data-matched config usable: those of its triggers, else any op. */
    const usableOps = (on: 'loc' | 'npc', config: string, cfg: Config): string[] => {
        const ops = opsOf(triggersOn(on, config, cfg));
        return ops.length ? ops : [ANY_OP];
    };
    const under = (dir: string) => (on: 'loc' | 'npc', config: string, cfg: Config) =>
        triggersOn(on, config, cfg).filter(t => t.file.startsWith(dir));

    const reached = new Map<string, Reached[]>();
    /**
     * A body and the bodies of every label and proc it calls, transitively, nearest first. A call's
     * bare-name arguments replace its callee's `$params`, as a label passed by name is how a dialogue
     * menu goes on: `@multi2("Yes.", tut_open_bank, ...)` runs `jump($label1)` (interface_chat/scripts/
     * chat.rs2), and `~open_chest(duel_chestopen)` runs `loc_change($other_chest, 300)` (general_use/
     * scripts/chests.rs2). `jump(<label>)` is a call. Each callee is followed once per argument list
     * (and once more if also reached below a bank side effect); only bare names are bound, so the
     * lists are finite and a cycle ends.
     */
    const reach = (raw: string): Reached[] => {
        const cached = reached.get(raw);
        if (cached) return cached;
        const out: Reached[] = [{ body: codeOf(raw), banking: true }];
        const seen = new Set<string>();
        for (let i = 0; i < out.length; i++) {
            const { body, banking } = out[i]!;
            const calls = [
                ...[...body.matchAll(/[@~][a-z0-9_]+/g)].map(m => ({
                    call: m[0],
                    args: argsAt(body, m.index + m[0].length),
                })),
                ...[...body.matchAll(/\bjump\(([a-z0-9_]+)\)/g)].map(m => ({ call: `@${m[1]}`, args: [] })),
            ];
            for (const { call, args } of calls) {
                const callee = callables.get(call);
                if (!callee) continue;
                const bound = new Map(
                    callee.params.flatMap((p, j) => {
                        const a = args[j] ?? '';
                        return BARE_NAME.test(a) ? [[p, a]] : [];
                    }),
                );
                const banks = banking && !BANK_SIDE_EFFECTS.has(call);
                const key = `${call}(${callee.params.map(p => bound.get(p) ?? '').join(',')})${banks ? '' : '!'}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    body: callee.body.replace(/\$([a-z0-9_]+)/g, (m, p: string) => bound.get(p) ?? m),
                    banking: banks,
                });
            }
        }
        reached.set(raw, out);
        return out;
    };
    /** The triggers on a config whose reach has a body matching `re`; `banking`: only bank-service bodies. */
    const reaching = (on: 'loc' | 'npc', config: string, cfg: Config, re: RegExp, banking = false): Trigger[] =>
        triggersOn(on, config, cfg).filter(t => reach(t.body).some(r => (r.banking || !banking) && re.test(r.body)));

    const tree: Rule = (on, config, cfg) => {
        const row = on === 'loc' ? trees.get(config) : undefined;
        if (!row) return null;
        return { kind: 'tree', subtype: treeSubtype(row), ops: usableOps(on, config, cfg) };
    };

    const rock: Rule = (on, config, cfg) => {
        const row = on === 'loc' ? rocks.get(config) : undefined;
        if (!row) return null;
        return { kind: 'rock', subtype: rockSubtype(row), ops: usableOps(on, config, cfg) };
    };

    // Only fishing_spots/: skill_fishing/scripts/fishing_guild.rs2 also has npc triggers (its shop,
    // the master fisher). A spot named by config rather than category (lava eels) is its own subtype.
    const fishingSpots = under('skill_fishing/scripts/fishing_spots/');
    const fishingSpot: Rule = (on, config, cfg) => {
        const ts = fishingSpots(on, config, cfg);
        return ts.length ? { kind: 'fishing-spot', subtype: first(cfg, 'category') ?? config, ops: opsOf(ts) } : null;
    };

    const bank: Rule = (on, config, cfg) => {
        const ts = reaching(on, config, cfg, /@openbank\b/, true);
        const teller = on === 'npc' && first(cfg, 'category') === 'bank_teller';
        if (!ts.length && !teller) return null;
        const ops = ts.length ? opsOf(ts) : usableOps(on, config, cfg);
        if (on === 'npc') return { kind: 'bank', subtype: 'banker', ops };
        return { kind: 'bank', subtype: /booth/i.test(first(cfg, 'name') ?? '') ? 'booth' : 'chest', ops };
    };

    // A shop opens through ~openshop(<inv>, ...) or, for most shopkeepers, ~openshop_activenpc, which
    // opens the npc's owned_shop param (shop/scripts/shop.rs2). The subtype is the inv either way; an
    // explicit call names its inv, so it wins over owned_shop, which is right only when none is named.
    const shop: Rule = (on, config, cfg) => {
        const ts = reaching(on, config, cfg, /~openshop(\(|_activenpc\b)/);
        if (!ts.length) return null;
        const owned = on === 'npc' ? params(cfg).get('owned_shop') : undefined;
        const explicit = ts
            .flatMap(t => reach(t.body))
            .map(({ body }) => body.match(/~openshop\(([a-z0-9_]+)/)?.[1])
            .find(Boolean);
        return { kind: 'shop', subtype: explicit ?? owned ?? '', ops: opsOf(ts) };
    };

    // The tanning interface opens from areas/area_alkharid/scripts/tanner.rs2 [label,tan_leather_choices].
    const tanner: Rule = (on, config, cfg) => {
        const ts = on === 'npc' ? reaching(on, config, cfg, /if_openmain\(tanner\)/) : [];
        return ts.length ? { kind: 'tanner', subtype: '', ops: opsOf(ts) } : null;
    };

    // rc altars and ruins carry param rune_type, the type column of runecraft_table
    // (skill_runecraft/scripts/runecraft.rs2 ~get_runecraft_data).
    const station: Rule = (on, config, cfg) => {
        const kind = on === 'loc' ? STATIONS[first(cfg, 'category') ?? ''] : undefined;
        if (!kind) return null;
        const ops = usableOps(on, config, cfg);
        if (kind !== 'rc-altar' && kind !== 'rc-ruins') return { kind, subtype: '', ops };
        const row = runes.get(params(cfg).get('rune_type') ?? '');
        return { kind, subtype: row ? row.row.replace(/^runecraft_/, '') : '', ops };
    };

    /** A rule claiming the configs with a trigger under a script directory; `named`: the config is the subtype. */
    const byDir = (kind: FeatureKind, only: 'loc' | 'npc', dir: string, named: boolean): Rule => {
        const triggersUnder = under(dir);
        return (on, config, cfg) => {
            const ts = on === only ? triggersUnder(on, config, cfg) : [];
            return ts.length ? { kind, subtype: named ? config : '', ops: opsOf(ts) } : null;
        };
    };

    const rules: [string, Rule][] = [
        ['tree', tree],
        ['rock', rock],
        ['fishing-spot', fishingSpot],
        ['bank', bank],
        ['shop', shop],
        ['tanner', tanner],
        ['station', station],
        // Stalls and chests by their script's directory, not their names (`tea_stall` is a stall).
        ['stall', byDir('stall', 'loc', 'skill_thieving/scripts/stalls/', true)],
        ['thieving-chest', byDir('thieving-chest', 'loc', 'skill_thieving/scripts/chest/', true)],
        ['pickpocket', byDir('pickpocket', 'npc', 'skill_thieving/scripts/pickpocketing/', true)],
        ['connector', byDir('connector', 'loc', 'ladders+stairs/', false)],
    ];

    const configsOf = (on: 'loc' | 'npc'): Map<string, Config> => (on === 'loc' ? input.locConfigs : input.npcConfigs);
    const ruleHits = (on: 'loc' | 'npc', config: string): (readonly [string, Match])[] => {
        const cfg = configsOf(on).get(config) ?? {};
        return rules.flatMap(([n, r]) => {
            const hit = r(on, config, cfg);
            return hit ? [[n, hit] as const] : [];
        });
    };

    // A loc's op can loc_change it and an npc's can npc_changetype it; the first argument names the
    // config it becomes, as in general_use/scripts/chests.rs2 and quest_mortton/scripts/razmire_keelgan.rs2.
    const CHANGE = { loc: /\bloc_change\(\s*([a-z0-9_]+)\s*,/g, npc: /\bnpc_changetype\(\s*([a-z0-9_]+)\s*,/g };
    /** The configs a config's triggers change it into, each with the ops that do it, by name. */
    const changesOf = (on: 'loc' | 'npc', config: string): Map<string, string[]> => {
        const out = new Map<string, Set<string>>();
        for (const t of triggersOn(on, config, configsOf(on).get(config) ?? {}))
            for (const { body } of reach(t.body))
                for (const [, into] of body.matchAll(CHANGE[on]))
                    if (into !== config && configsOf(on).has(into!))
                        out.set(into!, (out.get(into!) ?? new Set()).add(t.op));
        return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)).map(([into, ops]) => [into, [...ops].sort()]));
    };

    /**
     * The rule hits of the configs this one changes into, followed through their own changes. The op
     * that makes the change is how the player reaches the other type's use, so a hit takes that op
     * (and not the other type's) for the own-op clash rule: the Duel Arena's closed chest is a bank
     * through its op1 Open, which turns it into duel_chestopen (minigames/game_duelarena/scripts/
     * misc_locs.rs2). The visited set holds this config, so a change back to it ends the walk.
     */
    const changedHits = (on: 'loc' | 'npc', config: string): (readonly [string, Match])[] =>
        [...changesOf(on, config)].flatMap(([changed, ops]) => {
            const seen = new Set([config]);
            const out: (readonly [string, Match])[] = [];
            const walk = (into: string): void => {
                if (seen.has(into)) return;
                seen.add(into);
                for (const [n, m] of ruleHits(on, into)) out.push([`${n} via ${into}`, { ...m, ops }]);
                for (const next of changesOf(on, into).keys()) walk(next);
            };
            walk(changed);
            return out;
        });

    const cache = new Map<string, readonly Classified[]>();
    return (on, config) => {
        const key = `${on}:${config}`;
        const cached = cache.get(key);
        if (cached) return cached;
        const cfg = configsOf(on).get(config) ?? {};
        // A kind the config already has is the use it changes back and forth for (a trapped chest's
        // search turns it into the looted loc_2572, also a thieving chest: skill_thieving/scripts/
        // chest/trapped_chest.rs2), so a changed-into hit adds only kinds not yet found.
        const hits = [...ruleHits(on, config)];
        for (const hit of changedHits(on, config)) if (!hits.some(([, h]) => h.kind === hit[1].kind)) hits.push(hit);
        hits.forEach(([a, x], i) => {
            for (const [b, y] of hits.slice(i + 1)) {
                const op = clash(x.ops, y.ops);
                if (op !== undefined) throw new Error(`${key} matches rules ${a}, ${b} through op ${op}`);
            }
        });
        // Only the config's own Attack op and stats make it an `npc`: one that turns into a monster
        // is not one to train on until it has.
        const fallback = hits.length ? null : npc(on, config, cfg);
        const out = [...hits.map(([, h]) => h), ...(fallback ? [fallback] : [])].map(({ kind, subtype }) => ({
            kind,
            subtype,
            name: first(cfg, 'name') ?? config,
        }));
        // Frozen: later calls get this same array, so a caller must not be able to change it.
        out.forEach(Object.freeze);
        Object.freeze(out);
        cache.set(key, out);
        return out;
    };
}
