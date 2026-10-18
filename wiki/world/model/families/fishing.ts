// Fishing at a spot: the spot scripts (skill_fishing/scripts/fishing_spots/*.rs2) give each tool's catch inline
// (level, fish, bait, swing), ~fish_roll (skill_fishing/scripts/fishing.rs2:40-103) rolls it, and each fish's
// `fishing_struct` param (configs/fishing.obj) names its struct (configs/fishing.struct): success_low/high and
// productexp. Spots move (fishing_movement.rs2) but never run out, so the model has no `deplete`.
import { codeOf } from '../../classify';
import { parseCallables, parseTriggers } from '../../sources/triggers';
import { ModelError, type ActionModel } from '../family';
import { statRandomChance } from '../roll';
import { param, requireLevel, rollInterval, stringParams, targetFeatures, type FamilyFactory } from './common';

/** `spot`: the spot subtype (`freshfish`), omitted when the site has one; `tool`: the tool (`fly_fishing_rod`). */
export interface FishingParams {
    spot?: string;
    tool?: string;
}

const FISHING_SPOTS = 'skill_fishing/scripts/fishing_spots/';

/**
 * Catches whose script has no `stat(fishing) < N` check, as `tool:fish1`: the small-net shrimp
 * (saltfish.rs2:60-79, `fish_shrimp`) is open from level 1. Any other label without a check fails, so one that
 * moves its check into a proc is not read as level 1.
 */
const NO_LEVEL_CHECK = new Set(['net:raw_shrimp']);

/** One tool's catch at a spot, as its continue label (or op trigger) writes it. */
export interface Catch {
    tool: string;
    /** The label's `stat(fishing) < <level>` check; 1 when it has none and is in NO_LEVEL_CHECK (shrimps). */
    level: number;
    /** `%action_delay = calc(map_clock + <delay>)` on the tick after a roll. */
    delay: number;
    /** Rolled second, and only when fish2 misses. */
    fish1: string;
    /** Rolled first, from `level` (a `stat(fishing) >= <level>` guard, or the label's own level). */
    fish2: { obj: string; level: number } | null;
    /** Deleted on a catch (~fish_roll's `inv_del(inv, $bait, 1)`), or null. */
    bait: string | null;
    /** `file:line` of the body's header. */
    source: string;
}

const ROLL_BRANCH =
    /if \(%action_delay < map_clock\) \{\s*%action_delay = calc\(map_clock \+ (\d+)\);\s*\} else if \(%action_delay = map_clock\) \{/;
const ROLL_CALL = /~fish_roll(_loc)?\(([^)]*)\)/g;
const TOOL = /~check_fish_equipment\(([a-z0-9_]+)\)/;
const LEVEL = /stat\(fishing\) < (\d+)/;
const FISH2_LEVEL = /if \(stat\(fishing\) >= (\d+)\)/;

const orNull = (s: string | undefined): string | null => (s === undefined || s === 'null' ? null : s);

/**
 * The catch a label or trigger body makes, or null when it is not a plain ~fish_roll loop: it must check one tool,
 * reset %action_delay in the roll branch, and call ~fish_roll (args fish1, fish2, tool, bait) or ~fish_roll_loc
 * (fish1, fish2, bait) once, or twice split by a `stat(fishing) >=` guard, the call below it without fish2.
 */
export function parseCatch(body: string, source: string): Catch | null {
    const code = codeOf(body);
    const delay = code.match(ROLL_BRANCH)?.[1];
    const tool = code.match(TOOL)?.[1];
    const calls = [...code.matchAll(ROLL_CALL)].map(m => {
        const args = m[2]!.split(',').map(a => a.trim());
        const [fish1, fish2, ...rest] = args;
        return { fish1: fish1!, fish2: orNull(fish2), tool: m[1] ? null : rest[0]!, bait: orNull(rest.at(-1)) };
    });
    if (delay === undefined || tool === undefined || !calls.length) return null;
    if (calls.some(c => c.tool !== null && c.tool !== tool) || new Set(calls.map(c => c.bait)).size > 1) return null;
    const checked = code.match(LEVEL)?.[1];
    const first = calls[0]!.fish1;
    if (checked === undefined && !NO_LEVEL_CHECK.has(`${tool}:${first}`))
        throw new Error(`${source}: ${tool} catch of ${first} has no stat(fishing) level check`);
    const level = Number(checked ?? 1);
    const base = { tool, level, delay: Number(delay), bait: calls[0]!.bait, source };
    if (calls.length === 1) {
        const [c] = calls;
        return { ...base, fish1: c!.fish1, fish2: c!.fish2 === null ? null : { obj: c!.fish2, level } };
    }
    const guard = code.match(FISH2_LEVEL)?.[1];
    const high = calls.find(c => c.fish2 !== null);
    const low = calls.find(c => c.fish2 === null);
    if (calls.length !== 2 || guard === undefined || !high || !low || high.fish1 !== low.fish1) return null;
    return { ...base, fish1: high.fish1, fish2: { obj: high.fish2!, level: Number(guard) } };
}

/** A spot's catches by tool, and the tools its scripts check that no catch covers (a custom roll: big net). */
export interface Spot {
    catches: Map<string, Catch>;
    unmodelled: Set<string>;
}

/**
 * Every spot subtype's catches: the op triggers on it in FISHING_SPOTS (by category or config, as classify.ts
 * names the subtype) and the labels their bodies jump to.
 */
export function readSpots(scripts: readonly [file: string, text: string][]): Map<string, Spot> {
    const files = scripts.filter(([f]) => f.startsWith(FISHING_SPOTS));
    const labels = new Map(files.flatMap(([f, text]) => parseCallables(f, text)).map(c => [c.call, c] as const));
    const spots = new Map<string, Spot>();
    for (const t of files.flatMap(([f, text]) => parseTriggers(f, text))) {
        if (t.kind !== 'op') continue;
        const spot = spots.get(t.target) ?? { catches: new Map(), unmodelled: new Set() };
        spots.set(t.target, spot);
        const bodies = [
            { body: t.body, source: `${t.file}:${t.line}` },
            ...[...codeOf(t.body).matchAll(/@([a-z0-9_]+)/g)].flatMap(m => {
                const label = labels.get(`@${m[1]}`);
                return label ? [{ body: label.body, source: `${label.file}:${label.line}` }] : [];
            }),
        ];
        for (const { body, source } of bodies) {
            const c = parseCatch(body, source);
            const tool = codeOf(body).match(TOOL)?.[1];
            if (c) {
                const prior = spot.catches.get(c.tool);
                if (prior && JSON.stringify({ ...prior, source: '' }) !== JSON.stringify({ ...c, source: '' }))
                    throw new Error(`Spot ${t.target} has two catches for ${c.tool}: ${prior.source}, ${c.source}`);
                spot.catches.set(c.tool, prior ?? c);
            } else if (tool && /~fish_roll|stat_random\(fishing/.test(codeOf(body))) spot.unmodelled.add(tool);
        }
    }
    for (const spot of spots.values()) for (const tool of spot.catches.keys()) spot.unmodelled.delete(tool);
    return spots;
}

export const fishing: FamilyFactory = data => {
    const spots = readSpots(data.scripts);
    /** A fish's roll and XP from its fishing struct. */
    const fish = (obj: string): { low: number; high: number; xp: number } => {
        const name = param(data.objs.get(obj), 'fishing_struct');
        const struct = name === undefined ? undefined : data.structs.get(name);
        const [low, high, xp] = ['success_low', 'success_high', 'productexp'].map(k => Number(param(struct, k)));
        if (![low, high, xp].every(Number.isFinite)) throw new Error(`${obj} has no complete fishing struct (${name})`);
        return { low: low!, high: high!, xp: xp! };
    };
    return {
        id: 'fishing',
        skills: ['fishing'],
        model(site, params, profile, world): ActionModel {
            const p = stringParams(params, 'fishing', ['spot', 'tool']);
            const { subtype } = targetFeatures(site, world, 'fishing-spot', p.spot);
            const spot = spots.get(subtype);
            const tools = [...(spot?.catches.keys() ?? [])].sort().join(', ') || 'none';
            if (!p.tool) throw new ModelError(`fishing needs a tool param (spot ${subtype} has ${tools} modelled)`);
            if (spot?.unmodelled.has(p.tool))
                throw new ModelError(`spot ${subtype}'s ${p.tool} catch is not a ~fish_roll loop: not modelled`);
            const c = spot?.catches.get(p.tool);
            if (!c) throw new ModelError(`spot ${subtype} has no ${p.tool} catch (modelled: ${tools})`);
            const level = profile.levels.fishing;
            requireLevel(profile, 'fishing', c.level, `${p.tool} at a ${subtype} spot`);
            // ~fish_roll rolls fish2 first and stops on a catch, else rolls fish1 (fishing.rs2:46-72); the spot
            // passes fish2 only from its level.
            const f1 = fish(c.fish1);
            const f2 = c.fish2 && level >= c.fish2.level ? { obj: c.fish2.obj, ...fish(c.fish2.obj) } : null;
            const p2 = f2 ? statRandomChance(level, f2.low, f2.high) : 0;
            const p1 = (1 - p2) * statRandomChance(level, f1.low, f1.high);
            const success = p2 + p1;
            return {
                ticksPerAttempt: rollInterval(c.delay),
                success,
                xpTenths: { fishing: ((f2 ? p2 * f2.xp : 0) + p1 * f1.xp) / success },
                products: [
                    { obj: c.fish1, count: p1 / success },
                    ...(f2 ? [{ obj: f2.obj, count: p2 / success }] : []),
                ],
                // The bait goes only on a catch (fishing.rs2:49-51, :63-65).
                consumes: c.bait ? [{ obj: c.bait, count: 1 }] : [],
            };
        },
    };
};
