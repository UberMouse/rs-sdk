// The hash world.json records as generatedFrom: the server/content it was built from. A module of its
// own, so load.ts and its readers need not load the builder.
import { lstatSync, readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { ROOT } from './paths';
import { cmp } from './util';

const git = (args: string[]): string => {
    const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stderr: 'pipe' });
    if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString().trim()}`);
    return run.stdout.toString().trim();
};

/** Runs git in the repo and returns its trimmed stdout; contentHash takes one so a test can stub it. */
export type GitRun = (args: string[]) => string;

/**
 * The last commit that touched server/content, so the hash moves only when server/content does.
 * When server/content has uncommitted changes it is `<sha>-dirty-<digest>`: the digest is the first
 * 12 hex of the sha1 over `git diff HEAD --binary -- server/content` and each untracked file there
 * (its path and, for a regular file, bytes), so a further uncommitted edit moves the hash again and
 * a stale world.json is not mistaken for a fresh one. It names the content and nothing more: it
 * misses an edit to the builder or to areas.ts, so whether world.json is fresh is answered by
 * rebuilding and comparing the bytes, not by this hash.
 */
export function contentHash(run: GitRun = git): string {
    const hash = run(['log', '-1', '--format=%H', '--', 'server/content']);
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error(`git log on server/content gave no commit: ${hash}`);
    if (!run(['status', '--porcelain', '--', 'server/content'])) return hash;
    const digest = new Bun.CryptoHasher('sha1');
    digest.update(run(['diff', 'HEAD', '--binary', '--', 'server/content']));
    const untracked = run(['ls-files', '-z', '--others', '--exclude-standard', '--', 'server/content'])
        .split('\0')
        .filter(Boolean)
        .sort(cmp);
    for (const file of untracked) {
        // git prints paths relative to the repo; a test's stub may give absolute ones.
        const path = resolvePath(ROOT, file);
        digest.update(`\0${file}\0`);
        // Only regular files have bytes to digest: a symlink or folder is named, not read.
        if (lstatSync(path).isFile()) digest.update(readFileSync(path));
    }
    return `${hash}-dirty-${digest.digest('hex').slice(0, 12)}`;
}
