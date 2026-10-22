// Method legs (model/legs.ts) on a scripted world: a wizard's teleport to 22 random landings in a closed mine (level 1
// of the test grid) priced at their mean, the walk to the wizard and each landing's walk on rounded up once; a portal
// out that only a way in by the wizard takes; the chances, stranded landings and plain ways the mean defers to; and a
// tour's came-from carried round the cycle (tourLegs).
import { describe, expect, test } from 'bun:test';
import { CROSSING_TICKS, priceCrossings } from '../distance';
import { legFinder, rowTicks, tourLegs, type LegFinder } from '../model/legs';
import { locSizes } from '../place';
import { reachGraph } from '../reach';
import type { Crossing } from '../types';
import { at, Grid } from './grid';

const size = locSizes(new Map());
const QUEST = 'quest:testquest';
const CAME = 'other:came from wizard';

// The wizard's teleport: from the tile east of it to 22 landings along z 3220 of the mine, x 3200-3221; its label's
// p_delay(4) is 5 ticks of delay (Crossing.ticks).
const WIZARD_SIDE = at(0, 3206, 3205);
const teleport: Crossing = {
    via: 'teleport',
    act: { kind: 'npc-op', npc: 'wizard', op: 3 },
    at: at(0, 3205, 3205),
    from: [WIZARD_SIDE],
    landings: Array.from({ length: 22 }, (_, i) => ({ tile: at(1, 3200 + i, 3220) })),
    requires: [[QUEST]],
    ticks: 5,
    source: 'test_mine.rs2:10',
};
// The portal out: back beside the wizard, on one of two tiles, only for a way that came in by the wizard.
const PORTAL_SIDE = at(1, 3201, 3230);
const portal: Crossing = {
    via: 'teleport',
    act: { kind: 'loc-op', loc: 'test_portal', op: 1 },
    at: at(1, 3200, 3230),
    from: [PORTAL_SIDE],
    landings: [{ tile: at(0, 3206, 3206) }, { tile: at(0, 3207, 3206) }],
    requires: [[CAME, QUEST]],
    ticks: 2,
    source: 'test_mine.rs2:20',
};
const ROCK = at(1, 3210, 3225);
const BANK = at(0, 3220, 3205);

/** A LegFinder over the open grid and `rows`, their landings' spreads priced as the build prices them. */
function finderOver(rows: Crossing[], grid = new Grid()): { legs: LegFinder; priced: Crossing[] } {
    const world = { features: [], connectors: [], gates: [], transports: [] };
    const unpriced = reachGraph({ world: { ...world, crossings: rows }, collision: grid, size });
    const priced = priceCrossings(unpriced, { crossings: rows, gates: [] }).crossings;
    const graph = reachGraph({ world: { ...world, crossings: priced }, collision: grid, size });
    return { legs: legFinder(graph, priced), priced };
}

// From the landing at x to the rock: max(|x - 3210|, 5) steps on open ground, a half tick each.
const toRock = Array.from({ length: 22 }, (_, i) => Math.max(Math.abs(3200 + i - 3210), 5));
/** The mean over the 22 landings of ceil((walk + toRock) / 2): each landing's way rounded up once. */
const meanOver = (walkHalf: number) => toRock.reduce((t, h) => t + Math.ceil((walkHalf + h) / 2), 0) / 22;

describe('a leg over a random landing', () => {
    const { legs, priced } = finderOver([teleport, portal]);

    test('the 22 landings priced at their mean, and the teleport at its script delay', () => {
        // From beside the wizard: no walk to it. ceil(h / 2) over the 22 landings: x 3200-3204 5, 5, 4, 4, 3 (21);
        // x 3205-3215 3 each (33); x 3216-3221 3, 4, 4, 5, 5, 6 (27): 81 / 22. The teleport: p_delay(4), 5 ticks of
        // delay and its click, 6.
        expect(meanOver(0)).toBe(81 / 22);
        expect(rowTicks(teleport)).toBe(6);
        expect(legs.leg(WIZARD_SIDE, ROCK, [QUEST])).toEqual({
            runTicks: 6 + 81 / 22,
            requires: [QUEST],
            npc: 'wizard',
        });
        // distance.ts's way takes CROSSING_TICKS.teleport and the best landing's spread: x 3210, 6 run ticks from
        // x 3221, then 5 steps to the rock: ceil((2 x (3 + 6) + 5) / 2) = 12.
        const best = priced[0]!.landings[10]!;
        expect(best.spread).toBe(6);
        expect(legs.finder.runTicksBetween(WIZARD_SIDE, ROCK, [QUEST])?.runTicks).toBe(
            Math.ceil((2 * (CROSSING_TICKS.teleport + 6) + 5) / 2),
        );
    });

    test("the walk to the row and each landing's walk on are rounded up once, together", () => {
        // 5 steps to the wizard: ceil((5 + h) / 2) over the landings sums to 131, where rounding the walk to the
        // wizard alone (3) and each landing's (81 in all) would make 147.
        expect(meanOver(5) * 22).toBe(131);
        expect(legs.leg(at(0, 3201, 3205), ROCK, [QUEST])?.runTicks).toBe(6 + 131 / 22);
    });

    test('without the requirement no way gets in', () => {
        expect(legs.leg(WIZARD_SIDE, ROCK, [])).toBeNull();
    });

    test("the portal out takes only a way that came in by the wizard, at its landings' mean", () => {
        expect(legs.leg(ROCK, BANK, [QUEST])).toBeNull();
        // 9 steps to the portal; its landings are 14 and 13 steps from the bank: ceil(23 / 2) = 12 and ceil(22 / 2) =
        // 11, a mean of 11.5; the portal's p_delay(1), 3 ticks with the click.
        expect(legs.leg(ROCK, BANK, [QUEST], 'wizard')).toEqual({ runTicks: 3 + 11.5, requires: [CAME, QUEST] });
    });

    test('a plain way no longer than the row is kept', () => {
        // Two tiles in town: the walk itself, 14 steps.
        expect(legs.leg(WIZARD_SIDE, BANK, [QUEST])).toEqual({ runTicks: 7, requires: [] });
    });
});

describe('what the mean counts', () => {
    test("each landing by its chance, and a row's ticks by its via when it has none", () => {
        const two: Crossing = {
            ...teleport,
            landings: [
                { tile: at(1, 3200, 3225), chance: 3 / 4 },
                { tile: at(1, 3220, 3225), chance: 1 / 4 },
            ],
            ticks: undefined,
        };
        const { legs } = finderOver([two]);
        // To a rock on the second landing: 20 steps (10 ticks) from the first, none from the second; and
        // CROSSING_TICKS.teleport for the move.
        const rock = at(1, 3220, 3225);
        expect(legs.leg(WIZARD_SIDE, rock, [QUEST])?.runTicks).toBe(CROSSING_TICKS.teleport + (3 / 4) * 10);
    });

    test('a stranded landing counts for none; a row with a landing that walks nowhere is not taken', () => {
        // A landing walled in on every side: no walk leaves it, so the build gives it no spread.
        const pen = at(1, 3225, 3228);
        const grid = new Grid().wall(pen, 1, 0).wall(pen, -1, 0).wall(pen, 0, 1).wall(pen, 0, -1);
        const stranded: Crossing = { ...teleport, landings: [...teleport.landings, { tile: pen }] };
        const { legs, priced } = finderOver([stranded], grid);
        expect(priced[0]!.landings.at(-1)!.spread).toBeUndefined();
        expect(legs.leg(WIZARD_SIDE, ROCK, [QUEST])?.runTicks).toBe(6 + 81 / 22);
        // The rock inside the pen: no landing but the stranded one walks there.
        expect(legs.leg(WIZARD_SIDE, pen, [QUEST])).toBeNull();
    });
});

describe('tourLegs', () => {
    const { legs } = finderOver([teleport, portal]);

    test("a leg out of the mine takes the came-from of the teleport the cycle's way in crossed", () => {
        // Rock -> bank -> rock: the last leg goes in by the wizard; the first, priced after it, goes out by the portal.
        const tour = tourLegs(legs, [ROCK, BANK, ROCK], [QUEST]);
        expect(tour.map(l => l?.runTicks)).toEqual([3 + 11.5, legs.leg(BANK, ROCK, [QUEST])!.runTicks]);
        expect(tour[1]?.npc).toBe('wizard');
        // Rock first in the tour's order or not, the cycle carries the wizard round to the way out.
        expect(tourLegs(legs, [BANK, ROCK, BANK], [QUEST]).map(l => l?.runTicks)).toEqual([
            legs.leg(BANK, ROCK, [QUEST])!.runTicks,
            3 + 11.5,
        ]);
    });

    test('a tour with no way in has no way out', () => {
        expect(tourLegs(legs, [ROCK, BANK, ROCK], [])).toEqual([null, null]);
    });
});
