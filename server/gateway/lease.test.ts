// The controller lease, end to end: runs gateway.ts on a spare port and drives it with raw SDK
// websockets. A second control connection is refused (sdk_error code controller_busy) unless it
// asks for takeover; observers always connect; a closed controller releases the lease.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';

let gateway: Subprocess<'ignore', 'ignore', 'pipe'>;
let port: number;

/** Start the gateway on a free port; a port taken between probe and bind just means another try. */
async function startGateway(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        const probe = Bun.serve({ port: 0, fetch: () => new Response() });
        port = probe.port!;
        probe.stop(true);
        gateway = Bun.spawn([process.execPath, 'gateway.ts'], {
            cwd: import.meta.dir,
            env: {
                ...process.env,
                AGENT_PORT: String(port),
                GATEWAY_PUBLIC_PORT: '0',
                GATEWAY_HOSTNAME: '127.0.0.1',
                LOGIN_SERVER: 'false',
            },
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'pipe',
        });
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && gateway.exitCode === null) {
            try {
                if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return;
            } catch {}
            await Bun.sleep(100);
        }
        gateway.kill();
        if (attempt === 3) throw new Error(`gateway did not start:\n${await new Response(gateway.stderr).text()}`);
    }
}

beforeAll(startGateway);
afterAll(() => gateway?.kill());

type Reply = { type: string; code?: string; error?: string };

/** Open an SDK socket for `bot`, send sdk_connect, and resolve with the gateway's first reply. */
async function connect(bot: string, mode: 'control' | 'observe', takeover?: boolean, clientId = `test-${mode}`) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('socket error'));
    });
    const reply = new Promise<Reply>(resolve => {
        ws.onmessage = e => resolve(JSON.parse(String(e.data)));
    });
    ws.send(JSON.stringify({ type: 'sdk_connect', username: bot, clientId, mode, takeover }));
    return { ws, reply: await reply };
}

async function controllers(bot: string): Promise<number> {
    const status = (await (await fetch(`http://127.0.0.1:${port}/status/${bot}`)).json()) as { controllers?: unknown[] };
    return status.controllers?.length ?? 0;
}

/** Poll until the gateway reports `n` controllers for `bot` (its close handler runs asynchronously). */
async function expectControllers(bot: string, n: number): Promise<void> {
    const deadline = Date.now() + 2000;
    while ((await controllers(bot)) !== n && Date.now() < deadline) await Bun.sleep(20);
    expect(await controllers(bot)).toBe(n);
}

describe('controller lease', () => {
    test('/status says this gateway enforces the lease', async () => {
        const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as { controllerLease?: boolean };
        expect(status.controllerLease).toBe(true);
    });

    test('a second controller is refused and the first keeps the lease', async () => {
        const first = await connect('lease1', 'control', false, 'holder-1');
        expect(first.reply.type).toBe('sdk_connected');
        const second = await connect('lease1', 'control', false, 'requester-2');
        expect(second.reply).toMatchObject({ type: 'sdk_error', code: 'controller_busy' });
        expect(second.reply.error).toContain('holder-1'); // names who holds it, not who asked
        expect(second.reply.error).not.toContain('requester-2');
        await expectControllers('lease1', 1);
        first.ws.close();
    });

    test('observers connect alongside a controller', async () => {
        const controller = await connect('lease2', 'control');
        const observer = await connect('lease2', 'observe');
        expect(observer.reply.type).toBe('sdk_connected');
        await expectControllers('lease2', 1);
        controller.ws.close();
        observer.ws.close();
    });

    test('takeover pre-empts the holder', async () => {
        const first = await connect('lease3', 'control');
        const firstDropped = new Promise(resolve => (first.ws.onclose = resolve));
        const taker = await connect('lease3', 'control', true);
        expect(taker.reply.type).toBe('sdk_connected');
        await firstDropped;
        await expectControllers('lease3', 1);
        taker.ws.close();
    });

    test('a closed controller releases the lease', async () => {
        const first = await connect('lease4', 'control');
        first.ws.close();
        await expectControllers('lease4', 0);
        const next = await connect('lease4', 'control');
        expect(next.reply.type).toBe('sdk_connected');
        next.ws.close();
    });
});
