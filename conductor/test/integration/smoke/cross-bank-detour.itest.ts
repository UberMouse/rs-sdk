import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// North-east of the Falador West bank (stand 2947,3368), where no other integration test stands; the air talisman in
// the bank, none carried; the temple behind the Air ruins (2984,3291). The way: the bank, the talisman, the ruins.
const NORTH_OF_BANK = { x: 2960, z: 3380 };
const TEMPLE = { x: 2843, z: 4834 };
/** The plan's bank record (ActionContext.bank): the talisman, as the bank names it. */
const RECORD = (item: string) => (item.toLowerCase() === 'air talisman' ? 1 : 0);

test(
    'walkTo goes to the bank for the talisman the air ruins need, then into the temple',
    async () => {
        await withFixtureBot(
            { position: NORTH_OF_BANK, bank: [{ id: Items.AIR_TALISMAN, count: 1 }] },
            async ({ sdk }) => {
                const w = await walkLive(sdk, TEMPLE, { bank: RECORD });
                expect(w.result.ok, detail(w)).toBe(true);
                expect(here(sdk).z, detail(w)).toBeGreaterThan(4000);
                expect(
                    w.logs.some(l => /withdrew 1 Air talisman/.test(l)),
                    detail(w),
                ).toBe(true);
                expect(w.sent, detail(w)).toContain('use Air talisman on Mysterious ruins');
            },
        );
    },
    itestTimeout({ extraMs: WALKS_MS }),
);
