import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { interact, useOn } from '../../../actions/interaction';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Father Aereck in Lumbridge chapel (areas/area_lumbridge/scripts/father_aereck.rs2): Talk-to opens his dialog.
const CHAPEL = { x: 3243, z: 3207 };
const AERECK = /^father aereck$/i;
const WAIT_MS = 30_000;
const BODY_MS = 30_000;

const aereckIn = (s: BotWorldState) => s.nearbyNpcs.find(n => AERECK.test(n.name) && n.reachable !== false);

test(
    'interact sends Talk-to to an NPC and reports the dialog it opened',
    async () => {
        await withFixtureBot({ position: CHAPEL }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => !!aereckIn(s), WAIT_MS);
            const npc = aereckIn(ready);
            if (!npc) throw new Error('no Father Aereck after wait');
            const r = await runLive(sdk, ctx => interact(ctx, { kind: 'npc', npc }, /^talk-?to$/i));
            expect(r, JSON.stringify(r)).toEqual({ ok: true, effect: 'a dialog opened' });
            expect(sdk.getState()?.dialog.isOpen).toBe(true);
        });
    },
    itestTimeout({ extraMs: WAIT_MS + BODY_MS }),
);

test(
    'interact wears an inventory item, and refuses an option it lacks without sending',
    async () => {
        await withFixtureBot(
            { position: { x: 3223, z: 3212 }, inventory: [{ id: Items.BRONZE_SWORD, count: 1 }] },
            async ({ sdk }) => {
                const item = sdk.getInventory().find(i => /^bronze sword$/i.test(i.name));
                if (!item) throw new Error('no bronze sword');
                const refused = await runLive(sdk, ctx => interact(ctx, { kind: 'item', item }, /^eat$/i));
                expect(refused).toMatchObject({ ok: false, reason: 'no-option' });
                const r = await runLive(sdk, ctx => interact(ctx, { kind: 'item', item }, /^wield|wear/i));
                expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
                expect(sdk.getEquipment().some(e => /^bronze sword$/i.test(e.name))).toBe(true);
            },
        );
    },
    itestTimeout({ extraMs: BODY_MS }),
);

// The Waterfall dungeon's pillars (waterfall_pillars.rs2; varp 65 is the quest stage): a rune used on a pillar
// is judged by the inventory change alone, with no option sent.
test(
    'useOn puts a rune on a pillar and reports the inventory change',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2563, z: 9912 },
                skills: { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 70 },
                inventory: [
                    { id: 295, count: 1 },
                    { id: 296, count: 1 },
                    { id: 556, count: 6 },
                ],
                varps: { 65: 6 },
            },
            async ({ sdk }) => {
                const state = await sdk.waitForCondition(
                    s => s.nearbyLocs.some(l => l.x === 2562 && l.z === 9912 && /^pillar$/i.test(l.name)),
                    WAIT_MS,
                );
                const loc = state.nearbyLocs.find(l => l.x === 2562 && l.z === 9912 && /^pillar$/i.test(l.name));
                const item = sdk.getInventory().find(i => i.id === 556);
                if (!loc || !item) throw new Error('no pillar or air rune');
                const r = await runLive(sdk, ctx => useOn(ctx, item, loc));
                expect(r, JSON.stringify(r)).toEqual({ ok: true, effect: 'the inventory changed' });
            },
        );
    },
    itestTimeout({ extraMs: WAIT_MS + BODY_MS }),
);

const isTree = (l: { x: number; z: number; name: string }) =>
    l.x === 2512 && l.z === 3465 && /^dead tree$/i.test(l.name);

// Hudon's island (quest_waterfall.rs2): the rope thrown on the Dead tree pulls the bot across, which only the
// movement watch sees (the inventory keeps the rope), and the settle waits out the landing.
test(
    'useOn the rope on the Dead tree is judged by the move the game made',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2512, z: 3466 },
                skills: { Attack: 60, Strength: 60, Defence: 60, Hitpoints: 70 },
                inventory: [{ id: 954, count: 1 }],
                varps: { 65: 2 },
            },
            async ({ sdk }) => {
                const state = await sdk.waitForCondition(s => s.nearbyLocs.some(isTree), WAIT_MS);
                const loc = state.nearbyLocs.find(isTree);
                const item = sdk.getInventory().find(i => i.id === 954);
                if (!loc || !item) throw new Error('no Dead tree or rope');
                const r = await runLive(sdk, ctx => useOn(ctx, item, loc));
                expect(r, JSON.stringify(r)).toEqual({ ok: true, effect: 'the player moved to (2511,3463)' });
                const p = sdk.getState()?.player;
                expect({ x: p?.worldX, z: p?.worldZ }).toEqual({ x: 2511, z: 3463 });
            },
        );
    },
    itestTimeout({ extraMs: WAIT_MS + BODY_MS }),
);
