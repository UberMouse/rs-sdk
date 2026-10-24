// Not ported: sdk/actions.ts has no click-a-component method; closest upstream is smithAtAnvil @ df3d8888a
// (an op that works inside an interface the game opened, clicking one of its buttons by component id).
// `pressComponent` clicks one component of the open main interface, named as in interface.pack
// (`death_dice:com_28`), and waits for the interface to say it took effect: some component's text matching
// `until`. It can first wait for a `ready` text, for a button the script reveals only after its own delay (the
// dice game's roll button is hidden until Harold has rolled; a click on a hidden button is dropped, and the
// state does not show which components are hidden). Texts come from the interface's component dump
// (`debugInfo`, one line per component), the same view combolock reads its wheels from.
// It sends raw: no threat, HP or dialog handling, and it leaves the interface open (the caller closes it, as
// closing may be what ends the game's own script). `progress.clicked` is set before the click is sent, so a
// step cut off after the send resumes by reading the effect without clicking again.
import type { BotWorldState } from '../../sdk/types';
import { type Op, send, wait } from '../core/op';
import { configId } from '../lib/packs';
import type { ActionContext } from './context';

/** Ticks the `ready` text gets to show (the dice game's rolls take 6 ticks before the button is revealed). */
export const PRESS_READY_TICKS = 15;
/** Ticks a click gets to show its `until` text (the player's roll: two delays of 2 ticks, with room for lag). */
export const PRESS_EFFECT_TICKS = 10;
/** Clicks that show no effect before the op gives up: a click can land a tick before the button is live. */
export const PRESS_CLICK_LIMIT = 2;
/** The worst case of one call, in ticks, for a step that reserves it. */
export const PRESS_MAX_TICKS = PRESS_READY_TICKS + PRESS_CLICK_LIMIT * PRESS_EFFECT_TICKS;

/** A component name, `<interface>:com_<n>`. */
export const COMPONENT_NAME = /^[a-z0-9_]+:com_\d+$/i;

export interface PressSpec {
    /** The component to click, as in interface.pack: `death_dice:com_28`. */
    component: string;
    /** A text the interface must show before the click. */
    ready?: RegExp;
    /** A text the interface shows once the click took effect. */
    until: RegExp;
}

/** How far a press has got, kept by the caller so a cut-off call resumes without clicking again. */
export interface PressProgress {
    /** The click was sent (recorded before the send). */
    clicked: boolean;
}

export type PressResult =
    | { ok: true; text: string }
    | {
          ok: false;
          reason: 'no-component' | 'not-open' | 'not-ready' | 'send-failed' | 'no-effect' | 'closed';
          message: string;
      };

/** One line of the component dump: `#<id> type=<n> btn=<n> text="..."`. */
const DUMP_LINE = /^\s*#(\d+) type=-?\d+ btn=-?\d+ text=("(?:[^"\\]|\\.)*")/;

/** The texts of the open interface's components, by component id. Empty when no dump is published. */
export function interfaceTexts(s: BotWorldState): Map<number, string> {
    const texts = new Map<number, string>();
    for (const line of s.interface.debugInfo ?? []) {
        const m = DUMP_LINE.exec(line);
        if (m) texts.set(Number(m[1]), JSON.parse(m[2]!) as string);
    }
    return texts;
}

/** The first text of the open interface matching `pattern`, or undefined. */
export const interfaceSays = (s: BotWorldState, pattern: RegExp): string | undefined =>
    [...interfaceTexts(s).values()].find(t => pattern.test(t));

/** The interface id and component id a component name stands for, or undefined for a name interface.pack lacks. */
export function resolveComponent(component: string): { interfaceId: number; componentId: number } | undefined {
    const interfaceId = configId('interface', component.split(':')[0]!);
    const componentId = configId('interface', component);
    return interfaceId === undefined || componentId === undefined ? undefined : { interfaceId, componentId };
}

/** True while the interface `interfaceId` is the open main modal. */
export const interfaceOpen = (s: BotWorldState, interfaceId: number): boolean =>
    s.interface.isOpen && s.interface.interfaceId === interfaceId;

/**
 * Clicks `spec.component` of the open interface (after its `ready` text shows) and waits for `spec.until`.
 * `ok` carries the text that matched. A click that shows no effect is repeated once.
 */
export function* pressComponent(ctx: ActionContext, spec: PressSpec, progress: PressProgress): Op<PressResult> {
    const target = resolveComponent(spec.component);
    if (!target)
        return { ok: false, reason: 'no-component', message: `${spec.component} is not a component in interface.pack` };
    const open = (s: BotWorldState) => interfaceOpen(s, target.interfaceId);
    if (!open(ctx.state()))
        return { ok: false, reason: 'not-open', message: `${spec.component.split(':')[0]} is not the open interface` };

    if (!progress.clicked && spec.ready) {
        const ready = spec.ready;
        const w = yield* wait(`${spec.component} ready`, s => !open(s) || !!interfaceSays(s, ready), PRESS_READY_TICKS);
        if (!open(w.state))
            return { ok: false, reason: 'closed', message: 'the interface closed before the button was ready' };
        if (w.kind === 'timeout')
            return {
                ok: false,
                reason: 'not-ready',
                message: `no text matching ${ready} within ${PRESS_READY_TICKS} ticks`,
            };
    }

    for (let attempt = 0; attempt < PRESS_CLICK_LIMIT; attempt++) {
        if (!progress.clicked) {
            progress.clicked = true;
            const sent = yield* send({
                type: 'clickComponent',
                componentId: target.componentId,
                reason: `click ${spec.component}`,
            });
            if (!sent.success) {
                progress.clicked = false;
                return { ok: false, reason: 'send-failed', message: sent.message };
            }
        }
        const w = yield* wait(
            `${spec.component} takes effect`,
            s => !open(s) || !!interfaceSays(s, spec.until),
            PRESS_EFFECT_TICKS,
        );
        const text = open(w.state) ? interfaceSays(w.state, spec.until) : undefined;
        if (text !== undefined) return { ok: true, text };
        if (!open(w.state))
            return { ok: false, reason: 'closed', message: 'the interface closed before the click took effect' };
        progress.clicked = false;
    }
    return {
        ok: false,
        reason: 'no-effect',
        message: `${PRESS_CLICK_LIMIT} clicks on ${spec.component} showed no text matching ${spec.until}`,
    };
}
