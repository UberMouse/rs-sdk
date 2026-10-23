import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { INTERACT_WAIT_TICKS, SETTLE_MAX_TICKS } from '../../actions/interaction';
import { CONVERSE_MAX_TICKS } from '../../actions/talk';
import { WALK_MAX_TICKS } from '../../actions/walk';
import { stepBudgetTicks } from '../../lib/task';
import interact from '../../tasks/interact';
import { type Page, dialogScript } from '../dialog-script';
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

    test('the step budget covers a walk, and the interaction wait, its settle and a whole conversation', () => {
        const budget = stepBudgetTicks(interact.stepTimeoutMs ?? 0);
        expect(budget).toBeGreaterThanOrEqual(WALK_MAX_TICKS + INTERACT_WAIT_TICKS);
        // The walk is a step of its own: the interact step holds the wait, the settle and the dialog answers.
        expect(budget).toBeGreaterThanOrEqual(INTERACT_WAIT_TICKS + SETTLE_MAX_TICKS + CONVERSE_MAX_TICKS);
    });
});

// The Waterfall Quest's shapes (wiki/quests/waterfall-quest.md): pillars picked by tile, an island whose locs the
// client cannot route to, an item used on a loc whose effect is a move, and a Wilderness altar.
describe('interact: a target by tile', () => {
    const pillars = world()
        .player({ at: { x: 2563, z: 9912 } })
        .loc('Pillar', 2562, 9910, { options: ['Examine'] })
        .loc('Pillar', 2562, 9912, { options: ['Examine'] })
        .loc('Pillar', 2562, 9914, { options: ['Examine'] });
    const params = { target: 'loc', name: '^pillar$', option: '^examine$' };
    const said = (a: BotAction) =>
        a.type === 'interactLoc'
            ? (s: ReturnType<typeof pillars.build>) => world(s).message('A pillar.').build()
            : undefined;

    test('sends to the loc standing on the tile, not the nearest of that name', async () => {
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params: { ...params, tile: { x: 2562, z: 9914 } },
            timeline: pillars.series(30),
            react: a => {
                sent.push(a);
                return said(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent[0]).toMatchObject({ type: 'interactLoc', x: 2562, z: 9914 });
    });

    test('without a tile the nearest is taken, a tie going to the first scanned', async () => {
        const sent: BotAction[] = [];
        await simulate(interact, {
            params,
            timeline: pillars.series(30),
            react: a => {
                sent.push(a);
                return said(a);
            },
        });
        expect(sent[0]).toMatchObject({ x: 2562, z: 9912 });
    });

    test('a tile nothing stands on fails, naming it', async () => {
        const r = await simulate(interact, {
            params: { ...params, tile: { x: 2569, z: 9912 } },
            timeline: pillars.series(30),
        });
        expect(r.result.reason).toBe('interact: no reachable loc /^pillar$/ at (2569,9912) in sight');
        expect(r.sends).toEqual([]);
    });

    test('a tile on another level than the loc is not a match', async () => {
        const r = await simulate(interact, {
            params: { ...params, tile: { x: 2562, z: 9912, level: 1 } },
            timeline: pillars.series(30),
        });
        expect(r.result.status).toBe('failed');
        expect(r.sends).toEqual([]);
    });

    test('an NPC is picked by its tile too', async () => {
        const w = world()
            .npc('Monk', 3100, 3200, { options: ['Talk-to'] })
            .npc('Monk', 3105, 3200, { options: ['Talk-to'] });
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params: { target: 'npc', name: 'monk', option: 'talk', tile: { x: 3105, z: 3200 } },
            timeline: w.series(30),
            react: a => {
                sent.push(a);
                return a.type === 'interactNpc' ? s => world(s).dialog({ options: [] }).build() : undefined;
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent[0]).toMatchObject({ type: 'interactNpc', npcIndex: 2 });
    });

    test('a tile on an inventory item is refused', async () => {
        const r = await simulate(interact, {
            params: { target: 'item', name: 'x', option: 'wear', tile: { x: 1, z: 1 } },
            timeline: pillars.series(3),
        });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('a tile picks a loc or an NPC');
    });
});

describe('interact: a loc the client cannot route to', () => {
    // Hudon's island: the Rock across the water is in view but unreachable.
    const island = world()
        .player({ at: { x: 2512, z: 3477 } })
        .loc('Rock', 2512, 3468, { options: ['Swim to'], reachable: false });
    const swim = { target: 'loc', name: '^rock$', option: '^swim', tile: { x: 2512, z: 3468 } };
    const washedUp = (a: BotAction) =>
        a.type === 'interactLoc'
            ? (s: ReturnType<typeof island.build>) =>
                  world(s)
                      .player({ at: { x: 2527, z: 3413 } })
                      .build()
            : undefined;

    test('`unreachable` sends the op from the stand tile; the player being moved far away is the effect', async () => {
        const r = await simulate(interact, {
            params: { ...swim, unreachable: true, at: { x: 2512, z: 3476, tolerance: 1 } },
            timeline: island.series(40),
            react: washedUp,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: ^swim on ^rock$: the player moved to (2527,3413)');
        expect(r.sends).toEqual(['Swim to Rock']);
        expect(r.steps).toEqual(['interact']);
    });

    test('without `unreachable` the loc is skipped as before', async () => {
        const r = await simulate(interact, {
            params: { ...swim, at: { x: 2512, z: 3476, tolerance: 1 } },
            timeline: island.series(30),
        });
        expect(r.result.reason).toBe(
            'interact: no reachable loc /^rock$/ at (2512,3468) in sight (1 in view but unreachable from here)',
        );
        expect(r.sends).toEqual([]);
    });

    test('`unreachable` needs `at`', async () => {
        const r = await simulate(interact, { params: { ...swim, unreachable: true }, timeline: island.series(3) });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('unreachable needs `at`');
    });

    test("the server's can't-reach still fails at once", async () => {
        const r = await simulate(interact, {
            params: { ...swim, unreachable: true, at: { x: 2512, z: 3476, tolerance: 1 } },
            timeline: island.series(60),
            react: a => (a.type === 'interactLoc' ? s => world(s).message("I can't reach that!").build() : undefined),
        });
        expect(r.result.reason).toBe('interact: cant-reach: Cannot reach Rock');
        expect(r.sends).toEqual(['Swim to Rock']);
    });
});

describe('interact: the player moved by the game', () => {
    const door = world()
        .player({ at: { x: 2515, z: 9575 } })
        .loc('Door', 2515, 9575, { options: ['Open'] })
        .inv('Plain key', 1, { id: 100 });
    const gate = { target: 'loc', name: '^door$', use: { item: '^plain key$' } };
    const moveTo = (x: number, z: number) => (a: BotAction) =>
        a.type === 'useItemOnLoc'
            ? (s: ReturnType<typeof door.build>) => world(s).player({ at: { x, z } }).build()
            : undefined;

    test('a one-tile pass through the door the bot stands on is an effect', async () => {
        const r = await simulate(interact, { params: gate, timeline: door.series(40), react: moveTo(2515, 9576) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: use /^plain key$/ on ^door$: the player moved to (2515,9576)');
    });

    test('one tile of walking toward a loc the bot did not stand on is not', async () => {
        const w = door.player({ at: { x: 2515, z: 9573 } });
        const r = await simulate(interact, { params: gate, timeline: w.series(80), react: moveTo(2515, 9574) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no-effect');
    });

    test('a change of floor is an effect', async () => {
        const w = door.player({ at: { x: 2515, z: 9573 } });
        const r = await simulate(interact, {
            params: { target: 'loc', name: '^door$', option: '^open$' },
            timeline: w.series(40),
            react: a =>
                a.type === 'interactLoc'
                    ? s =>
                          world(s)
                              .player({ at: { x: 2515, z: 9574, level: 1 } })
                              .build()
                    : undefined,
        });
        expect(r.result.reason).toBe('interact: ^open$ on ^door$: the player moved to (2515,9574)');
    });

    test('a loc turning into another is an effect of a plain option', async () => {
        const w = world().loc('Gate', 3000, 3000, { options: ['Open'], id: 5 });
        const r = await simulate(interact, {
            params: { target: 'loc', name: '^gate$', option: '^open$' },
            timeline: w.series(40),
            react: a =>
                a.type === 'interactLoc'
                    ? s => ({ ...s, nearbyLocs: s.nearbyLocs.map(l => ({ ...l, id: 6 })) })
                    : undefined,
        });
        expect(r.result.reason).toBe('interact: ^open$ on ^gate$: the loc changed');
    });
});

describe('interact: an item used on a loc', () => {
    const rope = world()
        .player({ at: { x: 2512, z: 3476 } })
        .inv('Rope', 1, { id: 954 })
        .loc('Rock', 2512, 3468, { options: ['Swim to'], reachable: false });
    const params = {
        target: 'loc',
        name: '^rock$',
        use: { item: '^rope$' },
        unreachable: true,
        at: { x: 2512, z: 3476, tolerance: 1 },
    };

    const frame = (i: number) => {
        const s = rope.tick(i).build();
        const x = i >= 5 ? 2513 : 2512;
        const anim = i >= 3 && i < 5 ? 4 : -1;
        return { ...s, player: s.player && { ...s.player, worldX: x, animId: anim } };
    };

    test('is sent once and done on the first effect (an animation), without the option', async () => {
        const r = await simulate(interact, {
            params,
            timeline: rope.series(60),
            react: a =>
                a.type === 'useItemOnLoc' ? s => ({ ...s, player: s.player && { ...s.player, animId: 4 } }) : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: use /^rope$/ on ^rock$: an animation started');
        expect(r.sends).toEqual(['use Rope on Rock']);
        const sent = r.driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
        expect(sent[0]).toMatchObject({ type: 'useItemOnLoc', itemSlot: 0, x: 2512, z: 3468 });
    });

    test('an item used up (the inventory changing) is an effect', async () => {
        const w = world()
            .inv('Air rune', 6, { id: 556 })
            .loc('Pillar', 2562, 9912, { options: ['Examine'] });
        const r = await simulate(interact, {
            params: { target: 'loc', name: '^pillar$', use: { item: 'air rune' } },
            timeline: w.series(30),
            react: a =>
                a.type === 'useItemOnLoc'
                    ? s => ({ ...s, inventory: s.inventory.map(i => ({ ...i, count: i.count - 1 })) })
                    : undefined,
        });
        expect(r.result.reason).toBe('interact: use /air rune/ on ^pillar$: the inventory changed');
    });

    test('`itemId` picks the item of that id among several with the name', async () => {
        const w = world()
            .inv('Bucket of water', 1, { id: 2953 })
            .inv('Bucket of water', 1, { id: 2954 })
            .loc('Coffin', 3000, 3000, { options: ['Open'] });
        // inv() keeps one stack per name: set the second slot by hand.
        const both = w.build();
        const state = {
            ...both,
            inventory: [
                { ...both.inventory[0]!, slot: 0, id: 2953 },
                { ...both.inventory[0]!, slot: 1, id: 2954 },
            ],
        };
        const sent: BotAction[] = [];
        await simulate(interact, {
            params: { target: 'loc', name: 'coffin', use: { item: { id: 2954 } } },
            timeline: [state],
            react: a => {
                sent.push(a);
                return a.type === 'useItemOnLoc' ? s => ({ ...s, inventory: [] }) : undefined;
            },
        });
        expect(sent[0]).toMatchObject({ type: 'useItemOnLoc', itemSlot: 1 });
    });

    test('an item the bot does not hold is refused in preflight', async () => {
        const r = await simulate(interact, { params, timeline: rope.inv('Rope', 0).series(10) });
        expect(r.result.reason).toBe('preflight: no item matching /^rope$/ in the inventory to use on ^rock$');
        expect(r.sends).toEqual([]);
    });

    test('an unreachable use waits for the landing: the throw animation is not the end', async () => {
        const r = await simulate(interact, { params, timeline: Array.from({ length: 30 }, (_, i) => frame(i)) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: use /^rope$/ on ^rock$: an animation started');
        // Throw seen at tick 3; stable from tick 5 to 7.
        expect(r.driver.ticksElapsed).toBeGreaterThanOrEqual(7);
    });

    test('a missing item named by id is refused in preflight with its id', async () => {
        const r = await simulate(interact, {
            params: { ...params, use: { item: { id: 954 } } },
            timeline: rope.inv('Rope', 0).series(10),
        });
        expect(r.result.reason).toBe('preflight: no item matching #954 in the inventory to use on ^rock$');
    });

    test('a refusal fails at once and the use is not re-sent', async () => {
        const r = await simulate(interact, {
            params,
            timeline: rope.series(80),
            react: a =>
                a.type === 'useItemOnLoc'
                    ? s => world(s).message("You don't see that being any help. Nothing interesting happens.").build()
                    : undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('refused');
        expect(r.sends).toEqual(['use Rope on Rock']);
    });

    test('a use with no effect fails and is not re-sent', async () => {
        const r = await simulate(interact, { params, timeline: rope.series(80) });
        expect(r.result.reason).toContain('no-effect');
        expect(r.sends).toEqual(['use Rope on Rock']);
    });

    test('`expect` makes only a matching message count', async () => {
        const r = await simulate(interact, {
            params: { ...params, expect: 'tie the rope' },
            timeline: rope.series(60),
            react: a =>
                a.type === 'useItemOnLoc' ? s => world(s).message('You tie the rope to the tree').build() : undefined,
        });
        expect(r.result.reason).toBe('interact: use /^rope$/ on ^rock$: "You tie the rope to the tree"');
    });

    test('an option together with a use, or a use on an NPC, is refused', async () => {
        const both = await simulate(interact, { params: { ...params, option: 'swim' }, timeline: rope.series(3) });
        expect(both.result.status).toBe('error');
        expect(both.result.reason).toContain('give an option, or a use');
        const item = await simulate(interact, { params: { ...params, target: 'item' }, timeline: rope.series(3) });
        expect(item.result.status).toBe('error');
        expect(item.result.reason).toContain('a use works on a loc or an NPC');
        const neither = await simulate(interact, { params: { target: 'loc', name: 'x' }, timeline: rope.series(3) });
        expect(neither.result.status).toBe('error');
    });
});

describe('interact: an item used on an NPC', () => {
    const pasture = world()
        .player({ at: { x: 3253, z: 3270 } })
        .inv('Bucket', 1, { id: 1925 })
        .npc('Cow', 3256, 3270, { index: 7, options: ['Attack'] })
        .npc('Cow', 3262, 3270, { index: 8, options: ['Attack'] });
    const params = { target: 'npc', name: '^cow$', use: { item: '^bucket$' } };
    const milked = (a: BotAction) =>
        a.type === 'useItemOnNpc'
            ? (s: ReturnType<typeof pasture.build>) => ({
                  ...s,
                  inventory: s.inventory.map(i => ({ ...i, id: 1927, name: 'Bucket of milk' })),
              })
            : undefined;

    test('is sent once to the nearest cow and done when the inventory changes', async () => {
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params,
            timeline: pasture.series(60),
            react: a => {
                sent.push(a);
                return milked(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: use /^bucket$/ on ^cow$: the inventory changed');
        expect(sent.filter(a => a.type === 'useItemOnNpc')).toEqual([
            expect.objectContaining({ type: 'useItemOnNpc', itemSlot: 0, npcIndex: 7 }),
        ]);
    });

    test('expect matches the milking message', async () => {
        const r = await simulate(interact, {
            params: { ...params, expect: 'you milk the cow' },
            timeline: pasture.series(60),
            react: a => (a.type === 'useItemOnNpc' ? s => world(s).message('You milk the cow.').build() : undefined),
        });
        expect(r.result.reason).toBe('interact: use /^bucket$/ on ^cow$: "You milk the cow."');
    });

    test('no bucket is refused in preflight', async () => {
        const r = await simulate(interact, {
            params,
            timeline: world().npc('Cow', 3256, 3270, { index: 7 }).series(3),
        });
        expect(r.result.reason).toContain('preflight: no item matching /^bucket$/');
    });

    test('a refusal message fails at once without a resend', async () => {
        const r = await simulate(interact, {
            params,
            timeline: pasture.series(60),
            react: a =>
                a.type === 'useItemOnNpc' ? s => world(s).message("The cow doesn't want that.").build() : undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('refused');
        expect(r.sends).toEqual(['use Bucket on Cow']);
    });

    test('a discarded op is retried on another cow', async () => {
        const sent: BotAction[] = [];
        let n = 0;
        const r = await simulate(interact, {
            params,
            timeline: pasture.series(80),
            react: a => {
                if (a.type !== 'useItemOnNpc') return undefined;
                sent.push(a);
                if (++n === 1)
                    return s => ({
                        ...s,
                        opFeedback: {
                            mapFlagUnsetCount: 1,
                            lastMapFlagUnsetTick: -1,
                            opRejectedCount: 1,
                            lastOpRejectedTick: -1,
                        },
                    });
                return milked(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent.map(a => (a.type === 'useItemOnNpc' ? a.npcIndex : -1))).toEqual([7, 8]);
    });

    test('a discarded option on an NPC is retried on the same one, not recorded as refused', async () => {
        const monks = world()
            .npc('Monk', 3100, 3200, { index: 4, options: ['Talk-to'] })
            .npc('Monk', 3105, 3200, { index: 5, options: ['Talk-to'] });
        let n = 0;
        const r = await simulate(interact, {
            params: { target: 'npc', name: 'monk', option: 'talk' },
            timeline: monks.series(60),
            react: a => {
                if (a.type !== 'interactNpc') return undefined;
                if (++n === 1)
                    return s => ({
                        ...s,
                        opFeedback: {
                            mapFlagUnsetCount: 1,
                            lastMapFlagUnsetTick: -1,
                            opRejectedCount: 1,
                            lastOpRejectedTick: -1,
                        },
                    });
                return undefined;
            },
        });
        const targets = r.sends.filter(x => x.startsWith('Talk-to'));
        expect(targets.length).toBeGreaterThan(1);
        expect(new Set(targets).size).toBe(1);
    });

    test('a cow out of sight fails after the missing limit', async () => {
        const r = await simulate(interact, {
            params,
            timeline: world().inv('Bucket', 1).series(30),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no reachable npc');
    });
});

describe('interact: npcId filter and shorn sheep', () => {
    const field = world()
        .player({ at: { x: 2647, z: 3373 } })
        .inv('Shears', 1, { id: 1735 })
        .npc('Sheep', 2647, 3374, { index: 3, id: 42, options: ['Attack'] })
        .npc('Sheep', 2650, 3372, { index: 4, id: 43, options: ['Attack'] });
    const params = { target: 'npc', name: '^Sheep$', npcId: 43, use: { item: '^Shears$' } };
    const sheared = (a: BotAction) =>
        a.type === 'useItemOnNpc'
            ? (s: ReturnType<typeof field.build>) => world(s).inv('Wool', 1, { id: 1737 }).build()
            : undefined;

    test('picks the woolly sheep over a nearer shorn one', async () => {
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params,
            timeline: field.series(60),
            react: a => {
                sent.push(a);
                return sheared(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent.filter(a => a.type === 'useItemOnNpc')).toEqual([
            expect.objectContaining({ type: 'useItemOnNpc', npcIndex: 4 }),
        ]);
    });

    test('a list of ids matches any of them', async () => {
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params: { ...params, npcId: [42, 43] },
            timeline: field.series(60),
            react: a => {
                sent.push(a);
                return sheared(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent.filter(a => a.type === 'useItemOnNpc')).toEqual([expect.objectContaining({ npcIndex: 3 })]);
    });

    test('no id match reports none in sight', async () => {
        const r = await simulate(interact, {
            params: { ...params, npcId: 99 },
            timeline: field.series(30),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no reachable npc');
    });

    test('npcId needs target npc', async () => {
        const r = await simulate(interact, {
            params: { target: 'loc', name: 'x', option: 'y', npcId: 43 },
            timeline: field.series(3),
        });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('npcId');
    });

    test('"already been shorn" moves on to another sheep without waiting', async () => {
        const two = world()
            .player({ at: { x: 2647, z: 3373 } })
            .inv('Shears', 1, { id: 1735 })
            .npc('Sheep', 2647, 3374, { index: 3, id: 43, options: ['Attack'] })
            .npc('Sheep', 2650, 3372, { index: 4, id: 43, options: ['Attack'] });
        const sent: BotAction[] = [];
        const r = await simulate(interact, {
            params,
            timeline: two.series(80),
            react: a => {
                if (a.type !== 'useItemOnNpc') return undefined;
                sent.push(a);
                if (sent.length === 1) return s => world(s).message('This sheep has already been shorn.').build();
                return sheared(a);
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent.map(a => (a.type === 'useItemOnNpc' ? a.npcIndex : -1))).toEqual([3, 4]);
    });
});

describe('interact: the Wilderness opt-in', () => {
    const altar = world()
        .player({ at: { x: 3239, z: 3600 } })
        .inv('Shrimps', 3)
        .loc('Chaos altar', 3239, 3608, { options: ['Check'] });
    const check = { target: 'loc', name: '^chaos altar$', option: '^check$' };
    const checked = (a: BotAction) =>
        a.type === 'interactLoc'
            ? (s: ReturnType<typeof altar.build>) => world(s).message('The altar is cold.').build()
            : undefined;

    test('without it a target in the Wilderness is refused', async () => {
        const r = await simulate(interact, {
            params: check,
            timeline: world()
                .loc('Chaos altar', 3239, 3608, { options: ['Check'] })
                .series(10),
        });
        expect(r.result.reason).toContain('is in the Wilderness');
        expect(r.sends).toEqual([]);
    });

    test('with it the bot interacts there and the Wilderness guard stands down', async () => {
        const r = await simulate(interact, {
            params: { ...check, wilderness: true },
            timeline: altar.series(40),
            react: checked,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: ^check$ on ^chaos altar$: game message "The altar is cold."');
        expect(r.sends).toEqual(['Check Chaos altar']);
    });

    test('`at` in the Wilderness is accepted only with it', async () => {
        const at = { x: 3239, z: 3607, tolerance: 2 };
        const refused = await simulate(interact, { params: { ...check, at }, timeline: altar.series(3) });
        expect(refused.result.reason).toBe('preflight: (3239,3607) is in the Wilderness');
        const allowed = await simulate(interact, {
            params: { ...check, at, wilderness: true },
            timeline: altar.series(40),
            react: walking(checked),
        });
        expect(allowed.result.status).toBe('done');
    });

    test('it needs food to start, `minFood` of it (at least one)', async () => {
        const none = await simulate(interact, {
            params: { ...check, wilderness: true },
            timeline: altar.inv('Shrimps', 0).series(3),
        });
        expect(none.result.reason).toBe('preflight: a Wilderness trip needs 3 food (minFood), bot has 0');
        const atLeastOne = await simulate(interact, {
            params: { ...check, wilderness: true, minFood: 0 },
            timeline: altar.inv('Shrimps', 0).series(3),
        });
        expect(atLeastOne.result.reason).toBe('preflight: a Wilderness trip needs 1 food (minFood), bot has 0');
        const enough = await simulate(interact, {
            params: { ...check, wilderness: true, minFood: 2 },
            timeline: altar.series(40),
            react: checked,
        });
        expect(enough.result.status).toBe('done');
    });
});

const opensDialog = (a: BotAction) => a.type === 'interactLoc';

const clicked = (r: Awaited<ReturnType<typeof simulate>>) =>
    r.driver.commands.filter(c => c.type === 'send' && c.action.type === 'clickDialogOption');

describe('interact: a dialog the interaction opens', () => {
    const doorWorld = world().loc('Door', 3016, 3246, { options: ['Open'] });
    const doorParams = { target: 'loc', name: '^Door$', option: '^Open$' };
    const BEGGAR: Page[] = [[], ['Yes certainly', "No I don't have any bread with me"], [], [], null];

    test('`choices` answers it in order and is done when it closes; the guard is off', async () => {
        const script = dialogScript(BEGGAR, opensDialog);
        const r = await simulate(interact, {
            params: { ...doorParams, choices: ['Yes certainly'] },
            timeline: doorWorld.series(60),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('interact: ^Open$ on ^Door$: a dialog opened; 1 choice made');
        expect(r.sends[0]).toBe('Open Door');
        expect(clicked(r)).toHaveLength(BEGGAR.length - 1);
        expect(script.shown).toBe(BEGGAR.length);
        expect(interact.allowGuards?.({ ...doorParams, choices: ['x'] } as never)).toEqual(['dialog']);
    });

    test('an option the dialog lacks fails with its options and closes it', async () => {
        const script = dialogScript(BEGGAR, opensDialog);
        const r = await simulate(interact, {
            params: { ...doorParams, choices: ['Take the lamp'] },
            timeline: doorWorld.series(60),
            react: script.react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no option matching /Take the lamp/i');
        expect(r.driver.commands.some(c => c.type === 'send' && c.action.type === 'closeModal')).toBe(true);
    });

    test('without `choices` the task answers no choice: it ends on the dialog opening, the guard clicks only continue pages', async () => {
        const script = dialogScript(BEGGAR, opensDialog);
        const r = await simulate(interact, {
            params: doorParams,
            timeline: doorWorld.series(120),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(interact.allowGuards?.({ ...doorParams, choices: [] } as never)).toEqual([]);
        expect(r.sends.some(s => /Yes certainly/.test(s))).toBe(false);
    });

    test('a message box the op opens is the effect, even when the guard clicks it away', async () => {
        const altar = world().loc('Chaos altar', 3239, 3206, { options: ['Check'] });
        const r = await simulate(interact, {
            params: { target: 'loc', name: '^Chaos altar$', option: '^Check$' },
            timeline: altar.series(60),
            react: a =>
                a.type === 'interactLoc'
                    ? s =>
                          world(s)
                              .dialog({ text: 'Snarthon Candtrick Termanto', options: [] })
                              .recentDialog(['Snarthon Candtrick Termanto'])
                              .build()
                    : a.type === 'clickDialogOption'
                      ? s => world(s).dialog(false).build()
                      : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('Snarthon Candtrick Termanto');
    });

    test('an unrelated multi-option page fails with the options shown and closes it', async () => {
        const script = dialogScript([['Buy a drink', 'Leave'], null], opensDialog);
        const r = await simulate(interact, {
            params: { ...doorParams, choices: [] as string[] },
            timeline: doorWorld.series(60),
            react: script.react,
        });
        // No choices: the run is done on the dialog opening, nothing is answered.
        expect(r.result.status).toBe('done');
        const stray = dialogScript([['Buy a drink', 'Leave'], null], opensDialog);
        const f = await simulate(interact, {
            params: { ...doorParams, choices: ['Yes certainly'] },
            timeline: doorWorld.series(60),
            react: stray.react,
        });
        expect(f.result.status).toBe('failed');
        expect(f.result.reason).toContain('no option matching /Yes certainly/i');
        expect(f.result.reason).toContain('"Buy a drink" | "Leave"');
        expect(f.driver.commands.some(c => c.type === 'send' && c.action.type === 'closeModal')).toBe(true);
    });

    test('choices on an interaction that opens no dialog fail saying it opened none', async () => {
        const r = await simulate(interact, {
            params: { ...doorParams, choices: ['Yes certainly'] },
            timeline: doorWorld.series(60),
            react: a => (a.type === 'interactLoc' ? s => world(s).message('The door opens.').build() : undefined),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('it opened no dialog to answer with `choices`');
        expect(r.result.reason).toContain('game message "The door opens."');
        expect(r.sends.filter(x => x === 'Open Door')).toHaveLength(1);
    });

    test('a level-up page before the beggar pages is passed like any continue page', async () => {
        const script = dialogScript([[], [], ['Yes certainly', 'No'], [], null], opensDialog);
        const r = await simulate(interact, {
            params: { ...doorParams, choices: ['Yes certainly'] },
            timeline: doorWorld.series(60),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('1 choice made');
        expect(script.shown).toBe(5);
    });

    test('a step cut off mid-conversation resumes the dialog without sending the door again', async () => {
        const script = dialogScript(BEGGAR, opensDialog);
        const r = await simulate(interact, {
            params: { ...doorParams, choices: ['Yes certainly'] },
            timeline: doorWorld.inv('Shrimps', 1).series(80, (x, i) => x.player({ hp: i >= 3 && i < 7 ? 3 : 10 })),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
        expect(r.sends.filter(x => x === 'Open Door')).toHaveLength(1);
        expect(r.result.reason).toContain('1 choice made');
    });

    test('a cut-off resume keeps working when the used item was consumed', async () => {
        const keyDoor = world()
            .loc('Door', 3016, 3246, { options: ['Open'] })
            .inv('Door key', 1, { id: 2418 });
        const script = dialogScript(BEGGAR, a => a.type === 'useItemOnLoc');
        const r = await simulate(interact, {
            params: { target: 'loc', name: '^Door$', use: { item: '^Door key$' }, choices: ['Yes certainly'] },
            timeline: keyDoor.inv('Shrimps', 1).series(80, (x, i) => x.player({ hp: i >= 3 && i < 7 ? 3 : 10 })),
            react: (a, st) => {
                const e = script.react(a, st);
                // The key is used up by the door.
                return a.type === 'useItemOnLoc' && e ? s => world(e(s)).inv('Door key', 0).build() : e;
            },
        });
        expect(r.result.status).toBe('done');
        expect(r.result.stepRuns['interrupt:low-hp']).toBeGreaterThan(0);
        expect(r.sends.filter(x => x === 'use Door key on Door')).toHaveLength(1);
    });
});
