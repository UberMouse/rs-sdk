import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

function harness() {
    const sdk = new BotSDK({ botUsername: 'test', password: 'test', autoLaunchBrowser: false });
    const internal = sdk as any;
    internal.state = {
        tick: 1, player: { animId: 625 }, inventory: [],
        skills: [{ name: 'Mining', experience: 0 }],
        nearbyLocs: [{ id: 2090, name: 'Rocks copper ore', x: 3282, z: 3367, distance: 1, reachable: true, optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] }],
        gameMessages: [], dialog: { isOpen: false }, interface: { isOpen: false },
    };
    const bot = new BotActions(sdk);
    sdk.sendInteractLoc = async () => ({ success: true, message: 'dispatched' });
    return { sdk, bot, internal };
}

describe('mineRock completion evidence', () => {
    test('does not complete on animation, XP alone, or an unrelated ore', async () => {
        const h = harness();
        let settled = false;
        const work = h.bot.mineRock(/copper ore/i, { timeout: 1000 }).then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 0));
        const publish = () => { for (const listener of h.internal.stateListeners) listener(h.internal.state); };
        publish();
        await Promise.resolve();
        expect(settled).toBeFalse();
        h.internal.state.skills[0].experience = 437;
        h.internal.state.inventory = [{ id: 438, name: 'Tin ore', count: 1, slot: 0 }];
        publish();
        await Promise.resolve();
        expect(settled).toBeFalse();
        h.internal.state.inventory.push({ id: 436, name: 'Copper ore', count: 1, slot: 1 });
        publish();
        const result = await work;
        expect(result).toMatchObject({ success: true, oresMined: 1, xpGained: 437, ore: { name: 'Copper ore' } });
        expect(h.internal.stateListeners.size).toBe(0);
    });

    test('times out when a mining animation never produces ore', async () => {
        const result = await harness().bot.mineRock(/copper ore/i, { timeout: 10 });
        expect(result).toMatchObject({ success: false, reason: 'timeout', oresMined: 0 });
    });

    test('gives a clear failure for an inventory-only selector', async () => {
        expect(await harness().bot.mineRock(/^copper ore$/i)).toMatchObject({ success: false, reason: 'loc_not_found' });
    });

    test('refuses a full inventory before clicking the rock', async () => {
        const h = harness();
        h.internal.state.inventory = Array.from({ length: 28 }, (_, slot) => ({ id: 436, name: 'Copper ore', count: 1, slot }));
        h.sdk.sendInteractLoc = async () => { throw new Error('must not click'); };
        expect(await h.bot.mineRock(/copper ore/i)).toMatchObject({ success: false, reason: 'inventory_full' });
    });

    test('observes a fast ore completion even when no animation is published', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.player.animId = -1;
            h.internal.state.skills[0].experience = 437;
            h.internal.state.inventory = [{ id: 436, name: 'Copper ore', count: 1, slot: 0 }];
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i)).toMatchObject({ success: true, oresMined: 1, xpGained: 437 });
    });
});
