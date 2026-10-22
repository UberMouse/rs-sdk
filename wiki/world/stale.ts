// Guards for deleting generated files: refuseSymlink (used by render.ts writeFiles) and stalePages, with the
// Pages the wiki/npcs, wiki/shops and wiki/items generators return (they import this module rather than the
// render graph).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ROOT } from './paths';
import { cmp } from './util';

/** Throws when `dir` is a symlink (a dangling one too), since deleting through it would delete wherever it points. */
export function refuseSymlink(dir: string): void {
    // lstat, not exists: a dangling link is still a link.
    if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error(`${dir} is a symlink; stale files are removed only from a real folder`);
}

/** A folder's README.md is placed by hand, never generated, so it is never stale. */
const README = 'README.md';

/** The wiki index the npcs, shops and items generators each rewrite a section of, when it exists. */
export const WIKI_README = 'wiki/README.md';

/** What a generator would write (repo-relative path -> content) and the pages it would remove (repo-relative). */
export interface Pages {
    files: Map<string, string>;
    stale: string[];
}

/**
 * The `.md` files in the repo-relative folder `dir` under `root` not among `files`' paths, README.md aside, as
 * repo-relative paths, sorted; none when the folder is missing. For the generators of wiki/npcs, wiki/shops
 * and wiki/items, whose pages are all generated. It throws when `dir` is a symlink or `files` holds an empty
 * slug (`<dir>/.md`), which names no page.
 */
export function stalePages(dir: string, files: ReadonlyMap<string, string>, root: string = ROOT): string[] {
    const at = join(root, dir);
    refuseSymlink(at);
    if (files.has(`${dir}/.md`)) throw new Error(`a page with an empty slug (.md) was generated in ${dir}`);
    if (!existsSync(at)) return [];
    return readdirSync(at)
        .filter(f => f.endsWith('.md') && f !== README && !files.has(`${dir}/${f}`))
        .map(f => `${dir}/${f}`)
        .sort(cmp);
}

/** wiki/README.md as an earlier step left it in `prior`, else as on disk under `root`; undefined when neither has it. */
export function priorReadme(prior: ReadonlyMap<string, string>, root: string = ROOT): string | undefined {
    const file = join(root, WIKI_README);
    return prior.get(WIKI_README) ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
}

/** Writes `pages.files` under `root` and removes `pages.stale`: a generator run on its own. */
export function writePages(pages: Pages, root: string = ROOT): void {
    for (const [p, text] of pages.files) {
        const file = join(root, p);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
    }
    for (const p of pages.stale) {
        refuseSymlink(dirname(join(root, p)));
        unlinkSync(join(root, p));
    }
}
