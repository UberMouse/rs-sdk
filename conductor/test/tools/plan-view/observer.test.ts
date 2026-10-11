import { describe, expect, mock, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import type { BotSnapshot } from '../../../tools/plan-view/model';
import { type Connect, type Observed, Observers, snapshot } from '../../../tools/plan-view/observer';
import { world } from '../../world';

const state = (): BotWorldState =>
    world()
        .tick(42)
        .player({ at: { x: 3222, z: 3218 }, hp: 7, inCombat: true })
        .skill('Woodcutting', 15, 2500)
        .skill('Stat18', 1, 0)
        .inv('Logs', 3)
        .build();

/** A connection that reports `s`, `ageMs` old, and counts its disconnects. */
function fake(s: BotWorldState | null, ageMs = 100) {
    const disconnect = mock(async () => {});
    const sdk: Observed = {
        getState: () => s,
        getStateAge: () => ageMs,
        getConnectionState: () => 'connected',
        disconnect,
    };
    return { sdk, disconnect };
}

const settle = () => new Promise(r => setTimeout(r, 20));

describe('snapshot', () => {
    test('what the bot panel shows of a state: player, inventory, skills without unused slots', () => {
        const snap = snapshot(state(), 'live', null, 100);
        expect(snap).toMatchObject({ status: 'live', tick: 42, stateAgeMs: 100, slots: 28 });
        expect(snap.player).toMatchObject({ x: 3222, z: 3218, hp: 7, inCombat: true });
        // Logs don't stack: a slot each.
        expect(snap.inventory).toEqual(Array.from({ length: 3 }, () => ({ name: 'Logs', count: 1 })));
        expect(snap.skills.map(k => k.name)).toEqual(['Woodcutting']);
        expect(snap.skills[0]).toMatchObject({ baseLevel: 15, xp: 2500 });
    });

    test('no state: no player, nothing held', () => {
        expect(snapshot(null, 'offline', 'down', null)).toMatchObject({
            status: 'offline',
            message: 'down',
            player: null,
            inventory: [],
            skills: [],
        });
    });
});

describe('Observers', () => {
    test('a fresh state is live; one that stopped advancing is stale', async () => {
        for (const [age, status] of [
            [100, 'live'],
            [60_000, 'stale'],
        ] as const) {
            const { sdk } = fake(state(), age);
            const obs = new Observers(() => '/root', { connect: async () => sdk, lingerMs: 0 });
            const seen: BotSnapshot[] = [];
            const unwatch = obs.watch('b', s => seen.push(s));
            await settle();
            expect(seen.at(-1)?.status).toBe(status);
            unwatch();
            await obs.close();
        }
    });

    test('a bot with no bot.env anywhere is offline, saying so', async () => {
        const obs = new Observers(() => null, { lingerMs: 0 });
        const seen: BotSnapshot[] = [];
        obs.watch('nobody', s => seen.push(s));
        await settle();
        expect(seen.at(-1)).toMatchObject({ status: 'offline', message: 'no bots/nobody/bot.env in any checkout' });
        await obs.close();
    });

    test('stopped while connecting: the connection that arrives late is closed', async () => {
        const { sdk, disconnect } = fake(state());
        const pending: { arrive?: (o: Observed) => void } = {};
        const connect: Connect = () =>
            new Promise(r => {
                pending.arrive = r;
            });
        const obs = new Observers(() => '/root', { connect, lingerMs: 0 });
        const unwatch = obs.watch('b', () => {});
        unwatch(); // the last viewer leaves before the connect resolves; the linger stops it
        await settle();
        pending.arrive?.(sdk);
        await settle();
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    test('a viewer arriving while the last connection is still closing gets a fresh one', async () => {
        const hung: Observed = { ...fake(state()).sdk, disconnect: () => new Promise<void>(() => {}) };
        const connect = mock(async () => hung);
        const obs = new Observers(() => '/root', { connect, lingerMs: 0 });
        obs.watch('b', () => {})();
        await settle(); // stopped; its disconnect never returns
        const seen: BotSnapshot[] = [];
        obs.watch('b', s => seen.push(s));
        await settle();
        expect(connect).toHaveBeenCalledTimes(2);
        expect(seen.at(-1)?.status).toBe('live');
    });

    test('viewers share one connection, closed after the last leaves', async () => {
        const { sdk, disconnect } = fake(state());
        const connect = mock(async () => sdk);
        const obs = new Observers(() => '/root', { connect, lingerMs: 0 });
        const a = obs.watch('b', () => {});
        const b = obs.watch('b', () => {});
        await settle();
        expect(connect).toHaveBeenCalledTimes(1);
        a();
        await settle();
        expect(disconnect).not.toHaveBeenCalled();
        b();
        await settle();
        expect(disconnect).toHaveBeenCalledTimes(1);
    });
});
