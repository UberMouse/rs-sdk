// What a loc or npc config is for, read from the game data that uses it: the dbrows that list it
// and the script triggers on it (or on its category). A config no rule claims is scenery.
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
    /** The labels and procs trigger bodies call, followed one call deep. Omitted: none. */
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
export function classifier(input: ClassifyInput): (on: 'loc' | 'npc', config: string) => Classified[] {
    const dbrowIndex = (table: string, column: string): Map<string, DbRow> => {
        const out = new Map<string, DbRow>();
        for (const row of input.dbrows.filter(r => r.table === table)) {
            for (const [v] of row.data[column] ?? []) out.set(v!, row);
        }
        return out;
    };
    const trees = dbrowIndex('woodcutting_trees', 'tree');
    const rocks = dbrowIndex('mining_table', 'rock');
    const runes = dbrowIndex('runecraft_table', 'type');

    const byTarget = new Map<string, Trigger[]>();
    for (const t of input.triggers) {
        const key = `${t.on}:${t.category ? '_' : ''}${t.target}`;
        byTarget.set(key, [...(byTarget.get(key) ?? []), t]);
    }
    const callables = new Map((input.callables ?? []).map(c => [c.call, c.body]));

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

    /** A body and the bodies of the labels and procs it calls (one call deep). */
    const reach = (body: string): string[] => [
        body,
        ...[...body.matchAll(/[@~][a-z0-9_]+/g)].flatMap(([call]) => callables.get(call) ?? []),
    ];
    const reaching = (on: 'loc' | 'npc', config: string, cfg: Config, re: RegExp): Trigger[] =>
        triggersOn(on, config, cfg).filter(t => reach(t.body).some(b => re.test(b)));

    const tree: Rule = (on, config, cfg) => {
        const row = on === 'loc' ? trees.get(config) : undefined;
        if (!row) return null;
        return { kind: 'tree', subtype: row.row.replace(/(_tree)?_table$/, ''), ops: usableOps(on, config, cfg) };
    };

    const rock: Rule = (on, config, cfg) => {
        const row = on === 'loc' ? rocks.get(config) : undefined;
        if (!row) return null;
        return { kind: 'rock', subtype: row.data.ore_name?.[0]?.[0] ?? '', ops: usableOps(on, config, cfg) };
    };

    // Only fishing_spots/: skill_fishing/scripts/fishing_guild.rs2 also has npc triggers (its shop,
    // the master fisher). A spot named by config rather than category (lava eels) is its own subtype.
    const fishingSpots = under('skill_fishing/scripts/fishing_spots/');
    const fishingSpot: Rule = (on, config, cfg) => {
        const ts = fishingSpots(on, config, cfg);
        return ts.length ? { kind: 'fishing-spot', subtype: first(cfg, 'category') ?? config, ops: opsOf(ts) } : null;
    };

    const bank: Rule = (on, config, cfg) => {
        const ts = reaching(on, config, cfg, /@openbank\b/);
        const teller = on === 'npc' && first(cfg, 'category') === 'bank_teller';
        if (!ts.length && !teller) return null;
        const ops = ts.length ? opsOf(ts) : usableOps(on, config, cfg);
        if (on === 'npc') return { kind: 'bank', subtype: 'banker', ops };
        return { kind: 'bank', subtype: /booth/i.test(first(cfg, 'name') ?? '') ? 'booth' : 'chest', ops };
    };

    // A shop opens through ~openshop(<inv>, ...) or, for most shopkeepers, ~openshop_activenpc, which
    // opens the npc's owned_shop param (shop/scripts/shop.rs2). The subtype is the inv either way.
    const shop: Rule = (on, config, cfg) => {
        const ts = reaching(on, config, cfg, /~openshop(\(|_activenpc\b)/);
        if (!ts.length) return null;
        const owned = on === 'npc' ? params(cfg).get('owned_shop') : undefined;
        const explicit = ts
            .flatMap(t => reach(t.body))
            .map(b => b.match(/~openshop\(([a-z0-9_]+)/)?.[1])
            .find(Boolean);
        return { kind: 'shop', subtype: owned ?? explicit ?? '', ops: opsOf(ts) };
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

    const cache = new Map<string, Classified[]>();
    return (on, config) => {
        const key = `${on}:${config}`;
        const cached = cache.get(key);
        if (cached) return cached;
        const cfg = (on === 'loc' ? input.locConfigs : input.npcConfigs).get(config) ?? {};
        const hits = rules.flatMap(([n, r]) => {
            const hit = r(on, config, cfg);
            return hit ? [[n, hit] as const] : [];
        });
        hits.forEach(([a, x], i) => {
            for (const [b, y] of hits.slice(i + 1)) {
                const op = clash(x.ops, y.ops);
                if (op !== undefined) throw new Error(`${key} matches rules ${a}, ${b} through op ${op}`);
            }
        });
        const fallback = hits.length ? null : npc(on, config, cfg);
        const out = [...hits.map(([, h]) => h), ...(fallback ? [fallback] : [])].map(({ kind, subtype }) => ({
            kind,
            subtype,
            name: first(cfg, 'name') ?? config,
        }));
        cache.set(key, out);
        return out;
    };
}
