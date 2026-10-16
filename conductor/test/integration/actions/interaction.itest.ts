import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { interact } from '../../../actions/interaction';
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
