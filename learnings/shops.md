# Shops & Selling

Successful patterns for shop interactions and selling items.

## General store pricing

General stores price by stock level: the more of an item the shop holds, the less it pays (down to
~0 GP when overstocked); a depleted item pays the most. A sell that returns 0 GP means the shop is
overstocked on that item, not that the sale failed.

- Hosted: the Lumbridge General Store paid 0 GP total for 40+ cow hides (stock saturated, likely by
  other bots). Sell to a specialist (tanner) or earn elsewhere instead. [v hosted, date unrecorded]
- Local: the same store paid 20 GP for one Shortbow (not overstocked for it). Stock is per server,
  so check `coins` before and after a first sale. [v 2026-10-09 conductor1 local]
- Local: the same store paid 0 GP total for 95 Headless arrows (sold 20, then 75; coins +0 both times). [v 2026-10-09 conductor1 local]

## Shop Locations

| Shop | Location | Coordinates | What They Sell |
|------|----------|-------------|----------------|
| Lumbridge General Store | Lumbridge | NPC "Shop keeper", walk target (3212, 3247) | Hammer (1gp), Pot, Jug, Bucket, Tinderbox (1gp, bought on local), Chisel, Shears; buys most items. [v 2026-10-09 conductor1 local] |
| Every general store (Lumbridge, Rimmington (2947, 3217), Falador, Varrock, Edgeville) | various | - | Stock only 2 Buckets and 2 Jugs each (as the `wiki/shops/` pages list): a 14-bucket buy fills 2, so buy at several shops. [v 2026-10-11 conductor2 local] |
| Varrock Sword Shop | Varrock | (3204, 3398) | Bronze to steel swords. Shop keeper (3203, 3397), Shop assistant (3205, 3399) |
| Bob's Brilliant Axes | Lumbridge | NPC "Bob", walk target (3232, 3203) | Axes (bronze axe 16gp, bought on local [v 2026-10-09 conductor1 local]); iron 56 gp and steel 200 gp per the stock list, nothing above steel; bronze pickaxe 1gp only |
| Nurmof's Pickaxe Shop | Dwarven Mine, under Falador | (2998, 9844) | Every pickaxe from bronze to rune (stock list: `wiki/shops/nurmofs-pickaxe-shop.md`); visited by a bot: Iron pickaxe 140 gp bought, reached via the Falador mine stairs (`learnings/walking.md`) [v 2026-10-11 conductor2w1 local] |
| Gerrant's Fishy Business | Port Sarim | (3014, 3224) | Small fishing net (5gp), fishing gear; fly fishing rod 5 gp; feather price climbs as stock drops: 277 feathers cost ~1,040 gp (a 450 order partial-filled) [v 2026-10-11 conductor2 local] |

## Starter tools: where to get each

| Tool | Source | Cost | Verified |
|---|---|---|---|
| Axe | Bob's Brilliant Axes, Lumbridge | bronze 16 gp | 2026-10-09 conductor1 local |
| Pickaxe | Bob's Brilliant Axes, Lumbridge | bronze 1 gp | 2026-10-09 conductor1 local |
| Tinderbox | Lumbridge General Store | 1 gp | 2026-10-09 conductor1 local |
| Knife | ground spawn (3224, 3202), no Lumbridge shop sells it | free | 2026-10-09 conductor1 local |
| Hammer | Lumbridge General Store (per stock list, wiki/shops/lumbridge-general-store.md) | 1 gp | unverified |
| Chisel, shears, needle, others | Chisel and shears are in the Lumbridge General Store list above; needle and the rest unknown | | unverified |

## Opening a Shop

```typescript
// Find shopkeeper
const shopkeeper = sdk.getState()?.nearbyNpcs.find(n => /shopkeeper/i.test(n.name));
if (!shopkeeper) return;

// Find Trade option
const tradeOpt = shopkeeper.optionsWithIndex.find(o => /trade/i.test(o.text));
if (tradeOpt) {
    await sdk.sendInteractNpc(shopkeeper.index, tradeOpt.opIndex);
}

// Wait for shop interface
for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (sdk.getState()?.shop?.isOpen) {
        console.log('Shop opened!');
        break;
    }
}
```

## Selling Items

```typescript
// Shop must be open first
if (!sdk.getState()?.shop?.isOpen) {
    console.log('Shop not open!');
    return;
}

// Find item to sell in inventory
const item = sdk.getState()?.inventory.find(i => /^cow hide$/i.test(i.name));
if (item) {
    // Sell item (slot, quantity)
    await sdk.sendShopSell(item.slot, item.count);
    await new Promise(r => setTimeout(r, 200));
}
```

## Buying Items

```typescript
// Find item in shop stock
const shopItem = sdk.getState()?.shop?.shopItems?.find(i => /sword/i.test(i.name));
if (shopItem && shopItem.count > 0) {
    await sdk.sendShopBuy(shopItem.slot, 1);
    await new Promise(r => setTimeout(r, 200));
}
```

## Partial Fills

`bot.buyFromShop` / `bot.sellToShop` report `success: true` only when the whole
requested amount went through. Running out of stock, coins, or inventory space
gives `success: false` with `partial: true` — read the amount rather than
assuming the request was filled:

```typescript
const bought = await bot.buyFromShop(/bronze pickaxe/i, 5);
if (!bought.success) {
    console.log(`Got ${bought.amountBought} of ${bought.requestedAmount} (${bought.reason})`);
}
```

Quantities above 1000 are rejected up front rather than expanded into thousands
of Buy-1 packets.

## Money-Making Alternatives

Since general stores can be overstocked, consider:

| Method | GP/Hour (approx) | Requirements |
|--------|------------------|--------------|
| Pickpocketing men, Lumbridge castle | ~1-2k GP (local, conductor2: Thieving 1-34 in 5 min holding 2 food = 156 gp, ~31 gp/min; 34-39 in 5 min with no food = 72 gp, ~14 gp/min because the regen step waited at low HP; ~1 in 4 attempts caught) [v 2026-10-10 conductor2 local]. Earlier 1-min worker runs: 48 and 66 gp (HP-10 workers ran out of HP) | Thieving 1+ |
| Mining copper/tin | Variable | Mining 1+, pickaxe |
| Fishing shrimp | Variable | Fishing 1+, net |

Combat drops (bones, hides) are only valuable if you can find a specialized buyer or player to trade with.
