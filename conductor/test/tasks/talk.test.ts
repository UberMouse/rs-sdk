import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { MAX_CLICKS } from '../../actions/talk';
import { stepBudgetTicks } from '../../lib/task';
import { CONVERSE_MAX_TICKS, TALK_OPEN_TICKS } from '../../actions/talk';
import talk from '../../tasks/talk';
import { type Page, dialogScript } from '../dialog-script';
import { fakePaths } from '../paths';
import { walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { attackedFrom, type World, world } from '../world';

const DUKE = 'Duke Horacio';
const base = world();
/** The Duke one tile away, as in the castle. */
const castle = base.npcBeside(DUKE, { options: ['Talk-to'] });
const dukeParams = { npc: DUKE, choices: ['quests for me', 'Sure, no problem'] };
/** What the Duke says: continue pages around the two choices, ending with the dialog closed. */
const DUKE_PAGES: Page[] = [
    [],
    ['Have you any quests for me?', 'Where can I find money?'],
    [],
    [],
    ['Sure, no problem.', 'Not right now.'],
    [],
    [],
    null,
];
const clicks = (r: Simulation) =>
    r.driver.commands.filter(c => c.type === 'send' && c.action.type === 'clickDialogOption');
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
const isClose = (c: { type: string; action?: BotAction }) => c.type === 'send' && c.action?.type === 'closeModal';

describe('talk: conversation', () => {
    test('talks to the NPC, answers the choices in order and is done when the dialog closes', async () => {
        const script = dialogScript(DUKE_PAGES);
        const r = await simulate(talk, { params: dukeParams, timeline: castle.series(40), react: script.react });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('talk: talked to Duke Horacio, 2 choices made');
        expect(r.sends[0]).toBe('Talk-to Duke Horacio');
        // One click per page: the dialog guard is off, so nothing else answers the continue pages.
        expect(clicks(r)).toHaveLength(DUKE_PAGES.length - 1);
        expect(script.shown).toBe(DUKE_PAGES.length);
        expect(logged(r)).toEqual([
            'dialog: choosing "Have you any quests for me?"',
            'dialog: choosing "Sure, no problem."',
        ]);
        expect(r.steps).toEqual(['talk']);
    });

    test('allows the dialog guard off for the whole run', () => {
        expect(talk.allow).toEqual(['dialog']);
    });

    test("a missing option fails with the dialog's options and closes the dialog", async () => {
        const r = await simulate(talk, {
            params: { npc: DUKE, choices: ['quests for me', 'Take the lamp'] },
            timeline: castle.series(40),
            react: dialogScript(DUKE_PAGES).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'talk: no option matching /Take the lamp/i (choice 2 of 2); the dialog offers "Sure, no problem." | "Not right now."',
        );
        expect(r.driver.commands.filter(isClose)).toHaveLength(1);
    });

    test('a dialog closing with choices left fails', async () => {
        const r = await simulate(talk, {
            params: dukeParams,
            timeline: castle.series(40),
            react: dialogScript([[], null]).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('talk: the dialog closed after 0 of 2 choices (next: /quests for me/i)');
    });

    test('a choice nobody expected fails', async () => {
        const r = await simulate(talk, {
            params: { npc: DUKE, choices: ['quests for me'] },
            timeline: castle.series(40),
            react: dialogScript(DUKE_PAGES).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'talk: a choice came after all 1 were answered: "Sure, no problem." | "Not right now."',
        );
    });

    test('a conversation with no choices clicks through to the end', async () => {
        const r = await simulate(talk, {
            params: { npc: DUKE },
            timeline: castle.series(40),
            react: dialogScript([[], [], [], null]).react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('talk: talked to Duke Horacio, 0 choices made');
    });

    test('another option starts the conversation', async () => {
        const w = base.npcBeside('Aubury', { options: ['Talk-to', 'Trade'] });
        const r = await simulate(talk, {
            params: { npc: 'aubury', option: '^trade$' },
            timeline: w.series(40),
            react: dialogScript([[], null]).react,
        });
        expect(r.sends[0]).toBe('Trade Aubury');
        expect(r.result.status).toBe('done');
    });

    test('a dialog left open is resumed without talking again', async () => {
        const open = castle.dialog({
            text: 'page 0',
            options: ['Have you any quests for me?', 'Where can I find money?'],
        });
        const script = dialogScript(DUKE_PAGES.slice(2), () => false, 1);
        const r = await simulate(talk, {
            params: { npc: DUKE, choices: ['Sure, no problem'] },
            timeline: open.series(40),
            react: script.react,
        });
        // The open page offers other options than the choice: that is a missing option, not a new talk.
        expect(r.sends.filter(s => s.startsWith('Talk-to'))).toEqual([]);
        expect(r.result.status).toBe('failed');
    });
});

const parse = (p: object) => (talk.params as { safeParse(x: unknown): { success: boolean } }).safeParse(p);

const underAttack = (w: World) =>
    w.player({ inCombat: true }).npcBeside('Goblin', { attacking: true, inCombat: true, combatLevel: 2 });

describe('talk: continue an open dialog', () => {
    const CRATE_PAGES: Page[] = [[], ['Yes.', 'No.'], [], [], ['Yes.', 'No.'], null];
    const open = base.dialog({ text: 'page 0', options: [] });

    test('answers the choices of the open dialog without looking for anyone', async () => {
        const script = dialogScript(CRATE_PAGES, () => false, 1);
        const r = await simulate(talk, {
            params: { continue: true, choices: ['^Yes\\.$', '^Yes\\.$'] },
            timeline: open.series(40),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('continue-dialog: continued the open dialog, 2 choices made');
        expect(r.sends.filter(s => /Talk-to/.test(s))).toEqual([]);
        expect(clicks(r)).toHaveLength(CRATE_PAGES.length - 1);
        expect(r.steps).toEqual(['continue-dialog']);
    });

    test('continues an open dialog while attacked: the dialog is the way out of the fight', async () => {
        const r = await simulate(talk, {
            params: { continue: true, choices: ['^Yes\\.$', '^Yes\\.$'] },
            timeline: underAttack(open).series(40),
            react: dialogScript(CRATE_PAGES, () => false, 1).react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toStartWith('continue-dialog: continued the open dialog, 2 choices made');
    });

    // maxHp 40: the eat window is below 20, the hold's floor is 10.
    const lowHp = (hp: number) =>
        simulate(talk, {
            params: { continue: true, choices: ['^Yes\\.$', '^Yes\\.$'] },
            timeline: underAttack(open.inv('Shrimps', 3).player({ hp, maxHp: 40 })).series(40),
            react: dialogScript(CRATE_PAGES, () => false, 1).react,
        });

    test('at low HP above the floor under attack the open dialog is answered, not closed by an eat', async () => {
        const r = await lowHp(15);
        // The eat waits until the dialog is answered (it closes after the last page).
        expect(r.sends.slice(0, CRATE_PAGES.length - 1).filter(s => s.startsWith('Eat'))).toEqual([]);
        expect(clicks(r)).toHaveLength(CRATE_PAGES.length - 1);
    });

    test('at the HP floor under attack the guard eats first', async () => {
        const r = await lowHp(10);
        expect(r.sends[0]).toBe('Eat Shrimps');
    });

    test('continue with no dialog open is still refused while attacked', async () => {
        const r = await simulate(talk, {
            params: { continue: true },
            timeline: underAttack(base).series(10),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith('in combat at');
    });

    test('with no dialog open it fails after a short wait and sends nothing', async () => {
        const r = await simulate(talk, { params: { continue: true, choices: ['Yes'] }, timeline: base.series(40) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('continue-dialog: no dialog is open to continue');
        expect(r.driver.commands.filter(c => c.type === 'send')).toEqual([]);
    });

    test('a dialog opening a tick late is still continued', async () => {
        const script = dialogScript([[], null], () => false, 1);
        const r = await simulate(talk, {
            params: { continue: true },
            timeline: base.series(2).concat(open.series(40)),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
    });

    test('a missing option fails with the dialog options and closes it', async () => {
        const r = await simulate(talk, {
            params: { continue: true, choices: ['Maybe'] },
            timeline: open.series(40),
            react: dialogScript(CRATE_PAGES, () => false, 1).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no option matching /Maybe/i');
        expect(r.driver.commands.filter(isClose)).toHaveLength(1);
    });

    test('the schema refuses continue together with npc, use or at, and still needs one mode', () => {
        expect(parse({ continue: true, choices: ['Yes'] }).success).toBe(true);
        expect(parse({ continue: true, npc: DUKE }).success).toBe(false);
        expect(parse({ continue: true, at: { x: 1, z: 2 } }).success).toBe(false);
        expect(parse({ choices: ['Yes'] }).success).toBe(false);
        expect(parse({ npc: DUKE }).success).toBe(true);
    });
});

describe('talk: finding the NPC', () => {
    test('no such NPC in sight fails after waiting a few loops', async () => {
        const r = await simulate(talk, { params: dukeParams, timeline: base.series(30) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('talk: no reachable /Duke Horacio/ in sight');
        expect(r.sends).toEqual([]);
    });

    test('an unreachable NPC does not count', async () => {
        const w = base.npcBeside(DUKE, { options: ['Talk-to'], reachable: false });
        const r = await simulate(talk, { params: dukeParams, timeline: w.series(30) });
        expect(r.result.reason).toBe(
            'talk: no reachable /Duke Horacio/ in sight (1 in view but unreachable from here)',
        );
    });

    test('three starts in a row that open no dialog fail the run with the last reason', async () => {
        const r = await simulate(talk, {
            params: dukeParams,
            timeline: castle.series(1),
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('talk: 3 tries to talk to Duke Horacio failed (last: not connected)');
        expect(r.sends).toHaveLength(3);
    });

    test('a failed start then a good one resets the count', async () => {
        let n = 0;
        const script = dialogScript([[], null]);
        const r = await simulate(talk, {
            params: { npc: DUKE },
            timeline: castle.series(60),
            respond: a => (a.type === 'interactNpc' && n++ < 2 ? { success: false, message: 'busy' } : undefined),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(logged(r)).toEqual(['talking to Duke Horacio failed: busy', 'talking to Duke Horacio failed: busy']);
    });
});

describe('talk: walking first', () => {
    test('walks to `at` and then talks', async () => {
        const script = dialogScript([[], null]);
        const far = world()
            .player({ at: { x: 3230, z: 3220 } })
            .npc(DUKE, 3212, 3220, { options: ['Talk-to'] });
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3211, z: 3220 } },
            timeline: far.series(80),
            react: walking(script.react),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps.slice(0, 2)).toEqual(['walk', 'talk']);
    });

    test('a stray dialog before the walk is closed, then the walk runs and the talk follows', async () => {
        const script = dialogScript([[], null]);
        const far = world()
            .player({ at: { x: 3230, z: 3220 } })
            .npc(DUKE, 3212, 3220, { options: ['Talk-to'] })
            .dialog({ text: 'stray', options: [] });
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3211, z: 3220 } },
            timeline: far.series(80),
            // The close removes the stray dialog.
            react: walking((a, st) =>
                a.type === 'closeModal' ? t => world(t).dialog(false).build() : script.react(a, st),
            ),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps.slice(0, 3)).toEqual(['talk', 'walk', 'talk']);
        expect(r.driver.commands.filter(isClose)).toHaveLength(1);
        expect(clicks(r)).toHaveLength(1);
    });

    test('already within the tolerance, it does not walk', async () => {
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3222, z: 3218, tolerance: 5 } },
            timeline: castle.series(40),
            react: dialogScript([[], null]).react,
        });
        expect(r.steps).toEqual(['talk']);
    });

    test('a corner of the tolerance square counts as there (walkTo measures Chebyshev, not straight-line)', async () => {
        // 3 east and 3 north: straight-line 4.2 tiles, Chebyshev 3.
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3211, z: 3220 } },
            timeline: castle.player({ at: { x: 3214, z: 3223 } }).series(40),
            react: dialogScript([[], null]).react,
        });
        expect(r.steps).toEqual(['talk']);
    });

    test('no route fails at once', async () => {
        const far = world().player({ at: { x: 3230, z: 3220 } });
        const noRoute = fakePaths(() => ({ success: false, waypoints: [], error: 'no route' }));
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3211, z: 3220 } },
            timeline: far.series(80),
            pathfinder: noRoute,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^walk: can't walk to \(3211,3220\)/);
    });

    test('three walks in a row that never arrive fail the run', async () => {
        const far = world().player({ at: { x: 3230, z: 3220 } });
        // No `walking` react: the bot never moves, so every walk ends stuck.
        const r = await simulate(talk, { params: { npc: DUKE, at: { x: 3211, z: 3220 } }, timeline: far.series(200) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(/^walk: 3 walks in a row failed toward \(3211,3220\)/);
    });

    test('refuses a Wilderness spot', async () => {
        const r = await simulate(talk, { params: { npc: DUKE, at: { x: 3100, z: 3700 } }, timeline: castle.series(3) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('Wilderness');
    });
});

describe('talk: using items', () => {
    const cauldron = base
        .inv('Raw beef', 1, { id: 2132 })
        .inv('Raw chicken', 1, { id: 2138 })
        .loc('Cauldron of Thunder', 3200, 3200, { options: ['Dip in'] });
    const params = { use: { items: ['^raw beef$', '^raw chicken$'], onLoc: 'cauldron of thunder' } };
    /** A use turns the item into its enchanted form: the slot's item is gone. */
    const consumed = (a: BotAction, s: ReturnType<typeof cauldron.build>) =>
        a.type === 'useItemOnLoc'
            ? (t: typeof s) => ({ ...t, inventory: t.inventory.filter(i => i.slot !== a.itemSlot) })
            : undefined;

    test('uses each item on the loc in order; with no npc the run ends after them', async () => {
        const r = await simulate(talk, { params, timeline: cauldron.series(40), react: consumed });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: used 2 items on cauldron of thunder');
        expect(r.sends).toEqual(['use Raw beef on Cauldron of Thunder', 'use Raw chicken on Cauldron of Thunder']);
    });

    test('a use that opens a message box: its pages are clicked through before the run is done', async () => {
        const script = dialogScript([[], [], null], a => a.type === 'useItemOnLoc');
        const r = await simulate(talk, {
            params,
            timeline: cauldron.series(60),
            react: (a, s) => script.react(a, s) ?? consumed(a, s as never),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: used 2 items on cauldron of thunder');
        expect(r.steps).toEqual(['use-items', 'finish']);
        expect(clicks(r)).toHaveLength(2);
    });

    test('a use whose dialog offers a menu: with no choices it is closed and the run is done', async () => {
        const script = dialogScript([['Yes', 'No'], null], a => a.type === 'useItemOnLoc');
        const r = await simulate(talk, {
            params,
            timeline: cauldron.series(60),
            react: (a, s) => script.react(a, s) ?? consumed(a, s as never),
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: used 2 items on cauldron of thunder');
        expect(r.driver.commands.some(isClose)).toBe(true);
        expect(clicks(r)).toHaveLength(0);
    });

    test('a use whose dialog is a menu the choices do not match fails and closes it', async () => {
        const script = dialogScript([['Yes', 'No'], null], a => a.type === 'useItemOnLoc');
        const r = await simulate(talk, {
            params: { ...params, choices: ['^maybe$'] },
            timeline: cauldron.series(60),
            react: (a, s) => script.react(a, s) ?? consumed(a, s as never),
        });
        expect(r.result.status).toBe('failed');
        expect(r.driver.commands.some(isClose)).toBe(true);
    });

    test('an item the bot does not hold fails', async () => {
        const r = await simulate(talk, { params, timeline: cauldron.inv('Raw beef', 0).series(10) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'use-items: no item matching /^raw beef$/ in the inventory to use on cauldron of thunder',
        );
    });

    test('no such loc in sight fails after waiting', async () => {
        const w = base.inv('Raw beef', 1, { id: 2132 });
        const r = await simulate(talk, { params, timeline: w.series(30) });
        expect(r.result.reason).toBe('use-items: no reachable cauldron of thunder in sight');
    });

    test('uses first, then talks when both are given', async () => {
        const w = cauldron.npcBeside(DUKE, { options: ['Talk-to'] });
        const script = dialogScript([[], null]);
        const r = await simulate(talk, {
            params: { ...params, npc: DUKE },
            timeline: w.series(60),
            react: (a, s) => consumed(a, s as never) ?? script.react(a, s),
        });
        expect(r.result.status).toBe('done');
        expect(r.steps).toEqual(['use-items', 'talk']);
    });
});

describe('talk: guards', () => {
    test('low HP mid-conversation: the guard eats and the same dialog carries on', async () => {
        const script = dialogScript(DUKE_PAGES);
        const r = await simulate(talk, {
            params: dukeParams,
            timeline: castle.inv('Shrimps', 1).series(60, (w, i) => w.player({ hp: i >= 6 && i < 9 ? 3 : 10 })),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s.startsWith('Talk-to'))).toHaveLength(1);
        expect(r.sends.some(s => /eat/i.test(s))).toBe(true);
        expect(r.result.reason).toBe('talk: talked to Duke Horacio, 2 choices made');
    });
});

describe('talk: guards around the walk and the start', () => {
    const far = world()
        .player({ at: { x: 3230, z: 3220 } })
        .inv('Shrimps', 1)
        .npc(DUKE, 3212, 3220, { options: ['Talk-to'] });

    test('an attacker hurting the bot mid-walk: the guard eats, then the walk resumes and the talk follows', async () => {
        const script = dialogScript([[], null]);
        const r = await simulate(talk, {
            params: { npc: DUKE, at: { x: 3211, z: 3220 } },
            timeline: far.series(120, (w, i) => (i >= 3 && i < 8 ? attackedFrom(w, i, 8).player({ hp: 3 }) : w)),
            react: walking(script.react),
        });
        expect(r.result.status).toBe('done');
        expect(r.sends.some(s => /eat/i.test(s))).toBe(true);
        expect(r.result.stepRuns['interrupt:low-hp']).toBe(1);
        expect(r.steps).toEqual(['walk', 'talk']);
    });

    test('a stray interface open when the talk step starts is closed, and the talk then carries on', async () => {
        const script = dialogScript([[], null]);
        const r = await simulate(talk, {
            params: { npc: DUKE },
            timeline: castle.series(40, (w, i) => (i < 2 ? w.modal(5000) : w.modal(false))),
            react: script.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toContain('Talk-to Duke Horacio');
    });
});

describe('talk: params and budgets', () => {
    test('needs an npc or a use', async () => {
        const r = await simulate(talk, { params: {}, timeline: base.series(3) });
        expect(r.result.status).toBe('error');
        expect(r.result.reason).toContain('give an npc to talk to, a use, or both');
    });

    test('a pattern that is not a regular expression is refused', async () => {
        const r = await simulate(talk, { params: { npc: DUKE, choices: ['('] }, timeline: base.series(3) });
        expect(r.result.reason).toContain('choices.0: not a valid regular expression');
    });

    test('the step budget covers opening a dialog and the longest conversation', () => {
        expect(MAX_CLICKS).toBeGreaterThan(40);
        expect(stepBudgetTicks(talk.stepTimeoutMs ?? 0)).toBeGreaterThanOrEqual(TALK_OPEN_TICKS + CONVERSE_MAX_TICKS);
    });
});

describe('talk: using items on a loc by tile, and an item by id', () => {
    const monuments = base
        .inv('Golden key', 1, { id: 2945 })
        .loc('Monument', 3430, 9888, { options: ['Examine'] })
        .loc('Monument', 3430, 9890, { options: ['Examine'] })
        .loc('Monument', 3430, 9892, { options: ['Examine'] });
    const consumed = (a: BotAction) =>
        a.type === 'useItemOnLoc'
            ? (s: ReturnType<typeof monuments.build>) => ({
                  ...s,
                  inventory: s.inventory.filter(i => i.slot !== a.itemSlot),
              })
            : undefined;
    const sentTo = async (tile?: { x: number; z: number }) => {
        const sent: BotAction[] = [];
        const r = await simulate(talk, {
            params: { use: { items: ['^golden key$'], onLoc: '^monument$', tile } },
            timeline: monuments.series(40),
            react: a => {
                sent.push(a);
                return consumed(a);
            },
        });
        return { r, sent };
    };

    test('`tile` picks the loc standing there, not the nearest of that name', async () => {
        const { r, sent } = await sentTo({ x: 3430, z: 9892 });
        expect(r.result.status).toBe('done');
        expect(sent[0]).toMatchObject({ type: 'useItemOnLoc', x: 3430, z: 9892 });
    });

    test('without `tile` the nearest is used', async () => {
        const { sent } = await sentTo();
        expect(sent[0]).toMatchObject({ x: 3430, z: 9888 });
    });

    test('a tile nothing stands on fails after waiting, naming it', async () => {
        const { r, sent } = await sentTo({ x: 1, z: 2 });
        expect(r.result.reason).toBe('use-items: no reachable ^monument$ at (1,2) in sight');
        expect(sent).toEqual([]);
    });

    test('an item `{ id }` picks that item among several sharing a name', async () => {
        const s0 = base
            .inv('Bucket of water', 1, { id: 1929 })
            .loc('Coffin', 3414, 3487, { options: ['Open'] })
            .build();
        const bucket = s0.inventory[0]!;
        const state = {
            ...s0,
            inventory: [
                { ...bucket, slot: 0, id: 1929 },
                { ...bucket, slot: 1, id: 2954 },
                { ...bucket, slot: 2, id: 2953 },
            ],
        };
        const sent: BotAction[] = [];
        const r = await simulate(talk, {
            params: { use: { items: [{ id: 2954 }], onLoc: '^coffin$' } },
            timeline: [state],
            react: a => {
                sent.push(a);
                return a.type === 'useItemOnLoc' ? s => ({ ...s, inventory: [] }) : undefined;
            },
        });
        expect(r.result.status).toBe('done');
        expect(sent[0]).toMatchObject({ type: 'useItemOnLoc', itemSlot: 1 });
    });

    test('an item id the bot does not hold fails naming the id', async () => {
        const r = await simulate(talk, {
            params: { use: { items: [{ id: 2954 }], onLoc: '^monument$' } },
            timeline: monuments.series(10),
        });
        expect(r.result.reason).toBe('use-items: no item matching #2954 in the inventory to use on ^monument$');
    });
});

describe('talk: travels', () => {
    const sailor = base.npcBeside('Captain Tobias', { options: ['Talk-to'] });
    const sailParams = { npc: 'Captain Tobias', choices: ['Yes please'], travels: true };
    const PAGES: Page[] = [[], ['Yes please.', 'No, thank you.'], null];
    /** The ship lands the player far away at tick `at`; the sail interface hides the dialog meanwhile. */
    const sails = (at: number, to: { x: number; z: number; level?: number }) =>
        sailor.series(60, (w, i) => (i >= at ? w.player({ at: to }) : w));

    test('is done on arrival, after the dialog has closed, not when it closes', async () => {
        const r = await simulate(talk, {
            params: sailParams,
            timeline: sails(14, { x: 2956, z: 3143, level: 1 }),
            react: dialogScript(PAGES).react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('talk: talked to Captain Tobias, 1 choice made, arrived at (2956,3143)');
    });

    test('a plane change alone counts as the journey', async () => {
        const here = sailor.build().player;
        const r = await simulate(talk, {
            params: sailParams,
            timeline: sailor.series(60, (w, i) =>
                i >= 12 ? w.player({ at: { x: here?.worldX ?? 0, z: here?.worldZ ?? 0, level: 1 } }) : w,
            ),
            react: dialogScript(PAGES).react,
        });
        expect(r.result.status).toBe('done');
    });

    test('a conversation that ends with nobody sailing fails with the reason', async () => {
        const r = await simulate(talk, {
            params: sailParams,
            timeline: sailor.series(80),
            react: dialogScript(PAGES).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'talk: no journey followed the talk with Captain Tobias (fare unpaid, or weapons or armour refused?)',
        );
    });

    test('the schema refuses travels with continue, or without an npc', () => {
        expect(parse(sailParams).success).toBe(true);
        expect(parse({ continue: true, travels: true, choices: ['Yes'] }).success).toBe(false);
        expect(parse({ use: { items: ['bones'], onLoc: '^altar$' }, travels: true }).success).toBe(false);
    });

    test('the walk to the sailor is not the journey', async () => {
        // The player is carried 10 tiles in the first ticks (the walk to the NPC), before the dialog opens; nothing sails.
        const r = await simulate(talk, {
            params: sailParams,
            timeline: sailor.series(80, (w, i) => (i >= 1 ? w.player({ at: { x: 3100, z: 3100 } }) : w)),
            react: dialogScript(PAGES).react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('no journey followed');
    });

    test('without travels the move is not waited for', async () => {
        const r = await simulate(talk, {
            params: { npc: 'Captain Tobias', choices: ['Yes please'] },
            timeline: sailor.series(60),
            react: dialogScript(PAGES).react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('talk: talked to Captain Tobias, 1 choice made');
    });
});

describe('talk: a use that teleports the player', () => {
    // Glarial's pebble on her tombstone: the game moves the bot into the tomb, with no message and no inventory change.
    const stone = base.player({ at: { x: 2560, z: 3446 } }).inv("Glarial's pebble", 1, { id: 294 });
    const timeline = stone
        .loc("Glarial's Tombstone", 2560, 3445, { options: ['Read'], reachable: true })
        .series(30, (w, i) => (i < 3 ? w : w.player({ at: { x: 2554, z: 9844 } })));

    test('the position jump is the effect: the use counts and the task is done', async () => {
        const r = await simulate(talk, {
            params: { use: { items: ["^Glarial's pebble$"], onLoc: "^Glarial's Tombstone$" } },
            timeline,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe("finish: used 1 item on ^Glarial's Tombstone$");
    });
});
