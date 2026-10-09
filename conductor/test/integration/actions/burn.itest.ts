import { expect, test } from 'bun:test';
import type { BotActions } from '../../../../sdk/actions';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { BURN_WAIT_TICKS, burn } from '../../../actions/burn';
import { countItems, findSkill, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive, sidestep } from './live';

// Open ground east of Lumbridge, south of the other action tests' z 3258..3262: x 3250..3256 on
// z 3254..3255 is every tile walkable with no loc on it when probed. No other integration test lights
// fires here. A recently lit tile can refuse another fire (wiki/skills/firemaking.md), so each bot
// starts on a random tile and steps aside after a refusal.
const field = () => ({ x: 3250 + Math.floor(Math.random() * 7), z: 3254 + Math.floor(Math.random() * 2) });
const LIGHT_ATTEMPTS = 5;
const LIGHT_WAIT_MS = BURN_WAIT_TICKS * TICK_MS;
const BODY_SLACK_MS = 60_000;
const LOGS = /^logs$/i;
const kit = () => ({
    position: field(),
    inventory: [
        { id: Items.TINDERBOX, count: 1 },
        { id: Items.LOGS, count: 1 },
    ],
});

/** How one bot's lights went: the xp of the one that caught, and how each refused one was reported. */
interface Lit {
    xpGained: number;
    refusals: string[];
}

/** Lights the logs with `light` (stepping aside after each refusal) until one catches. */
async function lightOnce(
    sdk: BotSDK,
    bot: BotActions,
    light: () => Promise<{ xpGained: number } | { refused: string }>,
): Promise<Lit> {
    const refusals: string[] = [];
    const xpBefore = findSkill(sdk.getState()!, 'Firemaking')?.experience ?? 0;
    for (let attempt = 0; attempt < LIGHT_ATTEMPTS; attempt++) {
        const r = await light();
        if ('xpGained' in r) {
            expect(findSkill(sdk.getState()!, 'Firemaking')?.experience).toBe(xpBefore + r.xpGained);
            expect(countItems(sdk.getState()!, LOGS)).toBe(0);
            return { xpGained: r.xpGained, refusals };
        }
        refusals.push(r.refused);
        await sidestep(sdk, bot);
    }
    throw new Error(`no fire in ${LIGHT_ATTEMPTS} lights: ${refusals.join(' | ')}`);
}

test(
    'burn lights logs for the same xp as bot.burnLogs, and reports a refused tile as cant-light-here',
    async () => {
        const viaOp = await withFixtureBot(kit(), ({ sdk, bot }) =>
            lightOnce(sdk, bot, async () => {
                const r = await runLive(sdk, ctx => burn(ctx, LOGS));
                if (r.ok) return { xpGained: r.xpGained };
                // The one failure a good kit on open ground can see is a refused tile. A timeout is a
                // failure here, not a retry: the server dropped the logs on the tile before the first roll
                // and may still light them, so another burn would start from a changed world.
                expect(r.reason, `burn failed (not a refused tile): ${r.message}`).toBe('cant-light-here');
                return { refused: r.message };
            }),
        );
        const viaBot = await withFixtureBot(kit(), ({ sdk, bot }) =>
            lightOnce(sdk, bot, async () => {
                const logs = sdk.findInventoryItem(LOGS);
                if (!logs) throw new Error('fixture logs missing');
                const r = await bot.burnLogs(logs);
                if (r.success) return { xpGained: r.xpGained };
                expect(['Failed to light fire (possibly bad location)', 'Timed out waiting for fire']).toContain(
                    r.message,
                );
                return { refused: r.message };
            }),
        );
        expect(viaOp.xpGained).toBeGreaterThan(0);
        expect(viaOp.xpGained).toBe(viaBot.xpGained);
        for (const m of viaOp.refusals) expect(m).toBe("You can't light a fire here.");
    },
    itestTimeout({ extraMs: 2 * (LIGHT_ATTEMPTS * LIGHT_WAIT_MS + BODY_SLACK_MS) }),
);
