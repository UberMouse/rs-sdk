import { expect, test } from 'bun:test';
import type { BotActions } from '../../../../sdk/actions';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { closeBank, deposit, openBank, withBank, withdraw } from '../../../actions/bank';
import { log } from '../../../core/op';
import { countItems } from '../../../lib/util';
import { withFixtureBot } from '../harness';
import { runLive } from './live';

// Draynor's bank: the Varrock West one belongs to the bank smoke test (3185,3436 radius 6) and the
// anvil test next to it. A bank is per-player state, so parallel bots only share the booths' tiles.
const DRAYNOR = { x: 3092, z: 3243 };
const LOGS = /^logs$/i;
const BONES = /^bones$/i;
const FIXTURE = {
    position: DRAYNOR,
    inventory: [1, 2, 3].map(() => ({ id: Items.LOGS, count: 1 })),
    bank: [{ id: Items.BONES, count: 5 }],
};
const TIMEOUT_MS = 180_000;

/** One step of a bank trip as either path reports it: whether it succeeded, how much moved, and what the bank shows. */
interface Step {
    ok: boolean;
    moved: number;
    bankOpen: boolean;
}

interface Trip {
    steps: Step[];
    logsHeld: number;
    bonesHeld: number;
    bonesBanked: number;
}

/** The bank trip as the legacy bot.* methods run it. */
type Path = (sdk: BotSDK, bot: BotActions) => Promise<Step[]>;

const bankOpen = (sdk: BotSDK) => sdk.getState()!.bank.isOpen;
const bonesBanked = (sdk: BotSDK) =>
    sdk
        .getState()!
        .bank.items.filter(i => BONES.test(i.name))
        .reduce((n, i) => n + i.count, 0);

const viaBot: Path = async (sdk, bot) => {
    const steps: Step[] = [];
    const note = (ok: boolean, moved = 0) => steps.push({ ok, moved, bankOpen: bankOpen(sdk) });
    note((await bot.openBank()).success);
    const one = await bot.depositItem(LOGS, 1);
    note(one.success, one.amountDeposited);
    const rest = await bot.depositItem(LOGS, -1);
    note(rest.success, rest.amountDeposited);
    const three = await bot.withdrawItem(BONES, 3);
    note(three.success, three.amountWithdrawn);
    const more = await bot.withdrawItem(BONES, 9);
    note(more.success, more.amountWithdrawn);
    const all = await bot.withdrawItem(BONES, -1);
    note(all.success, all.amountWithdrawn);
    note((await bot.closeBank()).success);
    return steps;
};

const viaOp: Path = async sdk => {
    const steps: Step[] = [];
    const note = (ok: boolean, moved = 0) => steps.push({ ok, moved, bankOpen: bankOpen(sdk) });
    note((await runLive(sdk, openBank)).ok);
    const one = await runLive(sdk, ctx => deposit(ctx, LOGS, 1));
    note(one.ok, one.amountDeposited);
    const rest = await runLive(sdk, ctx => deposit(ctx, LOGS));
    note(rest.ok, rest.amountDeposited);
    const three = await runLive(sdk, ctx => withdraw(ctx, BONES, 3));
    note(three.ok, three.amountWithdrawn);
    const more = await runLive(sdk, ctx => withdraw(ctx, BONES, 9));
    note(more.ok, more.amountWithdrawn);
    const all = await runLive(sdk, ctx => withdraw(ctx, BONES, 'all'));
    note(all.ok, all.amountWithdrawn);
    note((await runLive(sdk, closeBank)).ok);
    return steps;
};

async function trip(path: Path): Promise<Trip> {
    return withFixtureBot(FIXTURE, async ({ sdk, bot }) => {
        expect(countItems(sdk.getState()!, LOGS)).toBe(3);
        const steps = await path(sdk, bot);
        const s = sdk.getState()!;
        return {
            steps,
            logsHeld: countItems(s, LOGS),
            bonesHeld: countItems(s, BONES),
            bonesBanked: bonesBanked(sdk),
        };
    });
}

// Opened, one then the other two logs banked, three bones withdrawn, then 9 asked of the 2 left (a
// partial fill, reported as a failure with what did arrive), then all of a slot that is now empty
// (not found: nothing moves), closed. `moved` is 0 where a method reports no amount.
const EXPECTED: Trip = {
    steps: [
        { ok: true, moved: 0, bankOpen: true },
        { ok: true, moved: 1, bankOpen: true },
        { ok: true, moved: 2, bankOpen: true },
        { ok: true, moved: 3, bankOpen: true },
        { ok: false, moved: 2, bankOpen: true },
        { ok: false, moved: 0, bankOpen: true },
        { ok: true, moved: 0, bankOpen: false },
    ],
    logsHeld: 0,
    bonesHeld: 5,
    bonesBanked: 0,
};

test(
    'the bot.* bank methods open, deposit, withdraw and close',
    async () => {
        const result = await trip(viaBot);
        expect(result).toEqual(EXPECTED);
    },
    TIMEOUT_MS,
);

test(
    'the bank ops do the same as the bot.* methods',
    async () => {
        const result = await trip(viaOp);
        expect(result).toEqual(EXPECTED);
    },
    TIMEOUT_MS,
);

test(
    'withBank leaves the bank closed after its body, and after one that throws',
    async () => {
        await withFixtureBot(FIXTURE, async ({ sdk }) => {
            const r = await runLive(sdk, ctx => withBank(ctx, deposit(ctx, LOGS)));
            expect(r).toMatchObject({ ok: true, value: { ok: true, amountDeposited: 3 }, closed: { ok: true } });
            expect(bankOpen(sdk)).toBe(false);
            expect(countItems(sdk.getState()!, LOGS)).toBe(0);

            const body = (function* () {
                yield* log('body about to throw');
                throw new Error('boom');
            })();
            await expect(runLive(sdk, ctx => withBank(ctx, body))).rejects.toThrow('boom');
            expect(bankOpen(sdk)).toBe(false);
        });
    },
    TIMEOUT_MS,
);

test(
    'with no bank in view openBank is no_bank_found for the method and no-bank-found for the op',
    async () => {
        // Lumbridge has no bank on this server (learnings/banking.md); this only reads.
        await withFixtureBot({ position: { x: 3222, z: 3218 } }, async ({ sdk, bot }) => {
            const method = await bot.openBank();
            expect(method).toMatchObject({ success: false, reason: 'no_bank_found' });
            const op = await runLive(sdk, openBank);
            expect(op).toEqual({ ok: false, reason: 'no-bank-found', message: method.message });
        });
    },
    TIMEOUT_MS,
);
