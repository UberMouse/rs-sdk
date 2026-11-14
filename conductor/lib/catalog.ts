// The task catalog: one `defineTask` default export per conductor/tasks/<name>.ts, and what
// `run-task.ts --list` prints of it.
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod/v4';
import { GUARDS } from './interrupts';
import { isPatternParam, isPatternSchema, PATTERN_NOTE } from './spot';
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

/** One task's full entry, as `--list <task>` prints it. */
export interface CatalogEntry {
    name: string;
    description: string;
    rules?: string[];
    /** Outcome code -> when it happens: the task's (TaskDef.outcomes), then those of the guards it installs. */
    outcomes?: Record<string, string>;
    spots?: string[];
    /** The params as JSON Schema, input side: defaults are optional, a root pipe shows what it takes. */
    params: unknown;
}

const paramsSchema = (def: TaskDef) => z.toJSONSchema(def.params, { io: 'input' });

/**
 * The codes a run of `def` can end with: its own, then each guard's it installs (the shared ones `allow` leaves on,
 * those a param can turn off included, and its own). A code declared twice shows each distinct sentence once.
 */
function outcomesOf(def: TaskDef): Record<string, string> {
    const sentences = new Map<string, Set<string>>();
    const guards = [...GUARDS.filter(g => !(def.allow ?? []).some(a => a === g.name)), ...(def.guards ?? [])];
    for (const declared of [def.outcomes, ...guards.map(g => g.outcomes)])
        for (const [code, sentence] of Object.entries(declared ?? {}))
            sentences.set(code, (sentences.get(code) ?? new Set()).add(sentence));
    return Object.fromEntries([...sentences].map(([code, s]) => [code, [...s].join(' ')]));
}

export function catalogEntry(def: TaskDef): CatalogEntry {
    const outcomes = outcomesOf(def);
    return {
        name: def.name,
        description: def.description,
        ...(def.rules?.length ? { rules: def.rules } : {}),
        ...(Object.keys(outcomes).length ? { outcomes } : {}),
        ...(def.spots?.length ? { spots: def.spots } : {}),
        params: paramsSchema(def),
    };
}

/** Up to the first full stop that ends a sentence ("e.g." and "i.e." do not), whitespace collapsed. */
function firstSentence(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    const end = /(?<!\be\.g|\bi\.e)[.!?](?= |$)/.exec(flat);
    return end ? flat.slice(0, end.index + 1) : flat;
}

/** `<name>: <first sentence> (params: ...)`, the index line; required params first, each group in schema order. */
export function summaryLine(def: TaskDef): string {
    // The input-side JSON Schema of a root pipe is its input object's, so its fields are the ones listed.
    const schema = paramsSchema(def) as { properties?: Record<string, unknown>; required?: string[] };
    const names = Object.keys(schema.properties ?? {});
    const required = new Set(schema.required ?? []);
    const ordered = [...names.filter(n => required.has(n)), ...names.filter(n => !required.has(n))];
    return `${def.name}: ${firstSentence(def.description)} (params: ${ordered.join(', ') || 'none'})`;
}

interface Def {
    type: string;
    innerType?: z.ZodType;
    in?: z.ZodType;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    options?: z.ZodType[];
    items?: z.ZodType[];
    rest?: z.ZodType | null;
}
const defOf = (s: z.ZodType) => s.def as unknown as Def;
/** Layers that wrap one schema; a pipe is read on its input side, as `--list` prints it. */
const WRAPPERS = new Set(['optional', 'default', 'prefault', 'nullable', 'nonoptional', 'readonly', 'catch']);
/** Schemas with no fields inside. */
const LEAVES = new Set(['string', 'number', 'boolean', 'bigint', 'enum', 'literal', 'date', 'null', 'any', 'unknown']);

/**
 * The schema under its wrappers; whether any layer, the inner one included, carries a description; and the
 * description `--list` shows for it (the outermost one). A description on a Pattern layer counts only when
 * `patternParam` made it: one inherited from `Pattern` says what kind of value it is, not what the param means.
 */
function unwrap(s: z.ZodType): { core: z.ZodType; described: boolean; shown: string | undefined } {
    let described = false;
    let shown: string | undefined;
    for (let cur = s; ;) {
        if (cur.description !== undefined) {
            shown ??= cur.description;
            if (!isPatternSchema(cur) || isPatternParam(cur)) described = true;
        }
        const d = defOf(cur);
        if (WRAPPERS.has(d.type) && d.innerType) cur = d.innerType;
        else if (d.type === 'pipe' && d.in) cur = d.in;
        else return { core: cur, described, shown };
    }
}

/** What the walk finds: fields with no description, and Pattern schemas whose shown description lacks PATTERN_NOTE. */
interface Found {
    undescribed: Set<string>;
    noNote: Set<string>;
}

function walkField(s: z.ZodType, path: string, out: Found): void {
    if (!unwrap(s).described) out.undescribed.add(path);
    walkPart(s, path, out);
}

/** A schema's own note check and the fields inside it; on its own, for what is not a field (an array's element, a union's arm, the root). */
function walkPart(s: z.ZodType, path: string, out: Found): void {
    const { core, shown } = unwrap(s);
    if (isPatternSchema(core) && !shown?.includes(PATTERN_NOTE)) out.noNote.add(path);
    walkInside(core, path, out);
}

function walkInside(core: z.ZodType, path: string, out: Found): void {
    const d = defOf(core);
    if (d.type === 'object') {
        for (const [key, field] of Object.entries(d.shape ?? {})) walkField(field, path ? `${path}.${key}` : key, out);
    } else if (d.type === 'array' && d.element) walkPart(d.element, `${path}[]`, out);
    else if (d.type === 'tuple') {
        (d.items ?? []).forEach((item, i) => walkPart(item, `${path}[${i}]`, out));
        if (d.rest) walkPart(d.rest, `${path}[]`, out);
    } else if (d.type === 'union') for (const arm of d.options ?? []) walkPart(arm, path, out);
    // A schema kind this walk does not know could hide fields from the guard: fail loudly instead.
    else if (!LEAVES.has(d.type)) throw new Error(`undescribedFields: no walk for a ${d.type} schema at "${path}"`);
}

/**
 * The path of every params field with no description (`area.radius`, `withdraw[].item`, `route[0].x`).
 * A field is described when its schema or any wrapper of it (optional, default, a pipe's input) has one,
 * so a field typed as a described shared sub-schema (`AreaSchema`) is described through it; the fields
 * inside are still checked. A union is one field and needs its own description, whatever its arms carry;
 * the fields of an object arm are checked at the union's path. A field typed `Pattern` (any schema with
 * its regex check) must be described at its use, with `patternParam` or on a wrapper: `Pattern`'s own
 * description does not say what the param means.
 */
export function undescribedFields(def: Pick<TaskDef, 'params'>): string[] {
    return [...walk(def).undescribed];
}

/**
 * The path of every Pattern schema in the params (a field, an array's element, a union's arm) whose
 * description, as `--list` shows it, lacks PATTERN_NOTE: the reader is not told it is a regex or how it
 * matches. `patternParam` adds the note; describing a Pattern field any other way drops it.
 */
export function patternsWithoutNote(def: Pick<TaskDef, 'params'>): string[] {
    return [...walk(def).noNote];
}

function walk(def: Pick<TaskDef, 'params'>): Found {
    const out: Found = { undescribed: new Set(), noNote: new Set() };
    walkPart(def.params, '', out);
    return out;
}

/**
 * What `run-task.ts --list [<task>...] | --list --all` prints: no names, the index (one `summaryLine`
 * per task and a closing line on getting a full entry); names or `--all`, a JSON array of their
 * `catalogEntry`. A name not in the catalog throws.
 */
export async function listCatalog(args: string[], dir = TASKS_DIR): Promise<string> {
    const all = taskNames(dir);
    if (args.length === 0) {
        const lines: string[] = [];
        for (const name of all) lines.push(summaryLine(await loadTask(name, dir)));
        lines.push(
            "A task's full entry (description, rules, outcomes, spots, params as JSON Schema): bun conductor/run-task.ts --list <task> [<task>...]; every task's: --list --all",
        );
        return lines.join('\n');
    }
    if (args.includes('--all') && args.length > 1) throw new Error('--list --all takes no task names');
    const names = args.includes('--all') ? all : args;
    const unknown = names.filter(n => !all.includes(n));
    if (unknown.length > 0)
        throw new Error(
            `no task ${unknown.map(n => `"${n}"`).join(', ')} in the catalog (${relative(REPO, dir)}): ${all.join(', ')}`,
        );
    const entries: CatalogEntry[] = [];
    for (const name of names) entries.push(catalogEntry(await loadTask(name, dir)));
    return JSON.stringify(entries, null, 2);
}
