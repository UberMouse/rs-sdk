// RuneScript (.rs2) files: each script starts with a `[trigger,subject]` header line and runs to the
// next one. What makes a loc or npc usable is the op trigger on it, so classification reads these.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface Trigger {
    file: string;
    on: 'loc' | 'npc';
    /** `op` or `ap` (approach), as the header gives it: the engine looks each up as its own trigger. */
    kind: 'op' | 'ap';
    /** '1'-'5', or 'u' for use-item-on. */
    op: string;
    /** Config or category name, without the category's leading underscore. */
    target: string;
    category: boolean;
    /** The header's line in the file, from 1. */
    line: number;
    /** The header line's tail and every line up to the next `[` header. */
    body: string;
}

/** A label or proc: a script a trigger body calls, by `@name` or `~name`; or a queue script a body queues. */
export interface Callable {
    file: string;
    /** How a body calls it: `@name` for a label, `~name` for a proc, `queue,name` for a queue script (parseQueues). */
    call: string;
    /** The header's line in the file, from 1. */
    line: number;
    /** The header line's tail (its parameter list) and every line up to the next `[` header. */
    body: string;
}

/** One script in a file: its `[trigger,subject]` header, the header's line, and its body. */
export interface Block {
    file: string;
    header: string;
    line: number;
    body: string;
}

export function blocks(file: string, text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | undefined;
    for (const [i, line] of text.split('\n').entries()) {
        const end = line.startsWith('[') ? line.indexOf(']') : -1;
        if (line.startsWith('[') && end < 0) {
            // An unterminated `[` line is no header, and it ends the block before it.
            cur = undefined;
        } else if (end >= 0) {
            cur = { file, header: line.slice(0, end + 1), line: i + 1, body: line.slice(end + 1) };
            out.push(cur);
        } else if (cur) {
            cur.body += '\n' + line;
        }
    }
    return out;
}

// `op` and `ap` (approach) both count: one subject often has both, and both are kept (`opsOf` in
// classify.ts collapses them to the op slot). A leading `_` names a category (`[apnpc3,_bank_teller]`);
// `t` (spell on) ops are not uses.
const OP = /^\[(op|ap)(loc|npc)([1-5u]),(_?)([a-z0-9_]+)\]$/;

export function parseTriggers(file: string, text: string): Trigger[] {
    return blocks(file, text).flatMap(b => {
        const m = b.header.match(OP);
        return m
            ? [
                  {
                      file,
                      on: m[2] as 'loc' | 'npc',
                      kind: m[1] as 'op' | 'ap',
                      op: m[3]!,
                      category: m[4] === '_',
                      target: m[5]!,
                      line: b.line,
                      body: b.body,
                  },
              ]
            : [];
    });
}

/** An approach trigger that opens by widening its range: `if (npc_range(coord) > n) { p_aprange(n); return; }`. */
const AP_RANGE =
    /^\s*if\s*\(\s*npc_range\(\s*coord\s*\)\s*>\s*(\d+)\s*\)\s*\{\s*p_aprange\(\s*(\d+)\s*\);\s*return;\s*\}/;

/**
 * The range an npc's approach ops are used from (the Burthorpe Games Room barmaid across her bar,
 * minigames/game_gamesroom/general/scripts/boardgames_barmaid.rs2:3): for each op, the trigger the engine runs (the
 * config's own, else its category's) when its body, comments left out, opens as AP_RANGE writes it; the least over
 * the ops. Undefined for an npc none of whose approach triggers widens its range.
 */
export function approachRange(
    triggers: readonly Trigger[],
): (config: string, category: string | undefined) => number | undefined {
    // By `<target> <op>`, the target `_<category>` for a category's trigger: its range, or null for one without.
    const byOp = new Map<string, number | null>();
    const ops = new Set<string>();
    for (const t of triggers) {
        if (t.on !== 'npc' || t.kind !== 'ap') continue;
        const m = t.body.replace(/\/\/[^\n]*/g, '').match(AP_RANGE);
        byOp.set(`${t.category ? '_' : ''}${t.target} ${t.op}`, m && m[1] === m[2] ? Number(m[1]) : null);
        ops.add(t.op);
    }
    return (config, category) => {
        let least: number | undefined;
        for (const op of ops) {
            const own = byOp.get(`${config} ${op}`);
            const range = own !== undefined ? own : category === undefined ? undefined : byOp.get(`_${category} ${op}`);
            if (typeof range === 'number') least = Math.min(least ?? range, range);
        }
        return least;
    };
}

export function parseCallables(file: string, text: string): Callable[] {
    return blocks(file, text).flatMap(b => {
        const m = b.header.match(/^\[(label|proc),([a-z0-9_]+)\]$/);
        return m ? [{ file, call: (m[1] === 'label' ? '@' : '~') + m[2], line: b.line, body: b.body }] : [];
    });
}

/**
 * The `[queue,name]` scripts, which a `queue`, `strongqueue`, `weakqueue` or `longqueue` command names: the engine
 * runs one once the script that queued it ends (server/engine/src/engine/entity/Player.ts processQueue).
 */
export function parseQueues(file: string, text: string): Callable[] {
    return blocks(file, text).flatMap(b => {
        const m = b.header.match(/^\[queue,([a-z0-9_]+)\]$/);
        return m ? [{ file, call: `queue,${m[1]}`, line: b.line, body: b.body }] : [];
    });
}

/** Every .rs2 file outside `_test/` and `_unpack/`, by path relative to server/content/scripts. */
export function readScripts(): [file: string, text: string][] {
    return [...new Glob('**/*.rs2').scanSync(SCRIPTS)]
        .filter(f => !f.startsWith('_test/') && !f.startsWith('_unpack/'))
        .sort()
        .map(f => [f, readFileSync(join(SCRIPTS, f), 'utf8')]);
}

export const readTriggers = (): Trigger[] => readScripts().flatMap(([f, text]) => parseTriggers(f, text));

export const readCallables = (): Callable[] => readScripts().flatMap(([f, text]) => parseCallables(f, text));
