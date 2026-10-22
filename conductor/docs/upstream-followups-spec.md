# Spec: follow-ups from the upstream merge (2026-10-22)

Main merged `upstream/main` b565f2d92 as 54c20ff66 (with 2366da8f8 and 899ece57a). The merge's report named what the
fork must still change: the engine now writes save format 9, which `conductor/lib/saves.ts` refuses; upstream fixed a
stale position in `walkTo` that our port in `conductor/actions/walk.ts` copies; upstream left a webclient type error;
and two docs say things that are no longer true. The shared stack still runs the pre-merge engine and is restarted
only after Task 1 lands.

## Global rules

- `conductor/` and `wiki/world/` code is formatted and linted (oxfmt, oxlint, warnings denied); finish with
  `bun run verify:conductor` and `bun test conductor`.
- Unit tests in `conductor/test/**/*.test.ts` on scripted worlds; smoke tests in
  `conductor/test/integration/smoke/*.itest.ts` (`bun run test:integration <filter>`, the shared stack on
  `:8888`/`:7780`, which still runs the pre-merge engine; never start, stop or restart it). Integration tests make
  their own fixture bots; never drive a conductor bot.
- Contracts that must keep working: the `run-task.ts` CLI and `RESULT <json>`; `TaskResult`'s fields; recordings
  replay; library saves in `conductor/saves/` (version 8 and older) still load.
- No `Date.now()` in game logic; waits are in ticks. Game knowledge goes in `learnings/` per the `knowledge` skill.
- `mcp/` is out of scope (don't change or test it); a doc that describes it may be corrected.
- Comment density matches the surrounding code. Members worlds only; distances in run ticks, never walking ticks.

## Task 1 — Save format 9

**Files:** `conductor/lib/saves.ts`, its tests (`conductor/test/lib/saves*.test.ts` or the nearest existing file),
`sdk/test/utils/save-generator.ts` only if a test needs it to write version 9.

- Upstream raised the engine's save version from 8 to 9: 21 level-playtime ints added before the CRC
  (`server/engine/src/engine/entity/PlayerLoading.ts`, `Player.ts` save; read them, cite the lines).
  `SAV_VERSION` becomes 9; `decodeSave` reads (or skips, if nothing reports them) the new block and its doc says
  versions 5-9; `verifySave`, `writeSave` and anything else that branches on the version handle 9.
- Every function in `saves.ts` that reads or writes save bytes is checked against the engine's version-9 reader and
  writer, not just the constant.

### Acceptance criteria

- [ ] A test decodes a version-9 save built byte for byte from the engine's writer (levels, inventory, position as
  for version 8) and verifies its CRC; a version-8 save still decodes and verifies; a version-10 save is refused.
- [ ] The library saves in `conductor/saves/` still pass whatever check `library.ts`/`load.ts` runs on them (run it).
- [ ] No smoke test needs the new engine; say which smoke you ran against the running (old) engine, if any.

## Task 2 — walk.ts follows upstream's walkTo position fix

**Files:** `conductor/actions/walk.ts` (the leg loop, ~:780-820), `conductor/actions/mine.ts` (the header line only),
tests in `conductor/test/actions/`.

- Upstream's walkTo (`sdk/actions.ts`, commit df3d8888a) now updates `pos` after every step; before, a stuck step
  left it stale and the progress check compared against an old position. Our port updates `pos = leg.pos` only on
  non-stuck steps. Read upstream's change and our loop; if our loop has the same defect, port the fix, update the
  "Ported from ... @ <sha>" header to the upstream commit, and pin it with a scripted-world test that fails before
  the fix (a stuck step followed by progress). If it does not (our loop already guards differently), make no code
  change, and say why with line numbers.
- `mine.ts`'s header says `sdk/actions.ts` has no mining method; upstream added `bot.mineRock`. Correct the line (and
  say whether our op is a port of it; it isn't, so say it predates it).

### Acceptance criteria

- [ ] Either the fix, the header and a test that fails without it, or a reasoned no-change with line refs.
- [ ] `bun run test:integration walk-varrock-sewers` and `travel` pass if `walk.ts` changed.

## Task 3 — Webclient types and docs

**Files:** `server/webclient/src/bot/types.ts`, `CLAUDE.md` (the MCP lines, ~:44, ~:139), `learnings/mining.md`.

- Add `combatTargetType?`, `combatTargetIndex?` and `inCombat?` to the webclient `NearbyPlayer`, matching
  `sdk/types.ts` (upstream 54f3e6208 added them to the SDK only); `bun run typecheck:webclient` passes.
- `CLAUDE.md` says MCP `execute_code` "holds the bot only while its code runs". After the merge it connects once and
  keeps the bot's controller lease between calls. Read `mcp/` to state exactly what it holds and when it lets go,
  and correct every line that says otherwise (the One-controller rule and the tools table). Keep the wording short.
- `learnings/mining.md`: upstream's lines say the client names rocks "Rocks copper ore"; ours say every rock is named
  "Rocks" and the ore label is SDK decoration. Read `server/webclient/src/bot/StateCollector.ts` and make it one
  true statement, per the `knowledge` skill (fix in place, provenance tag).

### Acceptance criteria

- [ ] `bun run typecheck:webclient` passes.
- [ ] Every changed doc line is true of the code it describes (cite it in the report).

## Out of scope

- Porting other upstream SDK changes (stale-state refusal, whole-route deadline) beyond Task 2's fix.
- Restarting the stack, running migrations.
