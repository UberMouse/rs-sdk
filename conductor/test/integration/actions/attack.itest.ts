import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState, NearbyNpc } from '../../../../sdk/types';
import { ATTACK_OPTION, ATTACK_WAIT_TICKS, attack } from '../../../actions/attack';
import { TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Fred's farm chicken pen, west of Lumbridge: the chicken spawn tiles from server/content/maps/m49_51.jm2
// (npc 41 at local 49..55, 13..15). Far from the combat smoke test's coop ((3231,3295) radius 8), and no
// other test fights, so only this test's earlier bots leave chickens dead or fighting.
const SPAWNS = [
    { x: 3185, z: 3277 },
    { x: 3186, z: 3279 },
    { x: 3187, z: 3278 },
    { x: 3189, z: 3278 },
    { x: 3191, z: 3277 },
];
const PEN = { minX: 3180, maxX: 3196, minZ: 3272, maxZ: 3284 };
/** A chicken respawns in 50 ticks (wiki/npcs/chicken.md); generous for slow ticks. */
const FREE_CHICKEN_WAIT_MS = 45_000;
/**
 * On the first ticks after login the client can publish an NPC it can't yet address (the send fails
 * "target_not_found") or drop it for a tick; a task never attacks that early.
 */
const LOGIN_SETTLE_TICKS = 5;
const BODY_MS = LOGIN_SETTLE_TICKS * TICK_MS + FREE_CHICKEN_WAIT_MS + ATTACK_WAIT_TICKS * TICK_MS + 10_000;
const spot = () => SPAWNS[Math.floor(Math.random() * SPAWNS.length)]!;
/** Chickens hit 0-1; Hitpoints 20 and food leave nothing to chance. */
const kit = () => ({
    position: spot(),
    skills: { Hitpoints: 20 },
    inventory: [{ id: Items.SHRIMPS, count: 1 }],
});

const inPen = (n: { x: number; z: number }) => n.x >= PEN.minX && n.x <= PEN.maxX && n.z >= PEN.minZ && n.z <= PEN.maxZ;
const freeChickens = (s: BotWorldState) =>
    s.nearbyNpcs
        .filter(n => /^chicken$/i.test(n.name) && n.reachable === true && !n.inCombat && inPen(n))
        .filter(n => n.options.some(o => ATTACK_OPTION.test(o)))
        .sort((a, b) => a.distance - b.distance);

/** The bot targets `npc` in combat, or has hit it. */
const engaged = (s: BotWorldState, npc: NearbyNpc) =>
    (s.player?.combat.targetType === 'npc' && s.player.combat.targetIndex === npc.index) ||
    s.combatEvents.some(e => e.type === 'damage_dealt' && e.targetType === 'npc' && e.targetIndex === npc.index);

async function freeChicken(sdk: BotSDK): Promise<NearbyNpc> {
    await sdk.waitForTicks(LOGIN_SETTLE_TICKS);
    const ready = await sdk.waitForCondition(s => freeChickens(s).length > 0, FREE_CHICKEN_WAIT_MS);
    return freeChickens(ready)[0]!;
}

test(
    'attack starts a fight with a chicken as bot.attack does',
    async () => {
        const viaOp = await withFixtureBot(kit(), async ({ sdk }) => {
            const chicken = await freeChicken(sdk);
            const r = await runLive(sdk, ctx => attack(ctx, chicken));
            return { ok: r.ok, detail: r, engaged: engaged(sdk.getState()!, chicken) };
        });
        const viaBot = await withFixtureBot(kit(), async ({ sdk, bot }) => {
            const chicken = await freeChicken(sdk);
            const r = await bot.attack(chicken);
            return { ok: r.success, detail: r, engaged: engaged(sdk.getState()!, chicken) };
        });
        const detail = JSON.stringify({ viaOp, viaBot });
        expect(viaOp.ok, detail).toBe(true);
        expect(viaOp.engaged, detail).toBe(true);
        expect({ ok: viaBot.ok, engaged: viaBot.engaged }, detail).toEqual({ ok: viaOp.ok, engaged: viaOp.engaged });
    },
    itestTimeout({ extraMs: BODY_MS }) * 2,
);
