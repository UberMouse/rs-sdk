// Builders for the BotWorldState a unit test hands the engine: `world(base).player(...).inv(...)`.
// Every method returns a new World, so a base state can be shared and varied per tick:
//
//   world('lumbridge').player({ hp: 4 }).inv('Shrimps', 2).loc('Tree', 3224, 3220, { options: ['Chop down'] })
//
// `base` is a state, a fixture name (conductor/test/fixtures/<name>.json, written by
// tools/capture-state.ts) or nothing for a bare state with the player at Lumbridge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYER_TARGET_OFFSET } from '../lib/interrupts';
import { QUESTS } from '../lib/quests';
import { Items } from '../../sdk/test/utils/save-generator';
import type { BotWorldState, CombatStyleOption, DialogOption, GroundItem, NearbyLoc, NearbyNpc } from '../../sdk/types';

export const LUMBRIDGE = { x: 3222, z: 3218 };

/** The unarmed combat tab, as conductor/test/fixtures/lumbridge.json captured it. */
export const UNARMED_STYLES: CombatStyleOption[] = [
    { index: 0, name: 'Punch', type: 'Accurate', trainsSkills: ['Attack'], damageType: 'Crush' },
    { index: 1, name: 'Kick', type: 'Aggressive', trainsSkills: ['Strength'], damageType: 'Crush' },
    { index: 2, name: 'Block', type: 'Defensive', trainsSkills: ['Defence'], damageType: 'Crush' },
];
const INVENTORY_SLOTS = 28;
/** The bank_main interface (server/content/pack/interface.pack). */
export const BANK_INTERFACE = 5292;
/** The shop_template interface (server/content/pack/interface.pack). */
export const SHOP_INTERFACE = 3824;

/** The tile distance the client publishes (Chebyshev: a diagonal neighbour is 1). */
const tiles = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** The world state of a bare logged-in bot standing at Lumbridge: nothing around, nothing carried. */
function bareState(): BotWorldState {
    return {
        tick: 0,
        inGame: true,
        player: {
            name: 'tester',
            combatLevel: 3,
            hp: 10,
            maxHp: 10,
            x: 0,
            z: 0,
            worldX: LUMBRIDGE.x,
            worldZ: LUMBRIDGE.z,
            level: 0,
            runEnergy: 100,
            runWeight: 0,
            animId: -1,
            spotanimId: -1,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 },
            isDead: false,
            lifeId: 0,
            respawnCount: 0,
            lastDeathTick: null,
        },
        skills: [],
        inventory: [],
        equipment: [],
        nearbyNpcs: [],
        nearbyPlayers: [],
        nearbyLocs: [],
        groundItems: [],
        gameMessages: [],
        recentDialogs: [],
        dialog: { isOpen: false, options: [], isWaiting: false },
        interface: { isOpen: false, interfaceId: -1, options: [] },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] },
        bank: { isOpen: false, items: [], noteMode: false },
        modalOpen: false,
        modalInterface: -1,
        combatEvents: [],
        prayers: { activePrayers: [], prayerPoints: 1, prayerLevel: 1 },
    };
}

/** A captured fixture (see tools/capture-state.ts), as a fresh copy. */
export function loadFixture(name: string): BotWorldState {
    return JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', `${name}.json`), 'utf8')) as BotWorldState;
}

/** Item ids by lowercase name ("raw shrimps"), from the SDK's save generator. */
const ITEM_IDS = new Map(Object.entries(Items).map(([key, id]) => [key.toLowerCase().replaceAll('_', ' '), id]));
/** The options the live client publishes for the item kinds a task acts on (opIndex as captured). */
const FOOD = /^(shrimps|bread|trout|salmon|lobster|swordfish|cooked .*)$/i;
const stackable = (name: string) => /^(coins|.* rune|.* arrow|feather)$/i.test(name);

export interface ItemOptions {
    /** Item id; default looked up by name in the save generator's `Items`. */
    id?: number;
    /** Right-click options; default "Eat" for food and "Wield" for axes. */
    options?: { text: string; opIndex: number }[];
}

function itemOptions(name: string): { text: string; opIndex: number }[] {
    if (FOOD.test(name)) return [{ text: 'Eat', opIndex: 1 }];
    if (/ axe$/i.test(name)) return [{ text: 'Wield', opIndex: 2 }];
    return [];
}

/** A stable id per entity name (FNV-1a), so tasks that match on id see distinct objects; opts.id overrides. */
function entityId(name: string, id: number | undefined): number {
    if (id !== undefined) return id;
    let h = 0x811c9dc5;
    for (const c of name.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    return ((h >>> 0) % 60_000) + 1;
}

function itemId(name: string, id: number | undefined): number {
    const found = id ?? ITEM_IDS.get(name.toLowerCase());
    if (found === undefined) throw new Error(`world: unknown item "${name}"; pass { id }`);
    return found;
}

export interface EntityOptions {
    id?: number;
    /** Right-click option texts, in order. */
    options?: string[];
    /** Default true. */
    reachable?: boolean;
}

export interface NpcOptions extends EntityOptions {
    /** World slot; default counts up from 1 in the order added. */
    index?: number;
    combatLevel?: number;
    inCombat?: boolean;
    healthPercent?: number;
    /** Faces a player (target index PLAYER_TARGET_OFFSET + 1), as an NPC attacking the bot does. */
    attacking?: boolean;
}

export interface LocOptions extends EntityOptions {
    level?: number;
}

const withIndex = (options: string[]) => options.map((text, i) => ({ text, opIndex: i + 1 }));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class World {
    private constructor(private readonly s: BotWorldState) {}

    static of(base?: BotWorldState | string): World {
        if (base === undefined) return new World(bareState());
        return new World(typeof base === 'string' ? loadFixture(base) : structuredClone(base));
    }

    build(): BotWorldState {
        return structuredClone(this.s);
    }

    /** States for ticks `tick..tick+n-1`; `edit` varies each (i is 0-based). */
    series(n: number, edit: (w: World, i: number) => World = w => w): BotWorldState[] {
        return Array.from({ length: n }, (_, i) => edit(this.tick(this.s.tick + i), i).build());
    }

    private with(patch: Partial<BotWorldState>): World {
        return new World({ ...this.s, ...patch });
    }

    private get at(): { x: number; z: number } {
        const p = this.s.player;
        return p ? { x: p.worldX, z: p.worldZ } : LUMBRIDGE;
    }

    /** Sets the game tick; messages added afterwards carry it. */
    tick(n: number): World {
        return this.with({ tick: n });
    }

    /** Moves the player (re-measuring everything nearby) and sets hit points and combat. */
    player(p: {
        at?: { x: number; z: number; level?: number };
        hp?: number;
        maxHp?: number;
        inCombat?: boolean;
        combatLevel?: number;
        lastDamageTick?: number;
    }): World {
        const cur = this.s.player;
        if (!cur) throw new Error('world: the base state has no player');
        const hp = p.hp ?? cur.hp;
        const player = {
            ...cur,
            hp,
            maxHp: p.maxHp ?? cur.maxHp,
            isDead: hp <= 0,
            worldX: p.at?.x ?? cur.worldX,
            worldZ: p.at?.z ?? cur.worldZ,
            level: p.at?.level ?? cur.level,
            combatLevel: p.combatLevel ?? cur.combatLevel,
            combat: {
                ...cur.combat,
                inCombat: p.inCombat ?? cur.combat.inCombat,
                lastDamageTick: p.lastDamageTick ?? cur.combat.lastDamageTick,
            },
        };
        const from = { x: player.worldX, z: player.worldZ };
        const measure = <T extends { x: number; z: number; distance: number }>(xs: T[]) =>
            xs.map(e => ({ ...e, distance: tiles(from, e) }));
        return this.with({
            player,
            nearbyNpcs: measure(this.s.nearbyNpcs),
            nearbyLocs: measure(this.s.nearbyLocs),
            groundItems: measure(this.s.groundItems),
        });
    }

    /**
     * The inventory holds `count` of `name`, replacing any it had: one stack for coins, runes and
     * arrows, else a slot each (as the game does), after the other items. 0 removes it.
     */
    inv(name: string, count = 1, opts: ItemOptions = {}): World {
        const kept = this.s.inventory.filter(i => i.name.toLowerCase() !== name.toLowerCase());
        if (count <= 0) return this.withInventory(kept.map((item, slot) => ({ ...item, slot })));
        const id = itemId(name, opts.id);
        const options = opts.options ?? itemOptions(name);
        const counts = stackable(name) ? [count] : Array<number>(count).fill(1);
        if (kept.length + counts.length > INVENTORY_SLOTS) throw new Error(`world: no room for ${count} ${name}`);
        const added = counts.map(n => ({
            slot: 0,
            id,
            name: cap(name.toLowerCase()),
            count: n,
            optionsWithIndex: options,
        }));
        return this.withInventory([...kept, ...added].map((item, slot) => ({ ...item, slot })));
    }

    /** Sets the inventory, and with a shop open the stock it lists as sellable (see `shop`). */
    private withInventory(inventory: BotWorldState['inventory']): World {
        const { shop } = this.s;
        if (!shop.isOpen) return this.with({ inventory });
        const prices = new Map(shop.playerItems.map(i => [i.id, i]));
        const playerItems = inventory.flatMap(i => {
            const priced = prices.get(i.id);
            return priced ? [{ ...priced, slot: i.slot, count: i.count }] : [];
        });
        return this.with({ inventory, shop: { ...shop, playerItems } });
    }

    /** A scenery object (tree, rock, bank booth). `options` are its right-click texts. */
    loc(name: string, x: number, z: number, opts: LocOptions = {}): World {
        const options = opts.options ?? [];
        const loc: NearbyLoc = {
            id: entityId(name, opts.id),
            name,
            x,
            z,
            level: opts.level ?? this.s.player?.level ?? 0,
            distance: tiles(this.at, { x, z }),
            optionsWithIndex: withIndex(options),
            options,
            reachable: opts.reachable ?? true,
        };
        return this.with({ nearbyLocs: [...this.s.nearbyLocs, loc] });
    }

    npc(name: string, x: number, z: number, opts: NpcOptions = {}): World {
        const options = opts.options ?? [];
        const npc: NearbyNpc = {
            kind: 'npc',
            id: entityId(name, opts.id),
            index: opts.index ?? this.s.nearbyNpcs.length + 1,
            name,
            combatLevel: opts.combatLevel ?? 1,
            x,
            z,
            tileX: x,
            tileZ: z,
            size: 1,
            distance: tiles(this.at, { x, z }),
            hp: null,
            maxHp: null,
            healthPercent: opts.healthPercent ?? null,
            targetIndex: opts.attacking ? PLAYER_TARGET_OFFSET + 1 : -1,
            inCombat: opts.inCombat ?? opts.attacking ?? false,
            lastCombatTick: null,
            animId: -1,
            spotanimId: -1,
            optionsWithIndex: withIndex(options),
            options,
            reachable: opts.reachable ?? true,
        };
        return this.with({ nearbyNpcs: [...this.s.nearbyNpcs, npc] });
    }

    /** An NPC one tile east of the player, wherever the player stands. */
    npcBeside(name: string, opts: NpcOptions = {}): World {
        return this.npc(name, this.at.x + 1, this.at.z, opts);
    }

    ground(name: string, x: number, z: number, count = 1, opts: EntityOptions = {}): World {
        const item: GroundItem = {
            id: itemId(name, opts.id),
            name: cap(name.toLowerCase()),
            count,
            x,
            z,
            distance: tiles(this.at, { x, z }),
            reachable: opts.reachable ?? true,
        };
        return this.with({ groundItems: [...this.s.groundItems, item] });
    }

    /** Opens a dialog with these option labels (none for a "click to continue" page), or closes it with `false`. */
    dialog(d: { text?: string; options?: string[] } | false = {}): World {
        if (!d) return this.with({ dialog: { isOpen: false, options: [], isWaiting: false } });
        const options: DialogOption[] = (d.options ?? []).map((text, index) => ({ index, text }));
        return this.with({
            dialog: { isOpen: true, options, isWaiting: false, ...(d.text !== undefined && { text: d.text }) },
        });
    }

    /**
     * The quest tab as the server colours it after login: every quest of lib/quests.ts red (not started) except the
     * ones given, which are yellow (`started`) or green (`done`).
     */
    quests(progress: Record<string, 'started' | 'done'>): World {
        const colours = { none: 0xf80000, started: 0xf8f800, done: 0x00f800 };
        return this.with({
            questTab: Object.entries(QUESTS).map(([id, q]) => ({
                name: q.name,
                colour: colours[progress[id] ?? 'none'],
            })),
        });
    }

    /** Opens main modal `id` (a book, a scroll) as the client publishes it, or closes it with `false`. */
    modal(id: number | false): World {
        const open = id !== false;
        const interfaceId = open ? id : -1;
        return this.with({
            interface: { isOpen: open, interfaceId, options: [] },
            modalOpen: open,
            modalInterface: interfaceId,
        });
    }

    /**
     * Opens the bank (the client publishes bank_main as the main modal) holding `items`, one slot
     * each in order, or closes it with `false`. Withdrawals arrive as notes while `noteMode` is on.
     */
    bank(items: BankContents | false, noteMode = false): World {
        if (!items) return this.with({ bank: { isOpen: false, items: [], noteMode } }).modal(false);
        const bank = {
            isOpen: true,
            noteMode,
            items: items.map((it, slot) => ({
                slot,
                id: itemId(it.name, it.id),
                name: cap(it.name.toLowerCase()),
                count: it.count,
            })),
        };
        return this.with({ bank }).modal(BANK_INTERFACE);
    }

    /**
     * Opens a shop (the client publishes shop_template as the main modal) stocking `lines`, one slot
     * each in order, or closes it with `false`. `buys` is what it pays per unit for inventory items by
     * lowercase name: those inventory items, as held now, are the sellable `playerItems`, and stay so as
     * `inv` changes the inventory until none of one is left. Call `inv` before `shop` for items to sell.
     */
    shop(lines: ShopContents | false, buys: Record<string, number> = {}, title = 'General Store'): World {
        if (!lines)
            return this.with({ shop: { isOpen: false, title: '', shopItems: [], playerItems: [] } }).modal(false);
        const shopItems = lines.map((l, slot) => ({
            slot,
            id: itemId(l.name, l.id),
            name: cap(l.name.toLowerCase()),
            count: l.count,
            baseCost: l.buyPrice ?? 1,
            buyPrice: l.buyPrice ?? 1,
            sellPrice: l.sellPrice ?? 0,
        }));
        const playerItems = this.s.inventory.flatMap(i => {
            const sellPrice = buys[i.name.toLowerCase()];
            if (sellPrice === undefined) return [];
            return [{ slot: i.slot, id: i.id, name: i.name, count: i.count, baseCost: 0, buyPrice: 0, sellPrice }];
        });
        return this.with({ shop: { isOpen: true, title, shopItems, playerItems } }).modal(SHOP_INTERFACE);
    }

    /** Sets a skill's level (and base level); `xp` defaults to what it had, else 0. Adds the skill if absent. */
    skill(name: string, level: number, xp?: number): World {
        const had = this.s.skills.find(k => k.name === name);
        const next = { name, level, baseLevel: level, experience: xp ?? had?.experience ?? 0 };
        return this.with({ skills: had ? this.s.skills.map(k => (k === had ? next : k)) : [...this.s.skills, next] });
    }

    /** Whether the client reports auto-retaliate on; a bare state leaves it unreported. */
    autoRetaliate(on: boolean): World {
        return this.with({ autoRetaliateEnabled: on });
    }

    /** Another player in view, beside the bot. */
    otherPlayer(name: string, index = 2): World {
        const { x, z } = this.at;
        return this.with({
            nearbyPlayers: [
                ...this.s.nearbyPlayers,
                { kind: 'player', index, name, combatLevel: 3, x: x + 1, z, distance: 1 },
            ],
        });
    }

    /** The bot in combat targeting NPC `index`, or with `false` out of combat with no target. */
    fighting(index: number | false): World {
        const cur = this.s.player;
        if (!cur) throw new Error('world: the base state has no player');
        const combat =
            index === false
                ? { ...cur.combat, inCombat: false, targetType: 'none' as const, targetIndex: -1 }
                : { ...cur.combat, inCombat: true, targetType: 'npc' as const, targetIndex: index };
        return this.with({ player: { ...cur, combat } });
    }

    /** A hit of `damage` the bot dealt NPC `index` on the current tick (a `damage_dealt` combat event). */
    hit(index: number, damage = 1): World {
        const event = {
            tick: this.s.tick,
            type: 'damage_dealt' as const,
            damage,
            sourceType: 'player' as const,
            sourceIndex: -1,
            targetType: 'npc' as const,
            targetIndex: index,
        };
        return this.with({ combatEvents: [...this.s.combatEvents, event] });
    }

    /**
     * The combat tab with style `current` selected; `styles` default to the unarmed tab (Punch trains
     * Attack, Kick Strength, Block Defence), as captured from the live client.
     */
    combatStyle(current: number, styles: CombatStyleOption[] = UNARMED_STYLES, known = true): World {
        return this.with({
            combatStyle: { currentStyle: current, weaponName: 'Unarmed', styles, tabInterfaceId: 5855, known },
        });
    }

    /** A dialog page the client recorded on the current tick (`recentDialogs`), one string per line. */
    recentDialog(lines: string[], interfaceId = -1): World {
        return this.with({ recentDialogs: [...this.s.recentDialogs, { text: lines, tick: this.s.tick, interfaceId }] });
    }

    /** What the player wears; `items` replace it. Ids looked up by name as for `inv`. */
    equipment(...items: { name: string; id?: number; count?: number }[]): World {
        const equipment = items.map((it, slot) => ({
            slot,
            id: itemId(it.name, it.id),
            name: cap(it.name.toLowerCase()),
            count: it.count ?? 1,
            optionsWithIndex: [],
        }));
        return this.with({ equipment });
    }

    /** A game message arriving on the current tick (type 0, system). */
    message(text: string, type = 0): World {
        const tick = this.s.tick;
        return this.with({
            gameMessages: [...this.s.gameMessages, { type, text, sender: '', tick, fromSelf: false }],
        });
    }
}

export const world = World.of;

/**
 * A fight scenario for `series`: from tick 3 (the engine refuses to start a run in combat) until tick
 * `until`, a Goblin of `foeLevel` stands next to the bot and fights it (`foe` adds its options, such
 * as `healthPercent`).
 */
export const attackedFrom = (w: World, i: number, until = Infinity, foeLevel = 2, foe: NpcOptions = {}): World =>
    i >= 3 && i < until
        ? w
              .player({ inCombat: true })
              .npcBeside('Goblin', { attacking: true, inCombat: true, combatLevel: foeLevel, ...foe })
        : w;

/** What a bank holds, one slot each in order; an `id` overrides the one looked up by name. */
export type BankContents = { name: string; count: number; id?: number }[];

/** What a shop stocks, one slot each in order: `count` on the shelf and the price to buy one. */
export type ShopContents = { name: string; count: number; buyPrice?: number; sellPrice?: number; id?: number }[];

/** What a legacy one-line state names; see `worldState`. */
export interface StateSpec {
    hp?: number;
    dialog?: boolean;
    z?: number;
    /** Woodcutting XP; its level is `level`. */
    xp?: number;
    level?: number;
    /** Shrimps (an Eat option), one per slot. */
    food?: number;
    /** The death message arrives on this state's tick. */
    dead?: boolean;
    /** The bot is fighting something. */
    inCombat?: boolean;
    /** Tick of the last damage taken. */
    lastDamageTick?: number;
    /** This main modal is open. */
    interfaceId?: number;
}

/** The common one-state shorthand of the core and engine tests: a Woodcutting bot at Lumbridge. */
export function worldState(
    tick: number,
    {
        hp = 10,
        dialog = false,
        z = LUMBRIDGE.z,
        xp = 0,
        level = 1,
        food = 0,
        dead = false,
        inCombat = false,
        lastDamageTick,
        interfaceId,
    }: StateSpec = {},
): BotWorldState {
    let w = world()
        .tick(tick)
        .player({ at: { x: LUMBRIDGE.x, z }, hp, inCombat, lastDamageTick })
        .skill('Woodcutting', level, xp);
    if (food > 0) w = w.inv('Shrimps', food);
    if (dialog) w = w.dialog();
    if (dead) w = w.message('Oh dear, you are dead!');
    if (interfaceId !== undefined) w = w.modal(interfaceId);
    return w.build();
}

/** States for ticks 0..n-1; `spec(tick)` sets what differs on each. */
export function timeline(n: number, spec: (tick: number) => StateSpec = () => ({})): BotWorldState[] {
    return Array.from({ length: n }, (_, t) => worldState(t, spec(t)));
}
