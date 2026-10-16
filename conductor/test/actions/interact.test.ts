import { describe, expect, test } from 'bun:test';
import type { NearbyLoc, NearbyNpc } from '../../../sdk/types';
import { interactItem, interactLoc, interactNpc, pickOption } from '../../actions/interact';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const base = world().loc('Bank booth', 3208, 3220, { options: ['Use', 'Use-quickly'] });
const booth = base.build().nearbyLocs[0]!;

async function run(loc: NearbyLoc, option: number | RegExp, opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(base.series(1), opts);
    const r = await interpret(interactLoc(loc, option), { driver });
    if (r.kind !== 'returned') throw new Error(`interactLoc did not return: ${JSON.stringify(r)}`);
    return { result: r.value, sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : [])) };
}

describe('interactLoc', () => {
    test('a pattern picks the option index from the texts the loc publishes', async () => {
        const { result, sends } = await run(booth, /quickly/i);
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([
            {
                type: 'interactLoc',
                x: 3208,
                z: 3220,
                locId: booth.id,
                optionIndex: 2,
                reason: 'Use-quickly Bank booth',
            },
        ]);
    });

    test('an index is sent as given, published or not', async () => {
        expect((await run(booth, 1)).sends[0]).toMatchObject({ optionIndex: 1, reason: 'Use Bank booth' });
        expect((await run(booth, 4)).sends[0]).toMatchObject({ optionIndex: 4, reason: 'op 4 Bank booth' });
    });

    test('a pattern no option matches sends nothing', async () => {
        const { result, sends } = await run(booth, /^chop/i);
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'no /^chop/i option on Bank booth' });
        expect(sends).toEqual([]);
    });

    test('a refused send is send-failed with its message', async () => {
        const { result } = await run(booth, 1, { respond: () => ({ success: false, message: 'not connected' }) });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

const town = world().npc('Aubury', 3253, 3401, { options: ['Talk-to', 'Trade', 'Teleport'], index: 12 });
const aubury = town.build().nearbyNpcs[0]!;

async function runNpc(npc: NearbyNpc, option: number | RegExp, opts: TimelineOptions = {}) {
    const driver = new TimelineDriver(town.series(1), opts);
    const r = await interpret(interactNpc(npc, option), { driver });
    if (r.kind !== 'returned') throw new Error(`interactNpc did not return: ${JSON.stringify(r)}`);
    return { result: r.value, sends: driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : [])) };
}

describe('interactNpc', () => {
    test('a pattern picks the option index from the texts the NPC publishes', async () => {
        const { result, sends } = await runNpc(aubury, /teleport/i);
        expect(result).toEqual({ ok: true });
        expect(sends).toEqual([{ type: 'interactNpc', npcIndex: 12, optionIndex: 3, reason: 'Teleport Aubury' }]);
    });

    test('an index is sent as given, published or not', async () => {
        expect((await runNpc(aubury, 2)).sends[0]).toMatchObject({ optionIndex: 2, reason: 'Trade Aubury' });
        expect((await runNpc(aubury, 5)).sends[0]).toMatchObject({ optionIndex: 5, reason: 'op 5 Aubury' });
    });

    test('a pattern no option matches sends nothing', async () => {
        const { result, sends } = await runNpc(aubury, /^attack/i);
        expect(result).toEqual({ ok: false, reason: 'no-option', message: 'no /^attack/i option on Aubury' });
        expect(sends).toEqual([]);
    });

    test('a refused send is send-failed with its message', async () => {
        const { result } = await runNpc(aubury, 1, { respond: () => ({ success: false, message: 'not connected' }) });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

const ring = { slot: 3, id: 1, name: 'Ring', count: 1, optionsWithIndex: [{ text: 'Wear', opIndex: 2 }] };

async function sendItem(item: typeof ring, option: number | RegExp) {
    const driver = new TimelineDriver(world().series(1));
    await interpret(interactItem(item, option), { driver });
    return driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
}

describe('interactItem and pickOption', () => {
    test('a pattern or an index sends useInventoryItem on the slot', async () => {
        expect(await sendItem(ring, /^wear/i)).toEqual([
            { type: 'useInventoryItem', slot: 3, optionIndex: 2, reason: 'Wear Ring' },
        ]);
        expect(await sendItem(ring, 7)).toEqual([
            { type: 'useInventoryItem', slot: 3, optionIndex: 7, reason: 'op 7 Ring' },
        ]);
    });

    test('an option the item lacks names the pattern and sends nothing', () => {
        expect(pickOption(ring.optionsWithIndex, 'Ring', /^eat$/i)).toEqual({
            ok: false,
            reason: 'no-option',
            message: 'no /^eat$/i option on Ring',
        });
    });
});
