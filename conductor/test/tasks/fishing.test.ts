import { describe, expect, test } from 'bun:test';
import { FISH_RESUME_WAIT_TICKS } from '../../actions/fish';
import type { StopCondition } from '../../lib/stop';
import fishing from '../../tasks/fishing';
import { fakePaths } from '../paths';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const SPOT = { x: 3086, z: 3228 };
const HOP = { x: 3085, z: 3230 };
const NET_OPTIONS = ['Net', 'Bait'];
const base = world().skill('Fishing', 1, 0).inv('Small fishing net', 1);
const shore = base.npc('Fishing spot', SPOT.x, SPOT.z, { index: 7, options: NET_OPTIONS });
/** The spot has hopped to another tile (same npc index). */
const hopped = base.npc('Fishing spot', HOP.x, HOP.z, { index: 7, options: NET_OPTIONS });
/** `n` shrimps caught since the start, 10 xp each. */
const caught = (w: World, n: number) => w.inv('Raw shrimps', n).skill('Fishing', 1, 10 * n);
const xp = (amount: number): StopCondition[] => [{ kind: 'xp', skill: 'Fishing', amount }];
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const NET = 'Net Fishing spot';
/** A level-2 Goblin (the bot is level 3) fights the bot from tick 3 (the engine refuses to start a run in combat) until tick `until`. */
const attackedFrom = (w: World, i: number, until = Infinity, foeLevel = 2) =>
    i >= 3 && i < until
        ? w
              .player({ inCombat: true })
              .npc('Goblin', 3222, 3219, { attacking: true, inCombat: true, combatLevel: foeLevel })
        : w;

describe('fishing: fishing', () => {
    test('casts once and keeps fishing: later catches send nothing', async () => {
        const r = await simulate(fishing, {
            timeline: shore.series(30, (w, i) => caught(w, i >= 20 ? 3 : i >= 12 ? 2 : i >= 5 ? 1 : 0)),
            stops: xp(30),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +30 Fishing xp');
        expect(r.sends).toEqual([NET]);
        expect(r.result.inventoryDelta).toEqual({ 'Raw shrimps': 3 });
    });

    test('a spot that hops is followed without counting a failure', async () => {
        const r = await simulate(fishing, {
            timeline: shore.series(30, (w, i) => (i >= 20 ? caught(hopped, 1) : i >= 8 ? hopped : w)),
            stops: xp(10),
        });
        expect(r.result.reason).toBe('reached +10 Fishing xp');
        expect(r.sends).toEqual([NET, NET]);
        expect(logged(r)).toEqual(['fishing spot (3086,3228) moved away']);
    });

    test('a resumed wait that times out casts again', async () => {
        const second = 5 + FISH_RESUME_WAIT_TICKS + 30;
        const r = await simulate(fishing, {
            timeline: shore.series(second + 5, (w, i) => caught(w, i >= second ? 2 : i >= 5 ? 1 : 0)),
            stops: xp(20),
        });
        expect(r.result.reason).toBe('reached +20 Fishing xp');
        expect(r.sends).toEqual([NET, NET]);
        expect(logged(r)).toEqual(['fish failed: timed out waiting for a fish at (3086,3228)']);
    });

    test('only spots of the method count: a Lure/Bait spot is ignored for net, picked for lure', async () => {
        const river = base.npc('Fishing spot', 3240, 3250, { index: 9, options: ['Lure', 'Bait'] });
        const r = await simulate(fishing, { timeline: river.series(1) });
        expect(r.result.reason).toBe('fish: no reachable net fishing spot nearby for 280s');
        const lure = await simulate(fishing, {
            params: { method: 'lure' },
            timeline: river
                .skill('Fishing', 20, 0)
                .inv('Fly fishing rod', 1, { id: 309 })
                .inv('Feather', 1, { id: 314 })
                .series(5),
            stops: xp(1),
            react: () => undefined,
        });
        expect(lure.sends[0]).toBe('Lure Fishing spot');
    });

    test('a level-up dialog mid-wait is cleared by the guard and the catch still counts', async () => {
        const r = await simulate(fishing, {
            timeline: shore.series(20, (w, i) => {
                if (i >= 6) return caught(w, 1);
                return i === 3 ? w.dialog({ options: ['Click here to continue'] }) : w;
            }),
            stops: xp(10),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('reached +10 Fishing xp');
        expect(r.sends).toEqual([NET, 'continue dialog']);
        expect(logged(r)).toEqual([]);
    });

    test('a spot that keeps moving with no catch fails after ten, a catch in between resets', async () => {
        const flicker = (w: World, i: number) => (i % 2 === 0 ? shore : hopped).player({}).inv('Small fishing net', 1);
        const r = await simulate(fishing, { timeline: shore.series(200, flicker) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('fish: spot keeps moving/leaving view at (');
        expect(r.sends.filter(s => s === NET)).toHaveLength(10);
    });

    test('the Draynor area around the southern tile excludes the northern spot near the dark wizards', async () => {
        const area = { x: 3086, z: 3227, radius: 2 };
        const northern = base.npc('Fishing spot', 3085, 3230, { index: 3, options: NET_OPTIONS });
        const both = northern.npc('Fishing spot', 3086, 3227, { index: 4, options: NET_OPTIONS });
        const r = await simulate(fishing, {
            params: { area },
            timeline: both.player({ at: { x: 3085, z: 3229 } }).series(3),
            stops: xp(1),
        });
        // The northern spot is nearer the bot but outside the area.
        expect(r.commands[0]).toMatchObject({ action: { npcIndex: 4 } });
        const only = await simulate(fishing, {
            params: { area },
            timeline: northern.player({ at: { x: 3086, z: 3227 } }).series(1),
        });
        expect(only.result.reason).toBe(
            'fish: area depleted: no reachable net fishing spot in radius 2 for 280s; net spot exists outside area at (3085,3230)',
        );
    });

    test('the nearest spot is chosen', async () => {
        const two = shore.npc('Fishing spot', 3050, 3235, { index: 8, options: NET_OPTIONS });
        const r = await simulate(fishing, { timeline: two.series(3), stops: xp(1) });
        expect(r.sends[0]).toBe(NET);
        expect(r.commands[0]).toMatchObject({ action: { npcIndex: 7 } });
    });

    test('six failed attempts in a row fail the run with the last reason; a catch in between resets', async () => {
        const r = await simulate(fishing, {
            timeline: shore.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('fish: 6 fish attempts in a row failed (last: not connected)');
        expect(r.sends).toHaveLength(6);
    });

    test('low HP mid-fish aborts, eats, then casts again', async () => {
        const r = await simulate(fishing, {
            timeline: shore
                .inv('Shrimps', 1)
                .series(30, (w, i) => caught(w.player({ hp: i === 8 ? 4 : 10 }), i >= 20 ? 1 : 0)),
            stops: xp(10),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends[0]).toBe(NET);
        expect(r.sends).toContain('Eat Shrimps');
    });
});

describe('fishing: preflight', () => {
    test('no tool', async () => {
        const r = await simulate(fishing, { timeline: world().skill('Fishing', 1, 0).series(1) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('preflight: no small fishing net in inventory');
    });

    test('no bait for a bait method', async () => {
        const r = await simulate(fishing, {
            params: { method: 'bait' },
            timeline: shore.skill('Fishing', 5, 0).inv('Fishing rod', 1, { id: 307 }).series(1),
        });
        expect(r.result.reason).toBe('preflight: no fishing bait in inventory');
    });

    test('level too low', async () => {
        const r = await simulate(fishing, {
            params: { method: 'cage' },
            timeline: shore.inv('Lobster pot', 1, { id: 301 }).series(1),
        });
        expect(r.result.reason).toBe('preflight: cage needs fishing 40, bot has 1');
    });

    test('an area reaching the Wilderness', async () => {
        const r = await simulate(fishing, {
            params: { area: { x: 3087, z: 3520, radius: 10 } },
            timeline: shore.series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('reaches the Wilderness');
    });
});

describe('fishing: supplies running out', () => {
    test('the bait gone mid-run fails with that reason', async () => {
        const rod = shore.skill('Fishing', 5, 0).inv('Fishing rod', 1, { id: 307 });
        const r = await simulate(fishing, {
            params: { method: 'bait' },
            timeline: rod
                .inv('Fishing bait', 1, { id: 313 })
                .series(20, (w, i) => (i >= 8 ? w.inv('Fishing bait', 0).inv('Raw sardine', 1, { id: 327 }) : w)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('no-supplies: no fishing bait in inventory');
    });
});

describe('fishing: a full inventory', () => {
    const full = shore.inv('Raw shrimps', 27);

    test('onFull drop drops the fish and keeps fishing', async () => {
        const r = await simulate(fishing, {
            timeline: [full.build(), ...shore.series(30, (w, i) => caught(w, i >= 8 ? 1 : 0)).slice(1)],
            stops: xp(10),
        });
        expect(r.result.reason).toBe('reached +10 Fishing xp');
        expect(r.sends).toEqual(['drop Raw shrimps', NET]);
        expect(r.steps).toEqual(['drop-fish', 'fish']);
    });

    test('drops every kind of fish held', async () => {
        const mixed = shore.inv('Raw shrimps', 13).inv('Raw anchovies', 13, { id: 321 }).inv('Tinderbox', 1);
        const r = await simulate(fishing, {
            timeline: mixed.series(10),
            respond: a => (a.type === 'dropItem' ? undefined : { success: false, message: 'not connected' }),
        });
        expect([...new Set(r.sends.filter(s => s.startsWith('drop')))]).toEqual([
            'drop Raw shrimps',
            'drop Raw anchovies',
        ]);
    });

    test('onFull drop fails when the drop leaves the inventory full', async () => {
        const r = await simulate(fishing, { timeline: full.series(5), react: () => undefined });
        expect(r.result.reason).toBe(
            'drop-fish: inventory still full after dropping fish (Drop of Raw shrimps (slot 1) was not observed)',
        );
    });

    test('onFull stop ends the run done, holding the fish', async () => {
        const r = await simulate(fishing, { params: { onFull: 'stop' }, timeline: full.series(1) });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('stop-full: inventory full: 27 fish');
        expect(r.sends).toEqual([]);
    });

    test('a full inventory without fish fails', async () => {
        const r = await simulate(fishing, {
            params: { onFull: 'stop' },
            timeline: shore.inv('Tinderbox', 27).series(1),
        });
        expect(r.result.reason).toBe('stop-full: inventory full with no net fish');
    });
});

describe('fishing: no spot, area', () => {
    test('with an area, fails "area depleted" after the give-up budget; spots outside do not count', async () => {
        const r = await simulate(fishing, {
            params: { area: { x: 3086, z: 3228, radius: 4 } },
            timeline: base.player({ at: SPOT }).npc('Fishing spot', 3100, 3228, { options: NET_OPTIONS }).series(1),
        });
        expect(r.result.reason).toBe(
            'fish: area depleted: no reachable net fishing spot in radius 4 for 280s; net spot exists outside area at (3100,3228)',
        );
        expect(r.driver.state().tick).toBe(700);
        expect(r.sends).toEqual([]);
    });

    test('an unreachable spot does not count', async () => {
        const r = await simulate(fishing, {
            timeline: base.npc('Fishing spot', 3086, 3228, { options: NET_OPTIONS, reachable: false }).series(1),
        });
        expect(r.result.reason).toBe('fish: no reachable net fishing spot nearby for 280s');
    });

    test('a spot appearing during the wait is fished', async () => {
        const r = await simulate(fishing, {
            timeline: base.series(40, (w, i) => (i >= 20 ? caught(shore, i >= 25 ? 1 : 0) : w)),
            stops: xp(10),
        });
        expect(r.result.reason).toBe('reached +10 Fishing xp');
        expect(logged(r)).toEqual(['no net fishing spot available, waiting']);
        expect(r.sends).toEqual([NET]);
    });

    test('far from the area, walks back first', async () => {
        const r = await simulate(fishing, {
            params: { area: { x: 3500, z: 3228, radius: 5 } },
            timeline: shore.series(3),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'no path' })),
        });
        expect(r.steps[0]).toBe('return-to-area');
        expect(r.sends).toEqual([]);
    });
});

describe('fishing: under attack', () => {
    test('with auto-retaliate off, fails as soon as the bot is attacked', async () => {
        const r = await simulate(fishing, {
            timeline: shore.autoRetaliate(false).series(10, (w, i) => attackedFrom(w, i)),
        });
        expect(r.result.reason).toBe(
            'interrupt:under-attack: attacked by Goblin (level 2) with auto-retaliate off at (3222,3218)',
        );
        expect(r.sends).toEqual([NET]);
    });

    test('with auto-retaliate on, stops fishing until the fight is over, then casts again', async () => {
        const r = await simulate(fishing, {
            timeline: shore.autoRetaliate(true).series(30, (w, i) => caught(attackedFrom(w, i, 10), i >= 15 ? 1 : 0)),
            stops: xp(10),
        });
        expect(r.result.reason).toBe('reached +10 Fishing xp');
        expect(r.sends).toEqual([NET, NET]);
        expect(r.result.stepRuns).toEqual({ fish: 2, 'interrupt:under-attack': 7 });
    });

    test("an attacker above the bot's combat level fails the run", async () => {
        const r = await simulate(fishing, {
            timeline: shore.autoRetaliate(true).series(10, (w, i) => attackedFrom(w, i, Infinity, 5)),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('interrupt:under-attack:');
        expect(r.result.reason).toContain('Goblin (level 5)');
    });
});

const lvl84 = world().skill('Fishing', 84, 0).inv('Harpoon', 1, { id: 311 });
const memberfish = (w: World, index = 4, x = 2605, z = 3418) =>
    w.npc('Fishing spot', x, z, { index, options: ['Net', 'Harpoon'] });
const rarefish = (w: World, index = 5, x = 2601, z = 3420) =>
    w.npc('Fishing spot', x, z, { index, options: ['Cage', 'Harpoon'] });
const sharkCaught = (w: World, n: number) => w.inv('Raw shark', n, { id: 383 }).skill('Fishing', 84, 100 * n);
const tunaCaught = (w: World, n: number) => w.inv('Raw tuna', 1, { id: 359 }).skill('Fishing', 84, 100 * n);

describe('fishing: shark and fallback', () => {
    test('the shark method picks the Net/Harpoon spot, not the Cage/Harpoon one', async () => {
        const w = rarefish(memberfish(lvl84)).player({ at: { x: 2601, z: 3420 } });
        const r = await simulate(fishing, {
            params: { method: 'shark' },
            timeline: w.series(12, (x, i) => (i >= 6 ? sharkCaught(x, 1) : x)),
            stops: xp(100),
        });
        expect(r.result.reason).toBe('reached +100 Fishing xp');
        expect(r.sends).toEqual(['Harpoon Fishing spot']);
        expect(r.commands[0]).toMatchObject({ action: { npcIndex: 4 } });
    });

    test('the harpoon method ignores a Net/Harpoon spot without a fallback', async () => {
        const r = await simulate(fishing, { params: { method: 'harpoon' }, timeline: memberfish(lvl84).series(1) });
        expect(r.result.reason).toBe('fish: no reachable harpoon fishing spot nearby for 280s');
    });

    test('the shark method is gated at level 76', async () => {
        const r = await simulate(fishing, {
            params: { method: 'shark' },
            timeline: memberfish(lvl84.skill('Fishing', 75, 0)).series(1),
        });
        expect(r.result.reason).toBe('preflight: shark needs fishing 76, bot has 75');
    });

    test('a fallback is gated by its level and tool too', async () => {
        const low = await simulate(fishing, {
            params: { method: 'harpoon', fallback: 'shark' },
            timeline: memberfish(lvl84.skill('Fishing', 60, 0)).series(1),
        });
        expect(low.result.reason).toBe('preflight: shark needs fishing 76, bot has 60');
        const noTool = await simulate(fishing, {
            params: { method: 'bait', fallback: 'shark' },
            timeline: world().skill('Fishing', 84, 0).inv('Fishing rod', 1, { id: 307 }).series(1),
        });
        expect(noTool.result.reason).toBe('preflight: no fishing bait in inventory');
    });

    test('only memberfish in the area: fishes shark; the main spot returning is taken once the catch lands', async () => {
        const area = { x: 2605, z: 3418, radius: 8 };
        const r = await simulate(fishing, {
            params: { method: 'harpoon', fallback: 'shark', area },
            timeline: memberfish(lvl84)
                .player({ at: { x: 2605, z: 3417 } })
                .series(90, (w, i) => {
                    // The Cage/Harpoon spot appears at tick 10; the shark lands at 15, the tuna at 60.
                    const seen = i >= 10 ? rarefish(w) : w;
                    return i >= 60 ? tunaCaught(sharkCaught(seen, 1), 2) : i >= 15 ? sharkCaught(seen, 1) : seen;
                }),
            stops: xp(200),
        });
        expect(r.result.reason).toBe('reached +200 Fishing xp');
        // Shark spot first; after the catch at 15 the harpoon spot (index 5) is cast, not the shark spot again.
        const casts = r.commands.flatMap(c => ('action' in c && 'npcIndex' in c.action ? [c.action.npcIndex] : []));
        expect(casts).toEqual([4, 5]);
        expect(logged(r)).toEqual(['fishing shark', 'fishing harpoon']);
    });

    test('with no spot of either method in the area it waits and fails naming both', async () => {
        const area = { x: 2605, z: 3418, radius: 8 };
        const r = await simulate(fishing, {
            params: { method: 'harpoon', fallback: 'shark', area },
            timeline: lvl84.player({ at: { x: 2605, z: 3417 } }).series(1),
        });
        expect(r.result.reason).toBe(
            'fish: area depleted: no reachable harpoon/shark fishing spot in radius 8 for 280s',
        );
    });

    test('a spot outside the area is not a fallback, but is named when it is a fallback kind', async () => {
        const area = { x: 2605, z: 3418, radius: 3 };
        const r = await simulate(fishing, {
            params: { method: 'harpoon', fallback: 'shark', area },
            timeline: memberfish(lvl84, 4, 2640, 3418)
                .player({ at: { x: 2605, z: 3418 } })
                .series(1),
        });
        expect(r.result.reason).toBe(
            'fish: area depleted: no reachable harpoon/shark fishing spot in radius 3 for 280s; shark spot exists outside area at (2640,3418)',
        );
        expect(r.sends).toEqual([]);
    });

    test('a fallback equal to the method is rejected', () => {
        expect(fishing.params.safeParse({ method: 'shark', fallback: 'shark' }).success).toBe(false);
        expect(fishing.params.safeParse({ method: 'harpoon', fallback: 'shark' }).success).toBe(true);
    });

    test('a full inventory drops fish of both methods', async () => {
        const mixed = memberfish(lvl84).inv('Raw tuna', 14, { id: 359 }).inv('Raw shark', 13, { id: 383 });
        const r = await simulate(fishing, {
            params: { method: 'harpoon', fallback: 'shark' },
            timeline: mixed.series(10),
            respond: a => (a.type === 'dropItem' ? undefined : { success: false, message: 'nc' }),
        });
        expect([...new Set(r.sends.filter(s => s.startsWith('drop')))]).toEqual(['drop Raw tuna', 'drop Raw shark']);
    });
});

describe('fishing: seenOutsideArea diagnostic', () => {
    const params = { area: { x: 3086, z: 3228, radius: 4 } };

    test('a spot of the method in view outside the area while waiting warns, naming its tile', async () => {
        const r = await simulate(fishing, {
            params,
            timeline: base.player({ at: SPOT }).npc('Fishing spot', 3100, 3228, { options: NET_OPTIONS }).series(1),
        });
        expect(r.result.diagnostics).toMatchObject({ idleTicks: 700, seenOutsideAreaTicks: 700 });
        expect(r.result.warnings?.[0]).toContain('seenOutsideArea');
        expect(r.result.warnings?.[0]).toContain('(3100,3228)');
    });

    test('no spot in view: idle ticks, no warning', async () => {
        const r = await simulate(fishing, { params, timeline: base.player({ at: SPOT }).series(1) });
        expect(r.result.diagnostics).toEqual({ idleTicks: 700, seenOutsideAreaTicks: 0 });
        expect(r.result.warnings).toBeUndefined();
    });
});
