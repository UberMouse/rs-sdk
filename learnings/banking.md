# Banking

Successful patterns for bank interactions.

## Where the banks are

Every bank, with its exact tile, is in [wiki/services/bank.md](../wiki/services/bank.md); this page keeps what runs verified.

## Opening the Bank


```typescript
// Open bank (finds banker NPC or booth automatically)
const openResult = await bot.openBank();
if (!openResult.success) {
    console.log(`Failed to open bank: ${openResult.message}`);
}

// Deposit item by name
const depositCoins = await bot.depositItem(/coins/i);  // deposits all
const depositSword = await bot.depositItem(/sword/i, 1);  // deposits 1

// Withdraw item by bank slot
const withdrawOne = await bot.withdrawItem(0);  // withdraws 1 from slot 0
const withdrawAll = await bot.withdrawItem(0, -1);  // withdraws all from slot 0

// Close bank
await bot.closeBank();
```

`success` on deposit/withdraw means the **full** requested amount moved. A short
fill returns `success: false` with `partial: true`, so check the amount instead
of assuming you got everything:

```typescript
const ore = await bot.withdrawItem(/iron ore/i, 28);
if (!ore.success) {
    console.log(`Only got ${ore.amountWithdrawn} of ${ore.requestedAmount} (${ore.reason})`);
}
```



## Depositing Items

```typescript
// Deposit specific item
const ore = sdk.getState()?.inventory.find(i => /ore$/i.test(i.name));
if (ore) {
    await sdk.sendBankDeposit(ore.slot, ore.count);
    await new Promise(r => setTimeout(r, 200));
}

// Deposit all of a type
const ores = sdk.getState()?.inventory.filter(i => /ore$/i.test(i.name)) ?? [];
for (const ore of ores) {
    await sdk.sendBankDeposit(ore.slot, ore.count);
    await new Promise(r => setTimeout(r, 200));
}
```

## Deposit All of an Item

Use `-1` as the quantity to deposit all of an item type. 

```typescript
// High-level (recommended)
await bot.depositItem(/bones/i, -1);  // Deposits ALL bones (even if in 5 separate slots)
await bot.depositItem(/coins/i, -1);  // Deposits ALL coins (stacked)

// Low-level
await sdk.sendBankDeposit(slot, -1);  // Deposits ALL items of that type from ANY slot
```


## Withdrawing Items

```typescript
// bankSlot is the position in the bank, not inventory
await sdk.sendBankWithdraw(bankSlot, count);
```

- The bank task's `withdraw` with `upTo` is capped by the inventory (`inventoryRoom` in `conductor/tasks/bank.ts`): a non-stackable item by the free slots, a stackable one (Feather, runes, coins; the obj config's `stackable`) only by needing one free slot, or none if a stack of it is held, even a stack of one. Before the fix (2026-10-23) a stackable not held as a stack of 2+ came up 27 of 155 Feather. [v 2026-10-23 conductor3 local]
- A bank `withdraw` with `upTo` of an item not in the bank is skipped without failing, so it works as an inventory probe. [v 2026-10-24 conductor3 local]
- The bank task has no balance read-out. To read a banked coin total: withdraw Coins with `upTo` and a large count, read the run's `inventoryDelta`, then deposit them again. [v 2026-10-23 conductor3 local]

## Closing the Bank

```typescript
// High-level (recommended)
await bot.closeBank();

// Low-level (works for any modal interface)
await sdk.sendCloseModal();
await new Promise(r => setTimeout(r, 500));
```

## One bank for the whole account

Every bank booth and banker opens the same contents (`[bank]` is `scope=perm` in `server/content/scripts/interface_bank/configs/bank.inv`). Coins or items banked at Varrock can be withdrawn at Draynor or Falador; don't walk to a particular town for them. [server data 2026-10-11]

## Bank Locations (THERE IS NOT BANK IN LUMBRIDGE in 2004scape)

Checked against the map data: `server/content/maps/m50_50.jm2` (Lumbridge, castle included) has no `bankbooth` (2213), `bankboothclosed` or `banker1/2` on any level, so the top-floor castle bank (added to the real game in 2007) does not exist here. [map data 2026-10-11]

Verified in game:

| Bank | Notes |
|------|-------|
| Varrock West | Close to GE. Deposit and withdraw verified via the `bank` task with area {x:3185,z:3436,radius:6}. `bot.openBank` found no banker/booth (`no_bank_found`) from (3169, 3436), 16 tiles west, so walk to the booth first; the nearest working distance is untested. [v 2026-10-09 conductor1 local] |
| Draynor | Ground floor. The `bank` task works with explicit area `{x:3092,z:3243,radius:3}` (deposit and depositAllExcept). `depositAllExcept` banks every inventory item not listed, including a sword or shield carried unworn, and talismans: a plan that needs one must list it in the except list. [v 2026-10-16 conductor2 local] |
| Al Kharid | Requires toll or quest |

## Full Banking Loop Pattern

```typescript
async function bankTrip(itemPattern, bankCoords, returnCoords) {
    // Walk to bank
    await bot.walkTo(bankCoords.x, bankCoords.z);

    // Open bank (automatically finds banker/booth)
    const openResult = await bot.openBank();
    if (!openResult.success) {
        console.log(`Failed to open bank: ${openResult.message}`);
        return;
    }

    // Deposit all items matching pattern (one call deposits ALL, even non-stackable)
    await bot.depositItem(itemPattern, -1);

    // Close bank and return
    await bot.closeBank();
    await bot.walkTo(returnCoords.x, returnCoords.z);
}
```


### Key Learnings from Cow hide Banking
1. **Gate exit threshold**: Use `z < 3268` not `z < 3265` for cow field
2. **Let `walkTo` handle the gate first**: It attempts to open doors on its route
3. **Recover explicitly**: If movement fails at the south gate `(3253, 3266)`,
   inspect its current options, call `openDoor(gate)` when `Open` is present,
   then retry `walkTo`
4. **Banking works at Varrock West**: (3185, 3436) confirmed working (see the table above)
