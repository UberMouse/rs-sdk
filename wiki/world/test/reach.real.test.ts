// The reach fill over the committed world.json and the collision data the SDK bundles: what a walk from the
// Lumbridge spawn reaches, and what it needs. Each fact cites the rows it rests on.
import { describe, expect, test } from 'bun:test';
import { EXPECTED_UNREACHED } from '../areas';
import { reachCollision } from '../collision';
import { loadWorld } from '../load';
import { locSizes } from '../place';
import { fillReach, LUMBRIDGE_SPAWN, MAX_SETS, type ReachInput } from '../reach';
import { readConfigs } from '../sources/configs';
import type { Tile, World } from '../types';

const world = loadWorld();
const size = locSizes(readConfigs('loc'));
const fill = (w: ReachInput['world'] = world) => fillReach({ world: w, collision: reachCollision, size });
const reach = fill();

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const stand = (id: string): Tile => {
    const s = world.sites.find(site => site.id === id);
    if (!s?.stand) throw new Error(`no site ${id} with a stand`);
    return s.stand;
};
/** The world without the connectors on these loc tiles. */
const withoutConnectors = (...locs: Tile[]): World => ({
    ...world,
    connectors: world.connectors.filter(
        c => !locs.some(l => l.x === c.loc.x && l.z === c.loc.z && l.level === c.loc.level),
    ),
});
/** Whether an area note explains a site the unreached report lists: it says so, and cites a script line. */
const explains = (note: string): boolean => note.includes('unreached report') && /\.rs2:\d+/.test(note);
/** Whether areas.ts EXPECTED_UNREACHED explains a site: an entry for it, or for an area on its path. */
const expected = (id: string, areaPath: readonly string[]): boolean =>
    EXPECTED_UNREACHED.some(e => ('site' in e ? e.site === id : areaPath.includes(e.area)));
const gateAt = (trigger: string, tile: Tile) =>
    world.gates.find(
        g => g.trigger === trigger && g.tile.x === tile.x && g.tile.z === tile.z && g.tile.level === tile.level,
    );

describe('the towns a fresh account walks to', () => {
    test('Lumbridge, Draynor, Varrock and Falador with no requirement', () => {
        expect(reach.setsAt(LUMBRIDGE_SPAWN)).toEqual([[]]);
        for (const bank of [
            'draynor-bank',
            'varrock-west-bank',
            'varrock-east-bank',
            'falador-east-bank',
            'falador-west-bank',
        ])
            expect([bank, reach.setsAt(stand(`bank:${bank}:0`))]).toEqual([bank, [[]]]);
    });

    test('Al Kharid with no requirement: round the north end of the fence, not through the toll gate', () => {
        // The toll gate takes 10 coins, or nothing once Prince Ali is rescued (areas/area_alkharid/scripts/
        // border_gate.rs2:28); the fill walls it again and crosses it only so.
        expect(gateAt('oploc1,border_gate_toll_left', at(0, 3268, 3227))?.requires).toEqual([
            ['coins:10'],
            ['quest:prince>=100'],
        ]);
        expect(reach.setsAt(stand('bank:al-kharid-bank:0'))).toEqual([[]]);
        // A walk from the spawn with every gated door walled crosses x 3264, Al Kharid's west edge, at
        // (3263, 3322) -> (3264, 3323), north of the fence, then goes south past the mine along x ~3286.
        for (const t of [at(0, 3263, 3322), at(0, 3264, 3323), at(0, 3286, 3258)])
            expect(reach.setsAt(t)).toEqual([[]]);
    });
});

describe('places behind a requirement', () => {
    test('Zanaris needs the dramen staff worn: the shed door checks the staff, not the quest', () => {
        // oploc1,zanarisdoor (quests/quest_zanaris/scripts/quest_zanaris.rs2:93): inv_total(worn, dramen_staff)
        // and map_members, jumping into Zanaris.
        expect(gateAt('oploc1,zanarisdoor', at(0, 3202, 3169))).toMatchObject({
            requires: [['item:dramen_staff:worn', 'members']],
            to: at(0, 3220, 9592),
        });
        expect(reach.setsAt(stand('bank:zanaris-bank:0'))).toEqual([['item:dramen_staff:worn']]);
        expect(reach.setsAt(at(0, 3220, 9592))).toEqual([['item:dramen_staff:worn']]);
    });

    test("Entrana only by the monks' boat, carrying no weapon or armour", () => {
        // port_sarim_to_entrana (areas/area_port_sarim/scripts/monk_of_entrana.rs2:23) lands on the deck;
        // the ship_from_entrana_off gangplank (general_use/scripts/gangplank.rs2:38) puts the player ashore.
        const ashore = at(0, 2834, 3335);
        for (const t of [ashore, stand('fishing-spot:entrana:0'), at(1, 2834, 3331)])
            expect(reach.setsAt(t)).toEqual([['loadout:entrana']]);
        const noBoat = fill({
            ...world,
            transports: world.transports.filter(t => t.route !== 'port_sarim_to_entrana'),
        });
        expect(noBoat.setsAt(ashore)).toEqual([]);
        expect(noBoat.setsAt(stand('fishing-spot:entrana:0'))).toEqual([]);
    });

    test('Musa Point on Karamja by boat and gangplank, for the 30 coin fare, or by the glider to Gandius', () => {
        // port_sarim_to_karamja (areas/area_port_sarim/scripts/sailors.rs2:31, 30 coins) lands on the deck at
        // (2956, 3143, 1), the stand of the sarimshipplank_off gangplank, which crosses to the quay at
        // (2956, 3146) (gangplank.rs2:38).
        const plank = world.connectors.find(c => c.loc.level === 1 && c.loc.x === 2956 && c.loc.z === 3144);
        expect(plank).toMatchObject({ stand: at(1, 2956, 3143), landing: at(0, 2956, 3146), relative: true });
        // The glider to Gandius (gnome_glider.rs2:1) gets there too once The Grand Tree is done, and up the gangplank.
        for (const t of [at(1, 2956, 3143), at(0, 2956, 3146), stand('fishing-spot:karamja:5')])
            expect(reach.setsAt(t)).toEqual([['coins:30'], ['quest:grandtree']]);
    });

    test('the Dwarven Mine with no requirement, through the Ice Mountain trapdoor or the Falador stairs', () => {
        // trapdoor_open (3019, 3450) climbs down to (3018, 9850) (general_use/scripts/trapdoors.rs2:11), and
        // stairs_cellar (3059, 3376) to (3058, 9776) (ladders+stairs/scripts/stairs.rs2:135).
        const [iceMountain, falador] = [at(0, 3019, 3450), at(0, 3059, 3376)];
        const mine = stand('rock:dwarven-mine:2');
        for (const t of [at(0, 3018, 9850), at(0, 3058, 9776), mine]) expect(reach.setsAt(t)).toEqual([[]]);
        expect(fill(withoutConnectors(iceMountain)).setsAt(mine)).toEqual([[]]);
        expect(fill(withoutConnectors(falador)).setsAt(mine)).toEqual([[]]);
        // Without both, no walk gets there free.
        expect(fill(withoutConnectors(iceMountain, falador)).setsAt(mine)).not.toContainEqual([]);
    }, 60_000);

    test("the Mining Guild's mine needs 60 Mining, by the guild ladder's landings", () => {
        // oploc1,miningguildladder (areas/area_falador/scripts/mining_guild.rs2:8) lands +6400 from each stand.
        const ladder = gateAt('oploc1,miningguildladder', at(0, 3018, 3339));
        expect(ladder?.requires).toEqual([['skill:mining:60']]);
        expect(ladder?.landings).toContainEqual({ stand: at(0, 3017, 3339), landing: at(0, 3017, 9739) });
        expect(reach.setsAt(at(0, 3017, 9739))).toEqual([['skill:mining:60']]);
        expect(reach.setsAt(stand('rock:mining-guild:0'))).toEqual([['skill:mining:60']]);
    });
});

describe("world.json's reach on sites", () => {
    const banks = world.sites.filter(s => s.kind === 'bank');
    const reachOf = (id: string) => world.sites.find(s => s.id === id)?.reach;

    test('every bank site has its reach; the mainland banks a walk gets to free are [[]]', () => {
        expect(banks).toHaveLength(25);
        for (const b of banks) expect(Array.isArray(b.reach)).toBe(true);
        expect(
            banks
                .filter(b => b.reach.length === 1 && b.reach[0]!.length === 0)
                .map(b => b.areaPath.at(-1))
                .sort(),
        ).toEqual([
            'al-kharid-bank',
            'ardougne-north-bank',
            'ardougne-south-bank',
            'castle-wars-bank',
            'catherby-bank',
            'draynor-bank',
            'duel-arena-bank',
            'edgeville-bank',
            'falador-east-bank',
            'falador-west-bank',
            'gnome-stronghold-bank',
            'grand-tree-bank',
            'mage-arena-bank',
            'seers-village-bank',
            'shantay-pass-bank-chest',
            'varrock-east-bank',
            'varrock-west-bank',
            'yanille-bank',
        ]);
    });

    test('a bank behind a requirement carries it: Zanaris the worn dramen staff, the Fishing Guild 68 Fishing', () => {
        expect(reachOf('bank:zanaris-bank:0')).toEqual([['item:dramen_staff:worn']]);
        // The guild door checks the level (oploc1,loc_2025, skill_fishing/scripts/fishing_guild.rs2:5).
        expect(reachOf('bank:fishing-guild-bank:0')).toEqual([['skill:fishing:68']]);
    });

    test("a stand is a tile the walk gets to: Ardougne South bank's in front of its booths, not in the bankers' pen", () => {
        // The booths stand at x 2656 with the bankers east of them; the stand used to be the counter's north end
        // (2656, 3287), walled in with the bankers.
        const s = world.sites.find(site => site.id === 'bank:ardougne-south-bank:0')!;
        expect(s.stand!.x).toBeLessThan(2656);
        expect(s.reach).toEqual([[]]);
        expect(reach.setsAt(s.stand!)).toEqual([[]]);
    });

    test('each unreached bank and shop is explained, citing a script line, in a note of its area or an ancestor, or by EXPECTED_UNREACHED', () => {
        const notes = new Map(world.areas.map(a => [a.id, a.notes ?? '']));
        expect(EXPECTED_UNREACHED.every(e => /\.rs2:\d+$/.test(e.source))).toBe(true);
        const unexplained = world.sites
            .filter(s => (s.kind === 'bank' || s.kind === 'shop') && !s.reach.length)
            .filter(s => !s.areaPath.some(id => explains(notes.get(id)!)) && !expected(s.id, s.areaPath))
            .map(s => s.id);
        expect(unexplained).toEqual([]);
    });

    test("an npc cluster's reach is over the tiles beside its spawns: the Lumbridge men free, Zanaris's behind the staff", () => {
        const spawn = (config: string, leaf: string) =>
            world.npcSpawns.find(c => c.config === config && c.areaPath.at(-1) === leaf);
        expect(spawn('man', 'lumbridge')?.reach).toEqual([[]]);
        expect(world.npcSpawns.filter(c => c.areaPath[0] === 'zanaris').map(c => c.reach)).toContainEqual([
            ['item:dramen_staff:worn'],
        ]);
    });
});

describe('the fill', () => {
    test('the mainland zones the walker allocates as open are not land, and the fill never enters one', () => {
        let fillZone: Tile | undefined;
        for (let x = 2304; x <= 3392 && !fillZone; x += 8)
            for (let z = 2944; z <= 3584 && !fillZone; z += 8)
                if (!reachCollision.land(0, x, z) && reachCollision.walkable(0, x, z)) fillZone = at(0, x, z);
        expect(fillZone).toBeDefined();
        expect(reach.setsAt(fillZone!)).toEqual([]);
        expect(reach.report.offLand).toBeGreaterThan(0);
    });

    test(`no tile needs more than ${MAX_SETS} minimal sets, and the typed arrays stay small`, () => {
        expect(reach.report.bound.tiles).toBe(0);
        expect(reach.report.bytes).toBeLessThan(96 * 2 ** 20);
        expect(reach.report.reached).toBeGreaterThan(400_000);
    });

    test('the collision edits are undone: a gated door is open again for the walker', () => {
        // The toll gate's west tile steps east through it, as the bundle has every door it lists open.
        expect(reachCollision.canStep(0, 3267, 3227, 1, 0)).toBe(true);
    });
});
