// A scripted conversation for tests: each click on the dialog moves it to the next page.
import type { BotAction, BotWorldState } from '../../sdk/types';
import type { Effect } from '../core/drivers/timeline';
import { world } from './world';

/** A page: option labels (a choice), `[]` (a "click here to continue" page) or `null` (the dialog closed). */
export type Page = string[] | null;

/**
 * Pages in order. The first shows after `opens` (default: a click of an NPC option); each
 * `clickDialogOption` moves to the next; the last repeats.
 */
export function dialogScript(
    pages: Page[],
    opens: (a: BotAction) => boolean = a => a.type === 'interactNpc',
    /** Pages already shown: 1 for a conversation the world starts with open on its first page. */
    shown = 0,
) {
    let next = shown;
    const show =
        (i: number): Effect =>
        s => {
            const page = pages[Math.min(i, pages.length - 1)] ?? null;
            return world(s)
                .dialog(page === null ? false : { text: `page ${i}`, options: page })
                .build();
        };
    return {
        /** Pages shown so far: 0 before the dialog opened. */
        get shown() {
            return next;
        },
        react(action: BotAction, _state: BotWorldState): Effect | undefined {
            if (action.type === 'clickDialogOption' && next > 0) return show(next++);
            if (next === 0 && opens(action)) return show(next++);
            return undefined;
        },
    };
}
