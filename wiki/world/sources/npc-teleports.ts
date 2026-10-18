// Npc teleports to a coord drawn from an enum, and the loc that sends the player back (gates.ts NPC_TELEPORTS): the
// essence mine. An npc op trigger whose whole body is `@<label>(^<coord>)` jumps to the label, which checks its
// requirement, keeps the coord in a varp, and jumps to `map_findsquare` round a coord drawn from the enum at random;
// the back trigger jumps to `map_findsquare` round the varp's coord. The npcs, their ops and the coords they pass come
// from those triggers and the constants, the landings from the enum and the rings' lines; an entry names the label,
// the enum, the requirement and the lines. Each spawn cluster of a caller's npc gets one World.crossings row, done
// from the tiles beside the cluster (place.ts besideCluster) on land. The back move goes where the varp says, which
// no stateless edge can follow: each placed loc of the back trigger gets a row per caller's npc, landing round the
// coord that npc passes, under `other:came from <npc>` (requirements.ts cameFrom), which only a way that came in by
// that npc's op meets. A way that came in by it met what got it to the npc's teleport too, so the build joins that to
// the way back (joinWaysIn): a fill does not take the portal to Distentor, inside the Magic Guild, without 66 Magic. A
// cluster or loc no tile on land is used from gets no row, nor does one whose every landing is off walkable land, nor
// a way back to an npc no walk gets to the teleport of; the build report lists each, and each landing left out.
import { besideCluster, reachTiles, type Placed, type PlacedLoc, type SiteOptions, type StepCollision } from '../place';
import type { Reach } from '../reach';
import { CAME_FROM, cameFrom, minimalSets, requirementSet, type QuestFacts } from '../requirements';
import type { Crossing, NpcSpawn, Quest, Tile } from '../types';
import { byTile, cmp, onLandIn, uniqueTiles } from '../util';
import { first, type Config } from './configs';
import { constantInt, type Constant } from './constants';
import { findsquareTiles, type TeleportCollision } from './dbrow-teleports';
import { triggerConfigs, triggerKey } from './gate-scan';
import { isCoordLiteral } from './runescript';
import type { Callable, Trigger } from './triggers';

/** An npc teleport to an enum's coords, and the loc trigger back (the header comment). */
export interface NpcTeleport {
    /** The label the npcs' op triggers jump to, without its `@`: `teleport_to_essence_mine`. */
    label: string;
    /** How the move is priced (distance.ts CROSSING_TICKS). */
    via: Crossing['via'];
    /** The enum of coords the label draws from: `enum(int, coord, <enum>, random(enum_getoutputcount(<enum>)))`. */
    enum: string;
    /** What the label checks before the move, and the line it checks it on, which names each quest's varp. */
    requires: readonly string[];
    checkedAt: string;
    /** The label's `map_findsquare` line round the drawn coord, and the `p_telejump` line, as `file:line`. */
    ring: string;
    source: string;
    /**
     * The loc trigger that sends the player back to the coord the label was passed, which the label keeps in
     * `%<varp>`: its `map_findsquare` line round the varp, and its `p_telejump` line.
     */
    back: { trigger: string; via: Crossing['via']; varp: string; ring: string; source: string };
}

export interface NpcTeleportInput {
    entries: readonly NpcTeleport[];
    triggers: readonly Trigger[];
    callables: readonly Callable[];
    /** Script text by file, to read the entries' lines. */
    scripts: ReadonlyMap<string, string>;
    constants: ReadonlyMap<string, Constant>;
    enums: ReadonlyMap<string, Config>;
    npcConfigs: ReadonlyMap<string, Config>;
    locConfigs: ReadonlyMap<string, Config>;
    quests: readonly Pick<Quest, 'id' | 'varp'>[];
    /** Every npc spawn cluster (place.ts spawnClusters). */
    spawns: readonly Pick<Placed<NpcSpawn>, 'config' | 'centre' | 'bbox'>[];
    /** Every placed loc. */
    locs: readonly PlacedLoc[];
    collision: TeleportCollision & StepCollision;
    size: SiteOptions['size'];
}

/** A spawn cluster or placed loc no tile on land is used from, given no row: its npc or loc config and tile. */
export interface NpcTeleportMiss {
    trigger: string;
    config: string;
    tile: Tile;
}

/** A landing off walkable land, left out of its row. */
export interface NpcTeleportOffLand extends NpcTeleportMiss {
    landing: Tile;
}

export interface NpcTeleports {
    /** World.crossings rows: by entry, the npcs' rows by config, then the back rows by loc tile and npc. */
    crossings: Crossing[];
    unstood: NpcTeleportMiss[];
    offLand: NpcTeleportOffLand[];
}

const escape = (s: string): string => s.replace(/[$^]/g, '\\$&');

/** The World.crossings rows of gates.ts NPC_TELEPORTS (the header comment). Throws on an entry the data refutes. */
export function deriveNpcTeleports(input: NpcTeleportInput): NpcTeleports {
    const { collision, size } = input;
    const onLand = onLandIn(collision);
    const crossings: Crossing[] = [];
    const unstood: NpcTeleportMiss[] = [];
    const offLand: NpcTeleportOffLand[] = [];
    for (const e of input.entries) {
        const fail = (why: string) => new Error(`gates.ts NPC_TELEPORTS @${e.label} (${e.source}): ${why}`);
        /** The text of a `file:line` in the block (a label or trigger) `b`, or a failure. */
        const lineIn = (at: string, b: Pick<Callable, 'file' | 'line' | 'body'>, what: string): string => {
            const [file, n] = at.split(':');
            const k = Number(n) - b.line;
            if (file !== b.file || !(k >= 0 && k < b.body.split('\n').length))
                throw fail(`${what} ${at} is not in ${b.file}:${b.line}`);
            return input.scripts.get(file)!.split('\n')[Number(n) - 1]!;
        };
        /**
         * The `$<into> = map_findsquare(<arg>, <min>, <max>, <type>)` of a line: the local it sets, its arg, and its
         * ring with the type's value.
         */
        const ringOf = (text: string, at: string): { into: string; arg: string; ring: string[] } => {
            const m = text.match(
                /(\$[a-z0-9_]+)\s*=\s*map_findsquare\s*\(\s*([$%][a-z0-9_]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\^[a-z0-9_]+)\s*\)/,
            );
            const type = m && constantInt(input.constants, m[5]!);
            if (!m || type === undefined)
                throw fail(`${at} has no $<local> = map_findsquare(<var>, <min>, <max>, ^<type>)`);
            return { into: m[1]!, arg: m[2]!, ring: [m[3]!, m[4]!, String(type)] };
        };
        /** Fails unless the `file:line` `at` of block `b` is `p_telejump(<local>)`, the ring's result. */
        const jumpsTo = (at: string, b: Pick<Callable, 'file' | 'line' | 'body'>, local: string, what: string) => {
            if (!new RegExp(`\\bp_telejump\\s*\\(\\s*${escape(local)}\\s*\\)`).test(lineIn(at, b, what)))
                throw fail(`${at} is not a p_telejump(${local})`);
        };
        /** The tiles a ring round `literal` can give, each once, and those of them on walkable land. */
        const land = (literal: string, ring: string[]): { all: Tile[]; on: Tile[] } => {
            let tiles: Tile[];
            try {
                tiles = findsquareTiles([literal, ...ring], collision);
            } catch (err) {
                throw fail((err as Error).message);
            }
            const all = uniqueTiles(tiles);
            return { all, on: all.filter(onLand) };
        };

        const label = input.callables.find(c => c.call === `@${e.label}`);
        if (!label) throw fail('no such label');
        // The label's coord parameter, kept in the varp the back trigger reads.
        const param = label.body.match(/^\(\s*coord\s+(\$[a-z0-9_]+)\s*\)/)?.[1];
        if (!param) throw fail('the label takes no one coord parameter');
        if (!new RegExp(`%${e.back.varp}\\s*=\\s*${escape(param)}\\b`).test(label.body))
            throw fail(`the label does not set %${e.back.varp} to ${param}`);
        const ring = ringOf(lineIn(e.ring, label, 'the ring'), e.ring);
        jumpsTo(e.source, label, ring.into, 'the jump');
        const draw = `${escape(ring.arg)}\\s*=\\s*enum\\(\\s*int\\s*,\\s*coord\\s*,\\s*${e.enum}\\s*,\\s*random\\(\\s*enum_getoutputcount\\(\\s*${e.enum}\\s*\\)\\s*\\)\\s*\\)`;
        if (!new RegExp(draw).test(label.body)) throw fail(`the label does not draw ${ring.arg} from ${e.enum}`);
        const checked = lineIn(e.checkedAt, label, 'the check');
        for (const r of e.requires) {
            const id = r.match(/^quest:([a-z0-9_]+)/)?.[1];
            if (!id) continue;
            const q = input.quests.find(x => x.id === id);
            if (!q) throw fail(`no quest ${id}`);
            if (!new RegExp(`%${q.varp}\\b`).test(checked)) throw fail(`${e.checkedAt} does not read %${q.varp}`);
        }
        const requires = [requirementSet(e.requires)];
        const cfg = input.enums.get(e.enum);
        if (!cfg) throw fail(`no such enum ${e.enum}`);
        if (first(cfg, 'outputtype') !== 'coord') throw fail(`enum ${e.enum} does not give coords`);
        const coords = (cfg.val ?? []).map(v => v.slice(v.indexOf(',') + 1));
        if (!coords.length || !coords.every(isCoordLiteral)) throw fail(`enum ${e.enum} has no coords, or a non-coord`);
        const drawn = uniqueTiles(coords.flatMap(c => land(c, ring.ring).all));
        const landings = drawn.filter(onLand);

        // The npc op triggers that jump to the label and nothing else, with the coord constant they pass.
        const call = new RegExp(`^\\s*@${e.label}\\s*\\(\\s*(\\^[a-z0-9_]+)\\s*\\)\\s*;?\\s*$`);
        const callers = input.triggers.flatMap(t => {
            const passed = t.body.replace(/\/\/.*$/gm, '').match(call)?.[1];
            if (t.on !== 'npc' || t.kind !== 'op' || t.op === 'u' || !passed) return [];
            if (t.category) throw fail(`${triggerKey(t)} is a category trigger, which is not read`);
            if (first(input.npcConfigs.get(t.target), `op${t.op}`) === undefined) return [];
            const literal = input.constants.get(passed)?.value;
            if (!literal || !isCoordLiteral(literal)) throw fail(`${triggerKey(t)} passes ${passed}, no coord`);
            return [{ trigger: t, npc: t.target, passed, back: literal }];
        });
        if (!callers.length) throw fail('no npc op trigger jumps to it');
        callers.sort((a, b) => cmp(a.npc, b.npc) || cmp(a.trigger.op, b.trigger.op));
        // One way back per npc, as the back trigger reads one coord for the npc: two of its ops passing different
        // coords would need a way back each, and are refused.
        const backOf = new Map<string, { passed: string; back: string }>();
        for (const c of callers) {
            const seen = backOf.get(c.npc);
            if (seen && seen.back !== c.back) throw fail(`${c.npc}'s ops pass ${seen.passed} and ${c.passed}`);
            backOf.set(c.npc, c);
        }
        for (const { trigger, npc } of callers) {
            const clusters = input.spawns.filter(s => s.config === npc);
            if (!clusters.length) throw fail(`${npc} has no spawn`);
            for (const c of clusters) {
                const miss = { trigger: triggerKey(trigger), config: npc, tile: c.centre };
                for (const t of drawn) if (!onLand(t)) offLand.push({ ...miss, landing: t });
                const from = besideCluster(c, collision).filter(onLand).sort(byTile);
                if (!from.length) unstood.push(miss);
                if (!from.length || !landings.length) continue;
                crossings.push({
                    via: e.via,
                    act: { kind: 'npc-op', npc, op: Number(trigger.op) },
                    at: c.centre,
                    from,
                    landings: landings.map(tile => ({ tile })),
                    requires,
                    source: e.source,
                });
            }
        }

        const back = input.triggers.find(t => triggerKey(t) === e.back.trigger);
        if (!back || back.on !== 'loc' || back.op === 'u') throw fail(`no loc op trigger ${e.back.trigger}`);
        const backBlock = { file: back.file, line: back.line, body: back.body };
        const backRing = ringOf(lineIn(e.back.ring, backBlock, 'the ring back'), e.back.ring);
        jumpsTo(e.back.source, backBlock, backRing.into, 'the jump back');
        if (backRing.arg !== `%${e.back.varp}`) throw fail(`${e.back.ring} rings ${backRing.arg}, not %${e.back.varp}`);
        const covered = new Set(triggerConfigs(input.triggers, input.locConfigs)(back));
        const placed = input.locs
            .filter(l => covered.has(l.config))
            .sort((a, b) => byTile(a.tile, b.tile) || cmp(a.config, b.config));
        if (!placed.length) throw fail(`no placed loc of a config ${e.back.trigger} covers`);
        const ways = [...backOf].map(([npc, { back: coord }]) => [npc, land(coord, backRing.ring)] as const);
        for (const l of placed) {
            const miss = { trigger: e.back.trigger, config: l.config, tile: l.tile };
            const from = reachTiles(l, collision, size)
                .filter(t => collision.land(t.level, t.x, t.z))
                .sort(byTile);
            if (!from.length) unstood.push(miss);
            for (const [npc, { all, on }] of ways) {
                for (const t of all) if (!onLand(t)) offLand.push({ ...miss, landing: t });
                if (!from.length || !on.length) continue;
                crossings.push({
                    via: e.back.via,
                    act: { kind: 'loc-op', loc: l.config, op: Number(back.op) },
                    at: l.tile,
                    from,
                    landings: on.map(tile => ({ tile })),
                    requires: [[cameFrom(npc)]],
                    source: e.back.source,
                });
            }
        }
    }
    return { crossings, unstood, offLand };
}

/** The npc a came-from row returns to (its first set's came-from requirement), or undefined for another row. */
export const returnsTo = (c: Crossing): string | undefined =>
    c.requires[0]?.find(r => r.startsWith(CAME_FROM))?.slice(CAME_FROM.length);

/**
 * The rows with each way back asking what got the way in (the header comment): a came-from row's sets are its npc's
 * teleport's, each set that `fill` (a fill over the rows without the ways back) gets to a tile the teleport row is done
 * from, joined with one of the row's own and the came-from requirement. A way back to an npc no set gets to is left
 * out, and returned as `unjoined` for the build report. Every other row is as it was.
 */
export function joinWaysIn(
    crossings: readonly Crossing[],
    fill: Pick<Reach, 'setsAny'>,
    quests?: QuestFacts,
): { crossings: Crossing[]; unjoined: Crossing[] } {
    const ways = new Map<string, string[][]>();
    const wayIn = (npc: string): string[][] => {
        let sets = ways.get(npc);
        if (!sets) {
            sets = minimalSets(
                crossings
                    .filter(c => c.act.kind === 'npc-op' && c.act.npc === npc)
                    .flatMap(c =>
                        fill
                            .setsAny(c.from)
                            // `members` is met: a teleport row's own set may hold it, but reach.ts drops it from
                            // every set (SetTable.intern).
                            .flatMap(s =>
                                c.requires.map(r => [...s, ...r, cameFrom(npc)].filter(x => x !== 'members')),
                            ),
                    ),
                quests,
            );
            ways.set(npc, sets);
        }
        return sets;
    };
    const unjoined: Crossing[] = [];
    const joined = crossings.flatMap(c => {
        const npc = returnsTo(c);
        if (npc === undefined) return [c];
        const requires = wayIn(npc);
        if (!requires.length) unjoined.push(c);
        return requires.length ? [{ ...c, requires }] : [];
    });
    return { crossings: joined, unjoined };
}

/**
 * The requirement context of a site's reach set, for its nearest sinks (distance.ts NearestOptions.context): the set
 * and every came-from requirement of the rows. A way back asks what got the way in to its npc too (joinWaysIn), so a
 * context admits the way back to npc B whenever its set meets B's way in, whatever npc the site's own way came in
 * by: a way in by A and out by B's portal is admitted too. That is sound where a player who meets B's way in can
 * come in by B instead, as at the mine's sites, reached with Rune Mysteries: the portals to the wizards a walk gets
 * to are admitted, the one to Distentor in the Magic Guild not without 66 Magic. For a site outside the mine it is
 * not: its way could go in by one wizard and out to another's exit. Such a way takes a wizard's teleport, which asks
 * the quest, and only the mine's sites are reached with it today; npc-teleports.real.test.ts pins that no nearest
 * way outside the mine takes a portal.
 */
export function cameFromContext(crossings: readonly Crossing[]): (set: readonly string[]) => string[] {
    const tokens = [
        ...new Set(
            crossings.flatMap(c => {
                const npc = returnsTo(c);
                return npc === undefined ? [] : [cameFrom(npc)];
            }),
        ),
    ];
    return set => requirementSet([...set, ...tokens]);
}
