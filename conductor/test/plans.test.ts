// The promoted plans (conductor/plans/) against the curated methods (world.json `methods`): a plan's `method` and a
// method's `plans` record the same link, so neither drifts. Plans that name no method are printed as a to-do list.
// Every promoted plan also passes lib/plan-lint.ts.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/env';
import { checkPlanMethods } from '../lib/methods';
import { paramKeys, unknownParams } from '../lib/param-keys';
import { isPlan, type PlanDef } from '../lib/plan';
import { lintPlan } from '../lib/plan-lint';
import { WORLD } from '../lib/world-index';

const PLANS_DIR = join(REPO_ROOT, 'conductor/plans');

/** Each promoted plan's file, default export and source text, in file order. */
async function promotedPlans(): Promise<{ file: string; def: PlanDef; source: string }[]> {
    const out: { file: string; def: PlanDef; source: string }[] = [];
    for (const file of readdirSync(PLANS_DIR)
        .filter(f => f.endsWith('.ts'))
        .sort()) {
        const path = join(PLANS_DIR, file);
        const def = ((await import(path)) as { default?: unknown }).default;
        if (!isPlan(def)) throw new Error(`conductor/plans/${file} does not default-export a plan`);
        out.push({ file, def, source: readFileSync(path, 'utf8') });
    }
    return out;
}

test('every promoted plan and every method agree on the plans that run each method', async () => {
    const plans = (await promotedPlans()).map(p => p.def);
    const { errors, unlinked } = checkPlanMethods(plans, WORLD.methods);
    if (unlinked.length)
        console.log(`promoted plans with no method (to do: add a method record, or leave): ${unlinked.join(', ')}`);
    expect(errors).toEqual([]);
});

test('every promoted plan passes the plan lint', async () => {
    const problems = (await promotedPlans()).flatMap(({ file, def, source }) =>
        lintPlan(def, source).map(p => `conductor/plans/${file}: ${p}`),
    );
    expect(problems).toEqual([]);
});

// A plain `z.object` drops a key it does not have, so a misspelt or stale param would run on the task's default.
// Checked on each phase's value as the loaded plan holds it, spreads and helper-built params included.
test("no promoted plan's phase passes a top-level param its task does not take", async () => {
    const unlisted: string[] = [];
    const dropped: string[] = [];
    for (const { file, def } of await promotedPlans())
        for (const p of def.phases) {
            if (!paramKeys(p.task.params)) unlisted.push(`${file}: phase "${p.name}" (${p.task.name})`);
            const keys = unknownParams(p.task.params, p.params ?? {});
            if (keys.length) dropped.push(`${file}: phase "${p.name}" (${p.task.name}) drops ${keys.join(', ')}`);
        }
    expect(unlisted).toEqual([]);
    expect(dropped).toEqual([]);
});

test('the plans axe pattern takes every real axe and not a broken one, pickaxe, battleaxe or thrownaxe', () => {
    const axe = /^(?!broken ).* axe$/i;
    for (const name of ['Bronze axe', 'Steel axe', 'Rune axe', 'Dragon axe']) expect(axe.test(name)).toBe(true);
    for (const name of ['Broken axe', 'Bronze pickaxe', 'Bronze battleaxe', 'Bronze thrownaxe'])
        expect(axe.test(name)).toBe(false);
});
