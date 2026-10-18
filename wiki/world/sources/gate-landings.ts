// Where a gated move on an object puts the player. The gate scan (sources/gate-scan.ts) writes `cross` for
// every move that is not a coord literal: on a wall (shapes 0-3 and 9) that is a step through the wall,
// which the collision data gives, but on any other loc (a ladder, climbing rocks, a jungle bush) it says
// nothing of where the player ends up. So each placed loc of a gate row with no `to` on an object has its
// trigger run once per tile the loc is used from (place.ts reachTiles, on land), with the loc and that tile
// bound (gate-scan.ts gateLander), down the paths that make the row's move (the scan's crossing; every move
// when the scan sees none, as for a jump gates.ts reads as a crossing) and that an account meeting the
// row's requirements takes. The row gets:
// - `to`, when every stand lands, and every landing is one tile of walkable land (a literal,
//   `movecoord(loc_coord, ...)`, or a tile each of several stands' walks ends on); off land, each stand is
//   reported and the row is underived;
// - `landings`, when a landing follows the stand (`movecoord(coord, ...)`, a step picked by the player's
//   side), or some stand gives none: each stand with the landings it gives that are walkable land; the
//   stands landing off land (offLand) and those giving no landing (unlanded) are reported;
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
import { reachTiles, type PlacedLoc, type SiteOptions, type StepCollision } from '../place';
import { coord, STEPS } from '../reach';
import type { Connector, Crossing, Gate, Roll, Tile } from '../types';
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
    return {
        ...seen,
        fail: {
            ticks: Math.max(...known.map(f => f.ticks)),
            ...(sameTile(to, stand) ? {} : { to }),
            damage: Math.max(...known.map(f => f.damage)),
        },
    };
}

/** A roll as a key, all but its failure's ticks and damage: two alike are one roll (mergeRolls). */
const rollKey = (r: Roll | undefined): string =>
    r ? JSON.stringify([r.stat, r.low, r.high, r.source, r.fail.to ?? null]) : '';

/** Rolls alike (rollKey) as one: the most ticks and damage any of them takes, the worst stand's. */
const mergeRolls = ([r, ...more]: readonly Roll[]): Roll => ({
    ...r!,
    fail: {
        ...r!.fail,
        ticks: Math.max(r!.fail.ticks, ...more.map(m => m.fail.ticks)),
        damage: Math.max(r!.fail.damage, ...more.map(m => m.fail.damage)),
    },
});

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

/** What the move of each gate row on an object does (sources/gate-landings.ts header). */
export function deriveGateLandings(input: GateLandingInput): GateLandings {
    const { collision, size } = input;
    const land = gateLander(input.scan, {
        locConfigs: input.locConfigs,
        mapBlocked: t => !collision.walkable(t.level, t.x, t.z),
    });
    const triggers = new Map(input.scan.triggers.map(t => [triggerKey(t), t]));
    // A failed roll's tile where the move lands anyway: a short walk from it, or (with no steps to walk) the tile.
    const { canStep } = collision;
    const across = (t: Tile, landing: Tile) =>
        canStep ? walksTo(canStep, t, landing, FAIL_WALK) : sameTile(t, landing);
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
        const rolls = reachTiles(loc, collision, size)
            .filter(t => collision.land(t.level, t.x, t.z))
            .flatMap(stand => {
                const binding = { config: g.loc, tile: g.tile, shape: g.shape, angle: g.angle, stand };
                const os = land(trigger, binding, g.requires, move);
                return os.flatMap(o =>
                    o.k !== 'landing'
                        ? []
                        : o.unrolled
                          ? [{ why: o.unrolled }]
                          : o.roll
                            ? [rollFor(o.roll, stand, t => across(t, o.tile), os)]
                            : [],
                );
            });
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
        const landed = outcomes.flatMap(({ stand, o }) => (o.k === 'landing' ? [{ stand, ...o }] : []));
        // One way the row reads, by the section header's order: a landing, then an opening.
        if (landed.length) {
            // Each landing once per stand, with the line that lands there.
            const seen = new Set<string>();
            const unique = landed.filter(l => {
                const key = `${tileKey(l.stand)} ${tileKey(l.tile)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const offLandOf = (l: (typeof landed)[number]): OffLandLanding => ({
                trigger: g.trigger,
                loc: g.loc,
                tile: g.tile,
                stand: l.stand,
                landing: l.tile,
                at: l.at,
            });
            // One tile from every stand: a fixed landing, or one the player's tile led to but every stand
            // shares (a walk to a fixed start first, as the monkey bars do).
            const [one] = unique;
            if (
                byStand.every(b => b.outcomes.some(o => o.k === 'landing')) &&
                unique.every(l => tileKey(l.tile) === tileKey(one!.tile)) &&
                (stands.length > 1 || unique.every(l => !l.player))
            ) {
                if (!onLand(one!.tile)) {
                    offLand.push(...unique.map(offLandOf));
                    return fail(['every landing is off walkable land']);
                }
                counts.to++;
                return write({ to: one!.tile });
            }
            const landings: NonNullable<Gate['landings']> = [];
            for (const l of unique)
                if (onLand(l.tile)) landings.push({ stand: l.stand, landing: l.tile });
                else offLand.push(offLandOf(l));
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
            return write({ landings });
        }
        if (outcomes.some(({ o }) => o.k === 'opens')) {
            counts.opens++;
            return write({ opens: true });
        }
        const reasons = outcomes.flatMap(({ o }) => (o.k === 'underived' ? [o.why] : []));
        return fail(reasons.length ? reasons : [NO_MOVE]);
    });
    const out = gates.map(withRoll);
    return { gates: out, counts, rolled, underived, offLand, unlanded, unrolled };
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

/** One stand's passage: where it lands, the line of the move the scan counts, and the roll it is behind. */
interface Passage {
    stand: Tile;
    tile: Tile;
    move: string;
    roll?: Roll;
}

/**
 * The loc op moves no gate row makes (sources/gate-landings.ts header, scripted moves), as World.crossings
 * rows, with what came of each trigger and placed loc.
 */
export function deriveScriptedMoves(input: ScriptedInput): ScriptedMoves {
    const { collision, size, locConfigs } = input;
    const land = gateLander(input.scan, { locConfigs, mapBlocked: t => !collision.walkable(t.level, t.x, t.z) });
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
        const roll =
            way!.roll && rollFor(way!.roll, stand, f => walksTo(collision.canStep, f, way!.tile, FAIL_WALK), os);
        if (roll && 'why' in roll) return { stuck: [roll.why] };
        return { passage: { stand, tile: way!.tile, move: way!.move, ...(roll ? { roll } : {}) } };
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
            const runs = stands.map(stand => ({ stand, out: fromStand(t, l, stand) }));
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
            for (const g of given) push(rows, JSON.stringify([g.tile, g.move, rollKey(g.roll)]), g);
            for (const group of rows.values()) {
                const [g] = group;
                crossings.push({
                    via: 'scripted',
                    act: { kind: 'loc-op', loc: l.config, op: Number(op) },
                    at: l.tile,
                    from: group.map(x => x.stand).sort(byTile),
                    landings: [{ tile: g!.tile }],
                    requires: [[]],
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
