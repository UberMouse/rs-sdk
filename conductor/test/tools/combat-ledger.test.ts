// combat-ledger.ts on scripted states: two kills, each an npc the player hit showing 0 HP; the hitsplats on each side
// split between them (each event counted once, though every later state repeats it), a killing splat shown after the
// death kept with its kill, a respawn reusing a dead npc's index, a giant someone else killed, HP and food deltas, and
// the fight cut off after the last kill left out; and two runs pooled.
import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent } from '../../../sdk/types';
import { combatLedger, mean, poolLedgers } from '../../tools/combat-ledger';

interface Step {
    tick: number;
    hp?: number;
    lobsters?: number;
    /** The giants in view from this step on, by index: their HP, or null while the server has not sent it. */
    giants?: [index: number, hp: number | null][];
    /** A hitsplat on the player, or on the giant of an index, of this damage. */
    splat?: ['player' | number, number];
}

/** The states of `steps`, each carrying every event so far (as the client's window does), stamped by revision. */
function states(steps: Step[]): BotWorldState[] {
    const events: CombatEvent[] = [];
    let hp = 60;
    let lobsters = 2;
    let giants: [number, number | null][] = [];
    return steps.map((s, i) => {
        hp = s.hp ?? hp;
        lobsters = s.lobsters ?? lobsters;
        giants = s.giants ?? giants;
        if (s.splat) {
            const [target, damage] = s.splat;
            const onPlayer = target === 'player';
            events.push({
                tick: s.tick,
                observationId: i + 1,
                type: onPlayer ? 'damage_taken' : 'damage_dealt',
                damage,
                sourceType: onPlayer ? 'npc' : 'player',
                sourceIndex: -1,
                targetType: onPlayer ? 'player' : 'npc',
                targetIndex: onPlayer ? -1 : target,
            });
        }
        return {
            tick: s.tick,
            revision: i + 1,
            player: { hp },
            inventory: Array.from({ length: lobsters }, () => ({ name: 'Lobster', count: 1 })),
            nearbyNpcs: giants.map(([index, npcHp]) => ({ name: 'Giant', index, hp: npcHp })),
            combatEvents: [...events],
        } as unknown as BotWorldState;
    });
}

const run = states([
    { tick: 100, giants: [[7, 35]] },
    { tick: 102, splat: [7, 5] },
    { tick: 104, splat: ['player', 3], hp: 57 },
    // Giant 7 dies; its killing splat shows a tick later.
    { tick: 106, giants: [[7, 0]] },
    { tick: 107, splat: [7, 4] },
    { tick: 108, hp: 69, lobsters: 1, giants: [[8, 35]] },
    { tick: 110, splat: [8, 0] },
    { tick: 111, splat: ['player', 0] },
    // A giant someone else killed is no kill of the player's.
    {
        tick: 112,
        splat: ['player', 2],
        hp: 67,
        giants: [
            [8, 35],
            [9, 0],
        ],
    },
    { tick: 116, splat: [8, 9], giants: [[8, 0]] },
    // Giant 7's index again, a respawn: the fight the stop cut off.
    { tick: 118, splat: [7, 3], giants: [[7, null]] },
    { tick: 119, splat: ['player', 1], hp: 66 },
]);

describe('combatLedger', () => {
    const ledger = combatLedger(run, { npc: 'Giant', food: ['Lobster'] });

    test('each kill: its ticks, gap, fight, swings, damage, HP and food', () => {
        expect(ledger.kills).toEqual([
            {
                tick: 106,
                ticks: null,
                gap: null,
                fight: 4,
                playerSwings: 2,
                npcSwings: 1,
                damage: 3,
                hpLost: 3,
                healed: 0,
                eaten: 0,
            },
            {
                tick: 116,
                ticks: 10,
                // From giant 7's death at 106 to the first splat on giant 8 at 110.
                gap: 4,
                fight: 6,
                playerSwings: 2,
                npcSwings: 2,
                damage: 2,
                hpLost: 2,
                healed: 12,
                eaten: 1,
            },
        ]);
    });

    test('the hitsplats on the player by damage, and the means a kill', () => {
        expect(ledger.npcHitsplats).toEqual([1, 0, 1, 1]);
        expect(ledger.perKill.kills).toBe(2);
        expect(ledger.perKill.ticks).toEqual({ mean: 10, se: 0 });
        // Damage 3 and 2: mean 2.5, sample sd sqrt(0.5), se sqrt(0.5 / 2) = 0.5.
        expect(ledger.perKill.damage.mean).toBe(2.5);
        expect(ledger.perKill.damage.se).toBeCloseTo(0.5, 12);
    });

    test('another name kills nothing', () => {
        expect(combatLedger(run, { npc: 'Moss giant' }).kills).toEqual([]);
    });

    test('two runs pooled: their kills, the hitsplats summed', () => {
        const pooled = poolLedgers([ledger, ledger]);
        expect(pooled.perKill.kills).toBe(4);
        expect(pooled.npcHitsplats).toEqual([2, 0, 2, 2]);
        // Each run's first kill has no ticks: 10 and 10.
        expect(pooled.perKill.ticks).toEqual({ mean: 10, se: 0 });
    });
});

describe('mean', () => {
    test('none is NaN; one has no standard error', () => {
        expect(mean([])).toEqual({ mean: NaN, se: NaN });
        expect(mean([4])).toEqual({ mean: 4, se: 0 });
    });
});
