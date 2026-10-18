import { expect, test } from 'bun:test';
import { configId } from '../../../lib/packs';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// Holy Grail done (%grail, varp 5, at ^grail_complete), and the magic whistle carried: blown at the six heads on
// Karamja it takes the player to the restored Fisher Realm (quests/quest_grail/scripts/quest_grail.rs2:41), blown in
// the realm back out (:46). The six heads' zone is x 2740-2743, z 3234-3237 (:37); the realm's fishing spots stand
// round (2673, 4707).
const GRAIL = { 5: 10 };
const WHISTLE = configId('obj', 'magic_whistle')!;
const HEADS = { x: 2741, z: 3235 };
const REALM = { x: 2673, z: 4707 };

test(
    'walkTo blows the whistle into the Fisher Realm and walks on from where it lands, then blows it back out',
    async () => {
        await withFixtureBot(
            { position: HEADS, varps: GRAIL, inventory: [{ id: WHISTLE, count: 1 }] },
            async ({ sdk }) => {
                const into = await walkLive(sdk, REALM, { tolerance: 3, met: ['quest:grail'] });
                expect(into.result.ok, detail(into)).toBe(true);
                expect(here(sdk).z, detail(into)).toBeGreaterThan(4600);
                expect(
                    into.logs.some(l => /crossed item-op 1 magic_whistle/.test(l)),
                    detail(into),
                ).toBe(true);

                const out = await walkLive(sdk, HEADS, { tolerance: 3, met: ['quest:grail'] });
                expect(out.result.ok, detail(out)).toBe(true);
                expect(here(sdk).z, detail(out)).toBeLessThan(4000);
                expect(
                    out.logs.some(l => /crossed item-op 1 magic_whistle/.test(l)),
                    detail(out),
                ).toBe(true);
            },
        );
    },
    itestTimeout({ extraMs: 2 * WALKS_MS }),
);
