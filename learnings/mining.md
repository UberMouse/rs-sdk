# Mining

Successful patterns for mining automation.

## Finding Rocks

Rocks are **locations** (not NPCs). Filter for rocks with a "Mine" option:

The game names every rock `Rocks`; the webclient's state collector renames known live ore rocks to `Rocks copper ore`, `Rocks tin ore`, and so on (by loc id), so `nearbyLocs` carries the ore label.
Use `/copper ore/i` to find a rock; `/^copper ore$/i` matches the inventory item only.
Depleted rocks stay plain `Rocks`; select a live ore-specific rock again.

```typescript
const state = sdk.getState();
const rock = state?.nearbyLocs
  .filter((loc) => /rocks?/i.test(loc.name))
  .filter((loc) => loc.optionsWithIndex.some((o) => /^mine$/i.test(o.text)))
  .sort((a, b) => a.distance - b.distance)[0];
```

**Every rock is named "Rocks" in the game** (options Mine, Prospect), and so are depleted rocks (plainrock1/2, ids 450/452). Copper vs tin vs iron differs only by loc id (`rock1`/`rock2` and `macro_` variants in `server/content/pack/loc.pack`); Prospect, or match on loc id, to pick an ore. Dropped ores pile at the bot's feet. [v 2026-10-09 conductor1 local]

## Mining Action

```typescript
if (!rock) throw new Error("No mineable rock nearby");
const result = await bot.mineRock(rock);
if (!result.success) console.warn(result.reason, result.message);
```

For lower-level control, `sendInteractLoc()` only confirms client dispatch. Take
an XP/inventory baseline and wait for the intended change rather than sleeping
for an arbitrary duration.

## Essence mine entry from a quest area

- The `essence-mine` task's `enter` has no `met` param, so its walk to Aubury fails from inside a gated area: from the Priest in Peril dungeon `No connector from level 0 (3440,9894) to (3252,3402)`, from temple level 2 `no-path ... ends 238 tiles away at (3409,3483)`. First leave (climb down, then `travel` with `met` of the gates, e.g. `quest:priestperil>=8`), then `enter`. [v 2026-10-23 questw5 local]
- Rune essence trips with a pickaxe and 8 lobsters held gave 18 essence each (3 trips for 50); a Bronze pickaxe at Mining 1 works; one "timed out waiting for ore from rock" recovered on its own. [v 2026-10-23 questw5 local]

## Detecting Mining Activity

Animation ID 625 indicates active mining:

```typescript
const animation = sdk.getState()?.player?.animId ?? -1;
const isMining = animation === 625;
const isIdle = animation === -1;
```

**Note:** Al Kharid mine is full of Lvl 14 scorpions. Combat 27+ with defensive style is enough to survive while mining. The scorpion fights actually train Defence passively.

## Reliable Locations

| Location | Coordinates | Notes |
|----------|-------------|-------|
| SE Varrock mine | (3285, 3365) | Copper, tin, iron rocks within 1-4 tiles of the centre; nothing attacked a combat-27 bot or a combat-20 bot; `bot.walkTo` from Lumbridge works (the task's return-to-area step walked from the chicken coop in under 30s). [v 2026-10-10 conductor2 local] |
| Al Kharid mine | (3295, 3287) | Iron, coal, gold, silver, mithril, tin. Scorpions! |
| Lumbridge Swamp mine | (3238, 3162) | Coal, mithril and adamantite rocks across (3233-3243, 3157-3167); the swamp has no other rocks and no copper or tin (map data, `wiki/world.json`). An earlier run's interactions there failed silently, cause unknown |

**Getting to Al Kharid mine from Lumbridge:** Pay 10gp toll at gate (3268, 3227), walk NE. Dialog sequence: continue → continue → "Yes, ok." (index 3) → continue.

## Iron layouts (engine rules)

Iron: [wiki/resources/rock/iron.md](../wiki/resources/rock/iron.md); sites [Varrock East](../wiki/places/varrock-east-mine.md), [Rimmington](../wiki/places/rimmington-mine.md), [Al Kharid](../wiki/places/al-kharid-mine.md). Rates per layout: `wiki/skills/mining.md` (Verified training spots).

- A 1x1 rock is reached only from its 4 orthogonal neighbours, never diagonally (`Player.inOperableDistance` -> `ReachStrategy.reachRectangle1`). No tile reaches more than 3 iron rocks at the sites tested.
- Iron respawns in 20 ticks (`mine.dbrow`), scaled down only by players online. At Mining 63+ every roll succeeds and ore-to-ore is at least 5 ticks with an adamant pickaxe.
- With 3 reachable rocks the miner is respawn-bound at ~7.6 ticks/ore (~1.03M XP/h at 875 XP/ore), standing still or in area mode. With 4+ rocks it never waits and lands ~6.75 ticks/ore (~1.167M/h). Standing still never beat area mode. [v 2026-10-11 conductor2w1 local]
- Clicking the next rock on the predicted roll tick gains nothing: `World.cycle` processes client input before players, so a click on the roll tick only redirects that roll (`mining_firstswing` re-arms `action_delay` only below the clock).

## Counting Ore

```typescript
function countOre() {
  const state = sdk.getState();
  if (!state) return 0;
  return state.inventory
    .filter((i) => /ore$/i.test(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}
```

## Drop When Full

```typescript
const state = sdk.getState();
if (!state) throw new Error("No world state");
if (state.inventory.length >= 28) {
  const ores = state.inventory.filter((i) => /ore$/i.test(i.name));
  for (const ore of ores) {
    await sdk.sendDropItem(ore.slot);
    await new Promise((r) => setTimeout(r, 100));
  }
}
```
