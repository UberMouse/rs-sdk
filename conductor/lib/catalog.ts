// The task catalog: one `defineTask` default export per conductor/tasks/<name>.ts.
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { TaskDef } from './task';

export const TASKS_DIR = resolve(import.meta.dir, '../tasks');
const REPO = resolve(import.meta.dir, '../..');

/** The task `name` from `dir`, checked to be a task of that name. */
export async function loadTask(name: string, dir = TASKS_DIR): Promise<TaskDef> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad task name "${name}"`);
    const file = resolve(dir, `${name}.ts`);
    const shown = relative(REPO, file);
    const mod: { default?: TaskDef } = await import(file);
    const def = mod.default;
    if (!def) throw new Error(`${shown} has no default export (use export default defineTask(...))`);
    if (def.name !== name) throw new Error(`${shown} defines task "${def.name}"; the name must match the filename`);
    return def;
}

export function taskNames(dir = TASKS_DIR): string[] {
    return readdirSync(dir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(f => f.slice(0, -3))
        .sort();
}
