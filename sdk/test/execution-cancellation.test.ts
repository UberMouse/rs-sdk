import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';
import { executionContext, executionWait } from '../execution-context';
import { executeCode, BotExecutions } from '../../mcp/execute-code';
import { formatLogArgument, installExecutionConsoleCapture } from '../../mcp/console-capture';

function harness() {
    const sdk = new BotSDK({ botUsername: 'test', password: 'test', autoLaunchBrowser: false });
    const internal = sdk as any;
    const packets: any[] = [];
    internal.state = {
        inGame: true, tick: 1,
        player: { name: 'test', worldX: 3200, worldZ: 3200, x: 128, z: 128, level: 0, lifeId: 1, combat: { inCombat: false }, animId: -1 },
        inventory: [], skills: [], gameMessages: [], nearbyLocs: [], nearbyNpcs: [], nearbyPlayers: [], groundItems: [],
        dialog: { isOpen: false }, interface: { isOpen: false }, bank: { isOpen: false }, shop: { isOpen: false },
    };
    internal.stateReceivedAt = Date.now();
    internal.connectionState = 'connected';
    internal.ws = { readyState: WebSocket.OPEN };
    internal.send = (message: any) => {
        packets.push(message);
        // Dispatch is acknowledged, but there is no movement/state update.
        queueMicrotask(() => internal.pendingActions.get(message.actionId)?.resolve({ success: true, message: 'dispatched' }));
    };
    sdk.sendFindPath = async () => ({ success: true, reachedDestination: true, waypoints: [{ x: 3208, z: 3200, level: 0 }] });
    const bot = new BotActions(sdk);
    const connection = { sdk, bot, username: 'test', connected: true, lastShownMessageTick: -1 };
    const manager = { get: () => connection, connect: async () => connection };
    return { sdk, bot, internal, packets, manager };
}

describe('execution cancellation', () => {
    test('cancels an internal walk wait, retains diagnostics, and allows the next execution', async () => {
        const h = harness();
        const result = await executeCode(h.manager, 'test', "console.log('walking started'); await bot.walkTo(3208, 3200);", 20);
        expect(result.isError).toBeTrue();
        expect(result.content[0]!.text).toContain('walking started');
        expect(result.content[0]!.text).toContain('bot.walkTo');
        expect(result.content[0]!.text).toContain('Position: (3200, 3200)');
        expect(h.internal.stateListeners.size).toBe(0);
        expect(h.internal.pendingActions.size).toBe(0);
        expect(h.packets).toHaveLength(1);
        const next = await executeCode(h.manager, 'test', 'return await sdk.sendWalk(3201, 3200);', 100);
        expect(next.isError).toBeUndefined();
        expect(h.packets).toHaveLength(2);
    });

    test('blocks dispatch from a detached continuation after its execution finishes', async () => {
        const h = harness();
        const controller = new AbortController();
        let release!: () => void;
        const paused = new Promise<void>(resolve => { release = resolve; });
        const old = executionContext.run({ signal: controller.signal }, async () => {
            await paused;
            return h.sdk.sendWalk(3210, 3200);
        });
        controller.abort(new Error('old execution cancelled'));
        release();
        await expect(old).rejects.toThrow('old execution cancelled');
        expect(h.packets).toHaveLength(0);
    });

    test('cancellation disposes state and dispatch waits without waiting for their timers', async () => {
        const h = harness();
        h.internal.send = (message: unknown) => h.packets.push(message);
        const controller = new AbortController();
        const scope = { signal: controller.signal };
        const waits = executionContext.run(scope, () => [h.sdk.waitForTicks(10), h.sdk.waitForCondition(() => false), h.sdk.sendWalk(3201, 3200)]);
        const settled = Promise.allSettled(waits);
        controller.abort(new Error('stop'));
        for (const result of await settled) {
            expect(result.status).toBe('rejected');
            if (result.status === 'rejected') expect(result.reason.message).toBe('stop');
        }
        expect(h.internal.stateListeners.size).toBe(0);
        expect(h.internal.pendingActions.size).toBe(0);
    });

    test('a newer call cancels the running one and starts after it unwinds', async () => {
        const executions = new BotExecutions();
        const order: string[] = [];
        const first = executions.run('Test', undefined, async controller => {
            order.push('first');
            await new Promise(resolve => controller.signal.addEventListener('abort', resolve));
            await Bun.sleep(5);
            order.push('first unwound');
            throw controller.signal.reason;
        });
        await Bun.sleep(1);
        const second = executions.run('test', undefined, async () => { order.push('second'); });
        await expect(first).rejects.toThrow('Superseded');
        await second;
        expect(order).toEqual(['first', 'first unwound', 'second']);
    });

    test('explicit client cancellation stops a running action', async () => {
        const h = harness();
        const controller = new AbortController();
        const work = executeCode(h.manager, 'test', 'await bot.walkTo(3208, 3200);', 1000, controller.signal);
        await new Promise(resolve => setTimeout(resolve, 5));
        controller.abort(new Error('client interrupted'));
        const result = await work;
        expect(result.isError).toBeTrue();
        expect(result.content[0]!.text).toContain('client interrupted');
        expect(h.internal.stateListeners.size).toBe(0);
        expect(h.packets).toHaveLength(1);
    });

    test('a newer execute_code supersedes a running walk without overlapping it', async () => {
        const h = harness();
        const executions = new BotExecutions();
        const first = executeCode(h.manager, 'test', 'await bot.walkTo(3208, 3200);', 1000, undefined, executions);
        await Bun.sleep(5);
        const second = executeCode(h.manager, 'test', 'return await sdk.sendWalk(3210, 3200);', 1000, undefined, executions);
        const [old, next] = await Promise.all([first, second]);
        expect(old.isError).toBeTrue();
        expect(old.content[0]!.text).toContain('Superseded');
        expect(next.isError).toBeUndefined();
        expect(h.packets).toHaveLength(2);
        expect(h.internal.stateListeners.size).toBe(0);
    });

    test('disconnect supersedes the running execution', async () => {
        const h = harness();
        const executions = new BotExecutions();
        const work = executeCode(h.manager, 'test', 'await bot.walkTo(3208, 3200);', 1000, undefined, executions);
        await Bun.sleep(5);
        let disconnected = false;
        await executions.run('TEST', undefined, async () => { disconnected = true; });
        const result = await work;
        expect(disconnected).toBeTrue();
        expect(result.isError).toBeTrue();
        expect(result.content[0]!.text).toContain('Superseded');
    });

    test('cancelled code that swallows errors parks instead of starving the event loop', async () => {
        const h = harness();
        const started = Date.now();
        let timerLag = -1;
        setTimeout(() => { timerLag = Date.now() - started; }, 20);
        const result = await executeCode(h.manager, 'test',
            'while (true) { try { await sdk.waitForTicks(1); } catch {} }', 10);
        expect(result.content[0]!.text).toContain('timed out');
        await Bun.sleep(40);
        expect(timerLag).toBeGreaterThan(0);
        expect(timerLag).toBeLessThan(200);
    });

    test('concurrent bots keep their SDK logs in their own execution', async () => {
        const a = harness();
        const b = harness();
        a.sdk.sendWait = async () => { console.log('SDK alpha'); await Bun.sleep(10); return { success: true, message: 'alpha' }; };
        b.sdk.sendWait = async () => { console.log('SDK beta'); await Bun.sleep(5); return { success: true, message: 'beta' }; };
        const restore = installExecutionConsoleCapture();
        try {
            const [first, second] = await Promise.all([
                executeCode(a.manager, 'alpha', 'await sdk.sendWait();', 100),
                executeCode(b.manager, 'beta', 'await sdk.sendWait();', 100),
            ]);
            expect(first.content[0]!.text).toContain('SDK alpha');
            expect(first.content[0]!.text).not.toContain('SDK beta');
            expect(second.content[0]!.text).toContain('SDK beta');
            expect(second.content[0]!.text).not.toContain('SDK alpha');
        } finally { restore(); }
    });

    test('TypeScript annotations are stripped and user-code errors retain their logs', async () => {
        const h = harness();
        const result = await executeCode(h.manager, 'test', "const pattern: RegExp = /copper ore/i; console.log(pattern); throw new Error('diagnostic failure');", 100);
        expect(result.isError).toBeTrue();
        expect(result.content[0]!.text).toContain('/copper ore/i');
        expect(result.content[0]!.text).toContain('diagnostic failure');
    });

    test('cleans a wait even if its setup completes synchronously', async () => {
        let cleaned = false;
        expect(await executionWait<number>(resolve => { resolve(7); return () => { cleaned = true; }; })).toBe(7);
        expect(cleaned).toBeTrue();
    });

    test('formats regexes and redacts credentials without losing useful diagnostics', () => {
        expect(formatLogArgument(/copper ore/i)).toBe('/copper ore/i');
        const log = formatLogArgument({ pattern: /^iron ore$/, url: 'https://example.com/bot?bot=test&password=abc123' });
        expect(log).toContain('/^iron ore$/');
        expect(log).toContain('password=[REDACTED]');
        expect(log).not.toContain('abc123');
    });

    test('walk deadlines terminate an otherwise stalled helper', async () => {
        const h = harness();
        const result = await h.bot.walkTo(3208, 3200, 0, { timeout: 15 });
        expect(result).toMatchObject({ success: false, reason: 'timeout' });
        expect(h.internal.stateListeners.size).toBe(0);
        expect(h.packets).toHaveLength(1);
    });

    test('does not send movement packets when no fresh state can be obtained', async () => {
        const h = harness();
        h.internal.stateReceivedAt = Date.now() - 20_000;
        h.sdk.waitForStateChange = async () => { throw new Error('No state'); };
        const result = await h.bot.walkTo(3208, 3200);
        expect(result).toMatchObject({ success: false, reason: 'stale_state' });
        expect(h.packets).toHaveLength(0);
    });

    test('MCP warns about stale state but still runs the code', async () => {
        const h = harness();
        h.internal.stateReceivedAt = Date.now() - 20_000;
        h.sdk.waitForStateChange = async () => { throw new Error('No fresh state'); };
        const result = await executeCode(h.manager, 'test', 'return sdk.getStateAge() > 10_000;', 100);
        expect(result.isError).toBeUndefined();
        expect(result.content[0]!.text).toContain('[warn] No fresh in-game state (No fresh state)');
        expect(result.content[0]!.text).toContain('── Result ──\ntrue');
    });

    test('MCP keeps the existing brief world-state output', async () => {
        const h = harness();
        h.internal.state.skills = [{ name: 'Attack', level: 1, baseLevel: 1, experience: 0 }];
        const result = await executeCode(h.manager, 'test', 'return "ok";', 100);
        expect(result.content[0]!.text).toContain('Position: (3200, 3200)');
        expect(result.content[0]!.text).not.toContain('Attack: 1 (0 xp)');
    });
});
