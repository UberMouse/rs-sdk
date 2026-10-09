# Lens: account safety

Could this task cost the account something that takes many runs to get back?

## Criteria

- **S1 Death.** The task's spots and targets are checked against `learnings/hazards.md` and the
  bot's combat level; combat tasks eat (or retreat) below an HP threshold and refuse to start
  without food when the target can hit back; nothing walks through a hazard on its route.
- **S2 Item loss.** Drop, sell, destroy and alch patterns can only match items meant to go
  (G2 applies doubly here); valuables are banked, not dropped; equipment is never dropped.
- **S3 Wilderness and PvP.** No route or spot crosses into the Wilderness unless the task
  exists for it and says so in its description.
- **S4 Money.** Buying is bounded (amount and price) and checks coins first; selling checks it
  isn't selling below a sane price or selling gear the account still needs.
- **S5 One controller.** The task doesn't start background loops, timers or second connections
  that outlive its run or drive the bot alongside another controller.
- **S6 Packet discipline.** No tight loops of sends without waits (the server accepts one
  social packet per tick and drops refused ops silently; spamming hides failures).

## Bands

- **A** — a normal run can kill the bot where it loses items, drop or sell equipment or
  valuables, or enter the Wilderness.
- **B** — death risk without item loss (respawn costs the run); unbounded spending; a
  send loop that can flood when an action keeps failing.
- **C** — a risk that only exists with params outside the verified spots.
- **D** — a hazard you could not confirm exists where the task goes.
