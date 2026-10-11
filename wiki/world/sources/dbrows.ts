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
            const [col, ...vals] = line.slice(5).split(',');
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
