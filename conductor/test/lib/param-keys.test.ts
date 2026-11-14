import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { loadTask, taskNames } from '../../lib/catalog';
import { paramKeys, unknownParams, unknownParamsReason } from '../../lib/param-keys';

const Obj = z.object({ a: z.number(), b: z.string().optional() });

describe('paramKeys', () => {
    test("a plain object's keys, through wrappers, refinements and a transform's input", () => {
        expect(paramKeys(Obj)).toEqual(['a', 'b']);
        expect(paramKeys(Obj.default({ a: 1 }))).toEqual(['a', 'b']);
        expect(paramKeys(Obj.refine(p => p.a > 0))).toEqual(['a', 'b']);
        expect(paramKeys(Obj.superRefine(() => {}))).toEqual(['a', 'b']);
        expect(paramKeys(Obj.transform(p => p.a))).toEqual(['a', 'b']);
    });

    test('a union or intersection takes the keys of any part', () => {
        expect(paramKeys(z.union([Obj, z.object({ c: z.number() })]))).toEqual(['a', 'b', 'c']);
        expect(paramKeys(z.intersection(Obj, z.object({ a: z.number(), d: z.number() })))).toEqual(['a', 'b', 'd']);
    });

    test('an object that takes any key, or a schema that is no object, cannot be listed', () => {
        expect(paramKeys(Obj.passthrough())).toBeNull();
        expect(paramKeys(Obj.catchall(z.number()))).toBeNull();
        expect(paramKeys(z.record(z.string(), z.number()))).toBeNull();
        expect(paramKeys(z.strictObject({ a: z.number() }))).toEqual(['a']);
    });
});

describe('unknownParams', () => {
    test('top-level keys only: a nested object keeps its own schema', () => {
        const S = z.object({ area: z.object({ x: z.number() }) });
        expect(unknownParams(S, { area: { x: 1, typo: 2 } })).toEqual([]);
        expect(unknownParams(S, { area: { x: 1 }, aera: 2 })).toEqual(['aera']);
    });

    test('nothing to refuse in a value that is no plain object, or in a schema whose keys cannot be listed', () => {
        expect(unknownParams(Obj, undefined)).toEqual([]);
        expect(unknownParams(Obj, [1])).toEqual([]);
        expect(unknownParams(Obj.passthrough(), { z: 1 })).toEqual([]);
    });
});

describe('unknownParamsReason', () => {
    const task = { name: 'demo', params: Obj };
    test('names one key, or every unknown key, with the keys the task takes', () => {
        expect(unknownParamsReason(task, { a: 1 })).toBeNull();
        expect(unknownParamsReason(task, { a: 1, x: 2 })).toBe('unknown param "x" (demo takes: a, b)');
        expect(unknownParamsReason(task, { x: 2, a: 1, y: 3 })).toBe('unknown params "x", "y" (demo takes: a, b)');
    });

    test('a task with no params', () => {
        expect(unknownParamsReason({ name: 'none', params: z.object({}) }, { x: 1 })).toBe(
            'unknown param "x" (none takes no params)',
        );
    });
});

test("every catalog task's top-level keys can be listed, so a key it does not take is refused", async () => {
    const unlisted: string[] = [];
    for (const name of taskNames()) if (!paramKeys((await loadTask(name)).params)) unlisted.push(name);
    expect(unlisted).toEqual([]);
});
