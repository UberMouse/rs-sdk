// Bot connection manager
// Supports multiple simultaneous bot connections

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { bindListenersToCaller } from '../console-capture';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface BotConnection {
  sdk: BotSDK;
  bot: BotActions;
  username: string;
  connected: boolean;
  unsubscribeConnectionState?: () => void;
  /**
   * High-water tick for gameMessages already shown to the agent. Used by
   * the MCP server's formatter so repeated execute_code calls only render
   * NEW chat / system messages. Internal — not part of the SDK surface.
   */
  lastShownMessageTick: number;
}

class BotManager {
  private connections: Map<string, BotConnection> = new Map();
  private defaultGatewayUrl = 'ws://localhost:7780';

  /**
   * Connect to a bot by name.
   * If password is not provided, loads credentials from bots/{name}/bot.env
   */
  async connect(name: string, password?: string, gatewayUrl?: string): Promise<BotConnection> {
    // Check if already connected
    if (this.connections.has(name)) {
      const existing = this.connections.get(name)!;
      if (existing.connected) {
        return existing;
      }
      // Reconnect if disconnected
      await this.connectWithRetry(existing.sdk);
      existing.connected = true;
      return existing;
    }

    let username = name;
    let pwd = password;
    let gateway = gatewayUrl || this.defaultGatewayUrl;
    let showChat = true;

    // Load credentials from bot.env if no password provided
    if (!password) {
      // Try cwd first, then fall back to the repo root (this file lives in mcp/api/,
      // so the root is two levels up)
      const cwdPath = join(process.cwd(), 'bots', name, 'bot.env');
      const repoPath = join(import.meta.dir, '..', '..', 'bots', name, 'bot.env');
      const envPath = existsSync(cwdPath) ? cwdPath : repoPath;

      if (!existsSync(envPath)) {
        throw new Error(`Bot "${name}" not found. Create it first with: bun bots/create-bot.ts ${name}`);
      }

      const envContent = await readFile(envPath, 'utf-8');
      const env = this.parseEnv(envContent);

      username = env.BOT_USERNAME || name;
      pwd = env.PASSWORD;

      // A bot.env GATEWAY_URL (e.g. a private fleet gateway) wins, as in sdk/cli.ts.
      if (env.GATEWAY_URL) {
        gateway = env.GATEWAY_URL;
      } else if (env.SERVER) {
        gateway = deriveGatewayUrl(env.SERVER);
      }

      // Allow opting out of player chat via SHOW_CHAT=false in bot.env.
      // Default: true, so multi-bot scripts can see each other's speech.
      if (env.SHOW_CHAT?.toLowerCase() === 'false') {
        showChat = false;
      }
    }

    if (!pwd) {
      throw new Error(`No password provided for bot "${name}"`);
    }

    console.error(`[MCP] Connecting bot "${name}":`);
    console.error(`[MCP]   username: ${username}`);
    console.error(`[MCP]   gateway: ${gateway}`);
    console.error(`[MCP]   password: ${pwd ? pwd.substring(0, 3) + '...' : 'MISSING'}`);

    const sdk = new BotSDK({
      botUsername: username,
      password: pwd,
      gatewayUrl: gateway,
      connectionMode: 'control',
      autoReconnect: true,       // Enable auto-reconnect for connection stability
      autoLaunchBrowser: 'auto', // Auto-launch browser if session is stale
      showChat,                  // Show other players' chat (default: true; opt out with SHOW_CHAT=false)
    });

    // A console.log in a listener the user's code registers (waitForCondition) reaches its capture.
    bindListenersToCaller(sdk);
    const bot = new BotActions(sdk);

    // Connect with retry to handle race conditions
    console.error(`[MCP] Starting connection...`);
    try {
      await this.connectWithRetry(sdk);
    } catch (err) {
      // This SDK is not stored anywhere yet: left alone it would keep auto-reconnecting unseen
      // and take the bot's controller lease whenever the gateway answered.
      await sdk.disconnect().catch(() => {});
      throw err;
    }
    console.error(`[MCP] Bot "${name}" connected!`);

    const connection: BotConnection = {
      sdk,
      bot,
      username,
      connected: true,
      lastShownMessageTick: -1
    };

    // Track connection state changes
    connection.unsubscribeConnectionState = sdk.onConnectionStateChange((state) => {
      const wasConnected = connection.connected;
      connection.connected = state === 'connected';
      if (wasConnected && !connection.connected) {
        console.error(`[MCP] Bot "${name}" connection lost (${state}), will auto-reconnect...`);
      } else if (!wasConnected && connection.connected) {
        console.error(`[MCP] Bot "${name}" reconnected!`);
      }
    });

    this.connections.set(name, connection);
    return connection;
  }

  private async connectWithRetry(sdk: BotSDK, maxAttempts = 3, timeoutMs = 30000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Connection timed out after ${timeoutMs / 1000}s`)), timeoutMs);
        });

        await Promise.race([sdk.connect(), timeoutPromise]).finally(() => clearTimeout(timeoutId!));
        return; // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          const delay = attempt * 2000; // 2s, 4s backoff
          console.error(`[MCP] Connection attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw new Error(`Failed to connect after ${maxAttempts} attempts. Last error: ${msg}`);
        }
      }
    }
  }

  /**
   * Disconnect a bot by name
   */
  async disconnect(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new Error(`Bot "${name}" is not connected`);
    }
    // While a call holds (or is attaching) the bot, its entry must stay: release() finds the SDK
    // to disconnect through it, and an attach retrying under a removed entry would be orphaned,
    // holding the controller lease with nothing left to release it.
    if (this.attaching.has(name) || (this.holders.get(name) ?? 0) > 0) {
      throw new Error(`Bot "${name}" is in use by a running execute_code call; it is released when that call ends`);
    }

    console.error(`[MCP] Disconnecting bot "${name}"...`);
    if (connection.unsubscribeConnectionState) {
      connection.unsubscribeConnectionState();
    }
    connection.sdk.disconnect();
    connection.connected = false;
    this.connections.delete(name);
    console.error(`[MCP] Bot "${name}" disconnected`);
  }

  // The gateway allows one controller per bot, so an idle MCP session must not hold it and lock
  // out scripts and tasks: each execute_code acquires the bot's control connection and releases
  // it when done. Calls on the same bot share one attach (counted), and the last one out lets go.
  private holders: Map<string, number> = new Map();
  private attaching: Map<string, Promise<BotConnection>> = new Map();
  private releasing: Map<string, Promise<void>> = new Map();

  /** Attach (or join the attach in progress) and count this caller. Pair with release(). */
  async acquire(name: string): Promise<BotConnection> {
    // A release still closing its socket must finish first, or this would get the dying connection.
    await this.releasing.get(name);
    let attach = this.attaching.get(name);
    if (!attach) {
      const existing = this.connections.get(name);
      if (existing?.connected && (this.holders.get(name) ?? 0) > 0) {
        this.holders.set(name, this.holders.get(name)! + 1);
        return existing;
      }
      attach = this.connect(name).catch(async (err) => {
        // A failed re-attach must not keep auto-reconnecting in the background and take the lease
        // later, unless another call still holds this SDK (it is reconnecting under that call).
        if ((this.holders.get(name) ?? 0) === 0) {
          await this.connections.get(name)?.sdk.disconnect().catch(() => {});
        }
        throw err;
      });
      this.attaching.set(name, attach);
      attach.finally(() => this.attaching.delete(name)).catch(() => {});
    }
    const connection = await attach;
    this.holders.set(name, (this.holders.get(name) ?? 0) + 1);
    return connection;
  }

  /**
   * Drop one hold on a bot; the last one disconnects, unconditionally (also stopping any
   * auto-reconnect in progress), but keeps the entry (SDK, chat cursor) for the next acquire().
   */
  async release(name: string): Promise<void> {
    const held = (this.holders.get(name) ?? 1) - 1;
    if (held > 0) {
      this.holders.set(name, held);
      return;
    }
    this.holders.delete(name);
    const connection = this.connections.get(name);
    if (!connection) return;
    connection.connected = false;
    const closing = connection.sdk.disconnect().finally(() => this.releasing.delete(name));
    this.releasing.set(name, closing);
    await closing;
  }

  /**
   * Get a bot connection by name
   */
  get(name: string): BotConnection | undefined {
    return this.connections.get(name);
  }

  /**
   * List all connected bots
   */
  list(): Array<{ name: string; username: string; connected: boolean }> {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      username: conn.username,
      connected: conn.connected
    }));
  }

  /**
   * Check if a bot is connected
   */
  has(name: string): boolean {
    return this.connections.has(name);
  }

  private parseEnv(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        result[key.trim()] = valueParts.join('=').trim();
      }
    }
    return result;
  }
}

// Export singleton instance
export const botManager = new BotManager();
