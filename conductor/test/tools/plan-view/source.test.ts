import { describe, expect, test } from 'bun:test';
import { conditionReads, phaseConditions, planUntil, sourceLine } from '../../../tools/plan-view/source';

const PLAN = `import { definePlan, phase } from '@conductor/lib/plan';

const cooked = /^(shrimps|anchovies)$/i;

export default definePlan({
    name: 'fish-cook-bank',
    until: v => v.bank('Shrimps') >= 25,
    phases: [
        phase(
            bank,
            { area: { x: 3092, z: 3243, radius: 3 }, until: 'not an option' },
            { name: 'bank-cooked', when: v => v.inv(cooked) > 0 && v.inv(/^raw (?:[)]|it's)/i) === 0 },
        ),
        phase(cooking, { food: 'Raw shrimps, "x"' }, {
            name: 'cook-shrimps',
            // a comment, with a comma
            when: (v) => {
                return v.inv('Raw shrimps') > 0;
            },
            until: v => v.free === 28,
            onFail: 'continue',
        }),
        phase(fishMore, { method: 'net' }),
        phase(
            fletching,
            { product: 'arrow shaft' },
            { when: v => v.inv('Logs') > 0 },
        ),
        hunt('chicken', 'Chicken'),
    ],
});
`;
const PHASES = [
    { phase: 'bank-cooked', task: 'bank' },
    { phase: 'cook-shrimps', task: 'cooking' },
    { phase: 'fish-more', task: 'fish-more' },
    { phase: 'fletching', task: 'fletching' },
    { phase: 'chicken', task: 'bank' },
    { phase: 'gone', task: 'gone' },
];

describe('phaseConditions', () => {
    const c = phaseConditions(PLAN, PHASES);

    test('reads when from the options, not a same-named param, past regexes holding brackets and quotes', () => {
        expect(c['bank-cooked']).toEqual({
            when: "v.inv(cooked) > 0 && v.inv(/^raw (?:[)]|it's)/i) === 0",
            until: null,
            onFail: null,
        });
    });

    test('multi-line options: a block-bodied arrow on one line, until and onFail, comments skipped', () => {
        expect(c['cook-shrimps']).toEqual({
            when: "{ return v.inv('Raw shrimps') > 0; }",
            until: 'v.free === 28',
            onFail: "'continue'",
        });
    });

    test('a phase named after its task, its call broken after phase(', () => {
        expect(c.fletching).toEqual({ when: "v.inv('Logs') > 0", until: null, onFail: null });
    });

    test('a phase without options has none', () => {
        expect(c['fish-more']).toEqual({ when: null, until: null, onFail: null });
    });

    test("one not found is null, not another phase's call of its task", () => {
        // chicken is a bank phase built by a helper: bank-cooked's phase(bank, ...) is not it
        expect(c.chicken).toBeNull();
        expect(c.gone).toBeNull();
    });
});

describe('sourceLine', () => {
    const lines = PLAN.split('\n');
    test("a phase's name line, else its task's phase( call", () => {
        expect(lines[sourceLine(lines, 'cook-shrimps', 'cooking')]).toContain("name: 'cook-shrimps'");
        expect(lines[sourceLine(lines, 'fish-more', 'fish-more')]).toContain('phase(fishMore');
        expect(lines[sourceLine(lines, 'fletching', 'fletching')]).toContain('phase(');
        expect(sourceLine(lines, 'gone', 'gone')).toBe(-1);
    });
});

describe('planUntil', () => {
    test("the plan's own until, not a phase's", () => {
        expect(planUntil(PLAN)).toBe("v.bank('Shrimps') >= 25");
    });
    test('null for a plan without one', () => {
        expect(planUntil("definePlan({ name: 'p', phases: [phase(a, {}, { until: v => v.free === 0 })] })")).toBeNull();
    });
});

describe('conditionReads', () => {
    test('calls with literal arguments keyed as recordReads keys them, and fields, in order, once each', () => {
        expect(
            conditionReads(
                `v.inv('Harpoon') === 0 && v.inv("Coins") >= 5 || v.bank(/^(raw )?tuna$/i) > v.free && v.inv('Harpoon') < 2`,
            ),
        ).toEqual(["inv('Harpoon')", "inv('Coins')", 'bank(/^(raw )?tuna$/i)', 'free']);
    });

    test('a variable argument, state paths and other receivers are left out', () => {
        expect(
            conditionReads("v.inv(cooked) > 0 && (v.state.player?.worldX ?? 0) > 2 && atCourse(v) && w.inv('x')"),
        ).toEqual([]);
        expect(conditionReads("v.level('Fishing') >= 80 && v.runs('bank') > 0 && v.last?.phase === 'x'")).toEqual([
            "level('Fishing')",
            "runs('bank')",
            'last',
        ]);
    });
});
