// The gateway's controller lease refuses a second control connection with
// sdk_error code 'controller_busy'. A first connect must fail at once, without
// auto-reconnecting into the lease; a reconnect must keep retrying, because the
// refusal can come from our own previous session the gateway hasn't seen close.

import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { BotSDK } from '../index';

type Socket = { send(data: string): void; close(): void };

let server: Server | null = null;

/**
 * A fake gateway that answers the n-th sdk_connect (1-based) with `answer(n, msg, ws)`. Its
 * /status/<bot> (the SDK's auto-launch check) answers the first request after `statusDelayMs`.
 */
function fakeGateway(
    answer: (n: number, msg: Record<string, unknown>, ws: Socket) => void,
    { statusDelayMs = 0, onClose }: { statusDelayMs?: number; onClose?: (ws: Socket) => void } = {},
): () => number {
    let connects = 0;
    let statusRequests = 0;
    server = Bun.serve({
        port: 0,
        async fetch(req, srv) {
            if (new URL(req.url).pathname.startsWith('/status/')) {
                if (++statusRequests === 1) await Bun.sleep(statusDelayMs);
                return Response.json({ status: 'active', inGame: true, stateAge: 0, controllers: [], observers: [], player: null });
            }
            if (srv.upgrade(req)) return;
            return new Response('not a websocket', { status: 400 });
        },
        websocket: {
            message(ws, raw) {
                const msg = JSON.parse(String(raw));
                if (msg.type === 'sdk_connect') answer(++connects, msg, ws);
            },
            close(ws) {
                onClose?.(ws);
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

describe('connection ownership', () => {
    test('an attempt superseded by disconnect() and a newer connect() never opens its socket', async () => {
        // A lease like the real gateway's: the first authenticated socket holds it until it closes.
        let holder: Socket | null = null;
        const sockets = new Set<Socket>();
        fakeGateway(
            (_n, _msg, ws) => {
                sockets.add(ws);
                if (holder && holder !== ws) {
                    ws.send(busy);
                    ws.close();
                    return;
                }
                holder = ws;
                ws.send(ok);
            },
            {
                statusDelayMs: 300, // holds the first attempt in its pre-socket await
                onClose: ws => {
                    sockets.delete(ws);
                    if (holder === ws) holder = null;
                },
            },
        );
        const sdk = new BotSDK({
            botUsername: 'testbot',
            password: 'x',
            gatewayUrl: `ws://localhost:${server!.port}`,
            readyTimeout: 0,
            autoLaunchBrowser: 'auto',
            autoReconnect: true,
            reconnectBaseDelay: 20,
        });
        const first = sdk.connect();
        await Bun.sleep(30);
        await sdk.disconnect();
        await expect(first).rejects.toThrow(/Disconnected while connecting/);
        await sdk.connect();
        await Bun.sleep(500); // the first attempt's status check comes back
        expect(sdk.isAuthenticated()).toBe(true);
        expect(sockets.size).toBe(1);
        await sdk.disconnect();
        await until(() => holder === null && sockets.size === 0);
    });

    test('a connect() joining an attempt resolves only once the gateway accepts it', async () => {
        fakeGateway((_n, _msg, ws) => setTimeout(() => ws.send(ok), 200));
        const sdk = makeSDK();
        try {
            const first = sdk.connect();
            await Bun.sleep(50); // the socket is open, the handshake is not done
            await sdk.connect();
            expect(sdk.isAuthenticated()).toBe(true);
            await first;
        } finally {
            await sdk.disconnect();
        }
    });

    test('disconnect() settles a connect() still waiting on the handshake', async () => {
        fakeGateway(() => {}); // never answers
        const sdk = makeSDK();
        const pending = sdk.connect();
        await Bun.sleep(50);
        const started = Date.now();
        await sdk.disconnect();
        await expect(pending).rejects.toThrow(/Disconnected while connecting/);
        expect(Date.now() - started).toBeLessThan(1000); // not the 2s handshake deadline
    });

    test('a close after the handshake but before state rejects connect() instead of resolving later', async () => {
        fakeGateway((_n, _msg, ws) => {
            ws.send(ok);
            setTimeout(() => ws.close(), 50); // no state ever arrives
        });
        const sdk = new BotSDK({
            botUsername: 'testbot',
            password: 'x',
            gatewayUrl: `ws://localhost:${server!.port}`,
            readyTimeout: 2000,
            autoReconnect: false,
            autoLaunchBrowser: false,
        });
        const started = Date.now();
        await expect(sdk.connect()).rejects.toThrow(/before game state was ready/);
        expect(Date.now() - started).toBeLessThan(1000); // not readyTimeout
        expect(sdk.getConnectionState()).toBe('disconnected');
    });

    test('no reconnect timer survives disconnect()', async () => {
        let first: Socket | undefined;
        const connects = fakeGateway((n, _msg, ws) => {
            if (n === 1) first = ws;
            if (n === 2) return ws.close(); // the manual attempt fails before its handshake
            ws.send(ok);
        });
        const sdk = new BotSDK({
            botUsername: 'testbot',
            password: 'x',
            gatewayUrl: `ws://localhost:${server!.port}`,
            readyTimeout: 0,
            autoReconnect: true,
            reconnectBaseDelay: 300,
            autoLaunchBrowser: false,
        });
        await sdk.connect();
        first!.close(); // a reconnect is scheduled
        await until(() => sdk.getConnectionState() === 'reconnecting');
        await sdk.connect().catch(() => {}); // a manual attempt during the backoff schedules another
        await sdk.disconnect();
        const settled = connects();
        await Bun.sleep(800); // past both backoffs
        expect(connects()).toBe(settled);
        expect(sdk.getConnectionState()).toBe('disconnected');
    });

    test('the reconnect loop keeps going when a handshake times out with no close event', async () => {
        // A peer that accepts TCP and never answers the upgrade: Bun fires no close for the
        // socket the handshake deadline closes, so the deadline itself must move the loop on.
        let accepts = 0;
        const silent = Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: { open: () => void accepts++, data: () => {} },
        });
        const sdk = new BotSDK({
            botUsername: 'testbot',
            password: 'x',
            gatewayUrl: `ws://127.0.0.1:${silent.port}`,
            connectTimeout: 150,
            readyTimeout: 0,
            autoReconnect: true,
            reconnectBaseDelay: 20,
            reconnectMaxDelay: 50,
            autoLaunchBrowser: false,
        });
        try {
            await expect(sdk.connect()).rejects.toThrow(/handshake timed out/);
            await until(() => accepts >= 3);
        } finally {
            await sdk.disconnect();
            silent.stop(true);
        }
    });

    test('connect() right after an unawaited disconnect() opens a new session', async () => {
        const connects = fakeGateway((_n, _msg, ws) => ws.send(ok));
        const sdk = makeSDK();
        await sdk.connect();
        const closing = sdk.disconnect();
        await sdk.connect();
        await closing;
        expect(connects()).toBe(2);
        expect(sdk.isAuthenticated()).toBe(true);
        expect(sdk.getConnectionState()).toBe('connected');
        await sdk.disconnect();
    });
});
