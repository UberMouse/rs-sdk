// A melee run's kills, read from its tick recording: per kill the ticks it took, the npc swings that reached the
// player (hitsplats, zeros included) and their damage, the HP lost and healed, the food eaten. The damage
// calibration (conductor/test/integration/smoke/combat-calibration.itest.ts) sets these beside the world index's model.
//
//   bun conductor/tools/combat-ledger.ts <recording.ticks.ndjson.gz>... --npc Giant [--food Lobster]... [--json]
//
// A kill is an npc of the name the player has hit showing 0 HP (`nearbyNpcs`). Hitsplats come from the client's
// `combatEvents`, each counted once by its `observationId`; the player's swings are timed by their hitsplats on the
// npc, each shown the same few ticks after its swing. What follows the last kill (a fight the stop cut off) is left
// out. Several recordings pool their kills; each one's first kill has no `ticks` or `gap`.
import { parseArgs } from 'node:util';
import type { BotWorldState } from '../../sdk/types';
import { readRecording, StateDecoder, type Recording } from '../core/drivers/recording';
import { errMessage, exactName } from '../lib/util';

export interface KillRow {
    /** The tick the npc showed 0 HP. */
    tick: number;
    /** Ticks since the previous kill; null for the first kill. */
    ticks: number | null;
    /** Ticks from the previous kill to this kill's first hitsplat on an npc; null for the first kill. */
    gap: number | null;
    /** Ticks from this kill's first hitsplat on an npc to the npc's 0 HP. */
    fight: number;
    /** Hitsplats on an npc since the previous kill: the player's swings, misses included. */
    playerSwings: number;
    /** Hitsplats on the player since the previous kill: the swings that reached it, misses (0) included. */
    npcSwings: number;
    /** Their damage. */
    damage: number;
    /** HP drops between publications. */
    hpLost: number;
    /** HP rises between publications: food and regeneration. */
    healed: number;
    /** Food objs gone from the inventory. */
    eaten: number;
}

/** A mean and its standard error (0 with fewer than two values). */
export interface Mean {
    mean: number;
    se: number;
}

export interface Ledger {
    kills: KillRow[];
    /** The hitsplats on the player in the kills, counted by damage (index 0: misses and zero hits). */
    npcHitsplats: number[];
    /** Per kill: ticks and gap over the kills that have them, the rest over every kill. */
    perKill: {
        kills: number;
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
    if (n < 2) return { mean: m, se: 0 };
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
    let open = blank();
    let openSplats: number[] = [];
    let firstSplat: number | null = null;
    /** Npc indexes the player has hit since they last showed HP above 0, and those seen dead since. */
    const hit = new Set<number>();
    const dead = new Set<number>();
    let seen = 0;
    let hp: number | undefined;
    let foodCount: number | undefined;
    for (const s of states) {
        for (const e of s.combatEvents ?? []) {
            if ((e.observationId ?? 0) <= seen) continue;
            if (e.targetType === 'player') {
                open.npcSwings++;
                open.damage += e.damage;
                openSplats.push(e.damage);
            } else if (e.targetType === 'npc') {
                // A splat on an npc counted dead a tick before at most is the killing swing's, shown late: that
                // kill's. Later, the index is a respawn (its HP shows null until the server updates it).
                const last = kills.at(-1);
                if (last && dead.has(e.targetIndex) && e.tick <= last.tick + 1) last.playerSwings++;
                else {
                    dead.delete(e.targetIndex);
                    open.playerSwings++;
                    firstSplat ??= e.tick;
                    hit.add(e.targetIndex);
                }
            }
        }
        for (const e of s.combatEvents ?? []) seen = Math.max(seen, e.observationId ?? 0);
        const now = s.player?.hp;
        if (now !== undefined && hp !== undefined) {
            if (now < hp) open.hpLost += hp - now;
            else open.healed += now - hp;
        }
        if (now !== undefined) hp = now;
        const count = s.inventory.filter(i => food.some(f => f.test(i.name))).reduce((t, i) => t + i.count, 0);
        if (foodCount !== undefined && count < foodCount) open.eaten += foodCount - count;
        foodCount = count;
        for (const npc of s.nearbyNpcs ?? []) {
            if (!name.test(npc.name) || npc.hp === null) continue;
            if (npc.hp > 0) {
                dead.delete(npc.index);
                continue;
            }
            if (dead.has(npc.index) || !hit.has(npc.index) || firstSplat === null) continue;
            dead.add(npc.index);
            hit.delete(npc.index);
            const prev = kills.at(-1);
            kills.push({
                tick: s.tick,
                ticks: prev ? s.tick - prev.tick : null,
                gap: prev ? firstSplat - prev.tick : null,
                fight: s.tick - firstSplat,
                ...open,
            });
            for (const d of openSplats) splats[d] = (splats[d] ?? 0) + 1;
            open = blank();
            openSplats = [];
            firstSplat = null;
        }
    }
    return summarise(
        kills,
        Array.from(splats, n => n ?? 0),
    );
}

function summarise(kills: KillRow[], npcHitsplats: number[]): Ledger {
    const of = (f: (k: KillRow) => number | null) => mean(kills.map(f).filter((v): v is number => v !== null));
    return {
        kills,
        npcHitsplats,
        perKill: {
            kills: kills.length,
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
            console.log(JSON.stringify({ npcHitsplats: ledger.npcHitsplats, ...ledger.perKill }));
        }
    } catch (e) {
        console.error(`combat-ledger: ${errMessage(e)}\n${usage}`);
        process.exit(2);
    }
}
