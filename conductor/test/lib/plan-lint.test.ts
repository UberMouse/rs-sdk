import { describe, expect, test } from 'bun:test';
import { definePlan, phase, type PlanDef } from '../../lib/plan';
import { lintPlan } from '../../lib/plan-lint';
import waitTask from '../../tasks/wait';

/** A plan of `wait` phases with these names; the lint reads the source text separately. */
const plan = (...names: string[]): PlanDef =>
    definePlan({ name: 'lint-test', phases: names.map(name => phase(waitTask, { ticks: 1 }, { name })) });

describe('lintPlan', () => {
    test('a clean plan has no problems', () => {
        const src = `
            const ran = (v, name) => v.runs(name) > 0;
            const p = definePlan({ phases: [
                phase(wait, { ticks: 1 }, { name: 'a', when: v => v.runs('a') === 0 && !ran(v, 'b') }),
                phase(wait, { ticks: 1 }, { name: 'b', when: v => v.last?.phase === 'a' || v.lastDone('a', 'b') }),
                phase(wait, { ticks: 1 }, { when: v => v.inv(/^(bronze|rune) axe$/i) > 0 && v.inv(/pickaxe$/i) > 0 }),
            ] });`;
        expect(lintPlan(plan('a', 'b', 'wait'), src)).toEqual([]);
    });

    test('a phase whose params do not parse against its task schema', () => {
        const def = definePlan({ name: 'lint-test', phases: [phase(waitTask, { ticks: 0 }, { name: 'nap' })] });
        const problems = lintPlan(def, '');
        expect(problems).toHaveLength(1);
        expect(problems[0]).toStartWith('phase "nap" has invalid params: ticks:');
    });

    test.each([
        ["v.runs('gone')", 'runs(...)'],
        ["ran(v, 'gone')", 'ran(...)'],
        ["v.lastDone('a', 'gone')", 'lastDone(...)'],
        ["v.lastFailed('gone')", 'lastFailed(...)'],
        ["lastWas(v, 'gone')", 'lastWas(...)'],
        ["lastIs(v, 'a', 'gone')", 'lastIs(...)'],
        ["v.last?.phase === 'gone'", '.phase ==='],
        ["v.last.phase !== 'gone'", '.phase !=='],
        ["'gone' === v.last.phase", '.phase ==='],
    ])('a dangling phase name in %s', (expr, context) => {
        expect(lintPlan(plan('a'), `\nconst p = v => ${expr};`)).toEqual([
            `line 2: ${context} names "gone", which is no phase of plan "lint-test"`,
        ]);
    });

    test('a name the plan builds from a template resolves, and a template argument is not checked', () => {
        const def = plan(...[1, 2].map(i => `form${i}`));
        expect(lintPlan(def, "const p = v => v.runs('form2') > 0 && v.runs(`form${k}`) > 0;")).toEqual([]);
    });

    test('a call or comparison that names no phase is not read', () => {
        expect(lintPlan(plan('a'), "const p = v => v.inv('Logs') > 0 && v.last?.status === 'done';")).toEqual([]);
    });

    test('an item pattern that takes a pickaxe for an axe, and one that does not', () => {
        expect(lintPlan(plan('a'), 'const has = v => v.inv(/axe$/i) > 0;')).toEqual([
            'line 1: /axe$/i matches both "Bronze axe" and "Bronze pickaxe"',
        ]);
        expect(lintPlan(plan('a'), 'const has = v => v.inv(/ axe$/i) > 0 && v.inv(/^pickaxe|axe$/g) > 0;')).toEqual([
            'line 1: /^pickaxe|axe$/g matches both "Bronze axe" and "Bronze pickaxe"',
        ]);
    });

    test("a pattern that rewrites text is not an item pattern: `name.replace(/ /g, '-')`", () => {
        expect(lintPlan(plan('a'), "const id = n => n.replace(/ /g, '-').split(/ /);")).toEqual([]);
        expect(lintPlan(plan('a'), 'const has = v => v.inv(/ /) > 0;')).toHaveLength(1);
    });
});
