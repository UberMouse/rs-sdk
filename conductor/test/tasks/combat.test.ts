import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { ATTACK_WAIT_TICKS } from '../../actions/attack';
import { type Effect, TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { WALK_MAX_TICKS } from '../../actions/walk';
import type { StopCondition } from '../../lib/stop';
import { stepBudgetTicks } from '../../lib/task';
import combat, { AFTER_WALK_TICKS, ATTACK_RETRY_TICKS } from '../../tasks/combat';
import { fakePaths } from '../paths';
import { consume, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const COOP = { x: 3231, z: 3295 };
const AREA = { x: COOP.x, z: COOP.z, radius: 8 };
const PARAMS = { target: 'Chicken', area: AREA };
const CHICKEN = 5;
const FEATHER = 314;
/** Unarmed, on Punch (trains Attack), standing in the coop. */
const base = world().player({ at: COOP }).skill('Attack', 1, 0).combatStyle(0);
const chickenAt = (w: World, x = COOP.x + 1, z = COOP.z, opts: { combatLevel?: number } = {}) =>
    w.npc('Chicken', x, z, { index: CHICKEN, options: ['Attack'], ...opts });
const coop = chickenAt(base);
const ATTACK = 'Attack Chicken';
const noRoute = fakePaths(() => ({ success: false, waypoints: [], error: 'no path' }));
const xp = (amount: number, skill = 'Attack'): StopCondition[] => [{ kind: 'xp', skill, amount }];
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));

/**
 * One kill: attacked on tick 0, the fight runs from tick 2 until `killAt`, when the chicken is gone and
 * 25 Attack xp is in. `during` varies the fight's ticks.
 */
const kill = (w: World, n = 20, killAt = 6, during: (w: World, i: number) => World = f => f) =>
    w.series(n, (f, i) => {
        if (i >= killAt) return f.fighting(false).skill('Attack', 1, 25);
        return i >= 2 ? during(f.fighting(CHICKEN), i) : f;
    });

/** In a fight with HP flickering (so the watchdog sees progress) on ticks `from` until `until`. */
const fightBetween = (from: number, until: number, w: World, i: number) =>
    i >= from && i < until ? w.fighting(CHICKEN).player({ hp: 10 - (i % 2) }) : w;

/** Five feathers dropped beside the bot. */
const feathersDropped = (w: World) => w.ground('Feather', COOP.x + 1, COOP.z, 5, { id: FEATHER });

/** Food eaten heals `hp` on top of the scripted HP, besides leaving the inventory (`consume`). */
const healing =
    (hp: number): TimelineOptions['react'] =>
    (action, state) => {
        const used = consume(action, state);
        if (!used) return undefined;
        return s => {
            const p = s.player;
            const t = used(s);
            return p ? { ...t, player: { ...p, hp: Math.min(p.maxHp, p.hp + hp) } } : t;
        };
    };

describe('combat: fighting', () => {
    test('attacks the nearest free chicken in the area and waits for the kill', async () => {
        const far = chickenAt(base, COOP.x + 2, COOP.z);
        const busy = far.npc('Chicken', COOP.x, COOP.z + 1, { index: 9, options: ['Attack'], inCombat: true });
        const outside = busy.npc('Chicken', COOP.x + 9, COOP.z, { index: 10, options: ['Attack'] });
        const r = await simulate(combat, { params: PARAMS, timeline: kill(outside), stops: xp(25) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK]);
        const targets = r.driver.commands.flatMap(c =>
            c.type === 'send' && c.action.type === 'interactNpc' ? [c.action.npcIndex] : [],
        );
        expect(targets).toEqual([CHICKEN]);
        expect(r.steps).toEqual(['fight']);
        expect(logged(r)).toEqual([]);
        expect(r.result.xpGained).toEqual({ Attack: 25 });
    });

    test('a chicken further than two tiles is walked to first, to within two', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: kill(chickenAt(base, COOP.x + 5, COOP.z)),
            react: walking(),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([`walk to (${COOP.x + 5}, ${COOP.z})`, ATTACK]);
    });

    test('a failed walk is a failed attack, with upstream wording', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: chickenAt(base, COOP.x + 5, COOP.z).series(1),
            pathfinder: noRoute,
        });
        const walk = `Cannot reach Chicken: No path to (${COOP.x + 5}, ${COOP.z}) from (${COOP.x}, ${COOP.z}): no path`;
        expect(r.result.reason).toBe(`fight: 6 attacks in a row failed (last: ${walk})`);
        expect(r.sends).toEqual([]);
        expect(logged(r)).toEqual(Array<string>(6).fill(`attack Chicken failed: ${walk}`));
    });

    test('six failed attacks in a row fail the run with the last reason, before the watchdog', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: coop.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('fight: 6 attacks in a row failed (last: Timeout waiting to attack Chicken)');
        expect(r.sends).toEqual(Array<string>(6).fill(ATTACK));
        // Each attempt is the attack's wait and one tick before the next.
        expect(r.driver.state().tick).toBe(6 * ATTACK_WAIT_TICKS + 5);
    });

    test('a kill in between resets the count', async () => {
        // Sends 1-5 and 7-11 are refused; 6 and 12 start a fight that ends in a kill two ticks later.
        let sent = 0;
        let kills = 0;
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: coop.series(1),
            respond: a => {
                if (a.type !== 'interactNpc') return undefined;
                sent++;
                return sent % 6 === 0 ? undefined : { success: false, message: 'not connected' };
            },
            react: (a: BotAction, s: BotWorldState): Effect | undefined => {
                if (a.type !== 'interactNpc') return undefined;
                const from = s.tick;
                const total = 25 * ++kills;
                return st =>
                    st.tick <= from + 2
                        ? world(st).fighting(CHICKEN).build()
                        : world(st)
                              .fighting(false)
                              .skill('Attack', 1, Math.max(total, st.skills[0]?.experience ?? 0))
                              .build();
            },
            stops: xp(50),
        });
        expect(r.result.reason).toBe('reached +50 Attack xp');
        expect(sent).toBe(12);
    });

    test('no free chicken waits, then fails after twenty looks', async () => {
        const taken = base.npc('Chicken', COOP.x + 1, COOP.z, { options: ['Attack'], inCombat: true });
        const r = await simulate(combat, { params: PARAMS, timeline: taken.series(1) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in the area');
        expect(r.driver.state().tick).toBe(19 * 3);
        expect(r.sends).toEqual([]);
    });

    test('a chicken that turns up too strong fails the run', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: base.series(5, (w, i) => (i >= 1 ? chickenAt(w, COOP.x + 1, COOP.z, { combatLevel: 20 }) : w)),
        });
        expect(r.result.reason).toBe('fight: Chicken is level 20, above limit 5');
    });

    test('a fight that never ends fails after 90 s of game time', async () => {
        // HP flickers so the watchdog sees progress; the chicken never dies.
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: coop
                .series(10, (w, i) => (i >= 2 ? w.fighting(CHICKEN) : w))
                .concat(coop.fighting(CHICKEN).series(300, (w, i) => w.tick(10 + i).player({ hp: 10 - (i % 2) }))),
        });
        expect(r.result.reason).toBe('fight: fight lasted over 90s at (3231,3295)');
        // The fight is first seen on tick 2, and checked every 15-tick slice until past 225 ticks.
        expect(r.driver.state().tick).toBe(2 + 16 * 15);
        expect(r.sends).toEqual([ATTACK]);
    });

    test('the fight clock restarts with each fight', async () => {
        // Two 150-tick fights back to back: each is under the timeout, together they are over it.
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: coop.series(400, (w, i) => {
                const f = fightBetween(160, 310, fightBetween(2, 152, w, i), i);
                return i >= 310 ? f.skill('Attack', 1, 25) : f;
            }),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK, ATTACK]);
    });
});

describe('combat: after the kill', () => {
    test('the combat timer tail (inCombat with no target) does not hold the next attack or the loot back', async () => {
        const second = 6;
        const sentIn: { combat: boolean; target: number }[] = [];
        const w = chickenAt(chickenAt(base), COOP.x - 1, COOP.z + 1);
        const timeline = w.series(30, (f, i) => {
            // Killed on tick 6; the combat timer keeps inCombat on until tick 24 with the target gone.
            if (i >= 14) return feathersDropped(f).fighting(second).skill('Attack', 1, 50);
            if (i >= 6) return feathersDropped(f).fighting(false).player({ inCombat: true }).skill('Attack', 1, 25);
            return i >= 2 ? f.fighting(CHICKEN) : f;
        });
        const driver: TimelineDriver = new TimelineDriver(timeline, {
            respond: a => {
                if (a.type === 'pickupItem' || a.type === 'interactNpc') {
                    const c = driver.state().player?.combat;
                    sentIn.push({ combat: !!c?.inCombat, target: c?.targetIndex ?? -2 });
                }
                return undefined;
            },
        });
        const r = await simulate(combat, { params: { ...PARAMS, loot: ['Feather'] }, driver, stops: xp(50) });
        expect(r.sends.slice(0, 2)).toEqual([ATTACK, 'take Feather']);
        // The loot and the second attack went out during the tail, not after it.
        expect(sentIn.slice(1).every(s => s.combat && s.target === -1)).toBe(true);
        expect(driver.state().tick).toBeLessThan(24);
    });
});

// The bot is hit (tick 3) and has no target of its own; chicken 7 is free and nearer than chicken 6, which attacks it.
const hit = (w: World) => w.player({ inCombat: true, lastDamageTick: 3 });
const two = (w: World) =>
    w
        .npc('Chicken', COOP.x + 1, COOP.z, { index: 7, options: ['Attack'] })
        .npc('Chicken', COOP.x + 2, COOP.z, { index: 6, options: ['Attack'], attacking: true, inCombat: true });
const attacked = (r: Simulation) =>
    r.driver.commands.flatMap(c => (c.type === 'send' && c.action.type === 'interactNpc' ? [c.action.npcIndex] : []));

describe('combat: an NPC already attacking the bot', () => {
    test('is attacked back before any free NPC (the server refuses another target while one is on the bot)', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            // The engine refuses to start in combat: the chickens and the hit arrive on tick 3.
            timeline: base.series(10, (w, i) => {
                if (i >= 8) return hit(two(w)).fighting(false).skill('Attack', 1, 25);
                return i >= 3 ? hit(two(w)) : w;
            }),
            stops: xp(25),
        });
        expect(attacked(r)[0]).toBe(6);
    });

    test('without a recent hit, with another player in view, the attacker is left to others and the free NPC is chosen', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: two(base.otherPlayer('Bob')).series(8, (w, i) =>
                i >= 6 ? w.fighting(false).skill('Attack', 1, 25) : w,
            ),
            stops: xp(25),
        });
        expect(attacked(r)[0]).toBe(7);
    });
});

const attackedBy = (name: string, index: number, level: number, hp = 10) =>
    base
        .player({ inCombat: true, lastDamageTick: 0, hp })
        .npc(name, COOP.x + 1, COOP.z, { index, options: ['Attack'], attacking: true, combatLevel: level });

describe('combat: an NPC facing the bot before its first hit', () => {
    // Elvarg targets the bot long before she hits: the bot is not hit, and the NPC is already inCombat.
    const facing = base
        .npc('Chicken', COOP.x + 1, COOP.z, { index: 20, options: ['Attack'], attacking: true, inCombat: true })
        .npc('Chicken', COOP.x + 2, COOP.z, { index: 21, options: ['Attack'] });

    test('is a valid target when no other player is in view', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: killOf(facing, 20), stops: xp(25) });
        expect(attacked(r)[0]).toBe(20);
    });

    test('is refused when it may be fighting another player in view (no hit on the bot yet)', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: facing
                .otherPlayer('Bob')
                .series(8, (w, i) => (i >= 6 ? w.fighting(false).skill('Attack', 1, 25) : w)),
            stops: xp(25),
        });
        expect(attacked(r)[0]).toBe(21);
    });

    test('is a valid target beside another player once it has hit the bot', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: killOf(facing.otherPlayer('Bob').player({ lastDamageTick: 0 }), 20),
            stops: xp(25),
        });
        expect(attacked(r)[0]).toBe(20);
    });
});

describe('combat: an NPC fighting a listed player', () => {
    test('is refused even after a hit on the bot; the NPC attacking the bot is taken', async () => {
        // Bob (index 1) is the target of chicken 20; chicken 21 faces the unlisted bot.
        const fightWorld = base
            .player({ lastDamageTick: 0 })
            .otherPlayer('Bob', 1)
            .npc('Chicken', COOP.x + 1, COOP.z, { index: 20, options: ['Attack'], attacking: true })
            .npc('Chicken', COOP.x + 2, COOP.z, { index: 21, options: ['Attack'] });
        const r = await simulate(combat, { params: PARAMS, timeline: killOf(fightWorld, 21), stops: xp(25) });
        expect(attacked(r)[0]).toBe(21);
    });
});

describe('combat: starting in a fight', () => {
    test('starts when the attacker is one of its targets, and fights it first', async () => {
        const hurt = attackedBy('Chicken', CHICKEN, 1)
            .npc('Chicken', COOP.x + 2, COOP.z, { index: 7, options: ['Attack'] })
            .series(10, (f, i) =>
                i >= 6 ? f.fighting(false).skill('Attack', 1, 25) : f.player({ lastDamageTick: 0 }),
            );
        const k = await simulate(combat, { params: PARAMS, timeline: hurt, stops: xp(25) });
        expect(k.result.reason).toBe('reached +25 Attack xp');
        expect(attacked(k)[0]).toBe(CHICKEN);
    });

    test('starts against a winnable non-target attacker and waits out its auto-retaliate fight', async () => {
        const goblin = attackedBy('Goblin', 20, 2);
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: goblin.series(10, (f, i) => (i >= 5 ? f.fighting(false).skill('Attack', 1, 25) : f.fighting(20))),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(attacked(r)).toEqual([]);
    });

    test('is refused against a non-target attacker above the bot, as before', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: attackedBy('Giant', 20, 28).series(3) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('in combat at');
        expect(r.sends).toEqual([]);
    });

    test('starts at low HP against a target attacker: the low-HP guard eats during the run, no refusal', async () => {
        const hurt = attackedBy('Chicken', CHICKEN, 1, 4).inv('Shrimps', 3);
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: hurt.series(12, (f, i) =>
                i >= 8 ? f.fighting(false).skill('Attack', 1, 25) : f.player({ lastDamageTick: 0, hp: i >= 2 ? 8 : 4 }),
            ),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends[0]).toBe('Eat Shrimps');
    });

    test('at low HP with no food the run starts and the guard ends it (no "in combat" refusal)', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: attackedBy('Chicken', CHICKEN, 1, 4).series(6, f => f.player({ lastDamageTick: 0, hp: 4 })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).not.toStartWith('in combat at');
        expect(r.result.reason).toContain('no food');
    });

    test('starts when one of several attackers is a target, though another is stronger than the bot', async () => {
        const mixed = attackedBy('Chicken', CHICKEN, 1).npc('Giant', COOP.x - 1, COOP.z, {
            index: 21,
            options: ['Attack'],
            attacking: true,
            combatLevel: 28,
        });
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: mixed.series(10, (f, i) =>
                i >= 6 ? f.fighting(false).skill('Attack', 1, 25) : f.player({ lastDamageTick: 0 }),
            ),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(attacked(r)[0]).toBe(CHICKEN);
    });

    test('a stale inCombat flag (no target, last hit 17 ticks ago, nobody attacking) does not refuse', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: chickenAt(base)
                .player({ inCombat: true, lastDamageTick: 0 })
                .tick(17)
                .series(10, (f, i) => (i >= 6 ? f.fighting(false).skill('Attack', 1, 25) : f.fighting(false))),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(attacked(r)[0]).toBe(CHICKEN);
    });

    test('an unknown attacker (hit just now, none beside the bot) is refused', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: base.player({ inCombat: true, lastDamageTick: 0 }).tick(5).series(3),
        });
        expect(r.result.reason).toStartWith('in combat at');
    });
});

describe('combat: guards mid-fight', () => {
    test('low HP mid-fight: the low-HP guard eats first, the eat step tops up to eatBelow', async () => {
        // HP drops to 4 of 10 on tick 4: under half, so the guard eats (+1 to 5), then the eat step (+1 to 6).
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: kill(coop.inv('Shrimps', 3), 30, 15, (w, i) => (i >= 4 ? w.player({ hp: 4 }) : w)),
            react: healing(1),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK, 'Eat Shrimps', 'Eat Shrimps']);
        // The guard runs inside the cancelled fight wait, so it shows as its log, not as a step.
        const order = r.events.flatMap(e =>
            e.type === 'step'
                ? [String(e.step)]
                : e.type === 'log' && String(e.msg).startsWith('low hp')
                  ? [String(e.msg)]
                  : [],
        );
        expect(order).toEqual(['fight', 'low hp: hp 4/10 at (3231,3295): ate Shrimps, +1 hp', 'eat', 'fight']);
        expect(r.result.stepRuns['interrupt:low-hp']).toBe(1);
    });

    test('HP under eatBelow but over half: only the eat step eats, and the fight goes on', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: kill(coop.inv('Shrimps', 2), 30, 15, (w, i) => (i >= 4 ? w.player({ hp: 5 }) : w)),
            react: healing(3),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK, 'Eat Shrimps']);
        expect(r.result.stepRuns).toEqual({ fight: 3, eat: 1 });
    });

    test('three failed eats in a row fail the run with the last reason', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: coop.player({ hp: 5 }).inv('Shrimps', 1, { options: [] }).series(1),
        });
        expect(r.result.reason).toBe('eat: could not eat Shrimps: No eat/drink option on Shrimps');
        expect(r.result.stepRuns).toEqual({ eat: 3 });
    });

    test('a level-up dialog mid-fight is cleared and the kill still counts', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: kill(coop, 20, 8, (w, i) => (i === 4 ? w.dialog({ options: ['Click here to continue'] }) : w)),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK, 'continue dialog']);
        expect(logged(r)).toEqual([]);
    });

    test('death mid-fight fails the run', async () => {
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: kill(coop, 20, 20, (w, i) =>
                i === 5 ? w.player({ hp: 0 }).message('Oh dear, you are dead!') : w,
            ),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^interrupt:death: died near \(3231,3295\), respawned at/);
    });
});

describe('combat: style and equipment', () => {
    test('sets the style that trains the skill before fighting', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, skill: 'Strength' },
            timeline: kill(coop, 20, 8, w => w.combatStyle(1)).map((s, i) =>
                i === 1 ? world(s).combatStyle(1).build() : s,
            ),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual(['combat style Kick', ATTACK]);
        expect(logged(r)).toEqual(['combat style Kick (Aggressive) for Strength']);
    });

    test('a style that never takes fails after three tries', async () => {
        const r = await simulate(combat, { params: { ...PARAMS, skill: 'Defence' }, timeline: coop.series(1) });
        expect(r.result.reason).toBe('set-style: could not set combat style Block for Defence');
        expect(r.sends).toEqual(Array<string>(3).fill('combat style Block'));
    });

    test('a weapon with no style for the skill fails at once', async () => {
        const stabOnly = [{ index: 0, name: 'Stab', type: 'Accurate', trainsSkills: ['Attack'], damageType: 'Stab' }];
        const r = await simulate(combat, {
            params: { ...PARAMS, skill: 'Defence' },
            timeline: coop.combatStyle(0, stabOnly).series(1),
        });
        expect(r.result.reason).toBe('set-style: no combat style trains Defence with current weapon');
    });

    test('a style list that never loads fails after three looks', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: coop.combatStyle(0, [], false).series(1) });
        expect(r.result.reason).toBe('set-style: combat style list never loaded');
        expect(r.result.stepRuns).toEqual({ 'set-style': 3 });
    });

    const sword = { options: [{ text: 'Wield', opIndex: 2 }] };
    const armed = coop.equipment({ name: 'Bronze sword' });

    test('wields the weapon from the inventory before fighting', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, weapon: 'Bronze sword' },
            timeline: [coop.inv('Bronze sword', 1, sword).build(), ...kill(armed).slice(1)],
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual(['Wield Bronze sword', ATTACK]);
        expect(r.steps).toEqual(['equip', 'fight']);
    });

    test('a weapon that never wields fails after three tries', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, weapon: 'Bronze sword' },
            timeline: coop.inv('Bronze sword', 1, sword).series(1),
        });
        expect(r.result.reason).toBe('equip: cannot equip Bronze sword: Failed to equip Bronze sword');
        expect(r.sends).toEqual(Array<string>(3).fill('Wield Bronze sword'));
    });
});

describe('combat: bones and loot', () => {
    const bury = { options: [{ text: 'Bury', opIndex: 1 }] };

    test('buries bones, then fights', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, buryBones: true },
            timeline: [coop.inv('Bones', 1, bury).build(), ...kill(coop).slice(1)],
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual(['Bury Bones', ATTACK]);
    });

    test('big bones (a giant drops them) are picked up and buried like bones', async () => {
        const ground = coop.ground('Big bones', COOP.x + 1, COOP.z + 1, 1, { id: 532 });
        const picked = await simulate(combat, {
            params: { ...PARAMS, buryBones: true },
            timeline: ground.series(1),
            respond: a => (a.type === 'pickupItem' ? { success: false, message: 'stop here' } : undefined),
        });
        expect(picked.sends[0]).toBe('take Big bones');
        const buried = await simulate(combat, {
            params: { ...PARAMS, buryBones: true },
            timeline: [coop.inv('Big bones', 1, bury).build(), ...kill(coop).slice(1)],
            stops: xp(25),
        });
        expect(buried.sends).toEqual(['Bury Big bones', ATTACK]);
    });

    test('bones that never bury fail after three tries', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, buryBones: true },
            timeline: coop.inv('Bones', 1, bury).series(1),
        });
        expect(r.result.reason).toBe('bury-bones: bones did not bury');
        expect(r.sends).toEqual(Array<string>(3).fill('Bury Bones'));
    });

    test('bones without a Bury option fail at once', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, buryBones: true },
            timeline: coop.inv('Bones', 1).series(1),
        });
        expect(r.result.reason).toBe('bury-bones: bones have no Bury option');
    });

    test('loot dropped mid-fight waits until the fight is over', async () => {
        let inCombatAtPickup: boolean | undefined;
        const driver: TimelineDriver = new TimelineDriver(
            // Feathers drop on tick 4, mid-fight; the kill is on tick 8, a second kill's xp on tick 14.
            kill(coop, 20, 8, (w, i) => (i >= 4 ? feathersDropped(w) : w)).map((s, i) => {
                if (i >= 14) return world(s).inv('Feather', 5, { id: FEATHER }).skill('Attack', 1, 50).build();
                if (i >= 10) return world(s).inv('Feather', 5, { id: FEATHER }).build();
                return i >= 8 ? feathersDropped(world(s)).build() : s;
            }),
            {
                respond: a => {
                    if (a.type === 'pickupItem') inCombatAtPickup = driver.state().player?.combat.inCombat;
                    return undefined;
                },
            },
        );
        const r = await simulate(combat, {
            params: { ...PARAMS, loot: ['Feather'] },
            driver,
            stops: xp(50),
        });
        expect(r.sends).toEqual([ATTACK, 'take Feather', ATTACK]);
        expect(inCombatAtPickup).toBe(false);
        expect(r.steps).toEqual(['fight', 'loot', 'fight']);
        expect(r.result.inventoryDelta).toEqual({ Feather: 5 });
    });

    test('loot that fails is skipped, and nine failures in a row fail the run', async () => {
        let ground = base;
        for (let i = 0; i < 9; i++)
            ground = ground.ground('Feather', COOP.x + (i % 3), COOP.z + Math.floor(i / 3), 1, { id: FEATHER });
        const r = await simulate(combat, {
            params: { ...PARAMS, loot: ['Feather'] },
            timeline: ground.series(1),
            respond: a => (a.type === 'pickupItem' ? { success: false, message: 'not connected' } : undefined),
        });
        expect(r.result.reason).toBe('loot: looting keeps failing (last: not connected)');
        expect(r.sends).toEqual(Array<string>(9).fill('take Feather'));
        expect(logged(r)).toEqual(Array<string>(9).fill('loot Feather failed: not connected'));
    });
});

/** The k-th feather's own tile within reach; it is present for three ticks, and once skipped loot does not apply until the next. */
const tile = (k: number) => ({ x: COOP.x - 2 + (k % 5), z: COOP.z - 1 + Math.floor(k / 5) });

/** One feather per three ticks, each on its own tile; with `gained`, a feather is in the inventory after that one. */
const spaced = (items: number, gained?: { k: number }) =>
    base.series(items * 3 + 90, (w, i) => {
        const k = Math.floor(i / 3);
        let out = w;
        if (gained && i > gained.k * 3) out = out.inv('Feather', 1, { id: FEATHER });
        if (k < items) {
            const t = tile(k);
            out = out.ground('Feather', t.x, t.z, 1, { id: FEATHER });
        }
        return out;
    });

describe('combat: loot failure limits', () => {
    test('failures separated by gaps in loot still reach the limit', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, loot: ['Feather'] },
            timeline: spaced(12),
            respond: a => (a.type === 'pickupItem' ? { success: false, message: 'not connected' } : undefined),
        });
        expect(r.result.reason).toBe('loot: looting keeps failing (last: not connected)');
        expect(r.sends.filter(s => s === 'take Feather')).toHaveLength(9);
    });

    test('a successful pickup resets the count', async () => {
        const winner = tile(8);
        const r = await simulate(combat, {
            params: { ...PARAMS, loot: ['Feather'] },
            timeline: spaced(17, { k: 8 }),
            respond: a =>
                a.type === 'pickupItem' && !(a.x === winner.x && a.z === winner.z)
                    ? { success: false, message: 'not connected' }
                    : undefined,
        });
        expect(r.sends.filter(s => s === 'take Feather')).toHaveLength(17);
        expect(r.result.reason).not.toContain('looting keeps failing');
    });

    test('a skipped item is lootable again after the skip window', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, loot: ['Feather'] },
            timeline: chickenAt(feathersDropped(base)).series(1),
            respond: a => (a.type === 'pickupItem' ? { success: false, message: 'not connected' } : undefined),
        });
        expect(r.sends.filter(s => s === 'take Feather').length).toBeGreaterThanOrEqual(2);
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(combat, { params, timeline: w.series(1) })).result.reason;

describe('combat: preflight', () => {
    test('needs the weapon and shield worn or carried', async () => {
        expect(await refusal(coop, { ...PARAMS, weapon: 'Bronze sword' })).toBe(
            'preflight: Bronze sword is neither worn nor in the inventory',
        );
        expect(
            await refusal(coop.equipment({ name: 'Bronze sword' }), {
                ...PARAMS,
                weapon: 'Bronze sword',
                shield: 'Wooden shield',
            }),
        ).toBe('preflight: Wooden shield is neither worn nor in the inventory');
    });

    test('refuses a target above the level limit, capped without food', async () => {
        const strong = chickenAt(base, COOP.x + 1, COOP.z, { combatLevel: 7 });
        expect(await refusal(strong)).toBe(
            'preflight: Chicken is level 7, above the limit 5 (combat 3 + 5, capped at 5 without food)',
        );
        expect(await refusal(strong, { ...PARAMS, maxLevelGap: 2, food: ['Shrimps'] })).toBe(
            'preflight: Chicken is level 7, above the limit 5 (combat 3 + 2, capped at 5 without food)',
        );
        const fed = chickenAt(base.inv('Shrimps', 1), COOP.x + 1, COOP.z, { combatLevel: 9 });
        expect(await refusal(fed, { ...PARAMS, food: ['Shrimps'] })).toBe(
            'preflight: Chicken is level 9, above the limit 8 (combat 3 + 5)',
        );
    });

    test('refuses an area reaching the Wilderness', async () => {
        expect(await refusal(coop, { ...PARAMS, area: { x: 3100, z: 3530, radius: 5 } })).toBe(
            'preflight: area (3100,3530) radius 5 reaches the Wilderness',
        );
    });
});

describe('combat: return to area', () => {
    test('outside the area walks back before fighting', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, area: { x: 3300, z: 3300, radius: 4 } },
            timeline: coop.series(3),
            pathfinder: noRoute,
        });
        expect(r.steps[0]).toBe('return-to-area');
        expect(r.sends).toEqual([]);
    });
});

describe('combat: targetRange visible', () => {
    const VISIBLE = { ...PARAMS, targetRange: 'visible' };
    /** The bot stands in the coop; the only chicken is 12 tiles away, beyond the area (radius 8). */
    const outside = chickenAt(base, COOP.x + 12, COOP.z);

    test('a chicken in view beyond the area is attacked; the default mode ignores it', async () => {
        const seen = await simulate(combat, {
            params: VISIBLE,
            timeline: kill(outside),
            react: walking(),
            stops: xp(25),
        });
        expect(seen.result.reason).toBe('reached +25 Attack xp');
        expect(seen.sends).toEqual([`walk to (${COOP.x + 12}, ${COOP.z})`, ATTACK]);
        const ignored = await simulate(combat, { params: PARAMS, timeline: outside.series(1) });
        expect(ignored.result.reason).toBe('fight: no free reachable Chicken in the area');
        expect(ignored.sends).toEqual([]);
    });

    test('the nearest visible target wins, in or out of the area', async () => {
        const w = outside.npc('Chicken', COOP.x - 4, COOP.z, { index: 11, options: ['Attack'] });
        const r = await simulate(combat, { params: VISIBLE, timeline: kill(w), react: walking(), stops: xp(25) });
        const targets = r.driver.commands.flatMap(c =>
            c.type === 'send' && c.action.type === 'interactNpc' ? [c.action.npcIndex] : [],
        );
        expect(targets).toEqual([11]);
    });

    test('still free and reachable only', async () => {
        const w = base
            .npc('Chicken', COOP.x + 12, COOP.z, { index: 9, options: ['Attack'], inCombat: true })
            .npc('Chicken', COOP.x + 13, COOP.z, { index: 10, options: ['Attack'], reachable: false });
        const r = await simulate(combat, { params: VISIBLE, timeline: w.series(1) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in view');
        expect(r.sends).toEqual([]);
    });

    describe('the Wilderness', () => {
        const EDGE = { x: 3100, z: 3490 };
        const edgeParams = { target: 'Chicken', targetRange: 'visible', area: { ...EDGE, radius: 4 } };
        const edge = world().player({ at: EDGE }).skill('Attack', 1, 0).combatStyle(0);

        test('a target inside it, or within three tiles of it, is never picked', async () => {
            for (const z of [3522, 3518]) {
                const w = edge.npc('Chicken', EDGE.x, z, { index: CHICKEN, options: ['Attack'] });
                const r = await simulate(combat, { params: edgeParams, timeline: w.series(1), react: walking() });
                expect(r.result.reason).toBe('fight: no free reachable Chicken in view');
                expect(r.sends).toEqual([]);
            }
        });

        test('a target further from it is picked', async () => {
            const w = edge.npc('Chicken', EDGE.x, 3512, { index: CHICKEN, options: ['Attack'] });
            const r = await simulate(combat, {
                params: edgeParams,
                timeline: w.series(1),
                react: walking(),
                respond: a => (a.type === 'interactNpc' ? { success: false, message: 'stop' } : undefined),
            });
            expect(r.sends[0]).toBe(`walk to (${EDGE.x}, 3512)`);
        });

        test('an attacker beside it is still fought back, while a free one there is refused', async () => {
            const z = 3518;
            const npcs = (w: World) =>
                w
                    .npc('Chicken', EDGE.x, z, { index: 7, options: ['Attack'] })
                    .npc('Chicken', EDGE.x + 1, z, { index: 6, options: ['Attack'], attacking: true, inCombat: true });
            const r = await simulate(combat, {
                params: { ...edgeParams, area: { ...EDGE, z: 3512, radius: 4 } },
                // Hit on tick 0 but not yet in combat, as the engine requires to start.
                timeline: npcs(edge.player({ at: { x: EDGE.x, z: 3516 }, lastDamageTick: 0 })).series(8),
                react: walking(),
                respond: a => (a.type === 'interactNpc' ? { success: false, message: 'stop' } : undefined),
            });
            expect(attacked(r)[0]).toBe(6);
        });

        test('loot beside it is not picked up', async () => {
            const w = edge.ground('Feather', EDGE.x, 3519, 1, { id: FEATHER });
            const r = await simulate(combat, { params: { ...edgeParams, loot: ['Feather'] }, timeline: w.series(1) });
            expect(r.sends).toEqual([]);
        });
    });

    describe('return to area', () => {
        const FAR = { x: COOP.x + 40, z: COOP.z };
        const away = world().player({ at: FAR }).skill('Attack', 1, 0).combatStyle(0);

        test('walks back when no target is in view', async () => {
            const r = await simulate(combat, {
                params: VISIBLE,
                timeline: away.series(3),
                pathfinder: noRoute,
            });
            expect(r.steps[0]).toBe('return-to-area');
        });

        test('does not walk back while a target is in view; the default mode does', async () => {
            const w = chickenAt(away, FAR.x + 6, FAR.z);
            const visible = await simulate(combat, { params: VISIBLE, timeline: w.series(3), pathfinder: noRoute });
            expect(visible.steps[0]).toBe('fight');
            const area = await simulate(combat, { params: PARAMS, timeline: w.series(3), pathfinder: noRoute });
            expect(area.steps[0]).toBe('return-to-area');
        });

        test('loot outside the area is picked up in visible mode only', async () => {
            const w = away.ground('Feather', FAR.x + 2, FAR.z, 1, { id: FEATHER });
            const params = { ...VISIBLE, loot: ['Feather'] };
            const visible = await simulate(combat, {
                params,
                timeline: w.series(2),
                respond: a => (a.type === 'pickupItem' ? { success: false, message: 'stop here' } : undefined),
            });
            expect(visible.steps[0]).toBe('loot');
            expect(visible.sends[0]).toBe('take Feather');
            const area = await simulate(combat, {
                params: { ...PARAMS, loot: ['Feather'] },
                timeline: w.series(2),
                pathfinder: noRoute,
            });
            expect(area.steps[0]).toBe('return-to-area');
        });
    });
});

describe('combat: the step budget', () => {
    test('the fight step fits its longest walk, the attack and the retry wait', () => {
        expect(AFTER_WALK_TICKS).toBe(1 + ATTACK_WAIT_TICKS + ATTACK_RETRY_TICKS);
        expect(stepBudgetTicks(combat.stepTimeoutMs ?? 0)).toBeGreaterThanOrEqual(WALK_MAX_TICKS + AFTER_WALK_TICKS);
    });
});

const BOW_STYLES = [
    { index: 0, name: 'Accurate', type: 'Accurate', trainsSkills: ['Ranged'], damageType: 'Ranged' },
    { index: 1, name: 'Rapid', type: 'Rapid', trainsSkills: ['Ranged'], damageType: 'Ranged' },
    { index: 2, name: 'Longrange', type: 'Longrange', trainsSkills: ['Ranged', 'Defence'], damageType: 'Ranged' },
];
const ARROW = 'Bronze arrow';
const BOW_PARAMS = { ...PARAMS, skill: 'Ranged', weapon: 'Shortbow', ammo: ARROW };
const wield = { options: [{ text: 'Wield', opIndex: 2 }] };
/** The archer with no chicken around. */
const archerAlone = (arrows: number, carriedArrows = 0) => {
    let w = base
        .skill('Ranged', 1, 0)
        .combatStyle(0, BOW_STYLES)
        .equipment({ name: 'Shortbow' }, ...(arrows > 0 ? [{ name: ARROW, count: arrows }] : []));
    if (carriedArrows > 0) w = w.inv(ARROW, carriedArrows, wield);
    return w;
};
const archer = (arrows: number, carriedArrows = 0) => {
    let w = chickenAt(base.skill('Ranged', 1, 0).combatStyle(0, BOW_STYLES)).equipment(
        { name: 'Shortbow' },
        ...(arrows > 0 ? [{ name: ARROW, count: arrows }] : []),
    );
    if (carriedArrows > 0) w = w.inv(ARROW, carriedArrows, wield);
    return w;
};
const shot = (w: World, n = 20, killAt = 6, fightAt = 2) =>
    w.series(n, (f, i) =>
        i >= killAt ? f.fighting(false).skill('Ranged', 1, 100) : i >= fightAt ? f.fighting(CHICKEN) : f,
    );

describe('combat: Ranged', () => {
    test('wields the bow and the arrows, then attacks as for melee', async () => {
        const carrying = chickenAt(base.skill('Ranged', 1, 0).combatStyle(0, BOW_STYLES))
            .inv('Shortbow', 1, wield)
            .inv(ARROW, 200, wield);
        const bowWorn = chickenAt(base.skill('Ranged', 1, 0).combatStyle(0, BOW_STYLES))
            .equipment({ name: 'Shortbow' })
            .inv(ARROW, 200, wield);
        const r = await simulate(combat, {
            params: BOW_PARAMS,
            timeline: [carrying.build(), bowWorn.build(), ...shot(archer(200), 20, 9, 5).slice(2)],
            stops: xp(100, 'Ranged'),
        });
        expect(r.result.reason).toBe('reached +100 Ranged xp');
        expect(r.sends).toEqual(['Wield Shortbow', `Wield ${ARROW}`, ATTACK]);
        expect(r.steps).toEqual(['equip', 'fight']);
    });

    test('sets the ranged style that trains Ranged', async () => {
        const r = await simulate(combat, {
            params: BOW_PARAMS,
            timeline: shot(archer(50).combatStyle(2, BOW_STYLES)).map((s, i) =>
                i >= 1 ? world(s).combatStyle(0, BOW_STYLES).build() : s,
            ),
            stops: xp(100, 'Ranged'),
        });
        expect(r.sends).toEqual(['combat style Accurate', ATTACK]);
    });

    test('with no arrows left the run fails, naming the ammo', async () => {
        const r = await simulate(combat, {
            params: BOW_PARAMS,
            timeline: [archer(1).build(), ...shot(archer(0), 20, 99)],
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`out-of-ammo: out of ${ARROW}`);
    });

    test('the last arrow fired mid-fight waits for the kill, then loots the fallen arrows', async () => {
        const r = await simulate(combat, {
            params: { ...BOW_PARAMS, loot: [ARROW] },
            timeline: [
                ...shot(archer(1)).slice(0, 4),
                ...shot(archer(0).ground(ARROW, COOP.x + 2, COOP.z, 1, { id: 882 })).slice(4),
            ],
        });
        // The fight is waited out and the arrow taken before the run gives up on the ammo.
        expect(r.steps.indexOf('loot')).toBeGreaterThan(-1);
        expect(r.steps.indexOf('loot')).toBeLessThan(r.steps.indexOf('out-of-ammo'));
        expect(r.sends).toContain(`take ${ARROW}`);
    });

    test('out of arrows in a fight that does not end fails as out of ammo after a short grace, not the fight timeout', async () => {
        const r = await simulate(combat, {
            params: { ...BOW_PARAMS, loot: [ARROW] },
            timeline: [...shot(archer(1), 4, 999).slice(0, 4), ...shot(archer(0), 120, 999).slice(4)],
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`fight: out of ${ARROW}`);
    });

    test('the last arrow fired mid-fight fails the run when arrows are not on the loot list', async () => {
        const r = await simulate(combat, {
            params: BOW_PARAMS,
            timeline: [...shot(archer(1)).slice(0, 4), ...shot(archer(0)).slice(4)],
        });
        expect(r.result.reason).toBe(`out-of-ammo: out of ${ARROW}`);
    });

    test('arrows on the ground are looted before giving up, then wielded again', async () => {
        const empty = archerAlone(0);
        const fallen = empty.ground(ARROW, COOP.x + 2, COOP.z, 3, { id: 882 });
        const r = await simulate(combat, {
            params: { ...BOW_PARAMS, loot: [ARROW] },
            // The last arrow is gone on tick 1, the idle wait ends on tick 3, the pickup lands on tick 4, the wield on 5.
            timeline: [
                archerAlone(1).build(),
                ...[1, 2, 3].map(t => fallen.tick(t).build()),
                archerAlone(0, 3).tick(4).build(),
                ...archerAlone(3).series(40, (w, i) => w.tick(5 + i)),
            ],
        });
        expect(r.sends.slice(0, 2)).toEqual([`take ${ARROW}`, `Wield ${ARROW}`]);
        expect(r.result.reason).toBe('fight: no free reachable Chicken in the area');
    });

    test('carried arrows are wielded on top of a worn stack', async () => {
        const r = await simulate(combat, {
            params: BOW_PARAMS,
            timeline: [archer(10, 5).build(), ...shot(archer(15)).slice(1)],
            stops: xp(100, 'Ranged'),
        });
        expect(r.sends).toEqual([`Wield ${ARROW}`, ATTACK]);
    });

    test('is refused without a bow or arrows named, or not held', async () => {
        const w = archer(50);
        expect(await refusal(w, { ...PARAMS, skill: 'Ranged', ammo: ARROW })).toBe(
            'preflight: Ranged needs `weapon` (a bow) and `ammo`',
        );
        expect(await refusal(w, { ...PARAMS, skill: 'Ranged', weapon: 'Shortbow' })).toBe(
            'preflight: Ranged needs `weapon` (a bow) and `ammo`',
        );
        expect(await refusal(archer(0), BOW_PARAMS)).toBe(`preflight: ${ARROW} is neither worn nor in the inventory`);
    });
});

const SPELL = 'Wind Strike';
const MAGIC_PARAMS = { ...PARAMS, skill: 'Magic', spell: SPELL };
const CAST = `cast ${SPELL} on Chicken`;
const NO_AIR = 'You do not have enough Air Runes to cast this spell.';
/** A mage with the runes, a chicken to cast at, and the Magic skill. */
const deserted = base.skill('Magic', 1, 0).inv('Air rune', 20).inv('Mind rune', 20);
const mage = chickenAt(deserted);

describe('combat: Magic', () => {
    test('casts at the chicken, waits out the delay and casts again until it dies', async () => {
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            // Each cast pays Magic xp a tick later; the chicken, fighting the bot, dies with the second.
            timeline: mage.series(30, (w, i) =>
                i >= 7
                    ? deserted.tick(w.build().tick).skill('Magic', 1, 110)
                    : w.skill('Magic', 1, i >= 1 ? 55 : 0).fighting(i >= 2 && CHICKEN),
            ),
            stops: xp(110, 'Magic'),
        });
        expect(r.result.reason).toBe('reached +110 Magic xp');
        expect(r.sends).toEqual([CAST, CAST]);
        expect(r.steps.every(s => s === 'cast')).toBe(true);
        expect(
            r.driver.commands.flatMap(c => (c.type === 'send' && c.action.type === 'spellOnNpc' ? [c.action] : []))[0],
        ).toMatchObject({
            npcIndex: CHICKEN,
            spellComponent: 1152,
        });
    });

    test('does not set a combat style, whatever the weapon', async () => {
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: mage.combatStyle(2).series(30, (w, i) => (i >= 1 ? w.skill('Magic', 1, 55) : w)),
            stops: xp(55, 'Magic'),
        });
        expect(r.sends).toEqual([CAST]);
    });

    test('runes that run out fail the run with the server message', async () => {
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: [mage.build(), mage.tick(2).message(NO_AIR).build()],
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(`cast: out of runes for ${SPELL}: ${NO_AIR}`);
        expect(r.sends).toEqual([CAST]);
    });

    test('a Magic level that is too low fails the run', async () => {
        const msg = 'Your Magic level is not high enough for this spell.';
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: [mage.build(), mage.tick(2).message(msg).build()],
        });
        expect(r.result.reason).toBe(`cast: ${msg}`);
    });

    test('six failed casts in a row fail the run, a success in between resets the count', async () => {
        const stuck = await simulate(combat, { params: MAGIC_PARAMS, timeline: mage.series(1) });
        expect(stuck.result.reason).toBe(
            `cast: 6 casts in a row failed (last: Timeout waiting for ${SPELL} on Chicken)`,
        );
        expect(stuck.sends).toEqual(Array<string>(6).fill(CAST));
        expect(logged(stuck)).toEqual(
            Array<string>(6).fill(`cast ${SPELL} on Chicken failed: Timeout waiting for ${SPELL} on Chicken`),
        );
    });

    test('a target that never dies is given up on after forty casts', async () => {
        let magic = 0;
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: mage.series(3, (w, i) => (i >= 2 ? w.fighting(CHICKEN) : w)),
            react: a => {
                if (a.type !== 'spellOnNpc') return undefined;
                magic += 55;
                const total = magic;
                return s => ({
                    ...s,
                    skills: s.skills.map(k => (k.name === 'Magic' ? { ...k, experience: total } : k)),
                });
            },
        });
        expect(r.result.reason).toBe('cast: 40 casts did not kill Chicken at (3232,3295)');
    });

    test('is refused without a spell, below its level, or without its runes', async () => {
        expect(await refusal(mage, { ...PARAMS, skill: 'Magic' })).toBe(
            'preflight: Magic needs `spell` (e.g. "Wind Strike")',
        );
        expect(await refusal(mage, { ...MAGIC_PARAMS, spell: 'Fire Strike' })).toBe(
            'preflight: Fire Strike needs Magic 13, the bot has 1',
        );
        const lvl = chickenAt(base.skill('Magic', 13, 0).inv('Air rune', 5).inv('Mind rune', 5));
        expect(await refusal(lvl, { ...MAGIC_PARAMS, spell: 'Fire Strike' })).toBe(
            'preflight: Fire Strike needs 3 Fire rune, the bot has 0',
        );
        expect(await refusal(chickenAt(base.skill('Magic', 1, 0).inv('Air rune', 5)), MAGIC_PARAMS)).toBe(
            'preflight: Wind Strike needs 1 Mind rune, the bot has 0',
        );
    });

    test('a staff stands in for its rune, so the runes are not required', async () => {
        const staffed = chickenAt(
            base.skill('Magic', 1, 0).equipment({ name: 'Staff of air', id: 1381 }).inv('Mind rune', 5),
        );
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: staffed.series(30, (w, i) => (i >= 1 ? w.skill('Magic', 1, 55) : w)),
            stops: xp(55, 'Magic'),
        });
        expect(r.result.reason).toBe('reached +55 Magic xp');
    });

    test('a staff covers only its own element: Staff of air with no Mind runes is refused', async () => {
        const w = chickenAt(base.skill('Magic', 1, 0).equipment({ name: 'Staff of air', id: 1381 }).inv('Air rune', 5));
        expect(await refusal(w, MAGIC_PARAMS)).toBe('preflight: Wind Strike needs 1 Mind rune, the bot has 0');
    });

    test('a Staff of fire does not stand in for the Air rune of Wind Strike', async () => {
        const w = chickenAt(
            base.skill('Magic', 1, 0).equipment({ name: 'Staff of fire', id: 1387 }).inv('Mind rune', 5),
        );
        expect(await refusal(w, MAGIC_PARAMS)).toBe('preflight: Wind Strike needs 1 Air rune, the bot has 0');
    });

    test('a carried (not worn) staff covers nothing', async () => {
        const w = chickenAt(base.skill('Magic', 1, 0).inv('Staff of air', 1, { id: 1381 }).inv('Mind rune', 5));
        expect(await refusal(w, MAGIC_PARAMS)).toBe('preflight: Wind Strike needs 1 Air rune, the bot has 0');
    });

    test('the cast count restarts when the counted NPC is gone, so a respawn reusing its index is not accumulated', async () => {
        let magic = 0;
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            // The chicken vanishes for a tick every 10 ticks (dies and respawns under the same index).
            timeline: mage
                .series(1000, (w, i) => w.fighting(i >= 2 && CHICKEN))
                .map((s, i) => (i % 10 === 9 ? { ...s, nearbyNpcs: [] } : s)),
            react: a => {
                if (a.type !== 'spellOnNpc') return undefined;
                magic += 55;
                const total = magic;
                return s => ({
                    ...s,
                    skills: s.skills.map(k => (k.name === 'Magic' ? { ...k, experience: total } : k)),
                });
            },
            stops: xp(55 * 60, 'Magic'),
        });
        expect(r.result.reason).toBe(`reached +${55 * 60} Magic xp`);
    });

    test('with no chicken in the area it fails after twenty looks', async () => {
        const r = await simulate(combat, {
            params: MAGIC_PARAMS,
            timeline: base.skill('Magic', 1, 0).inv('Air rune', 5).inv('Mind rune', 5).series(1),
        });
        expect(r.result.reason).toBe('cast: no free reachable Chicken in the area');
    });
});

/** The prayer tab as the client publishes it: 15 flags, points and the base level. */
const prayerTab = (
    s: BotWorldState,
    p: { active?: number[]; points?: number; level?: number } = {},
): BotWorldState => ({
    ...s,
    prayers: {
        activePrayers: Array.from({ length: 15 }, (_, i) => p.active?.includes(i) ?? false),
        prayerPoints: p.points ?? 30,
        prayerLevel: p.level ?? 43,
    },
});
const MELEE = 14;
/** A toggle flips the prayer's flag from the next tick on, as the client does. */
const prayerReact: TimelineOptions['react'] = (action, state) => {
    if (action.type !== 'togglePrayer') return undefined;
    const next = !state.prayers.activePrayers[action.prayerIndex];
    return s => ({
        ...s,
        prayers: {
            ...s.prayers,
            activePrayers: s.prayers.activePrayers.map((v, i) => (i === action.prayerIndex ? next : v)),
        },
    });
};

const MONK = 'Monk of Zamorak';
const MONK_AREA = { x: 3413, z: 3488, radius: 6 };
const monkParams = { target: MONK, area: MONK_AREA, food: ['Shrimps'] };
/** Three monks of one name, the nearest the weakest, and the bot well above all of them. */
const monks = world()
    .player({ at: { x: 3413, z: 3488 }, combatLevel: 40 })
    .skill('Attack', 40, 0)
    .combatStyle(0)
    .inv('Shrimps', 2)
    .npc(MONK, 3414, 3488, { index: 20, combatLevel: 17, options: ['Attack'] })
    .npc(MONK, 3415, 3488, { index: 21, combatLevel: 22, options: ['Attack'] })
    .npc(MONK, 3415, 3489, { index: 22, combatLevel: 30, options: ['Attack'] });
/** A fight with NPC `index` from tick 2, the kill (and 25 xp) at tick 6. */
const killOf = (w: World, index: number, n = 20) =>
    w.series(n, (f, i) => (i >= 6 ? f.fighting(false).skill('Attack', 40, 25) : i >= 2 ? f.fighting(index) : f));

describe('combat: level filter', () => {
    test('`level` attacks only the NPC of that level, though others of the name stand nearer', async () => {
        const r = await simulate(combat, {
            params: { ...monkParams, level: 30 },
            timeline: killOf(monks, 22),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(attacked(r)).toEqual([22]);
    });

    test('`minLevel` and `maxLevel` bound a range', async () => {
        const r = await simulate(combat, {
            params: { ...monkParams, minLevel: 20, maxLevel: 25 },
            timeline: killOf(monks, 21),
            stops: xp(25),
        });
        expect(attacked(r)).toEqual([21]);
    });

    test('with no NPC of the level around, the run fails after looking, naming the level', async () => {
        const weak = world()
            .player({ at: { x: 3413, z: 3488 }, combatLevel: 40 })
            .skill('Attack', 40, 0)
            .combatStyle(0)
            .inv('Shrimps', 2)
            .npc(MONK, 3414, 3488, { index: 20, combatLevel: 17, options: ['Attack'] });
        const r = await simulate(combat, { params: { ...monkParams, level: 30 }, timeline: weak.series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('fight: no free reachable Monk of Zamorak (level 30) in the area');
        expect(r.sends).toEqual([]);
    });

    test('a monk of another level that is already attacking the bot is fought first', async () => {
        const attacking = monks.npc(MONK, 3414, 3489, {
            index: 23,
            combatLevel: 22,
            options: ['Attack'],
            attacking: true,
        });
        const r = await simulate(combat, {
            params: { ...monkParams, level: 30 },
            timeline: killOf(attacking.player({ lastDamageTick: 0 }).fighting(23), 23),
            stops: xp(25),
        });
        expect(attacked(r)).toEqual([]);
        expect(r.result.reason).toBe('reached +25 Attack xp');
    });
});

describe('combat: stopOnDialog', () => {
    const choice = ['No. He deserves to die.', 'Tell me how to untrap Merlin and I might.'];
    /** A fight that ends on tick 6 with Morgan Le Faye's choice open (the last state repeats). */
    const mordredFalls = coop.series(8, (w, i) => {
        if (i >= 6) return w.fighting(false).dialog({ options: choice });
        return i >= 2 ? w.fighting(CHICKEN) : w;
    });

    test('ends done as the dialog opens and answers nothing, leaving it open', async () => {
        const r = await simulate(combat, { params: { ...PARAMS, stopOnDialog: true }, timeline: mordredFalls });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toMatch(/^dialog-open: dialog opened: No\. He deserves to die\. \| Tell me how/);
        expect(r.sends).toEqual([ATTACK]);
        expect(r.driver.state().dialog.isOpen).toBe(true);
        expect(r.result.stepRuns['interrupt:dialog']).toBeUndefined();
    });

    /** Mordred's "death": the dialog opens with food held, and the fight is still on (he is healed). */
    const stillFightingAt = (hp: number) =>
        coop
            .inv('Shrimps', 3)
            .player({ maxHp: 40, hp: 40 })
            .series(40, (w, i) =>
                i >= 6
                    ? w.fighting(CHICKEN).player({ hp }).dialog({ options: choice })
                    : i >= 2
                      ? w.fighting(CHICKEN)
                      : w,
            );

    // maxHp 40: the eat window is below 20, the hold's floor is 10 (HOLD_HP_FLOOR_FRACTION).
    test('just above the HP floor with the fight still on: no eat, no settle wait, the dialog is still open', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: stillFightingAt(11),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([ATTACK]);
        expect(r.result.reason).not.toMatch(/settled|still in combat/);
        expect(r.result.stepRuns['interrupt:low-hp']).toBeUndefined();
        expect(r.driver.state().dialog.isOpen).toBe(true);
        expect(r.driver.state().tick).toBeLessThan(12);
    });

    test('at the HP floor the dialog does not hold: the guard eats', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: stillFightingAt(10),
        });
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('below the HP floor the end-of-run settle and eat run even with the dialog open', async () => {
        // The dialog opens at tick 6 and ends the run; the fight goes on, so finish() settles and eats.
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: stillFightingAt(5),
        });
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('low HP in a fight with no dialog open still eats', async () => {
        const noDialog = coop
            .inv('Shrimps', 3)
            .series(40, (w, i) => (i >= 2 ? w.fighting(CHICKEN).player({ hp: 3 }) : w));
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: noDialog,
            stops: xp(25),
        });
        expect(r.sends).toContain('Eat Shrimps');
    });

    test('the fight ending a tick or two before the dialog shows does not send a second attack', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(12, (w, i) =>
                i >= 8
                    ? w.fighting(false).dialog({ options: choice })
                    : i >= 6
                      ? w.fighting(false)
                      : i >= 2
                        ? w.fighting(CHICKEN)
                        : w,
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([ATTACK]);
        expect(r.driver.state().dialog.isOpen).toBe(true);
    });

    test('without it the dialog guard declines the choice nobody took (the decline that kills Mordred)', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: mordredFalls });
        expect(r.sends).toContain('decline stray choice');
    });

    test('a level-up box mid-fight is clicked away and the fight goes on', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: kill(coop, 20, 8, (w, i) =>
                i === 4
                    ? w.dialog({
                          text: 'Congratulations, you just advanced an attack level.',
                          options: ['Click here to continue'],
                      })
                    : w,
            ),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK, 'continue level-up dialog']);
    });

    test('the unlock page after a level-up click is clicked away too; a real quest dialog after it ends the run', async () => {
        const levelUp = {
            text: 'Congratulations, you just advanced an attack level.',
            options: ['Click here to continue'],
        };
        const unlock = { text: 'You can now wield Steel Weaponry!', options: ['Click here to continue'] };
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(16, (w, i) => {
                if (i >= 10) return w.fighting(false).dialog({ options: ['No. He deserves to die.', 'Ok then.'] });
                if (i >= 8) return w.fighting(CHICKEN).dialog(unlock);
                if (i >= 6) return w.fighting(CHICKEN).dialog(levelUp);
                return i >= 2 ? w.fighting(CHICKEN) : w;
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('dialog-open: dialog opened: No. He deserves to die. | Ok then.');
        expect(r.sends).toEqual([ATTACK, 'continue level-up dialog', 'continue level-up dialog']);
    });

    test('an "advanced" wording is needed: bare "Congratulations" from a quest NPC ends the run', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(8, (w, i) =>
                i >= 6
                    ? w.fighting(false).dialog({ text: 'Congratulations, you have done it!', options: ['Thanks'] })
                    : i >= 2
                      ? w.fighting(CHICKEN)
                      : w,
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('Congratulations, you have done it!');
        expect(r.sends).toEqual([ATTACK]);
    });

    test('an unlock-wording dialog with no level-up click before it is a quest dialog', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(8, (w, i) =>
                i >= 6
                    ? w.fighting(false).dialog({ text: 'You can now go through the door.', options: ['Ok'] })
                    : i >= 2
                      ? w.fighting(CHICKEN)
                      : w,
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([ATTACK]);
    });

    test('a dialog open before any fight fails the run instead of ending it done', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(3, w => w.dialog({ options: ['Yes', 'No'] })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('dialog-open: dialog open before any fight: Yes | No');
        expect(r.sends).toEqual([]);
    });

    test('a level-up in front of the quest dialog is clicked once, and the quest dialog is left open', async () => {
        const levelUp = {
            text: 'Congratulations, you just advanced a strength level.',
            options: ['Click here to continue'],
        };
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop.series(14, (w, i) => {
                if (i >= 8) return w.fighting(false).dialog({ options: ['No. He deserves to die.', 'Ok then.'] });
                if (i >= 6) return w.fighting(false).dialog(levelUp);
                return i >= 2 ? w.fighting(CHICKEN) : w;
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('dialog-open: dialog opened: No. He deserves to die. | Ok then.');
        expect(r.sends).toEqual([ATTACK, 'continue level-up dialog']);
    });
});

/** Toggles prayers on, but ignores a toggle off. */
const onOnly: TimelineOptions['react'] = (a, s) =>
    a.type === 'togglePrayer' && s.prayers.activePrayers[a.prayerIndex] ? undefined : prayerReact(a, s);

const tab = (ws: BotWorldState[], p?: Parameters<typeof prayerTab>[1]) => ws.map(s => prayerTab(s, p));

describe('combat: stopOnDialog failures and wording', () => {
    const levelUp = {
        text: 'Congratulations, you just advanced an attack level.',
        options: ['Click here to continue'],
    };
    const levelUpWorld = coop.series(30, (w, i) =>
        i >= 6 ? w.fighting(false).dialog(levelUp) : i >= 2 ? w.fighting(CHICKEN) : w,
    );

    test('a level-up page whose click is rejected three times fails with the send message', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: levelUpWorld,
            respond: a => (a.type === 'clickDialogOption' ? { success: false, message: 'not connected' } : undefined),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('dialog-open: level-up dialog would not clear: not connected');
        expect(r.sends.filter(s => s === 'continue level-up dialog')).toHaveLength(3);
    });

    test('a level-up page that never changes after three clicks fails without a suffix', async () => {
        const r = await simulate(combat, { params: { ...PARAMS, stopOnDialog: true }, timeline: levelUpWorld });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('dialog-open: level-up dialog would not clear');
    });

    test("the reason names what the NPC says, not the page's continue button (Mordred's Morgan)", async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, stopOnDialog: true },
            timeline: coop
                .series(10, (w, i) =>
                    i >= 6
                        ? w.fighting(false).dialog({ options: ['Click here to continue'] })
                        : i >= 2
                          ? w.fighting(CHICKEN)
                          : w,
                )
                .map((s, i) =>
                    i < 6
                        ? s
                        : {
                              ...s,
                              dialog: {
                                  ...s.dialog,
                                  allComponents: [
                                      'Morgan Le Faye',
                                      'STOP! Please... spare my son.',
                                      'Click here to continue',
                                  ].map((text, id) => ({ id, type: 4, buttonType: 0, option: '', text })),
                              },
                          },
                ),
        });
        expect(r.result.reason).toBe('dialog-open: dialog opened: Morgan Le Faye | STOP! Please... spare my son.');
    });
});

describe('combat: prayers', () => {
    const params = { ...PARAMS, prayers: ['Protect from Melee'] };

    test('turns the prayer on as the target comes within reach, and off when the run ends', async () => {
        const r = await simulate(combat, {
            params,
            timeline: tab(kill(coop, 20, 6)),
            react: prayerReact,
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual(['Protect from Melee on', ATTACK, 'Protect from Melee off']);
        expect(r.steps.slice(0, 2)).toEqual(['prayer-on', 'fight']);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(false);
    });

    test('a far target gets the prayer before the walk and the attack, so the first hit lands protected', async () => {
        const r = await simulate(combat, {
            params,
            timeline: tab(kill(chickenAt(base, COOP.x + 5, COOP.z), 30, 10)),
            react: walking(prayerReact),
            stops: xp(25),
        });
        expect(r.sends).toEqual([
            'Protect from Melee on',
            `walk to (${COOP.x + 5}, ${COOP.z})`,
            ATTACK,
            'Protect from Melee off',
        ]);
    });

    test('a prayer already on is left alone, and not ours to turn off at the end', async () => {
        const r = await simulate(combat, {
            params,
            timeline: tab(kill(coop, 20, 6), { active: [MELEE] }),
            react: prayerReact,
            stops: xp(25),
        });
        expect(r.sends).toEqual([ATTACK]);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(true);
    });

    test('stopOnDialog leaves the prayer on under the open quest dialog and names it in the reason', async () => {
        const choice = ['No. He deserves to die.', 'Tell me how to untrap Merlin and I might.'];
        const timeline = tab(
            coop.series(10, (w, i) => {
                if (i >= 6) return w.fighting(false).dialog({ options: choice });
                return i >= 2 ? w.fighting(CHICKEN) : w;
            }),
        );
        const r = await simulate(combat, {
            params: { ...params, stopOnDialog: true },
            timeline,
            react: prayerReact,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(
            `dialog-open: dialog opened: ${choice.join(' | ')}; prayers still on: Protect from Melee`,
        );
        expect(r.sends).toEqual(['Protect from Melee on', ATTACK]);
        expect(r.driver.state().dialog.isOpen).toBe(true);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(true);
    });

    test('Protect Item is the game spelling, and the sdk spelling is accepted too', async () => {
        for (const prayers of [['Protect Item'], ['Protect Items']]) {
            const r = await simulate(combat, {
                params: { ...PARAMS, prayers },
                timeline: tab(kill(coop, 20, 6), { level: 20 }),
            });
            expect(r.result.reason).toMatch(/^preflight: Protect Items? needs Prayer 25, the bot has 20$/);
        }
    });

    test('a toggle that will not turn the prayer off at the end is logged', async () => {
        const r = await simulate(combat, { params, timeline: tab(kill(coop, 40, 6)), react: onOnly, stops: xp(25) });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(logged(r)).toContain('could not turn Protect from Melee off: Protect from Melee did not turn off');
    });

    test('a level-up page open when the run stops does not keep the prayer on', async () => {
        const levelUp = {
            text: 'Congratulations, you just advanced an attack level.',
            options: ['Click here to continue'],
        };
        const r = await simulate(combat, {
            params,
            timeline: tab(kill(coop, 20, 6, (w, i) => (i === 5 ? w.dialog(levelUp) : w))),
            react: prayerReact,
            stops: xp(25),
        });
        expect(r.sends.at(-1)).toBe('Protect from Melee off');
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(false);
    });

    test('the unlock page after a level-up click does not keep the prayer on either', async () => {
        const levelUp = {
            text: 'Congratulations, you just advanced an attack level.',
            options: ['Click here to continue'],
        };
        const unlock = { text: 'You can now wield Steel Weaponry!', options: ['Click here to continue'] };
        const r = await simulate(combat, {
            params: { ...params, stopOnDialog: true },
            timeline: tab(
                coop.series(20, (w, i) => {
                    if (i >= 9) return w.fighting(false).dialog(unlock).skill('Attack', 1, 25);
                    if (i >= 8) return w.fighting(false).dialog(unlock);
                    if (i >= 6) return w.fighting(CHICKEN).dialog(levelUp);
                    return i >= 2 ? w.fighting(CHICKEN) : w;
                }),
            ),
            react: prayerReact,
            stops: xp(25),
        });
        expect(r.sends).toEqual([
            'Protect from Melee on',
            ATTACK,
            'continue level-up dialog',
            'continue level-up dialog',
            'Protect from Melee off',
        ]);
        expect(r.driver.state().prayers.activePrayers[MELEE]).toBe(false);
    });

    test('two prayers that switch each other off are an invalid param', async () => {
        for (const prayers of [
            ['Protect from Melee', 'Protect from Missiles'],
            ['Thick Skin', 'Steel Skin'],
            ['Burst of Strength', 'Ultimate Strength'],
            ['Clarity of Thought', 'Improved Reflexes'],
        ]) {
            const r = await simulate(combat, { params: { ...PARAMS, prayers }, timeline: coop.series(1) });
            expect(r.result.status).toBe('error');
            expect(r.result.reason).toContain('prayers switch each other off');
        }
        const ok = await simulate(combat, {
            params: { ...PARAMS, prayers: ['Thick Skin', 'Burst of Strength', 'Clarity of Thought'] },
            timeline: tab(coop.series(1), { level: 20 }),
        });
        expect(ok.result.reason).not.toContain('switch each other off');
    });

    test('running out of prayer points mid-fight fails the run, and the prayer is turned off', async () => {
        const w = kill(coop, 30, 20);
        const timeline = w.map((s, i) => prayerTab(s, { active: i < 8 ? [MELEE] : [], points: i < 8 ? 3 : 0 }));
        const r = await simulate(combat, { params, timeline, react: prayerReact });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('out-of-prayer: out of prayer points');
    });

    test('a failing toggle fails the run after three tries', async () => {
        const r = await simulate(combat, {
            params,
            timeline: tab(coop.series(1)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^prayer-on: could not turn Protect from Melee on: Protect from Melee did not turn on$/,
        );
        expect(r.sends).toEqual(Array<string>(3).fill('Protect from Melee on'));
    });

    test('preflight refuses a prayer the level does not allow, and an empty prayer tab', async () => {
        const low = await simulate(combat, { params, timeline: tab(coop.series(1), { level: 20 }) });
        expect(low.result.reason).toBe('preflight: Protect from Melee needs Prayer 43, the bot has 20');
        const dry = await simulate(combat, { params, timeline: tab(coop.series(1), { points: 0 }) });
        expect(dry.result.reason).toBe('preflight: no prayer points left for prayers');
    });

    test('an unknown prayer name is an invalid param', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, prayers: ['Protect from Fire'] },
            timeline: coop.series(1),
        });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('not a prayer name');
    });
});

/** No chicken until tick `at`, then one beside the bot. */
const respawns = (at: number) => base.series(at + 10, (w, i) => (i >= at ? chickenAt(w) : w).fighting(false));
const kills = (at: number) =>
    base.series(at + 20, (w, i) => {
        if (i < at) return w;
        const f = chickenAt(w);
        return i >= at + 14 ? f.fighting(false).skill('Attack', 1, 25) : i >= at + 8 ? f.fighting(CHICKEN) : f;
    });

describe('combat: level params', () => {
    test('minLevel above maxLevel, and `level` with a range, are invalid params', async () => {
        for (const extra of [
            { minLevel: 30, maxLevel: 20 },
            { level: 30, minLevel: 20 },
            { level: 30, maxLevel: 40 },
        ]) {
            const r = await simulate(combat, { params: { ...PARAMS, ...extra }, timeline: coop.series(1) });
            expect(r.result.status).toBe('error');
        }
        const ok = await simulate(combat, {
            params: { ...PARAMS, minLevel: 1, maxLevel: 5 },
            timeline: kill(coop),
            stops: xp(25),
        });
        expect(ok.result.status).toBe('done');
    });
});

describe('combat: respawnWaitTicks', () => {
    test('by default a target that returns after 100 ticks is too late: the run fails after the usual looks', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: respawns(100) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in the area');
        expect(r.driver.state().tick).toBeLessThan(100);
    });

    test('with respawnWaitTicks the loop waits for the target and then fights it', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, respawnWaitTicks: 150 },
            timeline: kills(100),
            stops: xp(25),
        });
        expect(r.result.reason).toBe('reached +25 Attack xp');
        expect(r.sends).toEqual([ATTACK]);
    });

    test('and fails once the wait is used up', async () => {
        const r = await simulate(combat, { params: { ...PARAMS, respawnWaitTicks: 150 }, timeline: respawns(400) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in the area');
        expect(r.driver.state().tick).toBeGreaterThanOrEqual(140);
        expect(r.driver.state().tick).toBeLessThan(170);
    });

    test('is capped, so a huge wait is an invalid param', async () => {
        const r = await simulate(combat, { params: { ...PARAMS, respawnWaitTicks: 5000 }, timeline: coop.series(1) });
        expect(r.result.status).toBe('error');
    });
});

/** 49 max HP, `n` Chickens (the target) all fighting the bot, at `hp`; the fight dies out at tick 8. */
const swarm = (n: number, hp: number) => {
    let w = base.player({ maxHp: 49, hp, inCombat: true, lastDamageTick: 0 }).inv('Shrimps', 6);
    for (let k = 0; k < n; k++)
        w = w.npc('Chicken', COOP.x + 1, COOP.z + k, {
            index: CHICKEN + k,
            options: ['Attack'],
            attacking: true,
            combatLevel: 1,
        });
    return w.series(12, (f, i) =>
        i >= 8 ? f.fighting(false).skill('Attack', 1, 25) : f.player({ lastDamageTick: 0 }),
    );
};

describe('combat: the low-HP line rises with the attackers on the bot', () => {
    test('three attackers at 30/49 (61%): the guard eats before the first attack', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'], eatBelow: 0.1 },
            timeline: swarm(3, 30),
            react: healing(5),
            stops: xp(25),
        });
        expect(r.sends[0]).toBe('Eat Shrimps');
    });

    test('a single attacker at 30/49 is not over-eaten: it fights on', async () => {
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'], eatBelow: 0.1 },
            timeline: swarm(1, 30),
            stops: xp(25),
        });
        expect(r.sends).not.toContain('Eat Shrimps');
        expect(r.result.reason).toBe('reached +25 Attack xp');
    });
});

describe('combat: an eat the server ignored under fire', () => {
    test('is sent again after a short wait, not after the full eat wait', async () => {
        let ignored = false;
        const healingReact = healing(20)!;
        const react: TimelineOptions['react'] = (action, state) => {
            if (!ignored && action.type === 'useInventoryItem') {
                ignored = true; // the server's 2-tick eat delay: no message, no effect
                return undefined;
            }
            return healingReact(action, state);
        };
        const hurt = swarm(3, 10);
        const r = await simulate(combat, {
            params: { ...PARAMS, food: ['Shrimps'], eatBelow: 0.1 },
            timeline: hurt,
            react,
            stops: xp(25),
        });
        expect(r.sends.slice(0, 2)).toEqual(['Eat Shrimps', 'Eat Shrimps']);
        expect(r.result.reason).toBe('reached +25 Attack xp');
    });
});

describe('combat: seenOutsideArea diagnostic', () => {
    /** The only chicken stands 12 tiles out, beyond the area (radius 8). */
    const outside = chickenAt(base, COOP.x + 12, COOP.z);
    /** Twenty looks of three ticks, the last one ends the run. */
    const IDLE = 19 * 3;

    test('a free chicken in view outside the area while idle warns, naming its tile', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: outside.series(1) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in the area');
        expect(r.result.diagnostics).toEqual({
            idleTicks: IDLE,
            seenOutsideAreaTicks: IDLE,
            nearestOutsideArea: { name: 'Chicken', x: COOP.x + 12, z: COOP.z },
        });
        expect(r.result.warnings).toHaveLength(1);
        expect(r.result.warnings?.[0]).toContain('seenOutsideArea');
        expect(r.result.warnings?.[0]).toContain(`(${COOP.x + 12},${COOP.z})`);
        expect(r.result.warnings?.[0]).toContain('widen the area to radius 12');
        expect(r.sends).toEqual([]);
    });

    test('the warning needs more than a tenth of the idle ticks', async () => {
        // Seen for the first 3 of 57 idle ticks (one look, 5%), then gone.
        const r = await simulate(combat, {
            params: PARAMS,
            timeline: base.series(30, (w, i) => (i < 3 ? chickenAt(w, COOP.x + 12, COOP.z) : w)),
        });
        expect(r.result.diagnostics?.idleTicks).toBe(IDLE);
        expect(r.result.diagnostics?.seenOutsideAreaTicks).toBe(3);
        expect(r.result.warnings).toBeUndefined();
        // Two looks (6 of 57 idle ticks, 10.5%) cross the line.
        const more = await simulate(combat, {
            params: PARAMS,
            timeline: base.series(30, (w, i) => (i < 6 ? chickenAt(w, COOP.x + 12, COOP.z) : w)),
        });
        expect(more.result.diagnostics?.seenOutsideAreaTicks).toBe(6);
        expect(more.result.warnings).toHaveLength(1);
    });

    test('nothing outside the area: counts idle ticks, no warning', async () => {
        const taken = base.npc('Chicken', COOP.x + 1, COOP.z, { options: ['Attack'], inCombat: true });
        const r = await simulate(combat, { params: PARAMS, timeline: taken.series(1) });
        expect(r.result.diagnostics).toEqual({ idleTicks: IDLE, seenOutsideAreaTicks: 0 });
        expect(r.result.warnings).toBeUndefined();
    });

    test('an outside chicken that is busy, unreachable or of another kind does not count', async () => {
        const w = base
            .npc('Chicken', COOP.x + 12, COOP.z, { index: 9, options: ['Attack'], inCombat: true })
            .npc('Chicken', COOP.x + 13, COOP.z, { index: 10, options: ['Attack'], reachable: false })
            .npc('Cow', COOP.x + 14, COOP.z, { index: 11, options: ['Attack'] });
        const r = await simulate(combat, { params: PARAMS, timeline: w.series(1) });
        expect(r.result.diagnostics?.seenOutsideAreaTicks).toBe(0);
        expect(r.result.warnings).toBeUndefined();
    });

    test('a successful kill with no idling reports nothing', async () => {
        const r = await simulate(combat, { params: PARAMS, timeline: kill(coop), react: walking(), stops: xp(25) });
        expect(r.result.status).toBe('done');
        expect(r.result.diagnostics).toBeUndefined();
        expect(r.result.warnings).toBeUndefined();
    });

    test('visible mode takes those targets, so nothing is counted', async () => {
        const w = base.npc('Chicken', COOP.x + 12, COOP.z, { index: 9, options: ['Attack'], inCombat: true });
        const r = await simulate(combat, { params: { ...PARAMS, targetRange: 'visible' }, timeline: w.series(1) });
        expect(r.result.reason).toBe('fight: no free reachable Chicken in view');
        expect(r.result.diagnostics?.seenOutsideAreaTicks).toBe(0);
        expect(r.result.warnings).toBeUndefined();
    });

    describe('near the Wilderness', () => {
        const EDGE = { x: 3100, z: 3490 };
        const edgeParams = { target: 'Chicken', area: { ...EDGE, radius: 4 } };
        const edge = world().player({ at: EDGE }).skill('Attack', 1, 0).combatStyle(0);

        test('a chicken within three tiles of it is not counted; a further one is', async () => {
            const near = edge.npc('Chicken', EDGE.x, 3518, { index: CHICKEN, options: ['Attack'] });
            const a = await simulate(combat, { params: edgeParams, timeline: near.series(1) });
            expect(a.result.diagnostics?.seenOutsideAreaTicks).toBe(0);
            expect(a.result.warnings).toBeUndefined();
            const far = edge.npc('Chicken', EDGE.x, 3512, { index: CHICKEN, options: ['Attack'] });
            const b = await simulate(combat, { params: edgeParams, timeline: far.series(1) });
            expect(b.result.warnings).toHaveLength(1);
        });
    });
});
