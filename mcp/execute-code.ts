import type { BotConnection } from './api/index';
import { ConsoleCapture, formatLogArgument, installExecutionConsoleCapture } from './console-capture';
import { executionContext, abortable, throwIfExecutionAborted } from '../sdk/execution-context';
import { formatWorldState } from '../sdk/formatter';
import { Spells } from '../sdk/spells';
import { redactCredentials } from '../sdk/redact';

/** One execution per character: a new call cancels the running one and starts once it has unwound. */
export class BotExecutions {
  private current = new Map<string, { controller: AbortController; done: Promise<unknown> }>();

  async run<T>(name: string, signal: AbortSignal | undefined, task: (controller: AbortController) => Promise<T>): Promise<T> {
    const key = name.toLowerCase();
    const previous = this.current.get(key);
    previous?.controller.abort(new Error('Superseded by a newer call for this bot'));
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(signal?.reason ?? new Error('Cancelled by client'));
    signal?.addEventListener('abort', onClientAbort, { once: true });
    if (signal?.aborted) onClientAbort();
    const done = (async () => {
      await previous?.done; // the old run releases the bot before the new one touches it
      controller.signal.throwIfAborted();
      return task(controller);
    })();
    const entry = { controller, done: done.catch(() => {}) };
    this.current.set(key, entry);
    try {
      return await done;
    } finally {
      signal?.removeEventListener('abort', onClientAbort);
      if (this.current.get(key) === entry) this.current.delete(key);
    }
  }
}

export const botExecutions = new BotExecutions();
type Manager = { get(name: string): BotConnection | undefined; connect(name: string): Promise<BotConnection> };

/** Records which bot/sdk calls are in flight for diagnostics; once cancelled, calls park instead of throwing. */
function tracked<T extends object>(object: T, label: string, active: Map<symbol, string>, signal: AbortSignal): T {
  return new Proxy(object, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        // A throw here would let a catch-all loop in cancelled code spin and starve the server.
        if (signal.aborted) return new Promise(() => {});
        const token = Symbol();
        active.set(token, `${label}.${String(prop)}`);
        try {
          const result = value.apply(target, args);
          if (result && typeof result.then === 'function') return Promise.resolve(result).finally(() => active.delete(token));
          active.delete(token);
          return result;
        } catch (error) { active.delete(token); throw error; }
      };
    },
  });
}

export async function executeCode(
  manager: Manager,
  botName: string,
  code: string,
  timeoutMs: number,
  clientSignal?: AbortSignal,
  executions = botExecutions,
) {
  installExecutionConsoleCapture();
  try {
    return await executions.run(botName, clientSignal, async controller => {
      const logs = new ConsoleCapture();
      const active = new Map<symbol, string>();
      const record = (level: 'log' | 'warn' | 'error', args: unknown[]) => {
        logs.push((level === 'log' ? '' : `[${level}] `) + args.map(formatLogArgument).join(' '));
      };
      const started = Date.now();
      let connection: BotConnection | undefined;
      let result: unknown;
      let failure: unknown;
      let failed = false;
      let interruptedActions: string[] = [];
      const rememberActions = () => { interruptedActions = [...active.values()]; };
      controller.signal.addEventListener('abort', rememberActions, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`Code execution timed out after ${timeoutMs / 60_000} minute(s)`)), timeoutMs);

      const work = async () => {
        const connecting = Symbol();
        active.set(connecting, 'Connecting / waiting for fresh state');
        try {
          connection = manager.get(botName);
          if (!connection?.connected) connection = await manager.connect(botName);
          const sdk = connection.sdk;
          try {
            if (sdk.getStateAge() > 10_000) await sdk.waitForStateChange(15_000);
            if (!sdk.getState()?.inGame) await sdk.waitForReady(15_000);
          } catch (error) {
            throwIfExecutionAborted();
            // Still run: diagnosing a stale client is exactly when you need execute_code.
            record('warn', [`No fresh in-game state (${error instanceof Error ? error.message : error}); running anyway, actions may not take effect.`]);
          }
        } finally { active.delete(connecting); }
        throwIfExecutionAborted();

        const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
          `const __rsExec = async (bot, sdk, Spells) => {\n${code}\n};`,
        );
        const fn = new Function(`${compiled}\nreturn __rsExec;`)();
        return fn(tracked(connection.bot, 'bot', active, controller.signal), tracked(connection.sdk, 'sdk', active, controller.signal), Spells);
      };

      try {
        result = await executionContext.run({ signal: controller.signal, log: record }, () => abortable(work()));
      } catch (error) {
        failure = error;
        failed = true;
        if (interruptedActions.length === 0) interruptedActions = [...active.values()];
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', rememberActions);
        // Detached continuations inherit this scope and must not dispatch after it ends.
        if (!controller.signal.aborted) controller.abort(new Error('Execution finished'));
      }

      const parts: string[] = [];
      if (logs.length) parts.push('── Console ──', ...logs.lines());
      if (failed) {
        const errorText = failure instanceof Error
          ? formatLogArgument(failure).split('\n').slice(0, 7).join('\n')
          : formatLogArgument(failure);
        parts.push('', '── Error ──', errorText,
          `Elapsed: ${Date.now() - started}ms`,
          `Active action: ${interruptedActions.join(', ') || 'User code'}`);
      } else if (result !== undefined) {
        try { parts.push('', '── Result ──', redactCredentials(JSON.stringify(result, null, 2) ?? String(result))); }
        catch (error) { failure = error; failed = true; parts.push('', '── Error ──', formatLogArgument(error)); }
      }
      const state = connection?.sdk.getState();
      if (state) {
        const ticks = state.gameMessages?.map(message => message.tick) ?? [];
        if (ticks.length && ticks.every(tick => tick < connection!.lastShownMessageTick)) connection!.lastShownMessageTick = -1;
        const sinceTick = connection!.lastShownMessageTick;
        parts.push('', '── World State ──', redactCredentials(formatWorldState(state, connection!.sdk.getStateAge(), { sinceTick, brief: true })));
        // Advance only from messages present in this snapshot; tolerate client cycle resets.
        if (ticks.length) connection!.lastShownMessageTick = Math.max(connection!.lastShownMessageTick, ...ticks);
      }
      if (code.length > 2000) parts.push('', '── Tip ──', `For long runs, save a script under bots/${botName}/ and run it against the browser client already opened by MCP.`);
      return { content: [{ type: 'text' as const, text: parts.join('\n').trim() || '(no output)' }], ...(failed ? { isError: true } : {}) };
    });
  } catch (error) {
    return { content: [{ type: 'text' as const, text: `Error: ${formatLogArgument(error)}` }], isError: true };
  }
}
