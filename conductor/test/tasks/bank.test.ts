import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { CLOSE_BANK_WAIT_TICKS, OPEN_BANK_WAIT_TICKS } from '../../actions/bank';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../../actions/modal';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { TICK_MS } from '../../lib/util';
import bank from '../../tasks/bank';
import { fakePaths } from '../paths';
import { bankReact, walking } from '../react';
import { simulate, type Simulation } from '../simulate';
import { type World, world } from '../world';

const AREA = { x: 3185, z: 3436, radius: 6 };
const BOOTH = { x: 3185, z: 3433 };
const OPEN = 'Bank Bank booth';
const CLOSE = 'close bank';
/** The close withBank sends after an open that timed out, in case it lands late. */
const CLOSE_UNCONFIRMED = 'close bank (open not confirmed)';
const BANK_CONTENTS = [
    { name: 'Bones', count: 5 },
    { name: 'Copper ore', count: 20 },
];
const react = bankReact(BANK_CONTENTS);
const standing = world()
    .player({ at: { x: AREA.x, z: AREA.z } })
    .loc('Bank booth', BOOTH.x, BOOTH.z, { options: ['Bank', 'Collect'] });
const carrying = standing.inv('Logs', 2).inv('Bronze axe', 1).inv('Shrimps', 1);
/** What the task logged, guards' reports left out. */
const logged = (r: Simulation) =>
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [String(e.msg)] : []));
/** A bank that opens but whose items never move. */
const opensOnly: TimelineOptions['react'] = (action, state) =>
    action.type === 'interactLoc' || action.type === 'closeModal' ? react(action, state) : undefined;

/** A bank that opens and moves items but ignores every close. */
const staysOpen: TimelineOptions['react'] = (action, state) =>
    action.type === 'closeModal' ? undefined : react(action, state);
/**
 * The bank opens on tick 1 and a transfer sent then lands on tick 2, the tick HP drops: the low-HP
 * guard cancels the op's wait before it sees the items move, so the op never reports them.
 */
const hurtOnLanding = (w: World) => w.series(40, (x, i) => x.player({ hp: i >= 2 && i < 4 ? 3 : 10 }));
/** The actions sent with this reason, in order. */
const sentAs = (r: Simulation, reason: string) =>
    r.commands.flatMap(c => (c.type === 'send' && c.action.reason === reason ? [c.action] : []));
const refusal = async (params: unknown, w: World = carrying) =>
    (await simulate(bank, { params, timeline: w.series(1) })).result;

describe('bank: the trip', () => {
    test('opens the bank, deposits, withdraws, closes, and is done', async () => {
        const r = await simulate(bank, {
            params: { area: AREA, deposit: [{ item: 'Logs' }], withdraw: [{ item: 'Bones', count: 3 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('finish: all 2 bank operations made');
        expect(r.sends).toEqual([OPEN, 'deposit Logs', 'withdraw Bones', CLOSE]);
        expect(r.steps).toEqual(['operate', 'finish']);
        expect(r.result.inventoryDelta).toEqual({ Logs: -2, Bones: 3 });
        expect(logged(r)).toEqual(['deposit Logs: Deposited Logs x2', 'withdraw Bones x3: Withdrew Bones x3']);
    });

    test('a count deposits only that many', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs', count: 1 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('finish: all 1 bank operations made');
        expect(r.result.inventoryDelta).toEqual({ Logs: -1 });
    });

    test('depositAllExcept deposits every other item, one item name at a time, and keeps the tools', async () => {
        const r = await simulate(bank, {
            params: { depositAllExcept: ['bronze axe'] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('finish: all 1 bank operations made');
        expect(r.sends).toEqual([OPEN, 'deposit Logs', 'deposit Shrimps', CLOSE]);
        expect(r.result.inventoryDelta).toEqual({ Logs: -2, Shrimps: -1 });
    });

    test('deposits run before depositAllExcept, which runs before withdrawals', async () => {
        const r = await simulate(bank, {
            params: {
                withdraw: [{ item: 'Copper ore', count: 1 }],
                depositAllExcept: ['Bronze axe', 'Shrimps'],
                deposit: [{ item: 'Shrimps' }],
            },
            timeline: carrying.series(1),
            react,
        });
        expect(r.sends).toEqual([OPEN, 'deposit Shrimps', 'deposit Logs', 'withdraw Copper ore', CLOSE]);
    });

    test('a bank left open before the run is closed at its start, then opened for the trip', async () => {
        const open = carrying.bank(BANK_CONTENTS);
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: open.series(1),
            react,
        });
        // The engine's run-start close reads "close bank" too.
        expect(r.sends).toEqual([CLOSE, OPEN, 'deposit Logs', CLOSE]);
        expect(r.result.stepRuns).toEqual({ 'close-leftover': 1, operate: 1, finish: 1 });
        expect(r.result.status).toBe('done');
    });

    test('far from the area it walks there first, then does the trip', async () => {
        const away = carrying.player({ at: { x: AREA.x, z: AREA.z + 40 } });
        const openedFrom: number[] = [];
        const driver: TimelineDriver = new TimelineDriver(away.series(1), {
            react: walking(react),
            respond: a => {
                if (a.reason === OPEN) openedFrom.push(driver.state().player?.worldZ ?? NaN);
                return undefined;
            },
        });
        const r = await simulate(bank, { params: { area: AREA, deposit: [{ item: 'Logs' }] }, driver });
        expect(r.sends[0]).toBe(`walk to (${AREA.x}, ${AREA.z})`);
        // The walk tolerance is radius - 1, capped at 3: running 2 tiles a tick, the walk is done 2 short.
        expect(openedFrom[0]).toBe(AREA.z + 2);
        expect(r.steps).toEqual(['walk-to-bank', 'operate', 'finish']);
        expect(r.result.status).toBe('done');
    });

    test('a failed walk to an explicit area reports the walk failure without the no-area prefix', async () => {
        const away = carrying.player({ at: { x: AREA.x, z: AREA.z + 40 } });
        const r = await simulate(bank, {
            params: { area: AREA, deposit: [{ item: 'Logs' }] },
            timeline: away.series(1),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.reason).toStartWith("walk-to-bank: can't walk to area");
        expect(r.result.reason).not.toContain('no reachable bank');
    });

    test('three failed walks in a row fail the run', async () => {
        const away = carrying.player({ at: { x: AREA.x, z: AREA.z + 40 } });
        const r = await simulate(bank, {
            params: { area: AREA, deposit: [{ item: 'Logs' }] },
            timeline: away.series(1),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `walk-to-bank: can't walk to area (No path to (${AREA.x}, ${AREA.z}) from (${AREA.x}, ${AREA.z + 40}): blocked)`,
        );
        expect(r.sends).toEqual([]);
    });
});

describe('bank: no area walks to the nearest bank', () => {
    const lumbridge = world()
        .player({ at: { x: 3222, z: 3222 } })
        .inv('Logs', 2);

    test('from Lumbridge without coins it walks to Varrock West (never Draynor), then does the trip', async () => {
        // No booth appears on arrival here, so the trip itself ends in no-bank-found; only the walk is asserted.
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.series(1),
            react: walking(react),
        });
        expect(r.sends[0]).toBe('walk to (3185, 3436)');
        expect(logged(r)[0]).toBe('no area given: walking to the nearest bank, Varrock West (3185,3436)');
        expect(r.steps[0]).toBe('walk-to-bank');
    });

    test('from Lumbridge with the toll in coins it picks Al Kharid, through the gate', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.inv('Coins', 10).series(1),
            react: walking(react),
        });
        expect(logged(r)[0]).toBe('no area given: walking to the nearest bank, Al Kharid (3269,3167)');
    });

    test('a bank already in view is used without walking', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.loc('Bank booth', 3225, 3222, { options: ['Bank'] }).series(1),
            react,
        });
        expect(r.sends).toEqual([OPEN, 'deposit Logs', CLOSE]);
        expect(r.steps).toEqual(['operate', 'finish']);
    });

    test('an unreachable nearest bank fails with a clear reason', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.series(1),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith("walk-to-bank: no reachable bank: can't walk to area");
    });

    test('a failed walk to the picked bank re-picks with the account as it is then: the toll coins gone', async () => {
        // Al Kharid is picked with the 10 coins the toll takes; the coins are gone by the time the walk fails, so the
        // next attempt picks Varrock West. The failures still count across picks: the run ends at the limit.
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.inv('Coins', 10).series(12, (w, i) => (i < 1 ? w : w.inv('Coins', 0))),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(logged(r).filter(m => m.startsWith('no area given'))).toEqual([
            'no area given: walking to the nearest bank, Al Kharid (3269,3167)',
            'no area given: walking to the nearest bank, Varrock West (3185,3436)',
            'no area given: walking to the nearest bank, Varrock West (3185,3436)',
        ]);
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toStartWith("walk-to-bank: no reachable bank: can't walk to area");
        expect(r.result.reason).toContain('(3185, 3436)');
    });

    test('with no area where no walk reaches a bank it is refused: the Barbarian Outpost course, left by its pipe', async () => {
        const course = lumbridge.player({ at: { x: 2552, z: 3562 } });
        expect((await refusal({ deposit: [{ item: 'Logs' }] }, course)).reason).toBe(
            'preflight: no bank a walk reaches from here (lib/banks.ts): pass an explicit `area` for the bank to walk to',
        );
    });

    test("started inside the essence mine with no wizard on record, it plans a bank by any wizard's way out", async () => {
        const mine = lumbridge.player({ at: { x: 2910, z: 4830 } }).quests({ runemysteries: 'done' });
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: mine.series(1),
            react: walking(react),
        });
        expect(r.result.reason).not.toContain('preflight');
        expect(logged(r)[0]).toStartWith('no area given: walking to the nearest bank');
    });

    test('off the surface with no area and no bank in view is refused', async () => {
        const underground = lumbridge.player({ at: { x: 3222, z: 9618 } });
        expect((await refusal({ deposit: [{ item: 'Logs' }] }, underground)).reason).toContain(
            'pass an explicit `area`',
        );
        const upstairs = lumbridge.player({ at: { x: 3222, z: 3222, level: 1 } });
        expect((await refusal({ deposit: [{ item: 'Logs' }] }, upstairs)).reason).toContain('pass an explicit `area`');
    });
});

describe('bank: failures', () => {
    test('no bank in view fails after three opens in a row, well inside the stuck window', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: world()
                .player({ at: { x: 3186, z: 3436 } })
                .inv('Logs', 1)
                .series(1),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'operate: cannot open bank (no-bank-found): No banker NPC or bank booth found nearby',
        );
        expect(logged(r)).toHaveLength(3);
        expect(r.sends).toEqual([]);
    });

    test('three opens that time out fail the run before the watchdog', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
        });
        expect(r.result.reason).toBe('operate: cannot open bank (timeout): Timeout waiting for bank interface to open');
        // Each timed-out open waits a while for a late open, then sends a close anyway.
        expect(r.sends).toEqual([OPEN, CLOSE_UNCONFIRMED, OPEN, CLOSE_UNCONFIRMED, OPEN, CLOSE_UNCONFIRMED]);
        const ticks = r.driver.state().tick;
        expect(ticks).toBe(3 * (OPEN_BANK_WAIT_TICKS + CLEANUP_CLOSE_WAIT_TICKS));
        expect(ticks * TICK_MS).toBeLessThan(bank.stuckAfterMs ?? 0);
    });

    test('an open that fails twice and then goes through does not fail the run', async () => {
        let opens = 0;
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react,
            respond: a =>
                a.reason === OPEN && ++opens <= 2 ? { success: false, message: 'not connected' } : undefined,
        });
        expect(r.result.status).toBe('done');
        expect(logged(r)).toEqual([
            'open bank failed (send-failed): not connected',
            'open bank failed (send-failed): not connected',
            'deposit Logs: Deposited Logs x2',
        ]);
    });

    test('a deposit that does not land fails the run, with the bank closed', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react: opensOnly,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'operate: deposit Logs failed (timeout): Timeout waiting for Logs to be deposited',
        );
        expect(r.sends).toEqual([OPEN, 'deposit Logs', CLOSE]);
    });

    test('a depositAllExcept item that does not land fails the run naming it', async () => {
        const r = await simulate(bank, {
            params: { depositAllExcept: ['Bronze axe'] },
            timeline: carrying.series(1),
            react: opensOnly,
        });
        expect(r.result.reason).toBe(
            'operate: deposit Logs failed (timeout): Timeout waiting for Logs to be deposited',
        );
        expect(r.sends).toEqual([OPEN, 'deposit Logs', CLOSE]);
    });

    test('asking for more than the bank holds fails before withdrawing, with the bank closed', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Bones', count: 9 }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('operate: bank holds 5 Bones, need 9');
        expect(r.sends).toEqual([OPEN, CLOSE]);
    });

    test('upTo withdraws what the bank holds when it holds fewer than count, and is done', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Bones', count: 9, upTo: true }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.inventoryDelta).toEqual({ Bones: 5 });
        expect(sentAs(r, 'withdraw Bones')).toMatchObject([{ amount: 5 }]);
    });

    test('upTo with none in the bank skips the entry and is done', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Cowhide', count: 4, upTo: true }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, CLOSE]);
        expect(logged(r)).toEqual(['withdraw Cowhide x4 (up to): skipped, the bank holds none']);
    });

    test('the done reason names upTo entries that came up short or were skipped', async () => {
        const r = await simulate(bank, {
            params: {
                withdraw: [
                    { item: 'Bones', count: 9, upTo: true },
                    { item: 'Cowhide', count: 4, upTo: true },
                    { item: 'Copper ore', count: 2, upTo: true },
                ],
            },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe(
            'finish: all 3 bank operations made; up to: Bones 5/9, Cowhide skipped (bank held none)',
        );
    });

    test('the done reason is unchanged when every upTo entry is filled', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Bones', count: 5, upTo: true }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.reason).toBe('finish: all 1 bank operations made');
    });

    test('upTo takes only what fits the free inventory slots and names the short entry', async () => {
        const nearlyFull = standing.inv('Logs', 25);
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Copper ore', count: 8, upTo: true }] },
            timeline: nearlyFull.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(sentAs(r, 'withdraw Copper ore')).toMatchObject([{ amount: 3 }]);
        expect(r.result.reason).toBe('finish: all 1 bank operations made; up to: Copper ore 3/8');
    });

    test('upTo with a full inventory skips the entry and says why', async () => {
        const full = standing.inv('Logs', 28);
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Copper ore', count: 2, upTo: true }] },
            timeline: full.series(1),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, CLOSE]);
        expect(r.result.reason).toBe(
            'finish: all 1 bank operations made; up to: Copper ore skipped (no free inventory slot)',
        );
    });

    describe('upTo and stackable items', () => {
        const FEATHER = 314;
        const feathers = bankReact([...BANK_CONTENTS, { name: 'Feather', count: 200, id: FEATHER }]);
        const upTo = async (w: World, count = 155) =>
            simulate(bank, {
                params: { withdraw: [{ item: 'Feather', count, upTo: true }] },
                timeline: w.series(1),
                react: feathers,
            });

        test('a stackable is not capped at the free slots', async () => {
            const r = await upTo(standing.inv('Logs', 1));
            expect(sentAs(r, 'withdraw Feather')).toMatchObject([{ amount: 155 }]);
            expect(r.result.reason).toBe('finish: all 1 bank operations made');
        });

        test('a stackable with no free slot and none held is skipped', async () => {
            const r = await upTo(standing.inv('Logs', 28));
            expect(r.sends).toEqual([OPEN, CLOSE]);
            expect(r.result.reason).toContain('Feather skipped (no free inventory slot)');
        });

        test('a held stack of one takes more with the inventory full', async () => {
            const r = await upTo(standing.inv('Logs', 27).inv('Feather', 1, { id: FEATHER }));
            expect(sentAs(r, 'withdraw Feather')).toMatchObject([{ amount: 155 }]);
        });

        test('a non-stackable is still capped at the free slots', async () => {
            const r = await simulate(bank, {
                params: { withdraw: [{ item: 'Copper ore', count: 8, upTo: true }] },
                timeline: standing.inv('Logs', 25).series(1),
                react,
            });
            expect(sentAs(r, 'withdraw Copper ore')).toMatchObject([{ amount: 3 }]);
        });
    });

    test('upTo with enough in the bank withdraws exactly count', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Copper ore', count: 3, upTo: true }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.inventoryDelta).toEqual({ 'Copper ore': 3 });
    });

    test('a withdrawal that does not land fails the run with what arrived', async () => {
        const r = await simulate(bank, {
            params: { withdraw: [{ item: 'Bones', count: 3 }] },
            timeline: carrying.series(1),
            react: opensOnly,
        });
        expect(r.result.reason).toBe(
            'operate: withdraw Bones x3 failed (timeout, got 0): Timeout waiting for Bones to be withdrawn',
        );
        expect(r.sends).toEqual([OPEN, 'withdraw Bones', CLOSE]);
    });

    test('a bank that will not close once the operations are made fails the run', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react: staysOpen,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            'operate: operations done but cannot close bank: Bank close timeout - interface.isOpen=true, bank.isOpen=true',
        );
        expect(r.driver.state().tick).toBeLessThan(40 + CLOSE_BANK_WAIT_TICKS);
    });
});

describe('bank: preflight', () => {
    test('refuses a task with nothing to do', async () => {
        const r = await refusal({});
        expect(r.status).toBe('failed');
        expect(r.reason).toBe('preflight: nothing to deposit or withdraw');
    });

    test('refuses an area reaching the Wilderness', async () => {
        const r = await refusal({ area: { x: 3185, z: 3515, radius: 10 }, deposit: [{ item: 'Logs' }] });
        expect(r.reason).toBe('preflight: area (3185,3515) radius 10 reaches the Wilderness');
    });

    test('refuses a deposit of an item not carried', async () => {
        const r = await refusal({ deposit: [{ item: 'Bones' }] });
        expect(r.reason).toBe('preflight: cannot deposit Bones: not in inventory');
    });

    test('refuses an item listed twice when one entry means all', async () => {
        const r = await refusal({ deposit: [{ item: 'Logs', count: 1 }, { item: 'logs' }] });
        expect(r.reason).toBe('preflight: cannot deposit logs: listed more than once and an entry has no count (all)');
    });

    test('refuses deposits that add up to more than carried', async () => {
        const r = await refusal({
            deposit: [
                { item: 'Logs', count: 2 },
                { item: 'Logs', count: 1 },
            ],
        });
        expect(r.reason).toBe('preflight: cannot deposit 3 Logs: only 2 in inventory');
    });
});

describe('bank: guards', () => {
    test('low HP mid-deposit closes the bank before eating, then the trip resumes where it stopped', async () => {
        // The second deposit send is the one that does not land before HP drops; the bank must be
        // closed by the time the guard eats, as the open bank hides the food.
        let deposits = 0;
        const ignoresSecondDeposit: TimelineOptions['react'] = (action: BotAction, state) => {
            if (action.type === 'bankDeposit' && ++deposits === 2) return undefined;
            return react(action, state);
        };
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }, { item: 'Bones' }] },
            timeline: carrying.inv('Bones', 1).series(40, (w, i) => w.player({ hp: i >= 3 && i < 5 ? 3 : 10 })),
            react: ignoresSecondDeposit,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([
            OPEN,
            'deposit Logs',
            'deposit Bones',
            CLOSE,
            'Eat Shrimps',
            OPEN,
            'deposit Bones',
            CLOSE,
        ]);
        expect(r.result.stepRuns).toEqual({ operate: 2, 'interrupt:low-hp': 1, finish: 1 });
        expect(r.result.inventoryDelta).toEqual({ Logs: -2, Bones: -1, Shrimps: -1 });
    });

    describe('an abort on the tick the transfer lands resumes without repeating it', () => {
        const RESUMED = [OPEN, CLOSE, 'Eat Shrimps', OPEN, CLOSE];

        test('a counted deposit is not deposited again', async () => {
            const r = await simulate(bank, {
                params: { deposit: [{ item: 'Logs', count: 2 }] },
                timeline: hurtOnLanding(carrying.inv('Logs', 5)),
                react,
            });
            expect(r.result.status).toBe('done');
            expect(r.sends).toEqual(RESUMED.toSpliced(1, 0, 'deposit Logs'));
            expect(r.result.inventoryDelta).toEqual({ Logs: -2, Shrimps: -1 });
            expect(logged(r)).toContain('deposit Logs: 2 already deposited before the step was cut off');
        });

        test('a deposit of all that landed is done, not item-not-found', async () => {
            const r = await simulate(bank, {
                params: { deposit: [{ item: 'Logs' }] },
                timeline: hurtOnLanding(carrying),
                react,
            });
            expect(r.result.status).toBe('done');
            expect(r.sends).toEqual(RESUMED.toSpliced(1, 0, 'deposit Logs'));
            expect(r.result.inventoryDelta).toEqual({ Logs: -2, Shrimps: -1 });
        });

        test('a counted withdrawal is not withdrawn again', async () => {
            const r = await simulate(bank, {
                params: { withdraw: [{ item: 'Bones', count: 3 }] },
                timeline: hurtOnLanding(carrying),
                react,
            });
            expect(r.result.status).toBe('done');
            expect(r.result.reason).toBe('finish: all 1 bank operations made');
            expect(r.sends).toEqual(RESUMED.toSpliced(1, 0, 'withdraw Bones'));
            expect(r.result.inventoryDelta).toEqual({ Bones: 3, Shrimps: -1 });
            expect(logged(r)).toContain('withdraw Bones x3: 3 already withdrawn before the step was cut off');
        });

        test('a resumed upTo withdrawal that part landed, with the bank now empty, is done without sending again', async () => {
            // The first withdraw moves all 5 Bones the bank holds (of 9 asked) on the tick HP drops.
            // A reopened bank lists its contents afresh, so it is made to list none once the withdraw went.
            let withdrew = false;
            const emptiesAfter: TimelineOptions['react'] = (action, state) => {
                if (action.type === 'bankWithdraw') withdrew = true;
                return withdrew && action.type === 'interactLoc'
                    ? bankReact([{ name: 'Copper ore', count: 20 }])(action, state)
                    : react(action, state);
            };
            const r = await simulate(bank, {
                params: { withdraw: [{ item: 'Bones', count: 9, upTo: true }] },
                timeline: hurtOnLanding(carrying),
                react: emptiesAfter,
            });
            expect(r.result.status).toBe('done');
            expect(sentAs(r, 'withdraw Bones')).toHaveLength(1);
            expect(r.result.inventoryDelta).toEqual({ Bones: 5, Shrimps: -1 });
            expect(logged(r)).toContain('withdraw Bones x9 (up to): 5 already withdrawn, the bank holds no more');
            expect(r.result.reason).toBe('finish: all 1 bank operations made; up to: Bones 5/9');
        });

        test('a withdrawal that partly landed asks only for the rest', async () => {
            let withdrawals = 0;
            const firstMovesOne: TimelineOptions['react'] = (action, state) =>
                action.type === 'bankWithdraw' && ++withdrawals === 1
                    ? react({ ...action, amount: 1 }, state)
                    : react(action, state);
            const r = await simulate(bank, {
                params: { withdraw: [{ item: 'Bones', count: 3 }] },
                timeline: hurtOnLanding(carrying),
                react: firstMovesOne,
            });
            expect(r.result.status).toBe('done');
            expect(sentAs(r, 'withdraw Bones')).toMatchObject([{ amount: 3 }, { amount: 2 }]);
            expect(r.result.inventoryDelta).toEqual({ Bones: 3, Shrimps: -1 });
        });
    });

    test('a level-up dialog mid-deposit is cleared and the trip carries on', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(20, (w, i) =>
                i >= 2 && i < 4 ? w.dialog({ options: ['Click here to continue'] }) : w,
            ),
            react,
        });
        expect(r.result.status).toBe('done');
        expect(r.sends).toEqual([OPEN, 'deposit Logs', 'continue dialog', CLOSE]);
        expect(r.result.stepRuns).toEqual({ operate: 1, 'interrupt:dialog': 1, finish: 1 });
    });

    test('the interface guard leaves the open bank alone', async () => {
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: carrying.series(1),
            react,
        });
        expect(r.result.stepRuns).toEqual({ operate: 1, finish: 1 });
        expect(r.sends).toEqual([OPEN, 'deposit Logs', CLOSE]);
    });
});
