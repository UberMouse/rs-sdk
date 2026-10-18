// Gate candidates, read from the loc op scripts. A gate is a loc whose op refuses passage unless a
// condition holds (a quest stage, a level, an item worn or held, a toll, a members world, a loadout rule).
// The walker runs every loc op trigger (op 1-5 and use-item) that can move the player, down every path,
// and records each move with what the path took on the way to it:
//
// - a move is `p_telejump`, `p_teleport` or `p_exactmove`; a call of a door proc (a proc under
//   doors/scripts/ that moves the player or changes a loc: `~open_and_close_door`, `~open_door`, the
//   double-door procs), which crosses the loc; a call of any other moving proc given a fixed tile
//   (`~forcemove(0_44_46_54_9)`, `~climb_ladder(<coord>, true)`), a move there; or a call of a moving
//   proc with no condition the scan reads anywhere below it (conditions.ts readsSubjects; an agility
//   walk), a crossing. A move to a coord the script fixes is a jump to that tile; any other (relative to
//   the loc or the player) crosses the loc. Moves inside a random event, the ring of life, equipping or a
//   death (INCIDENTAL) are not passage.
// - a `queue*` command names a `[queue,name]` script (GateScanInput.queues) the engine runs once the
//   trigger's script ends, however it ended: each path runs the moving scripts it queued then, and their
//   moves are the trigger's, under every condition the path took (the Shantay Pass's way in,
//   areas/area_alkharid/scripts/shantay_pass.rs2:97, moves in [queue,shantay_pass_enter], :103). The engine
//   runs queued scripts in the order queued within the main queue list, as delays allow; the weak queue runs
//   after it (Player.ts processQueues). The walker runs a path's in the order queued, which differs only where
//   one has a delay or a weakqueue comes before another queue, and follows a weakqueue as if it ran, though the
//   engine drops one when a modal closes or the active script resumes (Player.ts closeModal, executeScript): the
//   build reports each moving script queued with a delay other than 0 or on the weak queue (untimedQueues).
//   processQueue starts a queued script with no active loc, so its loc commands leave the trigger's loc as it was.
// - a condition on a quest varp, `%qp`, `stat`/`stat_base`, `inv_total(inv|worn, obj)`,
//   `inv_totalcat(inv|worn, category)`, `inv_getobj(worn, slot)`, `last_useitem`, `map_members`, a
//   loadout proc (gates.ts LOADOUT_PROCS) or a tool checker's result against null (`~pickaxe_checker`,
//   conditions.ts toolCheckers) is read by sources/conditions.ts, and a parameterless proc that only
//   returns a condition is read as it; one on the player's tile (`~check_axis(coord, loc_coord,
//   loc_angle)`, `coordx(coord) < coordx(loc_coord)`) records the side the player stands on; one on the
//   loc alone (`loc_coord`, `loc_angle`, `loc_type`) and a dialogue choice or random draw go both ways and
//   add nothing; any other (an npc nearby, another varp) is unread: it adds nothing to the sets, but one
//   that decides whether or where the trigger moves is listed (GateCandidate.unread) and makes it a
//   candidate. `inv_del(inv, coins, n)` before the move is a toll, other objs deleted are consumed.
//
// A trigger that branched on one of those conditions before a move is a candidate, and the scan proposes
// what it is (GateKind) for gates.ts to confirm. Quest conditions are read for a settled account (each
// quest not started or complete, sources/quests.ts): a move that needs the varp above a stage needs
// `quest:<id>>=<stage>` (or `quest:<id>` at complete), whether the script tests it so or refuses below it;
// one open neither before the quest nor after it is a quest window and left out. One open only before the
// quest is done (Iban's temple turning the player away once Underground Pass is done) is a window too,
// unless another path to the same tile needs that quest or tests that varp, as a toll paid until the quest
// is done and free after (beforeOnly); on a quest with `or` varps it stays as other:<text>.
//
// A bound run (Binding, gateLander) runs one trigger for one placed loc and one tile the player uses it
// from, to say where its move puts the player (sources/gate-landings.ts). The loc's facts and params are
// known, `coord` is the player's tile, moved by each position-setting command on the path, and `inzone`,
// `map_blocked` (from the collision data) and `~check_axis` are computed, so a side condition is settled
// rather than recorded. A call the scan counts as one move is run through to the position-setting commands in
// its body (a proc given only known values may call itself, as ~agility_walk does), and the landing is where
// the last one leaves the player; `loc_del`, and `loc_change` to a loc whose collision does not block,
// open the loc. A `stat_random` roll is followed both ways, each path marked: a slip is not the move, but
// its path says what a failure does, from the delays (Path.ticks) and damage (Path.damage) on it. A
// condition the scan reads only as other:<text>, or not at all, goes both ways, as which paths are kept
// (consistent) reads only requirements, refusals and quest stages; but the path keeps its text (Path.passed),
// and one past any but a wait (a var against `map_clock` taken the way time opens, waits) is not free.
import { codeOf } from '../classify';
import { minimalSets, requirementSet, subsetOf } from '../requirements';
import type { Gate, Quest, Side, Tile } from '../types';
import { cmp, push } from '../util';
import { conditionReader, FLIP, NEGATE, nameOf, readsSubjects, type QuestRef } from './conditions';
import { first, type Config } from './configs';
import { constantInt, type Constant } from './constants';
import type { LoadoutProc } from './loadout';
import {
    equal,
    fold,
    merge,
    scriptCache,
    TooManyPaths,
    truthOf,
    unknown,
    type CoordValue,
    type Flow as SharedFlow,
    type Value,
} from './evaluate';
import { coordTile, isCoordLiteral, tileCoord, type Expr, type Stmt } from './runescript';
import type { Callable, Trigger } from './triggers';

/** Bounds label and proc calls, so a cycle can't recurse forever. */
const MAX_DEPTH = 16;

/** Bounds the paths one trigger's run follows; past it the trigger is unclear. */
export const MAX_PATHS = 512;

/** Where the door procs are: a call of one that moves the player or changes a loc crosses the loc. */
export const DOOR_PROCS = 'doors/scripts/';

/**
 * Where a move is not passage: a random event takes the player away and back (macro events/), a ring of
 * life saves a dying player (general/scripts/enchanted_jewellry/ring_of_life.rs2), equipping an item
 * in the Tourist Trap camp gets the player searched and thrown out (player/scripts/equip.rs2:23), and a death
 * respawns the player ([queue,player_death], player/scripts/death.rs2:50). A callable there never counts as
 * moving, nor does one that moves only through it.
 */
const INCIDENTAL = [
    'macro events/',
    'general/scripts/enchanted_jewellry/ring_of_life.rs2',
    'player/scripts/equip.rs2',
    'player/scripts/death.rs2',
];

/** The commands that move the player, by the argument that is the destination. */
const MOVE_COMMANDS: Readonly<Record<string, number>> = { p_telejump: 0, p_teleport: 0, p_exactmove: 1 };

const MOVES = /\b(?:p_telejump|p_teleport|p_exactmove)\s*\(/;
const CHANGES_LOC = /\bloc_(?:add|change|del)\s*\(/;
/** A payment the scan reads; the conditions it reads are sources/conditions.ts readsSubjects. */
const PAYS = /\binv_del\s*\(/;
const CALL = /[@~][a-z0-9_]+|\bjump\(\s*([a-z0-9_]+)/g;
/** The commands that queue a script for the player (handlers/PlayerOps.ts); `.queue`, the other player's, is not one. */
const QUEUE_COMMANDS: ReadonlySet<string> = new Set(['queue', 'strongqueue', 'weakqueue', 'longqueue']);
/** A queue command, its `*` form too: the command, the script it queues, and its delay as written. */
const QUEUES = new RegExp(
    `(?<![\\w.])(${[...QUEUE_COMMANDS].join('|')})\\s*\\*?\\(\\s*([a-z0-9_]+)\\s*(?:,\\s*([^,()]*))?`,
    'g',
);
/** A random draw (an agility or thieving roll, a chance): it goes both ways and gates nothing. */
const RANDOM = /\b(?:random|randominc|stat_random)\s*\(|~random_range\b|~chance\b/;

/** A move that crosses the loc, as GateMove.to writes it; any other `to` is a coord literal. */
export const CROSS = 'cross';

/**
 * What a candidate is. `gate`: a steady requirement opens it. `side-effect`: always passable, the check
 * only advances a quest or a dialogue. `temporary-block`: shut only during a quest stage. `quest-window`:
 * open only between two stages, shut before and after. `unclear`: the scan can't say (the walker
 * stopped, or no move is left once the impossible paths are dropped).
 */
export type GateKind = 'gate' | 'side-effect' | 'temporary-block' | 'quest-window' | 'unclear';

/** One minimal way to make a move: what it needs, and the sides the path stood on (Side, or the condition). */
export interface GateOption {
    requires: string[];
    sides: string[];
}

/** A move a candidate's trigger makes, and the minimal ways to make it. */
export interface GateMove {
    /** CROSS, or the coord literal the move lands on. */
    to: string;
    options: GateOption[];
}

export interface GateCandidate {
    /** The trigger as its header names it: `oploc1,chefdoor`, `oploc1,_shilo_metalgate` (a category). */
    trigger: string;
    /** The trigger's header line, `file:line`. */
    source: string;
    /** What the scan makes of it, for gates.ts to confirm. */
    kind: GateKind;
    /** By `to`. */
    moves: GateMove[];
    /** The conditions it branched on before a move, as `` `text` (file:line) ``, each once in order met. */
    conditions: string[];
    /**
     * The conditions it branched on before a move that the scan can't read (not a dialogue choice or a random
     * draw), as `conditions` lists them: they gate nothing in `moves`, so gates.ts says what they do.
     */
    unread: string[];
    /**
     * Quest windows: moves open only between two stages, and blocks shut only during one, as
     * `<to or block>: <conditions>`.
     */
    windows: string[];
    /**
     * What names each `quest:<id>>=<n>` in `moves`: the stage constant it was compared with (`^name`), one
     * past it for a `>` (`^name+1`), or the number when the script names no constant.
     */
    stages: Record<string, string>;
    /** For `unclear`: what stopped the walker. */
    why?: string;
}

export interface GateScanInput {
    triggers: readonly Trigger[];
    callables: readonly Callable[];
    /** The `[queue,name]` scripts (triggers.ts parseQueues): one a path queues runs once the trigger ends. */
    queues?: readonly Callable[];
    constants: ReadonlyMap<string, Constant>;
    quests: readonly Quest[];
    /** Loadout rule id -> the proc that checks it (gates.ts LOADOUT_PROCS). */
    loadoutProcs: Readonly<Record<string, LoadoutProc>>;
    /** Config names a bare name may be (objs, locs, npcs): what `def_obj $key = brass_key` holds. */
    names: ReadonlySet<string>;
    /** Tool-checker procs and the obj categories they accept (sources/conditions.ts toolCheckers). */
    tools?: ReadonlyMap<string, readonly string[]>;
}

/** What a bound run (gateLander) reads of the world beyond the scripts. */
export interface LanderWorld {
    /** The loc configs: a loc's params and category, and whether a loc blocks. */
    locConfigs: ReadonlyMap<string, Config>;
    /** MAP_BLOCKED (ServerOps.ts): the tile's collision blocks walking (GameMap.ts isMapBlocked). */
    mapBlocked(tile: Tile): boolean;
}

/** One placed loc and the tile the player uses it from: what a bound run knows that the scan doesn't. */
export interface Binding {
    config: string;
    tile: Tile;
    shape: number;
    angle: number;
    stand: Tile;
}

/** A `stat_random(stat, low, high)` a path rolled, at its script line (`source`, `file:line`). */
export interface SeenRoll {
    stat: string;
    low: number;
    high: number;
    source: string;
}

/**
 * What a move past a gate's check does from one stand, on one path an account meeting the gate's
 * requirements can take (gateLander): lands the player on a tile (`player` when the tile follows the
 * stand; `move` the last move the scan counts outside every call it counts as one move, Path.outer; `roll` the
 * roll it succeeded at, or `unrolled` why a roll it is behind can't be taken: two on the path, or bounds not
 * known offline; `free` when the path needs nothing, a side the script lets through, with `waits` the waits it
 * passed on the way, as `` `text` (file:line) ``), opens the loc, or can't be
 * told offline (`why`, with the construct and its script line). A path that failed a roll is a
 * `fail`: where it leaves the player (`tile`, absent when no command moved them), and the ticks and damage it
 * takes (Path.ticks, Path.damage), or why those are not known.
 */
export type LandingOutcome =
    | {
          k: 'landing';
          tile: Tile;
          player: boolean;
          at: string;
          move: string;
          roll?: SeenRoll;
          unrolled?: string;
          free?: true;
          waits?: string[];
      }
    | { k: 'opens'; at: string }
    | { k: 'underived'; why: string }
    | { k: 'fail'; roll: SeenRoll; tile?: Tile; ticks: number; damage: number }
    | { k: 'fail'; roll: SeenRoll; why: string };

/** A trigger's name as its header writes it. */
export const triggerKey = (t: Trigger): string => `${t.kind}${t.on}${t.op},${t.category ? '_' : ''}${t.target}`;

/** Whether a statement is `return(<b>);` for a bare name b (`true`, `false`). */
const returns = (x: Stmt | undefined, b: string): boolean =>
    x?.t === 'return' && x.value?.t === 'name' && x.value.name === b && x.value.args === null;

/** The callables a body's code calls, by `@label` / `~proc`, and the queue scripts it queues, by `queue,name`. */
const calls = (code: string): string[] => [
    ...[...code.matchAll(CALL)].map(m => (m[1] ? `@${m[1]}` : m[0])),
    ...[...code.matchAll(QUEUES)].map(m => `queue,${m[2]}`),
];

// ---- Conditions ---------------------------------------------------------------------------------------

/** What one condition a path took means, when it is one the scan reads. */
type Cond =
    /** A requirement's canonical string. */
    | { k: 'req'; req: string; text: string }
    /** A quest varp compared with n; `shown` as the path took it, `` `%grandtree ! ^grandtree_released_prison` (file:line) ``. */
    | { k: 'quest'; ref: QuestRef; op: string; n: number; name?: string; text: string; shown: string }
    /** Holds at least n coins: met by a toll that takes as many, else other:<text>. */
    | { k: 'coins'; n: number; text: string }
    /** Read, and says only that the player lacks something: a path for that player, no requirement. */
    | { k: 'free'; text: string }
    /**
     * A bound run's condition taken the way a requirement other than `members` meets, the requirement in
     * `passing`: the path needs something.
     */
    | { k: 'met'; text: string }
    /** About a subject the scan reads, with a value it can't: other:<text>. */
    | { k: 'other'; text: string }
    /** The side of the loc the player stands on (Side), or the condition when it names none. */
    | { k: 'side'; side: string }
    /** A condition the scan can't read, taken `want` way: it needs nothing, but can make the trigger a candidate. */
    | { k: 'unread'; text: string; want: boolean }
    /**
     * A bound run's condition it can't read, taken either way (meaning): it settles nothing, so it goes onto the path
     * (Path.passed) rather than its conditions, `wait` when taken so it is a wait (waits).
     */
    | { k: 'passed'; text: string; wait: boolean }
    /**
     * A bound run's `stat_random` roll, taken the way it succeeds (`ok`) or fails; `low` and `high` undefined
     * when they are not known offline.
     */
    | { k: 'roll'; text: string; ok: boolean; stat: string; low?: number; high?: number; at: string };

/** Whether a whole number satisfies `v op n`. */
const holds = (v: number, op: string, n: number): boolean =>
    (({ '=': v === n, '!': v !== n, '<': v < n, '<=': v <= n, '>': v > n, '>=': v >= n }) as Record<string, boolean>)[
        op
    ] ?? false;

/** What a path's conditions and payments need at one point (a move, or the end of a blocked path). */
interface Settled {
    requires: string[];
    sides: string[];
    /** The quest conditions that hold neither before the quest nor once it is done. */
    window?: string;
    /**
     * Quests whose conditions here hold before the quest but not once it is done (`%upass <
     * ^upass_complete`), with the conditions as shown: propose decides whether that shuts the path.
     */
    before: { quest: string; varp: string; settled: boolean; shown: string }[];
    /** The quest conditions contradict: no account takes this path. */
    dead?: true;
    stages: Record<string, string>;
}

/**
 * What the conditions a path took need. Each quest varp's comparisons are tested on the values that
 * decide them (0, complete, and each compared value and its neighbours): holding at 0 and at complete
 * needs nothing; at complete, the least value that holds (`quest:<id>` when that is complete); at a value
 * past complete only, that value; at none of these, a window. A varp with no value that holds is a path no
 * account takes.
 *
 * Holding at 0 but not once the quest is done (`%upass < ^upass_complete`, Iban's temple turning the
 * player away once Underground Pass is done, quests/quest_upass/scripts/quest_upass.rs2:592) needs
 * nothing, and is listed in `before` for propose (beforeOnly) to judge: on a settled account the path may
 * be shut.
 */
function settle(conds: readonly Cond[], fare: number, taken: ReadonlyMap<string, number>): Settled {
    const reqs = new Set<string>();
    const sides = new Set<string>();
    const stages: Record<string, string> = {};
    const byVarp = new Map<string, Extract<Cond, { k: 'quest' }>[]>();
    for (const c of conds)
        if (c.k === 'req') reqs.add(c.req);
        else if (c.k === 'other') reqs.add(`other:${c.text}`);
        else if (c.k === 'coins' && c.n > fare) reqs.add(`other:${c.text}`);
        else if (c.k === 'side') sides.add(c.side);
        else if (c.k === 'quest') byVarp.set(c.ref.varp, [...(byVarp.get(c.ref.varp) ?? []), c]);
    const windows: string[] = [];
    const before: Settled['before'] = [];
    for (const comps of byVarp.values()) {
        const { ref } = comps[0]!;
        const points = [
            ...new Set([0, ref.complete, ...comps.flatMap(c => [c.n - 1, c.n, c.n + 1])].filter(v => v >= 0)),
        ].sort((a, b) => a - b);
        const sat = (v: number) => comps.every(c => holds(v, c.op, c.n));
        const least = points.find(sat);
        if (least === undefined) return { requires: [], sides: [], dead: true, stages: {}, before: [] };
        // Open before the quest and once it is done: no requirement.
        if (sat(0) && sat(ref.complete)) continue;
        // Open before the quest only (see above).
        if (sat(0)) {
            before.push({
                quest: ref.quest.id,
                varp: ref.varp,
                settled: ref.own && !ref.quest.or?.length,
                shown: comps.map(c => c.shown).join(' & '),
            });
            continue;
        }
        // Open from complete on, or (when complete is not) from a stage past it that a comparison names:
        // Priest in Peril's holy barrier opens at ^priestperil_access_holy_barrier, 61, after complete at 60
        // (areas/area_mausoleum/scripts/holy_barrier.rs2:2).
        const isNamed = (v: number) =>
            comps.some(c => (c.op === '>' ? c.n + 1 : c.n) === v && (c.op === '=' || c.op === '>=' || c.op === '>'));
        const from = sat(ref.complete) ? least : points.find(v => v > ref.complete && sat(v) && isNamed(v));
        if (from === undefined) {
            windows.push(comps.map(c => c.shown).join(' & '));
            continue;
        }
        // `quest:<id>` is done on any of its varps (Quest.or): done on one in particular (Shield of Arrav with
        // one gang, quests/quest_hero/scripts/locs/brimhaven_restaurant.rs2:2) has no form of its own.
        if (from === ref.complete && !ref.quest.or?.length) reqs.add(`quest:${ref.quest.id}`);
        else if (!ref.own || from === ref.complete) reqs.add(`other:${comps.map(c => c.shown).join(' & ')}`);
        else {
            const req = `quest:${ref.quest.id}>=${from}`;
            reqs.add(req);
            // The comparison that sets the stage: `>= n` or `= n` at it, or `> n` / `! n` (from 0) one past n.
            const past = (c: (typeof comps)[number]) => c.op === '>' || (c.op === '!' && c.n === 0);
            const at = comps.find(
                c => ((c.op === '>=' || c.op === '=') && c.n === from) || (past(c) && c.n + 1 === from),
            );
            // Named by its constant, `+1` when one past it (the constant holds the stage before); by the
            // number the script writes when it names no constant (`%itwatchtower < 4`).
            if (at) stages[req] = `${at.name ?? at.n}${past(at) ? '+1' : ''}`;
        }
    }
    if (fare > 0) reqs.add(`coins:${fare}`);
    for (const [obj, n] of taken)
        if (n > 0) {
            reqs.add(`consume:${obj}:${n}`);
            // Taking it means holding it.
            reqs.delete(`item:${obj}:held`);
        }
    return {
        requires: requirementSet([...reqs]),
        sides: [...sides].sort(cmp),
        ...(windows.length ? { window: windows.join(' | ') } : {}),
        stages,
        before,
    };
}

/**
 * The windows a move's paths get for conditions that hold only before a quest is done (Settled.before).
 * Such a path is still open on a settled account when another path to the same tile needs that quest:
 * the script splits on it and takes the done account the other way (the Al Kharid toll: 10 coins until
 * Prince Ali is saved, free after, areas/area_alkharid/scripts/border_gate.rs2:28), or tests the same
 * varp. Otherwise the path is shut once the quest is done: a window. On a quest with `or` varps it is not
 * settled, since the quest can be done with this varp at 0 (Shield of Arrav with the other gang): the
 * condition stays in the set as other:<text>. On a blocked path it is only the gate's other side, a
 * player who has not got there yet, so it needs nothing either way.
 */
function beforeOnly<T extends Settled & { to: string }>(settled: readonly T[]): T[] {
    const needs = (s: T, b: Settled['before'][number]) =>
        s.requires.some(
            r => r === `quest:${b.quest}` || r.startsWith(`quest:${b.quest}>=`) || r.includes(`\`${b.varp} `),
        );
    return settled.map(s => {
        const shut = s.before.filter(
            b =>
                !settled.some(
                    o => o !== s && o.to === s.to && o.window === undefined && !o.before.length && needs(o, b),
                ),
        );
        if (!shut.length) return s;
        const windows = shut.filter(b => b.settled).map(b => b.shown);
        const others = shut.filter(b => !b.settled).map(b => `other:${b.shown}`);
        return {
            ...s,
            requires: others.length ? requirementSet([...s.requires, ...others]) : s.requires,
            ...(windows.length ? { window: [...(s.window ? [s.window] : []), ...windows].join(' | ') } : {}),
        };
    });
}

/** Each quest's complete value, by id: what `quest:<id>` means as a stage. */
type Completes = ReadonlyMap<string, number>;

/**
 * Whether requirement `b` holds whenever `a` does: the same one, or a quest stage at or past another of the
 * same quest (`quest:elena>=30`, past complete, meets `quest:elena`).
 */
function implies(completes: Completes, a: string, b: string): boolean {
    if (a === b) return true;
    const [qa, qb] = [a, b].map(r => r.match(/^quest:([a-z0-9_]+)(?:>=(\d+))?$/));
    const complete = qa && qb && qa[1] === qb[1] ? completes.get(qa[1]!) : undefined;
    if (complete === undefined) return false;
    const stage = (m: RegExpMatchArray) => (m[2] === undefined ? complete : Number(m[2]));
    return stage(qa!) >= stage(qb!);
}

/**
 * The options no other asks less than: no requirement it doesn't imply (implies) and no more sides. Sorted,
 * so deterministic.
 */
function minimalOptions(options: readonly GateOption[], completes: Completes): GateOption[] {
    const key = (o: GateOption) => `${o.requires.join('\n')}\t${o.sides.join('\n')}`;
    const unique = new Map(options.map(o => [key(o), o]));
    // Two options alike but for `other:X` and `other:not X` (a condition the scan can't read, taken both
    // ways) hold whichever way it goes: add the option without it, on both options' sides, until no pair
    // is left.
    for (let changed = true; changed;) {
        changed = false;
        const all = [...unique.values()];
        for (const a of all)
            for (const x of a.requires.filter(r => r.startsWith('other:') && !r.startsWith('other:not '))) {
                const rest = a.requires.filter(r => r !== x);
                const not = requirementSet([...rest, `other:not ${x.slice('other:'.length)}`]).join('\n');
                // Either way holds where both options' sides do.
                for (const b of all.filter(o => o.requires.join('\n') === not)) {
                    const merged = { requires: rest, sides: [...new Set([...a.sides, ...b.sides])].sort(cmp) };
                    if (!unique.has(key(merged))) {
                        unique.set(key(merged), merged);
                        changed = true;
                    }
                }
            }
    }
    const all = [...unique.values()];
    const below = (a: GateOption, b: GateOption) =>
        a !== b &&
        a.requires.every(x => b.requires.some(y => implies(completes, y, x))) &&
        subsetOf(a.sides, b.sides) &&
        // Two that imply each other (the same sets) keep the first.
        !(
            b.requires.every(y => a.requires.some(x => implies(completes, x, y))) &&
            subsetOf(b.sides, a.sides) &&
            all.indexOf(a) > all.indexOf(b)
        );
    return all
        .filter(o => !all.some(p => below(p, o)))
        .sort(
            (a, b) =>
                a.requires.length - b.requires.length ||
                cmp(a.requires.join('\n'), b.requires.join('\n')) ||
                cmp(a.sides.join('\n'), b.sides.join('\n')),
        );
}

// ---- The walker -------------------------------------------------------------------------------------

interface Path {
    env: ReadonlyMap<string, Value>;
    conds: readonly Cond[];
    /** Coins taken. */
    fare: number;
    /** Objs taken, net of any given: obj -> count. */
    taken: ReadonlyMap<string, number>;
    moved: boolean;
    /** The queue scripts the path queued, by `queue,name`, with the arguments each gets, to run once the trigger ends. */
    queued?: readonly { call: string; args: readonly Value[] }[];
    /**
     * A bound run's: the last move the scan counts on the path, as `` `text` (file:line) ``, and where the
     * scan says each it counted goes (GateMove.to).
     */
    move?: { at: string; tos: readonly string[] };
    /** A bound run's: how many calls the scan counts as one move the path is inside. */
    within?: number;
    /**
     * A bound run's: the conditions it can't read that the path passed (Cond `passed`), by text, each true when every
     * path merged into this one took it as a wait. Kept out of the path's key: paths that differ by these alone run
     * on as one, with both paths' conditions.
     */
    passed?: ReadonlyMap<string, boolean>;
    /** A bound run's: the last move the scan counts outside every such call, as `move.at` writes it. */
    outer?: string;
    /** A bound run's: where the last position-setting command left the player, or why that isn't known offline. */
    landing?: { tile: Tile; player: boolean; at: string } | { why: string };
    /** A bound run's: the command that deleted the loc or swapped it for one that doesn't block, as `file:line`. */
    opened?: string;
    /**
     * A bound run's: the ticks the path's delays take (`p_delay(n)` n + 1, `p_arrivedelay` one, as for a player
     * who has just walked to the loc), the hitpoints its `damage` and `~damage_self` calls take (the most, when
     * the amount rolls or reads a stat, as `most` takes it), and why either is not known offline.
     */
    ticks?: number;
    damage?: number;
    unsure?: string;
}

type Flow = SharedFlow<Path>;

/** The rolls a bound run's path took (Cond `roll`). */
const rollsOf = (p: Path) => p.conds.filter(c => c.k === 'roll');

/** Whether a bound run's path failed a roll. */
const failed = (p: Path): boolean => rollsOf(p).some(c => !c.ok);

/** A bound run's path's one roll, or why it has none a row can take (two, or bounds not known offline). */
function rollOf(p: Path): SeenRoll | { why: string } | undefined {
    const [r, ...more] = rollsOf(p);
    if (!r) return undefined;
    if (more.length) return { why: `${r.text}: one of ${more.length + 1} stat_random rolls on one path` };
    if (r.low === undefined || r.high === undefined) return { why: `${r.text}: its bounds are not known offline` };
    return { stat: r.stat, low: r.low, high: r.high, source: r.at };
}

/** The labels and procs a statement runs inside, outermost first. */
type Stack = readonly string[];

/** A move one path made, with what the path had taken by then. */
interface Moved {
    to: string;
    conds: readonly Cond[];
    fare: number;
    taken: ReadonlyMap<string, number>;
}

/** One trigger's run: its moves, the paths that ended without one, and what stopped the walker. */
interface Run {
    moves: Moved[];
    blocked: Path[];
    /** Every path at the end of the run, moved or not. */
    ends: Path[];
    /** A bound run's: each condition read, by its text, with the requirement its passing way holds. */
    passing?: ReadonlyMap<string, readonly string[]>;
    why: string[];
}

/** A condition as a key: two that read the same mean the same. */
const condKey = (c: Cond): string => {
    switch (c.k) {
        case 'side':
            return `side ${c.side}`;
        case 'req':
            return `req ${c.req}`;
        case 'quest':
            return `quest ${c.ref.varp} ${c.op} ${c.n}`;
        case 'coins':
            return `coins ${c.n}`;
        case 'unread':
            return `unread ${c.want} ${c.text}`;
        case 'roll':
            return `roll ${c.ok} ${c.text}`;
        case 'passed':
            return `passed ${c.wait} ${c.text}`;
        default:
            return `${c.k} ${c.text}`;
    }
};

/**
 * The ways, each once (as sets of conditions): a condition the scan doesn't read adds nothing, so a long
 * `&`/`|` of them is one way, not a product of them; ways that differ only by a bound run's `passed` marks are one,
 * with the marks of both. Throws past MAX_PATHS.
 */
function distinct(ways: readonly Cond[][]): Cond[][] {
    const out = new Map<string, Cond[]>();
    for (const w of ways) {
        const unique = [...new Map(w.map(c => [condKey(c), c])).values()];
        const key = unique
            .filter(c => c.k !== 'passed')
            .map(condKey)
            .sort(cmp)
            .join('\n');
        const had = out.get(key);
        out.set(key, had ? [...new Map([...had, ...unique].map(c => [condKey(c), c])).values()] : unique);
    }
    if (out.size > MAX_PATHS) throw new TooManyPaths();
    return [...out.values()];
}

/** Path.passed with more conditions passed: a text stays a wait only while each time it is passed is one. */
function joinPassed(
    passed: ReadonlyMap<string, boolean> | undefined,
    more: Iterable<readonly [string, boolean]>,
): ReadonlyMap<string, boolean> {
    const out = new Map(passed);
    for (const [text, wait] of more) out.set(text, (out.get(text) ?? true) && wait);
    return out;
}

/** A value as a key. */
const valueKey = (v: Value): string =>
    v.t === 'int'
        ? `i${v.n}`
        : v.t === 'bool'
          ? `b${v.b}`
          : v.t === 'name'
            ? `n${v.v}`
            : v.t === 'range'
              ? `r${v.lo},${v.hi}`
              : v.t === 'coord'
                ? `c${v.relative}${v.from ?? ''}${v.level},${v.x},${v.z}`
                : `u${v.choice ?? ''}${v.side ?? ''}${v.text}`;

/** Each path part's key, once: a path's locals, conditions and objs taken are never changed, only replaced. */
const partKeys = new WeakMap<object, string>();
const keyOf = <T extends object>(part: T, key: (part: T) => string): string => {
    let k = partKeys.get(part);
    if (k === undefined) partKeys.set(part, (k = key(part)));
    return k;
};

/**
 * The paths, each state once: two that took the same conditions, paid the same, moved alike and hold the
 * same locals go on the same way, so dialogue the scan doesn't read doesn't multiply them; the one kept has
 * the conditions both passed (Path.passed).
 */
function distinctPaths(paths: readonly Path[]): Path[] {
    const out = new Map<string, Path>();
    for (const p of paths) {
        const key = [
            p.moved,
            p.landing ? JSON.stringify(p.landing) : '',
            p.opened ?? '',
            `${p.ticks ?? ''} ${p.damage ?? ''} ${p.unsure ?? ''}`,
            p.fare,
            (p.queued ?? []).map(q => `${q.call}(${q.args.map(valueKey).join(',')})`).join(' '),
            keyOf(p.taken, t => [...t].map(([o, n]) => `${o}=${n}`).join(',')),
            keyOf(p.conds, cs => cs.map(condKey).join('\n')),
            keyOf(p.env, env => [...env].map(([k, v]) => `${k}=${valueKey(v)}`).join('\n')),
        ].join('\t');
        const had = out.get(key);
        if (!had) out.set(key, p);
        else if (p.passed) out.set(key, { ...had, passed: joinPassed(had.passed, p.passed) });
    }
    return [...out.values()];
}

/** The paths that take each way: its `passed` marks go to Path.passed, the rest onto the conditions. */
const branch = (p: Path, ways: readonly Cond[][]): Path[] =>
    ways.map(cs => {
        const passed = cs.flatMap(c => (c.k === 'passed' ? [[c.text, c.wait] as const] : []));
        const conds = passed.length ? cs.filter(c => c.k !== 'passed') : cs;
        return {
            ...p,
            conds: [...p.conds, ...conds],
            ...(passed.length ? { passed: joinPassed(p.passed, passed) } : {}),
        };
    });

const sideUnknown = (text: string): Value => ({ t: 'unknown', text, side: true });
const isSide = (v: Value): boolean => v.t === 'unknown' && v.side === true;
const locUnknown = (text: string): Value => ({ t: 'unknown', text, loc: true });
const isLoc = (v: Value): boolean => v.t === 'unknown' && v.loc === true;
/** A value fixed offline, or one that depends only on which loc this is. */
const locOrKnown = (v: Value): boolean => isLoc(v) || v.t !== 'unknown';

/** The active loc's own facts (handlers/LocOps.ts): a condition on them alone says nothing of the player. */
const LOC_FACTS = new Set(['loc_coord', 'loc_angle', 'loc_type', 'loc_shape', 'loc_category']);

/** Commands whose value is a side of the loc when an argument is the player's tile. */
const SIDE_COMMANDS = new Set([
    'coordx',
    'coordy',
    'coordz',
    'movecoord',
    'inzone',
    '~check_axis',
    '~check_axis_locactive',
]);

/**
 * The Side a comparison of the player's tile names, taken `want` way; undefined when it names none.
 * `side` is the operand on the player's tile, `other` the one it is compared with.
 */
function sideOf(side: Value & { t: 'unknown' }, op: string, other: Value, otherText: string): Side | undefined {
    if (side.text.startsWith('~check_axis')) {
        const truth = truthOf(other);
        if (truth === undefined || (op !== '=' && op !== '!')) return undefined;
        return truth === (op === '=') ? 'loc' : 'far';
    }
    const axis = side.text.match(/^coord([xz])\(coord\)$/)?.[1];
    if (!axis) return undefined;
    if (op === '<' || op === '<=') return axis === 'x' ? 'west' : 'south';
    if (op === '>' || op === '>=') return axis === 'x' ? 'east' : 'north';
    // On the loc's own row or column: its tile.
    if (/\bloc_coord\b/.test(otherText)) return op === '=' ? 'loc' : 'far';
    return undefined;
}

/** The key a bound run keeps the player's tile under in a path's locals; no local is named so. */
const POS = 'coord';

/** The highest level a stat reaches: what `most` takes a `stat` read for. */
const MAX_STAT = 99;

/** The engine's two-int arithmetic commands (handlers/NumberOps.ts) as the operators they compute, for `most`. */
const OPERATORS: Readonly<Record<string, string>> = { add: '+', sub: '-', multiply: '*', divide: '/' };

/** The key prefix a bound run keeps a proc argument's most under (`most`), beside the local; no local is named so. */
const MOST = '#most ';

/** Bounds a bound run's calls, a proc calling itself among them: ~agility_walk steps one tile a call. */
const BOUND_DEPTH = 64;

/** The engine's two-int arithmetic commands (handlers/NumberOps.ts). */
const ARITHMETIC: Readonly<Record<string, (a: number, b: number) => number>> = {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => Math.trunc(a / b),
};

/**
 * Whether a loc of `cfg` placed with `shape` blocks walking, as the engine adds its collision
 * (server/engine/src/engine/GameMap.ts changeLocCollision, by routefinder/flags.ts locShapeLayer): a wall
 * (0-3) or a ground loc (9-21) when it has `blockwalk`, ground decor (22) when it is active too, wall decor
 * (4-8) never. Undefined for a config not known, or ground decor whose being active the config leaves to
 * its models (cache/config/LocType.ts postDecode: one with an op is active).
 */
export function blocksWalk(cfg: Config | undefined, shape: number): boolean | undefined {
    if (!cfg) return undefined;
    if (first(cfg, 'blockwalk') === 'no' || (shape >= 4 && shape <= 8)) return false;
    if (shape !== 22) return true;
    const active = first(cfg, 'active');
    if (active !== undefined) return active === 'yes';
    return [1, 2, 3, 4, 5].some(n => first(cfg, `op${n}`) !== undefined) ? true : undefined;
}

/** A whole number's value; undefined for any other. */
const intOf = (v: Value | undefined): number | undefined => (v?.t === 'int' ? v.n : undefined);

/** A coord the script fixes or computes offline, not a shift of an unknown tile. */
const isFixed = (v: Value | undefined): v is CoordValue => v?.t === 'coord' && !v.relative;

/** Where a move lands as GateMove.to writes it: the coord literal of a fixed tile, else CROSS. */
const moveTarget = (v: Value | undefined): string =>
    v?.t === 'coord' && !v.relative && !v.from ? tileCoord(v) : CROSS;

/** Runs loc op triggers, over the callables. */
function gateWalker(input: GateScanInput, world?: LanderWorld) {
    const callables = [...input.callables, ...(input.queues ?? [])];
    const byCall = new Map(callables.map(c => [c.call, c]));
    const scriptOf = scriptCache();
    const read = conditionReader(input.quests, input.loadoutProcs, input.tools);
    const loadoutCalls = new Set(Object.values(input.loadoutProcs).map(p => p.call));

    // The call graph: each callable's code and the callables it calls or queues, and who calls each.
    const graph = new Map(
        callables.map(c => {
            const code = codeOf(c.body);
            return [c.call, { code, callees: calls(code) }];
        }),
    );
    const callers = new Map<string, string[]>();
    for (const [call, { callees }] of graph) for (const callee of callees) push(callers, callee, call);
    /**
     * The callables `seed` marks, and every one that calls a marked one, back along the call graph; none
     * that `except` names, nor through one.
     */
    const marking = (
        seed: (call: string, code: string) => boolean,
        except: (call: string) => boolean = () => false,
    ): Set<string> => {
        const marked = new Set(
            [...graph].filter(([call, { code }]) => !except(call) && seed(call, code)).map(([c]) => c),
        );
        const queue = [...marked];
        while (queue.length)
            for (const caller of callers.get(queue.pop()!) ?? [])
                if (!marked.has(caller) && !except(caller)) {
                    marked.add(caller);
                    queue.push(caller);
                }
        return marked;
    };
    const incidental = (call: string): boolean => INCIDENTAL.some(dir => byCall.get(call)?.file.startsWith(dir));
    // Procs under DOOR_PROCS that move the player or change a loc, themselves or through a callee.
    const changing = marking((_, code) => MOVES.test(code) || CHANGES_LOC.test(code));
    const doorProcs = new Set(
        input.callables
            .filter(c => c.call.startsWith('~') && c.file.startsWith(DOOR_PROCS) && changing.has(c.call))
            .map(c => c.call),
    );
    const doorProc = (call: string): boolean => doorProcs.has(call);
    // Callables that can move the player: a move in their body, a door proc, or a callee that can.
    const moving = marking((call, code) => doorProcs.has(call) || MOVES.test(code), incidental);
    const moves = (call: string): boolean => moving.has(call);
    // Callables with a condition the scan reads, themselves or through a callee. A moving proc with none
    // is a move as a whole: what it does inside (an agility walk, a door's swing) can't gate it.
    const reads = readsSubjects(input.loadoutProcs, input.tools);
    const readsConditions = marking((_, code) => reads.test(code) || PAYS.test(code));
    // Callables that change a loc, themselves or through a callee: a bound run follows them for `opened`.
    const changingLoc = marking((_, code) => CHANGES_LOC.test(code), incidental);
    // The loc categories: in a bound run, `loc_category = jungle_bush` compares two names.
    const categories = new Set([...(world?.locConfigs.values() ?? [])].flatMap(c => c.category ?? []));
    /**
     * The bound run's loc (Binding), while one runs: its facts as LocOps.ts gives them, its params by
     * name, and its shape. A run is synchronous, so one at a time.
     */
    let bound:
        | {
              facts: Map<string, Value>;
              params: Map<string, Value>;
              shape: number;
              /** Each condition read, by its text: the requirement the way it lets the player through holds. */
              passing: Map<string, string[]>;
          }
        | undefined;
    /** Whether a trigger's body can move the player. */
    const bodyMoves = (body: string): boolean => {
        const code = codeOf(body);
        return MOVES.test(code) || calls(code).some(moves);
    };

    const constant = (name: string): Value | undefined => {
        const c = input.constants.get(name);
        if (!c) return undefined;
        if (/^-?\d+$/.test(c.value)) return { t: 'int', n: Number(c.value), name };
        if (isCoordLiteral(c.value)) return { t: 'coord', relative: false, ...coordTile(c.value), at: c.at };
        return undefined;
    };
    const known = (name: string): boolean =>
        name === 'inv' || name === 'worn' || input.names.has(name) || byCall.has(`@${name}`);

    const evaluate = (e: Expr, env: ReadonlyMap<string, Value>, file: string): Value => {
        switch (e.t) {
            case 'num':
                return { t: 'int', n: e.n };
            case 'coord':
                return { t: 'coord', relative: false, ...e.tile, at: `${file}:${e.line}` };
            case 'str':
                return unknown(e.text);
            case 'bin': {
                const [l, r] = [evaluate(e.l, env, file), evaluate(e.r, env, file)];
                const side = isSide(l) || isSide(r);
                // About the loc alone: a loc fact against a loc fact or a value fixed offline.
                const loc = !side && locOrKnown(l) && locOrKnown(r) && (isLoc(l) || isLoc(r));
                const folded = fold(e.op, l, r, e.text);
                if (folded && folded.t === 'unknown' && (side || loc))
                    return side ? sideUnknown(e.text) : locUnknown(e.text);
                if (folded) return folded;
                if (l.t === 'int' && r.t === 'int') {
                    const n = { '+': l.n + r.n, '-': l.n - r.n, '*': l.n * r.n, '/': Math.trunc(l.n / r.n) }[e.op];
                    if (n !== undefined) return { t: 'int', n };
                    const b = { '<': l.n < r.n, '>': l.n > r.n, '<=': l.n <= r.n, '>=': l.n >= r.n }[e.op];
                    if (b !== undefined) return { t: 'bool', b };
                }
                const choice = (l.t === 'unknown' && l.choice) || (r.t === 'unknown' && r.choice);
                return side ? sideUnknown(e.text) : loc ? locUnknown(e.text) : unknown(e.text, choice);
            }
            case 'name':
                break;
        }
        if (e.name.startsWith('$')) return env.get(e.name) ?? unknown(e.name);
        if (e.name.startsWith('^')) return constant(e.name) ?? unknown(e.name);
        // COORD is the player's tile (server/engine/src/engine/script/handlers/PlayerOps.ts), written `coord` or
        // `coord()`; the loc's facts the same. A bound run knows them.
        if (!e.args?.length && e.name === 'coord') return env.get(POS) ?? sideUnknown('coord');
        if (!e.args?.length && LOC_FACTS.has(e.name)) return bound?.facts.get(e.name) ?? locUnknown(e.text);
        if (e.args === null) {
            if (e.name === 'true' || e.name === 'false') return { t: 'bool', b: e.name === 'true' };
            return known(e.name) || (bound && categories.has(e.name)) ? { t: 'name', v: e.name } : unknown(e.text);
        }
        // LOC_PARAM reads the active loc's config param (LocOps.ts).
        const param = e.args[0];
        if (bound && e.name === 'loc_param' && param?.t === 'name' && param.args === null)
            return bound.params.get(param.name) ?? unknown(e.text);
        const args = e.args.map(a => evaluate(a, env, file));
        if (SIDE_COMMANDS.has(e.name) && args.some(isSide)) return sideUnknown(e.text);
        if (SIDE_COMMANDS.has(e.name) && args.every(locOrKnown) && args.some(isLoc)) return locUnknown(e.text);
        const [a0, a1, a2, a3] = args;
        // `calc(x)` is x; ADD, SUB, MULTIPLY and DIVIDE as their names say.
        if (e.name === 'calc' && args.length === 1 && a0!.t !== 'unknown') return a0!;
        // INZONE: the third coord within the box the first two span, level included (ServerOps.ts).
        if (e.name === 'inzone' && isFixed(a0) && isFixed(a1) && isFixed(a2))
            return {
                t: 'bool',
                b: [a2.x, a2.level, a2.z].every(
                    (n, i) => n >= [a0.x, a0.level, a0.z][i]! && n <= [a1.x, a1.level, a1.z][i]!,
                ),
            };
        // MAP_BLOCKED, in a bound run, from the collision data.
        if (bound && world && e.name === 'map_blocked' && a0?.t === 'coord' && !a0.relative)
            return { t: 'bool', b: world.mapBlocked(a0) };
        // `~check_axis(coord, loc_coord, angle)`, in a bound run: at angle north or south (odd) the two coords
        // share their z, at west or east their x (doors/scripts/door_procs.rs2:77); `_locactive` on the bound
        // loc's (:90).
        if (bound && (e.name === '~check_axis' || e.name === '~check_axis_locactive')) {
            const [c, l, angle] =
                e.name === '~check_axis'
                    ? [a0, a1, a2]
                    : [a0, bound.facts.get('loc_coord'), bound.facts.get('loc_angle')];
            if (isFixed(c) && isFixed(l) && angle?.t === 'int')
                return { t: 'bool', b: angle.n % 2 === 1 ? c.z === l.z : c.x === l.x };
        }
        const arithmetic = ARITHMETIC[e.name];
        if (arithmetic && a0?.t === 'int' && a1?.t === 'int') return { t: 'int', n: arithmetic(a0.n, a1.n) };
        // COORDX, COORDY (the level) and COORDZ split a coord; MOVECOORD adds (x, level, z) to one
        // (handlers/ServerOps.ts).
        if (/^coord[xyz]$/.test(e.name) && a0?.t === 'coord')
            return { t: 'int', n: e.name === 'coordx' ? a0.x : e.name === 'coordz' ? a0.z : a0.level };
        if (e.name === 'movecoord' && a0?.t === 'coord' && a1?.t === 'int' && a2?.t === 'int' && a3?.t === 'int')
            return { ...a0, level: a0.level + a2.n, x: a0.x + a1.n, z: a0.z + a3.n };
        // `$min + randominc($max - $min)`: min to max inclusive (general/scripts/misc/random_range.rs2:2).
        if (e.name === '~random_range' && a0?.t === 'int' && a1?.t === 'int') return { t: 'range', lo: a0.n, hi: a1.n };
        if (e.name.startsWith('~p_choice')) return unknown(e.text, true);
        return unknown(e.text);
    };

    /**
     * The most an amount (a failed roll's damage) can be: what it evaluates to, or with each `stat` at MAX_STAT
     * and each random draw at its top (`random(n)` n - 1, `randominc(n)` n), through `calc` and the four
     * operations, written or as ADD, SUB, MULTIPLY and DIVIDE (a difference or quotient only of a number known
     * offline); a local not known offline is the most of the argument passed for it (MOST). Undefined for anything
     * else.
     */
    const most = (e: Expr, env: ReadonlyMap<string, Value>, file: string): number | undefined => {
        const v = evaluate(e, env, file);
        if (v.t === 'int') return v.n;
        if (v.t === 'range') return v.hi;
        const [l, r] = e.t === 'bin' ? [e.l, e.r] : e.t === 'name' ? (e.args ?? []) : [];
        const op = e.t === 'bin' ? e.op : e.t === 'name' ? OPERATORS[e.name] : undefined;
        if (op && l && r) {
            const exact = op === '-' || op === '/';
            const [a, b] = [most(l, env, file), exact ? intOf(evaluate(r, env, file)) : most(r, env, file)];
            if (a === undefined || b === undefined) return undefined;
            if (op === '/') return b ? Math.trunc(a / b) : undefined;
            return { '+': a + b, '-': a - b, '*': a * b }[op];
        }
        if (e.t !== 'name') return undefined;
        if (e.name.startsWith('$')) return intOf(env.get(`${MOST}${e.name}`));
        if (!l) return undefined;
        if (e.name === 'stat' || e.name === 'stat_base') return MAX_STAT;
        const n = most(l, env, file);
        if (e.name === 'calc' || e.name === 'randominc') return n;
        return e.name === 'random' && n !== undefined ? n - 1 : undefined;
    };

    /**
     * What a condition the walker can't settle means, taken `want` way (meaning): in a bound run, a requirement
     * goes into `passing` rather than onto the path, as that is all `consistent` reads of it, and leaves only a
     * `met` mark (none for `members`, met on a members world), so paths that met the same condition by different
     * requirements (an axe held or worn) run on as one.
     */
    const classify = (e: Expr, want: boolean, env: ReadonlyMap<string, Value>, file: string): Cond[][] => {
        const ways = meaning(e, want, env, file);
        if (!bound) return ways;
        for (const c of ways.flat()) {
            if (c.k !== 'req' && c.k !== 'coins') continue;
            const req = c.k === 'req' ? c.req : `coins:${c.n}`;
            if (!bound.passing.get(c.text)?.includes(req)) push(bound.passing, c.text, req);
        }
        return ways.map(w =>
            w.flatMap((c): Cond[] =>
                c.k === 'req' && c.req === 'members'
                    ? []
                    : c.k === 'req' || c.k === 'coins'
                      ? [{ k: 'met', text: c.text }]
                      : [c],
            ),
        );
    };

    /**
     * What a condition the walker can't settle means, taken `want` way: the ways it can hold, each a list of
     * what it means (one way unless it reads as a choice of objs, a tool any of whose categories does).
     */
    const meaning = (e: Expr, want: boolean, env: ReadonlyMap<string, Value>, file: string): Cond[][] => {
        const text = `\`${e.text}\` (${file}:${e.line})`;
        // The player's side: a comparison with an operand on the player's tile.
        const [l, op0, r] = e.t === 'bin' && NEGATE[e.op] ? [e.l, e.op, e.r] : [e, '=', undefined];
        const [lv, rv] = [evaluate(l, env, file), r ? evaluate(r, env, file) : ({ t: 'bool', b: true } as Value)];
        if (isSide(lv) || isSide(rv)) {
            const [s, o, oText, op1] = isSide(lv) ? [lv, rv, r?.text ?? 'true', op0] : [rv, lv, l.text, FLIP[op0]!];
            const named = s.t === 'unknown' ? sideOf(s, want ? op1 : NEGATE[op1]!, o, oText) : undefined;
            return [[{ k: 'side', side: named ?? `${e.text} = ${want}` }]];
        }
        const reading = read(e, want, { evaluate: x => evaluate(x, env, file), nameOf: x => nameOf(x, env) });
        switch (reading.k) {
            case 'members':
                return [[reading.holds ? { k: 'req', req: 'members', text } : { k: 'free', text }]];
            case 'loadout':
                return [[reading.clear ? { k: 'req', req: `loadout:${reading.rule}`, text } : { k: 'free', text }]];
            case 'quest':
                return [
                    [
                        {
                            k: 'quest',
                            ref: reading.ref,
                            op: reading.op,
                            n: reading.n,
                            name: reading.name,
                            text,
                            shown: `\`${reading.ref.varp} ${reading.op} ${reading.name ?? reading.n}\` (${file}:${e.line})`,
                        },
                    ],
                ];
            case 'inv':
                if (reading.least <= 0) return [[{ k: 'free', text }]];
                if (reading.obj === 'coins' && reading.where === 'inv')
                    return [[{ k: 'coins', n: reading.least, text }]];
                return [[{ k: 'req', req: `item:${reading.obj}:${reading.where === 'inv' ? 'held' : 'worn'}`, text }]];
            case 'category':
                if (!reading.has) return [[{ k: 'free', text }]];
                return reading.ways.map(w => [
                    { k: 'req', req: `category:${w.category}:${w.where === 'inv' ? 'held' : 'worn'}`, text },
                ]);
            case 'questpoints':
                return [
                    [
                        reading.least <= 0
                            ? { k: 'free', text }
                            : { k: 'req', req: `questpoints:${reading.least}`, text },
                    ],
                ];
            case 'stat':
                return [
                    [
                        reading.least <= 0
                            ? { k: 'free', text }
                            : { k: 'req', req: `skill:${reading.skill}:${reading.least}`, text },
                    ],
                ];
            case 'useitem':
                return [[reading.is ? { k: 'req', req: `item:${reading.obj}:held`, text } : { k: 'free', text }]];
            case 'other':
                // STAT_RANDOM is true when the roll succeeds (PlayerOps.ts): a bound run follows both ways, each
                // marked, as a failed roll (an agility slip, a fall) is not the move but says what a failure does.
                if (bound && l.t === 'name' && l.name === 'stat_random') {
                    const truth = r ? truthOf(rv) : true;
                    if (truth !== undefined && (op0 === '=' || op0 === '!')) {
                        const [stat, low, high] = l.args ?? [];
                        const [lo, hi] = [low, high].map(a => intOf(a && evaluate(a, env, file)));
                        return [
                            [
                                {
                                    k: 'roll',
                                    text,
                                    ok: want === (truth === (op0 === '=')),
                                    stat: stat?.text ?? '',
                                    ...(lo === undefined ? {} : { low: lo }),
                                    ...(hi === undefined ? {} : { high: hi }),
                                    at: `${file}:${e.line}`,
                                },
                            ],
                        ];
                    }
                }
                // A bound run goes both ways, marking the path (Path.passed): which paths it keeps (consistent)
                // reads only the conditions above, and paths that differ by these alone run on as one, but a path
                // past one needs nothing only when it is a wait (needsNothing).
                if (bound) return [[{ k: 'passed', text, wait: waits(l, op0, r, want) }]];
                // Taken false, it says so: two paths that differ only by it hold either way (minimalOptions).
                if (reading.subject) return [[{ k: 'other', text: want ? text : `not ${text}` }]];
                // A random draw (in the condition, or held in a local it tests: `$rand = random(20)`) goes
                // both ways and gates nothing; any other condition the scan can't read is noted, so a move
                // behind it still makes the trigger a candidate.
                return RANDOM.test(e.text) || [lv, rv].some(v => v.t === 'unknown' && RANDOM.test(v.text))
                    ? [[]]
                    : [[{ k: 'unread', text, want }]];
        }
    };

    /**
     * A condition proc, `[proc,x]()(boolean)` whose body is `if (<cond>) { return(true); } return(false);`
     * (`~wearing_slave_robes`, quests/quest_desertrescue/scripts/quest_desertrescue.rs2:465): the condition
     * and its file, so a test of the proc reads as its condition. Loadout procs are read as rules instead.
     */
    const conditionProcs = new Map<string, { cond: Expr; file: string } | null>();
    const conditionOf = (call: string): { cond: Expr; file: string } | null => {
        const cached = conditionProcs.get(call);
        if (cached !== undefined) return cached;
        const c = byCall.get(call);
        const script = c && !loadoutCalls.has(call) ? scriptOf(call, c.file, c.line, c.body) : undefined;
        const [check, last, ...rest] = script && !('error' in script) && !script.params.length ? script.body : [];
        const found =
            check?.t === 'if' &&
            !check.no.length &&
            check.yes.length === 1 &&
            returns(check.yes[0], 'true') &&
            returns(last, 'false') &&
            !rest.length
                ? { cond: check.cond, file: c!.file }
                : null;
        conditionProcs.set(call, found);
        return found;
    };

    /** The ways a condition can hold as `want`: each a list of what it means; [] when it can't. */
    const assume = (e: Expr, want: boolean, env: ReadonlyMap<string, Value>, file: string, depth = 0): Cond[][] => {
        const v = evaluate(e, env, file);
        if (v.t === 'bool') return v.b === want ? [[]] : [];
        // A dialogue choice, or a fact about the loc alone (which tile, angle or type it is), goes both ways.
        if (v.t === 'unknown' && (v.choice || v.loc)) return [[]];
        // `~proc = <bool>` or a bare `~proc` on a condition proc: its condition, taken the way it is wanted.
        const [subject, op, rhs] =
            e.t === 'bin' && (e.op === '=' || e.op === '!') ? [e.l, e.op, e.r] : [e, '=', undefined];
        const proc =
            subject.t === 'name' && subject.name.startsWith('~') && !subject.args?.length
                ? conditionOf(subject.name)
                : null;
        const truth = rhs ? truthOf(evaluate(rhs, env, file)) : true;
        if (proc && truth !== undefined && depth < MAX_DEPTH)
            return assume(proc.cond, want === (truth === (op === '=')), new Map(), proc.file, depth + 1);
        if (e.t === 'bin' && (e.op === '&' || e.op === '|')) {
            const [l, r] = [assume(e.l, want, env, file, depth), assume(e.r, want, env, file, depth)];
            const both = (a: Cond[][], b: Cond[][]) => a.flatMap(x => b.map(y => [...x, ...y]));
            // `a & b` holds when both do, and `a | b` fails when both do. Otherwise it holds as `a`, or as
            // `!a` and `b`: ways that don't overlap, so the second keeps what `a` failing says (its side).
            if ((e.op === '&') === want) return distinct(both(l, r));
            return distinct([...l, ...both(assume(e.l, !want, env, file, depth), r)]);
        }
        return classify(e, want, env, file);
    };

    const runTrigger = (trigger: Trigger, binding?: Binding): Run => {
        const run: Run = { moves: [], blocked: [], ends: [], why: [] };
        const stop = (why: string) => {
            if (!run.why.includes(why)) run.why.push(why);
        };

        const block = (stmts: readonly Stmt[], paths: Path[], file: string, stack: Stack): Flow => {
            const ended: Path[] = [];
            let live = paths;
            for (const s of stmts) {
                const next: Path[] = [];
                for (const p of live) {
                    const f = statement(s, p, file, stack);
                    // Checked before adding: one switch can merge many cases' paths.
                    if (next.length + ended.length + f.live.length + f.ended.length > MAX_PATHS)
                        throw new TooManyPaths();
                    next.push(...f.live);
                    ended.push(...f.ended);
                }
                live = distinctPaths(next);
            }
            return { live, ended };
        };

        const statement = (s: Stmt, p: Path, file: string, stack: Stack): Flow => {
            const at = `${file}:${s.line}`;
            const move = (to: string): Flow => {
                run.moves.push({ to, conds: p.conds, fare: p.fare, taken: p.taken });
                return { live: [{ ...p, moved: true }], ended: [] };
            };
            /** A bound run's path `q` made a move the scan counts, to `to`, here. */
            const made = (q: Path, to: string): NonNullable<Path['move']> => ({
                at: `\`${s.text}\` (${at})`,
                tos: [...(q.move?.tos ?? []), to],
            });
            /**
             * A bound run's position-setting command: the player is at `v` from here on, and it is the
             * path's landing until a later one; it follows the stand while every landing before it did. The
             * player's tile is never a fixed tile to the scan, so after a jump to one a move from it still
             * crosses (GateMove.to), as the scan reads it (the Shantay Pass's step south of its literal,
             * areas/area_alkharid/scripts/shantay_pass.rs2:109).
             */
            const reposition = (q: Path, v: Value | undefined): Path => {
                const follows = !q.landing || ('tile' in q.landing && q.landing.player);
                const landing =
                    v?.t === 'coord' && !v.relative
                        ? { tile: { level: v.level, x: v.x, z: v.z }, player: v.from === 'player' && follows, at }
                        : {
                              why: `\`${s.text}\` (${at}): ${v?.t === 'unknown' ? `\`${v.text}\`` : 'the tile'} is not known offline`,
                          };
                return {
                    ...q,
                    landing,
                    env: new Map(q.env).set(
                        POS,
                        v?.t === 'coord' && 'tile' in landing
                            ? { ...v, from: v.from ?? 'player' }
                            : unknown(`coord after ${at}`),
                    ),
                };
            };
            switch (s.t) {
                case 'set':
                    if (!s.name.startsWith('$')) return { live: [p], ended: [] };
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
                    return { live: [], ended: [p] };
                case 'if':
                    return merge(
                        block(s.yes, branch(p, assume(s.cond, true, p.env, file)), file, stack),
                        block(s.no, branch(p, assume(s.cond, false, p.env, file)), file, stack),
                    );
                case 'while':
                    // Run as an `if`: the body once or not at all, which is enough to see what it moves.
                    return merge(block(s.body, branch(p, assume(s.cond, true, p.env, file)), file, stack), {
                        live: branch(p, assume(s.cond, false, p.env, file)),
                        ended: [],
                    });
                case 'switch': {
                    const subject = evaluate(s.subject, p.env, file);
                    const keyed = s.cases.filter(c => c.keys !== null);
                    const fallback = s.cases.find(c => c.keys === null);
                    const hits = keyed.map(c => c.keys!.map(k => equal(evaluate(k, p.env, file), subject)));
                    if (hits.every(h => h.every(x => x !== undefined))) {
                        const hit = keyed.find((_, i) => hits[i]!.includes(true));
                        if (hit) return block(hit.body, [p], file, stack);
                        return fallback ? block(fallback.body, [p], file, stack) : { live: [p], ended: [] };
                    }
                    // A subject not known offline: each case runs on its own condition, `subject = key`.
                    const is = (k: Expr, want: boolean) =>
                        assume(
                            {
                                t: 'bin',
                                op: '=',
                                l: s.subject,
                                r: k,
                                text: `${s.subject.text} = ${k.text}`,
                                line: s.line,
                            },
                            want,
                            p.env,
                            file,
                        );
                    const flows = keyed.map(c =>
                        block(
                            c.body,
                            branch(
                                p,
                                c.keys!.flatMap(k => is(k, true)),
                            ),
                            file,
                            stack,
                        ),
                    );
                    // No case matched: every key's condition fails.
                    const none = keyed
                        .flatMap(c => c.keys!)
                        .reduce<Cond[][]>((ways, k) => ways.flatMap(x => is(k, false).map(y => [...x, ...y])), [[]]);
                    const rest = branch(p, none);
                    return merge(
                        ...flows,
                        fallback ? block(fallback.body, rest, file, stack) : { live: rest, ended: [] },
                    );
                }
                case 'call':
                    break;
            }
            const { name } = s.call;
            const raw = s.call.args ?? [];
            // A bound run's delays and damage: what a failed roll's path costs (Path.ticks, Path.damage).
            if (bound && (name === 'p_delay' || name === 'p_arrivedelay')) {
                const n = name === 'p_arrivedelay' ? 0 : intOf(raw[0] && evaluate(raw[0], p.env, file));
                if (n === undefined)
                    return {
                        live: [{ ...p, unsure: p.unsure ?? `\`${s.text}\` (${at}): the delay is not known offline` }],
                        ended: [],
                    };
                return { live: [{ ...p, ticks: (p.ticks ?? 0) + n + 1 }], ended: [] };
            }
            const hurt = bound && (name === '~damage_self' ? raw[0] : name === 'damage' ? raw[2] : undefined);
            if (hurt) {
                const n = most(hurt, p.env, file);
                if (n === undefined)
                    return {
                        live: [{ ...p, unsure: p.unsure ?? `\`${s.text}\` (${at}): the damage is not known offline` }],
                        ended: [],
                    };
                return { live: [{ ...p, damage: (p.damage ?? 0) + n }], ended: [] };
            }
            const index = MOVE_COMMANDS[name];
            if (index !== undefined) {
                const v = raw[index] && evaluate(raw[index], p.env, file);
                if (!bound) return move(moveTarget(v));
                // Inside a call the scan counts as one move, a command only moves the player on.
                const step = made(p, moveTarget(v));
                const counts = p.within ? {} : { move: step, outer: step.at };
                return { live: [reposition({ ...p, moved: true, ...counts }, v)], ended: [] };
            }
            // LOC_DEL removes the active loc and LOC_CHANGE swaps it in place, keeping its shape (LocOps.ts):
            // the loc's tiles are open once nothing there blocks. A queued script's active loc is one it found
            // (`loc_find`), never the trigger's.
            if (bound && (name === 'loc_del' || name === 'loc_change')) {
                if (stack[0]?.startsWith('queue,')) return { live: [p], ended: [] };
                const into = name === 'loc_change' && raw[0] ? evaluate(raw[0], p.env, file) : undefined;
                const opens =
                    name === 'loc_del' ||
                    (into?.t === 'name' && blocksWalk(world?.locConfigs.get(into.v), bound.shape) === false);
                const { opened: _, ...shut } = p;
                return { live: [opens ? { ...p, opened: at } : shut], ended: [] };
            }
            if (name === 'inv_del' || name === 'inv_add') {
                const obj = nameOf(raw[1], p.env);
                if (nameOf(raw[0], p.env) !== 'inv' || !obj) return { live: [p], ended: [] };
                const count = raw[2] && evaluate(raw[2], p.env, file);
                const n = count?.t === 'int' ? count.n : count?.t === 'range' ? count.hi : undefined;
                if (n === undefined) {
                    // Coins taken by a sum the scan can't compute: a fare in no form. Any other obj taken by an
                    // unknown count (all the player holds of it) needs nothing.
                    if (name === 'inv_add' || obj !== 'coins') return { live: [p], ended: [] };
                    return {
                        live: [{ ...p, conds: [...p.conds, { k: 'other', text: `\`${s.text}\` (${at})` }] }],
                        ended: [],
                    };
                }
                if (obj === 'coins' && name === 'inv_del') return { live: [{ ...p, fare: p.fare + n }], ended: [] };
                const sign = name === 'inv_del' ? 1 : -1;
                return {
                    live: [{ ...p, taken: new Map(p.taken).set(obj, (p.taken.get(obj) ?? 0) + sign * n) }],
                    ended: [],
                };
            }
            // A queued script that can move the player runs once the trigger ends (runQueued). Its arguments
            // follow the name and delay; a long queue's logout action, its fourth argument or the third of a `*`
            // form, is not one (Player.ts processQueue).
            if (QUEUE_COMMANDS.has(name)) {
                const target = nameOf(raw[0], p.env);
                const call = target && `queue,${target}`;
                if (!call || !byCall.has(call) || !moves(call)) return { live: [p], ended: [] };
                const starred = s.text.startsWith(`${name}*`);
                const given = name === 'longqueue' ? (starred ? raw.slice(3) : raw.slice(2, 3)) : raw.slice(2);
                const queued = { call, args: given.map(a => evaluate(a, p.env, file)) };
                return { live: [{ ...p, queued: [...(p.queued ?? []), queued] }], ended: [] };
            }
            const args = raw.map(a => evaluate(a, p.env, file));
            const jumped = name === 'jump' ? args[0] : undefined;
            const call = jumped
                ? jumped.t === 'name'
                    ? `@${jumped.v}`
                    : undefined
                : /^[@~]/.test(name)
                  ? name
                  : undefined;
            if (name === 'jump' && !call) {
                stop(`\`${s.text}\` (${at}): the label is not known offline`);
                return { live: [], ended: [p] };
            }
            // Any other command doesn't move the player.
            if (!call) return { live: [p], ended: [] };
            const isLabel = call.startsWith('@');
            const callee = byCall.get(call);
            // A call the scan counts as one move: a bound run reads it through, for where it lands.
            let counted = false;
            if (doorProc(call)) {
                if (!bound) return move(CROSS);
                counted = true;
            }
            // A call of a script already running (a dialogue that asks again) repeats what this path walks;
            // in a bound run a proc given only known values may call itself (~agility_walk steps one tile a
            // call), to BOUND_DEPTH.
            if (stack.includes(call) && (isLabel || !bound || args.some(a => a.t === 'unknown')))
                return isLabel ? { live: [], ended: [p] } : { live: [p], ended: [] };
            // A proc that can't move the player (nor, in a bound run, change a loc) returns to the script; a
            // label never does.
            if (!callee || !(moves(call) || (bound && changingLoc.has(call))))
                return isLabel ? { live: [], ended: [p] } : { live: [p], ended: [] };
            // A moving proc given a fixed tile moves the player there; one that reads no condition the scan
            // reads crosses the loc.
            const fixed = isLabel ? undefined : args.find(a => a.t === 'coord' && !a.relative && !a.from);
            if (!counted && moves(call) && !isLabel && (fixed || !readsConditions.has(call))) {
                if (!bound) return move(moveTarget(fixed));
                counted = true;
            }
            const script = scriptOf(call, callee.file, callee.line, callee.body);
            if ('error' in script || stack.length >= (bound ? BOUND_DEPTH : MAX_DEPTH)) {
                stop('error' in script ? script.error : `\`${s.text}\` (${at}) calls too deep`);
                return { live: [], ended: [p] };
            }
            const env = new Map(script.params.map((param, i) => [param, args[i] ?? unknown(param)]));
            // A bound run carries the player's tile into the call and back out of it, and the most of each
            // argument not known offline that `most` can take (a damage passed on to ~damage_self).
            if (bound) {
                env.set(POS, p.env.get(POS)!);
                script.params.forEach((param, i) => {
                    const n = args[i]?.t === 'unknown' && raw[i] ? most(raw[i], p.env, file) : undefined;
                    if (n !== undefined) env.set(`${MOST}${param}`, { t: 'int', n });
                });
            }
            const one = counted ? made(p, doorProc(call) ? CROSS : moveTarget(fixed)) : undefined;
            const entered = one
                ? { ...p, moved: true, move: one, ...(p.within ? {} : { outer: one.at }), within: (p.within ?? 0) + 1 }
                : p;
            const flow = block(script.body, [{ ...entered, env }], script.file, [...stack, call]);
            const out = [...flow.live, ...flow.ended];
            // A label is a jump: the script ends where it does. A proc returns, to the caller's locals.
            const back = (q: Path): Path => ({
                ...q,
                env: bound ? new Map(p.env).set(POS, q.env.get(POS)!) : p.env,
                within: p.within,
            });
            return isLabel ? { live: [], ended: out } : { live: out.map(back), ended: [] };
        };

        /** A path once the first script it queued has run: each path that script ends on, the rest still queued. */
        const runQueued = (p: Path): Path[] => {
            const [next, ...rest] = p.queued ?? [];
            if (!next) return [p];
            const callee = byCall.get(next.call)!;
            const script = scriptOf(next.call, callee.file, callee.line, callee.body);
            if ('error' in script) {
                stop(script.error);
                return [{ ...p, queued: rest }];
            }
            const env = new Map(script.params.map((param, i) => [param, next.args[i] ?? unknown(param)]));
            if (bound) env.set(POS, p.env.get(POS)!);
            // It starts outside every call the scan counts as one move, wherever the trigger's path ended.
            const flow = block(script.body, [{ ...p, env, queued: rest, within: 0 }], script.file, [next.call]);
            return [...flow.live, ...flow.ended];
        };

        const script = scriptOf(`${trigger.file}:${trigger.line}`, trigger.file, trigger.line, trigger.body);
        if ('error' in script) {
            stop(script.error);
            return run;
        }
        bound = binding && boundLoc(binding);
        if (bound) run.passing = bound.passing;
        try {
            // A bound run starts with the player on the stand.
            const env = new Map<string, Value>(
                binding
                    ? [[POS, { t: 'coord', relative: false, ...binding.stand, at: 'the stand', from: 'player' }]]
                    : [],
            );
            const start: Path = {
                env,
                conds: [],
                fare: 0,
                taken: new Map(),
                moved: false,
                ...(binding ? { ticks: 0, damage: 0 } : {}),
            };
            const flow = block(script.body, [start], script.file, []);
            let ends = [...flow.live, ...flow.ended];
            // The scripts each path queued, once the trigger has ended however it ended, in the order queued (the
            // header); one a queued script queues runs after them. MAX_DEPTH rounds, so queues that queue each
            // other end.
            for (let round = 0; ends.some(p => p.queued?.length); round++) {
                if (round === MAX_DEPTH) {
                    stop(`${trigger.file}:${trigger.line}: its queued scripts queue more past ${MAX_DEPTH} rounds`);
                    break;
                }
                ends = distinctPaths(ends.flatMap(runQueued));
            }
            run.ends = ends;
            run.blocked = run.ends.filter(p => !p.moved);
        } catch (e) {
            if (!(e instanceof TooManyPaths)) throw e;
            stop(`too many paths: ${trigger.file}:${trigger.line} branches past ${MAX_PATHS} ways`);
        } finally {
            bound = undefined;
        }
        return run;
    };

    /** A Binding's loc as a bound run reads it: LOC_COORD, LOC_ANGLE, LOC_SHAPE, LOC_TYPE and LOC_CATEGORY, and its params. */
    const boundLoc = (b: Binding): NonNullable<typeof bound> => {
        const cfg = world?.locConfigs.get(b.config);
        const facts = new Map<string, Value>([
            ['loc_coord', { t: 'coord', relative: false, ...b.tile, at: 'loc_coord', from: 'loc' }],
            ['loc_angle', { t: 'int', n: b.angle }],
            ['loc_shape', { t: 'int', n: b.shape }],
            ['loc_type', { t: 'name', v: b.config }],
        ]);
        const category = first(cfg, 'category');
        if (category) facts.set('loc_category', { t: 'name', v: category });
        // `param=next_loc_stage,kharazi_jungle_plant1_slashed`: a number, a coord, or a config's name.
        const params = new Map(
            (cfg?.param ?? []).map((line): [string, Value] => {
                const [key = '', ...rest] = line.split(',');
                const value = rest.join(',');
                const v: Value = /^-?\d+$/.test(value)
                    ? { t: 'int', n: Number(value) }
                    : isCoordLiteral(value)
                      ? {
                            t: 'coord',
                            relative: false,
                            ...coordTile(value),
                            at: `${b.config} param ${key}`,
                            from: 'loc',
                        }
                      : { t: 'name', v: value };
                return [key, v];
            }),
        );
        return { facts, params, shape: b.shape, passing: new Map() };
    };

    const completes: Completes = new Map(input.quests.map(q => [q.id, q.complete]));

    /**
     * What a gate row's move does from one stand (LandingOutcome), on each path that makes it (the scan's
     * move `to`, GateMove.to; any move when undefined) and that an account meeting one of `requires` can
     * take (consistent), quest windows and paths no account takes left out; and what stopped the run, if
     * anything did.
     */
    const land = (
        trigger: Trigger,
        binding: Binding,
        requires: readonly (readonly string[])[],
        to?: string,
    ): LandingOutcome[] => {
        const run = runTrigger(trigger, binding);
        const passing = run.passing ?? new Map<string, string[]>();
        const takes = (p: Path) => {
            const s = settle(p.conds, p.fare, p.taken);
            return (
                !s.dead &&
                s.window === undefined &&
                (!requires.length || requires.some(set => consistent(p.conds, set, passing, completes)))
            );
        };
        const kept = run.ends.filter(
            p => p.move && (to === undefined || p.move.tos.includes(to)) && !failed(p) && takes(p),
        );
        return [
            ...kept.map(p => {
                const o = landingOf(p);
                if (o.k !== 'landing' || !needsNothing(p)) return o;
                const passed = waitsOf(p);
                return { ...o, free: true as const, ...(passed.length ? { waits: passed } : {}) };
            }),
            ...run.ends.filter(p => failed(p) && takes(p)).flatMap(fallOf),
            ...run.why.map((why): LandingOutcome => ({ k: 'underived', why })),
        ];
    };
    /**
     * The queue commands of `scripts` that queue a moving script with a delay other than 0, or on the weak
     * queue, as `` `command(script, delay)` (file:line) ``: the walker runs those in the order queued and the
     * weak ones as if they ran (the header), which the engine may not.
     */
    const untimedQueues = (scripts: readonly { file: string; line: number; body: string }[]): string[] =>
        scripts.flatMap(t => {
            const code = codeOf(t.body);
            return [...code.matchAll(QUEUES)].flatMap(m => {
                if (!moves(`queue,${m[2]}`) || (m[1] !== 'weakqueue' && m[3]?.trim() === '0')) return [];
                const line = t.line + code.slice(0, m.index).split('\n').length - 1;
                return [`\`${m[1]}(${m[2]}, ${m[3]?.trim() ?? ''})\` (${t.file}:${line})`];
            });
        });
    return { bodyMoves, run: runTrigger, land, untimedQueues };
}

/**
 * The queue commands in the triggers and callables that queue a moving script with a delay other than 0, or on
 * the weak queue (gate-scan.ts header), as `` `command(script, delay)` (file:line) ``, sorted: the build reports
 * them.
 */
export const untimedQueues = (input: GateScanInput): string[] =>
    gateWalker(input)
        .untimedQueues([...input.triggers, ...input.callables, ...(input.queues ?? [])])
        .sort(cmp);

const isVar = (e: Expr | undefined): boolean => e?.t === 'name' && e.name.startsWith('%') && e.args === null;
const isClock = (e: Expr | undefined): boolean => e?.t === 'name' && e.name === 'map_clock' && !e.args?.length;

/**
 * Whether `l op r`, taken `want` way, is a wait: a var compared with MAP_CLOCK, the world's tick (World.currentTick,
 * handlers/ServerOps.ts), which only grows, taken the way that holds once the clock passes the var. The scripts
 * keep an obstacle's last use so: `%barb_obstacle_pipe_used >= map_clock` refuses a player while someone used the
 * pipe a few ticks ago (skill_agility/scripts/barbarian_course.rs2:139, set to `map_clock + 4` at :143), and so
 * the Karamja dungeon pipes (areas/area_karamja/scripts/karam_dungeon.rs2:299, :329) and the lumberyard fence
 * (quests/quest_fluffs/scripts/quest_fluffs.rs2:131): waiting opens it.
 */
function waits(l: Expr, op: string, r: Expr | undefined, want: boolean): boolean {
    const taken = want ? op : NEGATE[op];
    if (!taken) return false;
    const varFirst = isVar(l) && isClock(r) ? taken : isClock(l) && isVar(r) ? FLIP[taken] : undefined;
    return varFirst === '<' || varFirst === '<=';
}

/**
 * Whether a bound run's path needs nothing an account on a members world lacks, whatever its quests: it met no
 * requirement (`met`), took no roll and no side left unsettled, and pays and consumes nothing. A condition a
 * bound run can't read is on the path (Path.passed): a path past one needs nothing only when each is a wait
 * (waits), as any other (an npc nearby, areas/area_alkharid/scripts/shantay_pass.rs2:76) may be what lets the
 * player through.
 */
function needsNothing(p: Path): boolean {
    const s = settle(p.conds, p.fare, p.taken);
    return (
        p.conds.every(c => c.k === 'free' || c.k === 'quest') &&
        [...(p.passed?.values() ?? [])].every(wait => wait) &&
        s.requires.every(r => r === 'members') &&
        !s.before.length
    );
}

/** The waits a bound run's path passed (Path.passed), sorted. */
const waitsOf = (p: Path): string[] => [...(p.passed ?? [])].flatMap(([text, wait]) => (wait ? [text] : [])).sort(cmp);

/** What a bound run's path that made the move does (LandingOutcome). */
function landingOf(p: Path): LandingOutcome {
    const roll = rollOf(p);
    if (p.landing && 'tile' in p.landing)
        return {
            k: 'landing',
            ...p.landing,
            move: p.outer ?? p.move!.at,
            ...(roll ? ('why' in roll ? { unrolled: roll.why } : { roll }) : {}),
        };
    if (p.opened) return { k: 'opens', at: p.opened };
    return { k: 'underived', why: p.landing?.why ?? `${p.move?.at} sets no position on this path` };
}

/** What a bound run's path that failed its roll does (LandingOutcome `fail`); nothing for one with no roll a row takes. */
function fallOf(p: Path): LandingOutcome[] {
    const roll = rollOf(p);
    if (!roll || 'why' in roll) return [];
    if (p.unsure) return [{ k: 'fail', roll, why: p.unsure }];
    if (p.landing && 'why' in p.landing) return [{ k: 'fail', roll, why: p.landing.why }];
    const tile = p.landing?.tile;
    return [{ k: 'fail', roll, ...(tile ? { tile } : {}), ticks: p.ticks ?? 0, damage: p.damage ?? 0 }];
}

/** The stage `set` holds of a quest: its `quest:<id>>=<n>`, or complete for `quest:<id>`. */
function stageIn(set: readonly string[], quest: string, completes: Completes): number | undefined {
    const stages = set.flatMap(r => {
        const m = r.match(/^quest:([a-z0-9_]+)(?:>=(\d+))?$/);
        return m?.[1] === quest ? [m[2] === undefined ? (completes.get(quest) ?? 0) : Number(m[2])] : [];
    });
    return stages.length ? Math.max(...stages) : undefined;
}

/**
 * Whether holding requirement `have` meets `need`: it implies it, or it is the same skill, quest points or
 * coins at least as high, or it consumes the obj `need` holds.
 */
function meets(completes: Completes, have: string, need: string): boolean {
    if (implies(completes, have, need)) return true;
    const [h, n] = [have, need].map(r => r.match(/^(skill:[a-z_]+|questpoints|coins):(\d+)$/));
    if (h && n && h[1] === n[1]) return Number(h[2]) >= Number(n[2]);
    const consumed = have.match(/^consume:([a-z0-9_]+):\d+$/);
    return consumed !== null && need === `item:${consumed[1]}:held`;
}

/**
 * Whether an account that meets requirement set `set` can take a path with these conditions: none of them
 * is a read condition taken the way that refuses the player what the set holds (`stat(mining) < 60` taken
 * true, `passing` giving it skill:mining:60 the other way, when the set holds skill:mining:60), and each
 * quest varp's comparisons hold at a stage the set reaches.
 */
function consistent(
    conds: readonly Cond[],
    set: readonly string[],
    passing: ReadonlyMap<string, readonly string[]>,
    completes: Completes,
): boolean {
    const refuses = (c: Cond) =>
        c.k === 'free' && (passing.get(c.text) ?? []).some(r => set.some(h => meets(completes, h, r)));
    if (conds.some(refuses)) return false;
    const byVarp = new Map<string, Extract<Cond, { k: 'quest' }>[]>();
    for (const c of conds) if (c.k === 'quest' && c.ref.own) push(byVarp, c.ref.varp, c);
    return [...byVarp.values()].every(comps => {
        const { ref } = comps[0]!;
        const need = stageIn(set, ref.quest.id, completes);
        if (need === undefined) return true;
        const points = [need, ref.complete, ...comps.flatMap(c => [c.n - 1, c.n, c.n + 1])].filter(v => v >= need);
        return points.some(v => comps.every(c => holds(v, c.op, c.n)));
    });
}

/**
 * Runs a gate trigger for one placed loc and stand (Binding), and says what its move past the check does
 * there (LandingOutcome, sources/gate-scan.ts header): one outcome per path that makes the scan's move `to`
 * (any move when undefined) and that an account meeting one of `requires` takes, and one per construct that
 * stopped the run.
 */
export function gateLander(
    input: GateScanInput,
    world: LanderWorld,
): (trigger: Trigger, binding: Binding, requires: readonly (readonly string[])[], to?: string) => LandingOutcome[] {
    return gateWalker(input, world).land;
}

// ---- Proposals --------------------------------------------------------------------------------------

/** The conditions a run read, as `` `text` (file:line) ``, each once in the order met. */
function conditionsOf(run: Run): string[] {
    const out = new Set<string>();
    for (const conds of [...run.moves.map(m => m.conds), ...run.blocked.map(p => p.conds)])
        for (const c of conds) if (c.k !== 'side' && c.k !== 'unread') out.add(c.text);
    return [...out];
}

/** Each unread condition on some of these paths, with the ways they took it. */
function unreadWays(conds: readonly (readonly Cond[])[]): Map<string, Set<boolean>> {
    const out = new Map<string, Set<boolean>>();
    for (const cs of conds)
        for (const c of cs) if (c.k === 'unread') out.set(c.text, (out.get(c.text) ?? new Set()).add(c.want));
    return out;
}

/**
 * The conditions a run could not read that decide whether, or where, it moves: taken one way, no path
 * moves (every path that took it so ended without a move) and taken the other, one does; or taken each
 * way, the paths land on different tiles. Each once, in the order met.
 */
function unreadOf(run: Run): string[] {
    const moved = unreadWays(run.moves.map(m => m.conds));
    const blocked = unreadWays(run.blocked.map(p => p.conds));
    const landings = (text: string, want: boolean) =>
        new Set(
            run.moves
                .filter(m => m.conds.some(c => c.k === 'unread' && c.text === text && c.want === want))
                .map(m => m.to),
        );
    return [...moved].flatMap(([text, wants]) => {
        const decidesWhether = [true, false].some(w => wants.has(!w) && !wants.has(w) && blocked.get(text)?.has(w));
        const [yes, no] = [landings(text, true), landings(text, false)];
        const decidesWhere =
            yes.size > 0 && no.size > 0 && ([...yes].some(t => !no.has(t)) || [...no].some(t => !yes.has(t)));
        return decidesWhether || decidesWhere ? [text] : [];
    });
}

/** What a run makes the trigger (GateCandidate), or null when it read no condition before a move. */
function propose(trigger: Trigger, run: Run, completes: Completes): GateCandidate | null {
    const conditions = conditionsOf(run);
    const unread = unreadOf(run);
    if (!run.why.length && (!run.moves.length || (!conditions.length && !unread.length))) return null;
    const settled = beforeOnly(
        run.moves.map(m => ({ to: m.to, ...settle(m.conds, m.fare, m.taken) })).filter(s => !s.dead),
    );
    const open = settled.filter(s => s.window === undefined);
    const windows = [
        ...settled.flatMap(s => (s.window === undefined ? [] : [`${s.to}: ${s.window}`])),
        ...run.blocked.flatMap(p => {
            const s = settle(p.conds, p.fare, p.taken);
            return !s.dead && s.window !== undefined ? [`block: ${s.window}`] : [];
        }),
    ];
    const targets = [...new Set(open.map(s => s.to))].sort((a, b) => (a === CROSS ? -1 : b === CROSS ? 1 : cmp(a, b)));
    const moves = targets.map(to => ({
        to,
        options: minimalOptions(
            open.filter(s => s.to === to).map(s => ({ requires: s.requires, sides: s.sides })),
            completes,
        ),
    }));
    const stages: Record<string, string> = {};
    // Only the stages a minimal option still names.
    const named = new Set(moves.flatMap(m => m.options.flatMap(o => o.requires)));
    for (const s of open) for (const [req, name] of Object.entries(s.stages)) if (named.has(req)) stages[req] = name;
    const gated = moves.some(m => m.options.some(o => o.requires.length));
    const blocks = windows.some(w => w.startsWith('block: '));
    // Only conditions it can't read: what they gate is for gates.ts to say.
    const kind: GateKind =
        run.why.length || (!gated && !conditions.length)
            ? 'unclear'
            : gated
              ? 'gate'
              : !open.length
                ? windows.length
                    ? 'quest-window'
                    : 'unclear'
                : blocks
                  ? 'temporary-block'
                  : 'side-effect';
    return {
        trigger: triggerKey(trigger),
        source: `${trigger.file}:${trigger.line}`,
        kind,
        moves,
        conditions,
        unread,
        windows: [...new Set(windows)].sort(cmp),
        stages: Object.fromEntries(Object.entries(stages).sort(([a], [b]) => cmp(a, b))),
        ...(run.why.length ? { why: run.why.join('; ') } : {}),
    };
}

/** What the scan makes of one trigger (scanTrigger). */
export type TriggerScan = { candidate: GateCandidate } | { moves: string[] } | null;

/**
 * Every loc op trigger that branched on a condition the scan reads before a move (sources/gate-scan.ts
 * header), with what the scan makes of it, by trigger. `scan` is scanTrigger's, given to share its runs.
 */
export function scanGates(input: GateScanInput, scan = scanTrigger(input)): GateCandidate[] {
    const out: GateCandidate[] = [];
    for (const t of input.triggers) {
        const s = t.on === 'loc' ? scan(t) : null;
        if (s && 'candidate' in s) out.push(s.candidate);
    }
    return out.sort((a, b) => cmp(a.trigger, b.trigger) || cmp(a.source, b.source));
}

/**
 * What the scan makes of one loc or npc op trigger, each run once: the candidate it proposes (scanGates's, for
 * a loc op), or the tiles (GateMove.to) it moves the player to with no condition read before the move, or null
 * when it makes no move. The build's unreached report reads it for the triggers in and beside a pocket.
 */
export function scanTrigger(input: GateScanInput): (t: Trigger) => TriggerScan {
    const walker = gateWalker(input);
    const completes = new Map(input.quests.map(q => [q.id, q.complete]));
    const seen = new Map<Trigger, TriggerScan>();
    const scan = (t: Trigger): TriggerScan => {
        if (!walker.bodyMoves(t.body)) return null;
        const run = walker.run(t);
        const candidate = propose(t, run, completes);
        if (candidate) return { candidate };
        const moves = [...new Set(run.moves.map(m => m.to))].sort(cmp);
        return moves.length ? { moves } : null;
    };
    return t => {
        if (!seen.has(t)) seen.set(t, scan(t));
        return seen.get(t)!;
    };
}

// ---- Curation and placement -------------------------------------------------------------------------

/**
 * What gates.ts makes of a candidate: a GateKind, or `not-a-gate` (the move is not passage between places a
 * bot walks: inside a minigame, a transport out of scope, a quest step or a trap, a loc never placed).
 */
export type CuratedKind = GateKind | 'not-a-gate';

/** A gates.ts entry: one candidate, confirmed or rejected. */
export interface CuratedGate {
    /** The candidate's trigger (GateCandidate.trigger). */
    trigger: string;
    kind: CuratedKind;
    /** For a gate: its minimal requirement sets, canonical (requirements.ts). */
    requires?: string[][];
    /** For a gate: the side the check applies from, when only one. */
    from?: Side;
    /**
     * For a gate with `from`: the script refuses a player on the other side outright (the castle crumbly wall,
     * skill_agility/scripts/shortcuts.rs2:6), so the move is made from `from` only, not free from the other side.
     */
    oneWay?: true;
    /**
     * For a gate: the coord literal of the jump it gates, when it gates a jump rather than the crossing; or,
     * when each placed loc jumps elsewhere (a `loc_coord` table), the landing by the loc's tile literal.
     */
    to?: string | Record<string, string>;
    /** The script line that makes the check, `file:line`. */
    source: string;
    /**
     * Why: required for every kind but a gate, and for a gate whose requirements, side or move differ from
     * what the scan proposes (why the scan is wrong there).
     */
    why?: string;
    /**
     * For an entry with a why (every rejection, and a gate that overrides the scan): the digest of the scan
     * proposal it was written against (proposalDigest). The review fails when the proposal changes.
     */
    scan?: string;
    /** For a gate: what else to know about it (written to World.gates). */
    notes?: string;
    /**
     * For a gate: the stage constant (`^name`, or `^name+1` one past it) of each `quest:<id>>=<n>` in its
     * requirements that the scan does not name (one it does not propose).
     */
    stages?: Record<string, string>;
    /**
     * For a gate whose condition depends on the config (a loc param, a `loc_type` test): requirement sets
     * by config, in place of `requires` for that config's locs; `[]` when its locs pass free (not written).
     */
    byConfig?: Record<string, string[][]>;
    /**
     * For a gate whose check is on some placed locs only (a `switch_coord (loc_coord)` case): their tiles, as
     * coord literals; the trigger's other locs pass free (not written).
     */
    at?: string[];
    /**
     * For a gate on an op 1-5 whose move is behind dialogue: the options picked on the way, in order, by their text,
     * each a string the source's file writes (Gate.act); one the script asks only on some paths is answered when shown.
     */
    choices?: string[];
}

export interface GateReview {
    /** Candidates gates.ts has no entry for, as `<trigger> (<source>): <the scan's kind>`: an error. */
    unreviewed: string[];
    /** Entries for triggers the scan no longer finds: an error. */
    stale: string[];
    /**
     * Overrides (a rejection, or a gate with a why) whose scan digest is missing or no longer the scan's
     * proposal, with the digest to write once the trigger is read again: an error.
     */
    drifted: string[];
    /** Entries that are malformed, or differ from the scan's proposal with no `why`: an error. */
    invalid: string[];
}

/**
 * The side a move's gate applies from: the sides its gated options share, joined by `&`, when they all
 * share the same ones; or, when they name none and every free option is on one Side, the opposite one.
 */
function gatedSide(move: GateMove): string | undefined {
    const sides = new Set(move.options.filter(o => o.requires.length).map(o => o.sides.join('&')));
    const [only] = sides;
    if (sides.size === 1 && only) return only;
    // Gated with no side, free on one side only: the check is what stops a player on the other.
    const free = new Set(move.options.filter(o => !o.requires.length).map(o => o.sides.join('&')));
    const [open] = free;
    return sides.size === 1 && only === '' && free.size === 1 && open && open in OPPOSITE ? OPPOSITE[open] : undefined;
}

const OPPOSITE: Readonly<Record<string, Side>> = {
    loc: 'far',
    far: 'loc',
    west: 'east',
    east: 'west',
    north: 'south',
    south: 'north',
};

/** A text without its ` (file:line)` citations. */
const strip = (t: string): string => t.replace(/ \([^()]*\.rs2:\d+\)/g, '');

/**
 * A candidate's proposal as one line, without script lines (so a script edit that only shifts lines
 * doesn't touch it): its kind, each move's target, gated sets and side, its windows and its unread
 * conditions.
 */
export function proposalText(c: GateCandidate): string {
    return JSON.stringify([
        c.kind,
        c.moves.map(m => [m.to, gatedSets(m).map(set => set.map(strip)), gatedSide(m) ?? '']),
        c.windows.map(strip),
        c.unread.map(strip),
    ]);
}

/** proposalText hashed (32-bit FNV-1a) to 8 hex digits: what a curated override pins (CuratedGate.scan). */
export function proposalDigest(c: GateCandidate): string {
    let h = 0x811c9dc5;
    for (const ch of proposalText(c)) {
        h ^= ch.codePointAt(0)!;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** A dialogue-option call: `~p_choice2(...)`, `~p_choice3_header(...)`, `@multi4(...)`, by its option count. */
const OPTION_CALL = /(?:~p_choice|@multi)([2-5])(?:_header)?\s*\(/g;

/** The top-level arguments of the call whose list opens just before `from` in `code`, as written. */
function argsAt(code: string, from: number): string[] {
    const args: string[] = [];
    let [depth, quoted, start] = [0, false, from];
    for (let i = from; i < code.length; i++) {
        const ch = code[i]!;
        if (quoted) {
            if (ch === '\\') i++;
            else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === '(') depth++;
        else if (ch === ')') {
            if (depth === 0) return [...args, code.slice(start, i).trim()];
            depth--;
        } else if (ch === ',' && depth === 0) {
            args.push(code.slice(start, i).trim());
            start = i + 1;
        }
    }
    return args;
}

/**
 * The option texts the dialogue-option calls in `code` offer: each call's strings in its option places (text,
 * then what picking it returns or jumps to, chat.rs2 `[proc,p_choice2]`), the header of a `_header` form left out.
 */
export function optionTexts(code: string): Set<string> {
    const out = new Set<string>();
    for (const m of code.matchAll(OPTION_CALL)) {
        const args = argsAt(code, m.index + m[0].length);
        for (let i = 0; i < Number(m[1]); i++) {
            const a = args[2 * i];
            if (a && /^"(?:[^"\\]|\\.)*"$/.test(a)) out.add(a.slice(1, -1));
        }
    }
    return out;
}

/** A candidate's gated requirement sets on one move: the minimal sets of its options that need something. */
export const gatedSets = (move: GateMove | undefined): string[][] =>
    minimalSets((move?.options ?? []).filter(o => o.requires.length).map(o => o.requires));

/**
 * Checks the gates.ts entries against the scan: every candidate has an entry, every entry a candidate, and
 * each entry is well formed and agrees with the scan's proposal (or says why not).
 */
export function reviewGates(
    candidates: readonly GateCandidate[],
    curated: readonly CuratedGate[],
    /** The script files by path, to check each entry's source line is there; omitted: not checked. */
    files?: ReadonlyMap<string, string>,
): GateReview {
    const byTrigger = new Map(candidates.map(c => [c.trigger, c]));
    const options = new Map<string, Set<string>>();
    const optionsIn = (file: string): Set<string> => {
        let o = options.get(file);
        if (!o) options.set(file, (o = optionTexts(files?.get(file) ?? '')));
        return o;
    };
    const lines = new Map<string, string[]>();
    const lineAt = (file: string, n: number): string | undefined => {
        let ls = lines.get(file);
        if (!ls) lines.set(file, (ls = files?.get(file)?.split('\n') ?? []));
        return ls[n - 1];
    };
    const seen = new Set<string>();
    const invalid: string[] = [];
    const stale: string[] = [];
    const drifted: string[] = [];
    for (const e of curated) {
        const fail = (why: string) => invalid.push(`${e.trigger} (${e.source}): ${why}`);
        if (seen.has(e.trigger)) fail('listed twice');
        seen.add(e.trigger);
        const c = byTrigger.get(e.trigger);
        if (!c) {
            stale.push(`${e.trigger} (${e.source})`);
            continue;
        }
        const at = e.source.match(/^([^:]+\.rs2):(\d+)$/);
        if (!at) fail(`source ${e.source} is not file:line`);
        else if (files && !lineAt(at[1]!, Number(at[2]))?.trim()) fail(`source ${e.source} is not a line of code`);
        // An entry that overrides the scan (a rejection, or a gate with a why) pins the proposal it read: when
        // the proposal changes, the entry has drifted until someone reads the trigger again.
        const overrides = e.kind !== 'gate' || e.why !== undefined;
        const digest = proposalDigest(c);
        if (overrides && e.scan !== digest)
            drifted.push(
                `${e.trigger} (${e.source}): ${e.scan === undefined ? 'no scan digest' : `the scan's proposal changed from ${e.scan}`}; ` +
                    `read the trigger again and write scan: '${digest}' (${proposalText(c)})`,
            );
        if (!overrides && e.scan !== undefined) fail('scan pins an override: a gate that matches the scan has none');
        if (e.why !== undefined && !e.why.trim()) fail('why is empty');
        if (e.kind !== 'gate') {
            if (e.requires || e.from || e.oneWay || e.to || e.notes || e.byConfig || e.stages || e.at || e.choices)
                fail(`a ${e.kind} has no requires, from, oneWay, to, notes, byConfig, stages, at or choices`);
            if (!e.why?.trim()) fail(`a ${e.kind} needs its reason in why`);
            continue;
        }
        if (!e.requires?.length) {
            fail('a gate needs its requirement sets');
            continue;
        }
        for (const sets of [e.requires, ...Object.values(e.byConfig ?? {}).filter(s => s.length)]) {
            const canonical = minimalSets(sets);
            if (JSON.stringify(canonical) !== JSON.stringify(sets))
                fail(`write requires as ${JSON.stringify(canonical)}`);
        }
        if ((e.byConfig || e.at) && e.why === undefined) fail('requirements by config or by tile need a why');
        for (const t of e.at ?? []) if (!isCoordLiteral(t)) fail(`at ${t} is not a coord literal`);
        if (e.choices && !/^(?:op|ap)loc[1-5],/.test(e.trigger)) fail('choices follow an op 1-5 of the loc');
        if (e.choices && !e.choices.length) fail('choices is empty');
        // A choice is an option a dialogue-option call in the trigger's file offers.
        const file = c.source.replace(/:\d+$/, '');
        for (const choice of e.choices ?? [])
            if (files && !optionsIn(file).has(choice))
                fail(`choice ${JSON.stringify(choice)} is not an option a dialogue in ${file} offers`);
        const targets = e.to === undefined ? [CROSS] : typeof e.to === 'string' ? [e.to] : Object.values(e.to);
        for (const t of [...targets, ...(typeof e.to === 'object' ? Object.keys(e.to) : [])])
            if (t !== CROSS && !isCoordLiteral(t)) fail(`to ${t} is not a coord literal`);
        // One way: no move the scan finds lets a player off the `from` side through.
        if (e.oneWay && !e.from) fail('oneWay needs from');
        const from = e.oneWay ? e.from : undefined;
        for (const m of from ? c.moves.filter(x => targets.includes(x.to)) : [])
            for (const o of m.options.filter(x => !x.sides.includes(from!)))
                fail(
                    `oneWay, but the scan moves ${m.to} from off ${from}: ${JSON.stringify(o.requires)} on ${o.sides.join(' & ') || 'any side'}`,
                );
        if (overrides) continue;
        for (const to of targets) {
            const move = c.moves.find(m => m.to === to);
            const scanned = gatedSets(move);
            const side = move && gatedSide(move);
            if (c.kind !== 'gate' || JSON.stringify(scanned) !== JSON.stringify(e.requires) || side !== e.from)
                fail(
                    `the scan proposes ${c.kind}, ${to} ${JSON.stringify(scanned)}${side ? ` from ${side}` : ''}: ` +
                        'match it, or say in why what the scan misses',
                );
        }
    }
    return {
        unreviewed: candidates.filter(c => !seen.has(c.trigger)).map(c => `${c.trigger} (${c.source}): ${c.kind}`),
        stale,
        drifted,
        invalid,
    };
}

export interface GatePlacementInput {
    curated: readonly CuratedGate[];
    candidates: readonly GateCandidate[];
    triggers: readonly Trigger[];
    locConfigs: ReadonlyMap<string, Config>;
    /** Every placed loc, by config. */
    locs: readonly { config: string; tile: Tile; shape: number; rotation: number }[];
    quests: readonly Quest[];
    /** To check a curated stage name (CuratedGate.stages) holds the stage. */
    constants: ReadonlyMap<string, Constant>;
}

export interface GatePlacement {
    /** One per placed loc of each gate and quest window, by tile then trigger. */
    gates: Gate[];
    /**
     * Gates and quest windows with no placed loc, as `<trigger> (<source>)`, and byConfig configs the
     * trigger does not cover.
     */
    unplaced: string[];
    /** The stage constants the gates name: quest id -> constant name -> value. */
    stages: Map<string, Map<string, number>>;
    /** A `quest:<id>>=<n>` no stage constant names (the scan found none for it): an error. */
    unnamed: string[];
}

const TRIGGER = /^(op|ap)loc([1-5u]),(_?)([a-z0-9_]+)$/;

/**
 * The loc configs a loc trigger runs for that have its op (a use-item trigger, op `u`, needs none): a config
 * trigger's own config, or every config of a category trigger's category but those with their own trigger of the
 * same kind and op, which the engine runs instead (server/engine/src/engine/script/ScriptProvider.ts getByTrigger).
 * In locConfigs order.
 */
export function triggerConfigs(
    triggers: readonly Trigger[],
    locConfigs: ReadonlyMap<string, Config>,
): (t: Trigger) => string[] {
    const own = new Set(triggers.filter(t => t.on === 'loc' && !t.category).map(t => `${t.target} ${t.kind}${t.op}`));
    return t =>
        (t.category
            ? [...locConfigs]
                  .filter(([name, cfg]) => first(cfg, 'category') === t.target && !own.has(`${name} ${t.kind}${t.op}`))
                  .map(([name]) => name)
            : [t.target]
        ).filter(c => t.op === 'u' || first(locConfigs.get(c), `op${t.op}`) !== undefined);
}

/**
 * The placed locs of the gates and quest windows gates.ts confirms, each with what it needs. A category
 * trigger covers every config of the category but those with their own trigger of the same kind and op,
 * which the engine runs instead (server/engine/src/engine/script/ScriptProvider.ts getByTrigger).
 */
export function placeGates(input: GatePlacementInput): GatePlacement {
    const own = new Set(
        input.triggers.filter(t => t.on === 'loc' && !t.category).map(t => `${t.target} ${t.kind}${t.op}`),
    );
    const byConfig = new Map<string, GatePlacementInput['locs'][number][]>();
    for (const l of input.locs) push(byConfig, l.config, l);
    const candidates = new Map(input.candidates.map(c => [c.trigger, c]));
    const questIds = new Set(input.quests.map(q => q.id));
    const gates: Gate[] = [];
    const unplaced: string[] = [];
    const unnamed: string[] = [];
    const stages = new Map<string, Map<string, number>>();
    for (const e of input.curated) {
        if (e.kind !== 'gate' && e.kind !== 'quest-window') continue;
        const m = e.trigger.match(TRIGGER);
        if (!m) throw new Error(`gates.ts ${e.trigger}: not a loc op trigger`);
        const [, kind, op, category, target] = m as unknown as [string, string, string, string, string];
        const configs = category
            ? [...input.locConfigs]
                  .filter(([name, cfg]) => first(cfg, 'category') === target && !own.has(`${name} ${kind}${op}`))
                  .map(([name]) => name)
            : [target];
        const requires = e.kind === 'gate' ? (e.requires ?? []) : [];
        for (const config of Object.keys(e.byConfig ?? {}))
            if (!configs.includes(config))
                unplaced.push(`${e.trigger} (${e.source}): byConfig ${config} is not its loc`);
        for (const req of [...requires, ...Object.values(e.byConfig ?? {}).flat()].flat()) {
            const stage = req.match(/^quest:([a-z0-9_]+)>=(\d+)$/);
            if (!stage) continue;
            const name = e.stages?.[req] ?? candidates.get(e.trigger)?.stages[req];
            // `^name`, `^name+1`, or the number itself: each must hold the stage.
            const [base, plus] = (name ?? '').split('+');
            const value = base?.startsWith('^') ? constantInt(input.constants, base) : Number(base);
            const nameHolds = value !== undefined && value + (plus ? 1 : 0) === Number(stage[2]);
            if (!name || !questIds.has(stage[1]!) || !nameHolds) {
                unnamed.push(`${e.trigger} (${e.source}): ${req}${name ? ` (${name} does not hold it)` : ''}`);
                continue;
            }
            const byName = stages.get(stage[1]!) ?? new Map<string, number>();
            stages.set(stage[1]!, byName.set(name, Number(stage[2])));
        }
        // A gate's notes, or what a quest window is open for.
        const notes = e.kind === 'gate' ? e.notes : e.why;
        let placed = 0;
        for (const config of configs) {
            const configRequires = e.byConfig?.[config] ?? requires;
            // A config whose locs pass free is not a gate.
            if (e.kind === 'gate' && !configRequires.length) continue;
            const cfg = input.locConfigs.get(config);
            const [width, length] = [Number(first(cfg, 'width') ?? 1), Number(first(cfg, 'length') ?? 1)];
            for (const l of byConfig.get(config) ?? []) {
                if (e.at && !e.at.includes(tileCoord(l.tile))) continue;
                const landing = typeof e.to === 'object' ? e.to[tileCoord(l.tile)] : e.to;
                if (typeof e.to === 'object' && !landing) {
                    unplaced.push(`${e.trigger} (${e.source}): no landing in to for the loc at ${tileCoord(l.tile)}`);
                    continue;
                }
                placed++;
                gates.push({
                    trigger: e.trigger,
                    kind: e.kind,
                    loc: config,
                    tile: l.tile,
                    shape: l.shape,
                    angle: l.rotation,
                    ...(width !== 1 || length !== 1 ? { width, length } : {}),
                    requires: configRequires,
                    ...(e.from ? { from: e.from } : {}),
                    ...(e.oneWay ? { oneWay: true as const } : {}),
                    ...(landing ? { to: coordTile(landing) } : {}),
                    ...(e.choices
                        ? { act: { kind: 'loc-op' as const, loc: config, op: Number(op), choices: e.choices } }
                        : {}),
                    source: e.source,
                    ...(notes ? { notes } : {}),
                });
            }
        }
        if (!placed) unplaced.push(`${e.trigger} (${e.source})`);
    }
    gates.sort(
        (a, b) =>
            a.tile.level - b.tile.level ||
            a.tile.x - b.tile.x ||
            a.tile.z - b.tile.z ||
            cmp(a.trigger, b.trigger) ||
            cmp(a.loc, b.loc) ||
            a.shape - b.shape ||
            a.angle - b.angle,
    );
    return { gates, unplaced, stages, unnamed };
}
