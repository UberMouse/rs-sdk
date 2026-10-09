# Integration test baseline

First full `bun run test:integration` (default `-j 3`) after the smoke and action tests landed.
This is the behaviour of the catalog tasks before the interruptible-task refactor; later runs are
compared against it.

- Date: 2026-10-09
- Engine: the shared server running from the main checkout (`RS_ENGINE_DIR=/home/taylorl/code/rs-sdk/server/engine`), commit unknown (a worktree-isolated session cannot run git against the main checkout)
- Local XP rate 25x (`learnings/local-server.md`)

| file                                | result | seconds |
| ----------------------------------- | ------ | ------- |
| actions/dismissBlockingUI.itest.ts  | pass   | 5.0     |
| actions/dropItem.itest.ts           | pass   | 3.8     |
| smoke/bank.itest.ts                 | pass   | 5.8     |
| smoke/combat.itest.ts               | pass   | 8.4     |
| smoke/firemaking.itest.ts           | pass   | 16.4    |
| smoke/fletching.itest.ts            | pass   | 8.4     |
| smoke/mining.itest.ts               | pass   | 6.8     |
| smoke/pickup.itest.ts               | pass   | 3.6     |
| smoke/shop.itest.ts                 | pass   | 5.6     |
| smoke/smithing.itest.ts             | pass   | 13.2    |
| smoke/woodcutting.itest.ts          | pass   | 6.0     |

## Known failures

None: every catalog task passed its smoke test, including smithing (smelt at the Lumbridge furnace
and a bronze dagger at the Varrock West anvil).

## Flake risks

- Fires persist for a while and refuse a second fire on their tile. `firemaking.itest.ts`,
  `dismissBlockingUI.itest.ts` and `dropItem.itest.ts` therefore start on a random tile in the
  field east of the Lumbridge General Store. Before that, back-to-back runs on the exact centre
  (3230, 3240) failed the firemaking task with "5 lights in a row failed" and the task's sidestep
  did not leave the tile (see `wiki/skills/firemaking.md`). Whether the task should cope with
  that is for a later task, not decided here.
- `pickup.itest.ts` needs the Knife ground spawn at (3224, 3202) to be present; it waits up to
  `maxWaitSeconds` (default 90 s) for it to respawn, so another bot taking it can slow the test.
