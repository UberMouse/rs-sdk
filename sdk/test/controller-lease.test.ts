// The gateway's controller lease refuses a second control connection with
// sdk_error code 'controller_busy'. A first connect must fail at once, without
// auto-reconnecting into the lease; a reconnect must keep retrying, because the
// refusal can come from our own previous session the gateway hasn't seen close.

import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { BotSDK } from '../index';

type Socket = { send(data: string): void; close(): void };

let server: Server | null = null;

/** A fake gateway that answers the n-th sdk_connect (1-based) with `answer(n, msg, ws)`. */
function fakeGateway(answer: (n: number, msg: Record<string, unknown>, ws: Socket) => void): () => number {
    let connects = 0;
    server = Bun.serve({
        port: 0,
        fetch(req, srv) {
            if (srv.upgrade(req)) return;
            return new Response('not a websocket', { status: 400 });
        },
        websocket: {
            message(ws, raw) {
                const msg = JSON.parse(String(raw));
                if (msg.type === 'sdk_connect') answer(++connects, msg, ws);
            },
        },
    });
    return () => connects;
}

const busy = JSON.stringify({ type: 'sdk_error', code: 'controller_busy', error: 'Refused: testbot is already controlled by sdk-other' });
const ok = JSON.stringify({ type: 'sdk_connected', success: true });

function makeSDK(takeover = false, leaseRetryWindowMs?: number): BotSDK {
    return new BotSDK({
        botUsername: 'testbot',
        password: 'x',
        gatewayUrl: `ws://localhost:${server!.port}`,
        connectTimeout: 2000,
        readyTimeout: 0,
        autoReconnect: true,
        reconnectBaseDelay: 20,
        reconnectMaxDelay: 50,
        autoLaunchBrowser: false,
        takeover,
        leaseRetryWindowMs,
    });
}

async function until(pred: () => boolean, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!pred()) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await Bun.sleep(10);
    }
}

afterEach(() => {
    server?.stop(true);
    server = null;
});

describe('controller lease', () => {
    test('a refused first connect rejects and does not reconnect into the lease', async () => {
        const connects = fakeGateway((_n, _msg, ws) => ws.send(busy));
        const sdk = makeSDK();
        await expect(sdk.connect()).rejects.toThrow(/already controlled/);
        await Bun.sleep(300); // several reconnect delays
        expect(connects()).toBe(1);
        expect(sdk.getConnectionState()).toBe('disconnected');
    });

    test('a reconnect refused by its own stale session keeps retrying until it gets in', async () => {
        let first: Socket | undefined;
        const connects = fakeGateway((n, _msg, ws) => {
            if (n === 1) {
                first = ws;
                ws.send(ok);
            } else if (n <= 3) {
                ws.send(busy); // the old session still holds the lease
            } else {
                ws.send(ok);
            }
        });
        const sdk = makeSDK();
        try {
            await sdk.connect();
            first!.close(); // the connection drops; the SDK reconnects
            await until(() => connects() >= 4 && sdk.getConnectionState() === 'connected');
            expect(sdk.isConnected()).toBe(true);
        } finally {
            await sdk.disconnect();
        }
    });

    test('a reconnect gives up once the refusals outlast the retry window', async () => {
        let first: Socket | undefined;
        const connects = fakeGateway((n, _msg, ws) => {
            if (n === 1) {
                first = ws;
                ws.send(ok);
            } else {
                ws.send(busy); // someone else really holds the bot now
            }
        });
        const sdk = makeSDK(false, 200);
        try {
            await sdk.connect();
            first!.close();
            await until(() => sdk.getConnectionState() === 'disconnected' && connects() > 2);
            const settled = connects();
            await Bun.sleep(300); // several reconnect delays
            expect(connects()).toBe(settled); // stopped retrying
        } finally {
            await sdk.disconnect();
        }
    });

    test('a reconnect does not resend takeover', async () => {
        let first: Socket | undefined;
        const seen: unknown[] = [];
        fakeGateway((n, msg, ws) => {
            seen.push(msg.takeover);
            if (n === 1) first = ws;
            ws.send(ok);
        });
        const sdk = makeSDK(true);
        try {
            await sdk.connect();
            first!.close();
            await until(() => seen.length >= 2 && sdk.getConnectionState() === 'connected');
            expect(seen.slice(0, 2)).toEqual([true, false]);
        } finally {
            await sdk.disconnect();
        }
    });

    test('sends takeover only when asked', async () => {
        const seen: unknown[] = [];
        fakeGateway((_n, msg, ws) => {
            seen.push(msg.takeover);
            ws.send(ok);
        });
        const plain = makeSDK();
        await plain.connect();
        await plain.disconnect();
        const taking = makeSDK(true);
        await taking.connect();
        await taking.disconnect();
        expect(seen).toEqual([false, true]);
    });
});
