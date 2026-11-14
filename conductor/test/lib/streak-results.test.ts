import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A fail streak's miss / missWith result is the run's failure: a call whose result is dropped compiles, counts, and
// never fails. This scan is textual and per line. A `.miss(` or `.missWith(` call is accepted when the text before
// its receiver (that line, or the previous non-blank line where the formatter wrapped) ends in `return`, `=` (an
// assignment), `=>` (an arrow body), `??`, `||`, `?`, `:`, `(` or `,` (an argument). Anything else, a bare statement
// above all, fails naming the file and line.
const ROOT = resolve(import.meta.dir, '../..');
const DIRS = ['tasks', 'lib'];
const CALL = /[\w$.]+\.(?:miss|missWith)\(/g;
const USED = /(?:\breturn|=>?|\?\?|\|\||[?:(,])\s*$/;

function unused(source: string): number[] {
    const lines = source.split('\n');
    const bad: number[] = [];
    lines.forEach((line, i) => {
        let previous = '';
        for (let j = i - 1; j >= 0; j--)
            if (lines[j]?.trim()) {
                previous = lines[j] ?? '';
                break;
            }
        for (const m of line.matchAll(CALL)) {
            const before = line.slice(0, m.index).trim();
            if (!USED.test(before || previous.trim())) bad.push(i + 1);
        }
    });
    return bad;
}

test('the scan catches a dropped result and accepts a used one', () => {
    expect(unused('    S.miss(ctx);\n')).toEqual([1]);
    expect(unused('    if (x) {\n        S.missWith(ctx, "r");\n')).toEqual([2]);
    expect(unused('    return S.miss(ctx);\n    const f = S.miss(ctx);\n    g(a, S.miss(ctx));\n')).toEqual([]);
    expect(unused('    return a ?? S.miss(ctx);\n    miss: c =>\n        S.missWith(c, "r"),\n')).toEqual([]);
});

test('every miss / missWith result in tasks and lib is used', () => {
    const offenders = DIRS.flatMap(dir =>
        readdirSync(resolve(ROOT, dir))
            .filter(f => f.endsWith('.ts'))
            .flatMap(f => unused(readFileSync(resolve(ROOT, dir, f), 'utf8')).map(n => `conductor/${dir}/${f}:${n}`)),
    );
    expect(offenders).toEqual([]);
});
