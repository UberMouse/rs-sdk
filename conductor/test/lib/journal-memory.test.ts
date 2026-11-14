// Quest journals as last seen open (lib/journal-memory.ts): what a state's journal reads as, and what a memory keeps
// of the states it observes.
import { describe, expect, test } from 'bun:test';
import { type JournalSight, journalMemory, journalOf } from '../../lib/journal-memory';
import { journalTitle, QUESTS } from '../../lib/quests';
import { journalDump, withJournal, withQuestJournal } from '../journal';
import { world } from '../world';

// Its journal is titled "Rune Mysteries", not the tab's "Rune Mysteries Quest".
const RUNE = journalTitle(QUESTS.runemysteries!);
const BASE = world().build();
const open = (lines: string[], title = RUNE) => withJournal(BASE, title, lines);

describe('journalOf', () => {
    test('the title and the non-empty lines, in component order', () => {
        // The second line component (8147) is empty.
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

    test('a line whose text does not parse is skipped, the rest read', () => {
        const dump = journalDump(RUNE, ['first', 'second', 'third']);
        dump[2] = '    #8147 type=4 btn=0 text="bad \\q escape"';
        expect(journalOf(withJournal(BASE, RUNE, [], dump))?.lines).toEqual(['first', 'third']);
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

    test('a journal is matched by its own title: cook\'s is "The Cook\'s Quest", and its tab name names no journal', () => {
        const { m, sights } = memory();
        m.observe(withJournal(BASE, "Cook's Assistant", ['by its tab name']));
        expect(m.text('cook')).toBeUndefined();
        m.observe(withQuestJournal(BASE, 'cook', ['I can start this quest by speaking to the Cook.']));
        expect(sights).toEqual([
            { quest: 'cook', text: 'I can start this quest by speaking to the Cook.', changed: false },
        ]);
        expect(journalOf(withQuestJournal(BASE, 'cook', ['a line']))?.title).toBe("The Cook's Quest");
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
