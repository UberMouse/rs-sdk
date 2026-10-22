// Where a gated move on an object puts the player. The gate scan (sources/gate-scan.ts) writes `cross` for
// every move that is not a coord literal: on a wall (shapes 0-3 and 9) that is a step through the wall,
// which the collision data gives, but on any other loc (a ladder, climbing rocks, a jungle bush) it says
// nothing of where the player ends up. So each placed loc of a gate row with no `to` on an object has its
// trigger run once per tile the loc is used from (place.ts reachTiles, on land), with the loc and that tile
// bound (gate-scan.ts gateLander), down the paths that make the row's move (the scan's crossing; every move
// when the scan sees none, as for a jump gates.ts reads as a crossing) and that an account meeting the
// row's requirements takes, each with the scripts it queued run once it ends (gate-scan.ts). The row gets:
// - `to`, when every stand lands, and every landing is one tile of walkable land (a literal,
//   `movecoord(loc_coord, ...)`, or a tile each of several stands' walks ends on); off land, each stand is
//   reported and the row is underived;
// - `landings`, when a landing follows the stand (`movecoord(coord, ...)`, a step picked by the player's
//   side), some stand gives none, or some stand's landing is free and another's is not: each stand with the
//   landings it gives that are walkable land; the stands landing off land (offLand) and those giving no landing
//   (unlanded) are reported. A move onto a tile of the loc itself, which blocks it, lands on the tiles of
//   walkable land a step from that tile goes to, as the player walks off it (stepped, reported). A landing is
//   `free` when a path that needs nothing (gate-scan.ts LandingOutcome), or nothing but a wait (gate-scan.ts
//   waits; each landing so is reported, waited), lands there from that stand: the side a script lets through,
//   which the row's `from` may not say (the Shantay Pass lets a player level with it out free,
//   areas/area_alkharid/scripts/shantay_pass.rs2:70, where `from: north` takes the level stands for the checked
//   side). Every free landing is marked, but none when all of the row's are: then no path the bound run took
//   reads the row's requirement, so it says nothing of the stands;
// - `opens`, when no landing is derived and a path deleted the loc or swapped it for one that doesn't
//   block (the Kharazi jungle's `loc_change`, quests/quest_legends/scripts/jungle_tree.rs2:135, after which
//   it teleports the player two tiles on by a value proc, :141, :161, which is not read). LOC_DEL and
//   LOC_CHANGE take a duration and the loc comes back after it (the jungle's after `$respawnrate`), so the
//   loc's tiles are walkable for a while after the op, not for good;
// - nothing otherwise: the build report lists the row as underived, with what stopped each path.
// Quest windows on objects are left as they are: the reach fill never crosses one. A gate row with a skill
// requirement, on any shape, whose move is behind a `stat_random` gets that roll (Gate.roll, rollFor), the
// failed paths the bound run also follows giving what a failure does.
//
// Scripted moves (deriveScriptedMoves): the loc op triggers the scan finds moving the player with no
// condition read before the move (scanTrigger's `moves`), and the temporary blocks gates.ts confirms, outside
// classify.ts CONNECTOR_SCRIPTS (connectors.ts owns those), become World.crossings rows. Each is run for every
// placed loc of a config it covers (its own trigger, or its category's where the config has none, of an op the
// config has) and every stand on land, with no requirement. A stand's move is a passage when it lands on
// walkable land that no short walk from the stand reaches (walksTo): a stay put, a shuffle beside the loc or a
// step the collision allows is not one, nor a path that ends so (a pipe in use). A stand with one passage tile
// gives it, by the way behind a roll when there are several (the dearer, as an account may not meet what skips
// the roll), with that roll (rollFor); stands that give the same landing, move line and roll make one free row,
// `act: loc-op`, its source the line of the path's last move outside a call the scan counts as one move (Path.outer
// in gate-scan.ts). A stand landing on several passage tiles, off walkable land (not land, or blocked) where no
// short walk from it goes, or stopped by a construct the run can't read, is unsettled: the build report lists it,
// never guessed. A landing off walkable land on the tile of a loc that blocks nothing (gate-scan.ts blocksWalk: a
// plant picked) crosses nothing of the loc's and is no passage. One stopped only in the door procs (gate-scan.ts
// DOOR_PROCS) is a door's, which the collision data has open or gates.ts confirms. A loc tile and op a connector
// row has is refused, a duplicate.
import { CONNECTOR_SCRIPTS, inSource } from '../classify';
import { footprint, reachTiles, type PlacedLoc, type SiteOptions, type StepCollision } from '../place';
import { coord, STEPS, stepsOutOf } from '../reach';
import { damageAt } from '../roll';
import type { Connector, Crossing, Gate, HpDamage, Roll, Tile } from '../types';
import { byTile, cmp, onLandIn, push, tileKey, uniqueTiles } from '../util';
import type { ConnectorCollision } from './connectors';
import {
    blocksWalk,
    CROSS,
    DOOR_PROCS,
    gateLander,
    triggerConfigs,
    triggerKey,
    type CuratedGate,
    type GateCandidate,
    type GateScanInput,
    type LanderWorld,
    type LandingOutcome,
    type SeenRoll,
    type TriggerScan,
} from './gate-scan';
import type { Trigger } from './triggers';

/** The wall shapes: a move across one is a step through the wall, which the collision data gives. */
const WALL_SHAPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 9]);

export interface GateLandingInput {
    /** The placed gate rows (gate-scan.ts placeGates). */
    gates: readonly Gate[];
    /** What the gate scan ran on, and what it found. */
    scan: GateScanInput;
    candidates: readonly GateCandidate[];
    locConfigs: LanderWorld['locConfigs'];
    /** With `canStep`, a failed roll a short walk from the move's landing does not gate it (rollFor, walksTo). */
    collision: ConnectorCollision & Partial<Pick<StepCollision, 'canStep'>>;
    size: SiteOptions['size'];
    /** Every placed loc, for `loc_find` (gate-scan.ts LanderWorld.locAt); absent, none is found. */
    locs?: readonly PlacedLoc[];
}

/** A gate row on an object whose move no path derives, with what stopped each path. */
export interface UnderivedGate {
    trigger: string;
    loc: string;
    tile: Tile;
    /** Each construct that stopped a path, with its script line; sorted. */
    reasons: string[];
}

/** A stand whose landing is not walkable land: the row leaves it out (Gate.landings). */
export interface OffLandLanding {
    trigger: string;
    loc: string;
    tile: Tile;
    stand: Tile;
    landing: Tile;
    /** The command that lands there, as `file:line`. */
    at: string;
}

/** A stand of a row with landings that gives none: the row leaves it out (Gate.landings). */
export interface UnlandedStand {
    trigger: string;
    loc: string;
    tile: Tile;
    stand: Tile;
    /** Why no landing: each construct that stopped a path, with its script line, or what the paths did; sorted. */
    reasons: string[];
}

/** A landing written `free` that every path free to it reaches past a wait (gate-scan.ts waits): reported. */
export interface WaitedLanding {
    trigger: string;
    loc: string;
    tile: Tile;
    stand: Tile;
    landing: Tile;
    /** The waits, as `` `text` (file:line) ``; sorted. */
    waits: string[];
}

/** A stand whose move lands on a tile of the loc itself, which blocks it: the row lands on the tiles stepped out to. */
export interface SteppedLanding {
    trigger: string;
    loc: string;
    tile: Tile;
    stand: Tile;
    landing: Tile;
    /** The tiles of walkable land a step from `landing` goes to, in byTile order. */
    to: Tile[];
}

export interface GateLandings {
    /** The rows of `gates`, in order, those on objects with what their move does, and rolled ones their roll. */
    gates: Gate[];
    /** Rows on objects by outcome; `windows` are quest windows, left as they are. */
    counts: { to: number; landings: number; opens: number; underived: number; windows: number };
    /** Gate rows, on any shape, given the roll their move is behind (Gate.roll). */
    rolled: number;
    underived: UnderivedGate[];
    offLand: OffLandLanding[];
    unlanded: UnlandedStand[];
    waited: WaitedLanding[];
    stepped: SteppedLanding[];
    /** Gate rows whose move is behind a roll the row can't take (rollFor), with why: left without one. */
    unrolled: UnderivedGate[];
}

const NO_MOVE = 'no path an account meeting its requirements takes moves the player';

/** Why a stand's paths give no landing. */
const noLanding = (os: readonly LandingOutcome[]): string[] => {
    const why = os.flatMap(o =>
        o.k === 'underived' ? [o.why] : o.k === 'opens' ? [`opens the loc (${o.at}), landing nowhere derived`] : [],
    );
    return why.length ? [...new Set(why)].sort(cmp) : [NO_MOVE];
};

const sameTile = (a: Tile, b: Tile): boolean => tileKey(a) === tileKey(b);
const sameRoll = (a: SeenRoll, b: SeenRoll): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Roll of a move one stand makes behind `seen`, from the stand's failed paths of that roll (gate-scan.ts
 * LandingOutcome `fail`): the most ticks and damage they take, and where they leave the player (Roll.fail.to,
 * left out when that is the stand). Undefined when that tile is `across`, where the move takes the player anyway
 * (the Regicide tripwire's snag springs a trap and steps the player over all the same,
 * quests/quest_regicide/scripts/quest_regicide.rs2:162): the roll does not gate the move. Why not, when no failed
 * path is taken, one is not known offline, or they leave the player on different tiles.
 */
export function rollFor(
    seen: SeenRoll,
    stand: Tile,
    across: (t: Tile) => boolean,
    outcomes: readonly LandingOutcome[],
): Roll | { why: string } | undefined {
    const fails = outcomes.flatMap(o => (o.k === 'fail' && sameRoll(o.roll, seen) ? [o] : []));
    if (!fails.length) return { why: `${seen.source}: no failed roll's path an account takes` };
    const unknown = fails.flatMap(f => ('why' in f ? [f.why] : []));
    if (unknown.length) return { why: [...new Set(unknown)].sort(cmp).join('; ') };
    const known = fails.flatMap(f => ('why' in f ? [] : [f]));
    const tiles = [...new Map(known.map(f => [tileKey(f.tile ?? stand), f.tile ?? stand])).values()];
    if (tiles.length > 1)
        return {
            why: `${seen.source}: a failed roll leaves the player on ${tiles.length} tiles: ${tiles.map(coord).join(', ')}`,
        };
    const to = tiles[0]!;
    if (across(to)) return undefined;
    const hpDamage = worstDamage(known.map(f => f.damage));
    return {
        ...seen,
        fail: {
            ticks: Math.max(...known.map(f => f.ticks)),
            ...(sameTile(to, stand) ? {} : { to }),
            damage: damageAt(hpDamage, MAX_HITPOINTS),
            hpDamage,
        },
    };
}

/** The hitpoints Roll.fail.damage is taken at: the most a player has (99, the highest level). */
const MAX_HITPOINTS = 99;

/**
 * Of several failures' damage, the one that takes the most at MAX_HITPOINTS, the first of those alike. Where one
 * roll's failed paths take different hits in the scripts the build reads, none reads hitpoints (Legends' Quest's,
 * quests/quest_legends/scripts/quest_legends.rs2:1761), so that one is the most at any hitpoints.
 */
const worstDamage = ([d, ...more]: readonly HpDamage[]): HpDamage =>
    more.reduce((w, x) => (damageAt(x, MAX_HITPOINTS) > damageAt(w, MAX_HITPOINTS) ? x : w), d!);

/** A roll as a key, all but its failure's ticks and damage: two alike are one roll (mergeRolls). */
const rollKey = (r: Roll | undefined): string =>
    r ? JSON.stringify([r.stat, r.low, r.high, r.source, r.fail.to ?? null]) : '';

/** Rolls alike (rollKey) as one: the most ticks and damage any of them takes, the worst stand's. */
const mergeRolls = ([r, ...more]: readonly Roll[]): Roll => {
    const hpDamage = worstDamage([r!, ...more].map(m => m.fail.hpDamage ?? { a: 0, b: 1, c: m.fail.damage }));
    return {
        ...r!,
        fail: {
            ...r!.fail,
            ticks: Math.max(r!.fail.ticks, ...more.map(m => m.fail.ticks)),
            damage: damageAt(hpDamage, MAX_HITPOINTS),
            hpDamage,
        },
    };
};

/**
 * Gate.ticks of the paths that land (LandingOutcome `landing`), when each is known: the most they take. On a `to` row
 * (`perStand`), Gate.standTicks too, each stand's by stand tile, the fewest its paths there take, and Gate.ticks the
 * most of those. A stand's paths to the one landing differ only by a condition the bound run can't read and takes
 * both ways; where that changes the ticks in the scripts the build reads it is the player's own setting, the island
 * rope swings' run toggle (`%option_run`, skill_agility/scripts/shortcuts.rs2:137-141), and perfect play takes the
 * quicker way. A `landings` row's stand can land on several tiles in different ticks (the Barbarian course pipe,
 * skill_agility/scripts/barbarian_course.rs2:125-147), so it has none.
 */
function ticksOf(ls: readonly { stand: Tile; ticks?: number }[], perStand = false): Pick<Gate, 'ticks' | 'standTicks'> {
    if (!ls.length || ls.some(l => l.ticks === undefined)) return {};
    if (!perStand) return { ticks: Math.max(...ls.map(l => l.ticks!)) };
    const byStand = new Map<string, { stand: Tile; ticks: number }>();
    for (const l of ls) {
        const had = byStand.get(tileKey(l.stand));
        if (!had || had.ticks > l.ticks!) byStand.set(tileKey(l.stand), { stand: l.stand, ticks: l.ticks! });
    }
    const standTicks = [...byStand.values()].sort((a, b) => byTile(a.stand, b.stand));
    return { ticks: Math.max(...standTicks.map(st => st.ticks)), standTicks };
}

/** LanderWorld.locAt over the placed locs: the loc of a config whose tile is the one asked. */
function locFinder(locs: readonly PlacedLoc[]): NonNullable<LanderWorld['locAt']> {
    // The first loc placed on a tile and config wins: loc_find (server/engine/src/engine/script/handlers/LocOps.ts:79-93)
    // is World.getLoc, which returns the zone's first of that type (server/engine/src/engine/zone/Zone.ts:283-290).
    const byKey = new Map<string, PlacedLoc>();
    for (const l of locs) {
        const key = `${tileKey(l.tile)} ${l.config}`;
        if (!byKey.has(key)) byKey.set(key, l);
    }
    return (tile, config) => {
        const l = byKey.get(`${tileKey(tile)} ${config}`);
        return l && { shape: l.shape ?? 10, angle: l.rotation ?? 0 };
    };
}

/**
 * How far (Chebyshev) a short walk (walksTo) looks: from a stand to a landing that is no passage, and from a failed
 * roll's tile to the landing it gets the player to anyway (a fall washed to the far bank, ten tiles down the river
 * from the log's end, skill_agility/scripts/shortcuts.rs2:89); and how many steps past that distance it may take.
 */
const SHORT_WALK = 8;
const FAIL_WALK = 16;
const WALK_SLACK = 2;

/**
 * Whether a walk the collision allows (`canStep`) joins `a` to `b` on one level in at most their Chebyshev distance
 * plus WALK_SLACK steps, `b` no more than `within` from `a`: a move between them takes the player nowhere a walk
 * as short does not.
 */
export function walksTo(canStep: StepCollision['canStep'], a: Tile, b: Tile, within = SHORT_WALK): boolean {
    const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    if (a.level !== b.level || d > within) return false;
    const limit = d + WALK_SLACK;
    const seen = new Set([tileKey(a)]);
    let ring = [a];
    for (let step = 0; step < limit && ring.length; step++) {
        const next: Tile[] = [];
        for (const t of ring)
            for (const [dx, dz] of STEPS) {
                const n = { level: t.level, x: t.x + dx, z: t.z + dz };
                if (seen.has(tileKey(n)) || !canStep(t.level, t.x, t.z, dx, dz)) continue;
                if (sameTile(n, b)) return true;
                seen.add(tileKey(n));
                next.push(n);
            }
        ring = next;
    }
    return sameTile(a, b);
}

/**
 * Whether a failed roll's tile `t` is one where the move takes the player anyway (rollFor's `across`): a short walk
 * (walksTo, FAIL_WALK) from the move's landing and none to any of `stands`, the tiles the same move (to that landing)
 * is made from; or (with no steps to walk) the landing itself. A tile a short walk from both ends crossed nothing (the
 * Barbarian course's log drops the player south of its pond, skill_agility/scripts/barbarian_course.rs2:49-55, a short
 * walk from its east stands and from its landing): the roll gates the move.
 */
export function fellAcross(
    canStep: StepCollision['canStep'] | undefined,
    t: Tile,
    landing: Tile,
    stands: readonly Tile[],
): boolean {
    if (!canStep) return sameTile(t, landing);
    return walksTo(canStep, t, landing, FAIL_WALK) && !stands.some(s => walksTo(canStep, t, s, FAIL_WALK));
}

/** What the move of each gate row on an object does (sources/gate-landings.ts header). */
export function deriveGateLandings(input: GateLandingInput): GateLandings {
    const { collision, size } = input;
    const land = gateLander(input.scan, {
        locConfigs: input.locConfigs,
        mapBlocked: t => !collision.walkable(t.level, t.x, t.z),
        ...(input.locs ? { locAt: locFinder(input.locs) } : {}),
    });
    const triggers = new Map(input.scan.triggers.map(t => [triggerKey(t), t]));
    const { canStep } = collision;
    // The rows here stand for the scan's crossing (they have no `to`); where the scan finds none, its row
    // in gates.ts overrides the scan's moves (a jump the scan sees as fixed tiles), and stands for them all.
    const crosses = new Set(input.candidates.filter(c => c.moves.some(m => m.to === CROSS)).map(c => c.trigger));
    const onLand = onLandIn(collision);
    const counts = { to: 0, landings: 0, opens: 0, underived: 0, windows: 0 };
    let rolled = 0;
    const underived: UnderivedGate[] = [];
    const unrolled: UnderivedGate[] = [];
    const offLand: OffLandLanding[] = [];
    const unlanded: UnlandedStand[] = [];
    const waited: WaitedLanding[] = [];
    const stepped: SteppedLanding[] = [];

    /**
     * A gate row with a skill requirement whose move, from the stands that make it, is behind one roll: the row
     * with that roll after its source (rollFor, the stands' merged: mergeRolls), when every stand landing behind
     * a roll gives the same one; else as it was, reported in `unrolled`.
     */
    const withRoll = (g: Gate): Gate => {
        if (g.kind !== 'gate' || !g.requires.some(set => set.some(r => r.startsWith('skill:')))) return g;
        const trigger = triggers.get(g.trigger);
        if (!trigger) return g;
        const loc = { config: g.loc, tile: g.tile, shape: g.shape, rotation: g.angle };
        const move = crosses.has(g.trigger) ? CROSS : undefined;
        const runs = reachTiles(loc, collision, size)
            .filter(t => collision.land(t.level, t.x, t.z))
            .map(stand => ({
                stand,
                os: land(
                    trigger,
                    { config: g.loc, tile: g.tile, shape: g.shape, angle: g.angle, stand },
                    g.requires,
                    move,
                ),
            }));
        // The stands whose move lands on `tile`: a failure a short walk from one of them crossed nothing (fellAcross).
        const standsTo = (tile: Tile) =>
            runs.flatMap(r => (r.os.some(o => o.k === 'landing' && sameTile(o.tile, tile)) ? [r.stand] : []));
        const rolls = runs.flatMap(({ stand, os }) =>
            os.flatMap(o =>
                o.k !== 'landing'
                    ? []
                    : o.unrolled
                      ? [{ why: o.unrolled }]
                      : o.roll
                        ? [rollFor(o.roll, stand, t => fellAcross(canStep, t, o.tile, standsTo(o.tile)), os)]
                        : [],
            ),
        );
        const why = rolls.flatMap(r => (r && 'why' in r ? [r.why] : []));
        const taken = rolls.flatMap(r => (r && !('why' in r) ? [r] : []));
        const kinds = new Set(rolls.map(r => (r && !('why' in r) ? rollKey(r) : '')));
        if (!why.length && !taken.length) return g;
        if (why.length || kinds.size > 1) {
            unrolled.push({
                trigger: g.trigger,
                loc: g.loc,
                tile: g.tile,
                reasons: why.length
                    ? [...new Set(why)].sort(cmp)
                    : ['the stands give different rolls or failure tiles'],
            });
            return g;
        }
        rolled++;
        const { source, notes, ...head } = g;
        return { ...head, source, roll: mergeRolls(taken), ...(notes ? { notes } : {}) };
    };

    const gates = input.gates.map((g): Gate => {
        if (WALL_SHAPES.has(g.shape) || g.to) return g;
        if (g.kind !== 'gate') {
            counts.windows++;
            return g;
        }
        const fail = (reasons: string[]): Gate => {
            counts.underived++;
            underived.push({ trigger: g.trigger, loc: g.loc, tile: g.tile, reasons: [...new Set(reasons)].sort(cmp) });
            return g;
        };
        const trigger = triggers.get(g.trigger);
        if (!trigger) return fail([`no trigger ${g.trigger}`]);
        const loc = { config: g.loc, tile: g.tile, shape: g.shape, rotation: g.angle };
        const move = crosses.has(g.trigger) ? CROSS : undefined;
        const run = (stand: Tile) =>
            land(trigger, { config: g.loc, tile: g.tile, shape: g.shape, angle: g.angle, stand }, g.requires, move);
        const { notes, source, ...head } = g;
        const write = (more: Partial<Gate>): Gate => ({ ...head, ...more, source, ...(notes ? { notes } : {}) });
        const onLandOnly = (ts: Tile[]) => ts.filter(t => collision.land(t.level, t.x, t.z)).sort(byTile);
        const stands = onLandOnly(reachTiles(loc, collision, size));
        if (!stands.length) {
            // A loc every tile around which blocks (deep in the Kharazi jungle) is used once a neighbour
            // opens. Opening changes the loc's own tiles, not the player's, so the tiles the reach test accepts
            // but for standing there are run to see whether it opens; a landing from one is never written.
            const opens = onLandOnly(reachTiles(loc, collision, size, false)).some(stand =>
                run(stand).some(o => o.k === 'opens'),
            );
            if (!opens) return fail(['no tile on land reaches the loc']);
            counts.opens++;
            return write({ opens: true });
        }
        const byStand = stands.map(stand => ({ stand, outcomes: run(stand) }));
        const outcomes = byStand.flatMap(({ stand, outcomes: os }) => os.map(o => ({ stand, o })));
        // A move onto a tile of the loc itself, which blocks it (the Lumber Yard fence climbed from the south,
        // quests/quest_fluffs/scripts/quest_fluffs.rs2:127, 136), leaves the player there to walk off: it lands on
        // each tile of walkable land a step from it goes to.
        const { w, l: length } = footprint(loc, size);
        const ofLoc = (t: Tile) =>
            t.level === g.tile.level &&
            t.x >= g.tile.x &&
            t.x < g.tile.x + w &&
            t.z >= g.tile.z &&
            t.z < g.tile.z + length;
        const steppedOut = new Map<string, Tile[]>();
        const stepOut = (stand: Tile, t: Tile): Tile[] => {
            if (!canStep || onLand(t) || !collision.land(t.level, t.x, t.z) || !ofLoc(t)) return [t];
            const key = `${tileKey(stand)} ${tileKey(t)}`;
            let to = steppedOut.get(key);
            if (!to) {
                to = stepsOutOf(t, onLand, canStep);
                steppedOut.set(key, to);
                if (to.length) stepped.push({ trigger: g.trigger, loc: g.loc, tile: g.tile, stand, landing: t, to });
            }
            return to.length ? to : [t];
        };
        const landed = outcomes.flatMap(({ stand, o }) =>
            o.k === 'landing' ? stepOut(stand, o.tile).map(tile => ({ stand, ...o, tile })) : [],
        );
        // One way the row reads, by the section header's order: a landing, then an opening.
        if (landed.length) {
            // Each landing once per stand, with the line that lands there; free when a path that needs nothing
            // lands there from that stand (header), unless every landing is.
            const keyOf = (l: (typeof landed)[number]) => `${tileKey(l.stand)} ${tileKey(l.tile)}`;
            const freeKeys = new Set(landed.flatMap(l => (l.free ? [keyOf(l)] : [])));
            // The waits (gate-scan.ts waits) each free landing is reached past; null when a path free to it passes none.
            const waitsAt = new Map<string, Set<string> | null>();
            for (const l of landed) {
                const had = waitsAt.get(keyOf(l));
                if (!l.free || had === null) continue;
                waitsAt.set(keyOf(l), l.waits?.length ? new Set([...(had ?? []), ...l.waits]) : null);
            }
            const seen = new Set<string>();
            const unique = landed.filter(l => {
                const key = keyOf(l);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const isFree = (l: (typeof landed)[number]) => freeKeys.size < unique.length && freeKeys.has(keyOf(l));
            const offLandOf = (l: (typeof landed)[number]): OffLandLanding => ({
                trigger: g.trigger,
                loc: g.loc,
                tile: g.tile,
                stand: l.stand,
                landing: l.tile,
                at: l.at,
            });
            // One tile from every stand: a fixed landing, or one the player's tile led to but every stand
            // shares (a walk to a fixed start first, as the monkey bars do). A row some of whose landings are
            // free keeps them as landings, which say which.
            const [one] = unique;
            if (
                byStand.every(b => b.outcomes.some(o => o.k === 'landing')) &&
                unique.every(l => tileKey(l.tile) === tileKey(one!.tile)) &&
                (stands.length > 1 || unique.every(l => !l.player)) &&
                !unique.some(isFree)
            ) {
                if (!onLand(one!.tile)) {
                    offLand.push(...unique.map(offLandOf));
                    return fail(['every landing is off walkable land']);
                }
                counts.to++;
                return write({ to: one!.tile, ...ticksOf(landed, true) });
            }
            const landings: NonNullable<Gate['landings']> = [];
            for (const l of unique) {
                if (!onLand(l.tile)) {
                    offLand.push(offLandOf(l));
                    continue;
                }
                landings.push({ stand: l.stand, landing: l.tile, ...(isFree(l) ? { free: true } : {}) });
                const passed = isFree(l) && waitsAt.get(keyOf(l));
                if (passed)
                    waited.push({
                        trigger: g.trigger,
                        loc: g.loc,
                        tile: g.tile,
                        stand: l.stand,
                        landing: l.tile,
                        waits: [...passed].sort(cmp),
                    });
            }
            if (!landings.length) return fail(['every landing is off walkable land']);
            landings.sort((a, b) => byTile(a.stand, b.stand) || byTile(a.landing, b.landing));
            // The stands that give no landing: left out of the row, and reported.
            for (const b of byStand)
                if (!b.outcomes.some(o => o.k === 'landing'))
                    unlanded.push({
                        trigger: g.trigger,
                        loc: g.loc,
                        tile: g.tile,
                        stand: b.stand,
                        reasons: noLanding(b.outcomes),
                    });
            counts.landings++;
            return write({ landings, ...ticksOf(landed.filter(l => onLand(l.tile))) });
        }
        if (outcomes.some(({ o }) => o.k === 'opens')) {
            counts.opens++;
            return write({ opens: true });
        }
        const reasons = outcomes.flatMap(({ o }) => (o.k === 'underived' ? [o.why] : []));
        return fail(reasons.length ? reasons : [NO_MOVE]);
    });
    const out = gates.map(withRoll);
    return { gates: out, counts, rolled, underived, offLand, unlanded, unrolled, waited, stepped };
}

// ---- Scripted moves -----------------------------------------------------------------------------------

const TRIGGER = /^(op|ap)loc([1-5]),(_?)([a-z0-9_]+)$/;

/** A crossing's act as a sort key. */
const actKey = (c: Crossing): string => (c.act.kind === 'loc-op' ? `${c.act.loc} ${c.act.op}` : '');

export interface ScriptedInput {
    scan: GateScanInput;
    /** What the scan makes of each trigger (gate-scan.ts scanTrigger), shared with the gate scan. */
    scanOf: (t: Trigger) => TriggerScan;
    /** The gates.ts entries: a temporary block's trigger gets rows, its why as their notes. */
    curated: readonly CuratedGate[];
    locConfigs: LanderWorld['locConfigs'];
    /** Every placed loc. */
    locs: readonly PlacedLoc[];
    collision: ConnectorCollision & Pick<StepCollision, 'canStep'>;
    size: SiteOptions['size'];
    /** The connector rows (World.connectors): a move on one's loc tile and op is the connector's. */
    connectors: readonly Pick<Connector, 'loc' | 'op'>[];
}

/**
 * What came of one placed loc of a scripted move (ScriptedMoves.counts): rows; a move no bound run settles; a
 * duplicate of a connector row; a door (every path stopped in the door procs: the collision's door list, or
 * gates.ts, has it); or no passage.
 */
export type ScriptedOutcome = 'rows' | 'unsettled' | 'duplicate' | 'door' | 'not-a-passage';

const OUTCOMES: readonly ScriptedOutcome[] = ['rows', 'unsettled', 'duplicate', 'door', 'not-a-passage'];

/** A placed loc of a scripted move, or one stand of it, whose landing the bound run can't settle: reported. */
export interface UnsettledMove {
    trigger: string;
    loc: string;
    tile: Tile;
    /** The stand, when the loc's other stands give rows. */
    stand?: Tile;
    /** Each construct or landing set that stopped it, with its script line; sorted. */
    reasons: string[];
}

export interface ScriptedMoves {
    /** World.crossings: by loc tile, config, op, landing and first stand. */
    crossings: Crossing[];
    /**
     * The triggers: left to connectors.ts (`connector-scripts`), with no placed loc of an op its config has
     * (`unplaced`), or by the first outcome of their placed locs in ScriptedOutcome's order; and the placed locs
     * by outcome.
     */
    counts: { triggers: Record<string, number>; locs: Record<ScriptedOutcome, number> };
    unsettled: UnsettledMove[];
    /** Moves on a loc tile and op a connector row has, as `<trigger> <loc> (x, z) op<n>`: an error. */
    duplicates: string[];
}

/**
 * One stand's passage: where it lands, the line of the move the scan counts, the ticks a success takes (absent when
 * not known offline), and the roll it is behind.
 */
interface Passage {
    stand: Tile;
    tile: Tile;
    move: string;
    ticks?: number;
    roll?: Roll;
    /** The roll the move is behind and the stand's outcomes, until withRoll settles Passage.roll from them. */
    seen?: { roll: SeenRoll; outcomes: readonly LandingOutcome[] };
}

/**
 * The loc op moves no gate row makes (sources/gate-landings.ts header, scripted moves), as World.crossings
 * rows, with what came of each trigger and placed loc.
 */
export function deriveScriptedMoves(input: ScriptedInput): ScriptedMoves {
    const { collision, size, locConfigs } = input;
    const land = gateLander(input.scan, {
        locConfigs,
        mapBlocked: t => !collision.walkable(t.level, t.x, t.z),
        locAt: locFinder(input.locs),
    });
    const blocks = new Map(input.curated.filter(e => e.kind === 'temporary-block').map(e => [e.trigger, e]));
    const connectorAt = new Set(input.connectors.map(c => `${tileKey(c.loc)} ${c.op}`));
    const configsOf = triggerConfigs(input.scan.triggers, locConfigs);
    const byConfig = new Map<string, PlacedLoc[]>();
    for (const l of input.locs) push(byConfig, l.config, l);
    const onLand = onLandIn(collision);
    const near = (a: Tile, b: Tile) => walksTo(collision.canStep, a, b);

    /** What one stand's paths do: a passage, why none can be told (`stuck`), or nothing (`door` when a door's). */
    const fromStand = (
        t: Trigger,
        l: PlacedLoc,
        stand: Tile,
    ): { passage: Passage } | { stuck: string[] } | { door: boolean } => {
        const binding = { config: l.config, tile: l.tile, shape: l.shape ?? 10, angle: l.rotation ?? 0, stand };
        const os = land(t, binding, []);
        const moved = os.flatMap(o => (o.k === 'landing' && !near(stand, o.tile) ? [o] : []));
        const passages = moved.filter(o => onLand(o.tile));
        // A path landing off walkable land (not land, or blocked) gives a landing no row can stand for; but a move
        // onto the tile of a loc that blocks nothing (a plant picked, general_use/scripts/pickables.rs2:6 and
        // player/scripts/pickup.rs2:30) crosses nothing of the loc's, whatever else blocks that tile.
        const open = blocksWalk(locConfigs.get(l.config), binding.shape) === false;
        const offLand = moved.flatMap(o =>
            onLand(o.tile) || (open && sameTile(o.tile, l.tile))
                ? []
                : [`lands off walkable land at ${coord(o.tile)} (${o.at})`],
        );
        const unrolled = passages.flatMap(o => (o.unrolled ? [o.unrolled] : []));
        if (offLand.length || unrolled.length) return { stuck: [...new Set([...offLand, ...unrolled])].sort(cmp) };
        const tiles = uniqueTiles(passages.map(o => o.tile));
        if (tiles.length > 1) return { stuck: [`lands on ${tiles.length} tiles: ${tiles.map(coord).join(', ')}`] };
        if (!tiles.length) {
            const why = os.flatMap(o =>
                o.k === 'underived'
                    ? [o.why]
                    : o.k === 'opens'
                      ? [`opens the loc (${o.at}), landing nowhere derived`]
                      : [],
            );
            if (why.length && why.every(w => w.includes(`(${DOOR_PROCS}`))) return { door: true };
            return why.length ? { stuck: [...new Set(why)].sort(cmp) } : { door: false };
        }
        // Several ways there (a branch on a condition the run goes both ways on): the one behind a roll, as an
        // account may not meet what skips it (the lighthouse bridge once mended walks over, unrolled,
        // quests/quest_horror/scripts/quest_horror.rs2:73); of several alike, the first by the move's line.
        const rolled = passages.filter(o => o.roll);
        const ways = [...new Map((rolled.length ? rolled : passages).map(o => [JSON.stringify(o.roll ?? null), o]))];
        if (ways.length > 1) return { stuck: [`lands on ${coord(tiles[0]!)} behind ${ways.length} rolls`] };
        const [way] = (rolled.length ? rolled : passages).sort((a, b) => cmp(a.move, b.move));
        const ticks = way!.ticks === undefined ? {} : { ticks: way!.ticks };
        const seen = way!.roll ? { seen: { roll: way!.roll, outcomes: os } } : {};
        return { passage: { stand, tile: way!.tile, move: way!.move, ...ticks, ...seen } };
    };
    /**
     * A stand's passage with its roll (rollFor), once every stand's passage is known: a failure lands across only
     * when no stand making the same move (to the same landing) is a short walk from it (fellAcross).
     */
    const withRoll = (
        r: { stand: Tile; out: ReturnType<typeof fromStand> },
        all: readonly { stand: Tile; out: ReturnType<typeof fromStand> }[],
    ): { stand: Tile; out: ReturnType<typeof fromStand> } => {
        if (!('passage' in r.out) || !r.out.passage.seen) return r;
        const { seen, ...passage } = r.out.passage;
        const stands = all.flatMap(x =>
            'passage' in x.out && sameTile(x.out.passage.tile, passage.tile) ? [x.stand] : [],
        );
        const across = (f: Tile) => fellAcross(collision.canStep, f, passage.tile, stands);
        const roll = rollFor(seen.roll, r.stand, across, seen.outcomes);
        if (roll && 'why' in roll) return { stand: r.stand, out: { stuck: [roll.why] } };
        return { stand: r.stand, out: { passage: { ...passage, ...(roll ? { roll } : {}) } } };
    };

    const triggers: Record<string, number> = {};
    const locs = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<ScriptedOutcome, number>;
    const crossings: Crossing[] = [];
    const unsettled: UnsettledMove[] = [];
    const duplicates: string[] = [];
    const tally = (k: string) => (triggers[k] = (triggers[k] ?? 0) + 1);

    for (const t of input.scan.triggers) {
        const m = triggerKey(t).match(TRIGGER);
        if (t.on !== 'loc' || !m) continue;
        const s = input.scanOf(t);
        const block = s && 'candidate' in s ? blocks.get(s.candidate.trigger) : undefined;
        if (!s || ('candidate' in s && !block)) continue;
        if (CONNECTOR_SCRIPTS.some(dir => inSource(t.file, dir))) {
            tally('connector-scripts');
            continue;
        }
        const op = m[2]!;
        const placed = configsOf(t).flatMap(c => byConfig.get(c) ?? []);
        if (!placed.length) {
            tally('unplaced');
            continue;
        }
        const outcomes = placed.map((l): ScriptedOutcome => {
            if (connectorAt.has(`${tileKey(l.tile)} ${op}`)) {
                duplicates.push(`${triggerKey(t)} ${l.config} ${coord(l.tile)} op${op}`);
                return 'duplicate';
            }
            const stands = reachTiles(l, collision, size).filter(x => collision.land(x.level, x.x, x.z));
            const raw = stands.map(stand => ({ stand, out: fromStand(t, l, stand) }));
            const runs = raw.map(r => withRoll(r, raw));
            const given = runs.flatMap(r => ('passage' in r.out ? [r.out.passage] : []));
            const stuck = runs.flatMap(r => ('stuck' in r.out ? [{ stand: r.stand, reasons: r.out.stuck }] : []));
            const report = (reasons: string[], stand?: Tile) =>
                unsettled.push({
                    trigger: triggerKey(t),
                    loc: l.config,
                    tile: l.tile,
                    ...(stand ? { stand } : {}),
                    reasons,
                });
            if (!given.length) {
                if (!stuck.length) return runs.some(r => 'door' in r.out && r.out.door) ? 'door' : 'not-a-passage';
                report([...new Set(stuck.flatMap(x => x.reasons))].sort(cmp));
                return 'unsettled';
            }
            for (const st of stuck) report(st.reasons, st.stand);
            const rows = new Map<string, Passage[]>();
            for (const g of given) push(rows, JSON.stringify([g.tile, g.move, g.ticks ?? null, rollKey(g.roll)]), g);
            for (const group of rows.values()) {
                const [g] = group;
                crossings.push({
                    via: 'scripted',
                    act: { kind: 'loc-op', loc: l.config, op: Number(op) },
                    at: l.tile,
                    from: group.map(x => x.stand).sort(byTile),
                    landings: [{ tile: g!.tile }],
                    requires: [[]],
                    ...(g!.ticks === undefined ? {} : { ticks: g!.ticks }),
                    ...(g!.roll ? { roll: mergeRolls(group.map(x => x.roll!)) } : {}),
                    source: g!.move.match(/\(([^()]*\.rs2:\d+)\)$/)?.[1] ?? g!.move,
                    ...(block?.why ? { notes: block.why } : {}),
                });
            }
            return 'rows';
        });
        for (const o of outcomes) locs[o]++;
        tally(OUTCOMES.find(o => outcomes.includes(o))!);
    }
    crossings.sort(
        (a, b) =>
            byTile(a.at, b.at) ||
            cmp(actKey(a), actKey(b)) ||
            byTile(a.landings[0]!.tile, b.landings[0]!.tile) ||
            byTile(a.from[0]!, b.from[0]!),
    );
    unsettled.sort(
        (a, b) => cmp(a.trigger, b.trigger) || byTile(a.tile, b.tile) || byTile(a.stand ?? a.tile, b.stand ?? b.tile),
    );
    return {
        crossings,
        counts: { triggers: Object.fromEntries(Object.entries(triggers).sort(([a], [b]) => cmp(a, b))), locs },
        unsettled,
        duplicates: duplicates.sort(cmp),
    };
}
