import { describe, expect, test } from 'bun:test';
import type { BotAction } from '../../../sdk/types';
import { CLOSE_BANK_WAIT_TICKS, OPEN_BANK_WAIT_TICKS } from '../../actions/bank';
import { CLEANUP_CLOSE_WAIT_TICKS } from '../../actions/modal';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { TICK_MS } from '../../lib/util';
import { nearestBank } from '../../lib/banks';
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
    r.events.flatMap(e => (e.type === 'log' && !String(e.msg).startsWith('guard ') ? [e.msg] : []));
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

    test('from Lumbridge it walks to Varrock East (never Draynor or Al Kharid), then does the trip', async () => {
        // No booth appears on arrival here, so the trip itself ends in no-bank-found; only the walk is asserted.
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.series(1),
            react: walking(react),
        });
        expect(r.sends[0]).toBe('walk to (3254, 3420)');
        expect(logged(r)[0]).toBe('no area given: walking to the nearest bank, Varrock East (3254,3420)');
        expect(r.steps[0]).toBe('walk-to-bank');
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

    test('the bank picked at the first walk is kept when the bot ends up nearer another', async () => {
        // Lumbridge (nearest: Varrock East) for the first ticks, then beside Falador East while the walk keeps failing.
        const r = await simulate(bank, {
            params: { deposit: [{ item: 'Logs' }] },
            timeline: lumbridge.series(12, (w, i) => (i < 3 ? w : w.player({ at: { x: 3014, z: 3356 } }))),
            pathfinder: fakePaths(() => ({ success: false, waypoints: [], error: 'blocked' })),
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('(3254, 3420)');
        expect(logged(r).filter(m => m.startsWith('no area given'))).toHaveLength(1);
    });

    test('off the surface with no area and no bank in view is refused', async () => {
        const underground = lumbridge.player({ at: { x: 3222, z: 9618 } });
        expect((await refusal({ deposit: [{ item: 'Logs' }] }, underground)).reason).toContain(
            'pass an explicit `area`',
        );
        const upstairs = lumbridge.player({ at: { x: 3222, z: 3222, level: 1 } });
        expect((await refusal({ deposit: [{ item: 'Logs' }] }, upstairs)).reason).toContain('pass an explicit `area`');
    });

    test('the table skips Draynor and Al Kharid, and picks by distance', async () => {
        expect(nearestBank({ x: 3092, z: 3243 })?.name).not.toBe('Draynor');
        expect(nearestBank({ x: 3269, z: 3167 })?.name).not.toBe('Al Kharid');
        expect(nearestBank({ x: 3190, z: 3440 })?.name).toBe('Varrock West');
        expect(nearestBank({ x: 2950, z: 3370 })?.name).toBe('Falador West');
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
