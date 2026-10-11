import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { converse, startTalk, TALK_OPTION } from '../../../actions/talk';
import { countItems } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Duke Horacio, Lumbridge castle first floor (wiki/quests/rune-mysteries.md): start the quest.
const DUKE_SPOT = { x: 3211, z: 3221, level: 1 };
const DUKE = /^duke horacio$/i;
const DUKE_WAIT_MS = 30_000;
const BODY_MS = 60_000;

const dukeIn = (s: BotWorldState) => s.nearbyNpcs.find(n => DUKE.test(n.name) && n.reachable !== false);

test(
    'startTalk and converse take the Duke through the quest start and hand over the air talisman',
    async () => {
        await withFixtureBot({ position: DUKE_SPOT }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => !!dukeIn(s), DUKE_WAIT_MS);
            const duke = dukeIn(ready);
            if (!duke) throw new Error('no Duke Horacio after wait');

            const started = await runLive(sdk, ctx => startTalk(ctx, duke, TALK_OPTION));
            expect(started, JSON.stringify(started)).toEqual({ ok: true });
            const progress = { answered: 0 };
            const talked = await runLive(sdk, ctx => converse(ctx, [/quests for me/i, /sure, no problem/i], progress));
            expect(talked, JSON.stringify(talked)).toEqual({ ok: true, answered: 2 });
            const after = sdk.getState();
            if (!after) throw new Error('no state after the talk');
            expect(after.dialog.isOpen).toBe(false);
            expect(countItems(after, /^air talisman$/i)).toBe(1);
        });
    },
    itestTimeout({ extraMs: DUKE_WAIT_MS + BODY_MS }),
);

test(
    'converse fails naming the options when the expected one is not offered, and the dialog is left to close',
    async () => {
        await withFixtureBot({ position: DUKE_SPOT }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => !!dukeIn(s), DUKE_WAIT_MS);
            const duke = dukeIn(ready);
            if (!duke) throw new Error('no Duke Horacio after wait');
            expect(await runLive(sdk, ctx => startTalk(ctx, duke, TALK_OPTION))).toEqual({ ok: true });
            const r = await runLive(sdk, ctx => converse(ctx, [/take the lamp/i], { answered: 0 }));
            expect(r).toMatchObject({ ok: false, reason: 'missing-option' });
            expect(r.ok ? '' : r.message).toContain('"Have you any quests for me?"');
        });
    },
    itestTimeout({ extraMs: DUKE_WAIT_MS + BODY_MS }),
);
