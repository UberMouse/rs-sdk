import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { BURN_WAIT_TICKS, burn } from '../../../actions/burn';
import { dismiss } from '../../../actions/dismiss';
import { drop } from '../../../actions/drop';
import { TICK_MS } from '../../../lib/util';
import { type FixtureBot, itestTimeout, levelXp, withFixtureBot } from '../harness';
import { runLive, sidestep } from './live';

// Open ground north-east of Lumbridge, every tile walkable and fire-friendly when probed. It is kept
// clear of the firemaking smoke test's area (x 3224..3236, z 3234..3246), whose fires would otherwise
// block tiles here, of burn.itest.ts's z 3254..3255, and disjoint from drop.itest.ts's x 3254..3258.
// A recently lit tile can refuse another fire (wiki/skills/firemaking.md), so each run picks a random
// tile. The two tests run one after the other, so their fires never race.
const field = () => ({ x: 3248 + Math.floor(Math.random() * 5), z: 3258 + Math.floor(Math.random() * 5) });
const LIGHT_ATTEMPTS = 5;
const LIGHT_WAIT_MS = BURN_WAIT_TICKS * TICK_MS;
/** Time for the dialog checks, the drop and the sidestep walks around the light attempts. */
const BODY_SLACK_MS = 60_000;
/** One xp short of level 2, so the first fire's xp levels up. */
const ONE_SHORT_OF_LEVEL_2 = levelXp(2) - 1;
const LOGS = /^logs$/i;

const kit = () => ({
    position: field(),
    inventory: [
        { id: Items.TINDERBOX, count: 1 },
        { id: Items.LOGS, count: 1 },
        { id: Items.LOGS, count: 1 },
    ],
});
const leveled = (st: BotWorldState) => (st.skills.find(k => k.name === 'Firemaking')?.baseLevel ?? 1) > 1;
const refusals = (st: BotWorldState) => st.gameMessages.filter(m => /can't light a fire here/i.test(m.text)).length;
const levelUpText = (sdk: BotSDK) => (sdk.getState()?.dialog.allComponents ?? []).map(c => c.text).join(' ');

/** The run's tests, so both start from a fresh bot one short of Firemaking 2. */
const fixture = (fn: (bot: FixtureBot) => Promise<void>) =>
    withFixtureBot(kit(), fn, { xp: { Firemaking: ONE_SHORT_OF_LEVEL_2 } });

test(
    'bot.dismissBlockingUI clears a level-up dialog so the next action runs',
    async () => {
        await fixture(async ({ sdk, bot }) => {
            expect(sdk.getSkill('Firemaking')?.baseLevel).toBe(1);

            // Raw sends: bot.burnLogs would clear the level-up itself while waiting for the fire. A refused
            // light ("You can't light a fire here") keeps the logs, so step aside and try again.
            for (let attempt = 0; attempt < LIGHT_ATTEMPTS && !leveled(sdk.getState()!); attempt++) {
                const tinderbox = sdk.findInventoryItem(/^tinderbox$/i);
                const logs = sdk.findInventoryItem(LOGS);
                if (!tinderbox || !logs) throw new Error('fixture items missing');
                const refusedBefore = refusals(sdk.getState()!);
                await sdk.sendUseItemOnItem(tinderbox.slot, logs.slot);
                // Lighting retries until it succeeds, so wait for the level-up unless the light is refused.
                await sdk.waitForCondition(st => leveled(st) || refusals(st) > refusedBefore, LIGHT_WAIT_MS);
                if (!leveled(sdk.getState()!)) await sidestep(sdk, bot);
            }
            expect(leveled(sdk.getState()!), 'no fire was lit').toBe(true);
            expect(levelUpText(sdk)).toMatch(/Congratulations/);

            await bot.dismissBlockingUI();
            const after = sdk.getState();
            expect(after?.dialog.isOpen).toBe(false);
            expect(after?.interface?.isOpen ?? false).toBe(false);

            // The blocker was the only thing in the way: the next action completes.
            const dropped = await bot.dropItem(LOGS, 1);
            expect(dropped.success, dropped.message).toBe(true);
        });
    },
    itestTimeout({ extraMs: LIGHT_ATTEMPTS * LIGHT_WAIT_MS + BODY_SLACK_MS }),
);

test(
    'the dismiss op clears a level-up dialog as bot.dismissBlockingUI does, so the next op runs',
    async () => {
        await fixture(async ({ sdk, bot }) => {
            // The burn op leaves the level-up to the dialog guard, and none runs here, so it stays open. A
            // refused tile, or a light whose rolls all fail within the wait, is tried again a step aside.
            for (let attempt = 0; attempt < LIGHT_ATTEMPTS && !leveled(sdk.getState()!); attempt++) {
                const lit = await runLive(sdk, ctx => burn(ctx, LOGS));
                if (lit.ok) break;
                expect(['cant-light-here', 'timeout'], lit.message).toContain(lit.reason);
                await sidestep(sdk, bot);
            }
            expect(leveled(sdk.getState()!), 'no fire was lit').toBe(true);
            await sdk.waitForCondition(st => st.dialog.isOpen, 5000);
            expect(levelUpText(sdk)).toMatch(/Congratulations/);

            const cleared = await runLive(sdk, dismiss);
            expect(cleared.ok, JSON.stringify(cleared)).toBe(true);
            const after = sdk.getState();
            expect(after?.dialog.isOpen).toBe(false);
            expect(after?.interface?.isOpen ?? false).toBe(false);

            const dropped = await runLive(sdk, ctx => drop(ctx, LOGS, 1));
            expect(dropped).toEqual({ ok: true, slotsDropped: 1 });
        });
    },
    itestTimeout({ extraMs: LIGHT_ATTEMPTS * LIGHT_WAIT_MS + BODY_SLACK_MS }),
);
