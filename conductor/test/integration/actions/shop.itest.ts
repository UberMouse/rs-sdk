import { expect, test } from 'bun:test';
import type { BotActions } from '../../../../sdk/actions';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { buy, closeShop, openShop, sell, withShop } from '../../../actions/shop';
import { log } from '../../../core/op';
import { countItems } from '../../../lib/util';
import { withFixtureBot } from '../harness';
import { runLive } from './live';

// Bob's Brilliant Axes: the shop smoke test trades at the Lumbridge General Store (3212,3247). A shop's
// stock is shared world state, so every trade here is undone within the trip (axes bought are sold back),
// and the assertions are on amounts moved and coins direction, never on a price.
const BOB = { x: 3232, z: 3203 };
const BOB_NAME = /^bob$/i;
const AXE = /^bronze axe$/i;
const LOGS = /^logs$/i;
const COINS = /^coins$/i;
const START_COINS = 200;
const FIXTURE = {
    position: BOB,
    coins: START_COINS,
    inventory: [{ id: Items.LOGS, count: 1 }],
};
const TIMEOUT_MS = 180_000;

/** One step of a shop trip as either path reports it: whether it succeeded, how much moved, why not, and what the shop shows. */
interface Step {
    ok: boolean;
    moved: number;
    reason: string | undefined;
    shopOpen: boolean;
}

interface Trip {
    steps: Step[];
    axesHeld: number;
    logsHeld: number;
    coinsHeld: number;
}

type Path = (sdk: BotSDK, bot: BotActions) => Promise<Step[]>;

const shopOpen = (sdk: BotSDK) => sdk.getState()!.shop.isOpen;
/** The bot.* methods spell a reason with underscores, the ops with hyphens. */
const spelled = (reason: string | undefined) => reason?.replaceAll('-', '_');

const viaBot: Path = async (sdk, bot) => {
    const steps: Step[] = [];
    const note = (ok: boolean, moved = 0, reason?: string) =>
        steps.push({ ok, moved, reason: spelled(reason), shopOpen: shopOpen(sdk) });
    note((await bot.openShop(BOB_NAME)).success);
    const bought = await bot.buyFromShop(AXE, 2);
    note(bought.success, bought.amountBought, bought.reason);
    const dear = await bot.buyFromShop(/^mithril battleaxe$/i, 5);
    note(dear.success, dear.amountBought, dear.reason);
    const absent = await bot.buyFromShop(/^hammer$/i);
    note(absent.success, absent.amountBought, absent.reason);
    const refused = await bot.sellToShop(LOGS, 1);
    note(refused.success, refused.amountSold, refused.reason);
    const one = await bot.sellToShop(AXE, 1);
    note(one.success, one.amountSold, one.reason);
    const rest = await bot.sellToShop(AXE, 'all');
    note(rest.success, rest.amountSold, rest.reason);
    note((await bot.closeShop()).success);
    return steps;
};

const viaOp: Path = async sdk => {
    const steps: Step[] = [];
    const note = (ok: boolean, moved = 0, reason?: string) =>
        steps.push({ ok, moved, reason: spelled(reason), shopOpen: shopOpen(sdk) });
    note((await runLive(sdk, ctx => openShop(ctx, BOB_NAME))).ok);
    const bought = await runLive(sdk, ctx => buy(ctx, AXE, 2));
    note(bought.ok, bought.amountBought, bought.ok ? undefined : bought.reason);
    const dear = await runLive(sdk, ctx => buy(ctx, /^mithril battleaxe$/i, 5));
    note(dear.ok, dear.amountBought, dear.ok ? undefined : dear.reason);
    const absent = await runLive(sdk, ctx => buy(ctx, /^hammer$/i));
    note(absent.ok, absent.amountBought, absent.ok ? undefined : absent.reason);
    const refused = await runLive(sdk, ctx => sell(ctx, LOGS, 1));
    note(refused.ok, refused.amountSold, refused.ok ? undefined : refused.reason);
    const one = await runLive(sdk, ctx => sell(ctx, AXE, 1));
    note(one.ok, one.amountSold, one.ok ? undefined : one.reason);
    const rest = await runLive(sdk, ctx => sell(ctx, AXE, 'all'));
    note(rest.ok, rest.amountSold, rest.ok ? undefined : rest.reason);
    note((await runLive(sdk, closeShop)).ok);
    return steps;
};

async function trip(path: Path): Promise<Trip> {
    return withFixtureBot(FIXTURE, async ({ sdk, bot }) => {
        expect(countItems(sdk.getState()!, COINS)).toBe(START_COINS);
        const steps = await path(sdk, bot);
        const s = sdk.getState()!;
        return {
            steps,
            axesHeld: countItems(s, AXE),
            logsHeld: countItems(s, LOGS),
            coinsHeld: countItems(s, COINS),
        };
    });
}

// Opened; two axes bought; five of a battleaxe too dear to afford (nothing arrives); a hammer Bob does
// not stock; logs Bob does not buy (rejected); one axe sold, then the rest; closed. Coins end at a price
// that moves with stock, so only their direction is compared below.
const STEPS: Step[] = [
    { ok: true, moved: 0, reason: undefined, shopOpen: true },
    { ok: true, moved: 2, reason: undefined, shopOpen: true },
    { ok: false, moved: 0, reason: 'timeout', shopOpen: true },
    { ok: false, moved: 0, reason: 'item_not_found', shopOpen: true },
    { ok: false, moved: 0, reason: 'rejected', shopOpen: true },
    { ok: true, moved: 1, reason: undefined, shopOpen: true },
    { ok: true, moved: 1, reason: undefined, shopOpen: true },
    { ok: true, moved: 0, reason: undefined, shopOpen: false },
];

function expectTrip(result: Trip): void {
    expect(result.steps).toEqual(STEPS);
    expect(result.axesHeld).toBe(0);
    expect(result.logsHeld).toBe(1);
    // Two axes bought at full price and sold back for less.
    expect(result.coinsHeld).toBeLessThan(START_COINS);
    expect(result.coinsHeld).toBeGreaterThan(START_COINS - 100);
}

test(
    'the bot.* shop methods open, buy, sell and close',
    async () => {
        expectTrip(await trip(viaBot));
    },
    TIMEOUT_MS,
);

test(
    'the shop ops do the same as the bot.* methods',
    async () => {
        expectTrip(await trip(viaOp));
    },
    TIMEOUT_MS,
);

test(
    'withShop leaves the shop closed after its body, and after one that throws',
    async () => {
        await withFixtureBot(FIXTURE, async ({ sdk }) => {
            const bought = await runLive(sdk, ctx => withShop(ctx, BOB_NAME, buy(ctx, AXE, 1)));
            expect(bought).toMatchObject({ ok: true, value: { ok: true, amountBought: 1 }, closed: { ok: true } });
            expect(shopOpen(sdk)).toBe(false);
            expect(countItems(sdk.getState()!, AXE)).toBe(1);

            const returned = await runLive(sdk, ctx => withShop(ctx, BOB_NAME, sell(ctx, AXE, 'all')));
            expect(returned).toMatchObject({ ok: true, value: { ok: true, amountSold: 1 }, closed: { ok: true } });
            expect(shopOpen(sdk)).toBe(false);

            const body = (function* () {
                yield* log('body about to throw');
                throw new Error('boom');
            })();
            await expect(runLive(sdk, ctx => withShop(ctx, BOB_NAME, body))).rejects.toThrow('boom');
            expect(shopOpen(sdk)).toBe(false);
        });
    },
    TIMEOUT_MS,
);

test(
    'with no such shopkeeper in view openShop is not found for the method and npc-not-found for the op',
    async () => {
        // Nothing is traded; this only reads. Nobody called Aubury stands at Bob's.
        await withFixtureBot(FIXTURE, async ({ sdk, bot }) => {
            const method = await bot.openShop(/^aubury$/i);
            expect(method).toMatchObject({ success: false });
            const op = await runLive(sdk, ctx => openShop(ctx, /^aubury$/i));
            expect(op).toEqual({ ok: false, reason: 'npc-not-found', message: method.message });
        });
    },
    TIMEOUT_MS,
);
