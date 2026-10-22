// The distances to sinks over the committed world.json and the collision data the SDK bundles: the nearest bank
// of real sites against the walks bots recorded there. Each check names its evidence and its tolerance.
import { describe, expect, test } from 'bun:test';
import { reachCollision } from '../collision';
import { nearestSinks } from '../distance';
import { loadWorld } from '../load';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import { readConfigs } from '../sources/configs';
import { cameFromContext } from '../sources/npc-teleports';
import type { Tile } from '../types';

const world = loadWorld();
const graph = reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) });
// As the build searches them: a context takes the essence mine's came-from requirements.
const context = cameFromContext(world.crossings);
const { nearest } = nearestSinks(graph, world.sites, { context });

const site = (id: string) => {
    const s = world.sites.find(x => x.id === id);
    if (!s) throw new Error(`no site ${id}`);
    return s;
};
const bankOf = (id: string) => nearest.get(id)?.bank;
const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

test("world.json's nearest is what distance.ts computes from its graph", () => {
    for (const s of world.sites) expect([s.id, s.nearest]).toEqual([s.id, nearest.get(s.id)]);
});

test('searching every context in full finds what the improvement-only searches find', () => {
    // All four sink kinds and all their contexts, each run from the sinks until its targets settle.
    const full = nearestSinks(graph, world.sites, { full: true, context });
    expect(full.report.contexts).toEqual(nearestSinks(graph, world.sites, { context }).report.contexts);
    for (const s of world.sites) expect([s.id, full.nearest.get(s.id)]).toEqual([s.id, nearest.get(s.id)]);
}, 120_000);

// Walk legs bots ran between a site and its bank, from the per-tick positions of conductor run recordings
// (conductor/runs/<bot>/*.ticks.ndjson.gz, local server, run energy 100 throughout): the tiles the route took and
// the ticks it took. A leg measured `ticks` runs 0-11 over ceil(route / 2), for the walker's pauses and turns, and
// starts or ends a few tiles from the site's stand tile. The tolerance: the computed run ticks lie within 4 of
// ceil(route / 2), which covers a stand up to ~8 tiles from the leg's end, and at most 4 over the leg's ticks.
const LEGS: { site: string; bank: string; route: number; ticks: number; evidence: string }[] = [
    {
        // Bank (3092, 3243) to the willows at (3085, 3237): out the bank's north door, west, then south. The
        // woodcutting.md row says "~12-tile walk each way".
        site: 'tree:draynor-willows:0',
        bank: 'bank:draynor-bank:0',
        route: 19,
        ticks: 10,
        evidence: 'conductor2 2026-10-11T07-38-49-352Z-woodcutting, 07-40-43-761Z-woodcutting',
    },
    {
        // Bank (3092, 3242) to the net spot (3087, 3227), the same way out.
        site: 'fishing-spot:draynor-fishing:0',
        bank: 'bank:draynor-bank:0',
        route: 31,
        ticks: 19,
        evidence: 'conductor2 2026-10-11T00-49-48-337Z-fishing',
    },
    {
        // (3288, 3369) to (3252, 3420): north along x ~3289, then west into the bank from its north side; 8 legs,
        // 53-56 ticks. wiki/skills/smithing.md has this walk and a deposit at ~24 s.
        site: 'rock:varrock-east-mine:0',
        bank: 'bank:varrock-east-bank:0',
        route: 92,
        ticks: 53,
        evidence: 'conductor2 bank runs 2026-10-16T05-37..05-47, 2026-10-11T07-16-57',
    },
    {
        // The willow grove (2711, 3510) to the bank (2727, 3493), in from its south side; 19 legs, 22-23 ticks.
        site: 'tree:kandarin:71',
        bank: 'bank:seers-village-bank:0',
        route: 36,
        ticks: 22,
        evidence: 'conductor2w3 2026-10-16T09-19..09-34 bank and woodcutting runs',
    },
    {
        // The market (2659, 3300) to the bank (2655, 3283), round by its west entrance; thieving.md has a ~15 s
        // round trip.
        site: 'pickpocket:east-ardougne:8',
        bank: 'bank:ardougne-south-bank:0',
        route: 49,
        ticks: 29,
        evidence: 'conductor2w3 2026-10-16T08-00-34-bank, 08-23-22-bank',
    },
    {
        // The furnace (3275, 3185) to the bank (3269, 3164); 6 legs, 17-19 ticks.
        site: 'furnace:al-kharid:0',
        bank: 'bank:al-kharid-bank:0',
        route: 30,
        ticks: 17,
        evidence: 'conductor2 bank runs 2026-10-16',
    },
    {
        // The anvils (3188, 3423) to the bank (3185, 3436); 6 legs, 9-12 ticks.
        site: 'anvil:varrock:0',
        bank: 'bank:varrock-west-bank:0',
        route: 16,
        ticks: 9,
        evidence: 'conductor2 bank runs 2026-10-16',
    },
    {
        // The anvils (3246, 3405) to the bank (3252, 3420); 10 legs, 25-29 ticks.
        site: 'anvil:varrock:3',
        bank: 'bank:varrock-east-bank:0',
        route: 40,
        ticks: 25,
        evidence: 'conductor2 bank runs 2026-10-16',
    },
    {
        // From (3287, 3281), just south of the mine's south site, to the bank (3269, 3164): straight south along
        // x 3279-3287, round the toll gate (learnings/hazards.md); 65 ticks.
        site: 'rock:al-kharid-mine:1',
        bank: 'bank:al-kharid-bank:0',
        route: 121,
        ticks: 65,
        evidence: 'conductor2 2026-10-16T05-47-30-010Z-bank',
    },
];

describe('the nearest bank against walks bots ran', () => {
    for (const leg of LEGS)
        test(`${leg.site} -> ${leg.bank} (${leg.evidence})`, () => {
            const b = bankOf(leg.site);
            expect(b?.site).toBe(leg.bank);
            expect(b?.requires).toEqual([]);
            expect(Math.abs(b!.runTicks - Math.ceil(leg.route / 2))).toBeLessThanOrEqual(4);
            // Never more than the leg took.
            expect(b!.runTicks).toBeLessThanOrEqual(leg.ticks + 4);
        });

    test('the Varrock West mine banks at Varrock West: no walk recorded, so between the straight line and 30% over', () => {
        // No bot mined there (no leg in the recordings). The stands are 70 tiles apart (Chebyshev), so at least 35
        // run ticks; the walk is allowed 30% over that.
        const b = bankOf('rock:varrock-west-mine:0')!;
        expect(b.site).toBe('bank:varrock-west-bank:0');
        const floor = Math.ceil(cheb(site('rock:varrock-west-mine:0').stand!, site(b.site).stand!) / 2);
        expect(floor).toBe(35);
        expect(b.runTicks).toBeGreaterThanOrEqual(floor);
        expect(b.runTicks).toBeLessThanOrEqual(Math.ceil(floor * 1.3));
    });
});

describe("under the site's own requirement sets", () => {
    test('Karamja, reached by the 30-coin ship or the glider, banks by the glider back to the Grand Tree', () => {
        // The Karamja fishing spots need coins:30, the Port Sarim sailors' fare (World.transports), or The Grand Tree
        // for the glider to Gandius; Karamja's one bank, Shilo Village's, needs Zombie Queen and the cart fare besides,
        // so the nearest is the Grand Tree's, by the glider back (gnome_glider.rs2:2).
        expect(site('fishing-spot:karamja:0').reach).toEqual([['coins:30'], ['quest:grandtree']]);
        expect(bankOf('fishing-spot:karamja:0')).toMatchObject({
            site: 'bank:grand-tree-bank:0',
            requires: ['quest:grandtree'],
        });
    });

    test('Zanaris, reached with the dramen staff worn, banks inside Zanaris with no further requirement', () => {
        expect(site('tree:zanaris:6').reach).toEqual([['item:dramen_staff:worn']]);
        expect(bankOf('tree:zanaris:6')).toMatchObject({ site: 'bank:zanaris-bank:0', requires: [] });
    });

    test("a site reached with no requirement never takes a gate's way to its bank", () => {
        for (const s of world.sites)
            if (s.reach.some(r => !r.length) && nearest.get(s.id)?.bank)
                expect([s.id, bankOf(s.id)!.requires]).toEqual([s.id, []]);
    });
});
