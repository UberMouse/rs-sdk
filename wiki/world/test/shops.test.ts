import { describe, expect, test } from 'bun:test';
import { openshopCalls, ownerlessPricing } from '../../generate-shops';

describe('openshopCalls', () => {
    test("reads each call's inv, line and buy, sell and haggle literals, skipping commented-out ones", () => {
        const body =
            '\nif (x) {\n    ~openshop(a, 400, 1300, 30, "A");\n} // ~openshop(c, 1, 1, 1, "C");\n~openshop(b, %buy, 1000, 20, "B");\n';
        expect(openshopCalls('area/scripts/s.rs2', 10, body)).toEqual([
            { inv: 'a', call: { at: 'area/scripts/s.rs2:12', prices: { buy: 400, sell: 1300, haggle: 30 } } },
            { inv: 'b', call: { at: 'area/scripts/s.rs2:14' } },
        ]);
    });
});

/** A call at line `line` of s.rs2 passing these literals. */
const at = (line: number, buy: number, sell: number, haggle = 30) => ({
    at: `s.rs2:${line}`,
    prices: { buy, sell, haggle },
});

describe('ownerlessPricing', () => {
    test("one call's literals price the page", () =>
        expect(ownerlessPricing([at(240, 400, 1300)])).toEqual({
            sets: [{ sell: 1300, buy: 400 }],
            note: "No npc's `owned_shop` param names this shop; these prices use the multipliers its `~openshop` call passes, per mille of value at normal stock: 1300 to buy, 400 to sell, haggle delta 30 (s.rs2:240).",
        }));

    test('calls passing the same literals are one set', () =>
        expect(ownerlessPricing([at(5, 650, 1000), at(7, 650, 1000)]).sets).toEqual([{ sell: 1000, buy: 650 }]));

    test('calls passing different literals list each, in the order the prices give them, and pick none', () =>
        expect(ownerlessPricing([at(9, 650, 1050, 40), at(3, 400, 1300)])).toEqual({
            sets: [
                { sell: 1300, buy: 400 },
                { sell: 1050, buy: 650 },
            ],
            note: "No npc's `owned_shop` param names this shop, and its `~openshop` calls pass different multipliers, per mille of value at normal stock: 1300 to buy, 400 to sell, haggle delta 30 (s.rs2:3); 1050 to buy, 650 to sell, haggle delta 40 (s.rs2:9). Each price below gives them in that order.",
        }));

    test('a call without literals is named, and the defaults stand when no call has them', () => {
        expect(ownerlessPricing([{ at: 's.rs2:4' }])).toEqual({
            sets: [{ sell: 1000, buy: 600 }],
            note: "No npc's `owned_shop` param names this shop, so these prices use this page's default multipliers (1000 to buy, 600 to sell, per mille of value), not a shopkeeper's. The `~openshop` call at s.rs2:4 passes multipliers that are not integer literals, which this page does not read.",
        });
        expect(ownerlessPricing([at(2, 400, 1300), { at: 's.rs2:4' }]).sets).toEqual([{ sell: 1300, buy: 400 }]);
    });

    test('no call at all keeps the defaults and says so', () =>
        expect(ownerlessPricing([]).note).toContain('and no `~openshop` call opens it, so these prices use'));
});
