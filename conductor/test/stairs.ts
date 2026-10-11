// A scripted castle for the connector tests: Lumbridge's south-west staircase over three floors, with what
// the server does to the bot when it uses it (the bot lands on the next floor, whose locs it then sees).
import type { BotAction, BotWorldState, NearbyLoc } from '../../sdk/types';
import type { Effect } from '../core/drivers/timeline';
import { type World, world } from './world';

/** The staircase tile, and where every floor's landing is. */
export const STAIRS = { x: 3204, z: 3207 };
export const LANDING = { x: 3205, z: 3209 };

type Reaction = (action: BotAction, state: BotWorldState) => Effect | undefined;

/** The locs one floor shows: the staircase of that floor with its options (the middle floor asks). */
export function floorLocs(level: number, base: World = world()): NearbyLoc[] {
    const at = { x: LANDING.x, z: LANDING.z, level };
    const w = base.player({ at });
    if (level === 0) return w.loc('Staircase', STAIRS.x, STAIRS.z, { options: ['Climb-up'] }).build().nearbyLocs;
    if (level === 1)
        return w.loc('Staircase', STAIRS.x, STAIRS.z, { options: ['Climb', 'Climb-up', 'Climb-down'] }).build()
            .nearbyLocs;
    return w.loc('Staircase', 3205, 3208, { options: ['Climb-down'] }).build().nearbyLocs;
}

const land = (s: BotWorldState, level: number): BotWorldState => ({
    ...world(s)
        .player({ at: { ...LANDING, level } })
        .dialog(false)
        .build(),
    nearbyLocs: floorLocs(level),
});

/**
 * Lumbridge castle as the server runs it: Climb-up on the ground floor goes up, the first floor's
 * Climb-up and Climb-down (ops 2 and 3) go each way, its plain Climb (op 1) asks "Climb up or down?", the top
 * floor's Climb-down goes down. `react` is what else the world does (walking).
 */
export function castle(
    opts: { react?: Reaction; /** The server ignores the stairs (a refused climb). */ stuck?: boolean } = {},
): Reaction {
    return (action, state) => {
        const level = state.player?.level ?? 0;
        if (action.type === 'interactLoc' && !opts.stuck) {
            if (level === 0 && action.optionIndex === 1) return s => land(s, 1);
            if (level === 1 && action.optionIndex === 2) return s => land(s, 2);
            if (level === 1 && action.optionIndex === 3) return s => land(s, 0);
            if (level === 2 && action.optionIndex === 1) return s => land(s, 1);
            if (level === 1 && action.optionIndex === 1)
                return s =>
                    world(s)
                        .dialog({ text: 'Climb up or down the stairs?', options: ['Climb Up.', 'Climb Down.'] })
                        .build();
        }
        if (action.type === 'clickDialogOption' && state.dialog.isOpen && level === 1)
            return s => land(s, action.optionIndex === 0 ? 2 : 0);
        return opts.react?.(action, state);
    };
}
