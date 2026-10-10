import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { PICKPOCKET_OPTION, pickpocket } from '../../../actions/pickpocket';
import { findSkill } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Al Kharid Men (learnings/thieving.md). Not the Lumbridge castle: smoke/thieving.itest.ts works those
// Men and itests run in parallel. A Man in someone else's attempt is simply "not free".
const AL_KHARID_MEN = { x: 3294, z: 3196 };
const MAN = /^man$/i;
const MAN_WAIT_MS = 30_000;
const BODY_MS = 30_000;
const thieving = (xp: number | undefined) => xp ?? 0;

const freeMen = (state: BotWorldState) =>
    state.nearbyNpcs
        .filter(n => MAN.test(n.name) && !n.inCombat && n.options.some(o => PICKPOCKET_OPTION.test(o)))
        .sort((a, b) => a.distance - b.distance);

test(
    'pickpocket on a Man is a success with Thieving XP, or a caught attempt',
    async () => {
        await withFixtureBot({ position: AL_KHARID_MEN }, async ({ sdk }) => {
            const ready = await sdk.waitForCondition(s => freeMen(s).length > 0, MAN_WAIT_MS);
            const man = freeMen(ready)[0];
            if (!man) throw new Error('no free Man after wait');
            const xpBefore = thieving(findSkill(ready, 'Thieving')?.experience);

            const r = await runLive(sdk, ctx => pickpocket(ctx, man));
            expect(r.ok, JSON.stringify(r)).toBe(true);
            if (!r.ok) return;
            const after = sdk.getState();
            if (!after) throw new Error('no state after pickpocket');
            const xpAfter = thieving(findSkill(after, 'Thieving')?.experience);
            if (r.outcome === 'success') {
                expect(r.xpGained).toBeGreaterThan(0);
                expect(xpAfter - xpBefore).toBe(r.xpGained);
            } else {
                expect(r.outcome).toBe('caught');
                expect(xpAfter).toBe(xpBefore);
            }
        });
    },
    itestTimeout({ extraMs: MAN_WAIT_MS + BODY_MS }),
);
