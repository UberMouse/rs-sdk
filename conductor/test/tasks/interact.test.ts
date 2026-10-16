import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { INTERACT_WAIT_TICKS } from '../../actions/interaction';
import { WALK_MAX_TICKS } from '../../actions/walk';
import { stepBudgetTicks } from '../../lib/task';
import interact from '../../tasks/interact';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { simulate } from '../simulate';
import { attackedFrom, world } from '../world';

const AMULET_ID = 552;
const coffinParams = { target: 'loc', name: '^coffin$', option: '^open$' };
const graveyard = world().loc('Coffin', 3249, 3192, { options: ['Open', 'Search'] });
/** The coffin opens: its game message arrives the tick after the send. */
const opens = (a: BotAction) =>
    a.type === 'interactLoc'
        ? (s: ReturnType<typeof graveyard.build>) => world(s).message('You open the coffin.').build()
        : undefined;

describe('interact: the interaction', () => {
    test('sends the option on the nearest match and is done on its effect', async () => {
        const r = await simulate(interact, { params: coffinParams, timeline: graveyard.series(30), react: opens });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: ^open$ on ^coffin$: game message "You open the coffin."');
        expect(r.sends).toEqual(['Open Coffin']);
        expect(r.steps).toEqual(['interact']);
    });

    test('an NPC: a dialog opening is the effect', async () => {
        const w = world().npcBeside('Father Urhney', { options: ['Talk-to'] });
        const r = await simulate(interact, {
            params: { target: 'npc', name: 'urhney', option: 'talk' },
            timeline: w.series(30),
            react: a => (a.type === 'interactNpc' ? s => world(s).dialog({ options: [] }).build() : undefined),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: talk on urhney: a dialog opened');
        // The dialog guard (not allowed here) clears the pages the task does not answer.
        expect(r.sends[0]).toBe('Talk-to Father Urhney');
    });

    test('an inventory item: Wear leaves the inventory', async () => {
        const w = world().inv('Ghostspeak amulet', 1, { id: AMULET_ID, options: [{ text: 'Wear', opIndex: 2 }] });
        const r = await simulate(interact, {
            params: { target: 'item', name: '^ghostspeak amulet$', option: '^wear' },
            timeline: w.series(30),
            react: a => (a.type === 'useInventoryItem' ? s => ({ ...s, inventory: [] }) : undefined),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: ^wear on ^ghostspeak amulet$: the inventory changed');
        expect(r.sends).toEqual(['Wear Ghostspeak amulet']);
    });

    test('of several with the name, picks the nearest that offers the option', async () => {
        const w = world()
            .loc('Coffin', 3224, 3218, { options: ['Close', 'Search'] })
            .loc('Coffin', 3240, 3218, { options: ['Open', 'Search'] });
        const sent: BotAction[] = [];
        await simulate(interact, {
            params: coffinParams,
            timeline: w.series(30),
            react: a => {
                sent.push(a);
                return opens(a);
            },
        });
        expect(sent[0]).toMatchObject({ type: 'interactLoc', x: 3240, z: 3218 });
    });

    test('walks to `at` first, then interacts', async () => {
        const far = world().player({ at: { x: 3250, z: 3230 } });
        const r = await simulate(interact, {
            params: { ...coffinParams, at: { x: 3248, z: 3195, tolerance: 2 } },
            timeline: far.series(200, (w, i) => (i >= 20 ? w.loc('Coffin', 3249, 3192, { options: ['Open'] }) : w)),
            react: walking(opens),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps).toEqual(['walk', 'interact']);
    });
});

describe('interact: failures', () => {
    test('an option the target lacks fails at once with the options on offer', async () => {
        const r = await simulate(interact, {
            params: { ...coffinParams, option: '^close$' },
            timeline: graveyard.series(30),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interact: no /^close$/i option on Coffin; it offers: Open | Search');
        expect(r.sends).toEqual([]);
    });

    test('no target in sight fails after waiting', async () => {
        const r = await simulate(interact, { params: coffinParams, timeline: world().series(30) });
        expect(r.result.reason).toBe('interact: no reachable loc /^coffin$/ in sight');
    });

    test('a target in view but unreachable is named so', async () => {
        const w = world().loc('Coffin', 3249, 3192, { options: ['Open'], reachable: false });
        const r = await simulate(interact, { params: coffinParams, timeline: w.series(30) });
        expect(r.result.reason).toBe(
            'interact: no reachable loc /^coffin$/ in sight (1 in view but unreachable from here)',
        );
    });

    test("the server's can't-reach fails at once, with the sent option not repeated", async () => {
        const r = await simulate(interact, {
            params: coffinParams,
            timeline: graveyard.series(80),
            react: a => (a.type === 'interactLoc' ? s => world(s).message("I can't reach that!").build() : undefined),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interact: cant-reach: Cannot reach Coffin');
        expect(r.sends).toEqual(['Open Coffin']);
    });

    test('a refusal message fails at once', async () => {
        const r = await simulate(interact, {
            params: coffinParams,
            timeline: graveyard.series(80),
            react: a =>
                a.type === 'interactLoc' ? s => world(s).message('Nothing interesting happens.').build() : undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interact: refused: Coffin: "Nothing interesting happens."');
        expect(r.sends).toEqual(['Open Coffin']);
    });

    test('an interaction with no effect fails at once, not re-sent', async () => {
        const r = await simulate(interact, { params: coffinParams, timeline: graveyard.series(200) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `interact: no-effect: /^open$/i on Coffin showed no effect within ${INTERACT_WAIT_TICKS} ticks`,
        );
        expect(r.sends).toEqual(['Open Coffin']);
    });

    test('a send the client refuses is retried; a later one that works is done', async () => {
        let tries = 0;
        const r = await simulate(interact, {
            params: coffinParams,
            timeline: graveyard.series(200),
            respond: a =>
                a.type === 'interactLoc' && ++tries < 3 ? { success: false, message: 'not connected' } : undefined,
            react: a => (a.type === 'interactLoc' && tries === 3 ? opens(a) : undefined),
        });
        expect(r.result.status).toBe('done');
        expect(tries).toBe(3);
    });

    test('three refused sends in a row fail', async () => {
        const r = await simulate(interact, {
            params: coffinParams,
            timeline: graveyard.series(200),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('interact: 3 tries in a row failed (last send-failed: not connected)');
    });

    test('a walk with no route fails with its message', async () => {
        const far = world().player({ at: { x: 3250, z: 3230 } });
        const r = await simulate(interact, {
            params: { ...coffinParams, at: { x: 3248, z: 3195 } },
            timeline: far.series(60),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [] })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain("can't walk to (3248,3195)");
    });
});

describe('interact: guards and params', () => {
    test('low HP mid-wait: the guard eats and the interaction goes on', async () => {
        const r = await simulate(interact, {
            params: coffinParams,
            timeline: graveyard.inv('Shrimps', 1).series(60, (w, i) => {
                const hurt = i === 3 ? attackedFrom(w, i, 4).player({ hp: 3 }) : w;
                return i >= 12 ? hurt.message('You open the coffin.') : hurt;
            }),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.some(s => /eat/i.test(s))).toBe(true);
    });

    test('a Wilderness spot is refused', async () => {
        const r = await simulate(interact, {
            params: { ...coffinParams, at: { x: 3000, z: 3700 } },
            timeline: graveyard.series(3),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('is in the Wilderness');
    });

    test('Drop and the like are refused on an item', async () => {
        for (const option of ['^drop$', 'Destroy', '^empty']) {
            const r = await simulate(interact, {
                params: { target: 'item', name: 'amulet', option },
                timeline: graveyard.series(3),
            });
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toContain('destructive option');
        }
    });

    test('Attack is refused on an NPC', async () => {
        const r = await simulate(interact, {
            params: { target: 'npc', name: 'goblin', option: 'attack' },
            timeline: graveyard.series(3),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('combat task');
    });

    test('a target on a Wilderness tile fails before sending, with no `at`', async () => {
        const w = world().loc('Coffin', 3000, 3700, { options: ['Open'] });
        const r = await simulate(interact, { params: coffinParams, timeline: w.series(10) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('is in the Wilderness');
        expect(r.sends).toEqual([]);
    });

    test('`expect` is passed on: an unrelated message does not finish the run', async () => {
        const r = await simulate(interact, {
            params: { ...coffinParams, expect: 'skull' },
            timeline: graveyard.series(200),
            react: opens,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no-effect');
    });

    test('a pattern that is not a regular expression is refused', async () => {
        const r = await simulate(interact, { params: { ...coffinParams, name: '(' }, timeline: graveyard.series(3) });
        expect(r.result.reason).toContain('name: not a valid regular expression');
    });

    test('an unknown target kind is refused', async () => {
        const r = await simulate(interact, {
            params: { ...coffinParams, target: 'player' },
            timeline: graveyard.series(3),
        });
        expect(r.result.status).toBe('error');
    });

    test('the step budget covers a walk and the longest wait after it', () => {
        expect(stepBudgetTicks(interact.stepTimeoutMs ?? 0)).toBeGreaterThanOrEqual(
            WALK_MAX_TICKS + INTERACT_WAIT_TICKS,
        );
    });
});
