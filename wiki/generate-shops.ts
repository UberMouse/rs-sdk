#!/usr/bin/env bun
/**
 * Shop Wiki Generator
 * Parses server content files and generates markdown wiki pages for all shops.
 * Run: bun wiki/generate-shops.ts
 */

import { readFileSync, readdirSync } from 'fs';
import { basename, join, relative } from 'path';
import { codeOf, membersCode } from './world/classify';
import { loadFreshWorld } from './world/load';
import { centreOf } from './world/place';
import { priorReadme, stalePages, WIKI_README, writePages, type Pages } from './world/stale';
import { areaCell, areasOf, coord } from './world/render/common';
import { readCallables, readTriggers } from './world/sources/triggers';
import type { Site, Tile, World } from './world/types';
import { readPack } from './world/sources/packs';
import { cmp, packId } from './world/util';

const CONTENT_DIR = join(import.meta.dir, '..', 'server', 'content');
/** The pages' folder, repo-relative. */
const SHOP_DIR = 'wiki/shops';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockItem {
    configName: string;
    quantity: number;
    price: number;
}

interface ShopInventory {
    name: string; // section name e.g. "axeshop"
    scope: string;
    restock: boolean;
    allstock: boolean;
    size: number;
    stock: StockItem[];
    sourcePath: string;
}

interface ShopOwner {
    npcConfigName: string;
    npcDisplayName: string;
    shopName: string; // matches ShopInventory.name
    shopTitle: string;
    sellMultiplier: number;
    buyMultiplier: number;
    delta: number;
    sourcePath: string;
}

interface ShopPage {
    shopName: string;
    shopTitle: string;
    inventory: ShopInventory;
    owners: ShopOwner[];
    /** Npcs with a shop feature of this inventory in the world index that no owned_shop param names (Razmire). */
    keepers: string[];
    location: string;
    isGeneralStore: boolean;
}

// ─── Area Name Mappings ──────────────────────────────────────────────────────

const SOURCE_PATH_AREAS: Record<string, string> = {
    'area_lumbridge': 'Lumbridge',
    'area_alkharid': 'Al Kharid',
    'area_ardougne_east': 'East Ardougne',
    'area_ardougne_west': 'West Ardougne',
    'area_barbarian_village': 'Barbarian Village',
    'area_barbarian_outpost': 'Barbarian Outpost',
    'area_brimhaven': 'Brimhaven',
    'area_camelot': 'Camelot',
    'area_canifis': 'Canifis',
    'area_catherby': 'Catherby',
    'area_combat_training': 'Combat Training Camp',
    'area_desert': 'Desert',
    'area_draynor': 'Draynor Village',
    'area_edgeville': 'Edgeville',
    'area_entrana': 'Entrana',
    'area_falador': 'Falador',
    'area_fishing_platform': 'Fishing Platform',
    'area_gnome': 'Tree Gnome Stronghold',
    'area_karamja': 'Karamja',
    'area_lostcity': 'Zanaris',
    'area_mage_arena': 'Mage Arena',
    'area_port_sarim': 'Port Sarim',
    'area_rimmington': 'Rimmington',
    'area_seers': "Seers' Village",
    'area_shilo': 'Shilo Village',
    'area_taverly': 'Taverley',
    'area_varrock': 'Varrock',
    'area_white_wolf_mountain': 'White Wolf Mountain',
    'area_wilderness': 'Wilderness',
    'area_wizard_tower': 'Wizard Tower',
    'area_yanille': 'Yanille',
    'areas_heroes_guild': "Heroes' Guild",
    'monastery': 'Monastery',
};

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseInvConfigs(content: string, sourcePath: string): ShopInventory[] {
    const shops: ShopInventory[] = [];
    let current: ShopInventory | null = null;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('//') || line.startsWith('/ ')) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            if (current && current.stock.length > 0) shops.push(current);
            current = {
                name: sectionMatch[1]!,
                scope: '',
                restock: false,
                allstock: false,
                size: 40,
                stock: [],
                sourcePath,
            };
            continue;
        }

        if (!current || !line) continue;

        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();

        if (key === 'scope') current.scope = value;
        else if (key === 'restock') current.restock = value === 'yes';
        else if (key === 'allstock') current.allstock = value === 'yes';
        else if (key === 'size') current.size = parseInt(value) || 40;
        else if (key.startsWith('stock')) {
            const parts = value.split(',');
            if (parts.length >= 3) {
                current.stock.push({
                    configName: parts[0]!.trim(),
                    quantity: parseInt(parts[1]!) || 0,
                    price: parseInt(parts[2]!) || 0,
                });
            }
        }
    }
    if (current && current.stock.length > 0) shops.push(current);
    return shops;
}

interface NpcShopInfo {
    configName: string;
    displayName: string;
    params: Map<string, string>;
    sourcePath: string;
}

function parseNpcConfigs(content: string, sourcePath: string): NpcShopInfo[] {
    const results: NpcShopInfo[] = [];
    let currentName = '';
    let currentDisplayName = '';
    let currentParams = new Map<string, string>();

    function flush() {
        if (currentName && currentParams.has('owned_shop')) {
            results.push({
                configName: currentName,
                displayName: currentDisplayName,
                params: currentParams,
                sourcePath,
            });
        }
    }

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('//') || line.startsWith('/ ')) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            flush();
            currentName = sectionMatch[1]!;
            currentDisplayName = '';
            currentParams = new Map();
            continue;
        }

        if (!currentName || !line) continue;

        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();

        if (key === 'name') currentDisplayName = value;
        else if (key === 'param') {
            const commaIdx = value.indexOf(',');
            if (commaIdx !== -1) {
                currentParams.set(value.slice(0, commaIdx), value.slice(commaIdx + 1));
            }
        }
    }
    flush();
    return results;
}

interface ObjInfo {
    displayName: string;
    cost: number;
}

// ─── Coordinates from the World Index ────────────────────────────────────────

// A `~openshop(<inv>, ...)` call (shop/scripts/shop.rs2 [proc,openshop]).
const OPENSHOP = /~openshop\(\s*([a-z0-9_]+)\s*,/g;
// The call's next three args, `int $shop_buy, int $shop_sell, int $shop_haggle` (shop.rs2:3), as integer literals.
const OPENSHOP_PRICES = /^~openshop\(\s*[a-z0-9_]+\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,/;

/** Per mille of an item's value at normal stock: `sell` is what the player pays, `buy` what the player gets. */
export interface Multipliers {
    sell: number;
    buy: number;
    haggle: number;
}

/** One explicit ~openshop call: `<file>:<line>` under server/content/scripts, and its multipliers when literals. */
export interface OpenshopCall {
    at: string;
    prices?: Multipliers;
}

/** The ~openshop calls in a script body whose header is `line` of `file`, by the inv each opens. */
export function openshopCalls(file: string, line: number, body: string): { inv: string; call: OpenshopCall }[] {
    const text = code(body);
    return [...text.matchAll(OPENSHOP)].map(m => {
        const at = `${file}:${line + text.slice(0, m.index).split('\n').length - 1}`;
        const p = text.slice(m.index).match(OPENSHOP_PRICES);
        // shop.rs2:5-6: %shop_buy prices what the shop buys (adjusted_item_cost_selling, :152), %shop_sell what it sells (:141).
        return { inv: m[1]!, call: p ? { at, prices: { buy: +p[1]!, sell: +p[2]!, haggle: +p[3]! } } : { at } };
    });
}

// The multipliers a page uses when nothing names the shop's own (an owned_shop owner's params default to these too).
const DEFAULT_PRICES = { sell: 1000, buy: 600 };

/**
 * The multipliers an ownerless shop's page prices its stock by, one set per distinct set its ~openshop calls
 * pass, and the line saying where they come from. A call whose multipliers are not literals is named, not read.
 */
export function ownerlessPricing(calls: readonly OpenshopCall[]): { sets: { sell: number; buy: number }[]; note: string } {
    const bySet = new Map<string, { prices: Multipliers; ats: string[] }>();
    for (const { at, prices } of calls) {
        if (!prices) continue;
        const key = `${prices.sell}/${prices.buy}/${prices.haggle}`;
        if (!bySet.has(key)) bySet.set(key, { prices, ats: [] });
        if (!bySet.get(key)!.ats.includes(at)) bySet.get(key)!.ats.push(at);
    }
    const groups = [...bySet.values()].sort((a, b) => cmp(a.ats[0]!, b.ats[0]!));
    const unread = [...new Set(calls.filter(c => !c.prices).map(c => c.at))].sort(cmp);
    const unreadNote = unread.length === 0 ? '' :
        ` The \`~openshop\` call at ${unread.join(', ')} passes multipliers that are not integer literals, which this page does not read.`;
    const lead = "No npc's `owned_shop` param names this shop";
    const numbers = ({ prices, ats }: (typeof groups)[number]) =>
        `${prices.sell} to buy, ${prices.buy} to sell, haggle delta ${prices.haggle} (${ats.join(', ')})`;
    if (groups.length === 0) {
        const why = unread.length === 0 ? ' and no `~openshop` call opens it' : '';
        return {
            sets: [DEFAULT_PRICES],
            note: `${lead}${why}, so these prices use this page's default multipliers (${DEFAULT_PRICES.sell} to buy, ${DEFAULT_PRICES.buy} to sell, per mille of value), not a shopkeeper's.${unreadNote}`,
        };
    }
    const sets = groups.map(g => ({ sell: g.prices.sell, buy: g.prices.buy }));
    if (groups.length === 1)
        return { sets, note: `${lead}; these prices use the multipliers its \`~openshop\` call passes, per mille of value at normal stock: ${numbers(groups[0]!)}.${unreadNote}` };
    return {
        sets,
        note: `${lead}, and its \`~openshop\` calls pass different multipliers, per mille of value at normal stock: ${groups.map(numbers).join('; ')}. Each price below gives them in that order.${unreadNote}`,
    };
}

interface Openers {
    files: Set<string>; // script file names making the call
    npcs: Set<string>; // npc configs whose own op trigger reaches the call
    members: boolean; // some call is on a branch a members world runs (classify.ts membersCode)
    calls: OpenshopCall[]; // every call, wherever it is reached from
}

/** A script body without its `//` comments, so a commented-out call is no call. */
const code = (body: string): string => body.split('\n').map(line => line.replace(/\/\/.*/, '')).join('\n');

/**
 * Who opens each inventory by an explicit ~openshop call: the files making the call, and the npcs
 * whose op trigger reaches it through the procs and labels it calls (`~name`, `@name`, `jump(name)`).
 * A label reached only as a dialogue choice's argument is not followed (classify.ts binds those).
 */
function readOpeners(): Map<string, Openers> {
    const openers = new Map<string, Openers>();
    const opener = (inv: string): Openers => {
        if (!openers.has(inv)) openers.set(inv, { files: new Set(), npcs: new Set(), members: false, calls: [] });
        return openers.get(inv)!;
    };
    const invsIn = (body: string): string[] => [...code(body).matchAll(OPENSHOP)].map(m => m[1]!);
    const callsIn = (body: string): string[] => [
        ...[...code(body).matchAll(/[@~][a-z0-9_]+/g)].map(m => m[0]),
        ...[...code(body).matchAll(/\bjump\(([a-z0-9_]+)\)/g)].map(m => `@${m[1]}`),
    ];

    const callables = readCallables();
    const callable = new Map(callables.map(c => [c.call, c.body]));
    const membersInvs = (body: string): string[] => [...membersCode(codeOf(body)).matchAll(OPENSHOP)].map(m => m[1]!);
    const triggers = readTriggers();
    for (const s of [...callables, ...triggers]) {
        for (const { inv, call } of openshopCalls(s.file, s.line, s.body)) {
            opener(inv).files.add(basename(s.file));
            opener(inv).calls.push(call);
        }
        for (const inv of membersInvs(s.body)) opener(inv).members = true;
    }
    for (const t of triggers) {
        if (t.on !== 'npc' || t.category) continue;
        const bodies = [t.body];
        const seen = new Set<string>();
        for (let i = 0; i < bodies.length; i++) {
            for (const inv of invsIn(bodies[i]!)) opener(inv).npcs.add(t.target);
            for (const call of callsIn(bodies[i]!)) {
                const body = callable.get(call);
                if (body === undefined || seen.has(call)) continue;
                seen.add(call);
                bodies.push(body);
            }
        }
    }
    return openers;
}

/**
 * The Coordinates a shop page shows, from the world index:
 * - Each shop site holding a feature that opens the page's inventory (the shop feature's subtype):
 *   the mean tile of those features there, which is the shopkeeper's spawn when one keeps it, and the
 *   site's area linked to its place page.
 * - A shop no site records is "not placed", with the reason in the data (world.real.test.ts pins
 *   these pages): no script opens the inventory, or one opens it only off members worlds (classify.ts
 *   reads members worlds only, membersCode), or one does but no shop feature has it (classify.ts
 *   gives a shopkeeper a feature per inventory its triggers open, so only an unplaced or unclassified
 *   opener leaves one out). Where that script is reached from an npc's own op trigger, the npc's shop
 *   sites follow; a call reached only through a dialogue choice's label argument names no npc, so
 *   only the file is given.
 */
function shopLocator(world: World, openers: Map<string, Openers>): (inv: string, pagePath: string) => string {
    const areas = areasOf(world);
    const siteOf = new Map<number, Site>();
    for (const site of world.sites) {
        for (const i of site.features) siteOf.set(i, site);
    }
    const shops = world.features.flatMap((f, i) => {
        if (f.kind !== 'shop') return [];
        const site = siteOf.get(i);
        if (!site) throw new Error(`world.json: feature ${i} (${f.config}) is in no site`);
        return [{ f, site }];
    });

    // "(x, z) in [Area (Town)](link)" per site, the sites in label order.
    const placed = (fs: typeof shops, pagePath: string): string[] => {
        const bySite = new Map<Site, Tile[]>();
        for (const { f, site } of fs) bySite.set(site, [...(bySite.get(site) || []), f.tile]);
        return [...bySite]
            .map(([site, tiles]) => ({ site, centre: centreOf(tiles) }))
            .sort((a, b) =>
                cmp(areas.label(a.site.areaPath), areas.label(b.site.areaPath)) ||
                a.centre.level - b.centre.level || a.centre.x - b.centre.x || a.centre.z - b.centre.z
            )
            .map(({ site, centre }) => `${coord(centre)} in ${areaCell(pagePath, areas, site.areaPath)}`);
    };

    return (inv, pagePath) => {
        const own = placed(shops.filter(s => s.f.subtype === inv), pagePath);
        if (own.length > 0) return own.join('; ');
        const o = openers.get(inv);
        if (!o) return 'not placed: no script opens this inventory';
        const files = [...o.files].sort().join(', ');
        if (!o.members) return `not placed: ${files} opens it only off members worlds, on the other branch of a map_members test`;
        // Shop features of the npcs whose trigger opens it: none has this inventory, or it would be placed.
        const keepers = shops.filter(s => o.npcs.has(s.f.config));
        if (keepers.length === 0) return `not placed: ${files} opens it, but no shop site records it`;
        const names = [...new Set(keepers.map(s => s.f.name))].sort().join(', ');
        return `not placed: ${files} opens it from ${names}, whose shop site records another of their shops; ${names} at ${placed(keepers, pagePath).join('; ')}`;
    };
}

function parseObjConfigsFull(content: string): Map<string, ObjInfo> {
    const items = new Map<string, ObjInfo>();
    let currentName = '';
    let currentDisplayName = '';
    let currentCost = 0;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('//') || line.startsWith('/ ')) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            if (currentName && currentDisplayName) {
                items.set(currentName, { displayName: currentDisplayName, cost: currentCost });
            }
            currentName = sectionMatch[1]!;
            currentDisplayName = '';
            currentCost = 0;
            continue;
        }

        if (line.startsWith('name=')) {
            currentDisplayName = line.slice(5);
        } else if (line.startsWith('cost=')) {
            currentCost = parseInt(line.slice(5)) || 0;
        }
    }
    if (currentName && currentDisplayName) {
        items.set(currentName, { displayName: currentDisplayName, cost: currentCost });
    }
    return items;
}

function findFilesRecursive(dir: string, ext: string): string[] {
    const results: string[] = [];
    function walk(d: string) {
        // By name: the filesystem lists in no fixed order.
        const entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name));
        for (const entry of entries) {
            const fullPath = join(d, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            else if (entry.name.endsWith(ext)) results.push(fullPath);
        }
    }
    walk(dir);
    return results;
}

function prettifyConfigName(name: string): string {
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

function getAreaFromSourcePath(sourcePath: string): string {
    const match = sourcePath.match(/scripts\/(?:areas\/)?(\w+)\//);
    if (!match) return 'Unknown';
    return SOURCE_PATH_AREAS[match[1]!] || prettifyConfigName(match[1]!);
}

function slugify(name: string): string {
    return name.toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * The shop pages for `world`, wiki/README.md with its Shops section rewritten (from `prior`, an earlier step's
 * files, else from disk), and the pages in wiki/shops that are not among them, without touching the disk.
 * `log` gets the progress lines.
 */
export function shopPages(
    world: World,
    prior: ReadonlyMap<string, string> = new Map(),
    log: (line: string) => void = () => {},
): Pages {
    log('Shop Wiki Generator');
    log('===================\n');

    // ─── Step 1: Parse shop inventories ─────────────────────────────────

    log('Step 1: Parsing shop inventories...');

    const invFiles = findFilesRecursive(join(CONTENT_DIR, 'scripts'), '.inv');
    const allShops = new Map<string, ShopInventory>();

    for (const file of invFiles) {
        const content = readFileSync(file, 'utf-8');
        const relPath = relative(CONTENT_DIR, file);
        const shops = parseInvConfigs(content, relPath);
        for (const shop of shops) {
            // Filter non-shop inventories: must have restock=yes and not be temp scope
            if (shop.restock && shop.scope !== 'temp') {
                allShops.set(shop.name, shop);
            }
        }
    }
    log(`  Found ${allShops.size} shop inventories from ${invFiles.length} .inv files`);

    // ─── Step 2: Parse shop owner NPCs ──────────────────────────────────

    log('\nStep 2: Parsing shop owner NPCs...');

    const npcFiles = findFilesRecursive(join(CONTENT_DIR, 'scripts'), '.npc');
    const shopOwners = new Map<string, ShopOwner[]>(); // shopName -> owners

    for (const file of npcFiles) {
        const content = readFileSync(file, 'utf-8');
        const relPath = relative(CONTENT_DIR, file);
        const npcs = parseNpcConfigs(content, relPath);

        for (const npc of npcs) {
            const shopName = npc.params.get('owned_shop')!;
            const owner: ShopOwner = {
                npcConfigName: npc.configName,
                npcDisplayName: npc.displayName,
                shopName,
                shopTitle: npc.params.get('shop_title') || prettifyConfigName(shopName),
                sellMultiplier: parseInt(npc.params.get('shop_sell_multiplier') || '1000'),
                buyMultiplier: parseInt(npc.params.get('shop_buy_multiplier') || '600'),
                delta: parseInt(npc.params.get('shop_delta') || '10'),
                sourcePath: relPath,
            };

            if (!shopOwners.has(shopName)) shopOwners.set(shopName, []);
            shopOwners.get(shopName)!.push(owner);
        }
    }

    // In the game's id order (npc.pack): the first owner, whose title and area the page takes, is the npc it
    // defines first.
    const npcIds = readPack('npc').id;
    for (const owners of shopOwners.values())
        owners.sort((a, b) => cmp(packId(npcIds, a.npcConfigName), packId(npcIds, b.npcConfigName)));

    let totalOwners = 0;
    for (const owners of shopOwners.values()) totalOwners += owners.length;
    log(`  Found ${totalOwners} shop owners for ${shopOwners.size} shops`);

    // ─── Step 3: Load item data (names + costs) ────────────────────────

    log('\nStep 3: Loading item data...');

    const objData = new Map<string, ObjInfo>();
    const allObjContent = readFileSync(join(CONTENT_DIR, 'scripts', '_unpack', '225', 'all.obj'), 'utf-8');
    const allObjData = parseObjConfigsFull(allObjContent);
    for (const [k, v] of allObjData) objData.set(k, v);

    const objConfigFiles = findFilesRecursive(join(CONTENT_DIR, 'scripts'), '.obj');
    for (const file of objConfigFiles) {
        if (file.includes('_unpack')) continue;
        const content = readFileSync(file, 'utf-8');
        const parsed = parseObjConfigsFull(content);
        for (const [k, v] of parsed) {
            const existing = objData.get(k);
            if (existing) {
                // Merge: override name/cost if set
                if (v.displayName) existing.displayName = v.displayName;
                if (v.cost) existing.cost = v.cost;
            } else {
                objData.set(k, v);
            }
        }
    }
    log(`  Loaded ${objData.size} items`);

    // ─── Step 3b: Shop coordinates from the world index ─────────────────

    log('\nStep 3b: Loading shop sites from the world index...');

    const openers = readOpeners();
    const locate = shopLocator(world, openers);
    log(`  world.json: ${world.sites.filter(s => s.kind === 'shop').length} shop sites`);

    // ─── Step 4: Build shop pages ───────────────────────────────────────

    log('\nStep 4: Building shop pages...');

    const built: ShopPage[] = [];

    // inventory -> npc config -> name, from the world index's npc shop features.
    const featureKeepers = new Map<string, Map<string, string>>();
    for (const f of world.features) {
        if (f.kind !== 'shop' || f.source !== 'npc') continue;
        if (!featureKeepers.has(f.subtype)) featureKeepers.set(f.subtype, new Map());
        featureKeepers.get(f.subtype)!.set(f.config, f.name);
    }

    for (const [shopName, inventory] of allShops) {
        const owners = shopOwners.get(shopName) || [];
        const ownerConfigs = new Set(owners.map(o => o.npcConfigName));
        const keepers = [...new Set(
            [...(featureKeepers.get(shopName) || [])].filter(([config]) => !ownerConfigs.has(config)).map(([, name]) => name)
        )].sort(cmp);
        const primaryOwner = owners[0];

        const shopTitle = (primaryOwner?.shopTitle || prettifyConfigName(shopName)).replace(/\.$/, '');
        const location = primaryOwner
            ? getAreaFromSourcePath(primaryOwner.sourcePath)
            : getAreaFromSourcePath(inventory.sourcePath);

        built.push({
            shopName,
            shopTitle,
            inventory,
            owners,
            keepers,
            location,
            isGeneralStore: inventory.allstock,
        });
    }

    // Sort by shop title
    built.sort((a, b) => cmp(a.shopTitle, b.shopTitle));
    log(`  Built ${built.length} shop pages`);

    // ─── Step 5: Generate markdown ──────────────────────────────────────

    log('\nStep 5: Generating markdown...');

    const pageIndex: { name: string; file: string; location: string }[] = [];
    const files = new Map<string, string>();
    const nameOfFile = new Map<string, string>();

    for (const page of built) {
        const slug = slugify(page.shopTitle);
        const fileName = `${slug}.md`;
        const first = nameOfFile.get(fileName);
        if (first !== undefined) throw new Error(`two pages slug to ${fileName}: ${first} and ${page.shopName}`);
        nameOfFile.set(fileName, page.shopName);
        const path = `${SHOP_DIR}/${fileName}`;
        files.set(path, generateShopMarkdown(page, objData, locate(page.shopName, path), openers.get(page.shopName)?.calls ?? []));

        pageIndex.push({ name: page.shopTitle, file: fileName, location: page.location });
    }

    log(`  Generated ${pageIndex.length} shop pages`);

    // Every page here is generated, so one not written now is for a shop
    // whose title has changed or gone: it would keep stale data.
    const stale = stalePages(SHOP_DIR, files);

    // ─── Step 6: Update README ──────────────────────────────────────────

    log('\nStep 6: Updating README...');
    const readme = updateReadme(priorReadme(prior), pageIndex, log);
    if (readme !== undefined) files.set(WIKI_README, readme);

    log('\nDone!');
    return { files, stale };
}

// ─── Generate Markdown ───────────────────────────────────────────────────────

function generateShopMarkdown(
    page: ShopPage,
    objData: Map<string, ObjInfo>,
    coordinates: string,
    calls: readonly OpenshopCall[],
): string {
    const lines: string[] = [];
    const primaryOwner = page.owners[0];

    // Price multipliers (confusing naming in source: shop_sell_multiplier = price when shop sells TO player):
    // the first owned_shop owner's params, else what the ~openshop calls pass (ownerlessPricing).
    const ownerless = primaryOwner ? undefined : ownerlessPricing(calls);
    const sets = primaryOwner
        ? [{ sell: primaryOwner.sellMultiplier || DEFAULT_PRICES.sell, buy: primaryOwner.buyMultiplier || DEFAULT_PRICES.buy }]
        : ownerless!.sets;

    lines.push(`# ${page.shopTitle}`);
    lines.push('');

    // Info table
    lines.push('| Detail | |');
    lines.push('|---|---|');

    // Owner(s)
    const ownerNames = [...page.owners.map(o => o.npcDisplayName), ...page.keepers];
    if (ownerNames.length > 0) {
        const ownerLinks = ownerNames.map(name => {
            const npcSlug = slugify(name);
            const npcPagePath = `../npcs/${npcSlug}.md`;
            return `[${name}](${npcPagePath})`;
        });
        lines.push(`| **Owner** | ${ownerLinks.join(', ')} |`);
    } else {
        lines.push('| **Owner** | Unknown |');
    }

    lines.push(`| **Location** | ${page.location} |`);

    // Where the shop's sites are (shopLocator), so agents can walk straight to
    // the shop instead of guessing from the area name alone.
    lines.push(`| **Coordinates** | ${coordinates} |`);

    lines.push(`| **Type** | ${page.isGeneralStore ? 'General Store' : 'Specialty Shop'} |`);

    lines.push('');

    // Stock table with computed prices
    lines.push('## Stock');
    lines.push('');
    if (ownerless) {
        lines.push(ownerless.note);
        lines.push('');
    }
    lines.push('| Item | Stock | Buy Price | Sell Price |');
    lines.push('|------|-------|-----------|------------|');

    for (const item of page.inventory.stock) {
        const info = objData.get(item.configName);
        const displayName = info?.displayName || prettifyConfigName(item.configName);
        const baseCost = info?.cost || 0;

        // Buy price = what player pays to buy from shop (at normal stock)
        const buyPrice = sets.map(m => `${Math.max(1, Math.floor(baseCost * m.sell / 1000))} gp`).join(' / ');
        // Sell price = what player gets selling to shop (at normal stock)
        const sellPrice = sets.map(m => `${Math.floor(baseCost * m.buy / 1000)} gp`).join(' / ');

        const itemSlug = slugify(displayName);
        const itemLink = `[${displayName}](../items/${itemSlug}.md)`;
        lines.push(`| ${itemLink} | ${item.quantity} | ${buyPrice} | ${sellPrice} |`);
    }

    lines.push('');
    return lines.join('\n');
}

// ─── Update README ───────────────────────────────────────────────────────────

/** `readme` with its Shops section rewritten for `pages`; undefined when there is no README. */
function updateReadme(
    readme: string | undefined,
    pages: { name: string; file: string; location: string }[],
    log: (line: string) => void,
): string | undefined {
    if (readme === undefined) {
        log('  No wiki/README.md; skipping index update');
        return undefined;
    }
    let content = readme;

    // Remove existing Shops section if present
    const shopsStart = content.indexOf('## Shops');
    if (shopsStart !== -1) {
        const afterShops = content.slice(shopsStart + 8);
        const nextSection = afterShops.search(/\n## /);
        if (nextSection !== -1) {
            content = content.slice(0, shopsStart) + content.slice(shopsStart + 8 + nextSection + 1);
        } else {
            content = content.slice(0, shopsStart).trimEnd() + '\n';
        }
    }

    // Sort alphabetically
    pages.sort((a, b) => cmp(a.name, b.name));

    // Generate Shops section
    const section = [
        '## Shops',
        '',
        '| Shop | Location |',
        '|------|----------|',
    ];

    for (const page of pages) {
        section.push(`| [${page.name}](shops/${page.file}) | ${page.location} |`);
    }
    section.push('');

    // Insert before NPCs section if it exists, otherwise append
    const npcsStart = content.indexOf('## NPCs');
    if (npcsStart !== -1) {
        content = content.slice(0, npcsStart) + section.join('\n') + '\n' + content.slice(npcsStart);
    } else {
        content = content.trimEnd() + '\n\n' + section.join('\n');
    }

    log(`  Updated README.md with ${pages.length} shop entries`);
    return content;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
    // First, so a stale world.json fails before any parsing.
    const pages = shopPages(loadFreshWorld(), new Map(), console.log);
    writePages(pages);
    for (const p of pages.stale) console.log(`  Removed stale ${basename(p)}`);
}
