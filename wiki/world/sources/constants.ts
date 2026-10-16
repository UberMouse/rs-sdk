// RuneScript constants (`*.constant`): one `^name = value` per line. A value is a number, a coord
// literal or a bare name, as the scripts would write it in the constant's place.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface Constant {
    value: string;
    /** `file:line`, the file relative to server/content/scripts. */
    at: string;
}

/** The constants in one file, by name with its `^`. */
export function parseConstants(file: string, text: string): Map<string, Constant> {
    const out = new Map<string, Constant>();
    for (const [i, raw] of text.split('\n').entries()) {
        const m = raw.match(/^\s*(\^[a-z0-9_]+)\s*=\s*(.*?)\s*(?:\/\/.*)?$/);
        if (m) out.set(m[1]!, { value: m[2]!, at: `${file}:${i + 1}` });
    }
    return out;
}

/**
 * Every constant outside `_test/`, throwing on one defined twice (naming both places), as the
 * compiler does: no precedence rule is needed.
 */
export function collectConstants(files: [file: string, text: string][]): Map<string, Constant> {
    const out = new Map<string, Constant>();
    for (const [file, text] of files)
        for (const [name, c] of parseConstants(file, text)) {
            const seen = out.get(name);
            if (seen) throw new Error(`Duplicate constant ${name} in ${seen.at} and ${c.at}`);
            out.set(name, c);
        }
    return out;
}

export function readConstants(): Map<string, Constant> {
    const files = [...new Glob('**/*.constant').scanSync(SCRIPTS)].filter(f => !f.startsWith('_test/')).sort();
    return collectConstants(files.map((f): [string, string] => [f, readFileSync(join(SCRIPTS, f), 'utf8')]));
}

/** A constant's value as a whole number, or undefined when it is not one. */
export function constantInt(constants: ReadonlyMap<string, Constant>, name: string): number | undefined {
    const v = constants.get(name)?.value;
    return v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined;
}
