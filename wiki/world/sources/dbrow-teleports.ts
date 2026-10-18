// Loc teleports whose landing is drawn from a dbrow's coord list (gates.ts DBROW_TELEPORTS). The trigger finds
// its row by a param of the loc (`db_find(<table>:<key>, loc_param(<param>))`) and jumps to
// `map_findsquare(db_getfield(<row>, <table>:<column>, random(<count>)))`: one of the row's coords at random, then
// a random tile in that coord's ring [min, max] (Chebyshev) the collision does not block, or the coord itself when
// none is open (server/engine/src/engine/script/handlers/ServerOps.ts MAP_FINDSQUARE). The gate scan
// (sources/gate-scan.ts) reads neither the dbrow nor a `last_useitem` test against one of its fields, so an entry
// names the trigger, the table and its columns, and every coord and obj comes from the dbrow. Each placed loc of a
// config the trigger covers gets one World.crossings row: done from every tile on land it is used from, landing on
// every tile the draw can give that is walkable land, with the row's obj held (a use-item trigger) and `members`
// where the row's members column says so. A placed loc no tile on land is used from gets no row, nor does one
// whose every landing is off walkable land; the build report lists both, and each landing left out.
import { reachTiles, type PlacedLoc, type SiteOptions } from '../place';
import { requirementSet } from '../requirements';
import type { Act, Crossing, Tile } from '../types';
import { cmp } from '../util';
import { first, type Config } from './configs';
import type { ConnectorCollision } from './connectors';
import type { DbRow } from './dbrows';
import { coordTile, isCoordLiteral } from './runescript';
import { triggerConfigs, triggerKey } from './gate-scan';
import type { Trigger } from './triggers';

/** A loc trigger that teleports to a coord drawn from its dbrow (the header comment). */
export interface DbrowTeleport {
    /** The trigger, as its header names it: `oplocu,_rc_ruins`. */
    trigger: string;
    /** How the move is priced (distance.ts CROSSING_TICKS). */
    via: Crossing['via'];
    /** The dbrow table, its column the trigger finds the row by, and the loc param it passes. */
    table: string;
    key: { column: string; param: string };
    /** The column of `coord, min, max, type` tuples the landing is drawn from. */
    landings: string;
    /**
     * On a use-item trigger: the obj column the trigger tests `last_useitem` against, and the obj category it tests
     * first. The act is that obj used on the loc, and the row needs it held.
     */
    use?: { column: string; category: string };
    /** An int column that, at 1, makes the trigger refuse on a free world: the row needs `members`. */
    members?: string;
    /** The script line that makes the move, as `file:line`. */
    source: string;
}

export interface DbrowTeleportInput {
    entries: readonly DbrowTeleport[];
    triggers: readonly Trigger[];
    /** Script text by file, to check each entry's source line. */
    scripts: ReadonlyMap<string, string>;
    dbrows: readonly DbRow[];
    locConfigs: ReadonlyMap<string, Config>;
    objConfigs: ReadonlyMap<string, Config>;
    /** Every placed loc. */
    locs: readonly PlacedLoc[];
    collision: ConnectorCollision;
    size: SiteOptions['size'];
}

/** A placed loc no tile on land is used from, given no row. */
export interface DbrowTeleportMiss {
    trigger: string;
    loc: string;
    tile: Tile;
}

/** A landing off walkable land, left out of its loc's row. */
export interface DbrowTeleportOffLand extends DbrowTeleportMiss {
    landing: Tile;
}

export interface DbrowTeleports {
    /** World.crossings rows, by entry, then loc tile. */
    crossings: Crossing[];
    /** Placed locs no tile on land is used from, and landings off walkable land (every one, for a loc given no row). */
    unstood: DbrowTeleportMiss[];
    offLand: DbrowTeleportOffLand[];
}

const tileKey = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;
const byTile = (a: Tile, b: Tile): number => a.level - b.level || a.x - b.x || a.z - b.z;

/** The loc param `name` of a config (`param=rune_type,1`), or undefined. */
const paramOf = (cfg: Config | undefined, name: string): string | undefined =>
    cfg?.param?.find(p => p.startsWith(`${name},`))?.slice(name.length + 1);

/** The tiles the engine draws from at most (server/engine/src/engine/script/handlers/ServerOps.ts:298). */
const FINDSQUARE_MAX_TILES = 100;

/**
 * The tiles `map_findsquare(coord, min, max, type)` can give (the header comment): of type 0 only (no line of walk
 * or sight to trace), and of a ring of at most FINDSQUARE_MAX_TILES tiles, as the engine stops at that many open
 * ones, x-major, and a bigger ring could leave some out (ServerOps.ts:301-324). Throws on a radius the engine
 * refuses (a negative one, ServerOps.ts:278-279), on a radius that is no integer, and on min above max.
 */
export function findsquareTiles(
    [literal, lo = '0', hi = '0', type = '0']: readonly string[],
    walkable: ConnectorCollision['walkable'],
): Tile[] {
    if (!literal || !isCoordLiteral(literal)) throw new Error(`${literal} is not a coord literal`);
    if (type !== '0') throw new Error(`map_findsquare type ${type} (a line of walk or sight) is not read`);
    const o = coordTile(literal);
    if (!/^\d+$/.test(lo) || !/^\d+$/.test(hi) || Number(lo) > Number(hi))
        throw new Error(`map_findsquare radius ${lo} to ${hi} is not 0 <= min <= max in integers`);
    const [min, max] = [Number(lo), Number(hi)];
    const ring = (2 * max + 1) ** 2 - (min ? (2 * min - 1) ** 2 : 0);
    if (ring > FINDSQUARE_MAX_TILES)
        throw new Error(
            `map_findsquare ring ${min} to ${max} has ${ring} tiles, past the engine's ${FINDSQUARE_MAX_TILES}`,
        );
    const out: Tile[] = [];
    for (let x = o.x - max; x <= o.x + max; x++)
        for (let z = o.z - max; z <= o.z + max; z++)
            if (Math.max(Math.abs(x - o.x), Math.abs(z - o.z)) >= min && walkable(o.level, x, z))
                out.push({ level: o.level, x, z });
    return out.length ? out : [o];
}

/** The World.crossings rows of gates.ts DBROW_TELEPORTS (the header comment). Throws on an entry the data refutes. */
export function deriveDbrowTeleports(input: DbrowTeleportInput): DbrowTeleports {
    const { collision, size } = input;
    const onLand = (t: Tile) => collision.land(t.level, t.x, t.z) && collision.walkable(t.level, t.x, t.z);
    const crossings: Crossing[] = [];
    const unstood: DbrowTeleportMiss[] = [];
    const offLand: DbrowTeleportOffLand[] = [];
    for (const e of input.entries) {
        const fail = (why: string) => new Error(`gates.ts DBROW_TELEPORTS ${e.trigger} (${e.source}): ${why}`);
        const trigger = input.triggers.find(t => triggerKey(t) === e.trigger);
        if (!trigger || trigger.on !== 'loc') throw fail('no such loc trigger');
        const [file, line] = e.source.split(':');
        const text = input.scripts.get(file!)?.split('\n')[Number(line) - 1] ?? '';
        if (!/\bp_telejump\s*\(\s*map_findsquare\s*\(/.test(text) || !text.includes(`${e.table}:${e.landings}`))
            throw fail(`the line is not a p_telejump(map_findsquare(...)) of ${e.table}:${e.landings}`);
        if (!e.use !== (trigger.op !== 'u')) throw fail('a use-item trigger needs a use obj, and only one does');
        const rows = new Map<string, DbRow>();
        // db_find then db_findnext takes a key's first row (server/engine/src/engine/script/handlers/DbOps.ts
        // DB_FINDNEXT); a second row of the key is refused, as the entry then needs a look.
        for (const r of input.dbrows.filter(d => d.table === e.table))
            for (const [v] of r.data[e.key.column] ?? []) {
                const seen = rows.get(v!);
                if (seen) throw fail(`${seen.row} and ${r.row} both have ${e.key.column} ${v}`);
                rows.set(v!, r);
            }
        const covered = new Set(triggerConfigs(input.triggers, input.locConfigs)(trigger));
        const placed = input.locs
            .filter(l => covered.has(l.config))
            .sort((a, b) => byTile(a.tile, b.tile) || cmp(a.config, b.config));
        if (!placed.length) throw fail('no placed loc of a config it covers');
        for (const l of placed) {
            const value = paramOf(input.locConfigs.get(l.config), e.key.param);
            if (value === undefined) throw fail(`${l.config} has no param ${e.key.param} (its default is not read)`);
            const row = rows.get(value);
            if (!row) throw fail(`no ${e.table} row has ${e.key.column} ${value} (${l.config})`);
            let tiles: Tile[];
            try {
                tiles = (row.data[e.landings] ?? []).flatMap(c => findsquareTiles(c, collision.walkable));
            } catch (err) {
                throw fail(`${row.row}.${e.landings}: ${(err as Error).message}`);
            }
            if (!tiles.length) throw fail(`${row.row} has no ${e.landings}`);
            const landings = [...new Map(tiles.map(t => [tileKey(t), t])).values()].sort(byTile);
            const miss = { trigger: e.trigger, loc: l.config, tile: l.tile };
            for (const t of landings) if (!onLand(t)) offLand.push({ ...miss, landing: t });
            const from = reachTiles(l, collision, size)
                .filter(t => collision.land(t.level, t.x, t.z))
                .sort(byTile);
            if (!from.length) unstood.push(miss);
            const on = landings.filter(onLand);
            if (!from.length || !on.length) continue;
            const needs: string[] = [];
            let act: Act = { kind: 'loc-op', loc: l.config, op: Number(trigger.op) };
            if (e.use) {
                const obj = row.data[e.use.column]?.[0]?.[0];
                if (!obj) throw fail(`${row.row} has no ${e.use.column}`);
                if (first(input.objConfigs.get(obj), 'category') !== e.use.category)
                    throw fail(`${row.row}.${e.use.column} ${obj} is not of category ${e.use.category}`);
                act = { kind: 'item-on-loc', obj, loc: l.config };
                needs.push(`item:${obj}:held`);
            }
            if (e.members) {
                const m = row.data[e.members]?.[0]?.[0] ?? '0';
                if (m !== '0' && m !== '1') throw fail(`${row.row}.${e.members} is ${m}, not 0 or 1`);
                if (m === '1') needs.push('members');
            }
            crossings.push({
                via: e.via,
                act,
                at: l.tile,
                from,
                landings: on.map(tile => ({ tile })),
                requires: [requirementSet(needs)],
                source: e.source,
            });
        }
    }
    return { crossings, unstood, offLand };
}
