import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState } from '../../../../sdk/types';
import { drop } from '../../../actions/drop';
import { withFixtureBot } from '../harness';
import { runLive } from './live';

// Open ground north-east of Lumbridge, every tile walkable when probed. Other runs leave logs around,
// and theirs show up for this bot (turning public) or vanish (despawning) on their own timers, so each
// drop only checks that the logs on the bot's tile went up from just before it. x 3254..3258 is disjoint from
// dismiss.itest.ts's 3248..3252, north of burn.itest.ts's z 3254..3255, and clear of the firemaking
// smoke test's area (x 3224..3236, z 3234..3246), so a parallel run never drops onto or lights beside
// the same tiles.
const field = () => ({ x: 3254 + Math.floor(Math.random() * 5), z: 3258 + Math.floor(Math.random() * 5) });
const LOGS = /^logs$/i;
const THREE_LOGS = [1, 2, 3].map(() => ({ id: Items.LOGS, count: 1 }));
const TIMEOUT_MS = 120_000;

const countLogs = (items: { name: string }[]) => items.filter(i => LOGS.test(i.name)).length;
const logsHere = (s: BotWorldState) =>
    countLogs(s.groundItems.filter(i => i.x === s.player?.worldX && i.z === s.player?.worldZ));

/** What one drop did: whether it reported success, the slots it dropped, and the logs left held. */
interface Dropped {
    ok: boolean;
    slots: number;
    held: number;
}

/** Runs `dropLogs`, then waits for at least `slots` more logs on the bot's tile than just before it. */
async function dropAndLand(
    sdk: BotSDK,
    slots: number,
    dropLogs: () => Promise<Omit<Dropped, 'held'>>,
): Promise<Dropped> {
    const before = logsHere(sdk.getState()!);
    const r = { ...(await dropLogs()), held: countLogs(sdk.getInventory()) };
    await sdk.waitForCondition(s => logsHere(s) >= before + slots, 5000);
    return r;
}

/**
 * Drops one log, then the rest, with `dropOne`/`dropAll`, and checks each lands on the bot's tile.
 * Returns what each reported, for the two paths to be compared.
 */
async function dropTwice(
    sdk: BotSDK,
    dropOne: () => Promise<Omit<Dropped, 'held'>>,
    dropAll: () => Promise<Omit<Dropped, 'held'>>,
): Promise<Dropped[]> {
    expect(countLogs(sdk.getInventory())).toBe(3);
    const one = await dropAndLand(sdk, 1, dropOne);
    const rest = await dropAndLand(sdk, 2, dropAll);
    return [one, rest];
}

const fromBot = (r: { success: boolean; slotsDropped: number }) => ({ ok: r.success, slots: r.slotsDropped });
const fromOp = (r: { ok: boolean; slotsDropped: number }) => ({ ok: r.ok, slots: r.slotsDropped });

const EXPECTED: Dropped[] = [
    { ok: true, slots: 1, held: 2 },
    { ok: true, slots: 2, held: 0 },
];

test(
    'bot.dropItem removes the item from the inventory and puts it on the ground',
    async () => {
        await withFixtureBot({ position: field(), inventory: THREE_LOGS }, async ({ sdk, bot }) => {
            const results = await dropTwice(
                sdk,
                async () => fromBot(await bot.dropItem(LOGS, 1)),
                async () => fromBot(await bot.dropItem(LOGS, 'all')),
            );
            expect(results).toEqual(EXPECTED);
        });
    },
    TIMEOUT_MS,
);

test(
    'the drop op does the same as bot.dropItem',
    async () => {
        await withFixtureBot({ position: field(), inventory: THREE_LOGS }, async ({ sdk }) => {
            const results = await dropTwice(
                sdk,
                async () => fromOp(await runLive(sdk, ctx => drop(ctx, LOGS, 1))),
                async () => fromOp(await runLive(sdk, ctx => drop(ctx, LOGS))),
            );
            expect(results).toEqual(EXPECTED);
        });
    },
    TIMEOUT_MS,
);
