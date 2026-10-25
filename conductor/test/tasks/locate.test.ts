import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import locate, { parseDirection } from '../../tasks/locate';
import { fakePaths, straightPaths } from '../paths';
import { walking } from '../react';
import { type Simulation, simulate } from '../simulate';
import { world } from '../world';

// The hunt as server/content/scripts/quests/quest_viking/scripts/viking_sigil.rs2 plays it: a hidden butterfly,
// and each Locate prints a compass message by the signs of (butterfly - player), or the stop message within 3.
const START = { x: 2690, z: 3620 };
const PARAMS = {
    item: "^Hunters' talisman$",
    option: '^Locate$',
    stop: 'Draugen is here',
    target: '^The Draugen$',
};
const talisman = (w = world()) =>
    w.inv("Hunters' talisman", 1, { id: 3855, options: [{ text: 'Locate', opIndex: 1 }] });
const base = talisman(world().player({ at: START }));

interface Quarry {
    at: { x: number; z: number };
    /** Locates answered so far. */
    locates: number;
    /** Called before answering a locate; may move the butterfly and returns extra messages. */
    onLocate?: (q: Quarry) => string[];
    /** Answer with this instead of a hint. */
    answer?: string;
    /** Hints for the first locates, in order, in place of the computed ones. */
    script?: string[];
}

const compass = (dx: number, dz: number) => {
    if (dx < 0 && dz > 0) return 'north-west';
    if (dx < 0 && dz < 0) return 'south-west';
    if (dx > 0 && dz > 0) return 'north-east';
    if (dx > 0 && dz < 0) return 'south-east';
    if (dx > 0) return 'east';
    if (dx < 0) return 'west';
    return dz < 0 ? 'south' : 'north';
};

/** The talisman's Locate, then the bot's walks. The message stays on screen from the tick it first shows. */
function hunt(q: Quarry) {
    return walking((action: BotAction, state: BotWorldState) => {
        const p = state.player;
        if (action.type !== 'useInventoryItem' || !p) return undefined;
        q.locates++;
        const extra = q.onLocate?.(q) ?? [];
        const dx = q.at.x - p.worldX;
        const dz = q.at.z - p.worldZ;
        const near = Math.max(Math.abs(dx), Math.abs(dz)) < 4;
        const texts = [
            ...extra,
            q.script?.[q.locates - 1] ??
                q.answer ??
                (near ? 'The Draugen is here! Beware!' : `The talisman guides you ${compass(dx, dz)}.`),
        ];
        let tick: number | undefined;
        return s => {
            tick ??= s.tick;
            return {
                ...s,
                gameMessages: [
                    ...s.gameMessages,
                    ...texts.map(text => ({ type: 0, text, sender: '', tick: tick ?? s.tick, fromSelf: false })),
                ],
            };
        };
    });
}

const walkGoals = (r: Simulation) =>
    r.driver.commands.flatMap(c => (c.type === 'send' && c.action.type === 'walkTo' ? [c.action] : []));
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [String(e.msg)] : []));

describe('locate: parsing a hint', () => {
    test('maps each compass word to its axes (north is +z, east is +x)', () => {
        expect(parseDirection('The talisman guides you north-west.')).toEqual({ x: -1, z: 1 });
        expect(parseDirection('guides you south east')).toEqual({ x: 1, z: -1 });
        expect(parseDirection('guides you northeast')).toEqual({ x: 1, z: 1 });
        expect(parseDirection('guides you south-west')).toEqual({ x: -1, z: -1 });
        expect(parseDirection('guides you north')).toEqual({ x: 0, z: 1 });
        expect(parseDirection('guides you south')).toEqual({ x: 0, z: -1 });
        expect(parseDirection('guides you east')).toEqual({ x: 1, z: 0 });
        expect(parseDirection('guides you west')).toEqual({ x: -1, z: 0 });
        expect(parseDirection('nothing here')).toBeNull();
    });
});

describe('locate: following the hints', () => {
    const cases: [string, number, number][] = [
        ['north', 0, 1],
        ['south', 0, -1],
        ['east', 1, 0],
        ['west', -1, 0],
        ['north-east', 1, 1],
        ['north-west', -1, 1],
        ['south-east', 1, -1],
        ['south-west', -1, -1],
    ];
    for (const [name, sx, sz] of cases) {
        test(`${name}: the first hop is a step that way`, async () => {
            const q: Quarry = { at: { x: START.x + sx * 40, z: START.z + sz * 40 }, locates: 0 };
            const r = await simulate(locate, {
                params: { ...PARAMS, maxHops: 1 },
                timeline: base.series(80),
                react: hunt(q),
            });
            // Hop 1 walks; hop 2 is refused by maxHops.
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toBe('hop: 1 hops and the hints have not led to the target');
            const last = walkGoals(r).at(-1);
            expect(last).toMatchObject({ x: START.x + sx * 8, z: START.z + sz * 8 });
        });
    }

    test('closes in on a butterfly, halving a step on the axis that overshoots, and is done on the stop message', async () => {
        const q: Quarry = { at: { x: START.x + 10, z: START.z + 21 }, locates: 0 };
        const r = await simulate(locate, { params: PARAMS, timeline: base.series(400), react: hunt(q) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toMatch(/^hop: "The Draugen is here! Beware!" after \d+ hops$/);
        expect(q.locates).toBeGreaterThan(2);
        expect(q.locates).toBeLessThan(12);
        expect(r.result.finalPos).toBeDefined();
        const goals = walkGoals(r);
        // The first hop is the full step; a later one on the flipped x axis is shorter than it.
        expect(goals[0]).toMatchObject({ x: START.x + 8, z: START.z + 8 });
        const steps = goals.map((g, i) => (i === 0 ? 8 : Math.abs(g.x - goals[i - 1]!.x)));
        expect(steps.some(s => s > 0 && s < 8)).toBe(true);
    });

    test('done at once, sending nothing, when the target NPC is already in view', async () => {
        const w = base.npc('The Draugen', START.x + 1, START.z + 1);
        const r = await simulate(locate, {
            params: PARAMS,
            timeline: w.series(10),
            react: hunt({ at: START, locates: 0 }),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('in-view: The Draugen is in view');
        expect(r.sends).toEqual([]);
    });

    test('after the stop message it waits a few ticks for the target to show, and is done either way', async () => {
        const q: Quarry = { at: { x: START.x + 2, z: START.z }, locates: 0 };
        const shown = await simulate(locate, {
            params: PARAMS,
            timeline: base.series(30, (w, i) => (i >= 6 ? w.npc('The Draugen', START.x + 2, START.z) : w)),
            react: hunt(q),
        });
        expect(shown.result.status).toBe('done');
        expect(shown.result.reason).toMatch(/after 1 hops \(in view\)$/);
        const late = await simulate(locate, {
            params: PARAMS,
            timeline: base.series(30),
            react: hunt({ at: { x: START.x + 2, z: START.z }, locates: 0 }),
        });
        expect(late.result.status).toBe('done');
        expect(late.result.reason).toMatch(/after 1 hops$/);
    });

    test('the stop message on the very first Locate ends the run without a walk', async () => {
        const q: Quarry = { at: { x: START.x + 2, z: START.z }, locates: 0 };
        const r = await simulate(locate, { params: PARAMS, timeline: base.series(20), react: hunt(q) });
        expect(r.result.status).toBe('done');
        expect(walkGoals(r)).toEqual([]);
        expect(r.sends).toEqual(["Locate Hunters' talisman"]);
    });
});

describe('locate: the target moves off', () => {
    test('"moved elsewhere" starts the step sizes over and the hunt carries on', async () => {
        const q: Quarry = {
            at: { x: START.x + 40, z: START.z + 40 },
            locates: 0,
            onLocate: self => {
                if (self.locates !== 3) return [];
                self.at = { x: START.x - 40, z: START.z - 40 };
                return ['The Draugen has moved elsewhere...'];
            },
        };
        const r = await simulate(locate, {
            params: { ...PARAMS, maxHops: 6 },
            timeline: base.series(300),
            react: hunt(q),
        });
        expect(r.result.status).toBe('failed');
        expect(logged(r)).toContain('the target moved off (1); step sizes start over');
        // The 3rd locate flips the hint to south-west: both axes flip, so the hop is not the full 8 tiles only if the
        // reset did not happen: after it the step is the full 8 again.
        const goals = walkGoals(r);
        const third = goals[2]!;
        const second = goals[1]!;
        expect(Math.abs(third.x - second.x)).toBe(8);
        expect(Math.abs(third.z - second.z)).toBe(8);
    });

    test('fails once it has moved off more than maxRelocations times', async () => {
        const q: Quarry = {
            at: { x: START.x + 40, z: START.z },
            locates: 0,
            onLocate: self => {
                self.at = { x: self.at.x + 100, z: self.at.z };
                return ['The Draugen has moved elsewhere...'];
            },
        };
        const r = await simulate(locate, {
            params: { ...PARAMS, maxRelocations: 1 },
            timeline: base.series(200),
            react: hunt(q),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('hop: the target moved off 2 times; the hints do not converge');
    });
});

describe('locate: limits and refusals', () => {
    test('fails past maxHops: the hints do not converge', async () => {
        // A butterfly that is always far: each hop hops somewhere, nothing arrives.
        const q: Quarry = { at: { x: START.x + 500, z: START.z }, locates: 0 };
        const r = await simulate(locate, {
            params: { ...PARAMS, maxHops: 3 },
            timeline: base.series(300),
            react: hunt(q),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('hop: 3 hops and the hints have not led to the target');
        expect(q.locates).toBe(3);
    });

    test('a hop is clipped to the area, and a hint pointing out of it fails', async () => {
        const q: Quarry = { at: { x: START.x + 100, z: START.z }, locates: 0 };
        const r = await simulate(locate, {
            params: { ...PARAMS, area: { x: START.x, z: START.z, radius: 10 } },
            timeline: base.series(300),
            react: hunt(q),
        });
        expect(r.result.status).toBe('failed');
        // 8 tiles, then 2 to the edge, then nowhere to go.
        const xs = walkGoals(r).map(g => g.x);
        expect(Math.max(...xs)).toBe(START.x + 10);
        expect(r.result.reason).toMatch(
            /^hop: "The talisman guides you east\." points out of the area at \(2700,3620\)$/,
        );
    });

    test('three locates with no hint in a row fail', async () => {
        const r = await simulate(locate, {
            params: PARAMS,
            timeline: base.series(300),
            react: walking(),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^hop: 3 locates in a row gave no hint \(last no-effect/);
    });

    test('a refusal ("You have already captured the Draugen.") fails at once', async () => {
        const q: Quarry = { at: START, locates: 0, answer: 'You have already captured the Draugen.' };
        const r = await simulate(locate, { params: PARAMS, timeline: base.series(60), react: hunt(q) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/already captured/);
        expect(q.locates).toBe(1);
    });

    test('a hint that matches but names no compass direction fails', async () => {
        const q: Quarry = { at: START, locates: 0, answer: 'The talisman hums faintly.' };
        const r = await simulate(locate, {
            params: { ...PARAMS, hint: 'hums faintly' },
            timeline: base.series(60),
            react: hunt(q),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^hop: no compass direction in .The talisman hums faintly\.."?$/);
    });

    test('hops whose walks fail three times in a row end the run', async () => {
        const q: Quarry = { at: { x: START.x + 60, z: START.z }, locates: 0 };
        const r = await simulate(locate, {
            params: PARAMS,
            timeline: base.series(600),
            react: hunt(q),
            pathfinder: fakePaths(() => ({ ok: false, reason: 'no-path' }) as never),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^hop: 3 hops in a row could not walk/);
    });

    test('preflight: refuses with the item missing', async () => {
        const r = await simulate(locate, { params: PARAMS, timeline: world().player({ at: START }).series(5) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^preflight: /);
        expect(r.result.reason).toMatch(/no item matching .*Hunters.* in the inventory/);
    });

    test('preflight: refuses an area reaching the Wilderness', async () => {
        const r = await simulate(locate, {
            params: { ...PARAMS, area: { x: 3000, z: 3600, radius: 20 } },
            timeline: base.series(5),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^preflight: /);
        expect(r.result.reason).toMatch(/Wilderness/);
    });
});

describe('locate: guards', () => {
    test('low HP between hops: the guard eats, then the hunt resumes', async () => {
        const q: Quarry = { at: { x: START.x + 12, z: START.z + 12 }, locates: 0 };
        const r = await simulate(locate, {
            params: PARAMS,
            timeline: base
                .inv('Swordfish', 2, { id: 373 })
                .series(400, (w, i) => w.player({ hp: i === 3 ? 4 : 20, maxHp: 20 })),
            react: hunt(q),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
    });
});

describe('locate: when the area is far', () => {
    test('walks back into the area before locating', async () => {
        const q: Quarry = { at: { x: START.x + 2, z: START.z }, locates: 0 };
        const r = await simulate(locate, {
            params: { ...PARAMS, area: { x: START.x, z: START.z, radius: 10 } },
            timeline: talisman(world().player({ at: { x: START.x - 60, z: START.z } })).series(400),
            react: hunt(q),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps[0]).toBe('return-to-area');
    });
});

describe('locate: step sizes and blocked tiles', () => {
    test('a flipped axis halves its step and the same direction again doubles it back', async () => {
        const q: Quarry = {
            at: { x: START.x + 500, z: START.z },
            locates: 0,
            script: [
                'The talisman guides you north-east.',
                'The talisman guides you north-west.',
                'The talisman guides you north-west.',
            ],
        };
        const r = await simulate(locate, {
            params: { ...PARAMS, maxHops: 3 },
            timeline: base.series(300),
            react: hunt(q),
        });
        const xs = [START.x, ...walkGoals(r).map(g => g.x)];
        expect(xs.slice(1).map((x, i) => x - xs[i]!)).toEqual([8, -4, -8]);
    });

    test('a blocked diagonal tile is walked around on one axis, and is no failure', async () => {
        const q: Quarry = { at: { x: START.x + 500, z: START.z + 500 }, locates: 0 };
        const straight = straightPaths();
        const r = await simulate(locate, {
            params: { ...PARAMS, maxHops: 3 },
            timeline: base.series(300),
            react: hunt(q),
            pathfinder: fakePaths((from, to, avoid) =>
                to.x === START.x + 8 && to.z === START.z + 8
                    ? { success: false, waypoints: [], error: 'blocked' }
                    : straight.findPath(from, to, avoid),
            ),
        });
        expect(r.result.reason).toBe('hop: 3 hops and the hints have not led to the target');
        const goals = walkGoals(r).map(g => `${g.x},${g.z}`);
        expect(goals).toContain(`${START.x + 8},${START.z}`);
    });

    test('when only the detour stopped the hop, it is walked by the long way once', async () => {
        const q: Quarry = { at: { x: START.x + 500, z: START.z + 500 }, locates: 0 };
        const r = await simulate(locate, {
            params: { ...PARAMS, maxHops: 1 },
            timeline: base.series(300),
            react: hunt(q),
            // Every route runs 60 tiles north first, then to the goal: over the hop's limit, under the long way's.
            pathfinder: fakePaths((from, to) => ({
                success: true,
                reachedDestination: true,
                waypoints: [
                    { x: from.x, z: from.z + 60, level: 0 },
                    { ...to, level: 0 },
                ],
            })),
        });
        expect(logged(r).some(m => m.endsWith('by the long way'))).toBe(true);
        expect(walkGoals(r)[0]).toMatchObject({ x: START.x, z: START.z + 60 });
    });
});
