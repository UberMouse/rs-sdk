# Combat

Successful patterns for combat training.

## Attacking NPCs

Use `bot.attack()` for cleaner code, or raw SDK for more control:

```typescript
// Porcelain method (recommended)
const attack = await bot.attack(/cow/i);
if (!attack.success) console.warn(attack.reason, attack.message);

// Raw SDK dispatch (observe combat state afterwards)
const state = sdk.getState();
const npc = state?.nearbyNpcs.find(n => /cow/i.test(n.name));
const attackOpt = npc?.optionsWithIndex.find(o => /attack/i.test(o.text));
if (npc && attackOpt) {
    await sdk.sendInteractNpc(npc.index, attackOpt.opIndex);
    await sdk.waitForCondition(s => s.player?.combat.inCombat === true, 5_000);
}
```

The `combat` task's `target` is a plain NPC name (`'Giant rat'`, `'Elvarg'`), not a regex. `eatBelow` is a fraction 0.1-0.9 of max HP, not hit points; `prayers: ['Protect from Melee']` turns a prayer on for the fight. [v 2026-10-24 questw1 local]

## Combat Style Cycling

Combat-style indices depend on the equipped weapon the SDK reads
the table from the combat tab the server installed, so resolve indices from state

```typescript
const targetSkill = 'Defence';
// A controlled style lists every skill it trains, so match against trainsSkills.
const style = sdk.getState()?.combatStyle?.styles.find(
    candidate => candidate.trainsSkills.includes(targetSkill),
);
if (!style) {
    throw new Error(`No ${targetSkill} style is available for the equipped weapon`);
}
await sdk.sendSetCombatStyle(style.index);
await sdk.waitForCondition(
    state => state.combatStyle?.currentStyle === style.index,
    5_000,
);
```

## Checking Combat State

```typescript
const state = sdk.getState();
const inCombat = state?.player?.combat.inCombat ?? false;

// Animation is a useful heuristic, but is not specific to combat.
const isAnimating = (state?.player?.animId ?? -1) !== -1;
```

`combat.inCombat` stays true for ~20 ticks after a kill while the target index is already -1, so do not use it to decide that the next fight has started or that the bot is still busy; check the target. [v 2026-10-16 conductor2w3 local]

## Safe Training Locations

| Location | Coordinates | Targets | Notes |
|----------|-------------|---------|-------|
| Lumbridge cows | (3253, 3290) | Cows | Safe, good for all levels. South gate at (3253, 3266) |
| Lumbridge goblins | (3252, 3230) | Goblins, rats | Mixed enemies. Cluster runs NE from here — nothing at the old (3240, 3220) waypoint |
| Lumbridge chickens | (3231, 3295), radius 8 | Chickens | Very safe, feathers drop; verified to combat 21 ([strength](../wiki/skills/strength.md#verified-training-spots)) |
| Al Kharid warriors | ~(3293, 3170) | `Al-Kharid warrior` (lvl 9) | Faster XP, kebabs nearby for food, can hit hard via multicombat vs low combat levels. |

## Chicken spawn areas the wiki mislabels

Chickens spawn at (3185..3191, 3277..3279) (map square m49_51); the attack integration test fought them there. [v 2026-10-10 integration-tests local]

The combat smoke fought chickens at (3231, 3295), radius 8. [v 2026-10-10 integration-tests local]

Derived from coordinates, not observed in game: `wiki/npcs/chicken.md` labels (3185, 3277) "Barbarian Village" and (3225, 3300) "Varrock (south)", but both lie within ~50 tiles of the Lumbridge chicken spot (3231, 3295), far from Barbarian Village (~3080, 3420) and Varrock (z > 3400). The labels look wrong.

## Cow Field Details (Proven from 200+ kills)

The cow field is fenced with a gate on the south side:
- **Field center**: ~(3253, 3290)
- **South gate position**: (3253, 3266)
- **Inside cow pen**: x between 3242-3265, z between 3255-3298

```typescript
function isInsideCowPen(x, z) {
    return x >= 3242 && x <= 3265 && z >= 3255 && z <= 3298;
}
```

## Opening Gates

The cow field has a fenced gate. The chicken coop needed no gate handling: `bot.walkTo` reached it from (3206, 3237) [v 2026-10-09 conductor1 local]. Ducks and cows seen from inside the coop were `[UNREACHABLE]`.

```typescript
// Check for gate blocking path
const gate = sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
if (gate) {
    const openOpt = gate.optionsWithIndex.find(o => /^open$/i.test(o.text));
    if (openOpt) {
        await bot.openDoor(gate);
    }
}
```

## Timed stops end mid-fight

A `--until minutes:N` stop can land while the player is fighting. The next `combat` run is then refused ("in combat at (x,z)") until the fight ends; wait for `player.combat.inCombat` to clear (or kill the target) before relaunching. Level-up dialogs during fights (10 in 2 min at low levels) are handled by the engine's dialog interrupt. [v 2026-10-09 conductor1 local]

A level-up dialog can interrupt the until-level check, so a plan's combat phase may end one kill late and overshoot its target by a level (Attack 21 for a goal of 20). [v 2026-10-23 conductor3 local]

## Finding New Targets

After killing an NPC, find the next one quickly:

```typescript
async function findTarget(pattern) {
    const state = sdk.getState();
    if (!state) return null;

    return state.nearbyNpcs
        .filter(n => pattern.test(n.name))
        .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}
```

## Looting Ground Items

**CRITICAL**: Use `sdk.scanGroundItems()` NOT `state.nearbyLocs` for dropped items!

```typescript
// WRONG - nearbyLocs is for static objects (trees, rocks, etc.)
const wrongLoot = sdk.getState()?.nearbyLocs.filter(i => /hide/i.test(i.name));  // Won't work!

// CORRECT - scanGroundItems() for drops
const groundItems = await sdk.scanGroundItems();
const loot = groundItems.filter(i => /hide|bones|coins/i.test(i.name));
```

### Limit Pickups Per Loop

Pick up a few items (e.g. 3), then return to combat. Prevents getting stuck in infinite loot loops:

```typescript
const MAX_PICKUPS = 3;
const groundItems = await sdk.scanGroundItems();
const loot = groundItems
    .filter(i => /hide|bones/i.test(i.name))
    .filter(i => i.distance < 5)
    .slice(0, MAX_PICKUPS);

for (const item of loot) {
    await bot.pickupItem(item);
    await new Promise(r => setTimeout(r, 500));
}
// Back to combat
```

## Error Handling for Long Runs (Critical!)

Timeouts and errors are frequent in crowded areas. Wrap attacks in try/catch:

```typescript
// This pattern enabled consistent 10-minute runs
try {
    await bot.attack(/cow/i);
} catch (err) {
    console.log(`Attack timed out, trying next cow`);
    continue;  // Don't crash - just find another target
}
```

### Common Messages and Handling

| Message | Meaning | Response |
|---------|---------|----------|
| "I'm already under attack" | Crowded area, NPC in combat | Find different target |
| "I can't reach that!" | Obstacle or fence | Move closer, check gates |
| Attack timeout | Target died/moved | Try next NPC |

### State Validation

Browser glitches sometimes return invalid positions. Validate state before acting:

```typescript
const player = sdk.getState()?.player;
if (!player || player.worldX === 0 || player.worldZ === 0) {
    console.log('Invalid state - waiting for sync');
    await new Promise(r => setTimeout(r, 2000));
    continue;
}

// Also catch impossible position changes (>500 tiles = glitch)
if (Math.abs(player.worldX - lastX) > 500) {
    console.log('Position glitch detected, skipping action');
    continue;
}
```

## Auto-Train Lowest Combat Stat

For balanced progression, automatically train whichever stat is lowest:

```typescript
function getLowestCombatStat(state) {
    const skills = state.skills;
    const atk = skills.find(s => s.name === 'Attack')?.baseLevel ?? 1;
    const str = skills.find(s => s.name === 'Strength')?.baseLevel ?? 1;
    const def = skills.find(s => s.name === 'Defence')?.baseLevel ?? 1;

    if (def <= atk && def <= str) return 'Defence';
    if (str <= atk) return 'Strength';
    return 'Attack';
}

const state = sdk.getState();
if (!state) throw new Error('No world state');
const stat = getLowestCombatStat(state);
const style = state.combatStyle?.styles.find(option => option.trainsSkills.includes(stat));
if (!style) throw new Error(`No style trains ${stat} with the equipped weapon`);
await sdk.sendSetCombatStyle(style.index);
console.log(`Training ${stat} with ${style.name}`);
```

This pattern enabled balanced 60+ in all melee stats.

## Ranged and Magic through the combat task

- Ranged: wield the bow and the arrows (`weapon`, `ammo`), then a normal Attack; XP at the chickens was about 1000 Ranged XP (level 1 to 10) per minute with a Shortbow and Bronze arrows. Fallen arrows land in the inventory, not the quiver, and are wielded again by the task. [v 2026-10-10 conductor2w5 local]
- Magic: a manual cast (spell on NPC) is one cast per send, with a 5-tick delay before the next (`%action_delay` in `player_magic.rs2`); the XP is paid before the hit roll, so a splash still pays. Wind Strike at the chickens: about 2900 Magic XP (level 1 to 19) in a minute, using 15-17 Air and Mind runes. The retaliating chicken also trains melee (Attack +600 with no weapon). [v 2026-10-10 conductor2w5 local]
- Missing runes answer "You do not have enough Air Runes to cast this spell."; too low a level "Your Magic level is not high enough for this spell." The free strike/bolt/blast spells, levels and runes are in `server/content/scripts/skill_combat/configs/magic/magic_combat_spells.dbrow`; the wave spells are members-only. [v 2026-10-10 conductor2w5 local]

- The engine refuses to start any task in combat unless its `startInCombat(params, state)` allows it. `combat` allows it when something faces the bot and every such attacker is a target or winnable (level <= bot combat, HP above the eat threshold); an unknown or stronger attacker keeps the refusal. `travel` has `flee`. Verified on the Edgeville hill giants (2026-10-16 conductor2w3 local).
- A Staff of air carried in the inventory is not counted by the `combat` task's rune preflight, which runs before it wields the `weapon` param: Wind Blast reported "needs 3 Air rune, the bot has 0". Wield the staff in an earlier phase. [v 2026-10-16 conductor2 local]
- Hill giants are named exactly `Giant`. `combat` refuses a level-28 NPC when the inventory holds no food (its level cap drops to 5); plan fight phases use `onFail: 'continue'` so a restock phase can run. [v 2026-10-16 conductor2 local]
- That cap, not a default `maxLevel`, is what refuses a target (`maxLevel` only filters targets; with food the cap is combat level + `maxLevelGap`, default 5): a combat-52 bot with its salmon eaten was refused "Ice warrior is level 57, above limit 5". Keep food in the inventory for real fights. [v 2026-10-23 questw4 local]
- The engine refuses to start any task while the bot is under attack unless the task allows it (`startInCombat`, engine.ts:489); `combat` and `talk` with `continue` opt in (below), a `travel` with `flee` is allowed. So an in-task mining/walking phase cannot be rescued by a follow-up fight task: put the flee exit in the plan, at an HP well above the low-HP guard (it fired only at 16 and 4 of 49 while several monsters hit for ~40 HP in seconds), and an eat can fail ("Failed to eat Lobster") at HP 4. [v 2026-10-23 questw4 local]
- `combat` starts under attack whenever an attacker is one of its targets (or every attacker is at or below the bot's combat level), at any HP: the low-HP guard eats during the run, and with no food it fails "no food". `talk` with `continue: true` starts under attack when a dialog is open; `travel` with `flee` is the exit for everything else (`interact`/`items` stay refused). The low-HP guard's line rises with the attackers on the bot (0.5 for one or none, 0.65 for two, 0.8 for three or more, `lib/threat.ts`). [unit tests only; the combat-under-attack smoke starts the fight from the scorpion save but did not capture the start-under-attack state]
- Why "Failed to eat" at low HP: from the server source (`consume.rs2`, `%eat_delay >= map_clock`), an eat sent inside the eat delay is silently dropped, so the old 13-tick wait lost the window. Under fire the guard now waits 3 ticks and re-sends up to 3 times when an eat shows no effect. Read from the source, not reproduced live.
- The engine's low-HP guard runs ahead of every other step and, with no food, only regenerates in place: an `interact` Climb-up errand at the foot of a ladder at 16/49 HP ran 60 guard steps through its 2-minute stop without climbing. Get HP back up (eat, rest) before an errand that follows a flee. [v 2026-10-23 questw4 local]

- Protect from Melee with 43 Prayer points lasts about 100 s of fighting. Against the Black Knight Titan (142 HP) it ran out with the Titan at 7 HP, so plan melee plus food to finish (Prayer 70 would cover the whole fight). [v 2026-10-24 questw5 local]

## combat `targetRange: "visible"`
- Works for cows at the Falador farm (area (3027, 3307) radius 22): the cows were not thin, the first fight settled in 17 ticks, and two phases (Attack 79 s, Defence 115 s) had no "no free", wait or walk-back lines. [v 2026-10-24 conductor3 local]
