import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import type { BotWorldState, NearbyNpc } from '../../../../sdk/types';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { ATTACK_OPTION } from '../../../actions/attack';
import { CAST_WAIT_TICKS, cast } from '../../../actions/cast';
import { TICK_MS } from '../../../lib/util';
import { COMBAT_SPELLS } from '../../../lib/spells';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Fred's farm chicken pen, as attack.itest.ts: chicken spawn tiles from server/content/maps/m49_51.jm2.
// Far from the combat smoke test's coop ((3231,3295) radius 8).
const SPAWN = { x: 3189, z: 3278 };
const FREE_CHICKEN_WAIT_MS = 45_000;
const LOGIN_SETTLE_TICKS = 5;
const BODY_MS = LOGIN_SETTLE_TICKS * TICK_MS + FREE_CHICKEN_WAIT_MS + CAST_WAIT_TICKS * TICK_MS + 10_000;

const freeChickens = (s: BotWorldState) =>
    s.nearbyNpcs
        .filter(n => /^chicken$/i.test(n.name) && n.reachable === true && !n.inCombat)
        .filter(n => n.options.some(o => ATTACK_OPTION.test(o)))
        .sort((a, b) => a.distance - b.distance);

const magicXp = (s: BotWorldState) => s.skills.find(k => k.name === 'Magic')?.experience ?? 0;

async function withMage<T>(runes: number, body: (sdk: BotSDK) => Promise<T>) {
    return withFixtureBot(
        {
            position: SPAWN,
            skills: { Hitpoints: 20 },
            inventory:
                runes > 0
                    ? [
                          { id: Items.AIR_RUNE, count: runes },
                          { id: Items.MIND_RUNE, count: runes },
                      ]
                    : [],
        },
        async ({ sdk }) => {
            await sdk.waitForTicks(LOGIN_SETTLE_TICKS);
            return body(sdk);
        },
    );
}

const wind = COMBAT_SPELLS['Wind Strike'];

test(
    'cast pays Magic XP',
    async () => {
        const out = await withMage(5, async sdk => {
            const ready = await sdk.waitForCondition(s => freeChickens(s).length > 0, FREE_CHICKEN_WAIT_MS);
            const chicken: NearbyNpc = freeChickens(ready)[0]!;
            const r = await runLive(sdk, ctx => cast(ctx, chicken, wind.component, 'Wind Strike'));
            return { r, xp: magicXp(sdk.getState()!) };
        });
        const detail = JSON.stringify(out);
        expect(out.r.ok, detail).toBe(true);
        expect(out.xp, detail).toBeGreaterThan(0);
    },
    itestTimeout({ extraMs: BODY_MS }),
);

test(
    'cast with no runes is no-runes',
    async () => {
        const out = await withMage(0, async sdk => {
            const ready = await sdk.waitForCondition(s => freeChickens(s).length > 0, FREE_CHICKEN_WAIT_MS);
            const chicken: NearbyNpc = freeChickens(ready)[0]!;
            return runLive(sdk, ctx => cast(ctx, chicken, wind.component, 'Wind Strike'));
        });
        const detail = JSON.stringify(out);
        expect(out.ok, detail).toBe(false);
        if (!out.ok) expect(out.reason, detail).toBe('no-runes');
    },
    itestTimeout({ extraMs: BODY_MS }),
);
