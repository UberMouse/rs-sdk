import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { PICKPOCKET_ACK_TICKS, PICKPOCKET_RESOLVE_TICKS, STUN_TICKS } from '../../actions/pickpocket';
import { WALK_MAX_TICKS } from '../../actions/walk';
import type { Effect } from '../../core/drivers/timeline';
import type { StopCondition } from '../../lib/stop';
import { stepBudgetTicks } from '../../lib/task';
import thieving, { AFTER_WALK_TICKS, PICKPOCKET_LEVELS } from '../../tasks/thieving';
import { fakePaths } from '../paths';
import { consume, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const SPOT = { x: 3222, z: 3218 };
const AREA = { x: SPOT.x, z: SPOT.z, radius: 6 };
const PARAMS = { npc: 'Man', area: AREA };
const MAN = 5;
const PICK = 'Pickpocket Man';
const base = world().player({ at: SPOT }).skill('Thieving', 1, 0);
const manAt = (w: World, x = SPOT.x + 1, z = SPOT.z, index = MAN) =>
    w.npc('Man', x, z, { index, options: ['Talk-to', 'Attack', 'Pickpocket'] });
const castle = manAt(base);
const xp = (amount: number): StopCondition[] => [{ kind: 'xp', skill: 'Thieving', amount }];
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const noRoute = fakePaths(() => ({ success: false, waypoints: [], error: 'no path' }));

const text = (t: string) => ({ type: 0, text: t, sender: '', tick: 0, fromSelf: false }) as const;

const say = (s: BotWorldState, at: number, t: string) =>
    s.tick >= at && !s.gameMessages.some(m => m.tick === at && m.text === t)
        ? [...s.gameMessages, { ...text(t), tick: at }]
        : s.gameMessages;

type Outcome = 'success' | 'caught' | 'ignored' | 'combat';

/**
 * The server's side of a pickpocket: each interactNpc is answered by the next of `outcomes` (the last
 * repeats), as the real script does, but a send inside the stun of an earlier `caught` is dropped
 * silently. `sendTicks` records when each send arrived.
 */
function thief(outcomes: Outcome[], inner: (a: BotAction, s: BotWorldState) => Effect | undefined = consume) {
    const sendTicks: number[] = [];
    let n = 0;
    let total = 0;
    let stunnedUntil = -1;
    const react = (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type !== 'interactNpc') return inner(action, state);
        const from = state.tick;
        sendTicks.push(from);
        if (from < stunnedUntil) return undefined;
        const outcome = outcomes[Math.min(n++, outcomes.length - 1)]!;
        if (outcome === 'ignored') return undefined;
        if (outcome === 'combat')
            return st => ({ ...st, gameMessages: say(st, from + 1, "You can't pickpocket during combat.") });
        if (outcome === 'caught') stunnedUntil = from + 3 + STUN_TICKS;
        else total += 8;
        const mine = total;
        return s => {
            let gameMessages = say(s, from + 1, "You attempt to pick the man's pocket.");
            if (outcome === 'caught') {
                const at = from + 3;
                const msgs =
                    s.tick >= at ? [...gameMessages, { ...text("You've been stunned!"), tick: at }] : gameMessages;
                gameMessages = msgs.filter((m, i) => msgs.findIndex(o => o.tick === m.tick && o.text === m.text) === i);
                return { ...s, gameMessages };
            }
            const skills = s.tick >= from + 3 ? world(s).skill('Thieving', 1, mine).build().skills : s.skills;
            return { ...s, gameMessages, skills };
        };
    };
    return { react, sendTicks };
}

describe('thieving: pickpocketing', () => {
    test('picks the nearest free reachable Man in the area, repeatedly', async () => {
        const far = manAt(castle, SPOT.x + 3, SPOT.z, 8);
        const busy = far.npc('Man', SPOT.x, SPOT.z + 1, { index: 9, options: ['Pickpocket'], inCombat: true });
        const outside = busy.npc('Man', SPOT.x + 9, SPOT.z, { index: 10, options: ['Pickpocket'] });
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: outside.series(1),
            react: t.react,
            stops: xp(24),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +24 Thieving xp');
        expect(r.sends).toEqual([PICK, PICK, PICK]);
        const targets = r.driver.commands.flatMap(c =>
            c.type === 'send' && c.action.type === 'interactNpc' ? [c.action.npcIndex] : [],
        );
        expect(targets).toEqual([MAN, MAN, MAN]);
        expect(r.steps.every(s => s === 'pickpocket')).toBe(true);
        expect(logged(r)).toEqual([]);
    });

    test('a Man further than two tiles is walked to first', async () => {
        const t = thief(['success'], walking());
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: manAt(base, SPOT.x + 5, SPOT.z).series(1),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.sends).toEqual([`walk to (${SPOT.x + 5}, ${SPOT.z})`, PICK]);
    });

    test('a caught attempt waits out the stun before the next send', async () => {
        const t = thief(['caught', 'success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(1),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.sends).toEqual([PICK, PICK]);
        // Resolved 3 ticks after the first send; nothing goes out until STUN_TICKS later.
        expect(t.sendTicks[1]! - t.sendTicks[0]!).toBeGreaterThanOrEqual(3 + STUN_TICKS);
        expect(r.steps).toEqual(['pickpocket', 'stunned', 'pickpocket']);
        expect(logged(r)).toEqual([]);
    });

    test('a guard abort mid-stun (low HP, eat) resumes the stun wait, not an early send', async () => {
        const t = thief(['caught', 'success'], (a, s) => consume(a, s));
        // HP falls to 4 of 10 on the stun's damage; the eat heals 3.
        const heal: typeof t.react = (a, s) => {
            const used = t.react(a, s);
            if (a.type !== 'useInventoryItem' || !used) return used;
            return st => {
                const u = used(st);
                return u.player ? { ...u, player: { ...u.player, hp: Math.min(u.player.maxHp, u.player.hp + 3) } } : u;
            };
        };
        const r = await simulate(thieving, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: castle.inv('Shrimps', 2).series(80, (w, i) => (i >= 4 ? w.player({ hp: 4 }) : w)),
            react: heal,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.sends).toContain('Eat Shrimps');
        const picks = t.sendTicks;
        expect(picks.length).toBe(2);
        expect(picks[1]! - picks[0]!).toBeGreaterThanOrEqual(3 + STUN_TICKS);
    });

    test('HP under eatBelow but over half: the eat step eats between attempts', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: castle
                .inv('Shrimps', 2)
                .series(1)
                .map(s => world(s).player({ hp: 5 }).build()),
            react: t.react,
            stops: xp(8),
        });
        expect(r.sends[0]).toBe('Eat Shrimps');
        expect(r.steps[0]).toBe('eat');
    });

    test('without food and in combat (targeting the Man), low HP waits to regenerate instead of failing', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(120, (w, i) => w.player({ hp: i < 40 ? 6 : 8, inCombat: i >= 3 })),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.steps[0]).toBe('regen');
        expect(t.sendTicks[0]!).toBeGreaterThanOrEqual(40);
        expect(logged(r)).toEqual(['no food, hp 6/10: waiting to regenerate']);
    });

    test('without food, HP that never regenerates fails with a clear reason', async () => {
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(5, (w, i) => w.player({ hp: 6, inCombat: i >= 3 })),
            stops: xp(8),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('regen: no food, hp 6/10, not regenerating after 800 ticks');
        expect(r.sends).toEqual([]);
    });

    test('with food held, HP just above the engine line does not trigger the regen wait', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: { ...PARAMS, food: ['Shrimps'] },
            timeline: castle.inv('Shrimps', 1).series(1, w => w.player({ hp: 6 })),
            react: t.react,
            stops: xp(8),
        });
        expect(r.steps).not.toContain('regen');
    });

    test('with no area, a Man in the Wilderness is never picked', async () => {
        const r = await simulate(thieving, {
            params: { npc: 'Man' },
            timeline: base.npc('Man', 3222, 3600, { index: 11, options: ['Pickpocket'] }).series(1),
            react: consume,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/no free reachable Man in view/);
        expect(r.sends).toEqual([]);
    });
});

describe('thieving: failure streaks', () => {
    test('attempts the server ignores wait a stun and fail after four', async () => {
        const t = thief(['ignored']);
        const r = await simulate(thieving, { params: PARAMS, timeline: castle.series(1), react: t.react });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^pickpocket: 4 pickpockets in a row refused \(last: Pickpocket never started/);
        expect(r.sends).toEqual(Array<string>(4).fill(PICK));
        expect(t.sendTicks[1]! - t.sendTicks[0]!).toBeGreaterThanOrEqual(PICKPOCKET_ACK_TICKS + STUN_TICKS);
    });

    test('a refused combat message counts the same way', async () => {
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(400, (w, i) => (i % 2 ? w.message("You can't pickpocket during combat.") : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^pickpocket: 4 pickpockets in a row refused \(last: Cannot pickpocket Man during combat/,
        );
    });

    test('six refused sends in a row fail the run', async () => {
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.reason).toBe('pickpocket: 6 pickpockets in a row failed (last: not connected)');
        expect(r.sends).toEqual(Array<string>(6).fill(PICK));
    });

    test('a success in between resets the count', async () => {
        // Sends 1-5 and 7-11 are refused, 6 and 12 go through and pay.
        let sent = 0;
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(1),
            respond: a => {
                if (a.type !== 'interactNpc') return undefined;
                sent++;
                return sent % 6 === 0 ? undefined : { success: false, message: 'not connected' };
            },
            react: t.react,
            stops: xp(16),
        });
        expect(r.result.reason).toBe('reached +16 Thieving xp');
        expect(sent).toBe(12);
    });

    test('the Man walking off mid-attempt is a failed attempt; the bot picks again when he is back', async () => {
        const t = thief(['ignored', 'success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            // Gone from tick 1 to 14, then back.
            timeline: castle.series(60, (w, i) => (i >= 1 && i < 14 ? base : w)),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(logged(r)[0]).toBe('pickpocket Man failed: Man left view before the attempt');
    });

    test('no Man in the area waits, then fails after a hundred looks', async () => {
        const r = await simulate(thieving, { params: PARAMS, timeline: base.series(1) });
        expect(r.result.reason).toBe('pickpocket: no free reachable Man in the area after 100 looks');
        expect(r.driver.state().tick).toBe(99 * 3);
        expect(r.sends).toEqual([]);
    });

    test('a Man that wanders back into the area after a long gap is picked, not a failure', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: base.series(200, (w, i) => (i >= 150 ? manAt(w) : w)),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.sends).toContain(PICK);
    });

    test('waiting away from the area centre walks back to it, then picks the Man who arrives', async () => {
        const edge = { x: SPOT.x + 5, z: SPOT.z };
        const t = thief(['success'], walking());
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: world()
                .player({ at: edge })
                .skill('Thieving', 1, 0)
                .series(120, (w, i) => (i >= 100 ? manAt(w, SPOT.x + 1, SPOT.z) : w)),
            react: walking(t.react),
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(logged(r).some(m => String(m).includes('walking back toward the area centre'))).toBe(true);
        expect(r.driver.state().player?.worldX).toBeLessThan(edge.x);
    });

    test('a Man outside the area or already fighting is no target', async () => {
        const w = manAt(base, SPOT.x + 9, SPOT.z).npc('Man', SPOT.x, SPOT.z + 1, {
            options: ['Pickpocket'],
            inCombat: true,
        });
        const r = await simulate(thieving, { params: PARAMS, timeline: w.series(1) });
        expect(r.result.reason).toBe('pickpocket: no free reachable Man in the area after 100 looks');
    });

    test('a failed walk to the Man is a failed attempt', async () => {
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: manAt(base, SPOT.x + 5, SPOT.z).series(1),
            pathfinder: noRoute,
        });
        expect(r.result.reason).toMatch(/^pickpocket: 6 pickpockets in a row failed \(last: Cannot reach Man: No path/);
        expect(r.sends).toEqual([]);
    });
});

describe('thieving: inventory, guards and area', () => {
    test('stopWhenFull ends the run done on a full inventory; without it the run carries on', async () => {
        let full = base;
        for (let i = 0; i < 28; i++) full = full.inv(`Junk ${i}`, 1, { id: 2000 + i });
        const r = await simulate(thieving, {
            params: { ...PARAMS, stopWhenFull: true },
            timeline: manAt(full).series(1),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-full: inventory full');
        expect(r.sends).toEqual([]);
        const t = thief(['success']);
        const more = await simulate(thieving, {
            params: PARAMS,
            timeline: manAt(full).series(1),
            react: t.react,
            stops: xp(8),
        });
        expect(more.result.reason).toBe('reached +8 Thieving xp');
    });

    test('refused for combat: waits a stun-length, then picks again once the fight is over', async () => {
        const t = thief(['combat', 'success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(1),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
        expect(r.sends).toEqual([PICK, PICK]);
        expect(t.sendTicks[1]! - t.sendTicks[0]!).toBeGreaterThanOrEqual(1 + STUN_TICKS);
        expect(logged(r)).toEqual(['pickpocket Man failed: Cannot pickpocket Man during combat']);
    });

    test('a level-up dialog after a success is cleared and the run goes on', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: PARAMS,
            timeline: castle.series(30, (w, i) => (i === 5 ? w.dialog({ options: ['Click here to continue'] }) : w)),
            react: t.react,
            stops: xp(16),
        });
        expect(r.result.reason).toBe('reached +16 Thieving xp');
        expect(r.sends).toContain('continue dialog');
    });

    test('outside the area walks back before picking', async () => {
        const r = await simulate(thieving, {
            params: { ...PARAMS, area: { x: 3300, z: 3300, radius: 4 } },
            timeline: castle.series(3),
            pathfinder: noRoute,
        });
        expect(r.steps[0]).toBe('return-to-area');
        expect(r.sends).toEqual([]);
    });

    test('without an area any Man in view is picked', async () => {
        const t = thief(['success']);
        const r = await simulate(thieving, {
            params: { npc: 'man' },
            timeline: manAt(base, SPOT.x + 1, SPOT.z).series(1),
            react: t.react,
            stops: xp(8),
        });
        expect(r.result.reason).toBe('reached +8 Thieving xp');
    });
});

const refusal = async (w: World, params: object = PARAMS) =>
    (await simulate(thieving, { params, timeline: w.series(1) })).result.reason;

describe('thieving: preflight', () => {
    test('refuses an NPC above the Thieving level', async () => {
        expect(await refusal(castle, { npc: 'Farmer' })).toBe('preflight: Farmer needs thieving 10, bot has 1');
        expect(await refusal(castle.skill('Thieving', 9, 500), { npc: 'farmer' })).toBe(
            'preflight: farmer needs thieving 10, bot has 9',
        );
        expect(await refusal(castle.skill('Thieving', 80, 0), { npc: 'Hero' })).not.toMatch(/^preflight/);
    });

    test('refuses an NPC with no pickpocket config', async () => {
        expect(await refusal(castle, { npc: 'Chicken' })).toMatch(/^preflight: Chicken has no pickpocket config/);
    });

    test('refuses an area reaching the Wilderness', async () => {
        expect(await refusal(castle, { npc: 'Man', area: { x: 3100, z: 3530, radius: 5 } })).toBe(
            'preflight: area (3100,3530) radius 5 reaches the Wilderness',
        );
    });
});

describe('thieving: tables and budget', () => {
    test('every level in PICKPOCKET_LEVELS is one the engine config gives, and the config has no other level', () => {
        const dbrow = readFileSync(
            new URL(
                '../../../server/content/scripts/skill_thieving/configs/pickpocking/pickpocket.dbrow',
                import.meta.url,
            ),
            'utf8',
        );
        const engine = new Set([...dbrow.matchAll(/^data=level,(\d+)$/gm)].map(m => Number(m[1])));
        const ours = new Set(Object.values(PICKPOCKET_LEVELS));
        for (const level of ours) expect(engine.has(level)).toBe(true);
        // Only the Viking quest NPCs (level 45) are left out of the table.
        expect([...engine].filter(l => !ours.has(l))).toEqual([45]);
    });

    test('the pickpocket step fits its longest walk and the attempt after it', () => {
        expect(AFTER_WALK_TICKS).toBeGreaterThanOrEqual(1 + PICKPOCKET_ACK_TICKS + PICKPOCKET_RESOLVE_TICKS);
        expect(stepBudgetTicks(thieving.stepTimeoutMs ?? 0)).toBeGreaterThanOrEqual(WALK_MAX_TICKS + AFTER_WALK_TICKS);
    });
});

describe('thieving: seenOutsideArea diagnostic', () => {
    test('a free Man in view outside the area while waiting warns, naming its tile', async () => {
        const r = await simulate(thieving, { params: PARAMS, timeline: manAt(base, SPOT.x + 12, SPOT.z).series(1) });
        expect(r.result.diagnostics?.idleTicks).toBeGreaterThan(0);
        expect(r.result.diagnostics?.seenOutsideAreaTicks).toBe(r.result.diagnostics?.idleTicks);
        expect(r.result.warnings?.[0]).toContain('seenOutsideArea');
        expect(r.result.warnings?.[0]).toContain(`(${SPOT.x + 12},${SPOT.z})`);
    });

    test('a Man busy in a fight outside the area does not count', async () => {
        const w = base.npc('Man', SPOT.x + 12, SPOT.z, { index: 9, options: ['Pickpocket'], inCombat: true });
        const r = await simulate(thieving, { params: PARAMS, timeline: w.series(1) });
        expect(r.result.diagnostics?.seenOutsideAreaTicks).toBe(0);
        expect(r.result.warnings).toBeUndefined();
    });
});
