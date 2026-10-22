import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { serializeWorld } from '../build';
import { contentHash, type GitRun } from '../content-hash';
import { loadFreshWorld } from '../load';
import { stalePages, writePages } from '../stale';
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
        const file = join(tmp, 'untracked.tmp');
        const run = fakeGit({ status: '?? x', untracked: file });
        writeFileSync(file, 'one');
        const one = contentHash(run);
        writeFileSync(file, 'two');
        expect(contentHash(run)).not.toBe(one);
    });

    test('reads the NUL-separated list of ls-files -z, non-ASCII names included', () => {
        const a = join(tmp, 'caf\u00e9.tmp');
        const b = join(tmp, 'b.tmp');
        writeFileSync(a, 'a');
        writeFileSync(b, 'b');
        const both = contentHash(fakeGit({ status: '?? x', untracked: `${a}\0${b}\0` }));
        writeFileSync(a, 'changed');
        expect(contentHash(fakeGit({ status: '?? x', untracked: `${a}\0${b}\0` }))).not.toBe(both);
    });

    test('names a symlink or folder without reading it', () => {
        const dir = join(tmp, 'a-folder');
        mkdirSync(dir);
        const link = join(tmp, 'a-link');
        symlinkSync(join(tmp, 'nowhere'), link);
        expect(contentHash(fakeGit({ status: '?? x', untracked: `${dir}\0${link}\0` }))).toMatch(
            /-dirty-[0-9a-f]{12}$/,
        );
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
        connectors: [],
        quests: [],
        loadoutRules: {},
        transports: [],
        gates: [],
        crossings: [],
        methods: [],
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

/** A repo under `tmp` whose wiki/pages holds `names`, each saying "x". */
const repo = (name: string, names: string[]): string => {
    const root = join(tmp, name);
    mkdirSync(join(root, 'wiki/pages'), { recursive: true });
    for (const f of names) writeFileSync(join(root, 'wiki/pages', f), 'x');
    return root;
};

describe('stalePages', () => {
    test('lists the .md files not generated, other files aside, sorted and repo-relative; writePages removes them', () => {
        const root = repo('pages', ['keep.md', 'b.md', 'a.md', 'notes.txt']);
        const files = new Map([['wiki/pages/keep.md', 'new']]);
        const stale = stalePages('wiki/pages', files, root);
        expect(stale).toEqual(['wiki/pages/a.md', 'wiki/pages/b.md']);
        writePages({ files, stale }, root);
        expect(readFileSync(join(root, 'wiki/pages/keep.md'), 'utf8')).toBe('new');
        expect(existsSync(join(root, 'wiki/pages/notes.txt'))).toBe(true);
        expect(existsSync(join(root, 'wiki/pages/a.md'))).toBe(false);
    });

    test('never lists a README.md placed in the folder by hand', () =>
        expect(stalePages('wiki/pages', new Map(), repo('with-readme', ['README.md', 'old.md']))).toEqual([
            'wiki/pages/old.md',
        ]));

    test('lists none for a folder not yet made', () => expect(stalePages('wiki/none', new Map(), tmp)).toEqual([]));

    test('refuses a symlinked folder', () => {
        const target = join(tmp, 'target');
        mkdirSync(target);
        writeFileSync(join(target, 'precious.md'), 'x');
        mkdirSync(join(tmp, 'linked/wiki'), { recursive: true });
        symlinkSync(target, join(tmp, 'linked/wiki/pages'));
        expect(() => stalePages('wiki/pages', new Map(), join(tmp, 'linked'))).toThrow('is a symlink');
    });

    test('refuses an empty slug', () =>
        expect(() =>
            stalePages('wiki/pages', new Map([['wiki/pages/.md', 'x']]), repo('empty-slug', ['old.md'])),
        ).toThrow('empty slug'));
});
