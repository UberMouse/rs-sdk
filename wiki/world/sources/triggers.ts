// RuneScript (.rs2) files: each script starts with a `[trigger,subject]` header line and runs to the
// next one. What makes a loc or npc usable is the op trigger on it, so classification reads these.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface Trigger {
    file: string;
    on: 'loc' | 'npc';
    /** '1'-'5', or 'u' for use-item-on. */
    op: string;
    /** Config or category name, without the category's leading underscore. */
    target: string;
    category: boolean;
    /** The header line's tail and every line up to the next `[` header. */
    body: string;
}

/** A label or proc: a script a trigger body calls, by `@name` or `~name`. */
export interface Callable {
    file: string;
    /** How a body calls it: `@name` for a label, `~name` for a proc. */
    call: string;
    /** The header line's tail (its parameter list) and every line up to the next `[` header. */
    body: string;
}

interface Block {
    file: string;
    header: string;
    body: string;
}

function blocks(file: string, text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | undefined;
    for (const line of text.split('\n')) {
        const end = line.startsWith('[') ? line.indexOf(']') : -1;
        if (line.startsWith('[') && end < 0) {
            // An unterminated `[` line is no header, and it ends the block before it.
            cur = undefined;
        } else if (end >= 0) {
            cur = { file, header: line.slice(0, end + 1), body: line.slice(end + 1) };
            out.push(cur);
        } else if (cur) {
            cur.body += '\n' + line;
        }
    }
    return out;
}

// `op` and `ap` (approach) both count: one subject often has both an op and an ap trigger, and both are kept (`opsOf` in classify.ts
// collapses them to the op slot). A
// leading `_` names a category (`[apnpc3,_bank_teller]`); `t` (spell on) ops are not uses.
const OP = /^\[(?:op|ap)(loc|npc)([1-5u]),(_?)([a-z0-9_]+)\]$/;

export function parseTriggers(file: string, text: string): Trigger[] {
    return blocks(file, text).flatMap(b => {
        const m = b.header.match(OP);
        return m
            ? [{ file, on: m[1] as 'loc' | 'npc', op: m[2]!, category: m[3] === '_', target: m[4]!, body: b.body }]
            : [];
    });
}

export function parseCallables(file: string, text: string): Callable[] {
    return blocks(file, text).flatMap(b => {
        const m = b.header.match(/^\[(label|proc),([a-z0-9_]+)\]$/);
        return m ? [{ file, call: (m[1] === 'label' ? '@' : '~') + m[2], body: b.body }] : [];
    });
}

function readScripts(): [file: string, text: string][] {
    return [...new Glob('**/*.rs2').scanSync(SCRIPTS)]
        .filter(f => !f.startsWith('_test/') && !f.startsWith('_unpack/'))
        .sort()
        .map(f => [f, readFileSync(join(SCRIPTS, f), 'utf8')]);
}

export const readTriggers = (): Trigger[] => readScripts().flatMap(([f, text]) => parseTriggers(f, text));

export const readCallables = (): Callable[] => readScripts().flatMap(([f, text]) => parseCallables(f, text));
