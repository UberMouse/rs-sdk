// Where each ladder, staircase, trapdoor, manhole and gangplank puts the player: the landings of every
// `connector` feature (a loc with an op trigger in classify.ts CONNECTOR_SCRIPTS), read from its op scripts
// by running them offline for that one loc. The scripts pick a landing three ways (ladders+stairs/scripts/
// ladders.rs2, stairs.rs2): a jump relative to the player's tile or the loc's (`~climb_ladder(movecoord(
// coord(), 0, 1, 0), true)`, per op or per `switch_int (loc_angle)`); a table keyed by the loc's tile
// (`switch_coord (loc_coord) { case 0_50_50_4_7 : p_telejump(1_50_50_5_9); ... }`); and a label several
// locs call with their coords (`@stair_options(<up>, <down>)`). The parser in runescript.ts reads the
// RuneScript those use, and an evaluator runs a trigger with `loc_coord`, `loc_angle` and the `^constants`
// known and the player's `coord` symbolic: a shift of where the op started, moved by each move on the path,
// so a path lands where its last move leaves the player (a gangplank steps onto the plank, then jumps on
// by a shift from there, general_use/scripts/gangplank.rs2:15). A proc that can't move the player is run
// for its value (`~gangplank_dir_mod`, a sign by `loc_angle`). A condition it can't settle (a dialog
// choice, a quest varp) is taken both ways, so an op can
// have several landings; a landing it can't compute, an op that never moves the player, or a loop on the
// way, is reported with the construct that stopped it, never guessed. An op that swaps its loc for another
// on a path with no condition and no move (general_use/scripts/trapdoors.rs2: Open is
// `loc_change(trapdoor_open, 500)`) is followed one step: the other loc's ops are run on the same tile,
// and each that moves the player gives the swapping op a row.
import { codeOf, CONNECTOR_SCRIPTS, inSource } from '../classify';
import { footprint, reachTiles, type SiteCollision, type SiteOptions } from '../place';
import type { Connector, Feature, Tile } from '../types';
import { cmp, push } from '../util';
import { first, type Config } from './configs';
import { constantInt, type Constant } from './constants';
import {
    equal,
    fold,
    merge,
    scriptCache,
    TooManyPaths,
    unknown,
    type CoordValue,
    type Flow as SharedFlow,
    type Value,
} from './evaluate';
import type { Expr, Node, Script, Stmt } from './runescript';
import type { Callable, Trigger } from './triggers';

/** z from which a level-0 tile is underground: those areas are drawn at the surface's x and z + 6400. */
export const UNDERGROUND_Z = 6400;

/**
 * How near (Chebyshev, in tiles) a way back must be: a connector on the landing's level within this of
 * the landing, whose own landing is within this of the first loc. Nearness only, no walk between them is
 * checked. The furthest-apart pair is 4 tiles (the Yanille dungeon stairs, stairs.rs2 yanillestairsdown
 * and yanillestairsup); past 5 the nearest candidates are other ladders, whose partners are missing.
 * So two unrelated connectors that near each other's landings can falsely pair, and hide a one-way one.
 */
export const WAY_BACK = 5;

/** How near a loc's footprint another connector's landing must be to count as an arrival there. */
const ARRIVAL = 2;

/** Bounds label and proc calls, so a cycle can't recurse forever. */
const MAX_DEPTH = 12;

/**
 * Bounds the paths one op's run follows: each condition not settled offline doubles them. Past it the op
 * is underived ("too many paths"), its landings dropped rather than a partial set kept. The scripts
 * reach at most 3.
 */
export const MAX_PATHS = 64;

export interface ConnectorCollision extends SiteCollision {
    /**
     * The tile's zone is in the collision data: sdk/pathfinding.ts initPathfinding allocates every
     * empty mainland zone as open so its search can cross gaps, and those zones are not land.
     */
    land(level: number, x: number, z: number): boolean;
}

/** A connector op whose landing the scripts don't give offline. */
export interface Underived {
    feature: number;
    loc: Tile;
    config: string;
    /** 1-5; 0 when the config has no trigger in CONNECTOR_SCRIPTS at all. */
    op: number;
    /** The construct that stopped it, with its script line. */
    reason: string;
}

export interface ConnectorInput {
    features: readonly Feature[];
    triggers: readonly Trigger[];
    callables: readonly Callable[];
    locConfigs: ReadonlyMap<string, Config>;
    collision: ConnectorCollision;
    size: SiteOptions['size'];
    /** The scripts' `^constants`; none known when absent. */
    constants?: ReadonlyMap<string, Constant>;
}

export interface Connectors {
    connectors: Connector[];
    underived: Underived[];
    /** Indexes into `connectors` of those with no connector back (WAY_BACK). */
    oneWay: number[];
}

// ---- Evaluation -------------------------------------------------------------------------------------

/** What one placed loc's op does: its landings, and why a path through it lands nowhere. */
interface Run {
    landings: CoordValue[];
    /**
     * Landings the evaluator can't compute: the call and what is unknown. A set, as several paths can
     * reach one call: each reason once, in the order first met.
     */
    unknown: Set<string>;
    /** Why each path that never moved the player stopped, when none did. */
    dead: string[];
}

interface Path {
    /** The locals, and the player's tile under POS once a move on the path has set it. */
    env: ReadonlyMap<string, Value>;
    notes: readonly string[];
    /** Where the last move on the path leaves the player, or why it can't be told offline. */
    landing?: CoordValue | { why: string };
    /** What a `return` ending the path gives back, for a proc run as a value. */
    returned?: Value;
}

/**
 * The key the player's tile is kept under in a path's locals once a move sets it (no local is named so).
 * Absent, it is where the op started: the relative coord (0, 0, 0).
 */
const POS = 'coord';

/** A path the evaluator can't follow past an expression (a proc that can move the player, as a value). */
class Unfollowed extends Error {}

type Flow = SharedFlow<Path>;

/** Where a node is, as `file:line`. */
const at = (file: string, n: Node): string => `${file}:${n.line}`;

/** The commands that move the player, as MOVES finds them in a body. */
const MOVERS = new Set(['p_telejump', 'p_teleport']);
const MOVES = /\b(?:p_telejump|p_teleport)\s*\(/;
const CALL = /[@~][a-z0-9_]+|\bjump\(\s*([a-z0-9_]+)/g;

/** A loc an op swaps its loc for, and the swap as a reason names it. */
interface Swap {
    into: string;
    why: string;
}

/**
 * The loc an op swaps its loc for: its script is one path of engine commands, with no condition, no
 * move and no label or proc call (either can hide one), that runs one `loc_change(<other>, <duration>)`.
 * LOC_CHANGE replaces the active loc on its own tile with its shape and angle (server/engine/src/engine/
 * script/handlers/LocOps.ts); `.loc_change` changes a loc found elsewhere, so is not a swap. The other
 * commands on the path (a message, a sound, a `loc_add` on another tile: general_use/scripts/
 * manholes.rs2 puts the cover beside the manhole) don't stop it.
 */
function swapOf(script: Script, self: string): Swap | undefined {
    const swaps: Swap[] = [];
    for (const s of script.body) {
        if (s.t === 'return') break;
        if (s.t !== 'call') return undefined;
        const { name } = s.call;
        if (MOVERS.has(name) || name === 'jump' || name.startsWith('@') || name.startsWith('~')) return undefined;
        if (name !== 'loc_change') continue;
        const into = s.call.args?.[0];
        if (into?.t !== 'name' || into.args !== null || into.name === self) return undefined;
        swaps.push({ into: into.name, why: `\`${s.text}\` (${at(script.file, s)}) turns it into ${into.name}` });
    }
    return swaps.length === 1 ? swaps[0] : undefined;
}

/**
 * Integer arithmetic as `calc` compiles to ADD, SUB, MULTIPLY and DIVIDE: the stack holds ints, so a
 * quotient truncates (server/engine/src/engine/script/handlers/NumberOps.ts).
 */
const ARITHMETIC: Readonly<Record<string, (a: number, b: number) => number>> = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => Math.trunc(a / b),
};

/**
 * Runs connector op scripts for one loc at a time, over the triggers' callables and the `^constants`
 * (their whole-number values: `^loc_west`, engine.constant).
 */
function evaluator(
    callables: readonly Callable[],
    constants: ReadonlyMap<string, Constant>,
): (trigger: Trigger, loc: Tile, angle: number) => Run {
    const byCall = new Map(callables.map(c => [c.call, c]));
    const scriptOf = scriptCache();

    // Whether a callable, or one it calls, moves the player: the others (mes, an npc's taunt) can't
    // change a landing and are passed over without parsing.
    const moving = new Map<string, boolean>();
    const moves = (call: string): boolean => {
        const known = moving.get(call);
        if (known !== undefined) return known;
        const seen = new Set([call]);
        const queue = [call];
        let found = false;
        while (queue.length && !found) {
            const c = byCall.get(queue.shift()!);
            if (!c) continue;
            const code = codeOf(c.body);
            if (MOVES.test(code)) found = true;
            for (const m of code.matchAll(CALL)) {
                const next = m[1] ? `@${m[1]}` : m[0];
                if (!seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        moving.set(call, found);
        return found;
    };

    return (trigger, loc, angle) => {
        const run: Run = { landings: [], unknown: new Set(), dead: [] };
        /** How deep procs run as values are nested, against MAX_DEPTH. */
        let valueDepth = 0;

        /**
         * A proc that can't move the player, called as a value (`def_int $dir_mod = ~gangplank_dir_mod;`,
         * general_use/scripts/gangplank.rs2:9): run with its arguments and the player's tile, it is the value
         * every path through it returns, when they all return one known value; unknown otherwise. What it
         * runs into on the way (a loop) is not a reason the op's landing is underived, so it isn't kept.
         */
        const valueOf = (e: Expr & { t: 'name' }, env: ReadonlyMap<string, Value>, file: string): Value => {
            const callee = byCall.get(e.name);
            const script = callee && scriptOf(e.name, callee.file, callee.line, callee.body);
            if (!script || 'error' in script || valueDepth >= MAX_DEPTH) return unknown(e.text);
            const args = e.args ?? [];
            const params = new Map(
                script.params.map((param, i) => [param, args[i] ? evaluate(args[i]!, env, file) : unknown(param)]),
            );
            const pos = env.get(POS);
            if (pos) params.set(POS, pos);
            const reasons = new Set(run.unknown);
            valueDepth++;
            try {
                const flow = block(script.body, [{ env: params, notes: [] }], script.file, 0);
                const values = flow.ended.map(p => p.returned);
                const [v] = values;
                // A path that runs off the end returns nothing.
                if (flow.live.length || !v || v.t === 'unknown') return unknown(e.text);
                return values.every(w => w && equal(w, v) === true) ? v : unknown(e.text);
            } catch (err) {
                if (err instanceof TooManyPaths || err instanceof Unfollowed) return unknown(e.text);
                throw err;
            } finally {
                valueDepth--;
                run.unknown = reasons;
            }
        };

        const evaluate = (e: Expr, env: ReadonlyMap<string, Value>, file: string): Value => {
            switch (e.t) {
                case 'num':
                    return { t: 'int', n: e.n };
                case 'coord':
                    return { t: 'coord', relative: false, ...e.tile, at: at(file, e) };
                case 'str':
                    return unknown(e.text);
                case 'bin': {
                    const [l, r] = [evaluate(e.l, env, file), evaluate(e.r, env, file)];
                    const folded = fold(e.op, l, r, e.text);
                    if (folded) return folded;
                    if (l.t !== 'int' || r.t !== 'int') return unknown(e.text);
                    const arithmetic = ARITHMETIC[e.op];
                    if (arithmetic) return { t: 'int', n: arithmetic(l.n, r.n) };
                    const b = { '<': l.n < r.n, '>': l.n > r.n, '<=': l.n <= r.n, '>=': l.n >= r.n }[e.op];
                    return b === undefined ? unknown(e.text) : { t: 'bool', b };
                }
                case 'name':
                    break;
            }
            const args = e.args ?? [];
            if (e.name.startsWith('$')) {
                const v = env.get(e.name);
                return v && v.t !== 'unknown' ? v : unknown(e.name);
            }
            if (e.name.startsWith('^') && e.args === null) {
                const n = constantInt(constants, e.name);
                return n === undefined ? unknown(e.name) : { t: 'int', n, name: e.name };
            }
            // Engine commands (server/engine/src/engine/script/handlers): COORD is the player's tile
            // (PlayerOps.ts), LOC_COORD and LOC_ANGLE the active loc's (LocOps.ts), and MOVECOORD adds
            // (x, level, z) to a coord (ServerOps.ts). P_TELEJUMP and P_TELEPORT set the player's tile at
            // once (PathingEntity.ts teleport), so COORD after a move on the path is where it put the player.
            if (e.name === 'coord' && !args.length)
                return env.get(POS) ?? { t: 'coord', relative: true, level: 0, x: 0, z: 0, at: at(file, e) };
            if (e.name === 'loc_coord' && !args.length) return { t: 'coord', relative: false, ...loc, at: at(file, e) };
            if (e.name === 'loc_angle' && !args.length) return { t: 'int', n: angle };
            if ((e.name === 'true' || e.name === 'false') && e.args === null)
                return { t: 'bool', b: e.name === 'true' };
            // `calc(x)` is x.
            if (e.name === 'calc' && args.length === 1) return evaluate(args[0]!, env, file);
            if (e.name === 'movecoord' && args.length === 4) {
                const [base, dx, dlevel, dz] = args.map(a => evaluate(a, env, file)) as [Value, Value, Value, Value];
                const off = [dx, dlevel, dz];
                const stuck = [base, ...off].find(v => v.t === 'unknown');
                if (stuck) return stuck;
                if (base.t !== 'coord' || !off.every(v => v.t === 'int')) return unknown(e.text);
                const [x, level, z] = off.map(v => (v as { n: number }).n) as [number, number, number];
                return { ...base, level: base.level + level, x: base.x + x, z: base.z + z, at: at(file, e) };
            }
            if (e.name.startsWith('~')) {
                // A proc that can move the player would land somewhere unseen inside a value.
                if (moves(e.name))
                    throw new Unfollowed(`\`${e.text}\` (${at(file, e)}) moves the player inside a value`);
                return valueOf(e, env, file);
            }
            return unknown(e.text);
        };

        const block = (stmts: readonly Stmt[], paths: Path[], file: string, depth: number): Flow => {
            const ended: Path[] = [];
            let live = paths;
            for (const s of stmts) {
                const next: Path[] = [];
                for (const p of live) {
                    let f: Flow;
                    try {
                        f = statement(s, p, file, depth);
                    } catch (e) {
                        if (!(e instanceof Unfollowed)) throw e;
                        // That path ends unfollowed; the others still run.
                        run.unknown.add(e.message);
                        f = { live: [], ended: [p] };
                    }
                    next.push(...f.live);
                    ended.push(...f.ended);
                }
                live = next;
                if (live.length + ended.length > MAX_PATHS) throw new TooManyPaths();
            }
            return { live, ended };
        };

        const statement = (s: Stmt, p: Path, file: string, depth: number): Flow => {
            const note = (text: string): Path => ({ ...p, notes: [...p.notes, text] });
            switch (s.t) {
                case 'set':
                    return {
                        live: [{ ...p, env: new Map(p.env).set(s.name, evaluate(s.value, p.env, file)) }],
                        ended: [],
                    };
                case 'def': {
                    const env = new Map(p.env);
                    for (const name of s.names) env.set(name, unknown(name));
                    return { live: [{ ...p, env }], ended: [] };
                }
                case 'return':
                    return { live: [], ended: [s.value ? { ...p, returned: evaluate(s.value, p.env, file) } : p] };
                case 'if': {
                    const c = evaluate(s.cond, p.env, file);
                    if (c.t === 'bool') return block(c.b ? s.yes : s.no, [p], file, depth);
                    // Not settled offline (a dialog choice, a varp, the player's side): both ways.
                    return merge(block(s.yes, [p], file, depth), block(s.no, [p], file, depth));
                }
                case 'switch': {
                    const subject = evaluate(s.subject, p.env, file);
                    const fallback = s.cases.find(c => c.keys === null);
                    const matches = s.cases.filter(c => c.keys !== null);
                    const hits = matches.map(c => c.keys!.map(k => equal(evaluate(k, p.env, file), subject)));
                    if (hits.every(h => h.every(x => x !== undefined))) {
                        const hit = matches.find((_, i) => hits[i]!.includes(true));
                        if (hit) return block(hit.body, [p], file, depth);
                        const missed = note(`\`${s.text}\` (${at(file, s)}) has no case for it`);
                        return fallback ? block(fallback.body, [missed], file, depth) : { live: [missed], ended: [] };
                    }
                    // A subject or key not known offline: every case may run.
                    const flows = s.cases.map(c => block(c.body, [p], file, depth));
                    return merge(...flows, fallback ? { live: [], ended: [] } : { live: [p], ended: [] });
                }
                case 'while':
                    // A loop runs a number of times the evaluator can't know: the op stops here.
                    run.unknown.add(`\`${s.text}\` (${at(file, s)}) is not read`);
                    return { live: [], ended: [p] };
                case 'call':
                    break;
            }
            const { name, args } = s.call;
            if (name === 'p_telejump' || name === 'p_teleport') {
                // The player is there from here on, and it is the path's landing until a later move.
                const v = args?.length === 1 ? evaluate(args[0]!, p.env, file) : unknown(s.text);
                const landing =
                    v.t === 'coord'
                        ? v
                        : {
                              why: `\`${s.text}\` (${at(file, s)}): ${v.t === 'unknown' ? v.text : s.text} is not known offline`,
                          };
                const pos = v.t === 'coord' ? v : unknown(`coord after ${at(file, s)}`);
                return { live: [{ ...p, landing, env: new Map(p.env).set(POS, pos) }], ended: [] };
            }
            const jump = name === 'jump' && args?.[0]?.t === 'name' ? `@${args[0].name}` : undefined;
            const call = jump ?? (name.startsWith('@') || name.startsWith('~') ? name : undefined);
            // Any other command can't move the player in these scripts.
            if (!call) return { live: [p], ended: [] };
            const isLabel = call.startsWith('@');
            const callee = byCall.get(call);
            if (!callee || !moves(call)) {
                // A proc that never moves the player returns to the script; a label never does.
                if (!isLabel) return { live: [p], ended: [] };
                const why = callee ? 'does not move the player' : 'jumps to a label no script defines';
                return { live: [], ended: [note(`\`${s.text}\` (${at(file, s)}) ${why}`)] };
            }
            const script = scriptOf(call, callee.file, callee.line, callee.body);
            if ('error' in script || depth >= MAX_DEPTH) {
                run.unknown.add('error' in script ? script.error : `\`${s.text}\` (${at(file, s)}) calls too deep`);
                return { live: [], ended: [p] };
            }
            const env = new Map(
                script.params.map((param, i) => [param, args?.[i] ? evaluate(args[i]!, p.env, file) : unknown(param)]),
            );
            // The callee starts where the player is, and the caller goes on from where it leaves them.
            const pos = p.env.get(POS);
            if (pos) env.set(POS, pos);
            const flow = block(script.body, [{ ...p, env, returned: undefined }], script.file, depth + 1);
            const out = [...flow.live, ...flow.ended];
            const back = (q: Path): Path => {
                const moved = q.env.get(POS);
                return { ...q, env: moved ? new Map(p.env).set(POS, moved) : p.env, returned: undefined };
            };
            // A label is a jump: the script ends where it does. A proc returns, to the caller's locals.
            return isLabel ? { live: [], ended: out } : { live: out.map(back), ended: [] };
        };

        const script = scriptOf(`${trigger.file}:${trigger.line}`, trigger.file, trigger.line, trigger.body);
        if ('error' in script) {
            run.unknown.add(script.error);
            return run;
        }
        let flow: Flow;
        try {
            flow = block(script.body, [{ env: new Map(), notes: [] }], script.file, 0);
        } catch (e) {
            if (!(e instanceof TooManyPaths)) throw e;
            return {
                landings: [],
                unknown: new Set([`too many paths: ${trigger.file}:${trigger.line} branches past ${MAX_PATHS} ways`]),
                dead: [],
            };
        }
        // Each path lands where its last move leaves the player.
        for (const p of [...flow.live, ...flow.ended])
            if (p.landing && 'why' in p.landing) run.unknown.add(p.landing.why);
            else if (p.landing) run.landings.push(p.landing);
        if (!run.landings.length && !run.unknown.size)
            run.dead = [
                ...new Set(
                    [...flow.live, ...flow.ended].map(p =>
                        p.notes.length
                            ? p.notes.join(', then ')
                            : `${trigger.file}:${trigger.line} never moves the player`,
                    ),
                ),
            ].sort(cmp);
        return run;
    };
}

// ---- Connectors -------------------------------------------------------------------------------------

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const tileKey = (t: Tile): string => `${t.level} ${t.x} ${t.z}`;
/** A tile moved by a relative coord. */
const shift = (t: Tile, v: CoordValue): Tile => ({ level: t.level + v.level, x: t.x + v.x, z: t.z + v.z });

/** `up` or `down` by level; on one level, out of or into the underground. */
export function directionOf(loc: Tile, landing: Tile): Connector['direction'] {
    if (landing.level !== loc.level) return landing.level > loc.level ? 'up' : 'down';
    const [below, under] = [loc.z >= UNDERGROUND_Z, landing.z >= UNDERGROUND_Z];
    return below === under ? 'other' : below ? 'up' : 'down';
}

interface Pending {
    feature: number;
    op: number;
    landing: CoordValue;
    /** The swapped-in loc's op that moves the player (Connector.thenOp). */
    followed?: Connector['thenOp'];
}

/**
 * Every connector's landings (sources/connectors.ts header), each with a stand tile: a walkable tile on
 * land that reaches the loc (place.ts reachTiles, the engine's reach test), nearest another connector's
 * landing beside the loc (where the way back puts a player), then nearest the loc's middle. A jump
 * relative to the player lands as far from the stand as the script shifts it, so its stand is first one
 * whose landing is walkable land, then one whose landing reaches a connector (the way back, usable where
 * the player arrives). An op that swaps the loc (swapOf) takes the landings of the swapped-in loc's
 * ops, run on the same tile, each row naming that op in `thenOp`; one of those ops that never moves the
 * player gives no row. Rows come out by feature, op, landing and `thenOp` op.
 */
export function deriveConnectors(input: ConnectorInput): Connectors {
    const { features, locConfigs, collision, size } = input;
    const run = evaluator(input.callables, input.constants ?? new Map());
    const scriptOf = scriptCache();
    const byTarget = new Map<string, Trigger[]>();
    // Every config's own loc triggers, as `config oploc1` / `config aploc1`, in any script.
    const own = new Set<string>();
    for (const t of input.triggers) {
        if (t.on !== 'loc') continue;
        if (!t.category) own.add(`${t.target} ${t.kind}loc${t.op}`);
        if (CONNECTOR_SCRIPTS.some(s => inSource(t.file, s))) push(byTarget, `${t.category ? '_' : ''}${t.target}`, t);
    }
    /** A config's triggers in CONNECTOR_SCRIPTS, by op. */
    const triggersOf = (config: string): Trigger[] => {
        const category = first(locConfigs.get(config), 'category');
        // The engine runs a config's own trigger over its category's for the same trigger type (oploc1 and
        // aploc1 are two), wherever that trigger's script lives (server/engine/src/engine/script/
        // ScriptProvider.ts getByTrigger, ServerTriggerType.ts).
        const shadowed = (t: Trigger) => own.has(`${config} ${t.kind}loc${t.op}`);
        return [
            ...(byTarget.get(config) ?? []),
            ...(category ? (byTarget.get(`_${category}`) ?? []).filter(t => !shadowed(t)) : []),
        ].sort((a, b) => cmp(a.op, b.op));
    };
    const opNameOf = (config: string, op: number): string => first(locConfigs.get(config), `op${op}`) ?? `op${op}`;
    const noTrigger = `no op trigger in ${CONNECTOR_SCRIPTS.join(' or ')}`;

    const underived: Underived[] = [];
    const pending: Pending[] = [];
    features.forEach((f, feature) => {
        if (f.kind !== 'connector') return;
        const fail = (op: number, reason: string) =>
            underived.push({ feature, loc: f.tile, config: f.config, op, reason });
        const triggers = triggersOf(f.config);
        if (!triggers.length) fail(0, noTrigger);
        const angle = f.rotation ?? 0;
        for (const t of triggers) {
            const op = Number(t.op);
            const script = scriptOf(`${t.file}:${t.line}`, t.file, t.line, t.body);
            const swap = 'error' in script ? undefined : swapOf(script, f.config);
            if (swap) {
                // One step only: an op of the swapped-in loc that swaps back (Close) lands nowhere.
                const next = triggersOf(swap.into);
                let moved = false;
                for (const u of next) {
                    const r = run(u, f.tile, angle);
                    const followed = { op: Number(u.op), opName: opNameOf(swap.into, Number(u.op)) };
                    for (const landing of r.landings) pending.push({ feature, op, landing, followed });
                    for (const reason of r.unknown) fail(op, `${swap.why}, then ${reason}`);
                    moved ||= r.landings.length > 0 || r.unknown.size > 0;
                }
                if (!moved)
                    fail(
                        op,
                        `${swap.why}, ${next.length ? 'none of whose ops moves the player' : `which has ${noTrigger}`}`,
                    );
                continue;
            }
            const r = run(t, f.tile, angle);
            for (const landing of r.landings) pending.push({ feature, op, landing });
            for (const reason of r.unknown) fail(op, reason);
            if (!r.landings.length && !r.unknown.size) fail(op, r.dead.join(' / '));
        }
    });

    // The landings that don't depend on a stand, per level: where a player arrives beside a loc.
    const arrivals = new Map<number, { feature: number; tile: Tile }[]>();
    for (const p of pending)
        if (!p.landing.relative) push(arrivals, p.landing.level, { feature: p.feature, tile: p.landing });

    const onLand = (t: Tile) => collision.land(t.level, t.x, t.z) && collision.walkable(t.level, t.x, t.z);
    // The tiles on land each connector is used from, and all of them together.
    const reach = new Map<number, Tile[]>();
    features.forEach((f, i) => {
        if (f.kind === 'connector')
            reach.set(
                i,
                reachTiles(f, collision, size).filter(t => collision.land(t.level, t.x, t.z)),
            );
    });
    const usedFrom = new Set([...reach.values()].flatMap(ts => ts.map(tileKey)));

    const rows: Connector[] = [];
    const seen = new Set<string>();
    for (const p of pending) {
        const f = features[p.feature]!;
        const { w, l } = footprint(f, size);
        const middle = { x: f.tile.x + (w - 1) / 2, z: f.tile.z + (l - 1) / 2 };
        const near = (arrivals.get(f.tile.level) ?? []).filter(
            a =>
                a.feature !== p.feature &&
                a.tile.x >= f.tile.x - ARRIVAL &&
                a.tile.x <= f.tile.x + w - 1 + ARRIVAL &&
                a.tile.z >= f.tile.z - ARRIVAL &&
                a.tile.z <= f.tile.z + l - 1 + ARRIVAL,
        );
        const arrival = (t: Tile) => (near.length ? Math.min(...near.map(a => dist2(t, a.tile))) : 0);
        // 0 for a tile whose relative landing reaches a connector, 1 for one that doesn't, 0 when absolute.
        const back = (t: Tile) => (p.landing.relative && !usedFrom.has(tileKey(shift(t, p.landing))) ? 1 : 0);
        let tiles = [...reach.get(p.feature)!];
        if (p.landing.relative) {
            const landed = tiles.filter(t => onLand(shift(t, p.landing)));
            if (landed.length) tiles = landed;
        }
        tiles.sort(
            (a, b) =>
                back(a) - back(b) ||
                arrival(a) - arrival(b) ||
                dist2(a, middle) - dist2(b, middle) ||
                a.x - b.x ||
                a.z - b.z,
        );
        const stand = tiles[0] ?? null;
        if (p.landing.relative && !stand) {
            underived.push({
                feature: p.feature,
                loc: f.tile,
                config: f.config,
                op: p.op,
                reason: `the landing is the player's tile shifted (${p.landing.at}), and no tile on land reaches the loc`,
            });
            continue;
        }
        const landing = p.landing.relative
            ? shift(stand!, p.landing)
            : { level: p.landing.level, x: p.landing.x, z: p.landing.z };
        const row = `${p.feature} ${p.op} ${tileKey(landing)} ${p.followed?.op ?? 0}`;
        if (seen.has(row)) continue;
        seen.add(row);
        rows.push({
            feature: p.feature,
            loc: f.tile,
            op: p.op,
            opName: opNameOf(f.config, p.op),
            direction: directionOf(f.tile, landing),
            landing,
            stand,
            ...(p.landing.relative ? { relative: true as const } : {}),
            source: p.landing.at,
            ...(p.followed ? { thenOp: p.followed } : {}),
        });
    }
    rows.sort(
        (a, b) =>
            a.feature - b.feature ||
            a.op - b.op ||
            a.landing.level - b.landing.level ||
            a.landing.x - b.landing.x ||
            a.landing.z - b.landing.z ||
            (a.thenOp?.op ?? 0) - (b.thenOp?.op ?? 0),
    );

    // The way back: a connector on the landing's level near the landing, landing near this loc.
    const byLevel = new Map<number, Connector[]>();
    for (const r of rows) push(byLevel, r.loc.level, r);
    const oneWay = rows.flatMap((r, i) =>
        (byLevel.get(r.landing.level) ?? []).some(
            b =>
                b.feature !== r.feature &&
                cheb(b.loc, r.landing) <= WAY_BACK &&
                b.landing.level === r.loc.level &&
                cheb(b.landing, r.loc) <= WAY_BACK,
        )
            ? []
            : [i],
    );
    underived.sort((a, b) => a.feature - b.feature || a.op - b.op || cmp(a.reason, b.reason));
    return { connectors: rows, underived, oneWay };
}
