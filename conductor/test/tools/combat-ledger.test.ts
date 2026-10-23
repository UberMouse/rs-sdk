// combat-ledger.ts on scripted states: two kills, each an npc the player hit showing 0 HP; the hitsplats on each side
// split between them (each event counted once, though every later state repeats it), a respawn reusing a dead npc's
// index, a giant someone else killed, HP and food deltas, and the fight cut off after the last kill left out; splats
// on another npc, two giants at 0 HP in one state, an npc that left view, splats on the player from no giant, a kill
// after a death, a bank trip or a flee, events without an id and a client restart; and two runs pooled.
import { describe, expect, test } from 'bun:test';
import type { BotWorldState, CombatEvent } from '../../../sdk/types';
import { AWAY, combatLedger, mean, poolLedgers } from '../../tools/combat-ledger';

interface Step {
    tick: number;
    hp?: number;
    lobsters?: number;
    /** The player's x from this step on. */
    x?: number;
    bank?: boolean;
    /** The giants in view from this step on, by index: their HP, or null while the server has not sent it. */
    giants?: [index: number, hp: number | null][];
    /** A moss giant, index 3, in view from this step on. */
    moss?: boolean;
    /** A hitsplat on the player (the index of the npc it faces, -1 for none), or on the giant of an index. */
    splat?: ['player', damage: number, faced: number] | [index: number, damage: number];
}

/** The states of `steps`, each carrying every event so far (as the client's window does), stamped by revision. */
function states(steps: Step[]): BotWorldState[] {
    const events: CombatEvent[] = [];
    let hp = 60;
    let lobsters = 2;
    let x = 3113;
    let giants: [number, number | null][] = [];
    let moss = false;
    return steps.map((s, i) => {
        hp = s.hp ?? hp;
        lobsters = s.lobsters ?? lobsters;
        x = s.x ?? x;
        giants = s.giants ?? giants;
        moss = s.moss ?? moss;
        if (s.splat) {
            const [target, damage, faced] = s.splat;
            const onPlayer = target === 'player';
            events.push({
                tick: s.tick,
                observationId: i + 1,
                type: onPlayer ? 'damage_taken' : 'damage_dealt',
                damage,
                sourceType: onPlayer ? 'npc' : 'player',
                sourceIndex: onPlayer ? faced! : -1,
                targetType: onPlayer ? 'player' : 'npc',
                targetIndex: onPlayer ? -1 : target,
            });
        }
        return {
            tick: s.tick,
            revision: i + 1,
            player: { hp, level: 0, worldX: x, worldZ: 9840 },
            bank: { isOpen: s.bank ?? false },
            inventory: Array.from({ length: lobsters }, () => ({ name: 'Lobster', count: 1 })),
            nearbyNpcs: [
                ...giants.map(([index, npcHp]) => ({ name: 'Giant', index, hp: npcHp })),
                ...(moss ? [{ name: 'Moss giant', index: 3, hp: 20 }] : []),
            ],
            combatEvents: [...events],
        } as unknown as BotWorldState;
    });
}

const runSteps: Step[] = [
    { tick: 100, giants: [[7, 35]] },
    { tick: 102, splat: [7, 5] },
    { tick: 104, splat: ['player', 3, 7], hp: 57 },
    // Giant 7's killing splat, shown with its 0 HP.
    { tick: 106, splat: [7, 4], giants: [[7, 0]] },
    { tick: 108, hp: 69, lobsters: 1, giants: [[8, 35]] },
    { tick: 110, splat: [8, 0] },
    { tick: 111, splat: ['player', 0, 8] },
    // A giant someone else killed is no kill of the player's.
    {
        tick: 112,
        splat: ['player', 2, 8],
        hp: 67,
        giants: [
            [8, 35],
            [9, 0],
        ],
    },
    { tick: 116, splat: [8, 9], giants: [[8, 0]] },
    // Giant 7's index again, a respawn: the fight the stop cut off.
    { tick: 118, splat: [7, 3], giants: [[7, null]] },
    { tick: 119, splat: ['player', 1, 7], hp: 66 },
];
const run = states(runSteps);

/** Two kills, `between` them a state at tick 110. */
const twoKills = (between: Step) =>
    combatLedger(
        states([
            { tick: 100, giants: [[5, 35]] },
            { tick: 101, splat: [5, 5] },
            { tick: 105, splat: [5, 30], giants: [[5, 0]] },
            { ...between, tick: 110 },
            { tick: 120, x: 3113, hp: 60, bank: false, giants: [[6, 35]] },
            { tick: 121, splat: [6, 5] },
            { tick: 125, splat: [6, 30], giants: [[6, 0]] },
        ]),
        { npc: 'Giant' },
    );

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
                interrupted: false,
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
                interrupted: false,
            },
        ]);
    });

    test('the hitsplats on the player by damage, and the means a kill', () => {
        expect(ledger.npcHitsplats).toEqual([1, 0, 1, 1]);
        expect(ledger.unattributed).toBe(0);
        expect(ledger.perKill.kills).toBe(2);
        expect(ledger.perKill.excluded).toBe(0);
        // One kill has ticks: no standard error.
        expect(ledger.perKill.ticks).toEqual({ mean: 10, se: NaN });
        // Damage 3 and 2: mean 2.5, sample sd sqrt(0.5), se sqrt(0.5 / 2) = 0.5.
        expect(ledger.perKill.damage.mean).toBe(2.5);
        expect(ledger.perKill.damage.se).toBeCloseTo(0.5, 12);
    });

    test('another name kills nothing', () => {
        expect(combatLedger(run, { npc: 'Moss giant' }).kills).toEqual([]);
    });

    test('splats on another npc are no swings of the player', () => {
        // A moss giant (index 3) in view all along, hit at 101: no swing, and no start of giant 7's fight.
        const withMoss = states([
            { tick: 100, giants: [[7, 35]], moss: true },
            { tick: 101, splat: [3, 1] },
            ...runSteps.slice(1),
        ]);
        expect(combatLedger(withMoss, { npc: 'Giant' }).kills.map(k => [k.fight, k.playerSwings])).toEqual([
            [4, 2],
            [6, 2],
        ]);
    });

    test('two giants at 0 HP in one state are one kill, and the second is never counted later', () => {
        const l = combatLedger(
            states([
                {
                    tick: 100,
                    giants: [
                        [1, 35],
                        [2, 35],
                    ],
                },
                { tick: 101, splat: [1, 5] },
                { tick: 102, splat: [2, 5] },
                {
                    tick: 105,
                    splat: [2, 30],
                    giants: [
                        [1, 0],
                        [2, 0],
                    ],
                },
                // Giant 2 still shows 0 HP as the next fight starts on giant 3.
                {
                    tick: 108,
                    splat: [3, 4],
                    giants: [
                        [2, 0],
                        [3, 31],
                    ],
                },
                { tick: 112, splat: [3, 31], giants: [[3, 0]] },
            ]),
            { npc: 'Giant' },
        );
        expect(l.kills.map(k => [k.tick, k.fight, k.gap, k.playerSwings])).toEqual([
            [105, 4, null, 3],
            [112, 4, 3, 2],
        ]);
    });

    test('an npc that left view is forgotten: a later npc of its index at 0 HP is no kill', () => {
        const l = combatLedger(
            states([
                { tick: 100, giants: [[5, 35]] },
                { tick: 101, splat: [5, 5] },
                // Giant 5 leaves view unkilled; another npc takes its index and someone else kills it.
                { tick: 103, giants: [] },
                { tick: 140, giants: [[5, 20]] },
                { tick: 141, giants: [[5, 0]] },
            ]),
            { npc: 'Giant' },
        );
        expect(l.kills).toEqual([]);
    });

    test('a splat on the player facing no giant is unattributed', () => {
        const l = combatLedger(
            states([
                { tick: 100, giants: [[5, 35]] },
                { tick: 101, splat: [5, 5] },
                { tick: 102, splat: ['player', 3, -1] },
                { tick: 103, splat: ['player', 2, 5] },
                { tick: 105, splat: [5, 30], giants: [[5, 0]] },
            ]),
            { npc: 'Giant' },
        );
        expect(l.unattributed).toBe(1);
        expect(l.kills.map(k => [k.npcSwings, k.damage])).toEqual([[1, 2]]);
    });

    describe('a kill after a death, a bank trip or a flee is out of the means', () => {
        test('in place, it counts', () => {
            const l = twoKills({ tick: 0 });
            expect(l.kills.map(k => k.interrupted)).toEqual([false, false]);
            expect(l.perKill).toMatchObject({ kills: 2, excluded: 0 });
        });

        for (const [what, step] of [
            ['a death (0 HP)', { hp: 0 }],
            ['a bank trip', { bank: true }],
            [`over ${AWAY} tiles off`, { x: 3113 + AWAY + 1 }],
        ] as const)
            test(what, () => {
                const l = twoKills({ tick: 0, ...step });
                expect(l.kills.map(k => k.interrupted)).toEqual([false, true]);
                expect(l.perKill).toMatchObject({ kills: 1, excluded: 1 });
                // The interrupted kill's ticks (20) are out: the first kill has none.
                expect(l.perKill.ticks.mean).toBeNaN();
            });
    });

    test('an event without an observationId is refused, not dropped', () => {
        const [first, ...rest] = run;
        const bare = { ...first!.combatEvents[0], observationId: undefined } as CombatEvent;
        const s = { ...rest[0]!, combatEvents: [bare] } as BotWorldState;
        expect(() => combatLedger([first!, s], { npc: 'Giant' })).toThrow(/has no observationId/);
    });

    test("a client restart's events, their ids from 1 again, are counted", () => {
        // The run, then the run again from a fresh client: its revisions and ids restart, its ticks go on.
        const again = run.map(s => ({
            ...s,
            tick: s.tick + 100,
            combatEvents: s.combatEvents.map(e => ({ ...e, tick: e.tick + 100 })),
        }));
        expect(combatLedger([...run, ...again], { npc: 'Giant' }).kills.map(k => k.tick)).toEqual([106, 116, 206, 216]);
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
        expect(mean([4])).toEqual({ mean: 4, se: NaN });
    });
});
