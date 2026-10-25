// How far an npc config's spawns move on their own, how fast they come back, and whether a script of its own moves
// it further: read from its `.npc` config, the engine's defaults for the lines it leaves out, and its ai scripts.
// Paths are under server/content/scripts/ unless they name the engine.
import { readFileSync } from 'fs';
import { join } from 'path';
import { codeOf } from '../classify';
import { readDefault, type ServerDefault } from '../model/server';
import { ENGINE_SRC } from '../paths';
import type { NpcMove, Rect } from '../types';
import { first, type Config } from './configs';
import type { Constant } from './constants';
import { blocks } from './triggers';

export interface NpcMovement {
    /**
     * Chebyshev tiles from its spawn tile an npc of the config walks on its own: `wanderrange` when it wanders, 0
     * when it does not or patrols (its walk is `patrol`).
     */
    wander: number;
    /** A patrolling config's patrol coords, as their box on the first coord's level. */
    patrol?: Rect;
    /** `respawnrate`, before the engine's player-count scaling. */
    respawnTicks: number;
    moves?: NpcMove;
}

/** The engine's values for the lines a config leaves out (NpcType.ts). */
export interface MovementDefaults {
    wanderRange: ServerDefault;
    respawnRate: ServerDefault;
    /** `defaultmode`, as the config spells it. */
    defaultMode: string;
    /** `moverestrict`, as the config spells it. */
    moveRestrict: string;
}

const NPC_TYPE = 'cache/config/NpcType.ts';

/** One `<field> = <Enum>.<VALUE>;` line of NpcType.ts, lower-cased as a config writes it. */
function readEnumDefault(text: string, field: string): string {
    const hits = [...text.matchAll(new RegExp(`^\\s*${field} = \\w+\\.(\\w+);`, 'gm'))];
    if (hits.length !== 1) throw new Error(`Expected one ${field} default in ${NPC_TYPE}: has it moved?`);
    return hits[0]![1]!.toLowerCase();
}

export function readMovementDefaults(): MovementDefaults {
    const text = readFileSync(join(ENGINE_SRC, NPC_TYPE), 'utf8');
    return {
        wanderRange: readDefault(NPC_TYPE, text, /^\s*wanderrange = (\d+);/),
        respawnRate: readDefault(NPC_TYPE, text, /^\s*respawnrate = (\d+);/),
        defaultMode: readEnumDefault(text, 'defaultmode'),
        moveRestrict: readEnumDefault(text, 'moverestrict'),
    };
}

/** A config's whole-number line, or `fallback` when it has none, as model/npcs.ts configInt reads one. */
function configInt(cfg: Config | undefined, key: string, fallback: number, config: string): number {
    const v = first(cfg, key);
    if (v === undefined) return fallback;
    if (!/^-?\d+$/.test(v)) throw new Error(`Unreadable ${key} ${v} for npc ${config}`);
    return Number(v);
}

/**
 * A `patrol<n>=<level>_<mx>_<mz>_<lx>_<lz>,<delay>` line's tile, as the packer splits it
 * (server/engine/tools/pack/config/NpcConfig.ts:237-250); the coord may be a constant (`^trawler_start_patrol1`).
 */
function patrolTile(value: string, constants: ReadonlyMap<string, Constant>): { level: number; x: number; z: number } {
    const coord = value.split(',')[0]!.trim();
    const literal = coord.startsWith('^') ? constants.get(coord)?.value : coord;
    const [level, mx, mz, lx, lz] = (literal ?? '').split('_').map(Number);
    if (![level, mx, mz, lx, lz].every(n => Number.isInteger(n))) throw new Error(`Unreadable patrol coord ${value}`);
    return { level: level!, x: mx! * 64 + lx!, z: mz! * 64 + lz! };
}

/**
 * Where a config walks on its own. server/engine/src/engine/entity/Npc.ts:597-605 runs the config's `defaultmode`:
 * `wander` calls wander(wanderrange) (Npc.ts:717-722), which picks a tile up to `wanderrange` from the spawn on each
 * axis (Npc.ts:702-706), unless `moverestrict=nomove` (Npc.ts:720); `none` only finishes a walk it has (noMode,
 * Npc.ts:713-715); `patrol` walks the patrol coords (patrolMode, Npc.ts:738-772).
 */
function walk(
    name: string,
    cfg: Config | undefined,
    defaults: MovementDefaults,
    constants: ReadonlyMap<string, Constant>,
): Pick<NpcMovement, 'wander' | 'patrol'> {
    const mode = first(cfg, 'defaultmode') ?? defaults.defaultMode;
    if (mode === 'patrol') {
        const tiles = Object.keys(cfg ?? {})
            .filter(k => /^patrol\d+$/.test(k))
            .map(k => patrolTile(cfg![k]![0]!, constants));
        if (!tiles.length) return { wander: 0 };
        return {
            wander: 0,
            patrol: {
                x1: Math.min(...tiles.map(t => t.x)),
                z1: Math.min(...tiles.map(t => t.z)),
                x2: Math.max(...tiles.map(t => t.x)),
                z2: Math.max(...tiles.map(t => t.z)),
                level: tiles[0]!.level,
            },
        };
    }
    const restrict = first(cfg, 'moverestrict') ?? defaults.moveRestrict;
    if (mode !== 'wander' || restrict === 'nomove') return { wander: 0 };
    return { wander: configInt(cfg, 'wanderrange', defaults.wanderRange.value, name) };
}

// An npc's ai triggers: `[ai_<trigger>,<config>]`, or `[ai_<trigger>,_<category>]` for a category's.
const AI = /^\[(ai_[a-z0-9]+),(_?)([a-z0-9_]+)\]$/;
// What a script calls: a proc (`~name`, `gosub(name)`) or a label (`@name`, `jump(name)`).
const CALL = /~([a-z0-9_]+)|\bgosub\(\s*([a-z0-9_]+)|@([a-z0-9_]+)|\bjump\(\s*([a-z0-9_]+)/g;
// The active npc's own move: `.npc_tele`, the secondary npc's, is not one.
const MOVE = /(?<![\w.])(npc_tele|npc_changetype)\s*\(/g;

interface Script {
    file: string;
    line: number;
    code: string;
}

/**
 * Each config's NpcMovement. `moves` is the first `npc_tele` or `npc_changetype` call (a teleport before a type
 * change) in an ai trigger the engine runs for the config, its own or else its category's, or in a proc or label one
 * calls, by any depth.
 */
export function npcMovements(
    configs: ReadonlyMap<string, Config>,
    scripts: readonly [file: string, text: string][],
    defaults: MovementDefaults,
    constants: ReadonlyMap<string, Constant> = new Map(),
): Map<string, NpcMovement> {
    const triggers = new Map<string, Script>();
    const callables = new Map<string, Script>();
    for (const [file, text] of scripts)
        for (const b of blocks(file, text)) {
            const script = { file, line: b.line, code: codeOf(b.body) };
            const ai = b.header.match(AI);
            if (ai) triggers.set(`${ai[1]},${ai[2]}${ai[3]}`, script);
            const callable = b.header.match(/^\[(proc|label),([a-z0-9_]+)\]$/);
            if (callable) callables.set(`${callable[1] === 'proc' ? '~' : '@'}${callable[2]}`, script);
        }
    const kinds = new Set([...triggers.keys()].map(k => k.slice(0, k.indexOf(','))));

    // The moves of each script and its callees. A result is cached only when whole: one that met a script already on
    // the call stack (cut off, so without that script's moves) is found again from each entry.
    const found = new Map<Script, NpcMove[]>();
    const movesOf = (s: Script, stack: Set<Script>): { moves: NpcMove[]; cut: Set<Script> } => {
        const known = found.get(s);
        if (known) return { moves: known, cut: new Set() };
        if (stack.has(s)) return { moves: [], cut: new Set([s]) };
        stack.add(s);
        const own = [...s.code.matchAll(MOVE)].map(m => ({
            how: m[1] === 'npc_tele' ? ('teleports' as const) : ('changes-type' as const),
            source: `${s.file}:${s.line + s.code.slice(0, m.index).split('\n').length - 1}`,
        }));
        const cut = new Set<Script>();
        const called = [...s.code.matchAll(CALL)].flatMap(m => {
            const proc = m[1] ?? m[2];
            const callee = callables.get(proc ? `~${proc}` : `@${m[3] ?? m[4]}`);
            if (!callee) return [];
            const r = movesOf(callee, stack);
            for (const c of r.cut) cut.add(c);
            return r.moves;
        });
        stack.delete(s);
        // A cut back to s is no loss here: s's own moves are in this result.
        cut.delete(s);
        const moves = [...own, ...called];
        if (cut.size === 0) found.set(s, moves);
        return { moves, cut };
    };

    const out = new Map<string, NpcMovement>();
    for (const [name, cfg] of configs) {
        const category = first(cfg, 'category');
        const moves = [...kinds].sort().flatMap(kind => {
            const s = triggers.get(`${kind},${name}`) ?? (category && triggers.get(`${kind},_${category}`));
            return s ? movesOf(s, new Set()).moves : [];
        });
        const move = moves.find(m => m.how === 'teleports') ?? moves[0];
        out.set(name, {
            ...walk(name, cfg, defaults, constants),
            respawnTicks: configInt(cfg, 'respawnrate', defaults.respawnRate.value, name),
            ...(move ? { moves: move } : {}),
        });
    }
    return out;
}
