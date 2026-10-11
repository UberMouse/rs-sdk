// .dbrow files: `[row]`, `table=<table>`, then `data=<column>,<value>[,<value>...]`. A column may repeat
// (one data= line per value tuple), so each column keeps a list of tuples.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Glob } from 'bun';
import { SCRIPTS } from '../paths';

export interface DbRow {
    row: string;
    table: string;
    data: Record<string, string[][]>;
}

// Splits on commas outside double quotes and drops the quotes, exactly as the packer's parseCsv does
// (server/engine/tools/pack/config/DbRowConfig.ts): a quote toggles state, there is no escape syntax.
export function splitCsv(str: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of str) {
        if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else if (ch === '"') {
            inQuotes = !inQuotes;
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

export function parseDbrows(text: string): DbRow[] {
    const rows: DbRow[] = [];
    let cur: DbRow | undefined;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            cur = { row: header[1]!, table: '', data: {} };
            rows.push(cur);
        } else if (cur && line.startsWith('table=')) {
            cur.table = line.slice(6);
        } else if (cur && line.startsWith('data=')) {
            const [col, ...vals] = splitCsv(line.slice(5));
            (cur.data[col!] ??= []).push(vals);
        }
    }
    return rows;
}

export function readDbrows(): DbRow[] {
    return [...new Glob('**/*.dbrow').scanSync(SCRIPTS)]
        .filter(f => !f.startsWith('_test/'))
        .sort()
        .flatMap(f => parseDbrows(readFileSync(join(SCRIPTS, f), 'utf8')));
}
