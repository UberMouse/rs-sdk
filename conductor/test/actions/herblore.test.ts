import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { brewPotion, cleanHerb, HERB_WAIT_TICKS } from '../../actions/herblore';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const GRIMY = 205;
const CLEAN = 255;
const VIAL = 227;
const UNF = 97;
const CHOCOLATE = 1975;
const ENERGY = 3010;
const IDENTIFY = [{ text: 'Identify', opIndex: 1 }];
const kit = world().skill('Herblore', 30, 0).inv('Grimy harralander', 1, { id: GRIMY, options: IDENTIFY });
const herb = kit.build().inventory[0]!;

const brewing = world()
    .skill('Herblore', 30, 0)
    .inv('Unfinished potion', 1, { id: UNF })
    .inv('Chocolate dust', 1, { id: CHOCOLATE });
const unf = brewing.build().inventory[0]!;
const dust = brewing.build().inventory[1]!;

async function runClean(states: BotWorldState[], opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(cleanHerb(driver, herb), { driver });
    if (r.kind !== 'returned') throw new Error(`cleanHerb did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

async function runBrew(states: BotWorldState[], opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(brewPotion(driver, dust, unf, ENERGY), { driver });
    if (r.kind !== 'returned') throw new Error(`brewPotion did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('cleanHerb', () => {
    test('sends the Identify option on the herb and succeeds once it is gone', async () => {
        const { result, driver } = await runClean(
            kit.series(10, (w, i) =>
                i >= 2
                    ? w.inv('Grimy harralander', 0).inv('Harralander', 1, { id: CLEAN }).skill('Herblore', 30, 157)
                    : w,
            ),
        );
        expect(result).toEqual({ ok: true, xpGained: 157 });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: { type: 'useInventoryItem', slot: 0, optionIndex: 1, reason: 'Identify Grimy harralander' },
            },
        ]);
    });

    test('another herb of the same kind still held is not a clean: the count must fall', async () => {
        const two = world().skill('Herblore', 30, 0).inv('Grimy harralander', 2, { id: GRIMY, options: IDENTIFY });
        const { result } = await runClean(two.series(HERB_WAIT_TICKS + 2));
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('a herb with no Clean or Identify option is refused without a send', async () => {
        const bare = world().inv('Grimy harralander', 1, { id: GRIMY, options: [] }).build().inventory[0]!;
        const driver = new TimelineDriver(kit.series(2));
        const r = await interpret(cleanHerb(driver, bare), { driver });
        expect(r).toEqual({
            kind: 'returned',
            value: { ok: false, reason: 'no-option', message: 'No Clean option on Grimy harralander' },
        });
        expect(driver.commands).toEqual([]);
    });

    test("the game's level refusal ends the wait at once", async () => {
        const { result, driver } = await runClean(
            kit.series(20, (w, i) => (i >= 2 ? w.message('You cannot identify this herb.') : w)),
        );
        expect(result).toEqual({ ok: false, reason: 'level-too-low', message: 'You cannot identify this herb.' });
        expect(driver.state().tick).toBe(2);
    });

    test('a message from before the send is not an answer', async () => {
        const stale = kit.message('You cannot identify this herb.');
        const { result } = await runClean(stale.series(HERB_WAIT_TICKS + 2));
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('the members-world refusal is its own reason', async () => {
        const { result } = await runClean(
            kit.series(10, (w, i) =>
                i >= 2 ? w.message("You need to be on a members' world to gain experience in Herblore.") : w,
            ),
        );
        expect(result.ok === false && result.reason).toBe('members');
    });

    test('nothing within the wait is a timeout after its tick budget', async () => {
        const { result, driver } = await runClean(kit.series(1));
        expect(result.ok === false && result.reason).toBe('timeout');
        expect(driver.state().tick).toBe(HERB_WAIT_TICKS);
    });

    test('a refused send is send-failed with nothing waited for', async () => {
        const { result, driver } = await runClean(kit.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });
});

const made = (w: ReturnType<typeof world>) =>
    w
        .inv('Unfinished potion', 0)
        .inv('Chocolate dust', 0)
        .inv('Energy potion(3)', 1, { id: ENERGY })
        .skill('Herblore', 30, 1687);

describe('brewPotion', () => {
    test('uses the item on the target and succeeds once the potion arrives', async () => {
        const { result, driver } = await runBrew(brewing.series(10, (w, i) => (i >= 2 ? made(w) : w)));
        expect(result).toEqual({ ok: true, xpGained: 1687 });
        expect(driver.commands).toEqual([
            {
                type: 'send',
                action: {
                    type: 'useItemOnItem',
                    sourceSlot: 1,
                    targetSlot: 0,
                    reason: 'use Chocolate dust on Unfinished potion',
                },
            },
        ]);
    });

    test('an unfinished potion pays no xp but is a success', async () => {
        const herbs = world()
            .skill('Herblore', 30, 0)
            .inv('Harralander', 1, { id: CLEAN })
            .inv('Vial of water', 1, { id: VIAL });
        const [h, v] = herbs.build().inventory as [BotWorldState['inventory'][0], BotWorldState['inventory'][0]];
        const driver = new TimelineDriver(
            herbs.series(10, (w, i) =>
                i >= 2 ? w.inv('Harralander', 0).inv('Vial of water', 0).inv('Unfinished potion', 1, { id: UNF }) : w,
            ),
        );
        const r = await interpret(brewPotion(driver, h, v, UNF), { driver });
        expect(r).toEqual({ kind: 'returned', value: { ok: true, xpGained: 0 } });
    });

    test('the level message box (a dialog page) is level-too-low', async () => {
        const { result } = await runBrew(
            brewing.series(10, (w, i) =>
                i >= 2 ? w.recentDialog(['You need a Herblore level of at least 26 to make this potion.']) : w,
            ),
        );
        expect(result).toEqual({
            ok: false,
            reason: 'level-too-low',
            message: 'You need a Herblore level of at least 26 to make this potion.',
        });
    });

    test('"Nothing interesting happens." is nothing-happened', async () => {
        const { result } = await runBrew(
            brewing.series(10, (w, i) => (i >= 2 ? w.message('Nothing interesting happens.') : w)),
        );
        expect(result.ok === false && result.reason).toBe('nothing-happened');
    });

    test('the members-world refusal is its own reason', async () => {
        const { result } = await runBrew(
            brewing.series(10, (w, i) =>
                i >= 2 ? w.message("You need to be on a members' world to gain experience in Herblore.") : w,
            ),
        );
        expect(result.ok === false && result.reason).toBe('members');
    });

    test('a product already held does not count: one more must arrive', async () => {
        const holding = brewing.inv('Energy potion(3)', 1, { id: ENERGY });
        const { result } = await runBrew(holding.series(HERB_WAIT_TICKS + 2));
        expect(result.ok === false && result.reason).toBe('timeout');
    });

    test('a refused send is send-failed', async () => {
        const { result } = await runBrew(brewing.series(1), { respond: () => ({ success: false, message: 'gone' }) });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'gone' });
    });
});
