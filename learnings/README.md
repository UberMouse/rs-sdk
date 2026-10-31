# Agent learning snippets

Unless a section explicitly says otherwise, snippets in this directory are
written for the MCP `execute_code` environment. That environment provides
`bot` and `sdk` as globals and accepts TypeScript with top-level `await`:

```typescript
const state = sdk.getState();
const result = await bot.walkTo(3222, 3218);
return { result, state: sdk.getState() };
```

Standalone files under `bots/<name>/` use a different wrapper. Import
`runScript`, then destructure the same names once:

```typescript
import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    await bot.walkTo(3222, 3218);
    return sdk.getState();
});
```

For a long or background run, execute the standalone file with
`bun bots/<name>/script.ts`. Do not launch a detached bare snippet: `runScript`
owns connection setup, timeout reporting, signal handling, and shutdown. Keep
the browser client opened by MCP running: standalone scripts do not start a client.

## Action semantics

- Prefer high-level `bot.*` helpers. They attempt to observe method-specific
  evidence. Check the result when a method returns one.
- Low-level `sdk.send*` calls confirm browser-client dispatch only. A successful
  result does not prove that the game server applied the action. Observe the
  intended state, XP, inventory, dialog, or message change before continuing.
- Await every method returning `Promise`, including `scanNearbyLocs()` and
  `scanGroundItems()`.
- `getInventory().length` counts occupied slots. An `InventoryItem.count` is the
  quantity in that slot; `findInventoryItem()` returns only the first matching
  slot.
- An inventory item's op 1 can be a quest action that the cache labels
  "Drop": the bloated toad of [Big Chompy Bird Hunting](../wiki/quests/big-chompy-bird-hunting.md)
  has `[opheld1,bloated_toad]` = place the bait, with iop1=Drop, iop4=Release
  All, iop5=Release. The client's drop and `items drop` send op 5 (Release), so
  the toad hops away and the quest action never runs; `interact` with
  `target:'item'` refuses a "Drop" label. Check an item's `[opheld1,...]` script before
  dropping a quest item. [server data, unverified in game 2026-10-24]

See [`../sdk/API.md`](../sdk/API.md) for exact signatures.
