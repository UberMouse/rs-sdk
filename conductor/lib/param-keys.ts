// The top-level keys a task's params schema takes, so a run can refuse the keys a plain `z.object` drops.
import type { z } from 'zod/v4';

/** The fields of a zod schema's `def` that the schema walks here and in `catalog.ts` read. */
export interface SchemaDef {
    type: string;
    innerType?: z.ZodType;
    in?: z.ZodType;
    shape?: Record<string, z.ZodType>;
    catchall?: z.ZodType;
    element?: z.ZodType;
    options?: z.ZodType[];
    items?: z.ZodType[];
    rest?: z.ZodType | null;
    left?: z.ZodType;
    right?: z.ZodType;
}
export const defOf = (s: z.ZodType) => s.def as unknown as SchemaDef;
/** Layers that wrap one schema; a pipe (a `.transform`) is read on its input side, where the raw params go. */
const WRAPPERS = new Set(['optional', 'default', 'prefault', 'nullable', 'nonoptional', 'readonly', 'catch']);

/** The schema one layer under `s` (a wrapper's inner schema, a pipe's input); undefined when `s` wraps nothing. */
export function peelLayer(s: z.ZodType): z.ZodType | undefined {
    const d = defOf(s);
    if (WRAPPERS.has(d.type) && d.innerType) return d.innerType;
    if (d.type === 'pipe' && d.in) return d.in;
    return undefined;
}

/**
 * The top-level keys `schema` takes, in schema order; null when they cannot be listed (an object with a
 * catchall takes any key, and a schema kind not walked here may). A union or intersection takes the keys
 * of any of its parts.
 */
export function paramKeys(schema: z.ZodType): string[] | null {
    const inner = peelLayer(schema);
    if (inner) return paramKeys(inner);
    const d = defOf(schema);
    if (d.type === 'object')
        return d.catchall && defOf(d.catchall).type !== 'never' ? null : Object.keys(d.shape ?? {});
    const parts =
        d.type === 'union'
            ? (d.options ?? [])
            : d.type === 'intersection' && d.left && d.right
              ? [d.left, d.right]
              : null;
    if (!parts) return null;
    const keys: string[] = [];
    for (const part of parts) {
        const k = paramKeys(part);
        if (!k) return null;
        for (const key of k) if (!keys.includes(key)) keys.push(key);
    }
    return keys;
}

/** The top-level keys of `raw` that `schema` does not take; none when `raw` is no plain object or the keys cannot be listed. */
export function unknownParams(schema: z.ZodType, raw: unknown): string[] {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
    const keys = paramKeys(schema);
    return keys ? Object.keys(raw).filter(k => !keys.includes(k)) : [];
}

/**
 * Why `raw` is refused for `task`: `unknown param "x" (task takes: a, b)`, or `unknown params "x", "y" (...)`;
 * null when every key is one the schema takes.
 */
export function unknownParamsReason(task: { name: string; params: z.ZodType }, raw: unknown): string | null {
    const unknown = unknownParams(task.params, raw);
    if (!unknown.length) return null;
    const named = unknown.map(k => `"${k}"`).join(', ');
    const keys = paramKeys(task.params) ?? [];
    const takes = keys.length ? `takes: ${keys.join(', ')}` : 'takes no params';
    return `unknown param${unknown.length > 1 ? 's' : ''} ${named} (${task.name} ${takes})`;
}
