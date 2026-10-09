import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { ATTACK_WAIT_TICKS } from '../../actions/attack';
import { type Effect, TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import type { StopCondition } from '../../lib/stop';
import combat from '../../tasks/combat';
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
