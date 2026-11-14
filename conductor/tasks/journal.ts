import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { CLEANUP_CLOSE_WAIT_TICKS, closeModalUntil } from '../actions/modal';
import { interfaceOpen, resolveComponent } from '../actions/press';
import { send, ticks, wait } from '../core/op';
import { JOURNAL_INTERFACE, journalOf, journalReadBlocker } from '../lib/journal-memory';
import { journalTitle, QUESTS, questIdByJournalTitle } from '../lib/quests';
import { patternParam } from '../lib/spot';
import { defineTask } from '../lib/task';
import { stuckWindowMs } from '../lib/watchdog';

/** Ticks the journal gets to open after the first click; then one more click and as long again. */
export const JOURNAL_OPEN_TICKS = 5;
/** Ticks each close gets to show (closing takes two). */
export const JOURNAL_CLOSE_TICKS = 5;
/** The longest reason text taken from the journal. */
const LINE_CHARS = 120;
/** How long a read with `expect` keeps reading for it, from the first read, unless `withinTicks` says. */
export const JOURNAL_WITHIN_TICKS = 20;
/** Ticks between a read with `expect` closing the journal and reading it again. */
export const JOURNAL_REREAD_TICKS = 4;
/** The most `withinTicks` allows. */
export const JOURNAL_MAX_WITHIN_TICKS = 100;
/**
 * The longest run: the first read's two clicks, `withinTicks` of re-reads, then a last read's two clicks and its close.
 * A read moves none of what the watchdog watches, so the whole run is one silent stretch.
 */
export const JOURNAL_MAX_RUN_TICKS = 4 * JOURNAL_OPEN_TICKS + JOURNAL_MAX_WITHIN_TICKS + JOURNAL_CLOSE_TICKS + 1;
// The run is one silent stretch, so the step timeout equals the stuck window.
const STEP_TIMEOUT_MS = stuckWindowMs(JOURNAL_MAX_RUN_TICKS);

const Params = z.object({
    quest: z
        .string()
        .refine(id => Object.hasOwn(QUESTS, id), {
            error: v => `unknown quest id ${JSON.stringify(v.input)}: the ids are the keys of QUESTS in lib/quests.ts`,
        })
        .describe('The quest whose journal to read: a QUESTS id from lib/quests.ts (`cook`, `dragon`).'),
    expect: patternParam(
        `Text the journal should show, matched against its lines joined by single spaces: read again every ${JOURNAL_REREAD_TICKS} ticks until it shows or \`withinTicks\` pass.`,
    ).optional(),
    withinTicks: z
        .number()
        .int()
        .min(1)
        .max(JOURNAL_MAX_WITHIN_TICKS)
        .optional()
        .describe(`Ticks from the first read to keep reading for \`expect\`; default ${JOURNAL_WITHIN_TICKS}.`),
});

/** Nothing of a main modal shows: what the click opened is gone. */
const noModal = (s: BotWorldState) => !s.interface.isOpen && !s.modalOpen;
const journalShown = (s: BotWorldState) => interfaceOpen(s, JOURNAL_INTERFACE);
const clickBlocker = journalReadBlocker;

export default defineTask({
    name: 'journal',
    description:
        "Reads a quest's journal: clicks its quest-tab entry, sees the journal open, closes it, and ends done with " +
        "the last line; the plan's journal memory keeps the text. With `expect`, a journal that does not show it is " +
        'read again for up to `withinTicks` from the first read; the task ends done either ' +
        'way, its reason saying when the expected text never showed. It refuses to click while a dialog or modal is ' +
        'open (the click would destroy it): in preflight, and before every re-read. Needs the lite client: the ' +
        'browser client publishes no journal text.',
    params: Params,
    observes: true,
    silent: [JOURNAL_MAX_RUN_TICKS],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    // The refusals are a preflight's: a step would see the state only after the dialog guard had answered an open
    // dialog and the engine had closed a modal left open before the run.
    preflight(ctx) {
        if (!resolveComponent(`questlist:${ctx.params.quest}`))
            return `questlist:${ctx.params.quest} is not a component in interface.pack`;
        const s = ctx.state();
        const blocked = clickBlocker(s);
        return blocked && `journal not read: ${blocked}`;
    },
    steps: [
        {
            name: 'journal',
            when: () => true,
            *run(ctx) {
                // The non-null assertions hold: the params schema and preflight checked the quest and its entry.
                const { quest, expect, withinTicks = JOURNAL_WITHIN_TICKS } = ctx.params;
                // The text v.journalSays tests: the lines joined by single spaces (lib/journal-memory.ts).
                const expected = expect === undefined ? null : new RegExp(expect, 'i');
                const title = JSON.stringify(journalTitle(QUESTS[quest]!));
                const entry = `questlist:${quest}`;
                const componentId = resolveComponent(entry)!.componentId;
                // A click went out and its journal has not been closed since.
                let open = false;
                let first: number | null = null;
                try {
                    for (;;) {
                        let seen = ctx.state();
                        // A second click only when the first opened nothing: an open journal without text is judged
                        // as is.
                        for (let attempt = 0; attempt < 2 && !journalShown(seen); attempt++) {
                            // Checked at every send: the state at a re-click (or a re-read) is a wait's, after the
                            // world moved on.
                            const blocked = clickBlocker(seen);
                            if (blocked) return { fail: `journal not read: ${blocked}` };
                            open = true;
                            const sent = yield* send({ type: 'clickComponent', componentId, reason: `click ${entry}` });
                            if (!sent.success) return { fail: `click on ${entry} failed: ${sent.message}` };
                            const w = yield* wait(
                                `${title} journal open`,
                                s => journalOf(s) !== null,
                                JOURNAL_OPEN_TICKS,
                            );
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

                        // A journal that never opened leaves nothing of ours to close: a modal up now is another's.
                        const c = journalShown(ctx.state())
                            ? yield* closeModalUntil(ctx, 'journal', noModal, JOURNAL_CLOSE_TICKS)
                            : null;
                        open = false;
                        if (c && !c.ok && 'done' in outcome)
                            return { fail: `journal read but not closed: ${c.message}` };
                        if ('fail' in outcome || !expected || expected.test(journal!.lines.join(' '))) return outcome;
                        first ??= seen.tick;
                        // Read again only while the next click still falls within withinTicks of the first read.
                        if (ctx.state().tick + JOURNAL_REREAD_TICKS - first > withinTicks)
                            return { done: `${outcome.done} (no "${expect}" within ${withinTicks} ticks)` };
                        yield* ticks(JOURNAL_REREAD_TICKS);
                    }
                } finally {
                    // Cut off (a guard, a stop) after a click: close what it opened, within the cleanup cap.
                    if (open && journalShown(ctx.state()))
                        yield* closeModalUntil(ctx, 'journal', noModal, CLEANUP_CLOSE_WAIT_TICKS);
                }
            },
        },
    ],
});
