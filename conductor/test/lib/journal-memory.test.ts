// Quest journals as last seen open (lib/journal-memory.ts): what a state's journal reads as, and what a memory keeps
// of the states it observes.
import { describe, expect, test } from 'bun:test';
import { type JournalSight, journalMemory, journalOf } from '../../lib/journal-memory';
import { QUESTS } from '../../lib/quests';
import { journalDump, withJournal } from '../journal';
import { world } from '../world';

const RUNE = QUESTS.runemysteries!.name;
const BASE = world().build();
const open = (lines: string[], title = RUNE) => withJournal(BASE, title, lines);

describe('journalOf', () => {
    test('the title and the non-empty lines, in component order', () => {
        // 8150 is the fourth line component: 8145, then 8147 on.
        const dump = journalDump(RUNE, [
            'I spoke to Duke Horacio.',
            '',
            'He gave me a talisman',
            'to take to Sedridor.',
        ]);
        expect(journalOf(withJournal(BASE, RUNE, [], dump))).toEqual({
            title: RUNE,
            lines: ['I spoke to Duke Horacio.', 'He gave me a talisman', 'to take to Sedridor.'],
        });
    });

    test('lines come in component order whatever order the dump lists them in', () => {
        const dump = journalDump(RUNE, ['first', 'second', 'third']);
        // 8146 is not a line component; the rest reversed.
        const shuffled = [dump[0]!, '    #8146 type=4 btn=0 text="not a line"', ...dump.slice(1).toReversed()];
        expect(journalOf(withJournal(BASE, RUNE, [], shuffled))?.lines).toEqual(['first', 'second', 'third']);
    });

    test('null for another interface, a closed one, and a dump without text', () => {
        const lines = journalDump(RUNE, ['a line']);
        const other = world().modal(8135).build();
        expect(journalOf({ ...other, interface: { ...other.interface, debugInfo: lines } })).toBeNull();
        expect(journalOf(BASE)).toBeNull();
        const closed = world(open(['a line']))
            .modal(false)
            .build();
        expect(journalOf({ ...closed, interface: { ...closed.interface, debugInfo: lines } })).toBeNull();
        expect(journalOf(withJournal(BASE, RUNE, [], []))).toBeNull();
        expect(journalOf(withJournal(BASE, RUNE, [], journalDump('', ['a line'])))).toBeNull();
    });
});

/** A memory and the sights it reported. */
const memory = () => {
    const sights: JournalSight[] = [];
    return { m: journalMemory(s => sights.push(s)), sights };
};

describe('journalMemory', () => {
    test('keeps the lines joined by single spaces under the quest id the title names', () => {
        const { m } = memory();
        expect(m.text('runemysteries')).toBeUndefined();
        m.observe(open(['I need to find', 'the head wizard.']));
        expect(m.text('runemysteries')).toBe('I need to find the head wizard.');
    });

    test('a title that names no quest is ignored', () => {
        const { m, sights } = memory();
        m.observe(open(['Kill the dragon.'], 'Not A Quest'));
        expect(sights).toEqual([]);
        expect(m.text('runemysteries')).toBeUndefined();
    });

    test('reports the first sight and each change, not the same text again', () => {
        const { m, sights } = memory();
        m.observe(open(['one']));
        m.observe(open(['one']));
        m.observe(BASE);
        m.observe(open(['two']));
        expect(sights).toEqual([
            { quest: 'runemysteries', text: 'one', changed: false },
            { quest: 'runemysteries', text: 'two', changed: true },
        ]);
    });

    test('the age counts the runs aged since the last sight', () => {
        const { m } = memory();
        m.aged();
        expect(m.age('runemysteries')).toBeUndefined();
        m.observe(open(['one']));
        expect(m.age('runemysteries')).toBe(0);
        m.aged();
        m.aged();
        expect(m.age('runemysteries')).toBe(2);
        m.observe(open(['one']));
        expect(m.age('runemysteries')).toBe(0);
    });
});
