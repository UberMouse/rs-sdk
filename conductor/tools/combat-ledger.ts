// A melee run's kills, read from its tick recording: per kill the ticks it took, the npc swings that reached the
// player (hitsplats, zeros included) and their damage, the HP lost and healed, the food eaten. The damage
// calibration (conductor/test/integration/smoke/combat-calibration.itest.ts) sets these beside the world index's model.
//
//   bun conductor/tools/combat-ledger.ts <recording.ticks.ndjson.gz>... --npc Giant [--food Lobster]... [--json]
//
// A kill is an npc of the name the player has hit showing 0 HP (`nearbyNpcs`), whoever's swing finished it: the
// player's swings went into it (a fixture run fights alone). An npc leaving view is forgotten: a later npc of its
// index is another. Two of the player's npcs showing 0 HP in one state are one kill, as the swings and damage since the
// previous kill can't be split between them (a one-target melee run has none). Hitsplats come from the client's
// `combatEvents`, each counted once by its `observationId` (an event without one is refused; a client restart, its
// revisions from 1 again, counts afresh). Only splats on npcs of the name count as the player's swings. A splat on
// the player carries no attacker: the client names the entity the player faces (StateCollector.ts
// collectCombatEvents), and only those it names an npc of the name count, the rest go to `unattributed`; so a poison
// splat, or a second attacker's while the player faces its target, would count (hill giants don't poison, and the
// calibration's profile is over their hunt cutoff). The server sends an npc's HP with its hitsplat in one update
// (server/webclient/src/client/Client.ts:10757-10764), so the killing splat is in the state that shows 0 HP.
//
// A kill's fight runs from the first splat on its npc to its 0 HP: both show a tick after their swing (the swing
// queues the npc's damage, player_melee.rs2:49, which runs in the npc's next turn, npcs going before players:
// World.ts:414-425, Npc.ts:565-579), so it is the ticks from the player's first swing on it to the killing swing, the
// model's KillFigures.fight (wiki/world/model/method.ts), as `gap` and `ticks` are its gap and ticks. A kill is
// `interrupted` when, since the previous kill, the player showed 0 HP, had the bank open or stood over AWAY tiles from
// where it made the kill (a death, a bank trip, a flee): the means leave those out. What follows the last kill (a
// fight the stop cut off) is left out. Several recordings pool their kills; each one's first kill has no `ticks` or
// `gap`.
import { parseArgs } from 'node:util';
import type { BotWorldState } from '../../sdk/types';
import { readRecording, StateDecoder, type Recording } from '../core/drivers/recording';
import { errMessage, exactName } from '../lib/util';

/** Tiles from the kill's tile past which the player has left the fight (the calibration's area has radius 12). */
export const AWAY = 24;

export interface KillRow {
    /** The tick the npc showed 0 HP. */
    tick: number;
    /** Ticks since the previous kill; null for the first kill. */
    ticks: number | null;
    /** Ticks from the previous kill to the first hitsplat on this kill's npc; null for the first kill. */
    gap: number | null;
    /** Ticks from the first hitsplat on this kill's npc to its 0 HP: its first swing to its killing swing. */
    fight: number;
    /** Hitsplats on npcs of the name since the previous kill: the player's swings, misses included. */
    playerSwings: number;
    /** Hitsplats on the player from npcs of the name since the previous kill, misses (0) included. */
    npcSwings: number;
    /** Their damage. */
    damage: number;
    /** HP drops between publications. */
    hpLost: number;
    /** HP rises between publications: food and regeneration. */
    healed: number;
    /** Food objs gone from the inventory. */
    eaten: number;
    /** A death, a bank trip or a flee since the previous kill: out of the means. */
    interrupted: boolean;
}

/** A mean and its standard error (NaN with fewer than two values). */
export interface Mean {
    mean: number;
    se: number;
}

export interface Ledger {
    kills: KillRow[];
    /** The hitsplats on the player in the kills, counted by damage (index 0: misses and zero hits). */
    npcHitsplats: number[];
    /** Hitsplats on the player the client attributes to no npc of the name. */
    unattributed: number;
    /** Per kill, over the kills not interrupted: ticks and gap over those that have them, the rest over all. */
    perKill: {
        kills: number;
        /** The kills interrupted, left out. */
        excluded: number;
        ticks: Mean;
        gap: Mean;
        fight: Mean;
        damage: Mean;
        npcSwings: Mean;
        playerSwings: Mean;
        hpLost: Mean;
        healed: Mean;
        eaten: Mean;
    };
}

export function mean(values: number[]): Mean {
    const n = values.length;
    if (!n) return { mean: NaN, se: NaN };
    const m = values.reduce((a, b) => a + b, 0) / n;
    if (n < 2) return { mean: m, se: NaN };
    const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
    return { mean: m, se: Math.sqrt(variance / n) };
}

export interface LedgerOptions {
    /** The npc's name (exact, case-insensitive). */
    npc: string;
    /** Inventory names of the food eaten. */
    food?: string[];
}

type Tally = Pick<KillRow, 'playerSwings' | 'npcSwings' | 'damage' | 'hpLost' | 'healed' | 'eaten'>;
const blank = (): Tally => ({ playerSwings: 0, npcSwings: 0, damage: 0, hpLost: 0, healed: 0, eaten: 0 });

/** The kills in `states`, in publication order. */
export function combatLedger(states: Iterable<BotWorldState>, o: LedgerOptions): Ledger {
    const name = exactName(o.npc);
    const food = (o.food ?? []).map(exactName);
    const kills: KillRow[] = [];
    const splats: number[] = [];
    let unattributed = 0;
    let open = blank();
    let openSplats: number[] = [];
    /** Where the player stood since the previous kill, and whether it showed 0 HP or had the bank open. */
    let tiles: { level: number; x: number; z: number }[] = [];
    let downOrBanked = false;
    /** The npcs in view the player has hit since they last showed HP above 0, by index: the tick of the first splat. */
    const hit = new Map<number, number>();
    /** The npcs in view seen at 0 HP since. */
    const dead = new Set<number>();
    let seen = 0;
    let revision: number | undefined;
    let hp: number | undefined;
    let foodCount: number | undefined;
    for (const s of states) {
        // A client restart publishes from revision 1 again, and its events' ids with it.
        if (s.revision !== undefined && revision !== undefined && s.revision < revision) seen = 0;
        revision = s.revision ?? revision;
        const inView = new Set<number>();
        for (const npc of s.nearbyNpcs ?? []) if (name.test(npc.name)) inView.add(npc.index);
        for (const i of hit.keys()) if (!inView.has(i)) hit.delete(i);
        for (const i of dead) if (!inView.has(i)) dead.delete(i);
        const events = s.combatEvents ?? [];
        for (const e of events) {
            if (e.observationId === undefined)
                throw new Error(`a combat event at tick ${e.tick} has no observationId: it can't be counted once`);
            if (e.observationId <= seen) continue;
            if (e.targetType === 'player') {
                if (e.sourceType !== 'npc' || !inView.has(e.sourceIndex)) {
                    unattributed++;
                    continue;
                }
                open.npcSwings++;
                open.damage += e.damage;
                openSplats.push(e.damage);
            } else if (e.targetType === 'npc' && inView.has(e.targetIndex)) {
                // A splat on an npc seen dead is on its next life.
                dead.delete(e.targetIndex);
                open.playerSwings++;
                if (!hit.has(e.targetIndex)) hit.set(e.targetIndex, e.tick);
            }
        }
        for (const e of events) seen = Math.max(seen, e.observationId!);
        const now = s.player?.hp;
        if (now !== undefined && hp !== undefined) {
            if (now < hp) open.hpLost += hp - now;
            else open.healed += now - hp;
        }
        if (now !== undefined) hp = now;
        if (now === 0 || s.bank?.isOpen) downOrBanked = true;
        if (s.player) tiles.push({ level: s.player.level, x: s.player.worldX, z: s.player.worldZ });
        const count = s.inventory.filter(i => food.some(f => f.test(i.name))).reduce((t, i) => t + i.count, 0);
        if (foodCount !== undefined && count < foodCount) open.eaten += foodCount - count;
        foodCount = count;
        let killed = false;
        for (const npc of s.nearbyNpcs ?? []) {
            if (!inView.has(npc.index) || npc.hp === null) continue;
            if (npc.hp > 0) {
                dead.delete(npc.index);
                continue;
            }
            if (dead.has(npc.index)) continue;
            dead.add(npc.index);
            const first = hit.get(npc.index);
            hit.delete(npc.index);
            if (first === undefined || killed) continue;
            killed = true;
            const prev = kills.at(-1);
            const here = tiles.at(-1);
            const away = tiles.some(
                t => !here || t.level !== here.level || Math.max(Math.abs(t.x - here.x), Math.abs(t.z - here.z)) > AWAY,
            );
            kills.push({
                tick: s.tick,
                ticks: prev ? s.tick - prev.tick : null,
                gap: prev ? first - prev.tick : null,
                fight: s.tick - first,
                ...open,
                interrupted: downOrBanked || away,
            });
            for (const d of openSplats) splats[d] = (splats[d] ?? 0) + 1;
            open = blank();
            openSplats = [];
            tiles = here ? [here] : [];
            downOrBanked = false;
        }
    }
    return summarise(
        kills,
        Array.from(splats, n => n ?? 0),
        unattributed,
    );
}

function summarise(kills: KillRow[], npcHitsplats: number[], unattributed: number): Ledger {
    const kept = kills.filter(k => !k.interrupted);
    const of = (f: (k: KillRow) => number | null) => mean(kept.map(f).filter((v): v is number => v !== null));
    return {
        kills,
        npcHitsplats,
        unattributed,
        perKill: {
            kills: kept.length,
            excluded: kills.length - kept.length,
            ticks: of(k => k.ticks),
            gap: of(k => k.gap),
            fight: of(k => k.fight),
            damage: of(k => k.damage),
            npcSwings: of(k => k.npcSwings),
            playerSwings: of(k => k.playerSwings),
            hpLost: of(k => k.hpLost),
            healed: of(k => k.healed),
            eaten: of(k => k.eaten),
        },
    };
}

/** Several runs' ledgers as one: their kills in order, their hitsplats summed. */
export function poolLedgers(ledgers: Ledger[]): Ledger {
    const splats: number[] = [];
    for (const l of ledgers) l.npcHitsplats.forEach((n, d) => (splats[d] = (splats[d] ?? 0) + n));
    return summarise(
        ledgers.flatMap(l => l.kills),
        Array.from(splats, n => n ?? 0),
        ledgers.reduce((t, l) => t + l.unattributed, 0),
    );
}

/** The states a recording's publications decode to, in order. */
export function* recordedStates(recording: Recording): Generator<BotWorldState> {
    const decoder = new StateDecoder();
    for (const rec of recording.records) if (rec.k === 'p') yield decoder.decode(rec.d, rec.x);
}

/** The ledger of the run recorded in `file`. */
export const recordingLedger = (file: string, o: LedgerOptions): Ledger =>
    combatLedger(recordedStates(readRecording(file)), o);

if (import.meta.main) {
    const usage =
        'usage: bun conductor/tools/combat-ledger.ts <recording.ticks.ndjson.gz>... --npc <name> [--food <name>]... [--json]';
    try {
        const { values, positionals } = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                npc: { type: 'string' },
                food: { type: 'string', multiple: true },
                json: { type: 'boolean' },
            },
        });
        if (!positionals.length || !values.npc) throw new Error('missing arguments');
        const o = { npc: values.npc, food: values.food ?? [] };
        const ledger = poolLedgers(positionals.map(f => recordingLedger(f, o)));
        if (values.json) console.log(JSON.stringify(ledger));
        else {
            for (const k of ledger.kills) console.log(JSON.stringify(k));
            const { npcHitsplats, unattributed, perKill } = ledger;
            console.log(JSON.stringify({ npcHitsplats, unattributed, ...perKill }));
        }
    } catch (e) {
        console.error(`combat-ledger: ${errMessage(e)}\n${usage}`);
        process.exit(2);
    }
}
