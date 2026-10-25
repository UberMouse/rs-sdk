import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { defineTask } from '../../lib/task';
import { simulate } from '../simulate';
import { world } from '../world';

type Extra = { diagnostics?: Record<string, unknown>; warnings?: string[] };

/** A task that is done at once; `hook` is its diagnostics hook. */
const stub = (hook: (() => Extra) | undefined, calls: { n: number } = { n: 0 }) =>
    defineTask({
        name: 'stub',
        description: 'ends at once',
        params: z.object({ n: z.number().default(1) }),
        steps: [{ name: 'finish', when: () => true, run: () => ({ done: 'ok' }) }],
        ...(hook && {
            diagnostics: () => {
                calls.n++;
                return hook();
            },
        }),
    });

const timeline = world().series(3);

describe('engine: task diagnostics', () => {
    test('a hook with diagnostics and warnings puts both in the RESULT and prints a warning line', async () => {
        const r = await simulate(
            stub(() => ({ diagnostics: { idleTicks: 4 }, warnings: ['look here'] })),
            { timeline },
        );
        expect(r.result.status).toBe('done');
        expect(r.result.diagnostics).toEqual({ idleTicks: 4 });
        expect(r.result.warnings).toEqual(['look here']);
        expect(r.printed.some(l => l.includes('warning: look here'))).toBe(true);
    });

    test('empty parts leave both keys absent', async () => {
        const r = await simulate(
            stub(() => ({ diagnostics: {}, warnings: [] })),
            { timeline },
        );
        expect(r.result.status).toBe('done');
        expect('diagnostics' in r.result).toBe(false);
        expect('warnings' in r.result).toBe(false);
        expect(r.printed.some(l => l.includes('warning:'))).toBe(false);
    });

    test('a throwing hook leaves the status unchanged and is logged', async () => {
        const r = await simulate(
            stub(() => {
                throw new Error('boom');
            }),
            { timeline },
        );
        expect(r.result.status).toBe('done');
        expect('diagnostics' in r.result).toBe(false);
        expect(r.printed.some(l => l.includes('diagnostics failed: boom'))).toBe(true);
    });

    test('invalid params never call the hook', async () => {
        const calls = { n: 0 };
        const r = await simulate(
            stub(() => ({ warnings: ['x'] }), calls),
            { params: { n: 'many' }, timeline },
        );
        expect(r.result.status).toBe('error');
        expect(calls.n).toBe(0);
        expect('warnings' in r.result).toBe(false);
    });
});
