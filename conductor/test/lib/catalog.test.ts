import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod/v4';
import { AreaSchema } from '../../lib/area';
import {
    catalogEntry,
    listCatalog,
    loadTask,
    patternsWithoutNote,
    summaryLine,
    TASKS_DIR,
    taskNames,
    undescribedFields,
} from '../../lib/catalog';
import { Pattern, PATTERN_NOTE, patternParam } from '../../lib/spot';
import type { TaskDef } from '../../lib/task';

/** A def with only what the catalog reads. */
const def = (params: z.ZodType, extra: Partial<TaskDef> = {}): TaskDef =>
    ({ name: 't', description: 'Does a thing. Then more.', params, ...extra }) as TaskDef;

describe('loadTask', () => {
    test('a directory relative to the working directory loads', async () => {
        const rel = relative(process.cwd(), TASKS_DIR);
        expect(rel.startsWith('/')).toBe(false);
        expect((await loadTask('woodcutting', rel)).name).toBe('woodcutting');
    });

    test('a bad name and a missing task are refused', async () => {
        await expect(loadTask('../x')).rejects.toThrow('bad task name');
        await expect(loadTask('no-such-task')).rejects.toThrow();
    });
});

describe('summaryLine', () => {
    test('the first sentence and the param names, required first, each group in schema order', () => {
        const params = z.object({ a: z.number().optional(), b: z.string(), c: z.number().default(1), d: z.boolean() });
        expect(summaryLine(def(params))).toBe('t: Does a thing. (params: b, d, a, c)');
    });

    test('"e.g." does not end the sentence, and a description without a full stop is whole', () => {
        const params = z.object({});
        expect(summaryLine(def(params, { description: 'Chops trees, e.g. oaks.\n  Then banks.' }))).toBe(
            't: Chops trees, e.g. oaks. (params: none)',
        );
        expect(summaryLine(def(params, { description: 'Chops trees' }))).toBe('t: Chops trees (params: none)');
    });

    test("a root pipe lists its input object's fields", () => {
        const params = z.object({ word: z.string(), at: z.number().optional() }).transform(p => ({ ...p, n: 1 }));
        expect(summaryLine(def(params))).toBe('t: Does a thing. (params: word, at)');
    });
});

describe('catalogEntry', () => {
    test('rules and spots appear when given and are left out when empty', () => {
        const params = z.object({ a: z.number() });
        const full = catalogEntry(def(params, { rules: ['a rule'], spots: ['a spot'] }));
        expect(full).toEqual({
            name: 't',
            description: 'Does a thing. Then more.',
            rules: ['a rule'],
            spots: ['a spot'],
            params: z.toJSONSchema(params, { io: 'input' }),
        });
        expect(Object.keys(catalogEntry(def(params, { rules: [], spots: [] })))).toEqual([
            'name',
            'description',
            'params',
        ]);
    });
});

// run-task.ts has no harness for --list: it prints what listCatalog returns (and exits 1 on its error).
describe('listCatalog', () => {
    test('no names: one summary line per task, then the closing line', async () => {
        const names = taskNames();
        expect(names).toHaveLength(32);
        const lines = (await listCatalog([])).split('\n');
        expect(lines).toHaveLength(names.length + 1);
        names.forEach((name, i) => expect(lines[i]!.startsWith(`${name}: `)).toBe(true));
        expect(lines).toContain(
            'wait: ' + (await loadTask('wait')).description.split('. ')[0] + '. (params: ticks, orFail)',
        );
        expect(lines.at(-1)).toContain('--list <task> [<task>...]');
        expect(lines.at(-1)).toContain('--list --all');
    });

    test('names: their full entries, in the order asked', async () => {
        const entries = JSON.parse(await listCatalog(['wait', 'journal'])) as { name: string }[];
        expect(entries).toEqual([catalogEntry(await loadTask('wait')), catalogEntry(await loadTask('journal'))]);
    });

    test('--all: every task', async () => {
        const entries = JSON.parse(await listCatalog(['--all'])) as { name: string }[];
        expect(entries.map(e => e.name)).toEqual(taskNames());
    });

    test('a name not in the catalog fails naming it; --all takes no names', async () => {
        await expect(listCatalog(['wait', 'nope'])).rejects.toThrow('no task "nope" in the catalog (conductor/tasks)');
        await expect(listCatalog(['--all', 'wait'])).rejects.toThrow('takes no task names');
    });
});

const fields = (params: z.ZodType) => undescribedFields({ params });

describe('undescribedFields', () => {
    test('a nested object: the field and its own fields', () => {
        const params = z.object({
            a: z.object({ x: z.number().describe('x'), y: z.number() }),
            b: z.string().describe('b'),
        });
        expect(fields(params)).toEqual(['a', 'a.y']);
    });

    test('an array of objects: the array, then its elements’ fields under []', () => {
        const params = z.object({ items: z.array(z.object({ item: z.string(), count: z.number().describe('n') })) });
        expect(fields(params)).toEqual(['items', 'items[].item']);
    });

    test('a description on any wrapper layer counts, inside or outside optional and default', () => {
        const params = z.object({
            inner: z.number().describe('d').optional(),
            outer: z.number().optional().describe('d'),
            dflt: z.number().default(1).describe('d'),
            dfltInner: z.number().describe('d').default(1),
            bare: z.number().default(1).optional(),
        });
        expect(fields(params)).toEqual(['bare']);
    });

    test('a union is one field; its object arm’s fields are checked at its path, scalar arms have none', () => {
        const params = z.object({
            rock: z.union([z.string(), z.object({ id: z.number(), at: z.number().describe('d') })]).describe('d'),
            scalar: z.union([z.string(), z.number()]),
            armsOnly: z.union([z.string().describe('d'), z.number().describe('d')]),
        });
        expect(fields(params)).toEqual(['rock.id', 'scalar', 'armsOnly']);
    });

    test('a described shared sub-schema describes the field; its inner fields are checked too', () => {
        const Shared = z.object({ x: z.number().describe('x'), y: z.number() }).describe('shared');
        expect(fields(z.object({ spot: Shared.optional() }))).toEqual(['spot.y']);
        expect(fields(z.object({ area: AreaSchema.optional() }))).toEqual([]);
    });

    test("Pattern's own description does not describe a field, nor a clone's: patternParam or a wrapper does", () => {
        const params = z.object({
            bare: Pattern,
            opt: Pattern.optional(),
            clone: Pattern.min(1),
            direct: Pattern.describe('the tree name'),
            used: patternParam('The tree name.'),
            usedOpt: patternParam('The tree name.').optional(),
            wrapped: Pattern.optional().describe('the tree name'),
        });
        expect(fields(params)).toEqual(['bare', 'opt', 'clone', 'direct']);
    });

    test('a root pipe is walked on its input side', () => {
        const params = z
            .object({ word: z.string(), n: z.number().describe('n') })
            .transform(p => ({ ...p, upper: p.word.toUpperCase() }));
        expect(fields(params)).toEqual(['word']);
    });

    test('a tuple: each item under its index', () => {
        const Tile = z.object({ x: z.number(), z: z.number().describe('z') });
        expect(fields(z.object({ route: z.tuple([Tile], Tile).describe('r') }))).toEqual(['route[0].x', 'route[].x']);
    });

    test('a schema kind it cannot walk throws rather than hiding fields', () => {
        expect(() => fields(z.object({ m: z.record(z.string(), z.number()).describe('m') }))).toThrow(
            'no walk for a record',
        );
    });
});

const noNote = (params: z.ZodType) => patternsWithoutNote({ params });

describe('patternsWithoutNote', () => {
    test('a Pattern described without the note is reported; with patternParam it passes', () => {
        const params = z.object({
            direct: Pattern.describe('The tree name.'),
            wrapped: patternParam('The tree name.').optional().describe('The tree name.'),
            used: patternParam('The tree name.'),
            usedDefault: patternParam('The tree name.').default('^Tree$'),
        });
        expect(noNote(params)).toEqual(['direct', 'wrapped']);
        expect(patternParam('The tree name.').description).toBe(`The tree name. ${PATTERN_NOTE}`);
    });

    test("array elements and union arms are checked; a bare Pattern there keeps Pattern's own note", () => {
        const params = z.object({
            list: z.array(Pattern.describe('one')).describe('d'),
            bareList: z.array(Pattern).describe('d'),
            item: z.union([Pattern.describe('a name'), z.object({ name: Pattern.describe('n') })]).describe('d'),
        });
        expect(noNote(params)).toEqual(['list[]', 'item', 'item.name']);
    });

    test('a plain string is not a Pattern', () => {
        expect(noNote(z.object({ s: z.string().describe('s'), r: z.string().regex(/a/).describe('r') }))).toEqual([]);
    });

    test('patternParam keeps the regex check', () => {
        expect(patternParam('x').safeParse('(').success).toBe(false);
        expect(patternParam('x').safeParse('^a$').success).toBe(true);
    });
});

/** Tasks that do not yet keep the catalog's rules. A task is added only by being exempted here, and this list must reach empty: the guard fails a listed task that keeps the rules. */
const NOT_YET = [
    'bank',
    'cooking',
    'crafting',
    'essence-mine',
    'fill',
    'firemaking',
    'fishing',
    'fletching',
    'herblore',
    'mining',
    'pick',
    'pickup',
    'runecraft',
    'shop',
    'smithing',
    'spell-items',
    'spinning',
    'woodcutting',
];
const MAX_DESCRIPTION = 900;

/** What a task breaks of the catalog's rules, one line each; empty when it keeps them all. */
function catalogProblems(task: TaskDef): string[] {
    const problems = undescribedFields(task).map(f => `param ${f} has no description`);
    for (const f of patternsWithoutNote(task))
        problems.push(`param ${f} is a Pattern whose description lacks PATTERN_NOTE: describe it with patternParam`);
    if (task.description.length > MAX_DESCRIPTION)
        problems.push(`description is ${task.description.length} characters, over ${MAX_DESCRIPTION}`);
    for (const key of ['rules', 'spots'] as const)
        for (const entry of task[key] ?? [])
            if (typeof entry !== 'string' || entry.trim() === '') problems.push(`${key} has an empty entry`);
    return problems;
}

describe('the catalog guard', () => {
    test('NOT_YET names only catalog tasks', () => {
        expect(NOT_YET.filter(n => !taskNames().includes(n))).toEqual([]);
    });

    for (const name of taskNames())
        test(name, async () => {
            const problems = catalogProblems(await loadTask(name));
            if (NOT_YET.includes(name)) {
                if (problems.length === 0)
                    throw new Error(`${name} keeps the catalog's rules now: take it out of NOT_YET`);
            } else expect(problems).toEqual([]);
        });
});

const stripDescriptions = (v: unknown): unknown =>
    Array.isArray(v)
        ? v.map(stripDescriptions)
        : v && typeof v === 'object'
          ? Object.fromEntries(
                Object.entries(v)
                    // A string `description` is a description; a param named `description` holds a schema.
                    .filter(([k, x]) => !(k === 'description' && typeof x === 'string'))
                    .map(([k, x]) => [k, stripDescriptions(x)]),
            )
          : v;

// Documenting a task moves words only: no params schema may change shape. The fixture is each task's input
// JSON Schema with every description removed. Regenerate it only for a deliberate params change:
// `UPDATE_CATALOG_SHAPES=1 bun test conductor/test/lib/catalog.test.ts` rewrites it (formatted with oxfmt) from
// the current schemas. It cannot see refinements (`refine`/`superRefine`, including Pattern's regex check) or
// transforms: JSON Schema carries neither, so changing one leaves it identical.
const FIXTURE = resolve(import.meta.dir, '../fixtures/catalog-shapes.json');

async function currentShapes(): Promise<Record<string, unknown>> {
    const shapes: Record<string, unknown> = {};
    for (const name of taskNames())
        shapes[name] = stripDescriptions(z.toJSONSchema((await loadTask(name)).params, { io: 'input' }));
    return shapes;
}

if (process.env.UPDATE_CATALOG_SHAPES) {
    writeFileSync(FIXTURE, JSON.stringify(await currentShapes(), null, 4) + '\n');
    // The committed file is oxfmt-formatted; format it the same way so a no-change run leaves it identical.
    const fmt = Bun.spawnSync(['bunx', 'oxfmt', FIXTURE], { cwd: resolve(import.meta.dir, '../../..') });
    if (fmt.exitCode !== 0) throw new Error(`oxfmt failed: ${String(fmt.stderr)}`);
}

describe('params shapes', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;

    test('the fixture covers every task', () => {
        expect(Object.keys(fixture).sort()).toEqual(taskNames());
    });

    for (const name of taskNames())
        test(name, async () => {
            const shape = stripDescriptions(z.toJSONSchema((await loadTask(name)).params, { io: 'input' }));
            expect(shape).toEqual(fixture[name]);
        });
});
