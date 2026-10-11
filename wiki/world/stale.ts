// Guards for deleting generated files: refuseSymlink (used by render.ts writeFiles) and removeStalePages
// (used by the wiki/npcs and wiki/shops generators, which import this module rather than the render graph).
import { lstatSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { cmp } from './util';

/** Throws when `dir` is a symlink (a dangling one too), since deleting through it would delete wherever it points. */
export function refuseSymlink(dir: string): void {
    // lstat, not exists: a dangling link is still a link.
    if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error(`${dir} is a symlink; stale files are removed only from a real folder`);
}

/** A folder's README.md is placed by hand, never generated, so it is never stale. */
const README = 'README.md';

/**
 * Removes the `.md` files in `dir` not among `written`, README.md aside, and returns their names,
 * sorted. For the generators of wiki/npcs and wiki/shops, whose pages are all generated. It throws,
 * before removing anything, when `dir` is a symlink or `written` holds an empty slug (`.md`), which
 * names no page.
 */
export function removeStalePages(dir: string, written: ReadonlySet<string>): string[] {
    refuseSymlink(dir);
    if (written.has('.md')) throw new Error(`a page with an empty slug (.md) was generated in ${dir}`);
    const stale = readdirSync(dir)
        .filter(f => f.endsWith('.md') && f !== README && !written.has(f))
        .sort(cmp);
    for (const f of stale) unlinkSync(join(dir, f));
    return stale;
}
