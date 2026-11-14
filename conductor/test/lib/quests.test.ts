// The quest table and what the quest tab says of a quest.
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../lib/env';
import { colourProgress, journalTitle, QUESTS, questIdByJournalTitle, questProgress } from '../../lib/quests';
import { world } from '../world';

describe('QUESTS', () => {
    test('covers the quests the plans and the world index name', () => {
        for (const id of [
            'waterfall',
            'imp',
            'priest',
            'runemysteries',
            'priestperil',
            'druid',
            'arthur',
            'grail',
            'dragon',
        ]) {
            expect(QUESTS[id]).toBeDefined();
        }
        expect(QUESTS.runemysteries).toMatchObject({ varp: 'runemysteries', complete: 6 });
        expect(QUESTS.imp).toMatchObject({ name: 'Imp Catcher', complete: 2 });
        expect(QUESTS.priest).toMatchObject({ varp: 'prieststart', complete: 5 });
    });

    test('names are unique, since the tab is matched by name', () => {
        const names = Object.values(QUESTS).map(q => q.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test("every row's journal title is the name its journal script gives ~quest_journal", () => {
        const scripts = new Map<string, string>();
        for (const f of new Glob('**/*.rs2').scanSync(join(REPO_ROOT, 'server/content/scripts/quests'))) {
            const text = readFileSync(join(REPO_ROOT, 'server/content/scripts/quests', f), 'utf8');
            for (const m of text.matchAll(/^\[if_button,questlist:(\w+)\]/gm)) scripts.set(m[1]!, text);
        }
        for (const [id, q] of Object.entries(QUESTS)) {
            const text = scripts.get(id);
            expect(text, `${id} has a journal script`).toBeDefined();
            // A literal, or the `$n` most scripts pass, defined once at the top.
            const names = new Set([...text!.matchAll(/~quest_journal\(("(?:[^"\\]|\\.)*"|\$\w+),/g)].map(m => m[1]!));
            const named = [...names].map(n => {
                if (n.startsWith('"')) return JSON.parse(n) as string;
                const defs = [...text!.matchAll(new RegExp(`def_string \\${n} = ("(?:[^"\\\\]|\\\\.)*")`, 'g'))];
                expect(defs.length, `${id}: ${n} is defined once`).toBe(1);
                expect(text!.match(new RegExp(`^\\s*\\${n} = `, 'm')), `${id}: ${n} is never reassigned`).toBeNull();
                return JSON.parse(defs[0]![1]!) as string;
            });
            expect(named, id).toEqual([journalTitle(q)]);
            if (q.journalTitle !== undefined) expect(q.journalTitle, `${id} needs no journalTitle`).not.toBe(q.name);
        }
    });

    test('journal titles are unique, since the journal is matched to its quest by title', () => {
        const titles = Object.values(QUESTS).map(journalTitle);
        expect(new Set(titles).size).toBe(titles.length);
        expect(questIdByJournalTitle("The Cook's Quest")).toBe('cook');
        expect(questIdByJournalTitle("Cook's Assistant")).toBeUndefined();
    });

    test('every row names a source line that holds what the row says', () => {
        for (const [id, q] of Object.entries(QUESTS)) {
            const [file, line] = q.source.split(/:(?=\d+$)/);
            expect(existsSync(join(REPO_ROOT, file!))).toBe(true);
            const text = readFileSync(join(REPO_ROOT, file!), 'utf8').split('\n')[Number(line) - 1]!;
            expect(text).toContain(`questlist:${id}`);
            const [cfile, cline] = q.completeSource.split(/:(?=\d+$)/);
            const ctext = readFileSync(join(REPO_ROOT, cfile!), 'utf8').split('\n')[Number(cline) - 1]!;
            expect(ctext).toContain(`= ${q.complete}`);
        }
    });
});

describe('colourProgress', () => {
    test('the three colours the server sets, as the client stores them', () => {
        expect(colourProgress(0xf80000)).toBe('none');
        expect(colourProgress(0xf8f800)).toBe('started');
        expect(colourProgress(0x00f800)).toBe('done');
    });

    test('the interface default red, and a colour that is none of the three', () => {
        expect(colourProgress(0xff0000)).toBe('none');
        expect(colourProgress(0xffffff)).toBeNull();
        expect(colourProgress(0x000000)).toBeNull();
    });
});

describe('questProgress', () => {
    test('reads the tab entry of the quest by its name', () => {
        const s = world().quests({ imp: 'started', runemysteries: 'done' }).build();
        expect(questProgress(s, 'imp')).toBe('started');
        expect(questProgress(s, 'runemysteries')).toBe('done');
        expect(questProgress(s, 'priest')).toBe('none');
    });

    test('is null for an unknown quest, a state without a tab, and a tab without the entry', () => {
        expect(questProgress(world().quests({}).build(), 'nosuchquest')).toBeNull();
        expect(questProgress(world().build(), 'imp')).toBeNull();
        expect(questProgress({ questTab: [] }, 'imp')).toBeNull();
    });
});
