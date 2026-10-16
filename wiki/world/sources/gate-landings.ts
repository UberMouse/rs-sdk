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
// Quest windows on objects are left as they are: the reach fill never crosses one.
import { reachTiles, type SiteOptions } from '../place';
import type { Gate, Tile } from '../types';
import { cmp } from '../util';
import type { ConnectorCollision } from './connectors';
import {
    CROSS,
    gateLander,
    triggerKey,
    type GateCandidate,
    type GateScanInput,
    type LanderWorld,
    type LandingOutcome,
} from './gate-scan';

/** The wall shapes: a move across one is a step through the wall, which the collision data gives. */
const WALL_SHAPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 9]);

export interface GateLandingInput {
    /** The placed gate rows (gate-scan.ts placeGates). */
    gates: readonly Gate[];
    /** What the gate scan ran on, and what it found. */
    scan: GateScanInput;
    candidates: readonly GateCandidate[];
    locConfigs: LanderWorld['locConfigs'];
    collision: ConnectorCollision;
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
    /** The rows of `gates`, in order, those on objects with what their move does. */
    gates: Gate[];
    /** Rows on objects by outcome; `windows` are quest windows, left as they are. */
    counts: { to: number; landings: number; opens: number; underived: number; windows: number };
    underived: UnderivedGate[];
    offLand: OffLandLanding[];
    unlanded: UnlandedStand[];
}

const NO_MOVE = 'no path an account meeting its requirements takes moves the player';

/** Why a stand's paths give no landing. */
const noLanding = (os: readonly LandingOutcome[]): string[] => {
    const why = os.flatMap(o =>
        o.k === 'underived' ? [o.why] : o.k === 'opens' ? [`opens the loc (${o.at}), landing nowhere derived`] : [],
    );
    return why.length ? [...new Set(why)].sort(cmp) : [NO_MOVE];
};

const tileKey = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;
const byTile = (a: Tile, b: Tile): number => a.level - b.level || a.x - b.x || a.z - b.z;

/** What the move of each gate row on an object does (sources/gate-landings.ts header). */
export function deriveGateLandings(input: GateLandingInput): GateLandings {
    const { collision, size } = input;
    const land = gateLander(input.scan, {
        locConfigs: input.locConfigs,
        mapBlocked: t => !collision.walkable(t.level, t.x, t.z),
    });
    const triggers = new Map(input.scan.triggers.map(t => [triggerKey(t), t]));
    // The rows here stand for the scan's crossing (they have no `to`); where the scan finds none, its row
    // in gates.ts overrides the scan's moves (a jump the scan sees as fixed tiles), and stands for them all.
    const crosses = new Set(input.candidates.filter(c => c.moves.some(m => m.to === CROSS)).map(c => c.trigger));
    const onLand = (t: Tile) => collision.land(t.level, t.x, t.z) && collision.walkable(t.level, t.x, t.z);
    const counts = { to: 0, landings: 0, opens: 0, underived: 0, windows: 0 };
    const underived: UnderivedGate[] = [];
    const offLand: OffLandLanding[] = [];
    const unlanded: UnlandedStand[] = [];

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
            const [first] = unique;
            if (
                byStand.every(b => b.outcomes.some(o => o.k === 'landing')) &&
                unique.every(l => tileKey(l.tile) === tileKey(first!.tile)) &&
                (stands.length > 1 || unique.every(l => !l.player))
            ) {
                if (!onLand(first!.tile)) {
                    offLand.push(...unique.map(offLandOf));
                    return fail(['every landing is off walkable land']);
                }
                counts.to++;
                return write({ to: first!.tile });
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
    return { gates, counts, underived, offLand, unlanded };
}
