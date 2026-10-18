// The promoted plans (conductor/plans/) against the curated methods (world.json `methods`): a plan's `method` and a
// method's `plans` record the same link, so neither drifts. Plans that name no method are printed as a to-do list.
import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/env';
import { checkPlanMethods } from '../lib/methods';
import { isPlan, type PlanDef } from '../lib/plan';
import { WORLD } from '../lib/world-index';

const PLANS_DIR = join(REPO_ROOT, 'conductor/plans');

test('every promoted plan and every method agree on the plans that run each method', async () => {
    const plans: PlanDef[] = [];
    for (const file of readdirSync(PLANS_DIR)
        .filter(f => f.endsWith('.ts'))
        .sort()) {
        const def = ((await import(join(PLANS_DIR, file))) as { default?: unknown }).default;
        if (!isPlan(def)) throw new Error(`conductor/plans/${file} does not default-export a plan`);
        plans.push(def);
    }
    const { errors, unlinked } = checkPlanMethods(plans, WORLD.methods);
    if (unlinked.length)
        console.log(`promoted plans with no method (to do: add a method record, or leave): ${unlinked.join(', ')}`);
    expect(errors).toEqual([]);
});
