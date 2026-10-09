import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { itestTimeout, levelXp, withFixtureBot } from '../harness';

// Open ground north-east of Lumbridge, every tile walkable and fire-friendly when probed. It is kept
// clear of the firemaking smoke test's area (x 3224..3236, z 3234..3246), whose fires would otherwise
// block tiles here, and disjoint from dropItem.itest.ts's x 3254..3258. A recently lit tile can refuse
// another fire (wiki/skills/firemaking.md), so each run picks a random tile.
const FIELD = { x: 3248 + Math.floor(Math.random() * 5), z: 3258 + Math.floor(Math.random() * 5) };
const LIGHT_ATTEMPTS = 5;
const LIGHT_WAIT_MS = 30_000;
/** Time for the dialog checks, the drop and the sidestep walks around the light attempts. */
const BODY_SLACK_MS = 60_000;
/** One xp short of level 2, so the first fire's xp levels up. */
const ONE_SHORT_OF_LEVEL_2 = levelXp(2) - 1;

const leveled = (st: BotWorldState) => (st.skills.find(k => k.name === 'Firemaking')?.baseLevel ?? 1) > 1;
const refusals = (st: BotWorldState) => st.gameMessages.filter(m => /can't light a fire here/i.test(m.text)).length;

test(
    'bot.dismissBlockingUI clears a level-up dialog so the next action runs',
    async () => {
        await withFixtureBot(
            {
                position: FIELD,
                inventory: [
                    { id: Items.TINDERBOX, count: 1 },
                    { id: Items.LOGS, count: 1 },
                    { id: Items.LOGS, count: 1 },
                ],
            },
            async ({ sdk, bot }) => {
                expect(sdk.getSkill('Firemaking')?.baseLevel).toBe(1);

                // Raw sends: bot.burnLogs would clear the level-up itself while waiting for the fire. A refused
                // light ("You can't light a fire here") keeps the logs, so step aside and try again.
                for (let attempt = 0; attempt < LIGHT_ATTEMPTS && !leveled(sdk.getState()!); attempt++) {
                    const tinderbox = sdk.findInventoryItem(/^tinderbox$/i);
                    const logs = sdk.findInventoryItem(/^logs$/i);
                    if (!tinderbox || !logs) throw new Error('fixture items missing');
                    const refusedBefore = refusals(sdk.getState()!);
                    await sdk.sendUseItemOnItem(tinderbox.slot, logs.slot);
                    // Lighting retries until it succeeds, so wait for the level-up unless the light is refused.
                    await sdk.waitForCondition(st => leveled(st) || refusals(st) > refusedBefore, LIGHT_WAIT_MS);
                    if (!leveled(sdk.getState()!)) {
                        // Some neighbours are blocked (walkTo then fails), so take the first one it reaches.
                        const p = sdk.getState()!.player!;
                        for (const [dx, dz] of [
                            [-1, 0],
                            [1, 0],
                            [0, 1],
                            [0, -1],
                        ] as const) {
                            const walked = await bot.walkTo(p.worldX + dx, p.worldZ + dz, 0);
                            if (walked.success) break;
                        }
                    }
                }
                expect(leveled(sdk.getState()!), 'no fire was lit').toBe(true);
                const dialogText = (sdk.getState()?.dialog.allComponents ?? []).map(c => c.text).join(' ');
                expect(dialogText).toMatch(/Congratulations/);

                await bot.dismissBlockingUI();
                const after = sdk.getState();
                expect(after?.dialog.isOpen).toBe(false);
                expect(after?.interface?.isOpen ?? false).toBe(false);

                // The blocker was the only thing in the way: the next action completes.
                const drop = await bot.dropItem(/^logs$/i, 1);
                expect(drop.success, drop.message).toBe(true);
            },
            { xp: { Firemaking: ONE_SHORT_OF_LEVEL_2 } },
        );
    },
    itestTimeout({ extraMs: LIGHT_ATTEMPTS * LIGHT_WAIT_MS + BODY_SLACK_MS }),
);
