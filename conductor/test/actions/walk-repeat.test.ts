// A walk that repeats the same hops without arriving ends stuck, naming the hops (an essence-mine hop loop
// otherwise runs until a timeout).
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { HOP_REPEAT_LIMIT, type WalkResult, walkTo } from '../../actions/walk';
import { type Effect, TimelineDriver } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { onlyConnectors, straightPaths } from '../paths';
import { walking } from '../react';
import { castle, floorLocs, LANDING } from '../stairs';
import { world } from '../world';

type React = (a: BotAction, s: BotWorldState) => Effect | undefined;
const ground = (): BotWorldState => ({
    ...world()
        .player({ at: { x: 3222, z: 3222, level: 0 } })
        .build(),
    nearbyLocs: floorLocs(0),
});

/** The castle, except that the first floor throws the bot back to the ground floor when it walks there. */
const thrownBack = (): React => {
    // The ground floor north of z 3210 and west of x 3210 cannot be walked to, so a walk thrown back down cannot arrive on it either.
    const normal = walking(castle(), (_from, to, st) => st.player?.level === 0 && to.x < 3210 && to.z > 3210);
    return (action, state) => {
        if (action.type === 'walkTo' && state.player?.level === 1)
            return s => ({
                ...world(s)
                    .player({ at: { x: LANDING.x, z: LANDING.z, level: 0 } })
                    .build(),
                nearbyLocs: floorLocs(0),
            });
        return normal(action, state);
    };
};

async function walk(react: React, walks = 1) {
    const driver = new TimelineDriver([ground()], { react });
    const ctx = { state: () => driver.state(), pathfinder: straightPaths(), walkWorld: onlyConnectors() };
    const results: WalkResult[] = [];
    for (let i = 0; i < walks; i++) {
        const run = await interpret(walkTo(ctx, 3207, 3212, 1, { level: 1 }), { driver });
        if (run.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(run)}`);
        results.push(run.value as WalkResult);
    }
    const climbs = driver.commands.filter(c => c.type === 'send' && c.action.type === 'interactLoc').length;
    return { results, climbs };
}

const repeating = (r: WalkResult) => !r.ok && r.reason === 'stuck' && r.message.includes('Repeating the same hops');

describe('a walk that repeats the same hops', () => {
    test('ends stuck on the HOP_REPEAT_LIMIT-th identical climb of a run (the first starts elsewhere), naming the hop and the count', async () => {
        const { results, climbs } = await walk(thrownBack(), HOP_REPEAT_LIMIT + 1);
        // Each walk climbs once and is thrown back, failing on the ground floor; the history is the run's.
        expect(results.slice(0, HOP_REPEAT_LIMIT).some(repeating)).toBe(false);
        const guard = results[HOP_REPEAT_LIMIT]!;
        expect(repeating(guard)).toBe(true);
        expect(guard.message).toContain('Lumbridge castle stairs');
        expect(guard.message).toContain(String(HOP_REPEAT_LIMIT));
        expect(climbs).toBe(HOP_REPEAT_LIMIT + 1);
    });

    test('a different hop in between ends the repetition', async () => {
        const { results } = await walk(thrownBack(), HOP_REPEAT_LIMIT);
        expect(results.some(repeating)).toBe(false);
    });

    test('a walk that arrives is not stuck, however many walks a run makes', async () => {
        const { results } = await walk(walking(castle()), HOP_REPEAT_LIMIT + 2);
        expect(results.every(r => r.ok)).toBe(true);
    });
});
