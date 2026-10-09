# Integration test baseline

The full `bun run test:integration` (default `-j 3`) after the interruptible-task refactor landed
(Task 14: no task reaches `bot` or `sdk`, no `call` command, no legacy `async` steps). Every catalog
task is generator steps over the ops in `conductor/actions/`; later runs are compared against this.

- Date: 2026-10-10, two consecutive full runs (both tables below); `replay/woodcutting.itest.ts`
  (Task 15) was added afterwards and is timed from a third full run on the final cleanup commits
  (25 files, all pass), so its first two columns are empty
- Engine: the shared server running from the main checkout (`RS_ENGINE_DIR=/home/taylorl/code/rs-sdk/server/engine`), commit unknown (a worktree-isolated session cannot run git against the main checkout)
- Local XP rate 25x, 400 ms ticks (`learnings/local-server.md`)
- 25 files, 41 tests; each test spawns its own fresh fixture bot on the headless lite client

| file                       | run 1 | s    | run 2 | s    | covers |
| -------------------------- | ----- | ---- | ----- | ---- | ------ |
| actions/attack.itest.ts    | pass  | 7.5  | pass  | 7.4  | `attack` starts a fight with a chicken, as `bot.attack` does |
| actions/bank.itest.ts      | pass  | 21.1 | pass  | 21.1 | bank ops match the `bot.*` methods (open, deposit, withdraw, partial and empty withdraws, close); `withBank` closes after its body and after a throw; no bank in view |
| actions/burn.itest.ts      | pass  | 13.9 | pass  | 20.2 | `burn` lights logs for `bot.burnLogs`'s XP; a refused tile is `cant-light-here` |
| actions/chop.itest.ts      | pass  | 4.0  | pass  | 4.0  | `chop` fells a tree and gains its log |
| actions/dismiss.itest.ts   | pass  | 13.6 | pass  | 13.6 | `dismiss` clears a level-up dialog as `bot.dismissBlockingUI` does, so the next action runs |
| actions/drop.itest.ts      | pass  | 7.6  | pass  | 7.6  | `drop` puts the item on the ground, as `bot.dropItem` does |
| actions/eat.itest.ts       | pass  | 4.4  | pass  | 4.4  | `eat` heals and uses up the food, as `bot.eatFood` does |
| actions/equip.itest.ts     | pass  | 4.4  | pass  | 4.4  | `equip` wields an item, as `bot.equipItem` does |
| actions/fletch.itest.ts    | pass  | 16.0 | pass  | 16.0 | `fletch` cuts arrow shafts for `bot.fletchLogs`'s XP; under the dialog guard a level-up is cleared and the next fletch still gets its menu |
| actions/mine.itest.ts      | pass  | 16.0 | pass  | 6.4  | `mine` takes ore and XP from a tin rock |
| actions/pickup.itest.ts    | pass  | 6.8  | pass  | 6.8  | `pickup` takes an item off the ground, as `bot.pickupItem` does |
| actions/shop.itest.ts      | pass  | 32.8 | pass  | 33.6 | shop ops match the `bot.*` methods (open, buy, too dear, not stocked, sell, rejected sell, close); `withShop` closes after its body and after a throw; no such shopkeeper |
| actions/smith.itest.ts     | pass  | 46.4 | pass  | 46.4 | `smith` forges a bronze dagger as `bot.smithAtAnvil` does; under the guards the anvil interface is left to the op; cancelled with it open, it closes it; `smelt` makes a bronze bar; a bar the menu lacks is `no-product`, menu closed |
| actions/use.itest.ts       | pass  | 6.4  | pass  | 7.2  | `useItemOnLoc` fills a bucket at a fountain; `useItemOnItem` makes headless arrows |
| actions/walk.itest.ts      | pass  | 82.0 | pass  | 76.4 | `walkTo` opens the Lumbridge castle doors on its route; Lumbridge to Varrock West bank, a timed-out walk carrying on |
| replay/woodcutting.itest.ts | -    | -    | -     | -    | a recorded woodcutting run (Lumbridge trees) replays with no divergence against the code that ran it; third full run: pass, 4.7 s |
| smoke/bank.itest.ts        | pass  | 6.1  | pass  | 6.0  | bank task deposits an item and withdraws a banked one (Varrock West) |
| smoke/combat.itest.ts      | pass  | 2.8  | pass  | 4.4  | combat task kills chickens to the Attack XP target (Lumbridge coop) |
| smoke/firemaking.itest.ts  | pass  | 25.6 | pass  | 20.8 | firemaking task burns every log given (field east of the general store) |
| smoke/fletching.itest.ts   | pass  | 9.6  | pass  | 9.6  | fletching task cuts every log into arrow shafts |
| smoke/mining.itest.ts      | pass  | 13.2 | pass  | 13.2 | mining task mines copper or tin to the XP target (SE Varrock mine) |
| smoke/pickup.itest.ts      | pass  | 2.8  | pass  | 2.8  | pickup task picks up the knife spawn (SE of Lumbridge castle) |
| smoke/shop.itest.ts        | pass  | 5.6  | pass  | 5.6  | shop task buys a hammer (Lumbridge General Store) |
| smoke/smithing.itest.ts    | pass  | 20.0 | pass  | 20.0 | smithing task smelts bronze bars (Lumbridge furnace) and forges a dagger (Varrock West anvil) |
| smoke/woodcutting.itest.ts | pass  | 4.4  | pass  | 6.0  | woodcutting task chops to the XP target (Lumbridge trees) |

The `actions/` files compare each op with the upstream `bot.*` method it ports where one exists
(the fixture harness still has a `BotActions` for that; tasks do not). The `smoke/` files run each
catalog task end to end through `run-task.ts`, so they exercise the live driver, the guards and the
RESULT line.

## Known failures

None.

## Flake risks

- A recently lit tile can refuse another fire ("You can't light a fire here."; how long is
  unconfirmed, see `wiki/skills/firemaking.md`). `smoke/firemaking`, `actions/burn`,
  `actions/dismiss` and `actions/drop` therefore start on a random tile in ground no other test
  lights fires on; `burn` steps aside after a refusal. Its time varies with how many refusals it
  meets (13.9 s and 20.2 s above).
- Tests that share world state (a tree, a rock, a ground spawn, shop stock) work ground no other
  test uses, but an earlier run of the same test can leave a stump, a depleted rock or a taken
  spawn: `actions/mine` (16.0 s vs 6.4 s above) and `smoke/pickup` (waits up to `maxWaitSeconds`,
  default 90 s, for the knife at (3224, 3202) to respawn) then wait for a respawn.
- `actions/walk` is the longest file (about 230 tiles to Varrock West bank); a busy server slows it.
