// A scripted quest journal for tests: interface 8134 open with the component dump the lite client publishes
// (`debugInfo`, one line per component), the title in 8144 and the text lines from 8145, 8146 skipped.
import type { BotWorldState } from '../../sdk/types';
import { JOURNAL_INTERFACE } from '../lib/journal-memory';
import { world } from './world';

const dumpLine = (id: number, text: string) => `    #${id} type=4 btn=0 text=${JSON.stringify(text)}`;

/** The dump of a journal titled `title` showing `lines`, every unused line component empty, as the client sends it. */
export function journalDump(title: string, lines: string[]): string[] {
    const ids = [8145, ...Array.from({ length: 8195 - 8147 + 1 }, (_, i) => 8147 + i)];
    return [dumpLine(8144, title), ...ids.map((id, i) => dumpLine(id, lines[i] ?? ''))];
}

/** `s` with the journal open, its dump `debugInfo` (journalDump's by default). */
export function withJournal(s: BotWorldState, title: string, lines: string[], debugInfo?: string[]): BotWorldState {
    const open = world(s).modal(JOURNAL_INTERFACE).build();
    return { ...open, interface: { ...open.interface, debugInfo: debugInfo ?? journalDump(title, lines) } };
}
