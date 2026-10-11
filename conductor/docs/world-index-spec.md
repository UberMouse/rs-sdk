# World Index Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or the repo's `sdd-loop`
> skill) to implement this plan task-by-task.

**Goal:** Build `wiki/world/`, a staged generator that turns the game data into `wiki/world.json`
(every feature, site and area, with correct names, exact tiles and access) and the markdown pages
agents read, per [`world-index.md`](world-index.md).

**Architecture:** Pure parsers (`wiki/world/sources/`) read the map files, packs, configs, dbrows and
script triggers. A rule table classifies placements into features; clustering turns features into
sites; a curated area file names them. `build.ts` runs the stages and writes `world.json`; `render/`
writes markdown from it. Phase 1 is fully specified below; phases 2-3 are outlined at task level and
get their own detailed plan once phase 1 lands (their inputs are phase 1's outputs).

**Tech Stack:** Bun + TypeScript, `bun:test`, oxfmt/oxlint, the SDK's offline collision data
(`conductor/actions/paths.ts` `collisionPaths`).

**Facts the code relies on** (checked 2026-10-11):

- `server/content/maps/m{mx}_{mz}.jm2`: sections `==== MAP ====`, `==== LOC ====`, `==== NPC ====`,
  `==== OBJ ====`. MAP lines `level x z: h30 u48 f2 o5` (tokens; `f<n>` is the tile flag byte).
  LOC lines `level x z: id shape [rotation]`. NPC lines `level x z: id`. World tile:
  `x = 64*mx + localX`, `z = 64*mz + localZ`.
- Bridge (`server/engine/src/engine/GameMap.ts:28,264`): if the **level-1** tile at (x, z) has flag
  bit `0x2`, every **loc** on that column is one level lower; locs that end below 0 are dropped.
  NPC spawns are **not** adjusted (`loadNpcs` takes no land data).
- `pack/{loc,npc,obj}.pack`: lines `id=configname`.
- Configs: `[name]` then `key=value` lines, in `scripts/**/configs/*.{loc,npc,obj}` and
  `scripts/_unpack/<rev>/all.*` (the non-`_unpack` definition wins; see
  `wiki/generate-npcs.ts:708-800` for the existing precedence).
- dbrows: `[row]`, `table=<t>`, repeated `data=<column>,<v1>[,<v2>...]`
  (`skill_woodcutting/configs/trees.dbrow`, `skill_mining/configs/mine.dbrow`).
- Triggers: `[oploc1,name]`, `[oplocu,_category]`, `[opnpc3,_category]`, `[apnpc1,name]`; a leading
  `_` names a category (`category=` in the config). The body runs to the next line starting `[`.
- `maps/free2play.csv` and `maps/multiway.csv`: `level_mx_mz_lx_lz` zone keys (lx, lz multiples of
  8), `//` comments. `maps/labels.txt`: `=Name/With/Slashes,x,z,type` (type 0 small, 1 town,
  2 region).
- The worktree has no `node_modules` until `bun install`.

## Global rules (apply to every task)

- **Scope is phase 1** (Tasks 1-8 below). Phases 2-3 are out of scope for this spec.
- **Code lives in `wiki/world/`**; unit tests in `wiki/world/test/**/*.test.ts` (bun:test), run with
  `bun test wiki/world`. Tests on real game data are named `*.real.test.ts`; they read
  `server/content` and may take a few seconds, but need no server. No test calls `process.exit`.
- **Formatting and lint**: from Task 1, `wiki/world` is under oxfmt + oxlint (warnings denied) and
  `tsc`, via `bun run verify:conductor`. Finish every task with `bun run verify:conductor`,
  `bun test wiki/world` and `bun test conductor` all green.
- **Style**: copy `conductor/` idiom (4-space indent, single quotes, named exports, small pure
  functions). Comments explain why, at the density of `conductor/lib/`; a comment citing the
  engine or a script names the file (and line where it helps).
- **The game is the source of truth.** Classification and facts come from `server/content` (maps,
  packs, configs, dbrows, scripts) and `server/engine/src`, never from name matching or memory. A
  real-data test that fails means find out whether the fact or the code is wrong, then fix that.
- **Do not edit** `server/`, `sdk/`, or `conductor/` code (except `package.json` scripts in
  Task 1). `wiki/items/` is out of scope. `wiki/npcs/` and `wiki/shops/` change only through their
  generators (Task 7). `conductor/lib/banks.ts` and `connectors.ts` are not changed in phase 1.
- **Generated files are committed** (`wiki/world.json`, rendered pages) together with the code that
  generates them, and are never hand-edited.
- **Determinism**: generation output is byte-identical across runs (sorted output, no timestamps,
  no `Date.now()`; `generatedFrom` is a git hash).
- Game knowledge discovered along the way goes in `learnings/` per the `knowledge` skill, not in
  code comments.

---

## Task 1 — Scaffolding and source parsers

Covers 1a-1c below.

### 1a. Scaffolding

**Files:**
- Create: `wiki/world/tsconfig.json`, `wiki/world/types.ts`, `wiki/world/paths.ts`
- Modify: `package.json` (scripts `test`, `fmt`, `fmt:check`, `lint`, `verify:conductor`; add `world`)

**Step 1:** `bun install` at the worktree root. Expected: `node_modules/` exists, githooks enabled.

**Step 2:** `wiki/world/tsconfig.json`:

```json
{
    "extends": "../../tsconfig.json",
    "include": ["./**/*.ts"]
}
```

**Step 3:** `wiki/world/paths.ts`:

```ts
import { join } from 'path';

export const ROOT = join(import.meta.dir, '..', '..');
export const CONTENT = join(ROOT, 'server', 'content');
export const MAPS = join(CONTENT, 'maps');
export const SCRIPTS = join(CONTENT, 'scripts');
export const PACK = join(CONTENT, 'pack');
export const WIKI = join(ROOT, 'wiki');
```

**Step 4:** `wiki/world/types.ts`:

```ts
export interface Tile {
    level: number;
    x: number;
    z: number;
}

export interface Placement {
    source: 'loc' | 'npc';
    id: number;
    config: string;
    tile: Tile;
    /** Locs only. */
    shape?: number;
    rotation?: number;
}

export type FeatureKind =
    | 'tree' | 'rock' | 'fishing-spot'
    | 'bank' | 'shop'
    | 'furnace' | 'anvil' | 'range' | 'fire' | 'spinning-wheel' | 'pottery-wheel' | 'pottery-oven'
    | 'sand-pit' | 'water-source' | 'altar' | 'rc-altar' | 'rc-ruins'
    | 'stall' | 'thieving-chest' | 'pickpocket'
    | 'npc' | 'connector';

export interface Feature extends Placement {
    kind: FeatureKind;
    /** `yew`, `iron`, `freshfish`, a shop name, an npc config; `''` when the kind has none. */
    subtype: string;
    /** The in-game name. */
    name: string;
}

export interface Rect {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    /** Omitted: every level. */
    level?: number;
}

export interface Area {
    id: string;
    name: string;
    parent?: string;
    rects: Rect[];
    requires?: string[];
    notes?: string;
}

export interface Site {
    id: string;
    kind: FeatureKind;
    /** Area ids from the root to the deepest containing area; empty when none contains it. */
    areaPath: string[];
    centre: Tile;
    bbox: Rect;
    stand: Tile | null;
    counts: Record<string, number>;
    /** Indexes into World.features. */
    features: number[];
    f2p: boolean;
    multiway: boolean;
    wildernessLevel: number;
}

export interface World {
    generatedFrom: string;
    areas: Area[];
    features: Feature[];
    sites: Site[];
}
```

**Step 5:** In `package.json`, append `wiki/world` to the `test` script's path list; change
`fmt`/`fmt:check` globs to `'{conductor,wiki/world}/**/*.ts'`; `lint` to
`oxlint --deny-warnings conductor wiki/world`; `verify:conductor` to also run
`tsc --noEmit -p wiki/world`; add `"world": "bun wiki/world/build.ts"`.

**Step 6:** Run `bun run verify:conductor`. Expected: PASS (no world code yet besides types).

**Step 7:** Commit `feat(world): scaffolding for the world index generator`.

### 1b. Map parser with the bridge rule

**Files:**
- Create: `wiki/world/sources/maps.ts`, `wiki/world/test/maps.test.ts`

**Step 1: Failing test** (`wiki/world/test/maps.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import { parseMapSquare } from '../sources/maps';

const square = `==== MAP ====
1 5 6: h16 o5 f2
1 7 7: h16
==== LOC ====
1 5 6: 2213 10 1
1 7 7: 2213 10
0 1 2: 1276 10 3
==== NPC ====
1 5 6: 494
0 3 4: 1036
`;

describe('parseMapSquare', () => {
    const { locs, npcs } = parseMapSquare(54, 54, square);

    test('world coordinates from the square and local tile', () => {
        expect(locs).toContainEqual({ id: 1276, shape: 10, rotation: 3, tile: { level: 0, x: 3457, z: 3458 } });
        expect(npcs).toContainEqual({ id: 1036, tile: { level: 0, x: 3459, z: 3460 } });
    });

    test('a loc on a bridged column drops one level; one on an unbridged column does not', () => {
        expect(locs).toContainEqual({ id: 2213, shape: 10, rotation: 1, tile: { level: 0, x: 3461, z: 3462 } });
        expect(locs).toContainEqual({ id: 2213, shape: 10, rotation: 0, tile: { level: 1, x: 3463, z: 3463 } });
    });

    test('npc spawns keep their level on a bridged column (GameMap.loadNpcs)', () => {
        expect(npcs).toContainEqual({ id: 494, tile: { level: 1, x: 3461, z: 3462 } });
    });
});
```

**Step 2:** `bun test wiki/world/test/maps.test.ts`. Expected: FAIL, cannot find `../sources/maps`.

**Step 3: Implement** `wiki/world/sources/maps.ts`:

```ts
// Reads server/content/maps/m{mx}_{mz}.jm2. The bridge rule mirrors GameMap.loadLocations: a loc whose
// column has the LINK_BELOW flag (0x2) on its level-1 tile sits one level lower; npc spawns do not move.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { MAPS } from '../paths';
import type { Tile } from '../types';

const LINK_BELOW = 0x2;

export interface MapLoc {
    id: number;
    shape: number;
    rotation: number;
    tile: Tile;
}

export interface MapNpc {
    id: number;
    tile: Tile;
}

export function parseMapSquare(mx: number, mz: number, text: string): { locs: MapLoc[]; npcs: MapNpc[] } {
    const bridged = new Set<number>(); // localX * 64 + localZ
    const rawLocs: MapLoc[] = [];
    const npcs: MapNpc[] = [];
    let section = '';
    for (const line of text.split('\n')) {
        const header = line.match(/^==== (\w+) ====/);
        if (header) {
            section = header[1];
            continue;
        }
        const m = line.match(/^(\d+) (\d+) (\d+):\s*(.*)$/);
        if (!m) continue;
        const [level, lx, lz] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const rest = m[4].trim().split(/\s+/);
        const tile = { level, x: mx * 64 + lx, z: mz * 64 + lz };
        if (section === 'MAP' && level === 1) {
            const flag = rest.find((t) => t.startsWith('f'));
            if (flag && (Number(flag.slice(1)) & LINK_BELOW) !== 0) bridged.add(lx * 64 + lz);
        } else if (section === 'LOC') {
            rawLocs.push({ id: Number(rest[0]), shape: Number(rest[1] ?? 10), rotation: Number(rest[2] ?? 0), tile });
        } else if (section === 'NPC') {
            npcs.push({ id: Number(rest[0]), tile });
        }
    }
    const locs: MapLoc[] = [];
    for (const loc of rawLocs) {
        const local = (loc.tile.x - mx * 64) * 64 + (loc.tile.z - mz * 64);
        const level = bridged.has(local) ? loc.tile.level - 1 : loc.tile.level;
        if (level < 0) continue;
        locs.push({ ...loc, tile: { ...loc.tile, level } });
    }
    return { locs, npcs };
}

export function readAllMapSquares(dir = MAPS): { locs: MapLoc[]; npcs: MapNpc[] } {
    const locs: MapLoc[] = [];
    const npcs: MapNpc[] = [];
    for (const file of readdirSync(dir).sort()) {
        const m = file.match(/^m(\d+)_(\d+)\.jm2$/);
        if (!m) continue;
        const parsed = parseMapSquare(Number(m[1]), Number(m[2]), readFileSync(join(dir, file), 'utf8'));
        locs.push(...parsed.locs);
        npcs.push(...parsed.npcs);
    }
    return { locs, npcs };
}
```

**Step 4:** Run the test. Expected: PASS.

**Step 5:** Commit `feat(world): map square parser with the bridge rule`.

### 1c. Packs, configs, dbrows

**Files:**
- Create: `wiki/world/sources/packs.ts`, `wiki/world/sources/configs.ts`, `wiki/world/sources/dbrows.ts`
- Test: `wiki/world/test/sources.test.ts`

**Step 1: Failing tests:**

```ts
import { describe, expect, test } from 'bun:test';
import { parseConfigs } from '../sources/configs';
import { parseDbrows } from '../sources/dbrows';
import { parsePack } from '../sources/packs';

describe('parsePack', () => {
    test('id=name lines both ways', () => {
        const p = parsePack('2213=bankbooth\n2214=loc_2214\n');
        expect(p.name.get(2213)).toBe('bankbooth');
        expect(p.id.get('loc_2214')).toBe(2214);
    });
});

describe('parseConfigs', () => {
    test('repeated keys collect; the block runs to the next header', () => {
        const c = parseConfigs('[bankbooth]\nname=Bank booth\nop1=Use\nop2=Use-quickly\n\n[x]\nname=X\n');
        expect(c.get('bankbooth')).toEqual({ name: ['Bank booth'], op1: ['Use'], op2: ['Use-quickly'] });
        expect(c.get('x')?.name).toEqual(['X']);
    });
});

describe('parseDbrows', () => {
    test('rows keep their table and each data line', () => {
        const rows = parseDbrows('[yew_tree_table]\ntable=woodcutting_trees\ndata=tree,yewtree\ndata=levelrequired,60\ndata=successchance,bronze_axe,4,12\n');
        expect(rows).toEqual([
            {
                row: 'yew_tree_table',
                table: 'woodcutting_trees',
                data: { tree: [['yewtree']], levelrequired: [['60']], successchance: [['bronze_axe', '4', '12']] },
            },
        ]);
    });
});
```

**Step 2:** Run. Expected: FAIL (modules missing).

**Step 3: Implement.**

`sources/packs.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PACK } from '../paths';

export interface Pack {
    name: Map<number, string>;
    id: Map<string, number>;
}

export function parsePack(text: string): Pack {
    const name = new Map<number, string>();
    const id = new Map<string, number>();
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const n = Number(line.slice(0, eq));
        const s = line.slice(eq + 1).trim();
        name.set(n, s);
        id.set(s, n);
    }
    return { name, id };
}

export const readPack = (kind: 'loc' | 'npc' | 'obj'): Pack => parsePack(readFileSync(join(PACK, `${kind}.pack`), 'utf8'));
```

`sources/configs.ts`:

```ts
// INI-style configs (.loc/.npc/.obj): `[name]` then `key=value`. A key may repeat (data=, param=).
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export type Config = Record<string, string[]>;

export function parseConfigs(text: string): Map<string, Config> {
    const out = new Map<string, Config>();
    let cur: Config | undefined;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            cur = {};
            out.set(header[1], cur);
            continue;
        }
        if (!cur || !line || line.startsWith('//')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        (cur[line.slice(0, eq)] ??= []).push(line.slice(eq + 1));
    }
    return out;
}

/** Every config of a kind: the `_unpack` dumps first, then the hand-written configs override them. */
export function readConfigs(ext: 'loc' | 'npc' | 'obj'): Map<string, Config> {
    const files = [...new Glob(`**/*.${ext}`).scanSync(SCRIPTS)].sort();
    const unpacked = files.filter((f) => f.startsWith('_unpack/'));
    const written = files.filter((f) => !f.startsWith('_unpack/') && !f.startsWith('_test/'));
    const out = new Map<string, Config>();
    for (const f of [...unpacked, ...written])
        for (const [k, v] of parseConfigs(readFileSync(join(SCRIPTS, f), 'utf8'))) out.set(k, v);
    return out;
}

export const first = (c: Config | undefined, key: string): string | undefined => c?.[key]?.[0];
```

Before relying on `readConfigs`, check that "hand-written overrides the dump" matches
`wiki/generate-npcs.ts:708-800`; if that generator merges keys instead of replacing blocks, copy its
rule and add a test for it.

`sources/dbrows.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface DbRow {
    row: string;
    table: string;
    data: Record<string, string[][]>;
}

export function parseDbrows(text: string): DbRow[] {
    const rows: DbRow[] = [];
    let cur: DbRow | undefined;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            cur = { row: header[1], table: '', data: {} };
            rows.push(cur);
        } else if (cur && line.startsWith('table=')) {
            cur.table = line.slice(6);
        } else if (cur && line.startsWith('data=')) {
            const [col, ...vals] = line.slice(5).split(',');
            (cur.data[col] ??= []).push(vals);
        }
    }
    return rows;
}

export function readDbrows(): DbRow[] {
    return [...new Glob('**/*.dbrow').scanSync(SCRIPTS)]
        .filter((f) => !f.startsWith('_test/'))
        .sort()
        .flatMap((f) => parseDbrows(readFileSync(join(SCRIPTS, f), 'utf8')));
}
```

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `feat(world): pack, config and dbrow parsers`.

### Acceptance criteria

- [ ] `wiki/world/{tsconfig.json,paths.ts,types.ts}` exist as specified; `package.json` scripts
      `test`, `fmt`, `fmt:check`, `lint`, `verify:conductor` cover `wiki/world`, and `world` runs
      `wiki/world/build.ts` (the file may not exist until Task 5).
- [ ] `parseMapSquare` applies the bridge rule to locs only (level-1 tile flag `& 0x2`), drops
      locs that would go below level 0, keeps npc levels; tests pin all three plus world coords.
- [ ] `parsePack`, `parseConfigs` (repeated keys collected, `//` comments skipped), `parseDbrows`
      tested as specified.
- [ ] `readConfigs` reads the `_unpack` dumps and the hand-written configs and **throws on a
      duplicate config name**, as the engine packer does (`PackShared.ts`, `Duplicate config
      found`); tested. (**Assumption**, settled in review: the packer refuses duplicates, so no
      precedence rule is needed; the earlier "hand-written overrides" wording is superseded.)
- [ ] `parseDbrows` splits `data=` values on commas outside double quotes and strips the quotes
      (42 real lines are quoted); tested.
- [ ] A real-data test reads every map square and finds the Canifis booths (`bankbooth`, id
      2213, near (3513, 3480)) on level 0.
- [ ] Out of scope: classification, clustering, any output file.

---

## Task 2 — Trigger index and classification

Covers 2a-2b below.

### 2a. Trigger index

What makes a loc or NPC usable is the script trigger on it. Index every op trigger with its
script path and body, so classification rules can ask "which script handles `[oplocu,_anvil]`" and
"does this body reach `@openbank`".

**Files:**
- Create: `wiki/world/sources/triggers.ts`
- Test: `wiki/world/test/triggers.test.ts`

**Step 1: Failing test:**

```ts
import { describe, expect, test } from 'bun:test';
import { parseTriggers } from '../sources/triggers';

const rs2 = `[oploc1,bankbooth]
def_npc $n = npc_find(coord, _bank_teller, 1);
@openbank;

[oploc2,bankbooth] @openbank;
[opnpc3,_bank_teller]
@openbank;
[label,openbank]
if_openmain(bank_main);
`;

describe('parseTriggers', () => {
    const t = parseTriggers('interface_bank/scripts/bank_booth.rs2', rs2);

    test('op triggers on names and categories, with bodies', () => {
        expect(t.map((x) => [x.on, x.op, x.target, x.category])).toEqual([
            ['loc', '1', 'bankbooth', false],
            ['loc', '2', 'bankbooth', false],
            ['npc', '3', 'bank_teller', true],
        ]);
        expect(t[0].body).toContain('@openbank');
        expect(t[1].body).toContain('@openbank');
    });

    test('labels and procs are not op triggers', () => {
        expect(t.some((x) => x.target === 'openbank')).toBe(false);
    });
});
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implement** `sources/triggers.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface Trigger {
    file: string;
    on: 'loc' | 'npc';
    /** '1'-'5', or 'u' for use-item-on. */
    op: string;
    /** Config or category name, without the category's leading underscore. */
    target: string;
    category: boolean;
    /** The header line's tail and every line up to the next `[` header. */
    body: string;
}

const HEADER = /^\[(?:op|ap)(loc|npc)([1-5u]),(_?)([a-z0-9_]+)\](.*)$/;

export function parseTriggers(file: string, text: string): Trigger[] {
    const out: Trigger[] = [];
    let cur: Trigger | undefined;
    for (const line of text.split('\n')) {
        if (line.startsWith('[')) {
            const m = line.match(HEADER);
            cur = m ? { file, on: m[1] as 'loc' | 'npc', op: m[2], category: m[3] === '_', target: m[4], body: m[5] } : undefined;
            if (cur) out.push(cur);
        } else if (cur) {
            cur.body += '\n' + line;
        }
    }
    return out;
}

export function readTriggers(): Trigger[] {
    return [...new Glob('**/*.rs2').scanSync(SCRIPTS)]
        .filter((f) => !f.startsWith('_test/') && !f.startsWith('_unpack/'))
        .sort()
        .flatMap((f) => parseTriggers(f, readFileSync(join(SCRIPTS, f), 'utf8')));
}
```

Note: `oploc` and `aploc` both count; one placement often has both, and rules dedupe by target.

**Step 4:** Run. Expected: PASS.

**Step 5:** Commit `feat(world): index of loc and npc op triggers`.

### 2b. Classification rules

**Files:**
- Create: `wiki/world/classify.ts`
- Test: `wiki/world/test/classify.test.ts` (scripted inputs) and `wiki/world/test/classify.real.test.ts`
  (real data; see Task 5)

A placement's config name and its config's `category` are matched against the trigger index and
the dbrows. Each rule returns `{ kind, subtype, ops } | null` (`ops`: the op slots whose triggers made the match). A
config may have several kinds when **each has an op of its own** (`duel_fadli`: op3 bank, op4
shop; its op1 dialogue offers both, and a shared dialogue op is allowed), so `classifier` returns
`Classified[]` and a placement becomes one feature per kind. Data matches (dbrow, category) report
the ops of the config's triggers, else `'*'`, which clashes with everything. Two rules where either
has no op of its own is a build
error (it means a rule is too broad); no rule matching means "not a feature" (scenery).

**Rules (in this order; each a small named function in `classify.ts`):**

| Kind | Matches | Subtype |
|---|---|---|
| `tree` | loc listed in a `woodcutting_trees` row's `tree` column | row name minus `_tree_table`/`_table` (`yew`, `normal`, `oak`) |
| `rock` | loc in a `mining_table` row's `rock` column | `ore_name` |
| `fishing-spot` | npc (or loc) whose name or category has an op trigger under `skill_fishing/scripts/fishing_spots/` (not `fishing_guild.rs2`'s shop and quest npcs) | category (`saltfish`, `freshfish`, `memberfish`, `rarefish`, ...), else the config name |
| `bank` | loc or npc with an op trigger that reaches `@openbank` (its body, or a label/proc it calls, one level deep; label and proc names are global), or `category=bank_teller` npc | `booth`, `chest` or `banker` by source and name |
| `shop` | loc or npc with an op trigger that reaches `~openshop(<inv>, ...)` or `~openshop_activenpc` (the npc's `param=owned_shop`, as `wiki/generate-shops.ts` reads it) | the shop inv (`owned_shop`, else the first explicit inv) |
| `tanner` | npc with an op trigger that reaches the tanning interface (`[label,tan_leather_choices]`) | `''` |
| `furnace`, `anvil`, `range`, `fire`, `spinning-wheel`, `pottery-wheel`, `pottery-oven`, `sand-pit`, `water-source`, `altar`, `rc-altar`, `rc-ruins` | loc whose category is `smithing_furnace`, `anvil`, `cooking_oven`, `cooking_fire`, `spinning_wheel`, `potters_wheel`, `pottery_oven`, `sand_pit`, `watersource`, `prayer_altar`, `rc_altar`, `rc_ruins` | `''` (`rc-altar`/`rc-ruins`: the rune, from the loc's `param=rune_type` via `runecraft_table`, as `runecraft.rs2 ~get_runecraft_data` does) |
| `stall` | loc with an `oploc` trigger under `skill_thieving/scripts/stalls/` | loc name |
| `thieving-chest` | loc with an `oploc` trigger under `skill_thieving/scripts/chest/` (not the locked doors in `doors/`) | loc name |
| `pickpocket` | npc (or category) with an `opnpc` trigger under `skill_thieving/` | npc config |
| `connector` | loc with an op trigger under `ladders+stairs/` | `''` |
| `npc` | any other npc whose config has an `Attack` op and combat stats (reuse `hasCombatStats` from `wiki/generate-npcs.ts:680`) | npc config |

Check the `cooking_oven` category is the range category (grep `skill_cooking/scripts` for
`_cooking_oven`), and find the tanner: grep for the tanning interface trigger; add a `tanner` kind
only if a trigger exists, otherwise leave it for the shop rule.

**Step 1: Failing test** (scripted, no game data):

```ts
import { describe, expect, test } from 'bun:test';
import { classifier } from '../classify';
import type { Trigger } from '../sources/triggers';

const trig = (file: string, on: 'loc' | 'npc', target: string, body = '', category = false): Trigger => ({ file, on, op: '1', target, category, body });

const c = classifier({
    locConfigs: new Map([
        ['yewtree', { name: ['Yew'] }],
        ['bankbooth', { name: ['Bank booth'] }],
        ['furnace1', { name: ['Furnace'], category: ['smithing_furnace'] }],
        ['tree_stump', { name: ['Tree stump'] }],
    ]),
    npcConfigs: new Map([
        ['banker1', { name: ['Banker'], category: ['bank_teller'] }],
        ['fishspot', { name: ['Fishing spot'], category: ['saltfish'] }],
    ]),
    dbrows: [{ row: 'yew_tree_table', table: 'woodcutting_trees', data: { tree: [['yewtree']] } }],
    triggers: [
        trig('interface_bank/scripts/bank_booth.rs2', 'loc', 'bankbooth', '\n@openbank;'),
        trig('skill_fishing/scripts/fish.rs2', 'npc', 'saltfish', '', true),
    ],
});

describe('classifier', () => {
    test('a tree from its dbrow', () => expect(c('loc', 'yewtree')).toEqual({ kind: 'tree', subtype: 'yew', name: 'Yew' }));
    test('a booth whose op reaches @openbank', () => expect(c('loc', 'bankbooth')?.kind).toBe('bank'));
    test('a banker by category', () => expect(c('npc', 'banker1')).toEqual({ kind: 'bank', subtype: 'banker', name: 'Banker' }));
    test('a furnace by category', () => expect(c('loc', 'furnace1')?.kind).toBe('furnace'));
    test('a fishing spot by category trigger', () => expect(c('npc', 'fishspot')).toEqual({ kind: 'fishing-spot', subtype: 'saltfish', name: 'Fishing spot' }));
    test('scenery is not a feature', () => expect(c('loc', 'tree_stump')).toBeNull());
});
```

**Step 2:** Run. Expected: FAIL.

**Step 3: Implement** `classify.ts`. Shape:

```ts
import type { Config } from './sources/configs';
import { first } from './sources/configs';
import type { DbRow } from './sources/dbrows';
import type { Trigger } from './sources/triggers';
import type { FeatureKind } from './types';

export interface ClassifyInput {
    locConfigs: Map<string, Config>;
    npcConfigs: Map<string, Config>;
    dbrows: DbRow[];
    triggers: Trigger[];
}

export interface Classified {
    kind: FeatureKind;
    subtype: string;
    name: string;
}

type Rule = (on: 'loc' | 'npc', config: string, cfg: Config) => Omit<Classified, 'name'> | null;

export function classifier(input: ClassifyInput): (on: 'loc' | 'npc', config: string) => Classified | null {
    // Precompute lookups once: dbrow loc -> row, triggers by (on, target), label bodies per file.
    // ...one function per row of the rule table above...
    const rules: [string, Rule][] = [/* ['tree', treeRule], ['rock', rockRule], ... */];
    const cache = new Map<string, Classified | null>();
    return (on, config) => {
        const key = `${on}:${config}`;
        if (cache.has(key)) return cache.get(key)!;
        const cfg = (on === 'loc' ? input.locConfigs : input.npcConfigs).get(config) ?? {};
        const hits = rules.map(([n, r]) => [n, r(on, config, cfg)] as const).filter(([, r]) => r);
        if (hits.length > 1) throw new Error(`${key} matches rules ${hits.map(([n]) => n).join(', ')}`);
        const hit = hits[0]?.[1];
        const out = hit ? { ...hit, name: first(cfg, 'name') ?? config } : null;
        cache.set(key, out);
        return out;
    };
}
```

For the `@openbank` "via a label" case: build, per file, the set of labels whose body contains
`@openbank`; a trigger body containing `@<thatlabel>` counts (one level deep is enough for
`bank_booth.rs2`, `banker.rs2`, `fadli.rs2`, `misc_banker.rs2`, `gundai.rs2`, `shantay*.rs2`).

**Step 4:** Run. Expected: PASS. Add a test per rule you implemented beyond the six above.

**Step 5:** Commit `feat(world): classify placements by the triggers and dbrows that use them`.

### Acceptance criteria

- [ ] `parseTriggers` indexes `op`/`ap` loc/npc triggers (ops 1-5 and `u`), names and categories,
      bodies to the next header; labels/procs/queues are not triggers; tested.
- [ ] `classifier` returns `Classified[]`: kinds coexist when each has an op of its own
      (`duel_fadli` -> bank and shop, tested on real data, and the only multi-kind config); two
      rules where either has no op of its own throw naming both; scenery returns `[]`. One scripted test per rule (positive) plus the
      scenery negative.
- [ ] `@openbank` (and the shop/tanner targets) are detected directly and one label/proc call
      deep; tested.
- [ ] A real-data test (`classify.real.test.ts`) classifies, from the real configs/dbrows/
      triggers: `bankbooth` bank, `bankboothclosed` and `loc_2214` not banks, `yewtree` tree/yew,
      a `mining_table` iron rock rock/iron, `banker1` bank/banker, `duel_fadli` bank,
      `magearena_banker` bank, a furnace, an anvil, a range (`cooking_oven` category), and every
      loc/npc in the real data classifies without a two-rule error.
- [ ] The two checks the rule table asks for (range category; tanner trigger) are done, and the
      outcome is in the code (a `tanner` kind only if a trigger exists).
- [ ] Out of scope: placement, clustering, areas.

---

## Task 3 — Zones and areas

Covers 3a-3b below. Step 5 of 3b (curation) belongs to Task 5, not here: this task lands the
resolver, the seed tool and a seeded, lightly-corrected `areas.ts`.

### 3a. Zones (F2P, multiway, Wilderness)

**Files:**
- Create: `wiki/world/sources/zones.ts`; Test: `wiki/world/test/zones.test.ts`

**Step 1: Failing test:**

```ts
import { describe, expect, test } from 'bun:test';
import { parseZoneCsv, wildernessLevel, zoneKey } from '../sources/zones';

describe('zones', () => {
    test('a tile maps to its 8x8 zone key', () => expect(zoneKey({ level: 0, x: 3209, z: 3220 })).toBe('0_50_50_8_16'));
    test('csv keys, comments skipped', () => {
        const z = parseZoneCsv('// haunted mine\n0_43_69_0_0\n');
        expect(z.has('0_43_69_0_0')).toBe(true);
        expect(z.size).toBe(1);
    });
    test('wilderness level', () => {
        expect(wildernessLevel({ level: 0, x: 3100, z: 3519 })).toBe(0);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3520 })).toBe(1);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3903 })).toBe(48);
    });
});
```

The Wilderness formula: confirm against the engine before coding. Grep
`server/content/scripts` for the wilderness level proc (`~wilderness_level` or
`inzone(...3520...)`) and `conductor/lib/wilderness.ts`; use the same bounds (x range included) and
formula, and adjust the test's expectations to match it. Underground Wilderness (z + 6400) counts.

**Step 3: Implement** `zoneKey = (t) => \`${t.level}_${t.x >> 6}_${t.z >> 6}_${t.x & 56}_${t.z & 56}\``
(`& 56` = the zone origin, multiple of 8, within the square), `parseZoneCsv`, `readZones()` returning
`{ f2p, multiway }`, and `wildernessLevel` per the engine.

**Step 4:** Run. Expected: PASS. **Step 5:** Commit `feat(world): f2p, multiway and wilderness zones`.

### 3b. Areas: resolver, seed draft, curation

**Files:**
- Create: `wiki/world/areas.ts` (curated data), `wiki/world/area-resolve.ts`,
  `wiki/world/tools/seed-areas.ts`
- Test: `wiki/world/test/area-resolve.test.ts`

**Step 1: Failing test** for the resolver (deepest, then smallest, containing area wins; level
filter; underground rects are ordinary rects at z + 6400):

```ts
import { describe, expect, test } from 'bun:test';
import { areaResolver } from '../area-resolve';
import type { Area } from '../types';

const areas: Area[] = [
    { id: 'misthalin', name: 'Misthalin', rects: [{ x1: 3072, z1: 3136, x2: 3391, z2: 3519 }] },
    { id: 'varrock', name: 'Varrock', parent: 'misthalin', rects: [{ x1: 3172, z1: 3372, x2: 3295, z2: 3505 }] },
    { id: 'varrock-west-bank', name: 'Varrock West bank', parent: 'varrock', rects: [{ x1: 3180, z1: 3433, x2: 3191, z2: 3447, level: 0 }] },
];

describe('areaResolver', () => {
    const resolve = areaResolver(areas);
    test('deepest containing area, as a path', () => expect(resolve({ level: 0, x: 3186, z: 3440 })).toEqual(['misthalin', 'varrock', 'varrock-west-bank']));
    test('a level-restricted rect does not hold other levels', () => expect(resolve({ level: 1, x: 3186, z: 3440 })).toEqual(['misthalin', 'varrock']));
    test('outside every area', () => expect(resolve({ level: 0, x: 10, z: 10 })).toEqual([]));
    test('a child rect outside its parent is a build error', () =>
        expect(() => areaResolver([...areas, { id: 'bad', name: 'Bad', parent: 'varrock', rects: [{ x1: 0, z1: 0, x2: 5, z2: 5 }] }])).toThrow(/bad/));
});
```

**Step 2:** Run, FAIL. **Step 3:** Implement `areaResolver(areas)`: validates ids unique, parents
exist, each child rect inside the union of its parent's rects; returns a function giving the path
of the deepest area containing the tile (ties: smallest total rect area).

**Step 4:** `tools/seed-areas.ts`: prints a draft `areas.ts` from `maps/labels.txt`: type-2 labels
become region areas, types 1 and 0 town/place areas with a 48x48 / 24x24 rect around the label,
parented to the nearest region. The draft is a starting point only.

**Step 5: Curate** `wiki/world/areas.ts` from the seed. Required before Task 5 can pass:
- Every site of kind `bank`, `shop`, `tree`, `rock`, `fishing-spot`, any service kind, `stall`,
  `pickpocket` lies in an area (Task 5's coverage report lists the ones that don't).
- Each bank site gets its own leaf area with its common name (`Varrock West bank`, `Draynor bank`,
  `Falador East bank`, `Ardougne North bank`, `Zanaris bank`, `Mage Arena bank`, `Duel Arena
  bank chest`, ...). Use the 25 bank sites in `world-index.md` "Why" as the checklist.
- Mines, fishing spots and tree groups that agents name (`Varrock West mine`, `Varrock East mine`,
  `Al Kharid mine`, `Dwarven Mine`, `Barbarian Village fishing`, `Draynor willows`, ...) get leaf
  areas; check `learnings/` and `wiki/skills/` for names already in use and match them.
- Underground areas are their own top-level areas at z + 6400, with `notes` naming the surface
  entrance.
- Use `bun conductor/tools/screenshot.ts` on a worker only if a name cannot be settled from the
  data; most can from `labels.txt`, shop names and NPC names.

**Step 6:** Run the resolver test and `bun run verify:conductor`. Commit
`feat(world): curated areas and their resolver`.

### Acceptance criteria

- [ ] `zoneKey`, `parseZoneCsv`, `readZones`, `wildernessLevel` as specified; the Wilderness
      formula and bounds match the engine's (the file and line cited in a comment), tests match it.
- [ ] `areaResolver` validates (unique ids, parents exist, child rects inside the parent's union)
      and resolves the deepest, then smallest, containing area as a path; the four tests pass.
- [ ] `tools/seed-areas.ts` prints a draft from `labels.txt`; `areas.ts` is that draft with the
      label names cleaned (`/` -> space) and any obviously wrong parenting fixed; it passes the
      resolver's validation.
- [ ] Out of scope: coverage curation (Task 5), sites.

---

## Task 4 — Sites: clustering, stand tiles, flags

**Files:**
- Create: `wiki/world/place.ts`; Test: `wiki/world/test/place.test.ts`

**Clustering:** features of the same `kind` on the same level, single-linkage within a per-kind
radius (`bank` 10, `shop` 6, `tree` 8, `rock` 8, `fishing-spot` 8, service kinds 4, `stall` 6,
`pickpocket` 8, `npc` 6, `connector` 0 = every connector its own site), and split by area path (a
site never spans two leaf areas). Site id: `${kind}:${leafAreaId || 'unnamed'}:${n}` with `n` the
index within that area by (x, z) order, so ids are stable across runs.

**Stand tile** (as settled in Task 4): candidates are walkable tiles around each loc's rotated
footprint from which the engine's own reach test passes (`rsmod.reached`, called as
`GameMap.reachedLoc`/`Player.ts` do, with the loc's width, length, shape, angle and
`forceapproach`); for a bank with bankers, prefer candidates on the side facing away from the
bankers (side direction against the vector from the locs' mean to the bankers' mean; the original
"largest distance to the nearest banker" picks the wrong tile on a long row); otherwise the
candidate nearest the site centre (ties: lower x, then z). NPC-only sites (fishing spots,
pickpocket and combat npcs, bankers without booths): the walkable tile nearest the centre within
the bbox **grown by one tile** (an npc op is used from an adjacent tile; fishing spots stand in
water). `null` if none (logged). `thieving-chest` radius: 6.

**Step 1: Failing tests** (synthetic features; stub the pathfinder with an interface
`{ walkable, canStep }` passed in, so tests need no collision data):
- two booths 1 tile apart and a banker 2 tiles away form one `bank` site with counts
  `{ booth: 2, banker: 1 }`;
- two trees 20 tiles apart form two sites;
- features in two different leaf areas never share a site;
- the stand tile of a booth row is on the side opposite the bankers;
- ids are stable when input order changes.

**Step 2:** Run, FAIL. **Step 3:** Implement `buildSites(features, resolve, zones, pathfinder)`.
**Step 4:** PASS. **Step 5:** Commit `feat(world): cluster features into sites with stand tiles`.

### Acceptance criteria

- [ ] `buildSites(features, resolve, zones, pathfinder)` clusters per kind and level with the
      radii given, never across leaf areas; ids are stable and input-order independent.
- [ ] Sites carry `areaPath`, `centre`, `bbox`, `stand`, `counts`, `features`, `f2p`,
      `multiway`, `wildernessLevel` (F2P/multiway: any feature tile's zone in the csv).
- [ ] Stand tiles follow the rule given (engine reach test for locs; bank: side away from
      bankers; else nearest the centre; npc-only: walkable nearest the centre in the bbox grown
      by one tile; else `null`).
- [ ] The five tests listed pass with a stubbed pathfinder; production uses
      `conductor/actions/paths.ts` `collisionPaths`.
- [ ] Out of scope: writing `world.json`, rendering.

---

## Task 5 — Build pipeline, area curation, world.json and real-data facts

Includes Task 3b Step 5 (curating `areas.ts` until coverage is clean).

### 5a. Build pipeline

**Files:**
- Create: `wiki/world/build.ts`, `wiki/world/load.ts` (reads `wiki/world.json` typed)
- Test: `wiki/world/test/world.real.test.ts`
- Generated: `wiki/world.json`

**`build.ts`:** `readAllMapSquares` -> packs -> configs -> dbrows -> triggers -> `classifier` ->
features (one per classified placement; drop `npc`-kind spawns with no combat stats) ->
`buildSites` -> write `wiki/world.json`, then print a report:
- counts per kind;
- **coverage**: sites of the required kinds (Task 3b Step 5) outside every area; exit 1 if any;
- `npc` sites outside every area (warning only);
- placements whose config is missing from the pack (warning).

Write `world.json` deterministically: features sorted by (kind, x, z, level, config); sites by id;
two-space JSON, one feature per line (custom serializer) so diffs stay readable. Record the git hash
of `server/content` in `generatedFrom`.

**Real-data facts** (`world.real.test.ts`, runs `build` in memory once, `beforeAll`):

```ts
test('Varrock West bank: 6 booths, 6 bankers, level 0', ...);
test('Lumbridge has no bank site', ...);            // no bank site with an area path containing 'lumbridge'
test('Canifis bank is one site on level 0 with 4 booths and 2 bankers', ...);
test('both Gnome Stronghold banks are on level 1', ...);
test('25 bank sites, Shantay chest excluded or flagged', ...);  // match the list in world-index.md
test('closed and private booths are not banks', ...); // bankboothclosed, loc_2214
test('every banks.ts stand tile is within 2 tiles of a generated bank stand tile', ...); // conductor/lib/banks.ts
test('yew trees exist and every tree site has a subtype from trees.dbrow', ...);
test('Varrock East mine has tin, copper rocks and no iron', ...);   // confirm against learnings/mining.md
test('every shop page in wiki/shops has at least one shop site', ...);
```

Fill in each body against the data; if a fact fails, find out whether the fact or the code is wrong
before changing either (the game is the source of truth; see CLAUDE.md).

**Step:** `bun run world` until the coverage report is clean (curating `areas.ts` as needed), then
`bun test wiki/world`, `bun run verify:conductor`. Commit `feat(world): build world.json` (code,
`areas.ts` changes and `wiki/world.json` together).

### Acceptance criteria

- [ ] `bun run world` writes `wiki/world.json` deterministically (two runs, identical bytes) and
      prints the report described; it exits 1 on a coverage gap and 0 now.
- [ ] `wiki/world/load.ts` returns a typed `World` from `wiki/world.json`.
- [ ] `areas.ts` is curated per Task 3b Step 5: every required-kind site is in an area; all 25
      bank sites from `world-index.md` have leaf areas with their common names; names already used
      in `learnings/` and `wiki/skills/` are matched.
- [ ] Every real-data fact listed is a passing test with a real body (no `todo`); any fact that
      turned out wrong is corrected in the test with a comment citing the data that settled it.
- [ ] `wiki/world.json` committed with the code.
- [ ] Out of scope: markdown pages.

---

## Task 6 — Render places, resources and services pages

**Files:**
- Create: `wiki/world/render/places.ts`, `render/resources.ts`, `render/services.ts`,
  `render/common.ts`; `wiki/world/render.ts` (entry)
- Test: `wiki/world/test/render.test.ts` (snapshot of each page kind for a tiny synthetic World)
- Generated: `wiki/places/**`, `wiki/resources/**`, `wiki/services/**`

Page shapes (all tables sorted for stable output; coordinates as `(x, z)` with ` L<n>` when level >
0, matching the shop pages):

- `places/<area-id>.md`: area name, breadcrumb of parents, notes, requirements; a table per kind of
  sites in it (and in its child areas, grouped by child): site, centre, counts, F2P, multiway,
  Wilderness level; child area links.
- `resources/<kind>/<subtype>.md` (trees, rocks, fishing spots, stalls, pickpocket): the dbrow facts
  (level, xp, product, respawn; success chances per tool for trees and rocks) then every site:
  area, centre, stand tile, count, F2P, multiway, Wilderness.
- `services/<kind>.md` (bank, furnace, anvil, range, ...): every site with area, centre, stand tile,
  counts, F2P.
- `wiki/world/README.md` (generated header + hand-written body): what each folder holds, that pages
  are generated, and where corrections go (`areas.ts`, `gates.ts`, the rule table).

`build.ts` calls the renderer after writing `world.json`. A `--check` flag regenerates into memory
and exits 1 if any generated file differs from the working tree (the freshness check); add it to
`verify:conductor`.

Commit `feat(world): render places, resources and services pages`.

### Acceptance criteria

- [ ] `places/`, `resources/`, `services/` pages generated with the shapes described, sorted and
      deterministic; `wiki/world/README.md` explains the folders and where corrections go.
- [ ] `bun wiki/world/build.ts --check` exits 1 on any drift and 0 on a fresh tree; it is part of
      `verify:conductor`.
- [ ] Snapshot tests for each page kind on a tiny synthetic `World`.
- [ ] Pages committed with the code.
- [ ] Out of scope: `wiki/npcs/`, `wiki/shops/`.

---

## Task 7 — NPC and shop pages use sites

**Files:**
- Modify: `wiki/generate-npcs.ts` (remove `MAP_SQUARE_AREAS`, `getAreaFromMapSquare`,
  `parseMapSpawns`' use for locations; the Locations table reads `wiki/world.json`),
  `wiki/generate-shops.ts` (shop coordinates from shop sites)
- Regenerated: `wiki/npcs/**`, `wiki/shops/**`

Locations table becomes: `| Area | Centre | Spawns | F2P |` with one row per site of that npc (any
kind: bankers appear under their bank site, fishing spots under theirs), area = the leaf area name
with its town in parentheses. NPCs with spawns but no site (non-combat, unclassified npcs) still
need locations: give `build.ts` a plain `spawns` index (npc config -> tiles) clustered at radius 6
with areas resolved, written to `world.json` as `npcSpawns`, and render from that.

Check: `wiki/npcs/banker.md` lists 16 sites with correct names (Draynor, not Edgeville area);
`wiki/npcs/fadli.md` and `gundai.md` now have locations; shop pages' coordinates unchanged or
corrected. Diff the regenerated pages and read a sample of 20 before committing.

Commit `fix(wiki): npc and shop locations from world sites, with correct area names`.

### Acceptance criteria

- [ ] `MAP_SQUARE_AREAS` and the map-square area naming are gone from `generate-npcs.ts`;
      locations come from `world.json` (`sites` or `npcSpawns`).
- [ ] `world.json` gains `npcSpawns` (config -> clustered spawns with area paths); Task 5's
      determinism and Task 6's `--check` still hold.
- [ ] `wiki/npcs/banker.md` lists 16 sites with correct names; `fadli.md`, `gundai.md` have
      locations; shop pages' coordinates come from shop sites.
- [ ] Both generators still run (`bun wiki/generate-npcs.ts`, `bun wiki/generate-shops.ts`) and
      their regenerated output is committed.
- [ ] Out of scope: drop tables, item pages, page sections other than locations.

---

## Task 8 — Knowledge-base wiring

**Files:**
- Modify: `.claude/skills/knowledge/SKILL.md` (generated folders now include `places/`,
  `resources/`, `services/`, `world.json`; corrections go to `wiki/world/areas.ts` or the rule
  table), `CLAUDE.md` (the "These folders are the knowledge base" paragraph), `wiki/README.md` if
  present.
- Modify: `learnings/banking.md` table to link `wiki/services/bank.md` instead of repeating
  coordinates (keep the verified-in-game notes, per the knowledge skill's one-fact-one-place rule).

Commit `docs(knowledge): world index pages are generated; where corrections go`.

### Acceptance criteria

- [ ] The knowledge skill, `CLAUDE.md` and the wiki README name the new generated folders, the
      curated inputs and where corrections go.
- [ ] `learnings/banking.md` links `wiki/services/bank.md`; verified-in-game notes kept, duplicate
      coordinates removed.
- [ ] Out of scope: other `learnings/` pages.

---

## Out of scope for this spec

Phases 2 and 3 below get their own spec once phase 1 lands.

### Phase 2: reachability and travel (outline)

1. **Connector extraction** (`sources/connectors.ts`): parse `ladders+stairs/scripts/*.rs2`
   `case <level>_<mx>_<mz>_<x>_<z> : p_telejump(<coord>)` into (loc tile -> landing); match to
   `connector` features; stand tile per `connectors.ts` rules. Test: every row of
   `conductor/lib/connectors.ts` is reproduced (loc and landing exact, stand within 1 tile).
2. **Gates and transports** (`wiki/world/gates.ts`, curated): door/gate loc tile + requirement;
   transports with endpoints, requirement, gp. Seed by grepping door scripts for quest varp checks
   and `p_telejump` after a payment; the curated list confirms each.
3. **Graph + flood fill** (`reach.ts`): typed-array tile graph over `collisionPaths`
   (`walkable`/`canStep`), connector and gate edges; multi-label BFS keeping minimal requirement
   sets per tile (antichain). Tests on synthetic grids (door, gated door, connector, two gates with
   overlapping requirements) and real facts (Al Kharid needs toll or members route; Zanaris needs
   `quest:lost-city`; Entrana by boat only).
4. **Access on sites** (`reach` field), members from `free2play.csv`; unreached-content report by
   area.
5. **Path lengths** (`paths.ts` helper): BFS distance site stand -> nearest sink (bank/processor) per
   requirement set, cached.
6. **Conductor views**: `conductor/lib/connectors.ts` imports generated connectors (keeps its
   tests); `conductor/lib/banks.ts` derives `BANKS` from bank sites (F2P, surface, reach `{}`) with
   the curated `auto: false` exclusions kept. Both run through `task-review`.

### Phase 3: rate model and methods (outline)

1. **Formula ports** (`wiki/world/model/`): `statRandom(level, low, high)` from the engine's
   `stat_random` command implementation; woodcutting (swing ticks, `successchance`, deplete 1/8,
   respawn), mining, fishing (`success_low/high` structs), thieving; each function cites its script
   file and line; tests against hand-worked values.
2. **Resource cap**: items/hr capped by k features x respawn.
3. **Trip model**: inventory / rate + round-trip path ticks (walk and run) + banking overhead;
   modes drop / bank / process-then-bank.
4. **Method enumeration** per skill (gathering, processing, thieving) -> `methods[]` in `world.json`
   with rates over levels 1-99 per tool tier.
5. **Hazards**: aggressive NPC sites in range of the site and path (aggression + level vs player
   combat level), Wilderness, multiway, gating.
6. **Combat**: port the engine's accuracy and max-hit formulas; player profile (levels + gear
   bonuses); kills/hr from density vs respawn; gp/hr from drop tables at item value.
7. **Calibration**: key `conductor/tools/stats.ts` measurements to method ids; report >25% gaps.
8. **Outputs**: `wiki/training/<skill>.md`; `wiki/world/query.ts` `bestMethods(skill, level,
   { f2p, quests, gear, maxHazard })` with tests.
