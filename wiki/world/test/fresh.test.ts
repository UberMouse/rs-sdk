import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { contentHash, serializeWorld, type GitRun } from '../build';
import { loadFreshWorld } from '../load';
import { removeStalePages } from '../render';
import { ROOT } from '../paths';
import { WORLD_FORMAT, type World } from '../types';

const tmp = mkdtempSync(join(tmpdir(), 'fresh-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SHA = 'a'.repeat(40);

/** A stub git: the answers per subcommand. */
const fakeGit =
    (answers: { status?: string; diff?: string; untracked?: string }): GitRun =>
    args => {
        if (args[0] === 'log') return SHA;
        if (args[0] === 'status') return answers.status ?? '';
        if (args[0] === 'diff') return answers.diff ?? '';
        if (args[0] === 'ls-files') return answers.untracked ?? '';
        throw new Error(`unexpected git ${args.join(' ')}`);
    };

describe('contentHash', () => {
    test('is the bare commit when server/content is clean', () => {
        expect(contentHash(fakeGit({}))).toBe(SHA);
    });

    test('is dirty with a digest that moves with each further uncommitted edit', () => {
        const dirty = { status: ' M server/content/a.rs2' };
        const one = contentHash(fakeGit({ ...dirty, diff: 'edit one' }));
        const two = contentHash(fakeGit({ ...dirty, diff: 'edit two' }));
        expect(one).toMatch(new RegExp(`^${SHA}-dirty-[0-9a-f]{12}$`));
        expect(two).toMatch(new RegExp(`^${SHA}-dirty-[0-9a-f]{12}$`));
        expect(one).not.toBe(two);
        expect(contentHash(fakeGit({ ...dirty, diff: 'edit one' }))).toBe(one);
    });

    test('digests an untracked file by its path and bytes', () => {
        const rel = 'wiki/world/test/.fresh-untracked.tmp';
        const file = join(ROOT, rel);
        const run = fakeGit({ status: '?? x', untracked: rel });
        try {
            writeFileSync(file, 'one');
            const one = contentHash(run);
            writeFileSync(file, 'two');
            expect(contentHash(run)).not.toBe(one);
        } finally {
            rmSync(file, { force: true });
        }
    });

    test('refuses a log that names no commit', () => {
        expect(() => contentHash(() => '')).toThrow('gave no commit');
    });
});

describe('loadFreshWorld', () => {
    const world: World = {
        format: WORLD_FORMAT,
        generatedFrom: 'abc',
        areas: [],
        features: [],
        sites: [],
        npcSpawns: [],
    };
    const file = join(tmp, 'world.json');
    writeFileSync(file, serializeWorld(world));

    test('returns the world when it was built from the content as it is now', () => {
        expect(loadFreshWorld(file, () => 'abc').generatedFrom).toBe('abc');
    });

    test('refuses a stale one, naming both hashes, the uncommitted-changes cause and the fix', () => {
        expect(() => loadFreshWorld(file, () => 'def')).toThrow(
            /built from server\/content at abc, which is now at def \(server\/content may have uncommitted changes\): regenerate it with bun run world/,
        );
    });
});

describe('removeStalePages', () => {
    test('removes the .md files not written, leaving other files, and returns them sorted', () => {
        const dir = join(tmp, 'pages');
        mkdirSync(dir);
        for (const f of ['keep.md', 'b.md', 'a.md', 'notes.txt']) writeFileSync(join(dir, f), 'x');
        expect(removeStalePages(dir, new Set(['keep.md']))).toEqual(['a.md', 'b.md']);
        expect(existsSync(join(dir, 'keep.md'))).toBe(true);
        expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
        expect(existsSync(join(dir, 'a.md'))).toBe(false);
    });

    test('refuses a symlinked folder, removing nothing through it', () => {
        const target = join(tmp, 'target');
        mkdirSync(target);
        writeFileSync(join(target, 'precious.md'), 'x');
        const link = join(tmp, 'link');
        symlinkSync(target, link);
        expect(() => removeStalePages(link, new Set())).toThrow('is a symlink');
        expect(existsSync(join(target, 'precious.md'))).toBe(true);
    });

    test('refuses an empty slug, removing nothing', () => {
        const dir = join(tmp, 'empty-slug');
        mkdirSync(dir);
        writeFileSync(join(dir, 'old.md'), 'x');
        expect(() => removeStalePages(dir, new Set(['.md']))).toThrow('empty slug');
        expect(existsSync(join(dir, 'old.md'))).toBe(true);
    });
});
