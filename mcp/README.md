# RS-Agent MCP Server

MCP (Model Context Protocol) server for controlling RS-Agent bots. Supports multiple simultaneous bot connections.

## Quick Start (Claude Code)

Claude Code auto-discovers the MCP server via `.mcp.json`. Just:

1. **Install dependencies (from the project root):**

   ```bash
   bun install
   ```

2. **Create a bot (if you haven't):**

   ```bash
   bun bots/create-bot.ts mybot
   ```

3. **Open the project in Claude Code** — it will prompt you to approve the MCP server.

4. **Control your bot:**
   ```
   Execute code on "mybot" to chop some trees
   ```

## Tools

### `get_market`

Public Grand Exchange research without a bot connection or controller takeover:
Use `get_market` with `operation: "status"` to check whether the server enables GE.
Disabled servers return a clear `ge_unavailable` error for market data reads.

```json
{"origin":"http://localhost:8888","operation":"items","query":"logs","sort":"buyValue","days":7}
```

Operations: `status`, `items`, `item` (requires `item_id`), `history` (requires `item_id`).
Use the game HTTP origin, not the gateway port. This tool cannot trade or read
private offers. See [the GE guide](../sdk/MARKET.md) for typed options and trading
through `bot.openGE()`, `bot.placeGEOffer()`, `bot.cancelGEOffer()` and collection.


### `execute_code`

Execute TypeScript code on a bot. Auto-connects on first use using credentials from `bots/{name}/bot.env`.

```typescript
execute_code({
  bot_name: "mybot",
  code: `
    const tree = sdk.findNearbyLoc(/^tree$/i);
    if (tree) {
      const result = await bot.chopTree(tree);
      console.log('Chopped:', result);
    }
    return sdk.getInventory();
  `,
});
```

### `list_bots`

List the bots this MCP session has used. `execute_code` holds a bot's control connection only
while its code runs, so `connected` is `false` between calls; that is normal.

```typescript
list_bots();
// Returns: { bots: [{ name: "mybot", username: "mybot", connected: false }], count: 1 }
```

### `disconnect_bot`

Disconnect a connected bot.

```typescript
disconnect_bot({ name: "mybot" });
```

## Resources

The server exposes API documentation as a resource:

- `file://../sdk/MARKET.md` — GE workflow, market data, receipts and recovery.
- `file://../sdk/API.md` — Auto-generated reference for `bot.*` (high-level actions) and `sdk.*` (low-level SDK)

Read this to discover available methods.

## Multiple Bots

Control multiple bots simultaneously — each auto-connects on first use. `execute_code` holds a
bot's control connection only while its code runs, and the gateway allows one controller per
bot: a call against a bot that a script or task is driving is refused (wait for it to finish).

```typescript
// Execute on different bots (auto-connects each)
execute_code({
  bot_name: "woodcutter",
  code: "await bot.chopTree()",
});

execute_code({
  bot_name: "miner",
  code: "await bot.interactLoc(/^rocks$/i, 'mine')",
});
```

## Manual Setup (without auto-discovery)

If you're not using Claude Code's auto-discovery, add to your MCP client config:

```json
{
  "mcpServers": {
    "rs-agent": {
      "command": "bun",
      "args": ["run", "/path/to/rs-sdk/mcp/server.ts"]
    }
  }
}
```

Or run directly for testing:

```bash
bun run mcp/server.ts
```

## Architecture

```
mcp/
├── server.ts           # MCP server (stdio transport)
└── api/
    └── index.ts        # BotManager - manages multiple connections
```

The `@modelcontextprotocol/sdk` dependency lives in the root `package.json`.

## Troubleshooting

**"Bot not found"**

- Create the bot first: `bun bots/create-bot.ts {name}`
- Check `bots/{name}/bot.env` exists

**"Bot is not connected"**

- Bots connect for each `execute_code` call — check that call's error output for connection failures
- "already controlled by ..." means a task or script is driving the bot: wait for it to finish

**"Connection failed"**

- Check the gateway is running
- Verify credentials in `bots/{name}/bot.env`

**MCP server not appearing in Claude Code**

- Run `bun install` at the project root
- Check `.mcp.json` exists at project root
- Restart Claude Code

## API Reference

See [`sdk/API.md`](../sdk/API.md) for the full auto-generated API documentation.

### High-Level Bot Actions

- Movement: `walkTo(x, z)`
- Skills: `chopTree()`, `burnLogs()`, `fletchLogs()`, `smithAtAnvil()`, `craftLeather()`
- Combat: `attack(target)`, `eatFood(target)`, `castSpell(target, spell)`
- Interaction: `interactLoc(target, option)`, `interactNpc(target, option)`, `talkTo(target)`
- Banking: `openBank()`, `depositItem()`, `withdrawItem()`
- Shopping: `openShop()`, `buyFromShop()`, `sellToShop()`
- Crafting: `smithAtAnvil()`, `fletchLogs()`, `craftLeather()`
- UI: `dismissBlockingUI()`, `skipTutorial()`

### Low-Level SDK Methods

- State: `getState()`, `getStateAge()`
- Inventory: `getInventory()`, `findInventoryItem(pattern)`
- NPCs: `getNearbyNpcs()`, `findNearbyNpc(pattern)`
- Locations: `getNearbyLocs()`, `findNearbyLoc(pattern)`
- Actions: `sendWalk()`, `sendInteractLoc()`, `sendInteractNpc()`
- Utilities: `findPath()`, `waitForCondition()`
