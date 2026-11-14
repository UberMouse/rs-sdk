// Quest journals as last seen open, read from the states a driver hands out: the plan keeps one across its phases
// (lib/plan.ts, PlanView.journalSays and journalAge), fed every state the plan or a phase reads, as the bank memory is.
import type { BotWorldState } from '../../sdk/types';
import { interfaceOpen, interfaceTexts } from '../actions/press';
import { questIdByJournalTitle } from './quests';

/** The quest journal: the interface a click on a quest-tab entry opens. */
export const JOURNAL_INTERFACE = 8134;
const TITLE_COMPONENT = 8144;
/** The text lines, in order: 8146 is not one of them. */
const LINE_COMPONENTS = [8145, ...Array.from({ length: 8195 - 8147 + 1 }, (_, i) => 8147 + i)];

export interface Journal {
    /** The journal's title (lib/quests.ts journalTitle), not always the tab entry's name. */
    title: string;
    /** The non-empty text lines, in component order. */
    lines: string[];
}

/**
 * Why a click on a quest-tab entry must not go out now, or null: the click destroys an open chat dialog or main
 * modal. An open journal is no blocker: the journal task reads it as it shows. The task and the quest layer both ask this.
 */
export const journalReadBlocker = (s: BotWorldState): 'dialog open' | 'modal open' | null =>
    s.dialog.isOpen ? 'dialog open' : s.modalOpen && !interfaceOpen(s, JOURNAL_INTERFACE) ? 'modal open' : null;

/** The journal `s` shows open, or null: another interface, none, or a dump without the title's text. */
export function journalOf(s: BotWorldState): Journal | null {
    if (!interfaceOpen(s, JOURNAL_INTERFACE)) return null;
    const texts = interfaceTexts(s);
    const title = texts.get(TITLE_COMPONENT);
    if (!title) return null;
    const lines: string[] = [];
    for (const id of LINE_COMPONENTS) {
        const line = texts.get(id);
        if (line) lines.push(line);
    }
    return { title, lines };
}

/** A quest's journal seen: its text (the lines joined by single spaces), and whether it differs from the text kept. */
export interface JournalSight {
    quest: string;
    text: string;
    changed: boolean;
}

export interface JournalMemory {
    /** Notes `s` if it shows a known quest's journal open, and returns it. */
    observe(s: BotWorldState): BotWorldState;
    /** The quest's journal text as last seen; undefined before it has been seen. */
    text(quest: string): string | undefined;
    /** Acting phase runs ended since the quest's journal was last seen; undefined before it has been seen. */
    age(quest: string): number | undefined;
    /** An acting phase run ended: every journal seen is one run older. */
    aged(): void;
}

/** An empty journal memory; `onSight` hears of a journal seen for the first time or with a new text. */
export function journalMemory(onSight: (sight: JournalSight) => void = () => {}): JournalMemory {
    const kept = new Map<string, { text: string; age: number }>();
    let seen: BotWorldState | null = null;
    const observe = (s: BotWorldState): BotWorldState => {
        if (s === seen) return s;
        seen = s;
        const journal = journalOf(s);
        const quest = journal && questIdByJournalTitle(journal.title);
        if (!journal || !quest) return s;
        const text = journal.lines.join(' ');
        const before = kept.get(quest);
        kept.set(quest, { text, age: 0 });
        if (before?.text !== text) onSight({ quest, text, changed: before !== undefined });
        return s;
    };
    return {
        observe,
        text: quest => kept.get(quest)?.text,
        age: quest => kept.get(quest)?.age,
        aged: () => {
            for (const k of kept.values()) k.age++;
        },
    };
}
