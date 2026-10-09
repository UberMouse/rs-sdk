import { describe, expect, test } from 'bun:test';
import type { BotSDK } from '../../../sdk/index';
import type { ActionResult, BotWorldState, ConnectionState } from '../../../sdk/types';
import { LiveDriver } from '../../core/drivers/live';
import { TickStall } from '../../core/interpret';
import type { Sinks } from '../../lib/task';
import { worldState } from './states';

const OK: ActionResult = { success: true, message: 'ok' };

/** The slice of BotSDK the driver uses, with state and connection changes pushed by the test. */
class FakeSdk {
    state: BotWorldState | null = worldState(0);
    connection: ConnectionState = 'connected';
    readonly calls: unknown[][] = [];
    private readonly stateListeners = new Set<(s: BotWorldState) => void>();
    private readonly connectionListeners = new Set<(c: ConnectionState) => void>();

    getState() {
        return this.state;
    }
    getConnectionState() {
        return this.connection;
    }
    onStateUpdate(l: (s: BotWorldState) => void) {
        this.stateListeners.add(l);
        return () => this.stateListeners.delete(l);
    }
    onConnectionStateChange(l: (c: ConnectionState) => void) {
        this.connectionListeners.add(l);
        return () => this.connectionListeners.delete(l);
    }
    publish(s: BotWorldState) {
        this.state = s;
        for (const l of this.stateListeners) l(s);
    }
    disconnect() {
        this.connection = 'disconnected';
        for (const l of this.connectionListeners) l('disconnected');
    }
    async sendWalk(...args: unknown[]) {
        this.calls.push(['sendWalk', ...args]);
        return OK;
    }
    async scanNearbyLocs(...args: unknown[]) {
        this.calls.push(['scanNearbyLocs', ...args]);
        return [];
    }
}

const sinks = (): Sinks & { events: Record<string, unknown>[] } => {
    const events: Record<string, unknown>[] = [];
    return { events, event: e => events.push(e), print: () => {}, screenshot: async () => null };
};

function driverOn(fake: FakeSdk, stallMs = 1000) {
    // Only the methods the tests reach are faked.
    return new LiveDriver(fake as unknown as BotSDK, sinks(), stallMs);
}

describe('LiveDriver', () => {
    test('overlapping nextTick callers all get the next state whose tick advanced', async () => {
        const fake = new FakeSdk();
        const d = driverOn(fake);
        const a = d.nextTick();
        const b = d.nextTick();
        expect(b).toBe(a);
        fake.publish(worldState(0, { hp: 9 })); // same tick: not a new tick
        fake.publish(worldState(1));
        expect((await a).tick).toBe(1);
        expect((await b).tick).toBe(1);
        const c = d.nextTick();
        expect(c).not.toBe(a);
        fake.publish(worldState(2));
        expect((await c).tick).toBe(2);
        d.close();
    });

    test('a disconnect rejects the pending caller and every later one', async () => {
        const fake = new FakeSdk();
        const d = driverOn(fake);
        const pending = d.nextTick();
        fake.disconnect();
        await expect(pending).rejects.toThrow('the SDK disconnected');
        await expect(d.nextTick()).rejects.toThrow('the SDK disconnected');
        d.close();
    });

    test('no tick within the stall limit rejects with TickStall, at once for later callers', async () => {
        const fake = new FakeSdk();
        const d = driverOn(fake, 20);
        await expect(d.nextTick()).rejects.toBeInstanceOf(TickStall);
        await expect(d.nextTick()).rejects.toThrow('client stopped publishing ticks for 0.02s');
        // A new tick clears the stall.
        fake.publish(worldState(1));
        const next = d.nextTick();
        fake.publish(worldState(2));
        expect((await next).tick).toBe(2);
        d.close();
    });

    test('close rejects a pending caller', async () => {
        const d = driverOn(new FakeSdk());
        const pending = d.nextTick();
        d.close();
        await expect(pending).rejects.toThrow('driver closed');
    });

    test('state() throws when the client has published none', () => {
        const fake = new FakeSdk();
        fake.state = null;
        const d = driverOn(fake);
        expect(() => d.state()).toThrow('no world state from client');
        d.close();
    });

    test('send maps actions to the public send methods', async () => {
        const fake = new FakeSdk();
        const d = driverOn(fake);
        expect(await d.send({ type: 'walkTo', x: 1, z: 2, reason: 'test' })).toEqual(OK);
        expect(await d.send({ type: 'scanNearbyLocs', radius: 5, reason: 'test' })).toMatchObject({
            success: true,
            data: [],
        });
        expect(await d.send({ type: 'none', reason: 'noop' })).toMatchObject({ success: true });
        expect(fake.calls).toEqual([
            ['sendWalk', 1, 2, undefined],
            ['scanNearbyLocs', 5],
        ]);
        d.close();
    });
});
