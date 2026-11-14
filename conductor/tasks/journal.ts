import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { CLEANUP_CLOSE_WAIT_TICKS, closeModalUntil } from '../actions/modal';
import { interfaceOpen, resolveComponent } from '../actions/press';
import { send, wait } from '../core/op';
import { JOURNAL_INTERFACE, journalOf } from '../lib/journal-memory';
import { journalTitle, QUESTS, questIdByJournalTitle } from '../lib/quests';
import { defineTask } from '../lib/task';

/** Ticks the journal gets to open after the first click; then one more click and as long again. */
export const JOURNAL_OPEN_TICKS = 5;
/** Ticks each close gets to show (closing takes two). */
export const JOURNAL_CLOSE_TICKS = 5;
/** The longest reason text taken from the journal. */
const LINE_CHARS = 120;

const Params = z.object({
    quest: z
        .string()
        .refine(id => Object.hasOwn(QUESTS, id), {
            error: v => `unknown quest id ${JSON.stringify(v.input)}: the ids are the keys of QUESTS in lib/quests.ts`,
        })
        .describe('The quest whose journal to read: a QUESTS id from lib/quests.ts (`cook`, `dragon`).'),
});

/** Nothing of a main modal shows: what the click opened is gone. */
const noModal = (s: BotWorldState) => !s.interface.isOpen && !s.modalOpen;
const journalShown = (s: BotWorldState) => interfaceOpen(s, JOURNAL_INTERFACE);

export default defineTask({
    name: 'journal',
    description:
        "Reads a quest's journal: clicks its quest-tab entry, sees the journal open, closes it, and ends done with " +
        "the last line; the plan's journal memory keeps the text. Its preflight refuses to start while a dialog or " +
        'modal is open (the click would destroy it). Needs the lite client: the browser client publishes no journal ' +
        'text.',
    params: Params,
    observes: true,
    // The refusals are a preflight's: a step would see the state only after the dialog guard had answered an open
    // dialog and the engine had closed a modal left open before the run.
    preflight(ctx) {
        if (!resolveComponent(`questlist:${ctx.params.quest}`))
            return `questlist:${ctx.params.quest} is not a component in interface.pack`;
        const s = ctx.state();
        if (s.dialog.isOpen) return 'journal not read: dialog open';
        if (s.modalOpen && !interfaceOpen(s, JOURNAL_INTERFACE)) return 'journal not read: modal open';
        return null;
    },
    steps: [
        {
            name: 'journal',
            when: () => true,
            *run(ctx) {
                const { quest } = ctx.params;
                const title = JSON.stringify(journalTitle(QUESTS[quest]!));
                const entry = `questlist:${quest}`;
                const componentId = resolveComponent(entry)!.componentId;
                let clicked = false;
                let closed = false;
                try {
                    let seen = ctx.state();
                    // A second click only when the first opened nothing: an open journal without text is judged as is.
                    for (let attempt = 0; attempt < 2 && !journalShown(seen); attempt++) {
                        clicked = true;
                        const sent = yield* send({ type: 'clickComponent', componentId, reason: `click ${entry}` });
                        if (!sent.success) return { fail: `click on ${entry} failed: ${sent.message}` };
                        const w = yield* wait(`${title} journal open`, s => journalOf(s) !== null, JOURNAL_OPEN_TICKS);
                        seen = w.state;
                    }
                    const journal = journalOf(seen);
                    let outcome: { done: string } | { fail: string };
                    if (journal && questIdByJournalTitle(journal.title) !== quest)
                        outcome = { fail: `the journal opened is ${JSON.stringify(journal.title)}, not ${title}` };
                    else if (journalShown(seen) && !journal?.lines.length)
                        outcome = { fail: "journal has no text: this client's interface dump carries none" };
                    else if (!journal)
                        outcome = { fail: `the journal did not open within ${2 * JOURNAL_OPEN_TICKS} ticks` };
                    else outcome = { done: journal.lines.at(-1)!.slice(0, LINE_CHARS) };

                    const c = yield* closeModalUntil(ctx, 'journal', noModal, JOURNAL_CLOSE_TICKS);
                    closed = true;
                    if (!c.ok && 'done' in outcome) return { fail: `journal read but not closed: ${c.message}` };
                    return outcome;
                } finally {
                    // Cut off (a guard, a stop) after the click: close what it opened, within the cleanup cap.
                    if (clicked && !closed) yield* closeModalUntil(ctx, 'journal', noModal, CLEANUP_CLOSE_WAIT_TICKS);
                }
            },
        },
    ],
});
