import { expect, test } from 'bun:test';
import { join } from 'node:path';

async function runChild(mode: string) {
    // Exercise the real managed SDK connection and process lifetime. The
    // gateway is local and supplies fabricated ticks; no game client is used.
    const server = Bun.serve<{ timer?: ReturnType<typeof setInterval>; tick: number }, {}>({
        port: 0,
        fetch(req, srv) {
            if (srv.upgrade(req, { data: { tick: 0 } })) return;
            return new Response('WebSocket only', { status: 400 });
        },
        websocket: {
            message(ws, raw) {
                if (JSON.parse(String(raw)).type !== 'sdk_connect') return;
                ws.send(JSON.stringify({ type: 'sdk_connected', success: true }));
                const publish = () => ws.send(JSON.stringify({
                    type: 'sdk_state',
                    state: {
                        tick: ++ws.data.tick,
                        inGame: true,
                        player: { worldX: 3222, worldZ: 3218 },
                        skills: [],
                        nearbyLocs: [{ id: 1, name: 'Tree', x: 3223, z: 3218 }]
                    },
                    stateReceivedAt: Date.now()
                }));
                publish();
                ws.data.timer = setInterval(publish, 50);
            },
            close(ws) {
                clearInterval(ws.data.timer);
            }
        }
    });
    const start = Date.now();
    const child = Bun.spawn({
        cmd: [process.execPath, join(import.meta.dir, 'fixtures/runner-lifecycle.ts'), mode],
        env: {
            ...process.env,
            BOT_USERNAME: 'runner-test', PASSWORD: 'test-password', SERVER: 'localhost',
            GATEWAY_URL: `ws://localhost:${server.port}`
        },
        stdout: 'pipe',
        stderr: 'pipe'
    });
    // A leaked 60-second script deadline must fail promptly, not stall CI.
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited
        ]);
        return { stdout, stderr, exitCode, duration: Date.now() - start };
    } finally {
        clearTimeout(watchdog);
        server.stop(true);
    }
}

test('managed run cleanup cannot terminate a subsequent run', async () => {
    const result = await runChild('consecutive');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('SECOND_SCRIPT_FINISHED');
    expect(result.stdout).toContain('RUN_FINISHED:true:true');
    expect(result.stderr).not.toContain('forcing exit');
}, 15_000);

test('a completed managed script exits naturally without the disconnect deadline', async () => {
    const result = await runChild('success');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('RUN_FINISHED:true');
    expect(result.duration).toBeLessThan(4000);
}, 15_000);

test('a failed managed script clears its deadline and retains a nonzero exit code', async () => {
    const result = await runChild('failure');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('RUN_FINISHED:false:expected script failure');
    expect(result.duration).toBeLessThan(4000);
}, 15_000);
