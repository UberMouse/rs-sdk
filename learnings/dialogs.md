# Dialogs & UI

Successful patterns for handling game dialogs and interfaces.

## Dismissing Level-Up Dialogs

Level-up dialogs block all actions (a level-up page left open makes the next `talk` fail "Failed to click dialog option"; send `talk {continue:true}` when a dialog is open). [v 2026-10-24 questw3 local] Dismiss them immediately:

```typescript
if (sdk.getState()?.dialog.isOpen) {
  await sdk.sendClickDialog(0);
  continue; // Skip rest of loop iteration
}
```

## Dismiss at Arc Start

All BotActions methods automatically dismiss blocking UI before executing. Manual dismissal is only needed when using low-level sdk methods directly:

```typescript
await bot.dismissBlockingUI();
```

## Checking Dialog State

```typescript
const dialog = sdk.getState()?.dialog;

// Is any dialog open?
if (dialog.isOpen) { ... }

// Is dialog waiting for input?
if (dialog.isOpen && !dialog.isWaiting) { ... }

// Get available options
for (const opt of dialog.options) {
    console.log(`${opt.index}: ${opt.text}`);
}
```

## Navigating Multi-Step Dialogs

For NPC conversations with choices:

```typescript
// Click through until specific option appears
for (let i = 0; i < 20; i++) {
  const s = sdk.getState();
  if (!s?.dialog.isOpen) {
    await new Promise((r) => setTimeout(r, 150));
    continue;
  }

  // Look for target option
  const targetOpt = s.dialog.options.find((o) => /yes/i.test(o.text));
  if (targetOpt) {
    await sdk.sendClickDialog(targetOpt.index);
    break;
  }

  // Otherwise click to continue
  await sdk.sendClickDialog(0);
  await new Promise((r) => setTimeout(r, 200));
}
```

## Dialog text as evidence

- `state.recentDialogs` holds the last ~20 dialog pages [v 2026-10-24 questw7 local], and a page's text wraps across lines, so match markers on `d.text.join(' ')` [v 2026-10-24 questw2 local]; a plan predicate can test text a step left behind (e.g. a quest line) when the quest varp is not visible. Priest in Peril's plan tested "find the key to your cell" after the cell talk and advanced on it [v 2026-10-23 questw5 local]. Drezel's stage-61 line ("keep it equipped whenever I fight werewolves") did not show up in the proof run, so do not gate on it (`wiki/quests/priest-in-peril.md`).
- Mesbox text ("You pour...", item-use messages) is often not recorded in the history, so gate on a game message or an inventory change instead (the plague-city pour and dig gates use the fill message and the bucket count; early gates use held/worn items and position). [v 2026-10-24 questw7 local]
- `interact`'s `expect` does not match a mesbox that the dialog guard closed first (the bucket pour at the mud patch); give such an interact no `expect` and let the inventory change show it worked. [v 2026-10-24 questw7 local]
- Dialog history entries are single pages with wrapped lines, so match a short phrase, not a whole sentence. [v 2026-10-23 questw3 local]
- Stale inventory after a `talk` use phase: right after a `talk` phase with `use` ends, the plan's next phase selection can still read the old inventory, so the same use phase is chosen again and fails `use-items: no item matching #<id> in the inventory to use on <loc>` (seen on fill at the Well and pour at the Coffin, each repeated once, ~10 s lost). Give such phases `onFail: 'continue'`; the plan moves on. [v 2026-10-23 questw5 local]

## Shop Interfaces

```typescript
const state = sdk.getState();
if (!state) throw new Error('No world state');

// Check if shop is open
if (state.shop.isOpen) { ... }

// Check if any interface is open (bank, shop, etc.)
if (state.interface?.isOpen) { ... }
```

## sendClickDialog Index Behavior

- `sendClickDialog(0)` = special "continue" action (RESUME_PAUSEBUTTON)
- `sendClickDialog(1-5)` = click actual option buttons (1-based indices)

Always use `0` as fallback for "Click here to continue" screens.

## Al Kharid Toll Gate Pattern

Requires 10gp. Position west of gate: (3267, 3228).

```typescript
const gate = sdk.getState()?.nearbyLocs.find((l) => /gate/i.test(l.name));
if (!gate) throw new Error('No gate nearby');
await sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1);
await sdk.waitForTicks(2);

// Click through dialog: 0 = continue, or pick "Yes" when available
for (let i = 0; i < 10; i++) {
  const yesOpt = sdk
    .getState()
    ?.dialog?.options.find((o) => /yes/i.test(o.text));
  await sdk.sendClickDialog(yesOpt?.index ?? 0);
  await sdk.waitForTicks(1);
}

await bot.walkTo(3277, 3227); // Walk through to Al Kharid
```

## Buying Kebabs from the Kebab Seller (Al Kharid)

Sells kebabs via dialog (not a shop interface). Location: (3273, 3180), spawns at (3272, 3182).

```typescript
// Walk to kebab seller
await bot.walkTo(3273, 3180);

// Find the kebab seller
const seller = sdk
  .getState()
  ?.nearbyNpcs.find((n) => /kebab/i.test(n.name));
if (!seller) throw new Error('No kebab seller nearby');
const talkOpt = seller.optionsWithIndex.find((o) => /talk/i.test(o.text));
if (!talkOpt) throw new Error('Kebab seller has no Talk-to option');
await sdk.sendInteractNpc(seller.index, talkOpt.opIndex);
await new Promise((r) => setTimeout(r, 1000));

// Handle dialog to buy kebab (1gp each)
for (let i = 0; i < 15; i++) {
  const s = sdk.getState();
  if (!s?.dialog.isOpen) {
    await new Promise((r) => setTimeout(r, 200));
    continue;
  }
  const buyOpt = s.dialog.options.find((o) => /yes/i.test(o.text));
  if (buyOpt) {
    await sdk.sendClickDialog(buyOpt.index);
    break;
  }
  await sdk.sendClickDialog(0);
  await new Promise((r) => setTimeout(r, 300));
}
```

Kebabs cost 1gp and heal 1-19 HP (random). Good cheap food for training.

## Detecting Stuck in Dialog

If your script makes no progress, check for stuck dialogs:

```typescript
// In your main loop
if (sdk.getState()?.dialog.isOpen) {
  console.log("Dialog open, dismissing...");
  await sdk.sendClickDialog(0);
  continue;
}
```
