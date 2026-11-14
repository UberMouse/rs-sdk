import { describe, expect, test } from 'bun:test';
import { z } from 'zod/v4';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { resolveComponent } from '../../actions/press';
import type { Effect } from '../../core/drivers/timeline';
import { definePlan, phase, type PlanView } from '../../lib/plan';
import { journalTitle, QUESTS } from '../../lib/quests';
import { defineTask } from '../../lib/task';
import { TICK_MS } from '../../lib/util';
import journal from '../../tasks/journal';
import { withJournal } from '../journal';
import { simulate, simulatePlan } from '../simulate';
import { world } from '../world';

// "The Cook's Quest": the journal's title, not the tab's "Cook's Assistant".
const COOK = journalTitle(QUESTS.cook!);
const COOK_ENTRY = resolveComponent('questlist:cook')!.componentId;
const LINES = ['I can start this quest by speaking to the', 'Cook in the kitchen of Lumbridge Castle.'];

const still = world().player({ hp: 10 });

interface JournalWorld {
    /** The journal's title; default the cook quest's. */
    title?: string;
    lines?: string[];
    /** The component dump in place of the journal's (`[]`: a client that publishes no text). */
    debugInfo?: string[];
    /** Clicks on the entry before the journal opens; 0 never opens it. Default 1. */
    clicksToOpen?: number;
}

/**
 * The game as measured: a click on the cook entry opens the journal two ticks later, a close shuts it two ticks
 * later. One effect, kept from the first send on, shows the journal while it is open.
 */
function journalWorld(opts: JournalWorld = {}) {
    const { title = COOK, lines = LINES, debugInfo, clicksToOpen = 1 } = opts;
    let clicks = 0;
    let openAt: number | null = null;
    let closeAt: number | null = null;
    let started = false;
    const shown: Effect = s =>
        openAt !== null && s.tick >= openAt && (closeAt === null || s.tick < closeAt)
            ? withJournal(s, title, lines, debugInfo)
            : { ...s };
    return (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'clickComponent' && action.componentId === COOK_ENTRY) {
            if (++clicks === clicksToOpen) openAt = state.tick + 2;
        } else if (action.type === 'closeModal') {
            if (openAt !== null && closeAt === null) closeAt = state.tick + 2;
        } else return undefined;
        if (started) return undefined;
        started = true;
        return shown;
    };
}

const read = (opts: JournalWorld = {}, timeline = still.series(1)) =>
    simulate(journal, { params: { quest: 'cook' }, timeline, react: journalWorld(opts) });

describe('journal', () => {
    test('clicks the entry, sees the journal two ticks later, closes it and ends done with the last line', async () => {
        const r = await read();
        expect(r.result).toMatchObject({ status: 'done', reason: `journal: ${LINES[1]}` });
        expect(r.sends).toEqual(['click questlist:cook', 'close journal']);
        expect(r.commands.find(c => c.type === 'send')).toMatchObject({
            action: { type: 'clickComponent', componentId: 7333 },
        });
        // Two ticks to open, two to close: the interface guard leaves the journal to the task.
        expect(r.result.durationMs).toBe(4 * TICK_MS);
        expect(r.driver.state().interface.isOpen).toBe(false);
    });

    test('the last line is cut to 120 characters', async () => {
        const long = 'x'.repeat(200);
        const r = await read({ lines: ['first', long] });
        expect(r.result.reason).toBe(`journal: ${long.slice(0, 120)}`);
    });

    test('refuses with a chat dialog open, sending nothing', async () => {
        const r = await read({}, still.dialog({ text: 'Hello there.' }).series(1));
        expect(r.result).toMatchObject({ status: 'failed', reason: 'preflight: journal not read: dialog open' });
        expect(r.sends).toEqual([]);
    });

    test('refuses with a main modal open, sending nothing', async () => {
        const r = await read({}, still.bank([{ name: 'Coins', count: 5 }]).series(1));
        expect(r.result).toMatchObject({ status: 'failed', reason: 'preflight: journal not read: modal open' });
        expect(r.sends).toEqual([]);
    });

    test('clicks again after 5 ticks when the first click opened nothing', async () => {
        const r = await read({ clicksToOpen: 2 });
        expect(r.result).toMatchObject({ status: 'done', reason: `journal: ${LINES[1]}` });
        expect(r.sends).toEqual(['click questlist:cook', 'click questlist:cook', 'close journal']);
        expect(r.result.durationMs).toBe((5 + 2 + 2) * TICK_MS);
    });

    test('fails when the journal never opens, after two clicks and 10 ticks, with nothing to close', async () => {
        const r = await read({ clicksToOpen: 0 });
        expect(r.result).toMatchObject({
            status: 'failed',
            reason: 'journal: the journal did not open within 10 ticks',
        });
        expect(r.sends).toEqual(['click questlist:cook', 'click questlist:cook']);
        expect(r.result.durationMs).toBe(10 * TICK_MS);
    });

    test("fails on another quest's journal, and on one titled with the tab name, closing it", async () => {
        // The cook quest's tab reads "Cook's Assistant", but its journal is titled "The Cook's Quest".
        expect(COOK).not.toBe(QUESTS.cook!.name);
        for (const title of ['Dragon Slayer', QUESTS.cook!.name]) {
            const r = await read({ title });
            expect(r.result).toMatchObject({
                status: 'failed',
                reason: `journal: the journal opened is ${JSON.stringify(title)}, not "The Cook's Quest"`,
            });
            expect(r.sends).toEqual(['click questlist:cook', 'close journal']);
            expect(r.driver.state().interface.isOpen).toBe(false);
        }
    });

    test('fails on a journal with no text lines, and closes it', async () => {
        const noText = "journal: journal has no text: this client's interface dump carries none";
        for (const opts of [{ lines: [] }, { debugInfo: [] }]) {
            const r = await read(opts);
            expect(r.result, JSON.stringify(opts)).toMatchObject({ status: 'failed', reason: noText });
            // An open journal without text is not clicked again.
            expect(r.sends, JSON.stringify(opts)).toEqual(['click questlist:cook', 'close journal']);
            expect(r.driver.state().interface.isOpen).toBe(false);
        }
    });

    test('an unknown quest id is a params error naming lib/quests.ts', () => {
        const r = journal.params.safeParse({ quest: 'nope' });
        expect(r.success).toBe(false);
        expect(r.error?.issues[0]?.message).toContain('lib/quests.ts');
        expect(journal.params.safeParse({}).success).toBe(false);
        expect(journal.params.parse({ quest: 'cook' })).toEqual({ quest: 'cook' });
    });

    test('in a plan, a journal phase makes v.journalSays defined at the next selection without setting v.last', async () => {
        const looked: [boolean | undefined, PlanView['last']][] = [];
        const look = defineTask({
            name: 'look',
            description: 'journal test acting task',
            params: z.object({}),
            steps: [{ name: 'look', when: () => true, run: () => ({ done: 'looked' }) }],
        });
        const def = definePlan({
            name: 'journal-plan',
            phases: [
                phase(journal, { quest: 'cook' }, { name: 'journal', when: v => v.journalAge('cook') === undefined }),
                phase(look, {}, { when: v => (looked.push([v.journalSays('cook', /Cook/), v.last]), true) }),
            ],
            until: v => v.runs('look') >= 1,
        });
        const r = await simulatePlan(def, { timeline: still.series(1), react: journalWorld() });
        expect(r.result.status).toBe('done');
        expect(r.runs.map(x => [x.phase, x.result.status])).toEqual([
            ['journal', 'done'],
            ['look', 'done'],
        ]);
        expect(looked[0]).toEqual([true, null]);
    });
});
