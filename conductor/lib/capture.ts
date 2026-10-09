// Trims a live world state down to a committable test fixture.
import type { BotWorldState } from '../../sdk/types';

/** Entities farther than this are dropped: a fixture is a scene, not the whole loaded region. */
export const CAPTURE_RADIUS = 15;
/** Chat and dialog history kept; the SDK keeps 500 messages, which no fixture needs. */
export const CAPTURE_HISTORY = 10;

export function trimState(state: BotWorldState, radius = CAPTURE_RADIUS, history = CAPTURE_HISTORY): BotWorldState {
    const near = <T extends { distance: number }>(xs: T[]) => xs.filter(x => x.distance <= radius);
    return {
        ...state,
        nearbyNpcs: near(state.nearbyNpcs),
        nearbyPlayers: near(state.nearbyPlayers),
        nearbyLocs: near(state.nearbyLocs),
        groundItems: near(state.groundItems),
        gameMessages: state.gameMessages.slice(-history),
        recentDialogs: state.recentDialogs.slice(-history),
        combatEvents: state.combatEvents.slice(-history),
    };
}
