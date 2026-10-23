import { expect, test } from 'bun:test';
import { QUESTS, questProgress } from '../../../lib/quests';
import { itestTimeout, withFixtureBot } from '../harness';

// Spawn-adjacent ground nobody trains on; the test only reads the quest tab.
const SPOT = { x: 3222, z: 3218 };
/** The Rune Mysteries varp and its complete value (QUESTS.runemysteries; lib:rune-mysteries-done holds 63 = 6). */
const RUNE_MYSTERIES = { varp: 63, complete: 6 };
/** The server colours the tab in the login script; the first states can precede it. */
const TAB_WAIT_MS = 20_000;

test(
    'the quest tab shows Rune Mysteries done on a save that completed it, and not started on one that has not',
    async () => {
        expect(QUESTS.runemysteries!.complete).toBe(RUNE_MYSTERIES.complete);
        await withFixtureBot(
            { position: SPOT, varps: { [RUNE_MYSTERIES.varp]: RUNE_MYSTERIES.complete } },
            async ({ sdk }) => {
                await sdk.waitForCondition(s => questProgress(s, 'runemysteries') === 'done', TAB_WAIT_MS);
                const state = sdk.getState()!;
                expect(state.questTab).toHaveLength(Object.keys(QUESTS).length);
                expect(questProgress(state, 'runemysteries')).toBe('done');
                expect(questProgress(state, 'imp')).toBe('none');
            },
        );
        await withFixtureBot({ position: SPOT }, async ({ sdk }) => {
            await sdk.waitForCondition(s => (s.questTab?.length ?? 0) > 0, TAB_WAIT_MS);
            const state = sdk.getState()!;
            expect(questProgress(state, 'runemysteries')).toBe('none');
            // Every quest of the table has a tab entry of that name.
            for (const id of Object.keys(QUESTS)) expect(questProgress(state, id), id).not.toBeNull();
        });
    },
    itestTimeout({ extraMs: 60_000 }),
);
