// The controller lease, end to end: runs gateway.ts on a spare port and drives it with raw SDK
// websockets. A second control connection is refused (sdk_error code controller_busy) unless it
// asks for takeover; observers always connect; a closed controller releases the lease.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';

let gateway: Subprocess;
let port: number;

beforeAll(async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    port = probe.port!;
    probe.stop(true);
    gateway = Bun.spawn([process.execPath, 'gateway.ts'], {
        cwd: import.meta.dir,
        env: { ...process.env, AGENT_PORT: String(port), GATEWAY_HOSTNAME: '127.0.0.1', LOGIN_SERVER: 'false' },
        stdout: 'ignore',
        stderr: 'ignore',
    });
    const deadline = Date.now() + 10_000;
    for (;;) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) break;
        } catch {}
        if (Date.now() > deadline) throw new Error('gateway did not start');
        await Bun.sleep(100);
    }
});

afterAll(() => gateway?.kill());

type Reply = { type: string; code?: string; error?: string };

/** Open an SDK socket, send sdk_connect, and resolve with the gateway's first reply. */
async function connect(mode: 'control' | 'observe', takeover?: boolean): Promise<{ ws: WebSocket; reply: Reply }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('socket error'));
    });
    const reply = new Promise<Reply>(resolve => {
        ws.onmessage = e => resolve(JSON.parse(String(e.data)));
    });
    ws.send(JSON.stringify({ type: 'sdk_connect', username: 'leasebot', clientId: `test-${mode}`, mode, takeover }));
    return { ws, reply: await reply };
}

async function controllers(): Promise<number> {
    const status = (await (await fetch(`http://127.0.0.1:${port}/status/leasebot`)).json()) as { controllers?: unknown[] };
    return status.controllers?.length ?? 0;
}

async function closeAndSettle(ws: WebSocket): Promise<void> {
    const closed = new Promise(resolve => (ws.onclose = resolve));
    ws.close();
    await closed;
    await Bun.sleep(100); // let the gateway run its close handler
}

describe('controller lease', () => {
    test('refuses a second controller, admits observers, honours takeover, releases on close', async () => {
        const first = await connect('control');
        expect(first.reply.type).toBe('sdk_connected');
        expect(await controllers()).toBe(1);

        const second = await connect('control');
        expect(second.reply).toMatchObject({ type: 'sdk_error', code: 'controller_busy' });
        expect(second.reply.error).toContain('test-control');
        expect(await controllers()).toBe(1);

        const observer = await connect('observe');
        expect(observer.reply.type).toBe('sdk_connected');

        const firstDropped = new Promise(resolve => (first.ws.onclose = resolve));
        const taker = await connect('control', true);
        expect(taker.reply.type).toBe('sdk_connected');
        await firstDropped; // the old controller was pre-empted
        expect(await controllers()).toBe(1);

        await closeAndSettle(taker.ws);
        expect(await controllers()).toBe(0);
        const after = await connect('control');
        expect(after.reply.type).toBe('sdk_connected');

        await closeAndSettle(after.ws);
        await closeAndSettle(observer.ws);
    });
});
