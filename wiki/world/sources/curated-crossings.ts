// Teleports and scripted moves no derivation gives, curated with their scripts (gates.ts CURATED_CROSSINGS): an npc's
// op whose move is behind a quest's own varps or the npc's place (Monkey Madness's rides), a loc op whose landing is a
// menu choice (the spirit trees), an interface click (the gnome gliders), an item op (the Fisher Realm's whistle). An
// entry names the trigger, the act, where it is done, the landing coords and what it needs; the build checks each
// against the scripts: the trigger's header is there, each landing (or a constant whose value it is) is written in the
// trigger's script or on the move's line, each dialogue choice is an option text of those scripts, each zone is an
// `inzone` on the line it cites or in the trigger's script, and, for a loc or npc op trigger, the gate scan finds the
// trigger moving the player to each landing; an act a derived row has too is refused (refuseDerivedTwins). Each spawn
// cluster of the npc (beside it, place.ts besideCluster), each placed loc of the loc (its approach tiles, place.ts
// reachTiles), or the zone's tiles, gets one World.crossings row. A landing the script puts on a tile the collision
// blocks (the Fisher Realm's, inside a tree) lands on the tiles the player steps out to; one off land, or with no step
// out, is left out. A placement with no tile on land, or whose every landing is left out, gets no row; the build report
// lists each, and each landing left out or stepped out of.
import { besideCluster, reachTiles, type Placed, type PlacedLoc, type SiteOptions, type StepCollision } from '../place';
import { actName, STEPS, stepsOutOf } from '../reach';
import { minimalSets, requirementSet } from '../requirements';
import type { Act, Crossing, NpcSpawn, Tile } from '../types';
import { byTile, cmp, onLandIn, tileKey, uniqueTiles } from '../util';
import type { Constant } from './constants';
import { findsquareTiles, type TeleportCollision } from './dbrow-teleports';
import { CROSS, optionTexts, triggerKey, type TriggerScan } from './gate-scan';
import { coordTile, isCoordLiteral, tileCoord } from './runescript';
import { blocks, type Trigger } from './triggers';

/** An inclusive box of tiles as the script's `inzone(lo, hi, ...)` writes it: two coord literals. */
export type Zone = readonly [lo: string, hi: string];

/** A curated crossing (the header comment). */
export interface CuratedCrossing {
    /** How the move is priced (distance.ts CROSSING_TICKS). */
    via: Crossing['via'];
    /** The trigger whose script makes the move, as its header names it: `opnpc1,mm_waydar`, `if_button,glidermap:com_21`. */
    trigger: string;
    act: Act;
    /**
     * Where the act is done. Absent: at every spawn of the act's npc or placed loc of its loc. `placed`: at the spawns
     * of `npc` (an interface act's, the npc whose op opens it; else the act's npc or loc), only those inside `in` and
     * outside every `notIn`, as an `inzone` on the line `at` (`file:line`) or in the trigger's script checks it; with
     * `tiles` (coord literals), only the placements on those tiles, each of which must be placed (the move is made at
     * those placed locs of the config and the script's own check, which `at` cites, is not a zone).
     * `zone`: on the zone's tiles on walkable land (an item op's), checked so; with `seed`, only those a walk inside
     * the zone gets to from it.
     */
    where?:
        | { placed: { npc?: string; in?: Zone; notIn?: readonly Zone[]; tiles?: readonly string[]; at: string } }
        | { zone: { in: Zone; seed?: string; at: string } };
    /** The landings, as coord literals: one, or the coords a random draw takes. */
    to: readonly string[];
    /** A `map_findsquare(<coord>, min, max, type)` round each landing, as the move's line writes it. */
    ring?: readonly [min: number, max: number, type: number];
    /**
     * A `movecoord(<coord>, $x, 0, $z)` of each landing by random draws of x and z in these inclusive ranges, as the
     * trigger draws them (the Burthorpe Games Room stairs): every tile they can give is a landing.
     */
    draw?: { x: readonly [lo: number, hi: number]; z: readonly [lo: number, hi: number] };
    /** The minimal requirement sets (requirements.ts), canonical. */
    requires: readonly (readonly string[])[];
    /** The script line that makes the move, as `file:line`. */
    source: string;
    notes?: string;
}

export interface CuratedCrossingInput {
    entries: readonly CuratedCrossing[];
    triggers: readonly Trigger[];
    /** Script text by file. */
    scripts: ReadonlyMap<string, string>;
    constants: ReadonlyMap<string, Constant>;
    /** What the gate scan makes of a loc or npc op trigger (gate-scan.ts scanTrigger). */
    scanOf: (t: Trigger) => TriggerScan;
    /** Every npc spawn cluster (place.ts spawnClusters). */
    spawns: readonly Pick<Placed<NpcSpawn>, 'config' | 'centre' | 'bbox'>[];
    /** Every placed loc. */
    locs: readonly PlacedLoc[];
    collision: TeleportCollision & StepCollision;
    size: SiteOptions['size'];
}

/** A placement no tile on land is used from, given no row: the trigger, the npc or loc config (or the zone), its tile. */
export interface CuratedCrossingMiss {
    trigger: string;
    config: string;
    tile: Tile;
}

/** A landing off walkable land, left out of its row; with `to`, one on a blocked tile, landed beside on `to`. */
export interface CuratedCrossingLanding extends CuratedCrossingMiss {
    landing: Tile;
    to?: Tile[];
}

export interface CuratedCrossings {
    /** World.crossings rows, by entry, then placement tile. */
    crossings: Crossing[];
    unstood: CuratedCrossingMiss[];
    offLand: CuratedCrossingLanding[];
    stepped: CuratedCrossingLanding[];
}

/** Whether `t` is inside the inclusive box `z` on every axis, its level too (ServerOps.ts INZONE). */
function inZone(z: Zone, t: Tile): boolean {
    const [lo, hi] = z.map(coordTile) as [Tile, Tile];
    return t.level >= lo.level && t.level <= hi.level && t.x >= lo.x && t.x <= hi.x && t.z >= lo.z && t.z <= hi.z;
}

/** The World.crossings rows of gates.ts CURATED_CROSSINGS (the header comment). Throws on an entry the data refutes. */
export function deriveCuratedCrossings(input: CuratedCrossingInput): CuratedCrossings {
    const { collision } = input;
    const onLand = onLandIn(collision);
    const crossings: Crossing[] = [];
    const unstood: CuratedCrossingMiss[] = [];
    const offLand: CuratedCrossingLanding[] = [];
    const stepped: CuratedCrossingLanding[] = [];
    const headers = new Map<string, { file: string; line: number; body: string }>();
    for (const [file, text] of input.scripts)
        for (const b of blocks(file, text)) headers.set(b.header.slice(1, -1), { file, line: b.line, body: b.body });
    const lineOf = (at: string): string | undefined => {
        const [file, n] = at.split(':');
        return input.scripts.get(file!)?.split('\n')[Number(n) - 1];
    };
    const named = (text: string, literal: string): boolean =>
        text.includes(literal) ||
        [...text.matchAll(/\^[a-z0-9_]+/g)].some(m => input.constants.get(m[0])?.value === literal);

    for (const e of input.entries) {
        const fail = (why: string) => new Error(`gates.ts CURATED_CROSSINGS ${e.trigger} (${e.source}): ${why}`);
        const block = headers.get(e.trigger);
        if (!block) throw fail('no script has this header');
        const moveLine = lineOf(e.source);
        if (moveLine === undefined) throw fail('no such line');
        if (!e.to.length || !e.to.every(isCoordLiteral)) throw fail('a landing is no coord literal');
        for (const literal of e.to)
            if (!named(block.body, literal) && !named(moveLine, literal))
                throw fail(`neither the trigger's script nor the move's line names ${literal}`);
        if (e.draw && !e.to.every(l => new RegExp(`movecoord\\(\\s*${l}\\s*,`).test(moveLine)))
            throw fail(`the move's line is no movecoord of ${e.to.join(', ')}`);
        if (e.ring && !new RegExp(`map_findsquare\\(.*,\\s*${e.ring[0]}\\s*,\\s*${e.ring[1]}\\s*,`).test(moveLine))
            throw fail(`the move's line has no map_findsquare ring ${e.ring[0]} to ${e.ring[1]}`);
        const choices = e.act.kind === 'loc-op' || e.act.kind === 'npc-op' ? (e.act.choices ?? []) : [];
        if (choices.length) {
            const offered = optionTexts(
                [block.file, e.source.split(':')[0]!].map(f => input.scripts.get(f) ?? '').join('\n'),
            );
            for (const c of choices) if (!offered.has(c)) throw fail(`"${c}" is no option text of its scripts`);
        }
        const sets = minimalSets(e.requires.map(s => requirementSet(s)));
        if (JSON.stringify(sets) !== JSON.stringify(e.requires))
            throw fail(`write requires as ${JSON.stringify(sets)}`);
        const trigger = input.triggers.find(t => triggerKey(t) === e.trigger);
        if (trigger) {
            const scan = input.scanOf(trigger);
            const moves = !scan ? [] : 'moves' in scan ? scan.moves : scan.candidate.moves.map(m => m.to);
            if (e.draw && !moves.length) throw fail('the gate scan finds no move');
            for (const literal of e.draw ? [] : e.to)
                if (!moves.includes(literal))
                    throw fail(
                        `the gate scan finds no move to ${literal} (${moves.filter(m => m !== CROSS).join(', ')})`,
                    );
        }
        const zonesAt = (at: string, zones: readonly Zone[]) => {
            // A `movecoord(^name, dx, dlevel, dz)` of a constant's coord is written as the literal it gives.
            const text = `${lineOf(at) ?? ''}\n${block.body}`.replace(
                /movecoord\(\s*(\^[a-z0-9_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g,
                (all, name: string, dx: string, dl: string, dz: string) => {
                    const v = input.constants.get(name)?.value;
                    if (!v || !isCoordLiteral(v)) return all;
                    const t = coordTile(v);
                    return tileCoord({ level: t.level + Number(dl), x: t.x + Number(dx), z: t.z + Number(dz) });
                },
            );
            for (const [lo, hi] of zones)
                if (!new RegExp(`\\binzone\\(\\s*${lo}\\s*,\\s*${hi}\\s*,`).test(text))
                    throw fail(`neither ${at} nor the trigger's script checks inzone(${lo}, ${hi}, ...)`);
        };

        // Where it is done: each placement's tile, config and the tiles it is done from.
        type At = { config: string; tile: Tile; from: Tile[] };
        let ats: At[];
        const where = e.where;
        if (where && 'zone' in where) {
            zonesAt(where.zone.at, [where.zone.in]);
            const [lo, hi] = where.zone.in.map(coordTile) as [Tile, Tile];
            const tiles: Tile[] = [];
            for (let level = lo.level; level <= hi.level; level++)
                for (let x = lo.x; x <= hi.x; x++)
                    for (let z = lo.z; z <= hi.z; z++) if (onLand({ level, x, z })) tiles.push({ level, x, z });
            let from = tiles;
            if (where.zone.seed) {
                const seeds = landed(coordTile(where.zone.seed)).to;
                const inside = new Set(tiles.map(tileKey));
                const seen = new Set(seeds.filter(t => inside.has(tileKey(t))).map(tileKey));
                const queue = seeds.filter(t => seen.has(tileKey(t)));
                while (queue.length) {
                    const t = queue.pop()!;
                    for (const [dx, dz] of STEPS) {
                        const n = { level: t.level, x: t.x + dx, z: t.z + dz };
                        const k = tileKey(n);
                        if (inside.has(k) && !seen.has(k) && collision.canStep(t.level, t.x, t.z, dx, dz)) {
                            seen.add(k);
                            queue.push(n);
                        }
                    }
                }
                from = tiles.filter(t => seen.has(tileKey(t)));
            }
            ats = [{ config: `${where.zone.in.join('..')}`, tile: lo, from }];
        } else {
            const placed = where && 'placed' in where ? where.placed : undefined;
            if (placed) zonesAt(placed.at, [...(placed.in ? [placed.in] : []), ...(placed.notIn ?? [])]);
            const only = placed?.tiles?.map(coordTile);
            const keep = (t: Tile) =>
                (!placed?.in || inZone(placed.in, t)) &&
                !(placed?.notIn ?? []).some(z => inZone(z, t)) &&
                (!only || only.some(o => tileKey(o) === tileKey(t)));
            const npc = placed?.npc ?? (e.act.kind === 'npc-op' ? e.act.npc : undefined);
            const loc = 'loc' in e.act ? e.act.loc : undefined;
            if (npc !== undefined) {
                const clusters = input.spawns.filter(s => s.config === npc);
                if (!clusters.length) throw fail(`${npc} has no spawn`);
                ats = clusters
                    .filter(c => keep(c.centre))
                    .map(c => ({ config: npc, tile: c.centre, from: besideCluster(c, collision).filter(onLand) }));
            } else if (loc !== undefined) {
                const locs = input.locs.filter(l => l.config === loc);
                if (!locs.length) throw fail(`${loc} is never placed`);
                for (const o of only ?? [])
                    if (!locs.some(l => tileKey(l.tile) === tileKey(o)))
                        throw fail(`${loc} is not placed at ${tileCoord(o)}`);
                ats = locs
                    .filter(l => keep(l.tile))
                    .map(l => ({
                        config: loc,
                        tile: l.tile,
                        from: reachTiles(l, collision, input.size).filter(t => collision.land(t.level, t.x, t.z)),
                    }));
            } else throw fail('an item op or interface act needs a where');
            if (!ats.length) throw fail('no placement is inside its zones');
        }

        // The landings: each coord, or its ring; a blocked one stepped out of.
        const drawn = uniqueTiles(
            e.to.flatMap(literal => {
                const at = coordTile(literal);
                if (e.draw) {
                    const out: Tile[] = [];
                    for (let dx = e.draw.x[0]; dx <= e.draw.x[1]; dx++)
                        for (let dz = e.draw.z[0]; dz <= e.draw.z[1]; dz++)
                            out.push({ level: at.level, x: at.x + dx, z: at.z + dz });
                    return out;
                }
                if (!e.ring) return [at];
                try {
                    return findsquareTiles([literal, ...e.ring.map(String)], collision);
                } catch (err) {
                    throw fail((err as Error).message);
                }
            }),
        );
        for (const a of ats.sort((x, y) => byTile(x.tile, y.tile) || cmp(x.config, y.config))) {
            const miss = { trigger: e.trigger, config: a.config, tile: a.tile };
            const landings = uniqueTiles(
                drawn.flatMap(t => {
                    const l = landed(t);
                    if (l.blocked && l.to.length) stepped.push({ ...miss, landing: t, to: l.to });
                    if (!l.to.length) offLand.push({ ...miss, landing: t });
                    return l.to;
                }),
            );
            const from = uniqueTiles(a.from);
            if (!from.length) unstood.push(miss);
            if (!from.length || !landings.length) continue;
            crossings.push({
                via: e.via,
                act: e.act,
                at: a.tile,
                from,
                landings: landings.map(tile => ({ tile })),
                requires: e.requires.map(s => [...s]),
                source: e.source,
                ...(e.notes ? { notes: e.notes } : {}),
            });
        }
    }
    return { crossings, unstood, offLand, stepped };

    /**
     * Where a move to `t` leaves the player to walk on from: `t` on walkable land; for a blocked tile on land, the
     * tiles on walkable land they step to from it (`blocked`); none off land.
     */
    function landed(t: Tile): { to: Tile[]; blocked?: true } {
        if (onLand(t)) return { to: [t] };
        if (!collision.land(t.level, t.x, t.z)) return { to: [] };
        return { to: stepsOutOf(t, onLand, collision.canStep), blocked: true };
    }
}

/**
 * Throws on a curated row whose act a derived row (the scripted moves', the dbrow and npc teleports') has too: a
 * derivation that now settles the trigger would give the walk a second edge at another cost, so the entry goes.
 */
export function refuseDerivedTwins(curated: readonly Crossing[], derived: readonly Crossing[]): void {
    const derivedAt = new Map(derived.map(c => [actName(c), c.source]));
    const twins = new Set(
        curated.flatMap(c => {
            const at = derivedAt.get(actName(c));
            return at === undefined ? [] : [`${actName(c)} (${c.source}, derived from ${at})`];
        }),
    );
    if (twins.size)
        throw new Error(
            `gates.ts CURATED_CROSSINGS: a derived row makes the move too, drop it: ${[...twins].join(', ')}`,
        );
}
