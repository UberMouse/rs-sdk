// A scripted game of Harold's dice for tests: the conversation up to the bet, the amount prompt, the dice table
// the client publishes (its `debugInfo` component dump carries the status text), the roll and the pages after.
import type { BotAction, BotWorldState } from '../../sdk/types';
import { DEATH_DICE_INTERFACE } from '../actions/dismiss';
import type { Effect } from '../core/drivers/timeline';
import { configId } from '../lib/packs';
import { type Page, dialogScript } from './dialog-script';
import { world } from './world';

export const ROLL_BUTTON = configId('interface', 'death_dice:com_28')!;
const STATUS = configId('interface', 'death_dice:com_33')!;

/** The conversation: Harold's greeting, the three-way choice, the player's line and Harold's reply, then the dialog closes on the prompt. */
export const TALK_PAGES: Page[] = [
    [],
    [],
    ['Where were you when you last had the combination?', 'Would you like to gamble?', 'Can I buy you a drink?'],
    [],
    [],
    null,
];

/** `s` with the dice table open showing `status` (the roll caption). */
export function withDice(s: BotWorldState, status: string): BotWorldState {
    const open = world(s).modal(DEATH_DICE_INTERFACE).build();
    return {
        ...open,
        interface: {
            ...open.interface,
            debugInfo: [
                `#${DEATH_DICE_INTERFACE} type=0 btn=0 text=""`,
                `  #${STATUS} type=4 btn=0 text=${JSON.stringify(status)}`,
            ],
        } as typeof open.interface,
    };
}

export interface DiceOptions {
    /** The roll beats Harold's. */
    win?: boolean;
    /** Ticks after the dice table opens until the roll button is live (the caption becomes "Your roll..."). */
    readyAfter?: number;
    /** Ticks after the click until the result shows. */
    resultAfter?: number;
    /** Continue pages between the amount and the table (Harold's "OK. I'll roll first!"). */
    betPages?: number;
    /** Clicks on the roll button the game ignores. */
    ignoreClicks?: number;
    /** The result never shows. */
    deadRoll?: boolean;
    /** The table never opens after the amount. */
    noTable?: boolean;
}

/** The game the bot plays: `react` moves it along as the bot's sends land; the rest records what happened. */
export function diceGame(opts: DiceOptions = {}) {
    const talk = dialogScript(TALK_PAGES);
    const afterBet: Page[] = [...Array.from({ length: opts.betPages ?? 0 }, (): Page => []), null];
    const bet = dialogScript(afterBet, a => a.type === 'submitCountDialog');
    const after = dialogScript([[], null], a => a.type === 'closeModal');
    let phase: 'talk' | 'bet' | 'table' | 'closed' = 'talk';
    let ignore = opts.ignoreClicks ?? 0;
    const log = { amounts: [] as number[], clicks: [] as number[], closes: 0 };

    let clickedAt: number | null = null;
    const table =
        (openedAt: number): Effect =>
        s => {
            if (phase !== 'table') return s;
            if (clickedAt !== null && !opts.deadRoll && s.tick - clickedAt >= (opts.resultAfter ?? 4))
                return withDice(s, opts.win ? 'You win!' : 'You lose!');
            return withDice(s, s.tick - openedAt >= (opts.readyAfter ?? 6) ? 'Your roll...' : 'Harold rolls...');
        };

    const openTable = (tick: number): Effect | undefined => {
        if (opts.noTable) return undefined;
        phase = 'table';
        return table(tick);
    };

    const react = (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'submitCountDialog') {
            log.amounts.push(action.value);
            phase = 'bet';
            if (afterBet.length > 1) return bet.react(action, state);
            return openTable(state.tick);
        }
        if (action.type === 'clickComponent' && action.componentId === ROLL_BUTTON) {
            log.clicks.push(state.tick);
            if (phase !== 'table') return undefined;
            if (ignore > 0) {
                ignore--;
                return undefined;
            }
            clickedAt = state.tick;
            return undefined;
        }
        if (action.type === 'closeModal' && phase === 'table') {
            log.closes++;
            phase = 'closed';
            const e = after.react(action, state);
            return s => (e ? e(world(s).modal(false).build()) : world(s).modal(false).build());
        }
        if (action.type === 'clickDialogOption') {
            if (phase === 'bet') {
                const e = bet.react(action, state);
                if (bet.shown === afterBet.length) {
                    const t = openTable(state.tick);
                    return s => (t ? t(e ? e(s) : s) : e ? e(s) : s);
                }
                return e;
            }
            return phase === 'closed' ? after.react(action, state) : talk.react(action, state);
        }
        if (phase === 'talk') return talk.react(action, state);
        return undefined;
    };
    return { react, log };
}
