# Smithing

## Smelting Bronze Bars

Bronze bars require **1 copper ore + 1 tin ore** smelted at a furnace.

### How to Smelt

Some furnace spots pair the real furnace with an inert, option-less decoy loc
one tile away — a bare name match can pick the decoy and smelt nothing, with no
error. Use `{withOption}` to get the real one. Using ore on the furnace is the
portable low-level fallback:

```typescript
const state = sdk.getState();
if (!state) throw new Error("No world state");
const copper = state.inventory.find((i) => /copper ore/i.test(i.name));
const furnace = sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i });
if (!copper || !furnace)
  throw new Error("Copper ore and a usable nearby furnace are required");
await sdk.sendUseItemOnLoc(copper.slot, furnace.x, furnace.z, furnace.id);
await sdk.waitForCondition(
  (next) => next.inventory.some((item) => /bronze bar/i.test(item.name)),
  10_000,
);
```

- Use **copper** on furnace — it auto-consumes 1 tin from inventory
- The furnace's `Smelt` option opens a chat menu instead: per bar `Smelt X <Bar>`, `Smelt 10 <Bar>`,
  `Smelt 5 <Bar>` and the bar's own button (smelt one), published as `\n\n\n\n<Bar>` with a literal
  `\n`. Bars are Bronze, Iron, Silver, Steel, Gold, Mithril, Adamant, Rune; the bar arrives ~5 ticks
  after the click. Taking `Smelt` with a level-up box open still opens the menu. [v 2026-10-10 itest-fixture local]
- Low-level calls do not dismiss level-up dialogs; use `bot.dismissBlockingUI()`
  when a modal interrupts a batch
- Each bronze bar gives **155 xp** (at level 1-14 range, leveled from 1→14 with 10 bars = 1550 xp total, so ~155 xp per smelt)

### Furnace Locations

| Location          | Coordinates  | Furnace IDs | Notes                                                             |
| ----------------- | ------------ | ----------- | ----------------------------------------------------------------- |
| Lumbridge furnace | (3225, 3256) | 2785, 2781  | Right next to spawn, reliable. 2781 has `Smelt`; 2785 is a decoy. |
| Al Kharid furnace | (3273, 3184) | 2785, 2781  | Needs 10gp toll gate. 2781 has `Smelt`; 2785 is a decoy. A bot inside Al Kharid smelts from (3275, 3186). [v 2026-10-10 itest-fixture local] |

### Anvil Locations

| Location       | Coordinates  | Anvil ID | Notes                                     |
| -------------- | ------------ | -------- | ----------------------------------------- |
| Varrock (west) | (3188, 3421) | 2783     | Multiple anvils in smithy, near west bank |

Falador has a furnace and a bank; a `smith` run at the Falador furnace failed "no reachable anvil nearby (pass `area` at the anvil)". Nothing shows whether Falador has an anvil, so go to Varrock West (anvil beside the bank at (3185, 3436)). [v 2026-10-11 conductor2 local]

Also anvils at (3188, 3424) and (3188, 3426) — same building, same id 2783.

Two more anvils (id 2783) at (3246, 3404) and (3248, 3404) in south-east Varrock, reachable from
(3247, 3403). [v 2026-10-10 itest-fixture local]

### How to Smith at Anvil

Prefer the high-level helper, which opens the interface and observes Smithing XP:

```typescript
const result = await bot.smithAtAnvil("dagger", {
  barPattern: /bronze bar/i,
  timeout: 10_000,
});
if (!result.success) console.warn(result.reason, result.message);
```

**Requires hammer in inventory** (buy from Lumbridge General Store for 1gp).

A bar used on the anvil within 3 ticks of the previous item's Smithing XP is lost: no interface
opens. The level-up box, when there is one, shows 3 ticks after the XP; a bar used once it is open
still opens the interface. [v 2026-10-10 itest-fixture local]

### XP Rates

- 13 bronze bars = 2,015 Smithing XP (Smithing 1 -> 20); 8 iron ore smelted = 1,250 XP. [v 2026-10-24 conductor3 local]
- Smelting bronze bar: ~155 xp per bar (includes level-up bonuses)
- Smithing bronze dagger: ~312 xp per dagger at level 14-26 range
- 10 bars smelted: 1→14 Smithing
- 10 daggers smithed: 14→26 Smithing

### Workflow

1. Mine equal copper (rock ids 2090/2091) and tin (rock ids 2094/2095) at SE Varrock mine (3285, 3365)
2. Walk to Lumbridge furnace (3225, 3256) → smelt into bronze bars
3. Walk to Varrock anvil (3188, 3421) → smith into items (requires hammer)

### Key Locations for Full Loop

| Step       | Location                | Coordinates  |
| ---------- | ----------------------- | ------------ |
| Mine       | SE Varrock mine         | (3285, 3365) |
| Smelt      | Lumbridge furnace       | (3225, 3256) |
| Smith      | Varrock anvil           | (3188, 3421) |
| Buy hammer | Lumbridge General Store | (3210, 3244) |

### Route: Mine → Furnace → Anvil

Run end to end by plan iron-smith: SE Varrock mine -> Lumbridge furnace -> Varrock West anvil -> Varrock West bank. [v 2026-10-11 conductor2 local] Legs and timings are in `learnings/walking.md`.
This is a long loop. Consider using Varrock West Bank (nearby anvils) to store bars between trips.

Use `sdk/API.md` for the current `smithAtAnvil` product and option signature
rather than hard-coded interface component IDs.
