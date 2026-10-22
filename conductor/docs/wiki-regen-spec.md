# Spec: the npc, shop and item pages are built and checked with the world

`bun run world` writes `wiki/world.json` and the places/resources/services/training pages, and `verify:conductor`
(`bun wiki/world/build.ts --check`) fails when any of them is stale. The three older generators are outside that
loop: `wiki/generate-npcs.ts` and `wiki/generate-shops.ts` read world.json (npc Locations, shop Coordinates) but
nothing runs them after a world change, and `wiki/generate-items.ts` (from `server/content` only) was last run on
2026-07-24. On 2026-10-22 a fresh run changed `wiki/npcs/moss-giant.md` (sewer spawns still under Edgeville
Dungeon), left `wiki/shops/` as is, and changed 313 item pages and added 44.

## Decision (user, 2026-10-22)

"Chain + check": `bun run world` runs the three generators too, and verify fails when their pages are stale. The
pages are regenerated and committed in the same change.

## Global rules

- `conductor/` and `wiki/world/` code is formatted and linted (oxfmt, oxlint, warnings denied); finish with
  `bun run verify:conductor`, `bun test wiki/world` and `bun test conductor`.
- Generated files are never hand-edited; they are committed with the code that writes them.
- The generators' output for unchanged input must not change: the only page diffs in the commit are what a plain
  run of today's generators produces on this tree (check it against a run of the old scripts before refactoring).
- `bun run world` stays under ~30 s (the three generators take under a second each today).
- Comment density matches the surrounding code. Members worlds only.

## Task 1 — Generators as functions, chained and checked

**Files:** `wiki/generate-npcs.ts`, `wiki/generate-shops.ts`, `wiki/generate-items.ts`, `wiki/world/build.ts` (the
`import.meta.main` block, ~:1565-1610), `wiki/tsconfig.generators.json`, `package.json` (only if a script must
change), `wiki/world/README.md` (the paragraph on the npc and shop pages, ~:32-35), `CLAUDE.md` (the line naming
what `bun run world` generates, if it changes), tests in `wiki/world/test/`, and the regenerated `wiki/npcs/`,
`wiki/shops/`, `wiki/items/` and `wiki/README.md`.

- Each generator exports a function that returns the files it would write (path relative to the repo root ->
  content) and the pages it would remove (via the same rule as `removeStalePages`, `wiki/world/stale.ts`), without
  touching the disk; its `import.meta.main` block keeps working as a standalone `bun wiki/generate-<x>.ts` that
  writes them.
- npcs and shops take the World in memory (the one `build.ts` just built), not world.json from disk.
- items reads drops from the npc pages today (`generate-items.ts:332-336`, from disk) and may read the shop pages:
  it takes those pages from the npcs/shops step's output instead, so a check sees the fresh ones. Order: npcs,
  shops, items. Any later step of a generator that rewrites another generator's pages (e.g. `generate-npcs.ts`
  ~:1193) is part of that function's output, with the final content.
- The `wiki/README.md` section each generator updates is part of its output.
- `build.ts`: the three generators' files join `files`. Write mode writes them and removes their stale pages
  (reported like the world's); `--check` reports a stale or missing page and a page that would be removed, as for
  the world's own files.
- `tsconfig.generators.json` includes `generate-items.ts` too (typechecked by verify; fix what it flags, or turn off
  only the one flag the file predates, as the config does for the other two).
- Regenerate (`bun run world`) and commit the pages.

### Acceptance criteria

- [ ] `bun run world` regenerates world.json, the world pages and the npc, shop and item pages; a second run
  changes nothing.
- [ ] `bun wiki/world/build.ts --check` fails, naming the file, when an npc, shop or item page is edited, deleted, or
  an extra `.md` is added to their folders; passes on the committed tree.
- [ ] A unit test pins the check on a small fixture (a stale page, a missing page, an extra page), and that items
  reads the npc pages from the in-memory step (not disk).
- [ ] `bun wiki/generate-<x>.ts` alone still writes its pages.
- [ ] The page diff in the commit equals a run of the pre-change generators on the same tree (say how you checked).
- [ ] Docs (`wiki/world/README.md`, `CLAUDE.md` if needed) say what `bun run world` now generates; every claim true.

## Out of scope

- Changing what any page says (formats, columns, wording) beyond what a fresh run of today's generators writes.
- Linting or reformatting the three generators beyond what verify requires.
