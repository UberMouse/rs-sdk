import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import { Items } from '../../../../sdk/test/utils/save-generator';
import type { BotWorldState, NearbyLoc } from '../../../../sdk/types';
import { isSkillMenu, SMITHING_INTERFACE } from '../../../actions/dismiss';
import { SMELT_OPTION, smelt, smith } from '../../../actions/smith';
import { LiveDriver } from '../../../core/drivers/live';
import { type Guard, interpret } from '../../../core/interpret';
import { dialogGuard, type GuardRun, interfaceGuard, type TaskGuard } from '../../../lib/interrupts';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItems, findSkill } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// The Al Kharid furnace (furnace1 at 3272,3185, approached from the east; its option-less decoy is at
// 3273,3184) and the two anvils in the house at (3246,3404)/(3248,3404) in south-east Varrock: the
// smithing smokes use the Lumbridge furnace and the Varrock West anvils, and no other integration test
// stands near either. Spawning inside Al Kharid never meets its toll gate.
const FURNACE_SPOT = { x: 3275, z: 3186 };
const ANVIL_SPOT = { x: 3247, z: 3403 };
const BODY_MS = 60_000;
const BRONZE_BAR = /^bronze bar$/i;
const DAGGER = /^bronze dagger$/i;
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

const smithingXp = (sdk: BotSDK) => findSkill(sdk.getState()!, 'Smithing')?.experience ?? 0;
const count = (sdk: BotSDK, pattern: RegExp) => countItems(sdk.getState()!, pattern);
/** The furnace kit's ores and what they made. */
const held = (sdk: BotSDK) => ({
    copper: count(sdk, /^copper ore$/i),
    tin: count(sdk, /^tin ore$/i),
    bars: count(sdk, BRONZE_BAR),
});
const anvilOpen = (s: BotWorldState) => s.interface.isOpen && s.interface.interfaceId === SMITHING_INTERFACE;

const anvilKit = (bars: number) => ({
    position: ANVIL_SPOT,
    skills: { Smithing: 1 },
    inventory: [
        { id: Items.HAMMER, count: 1 },
        ...Array.from({ length: bars }, () => ({ id: Items.BRONZE_BAR, count: 1 })),
    ],
});
const furnaceKit = () => ({
    position: FURNACE_SPOT,
    skills: { Smithing: 1 },
    inventory: [
        { id: Items.COPPER_ORE, count: 1 },
        { id: Items.TIN_ORE, count: 1 },
    ],
});

/** The nearest reachable anvil, as the smithing task picks it. */
function anvilNear(sdk: BotSDK): NearbyLoc {
    const anvil = sdk.findNearbyLoc(/anvil/i, { reachable: true });
    expect(anvil, 'no reachable anvil in view').not.toBeNull();
    return anvil!;
}

/** The furnace with the Smelt option, not its decoy. */
function furnaceNear(sdk: BotSDK): NearbyLoc {
    const furnace = sdk.findNearbyLoc(/furnace/i, { withOption: SMELT_OPTION });
    expect(furnace, 'no furnace with a Smelt option in view').not.toBeNull();
    return furnace!;
}

/** A shared guard as the engine runs it, counting its runs. */
function counted<E extends object>(shared: TaskGuard<E>, sdk: BotSDK): { guard: Guard; runs: () => number } {
    const run: GuardRun = { state: () => sdk.getState()!, startTick: sdk.getState()!.tick, previousPos: null };
    const episode = shared.episode();
    let runs = 0;
    const guard: Guard = {
        name: shared.name,
        policy: shared.policy,
        when: s => shared.when(s, run),
        run: s => {
            runs++;
            return shared.run(s, run, episode);
        },
    };
    return { guard, runs: () => runs };
}

test(
    'smith forges a bronze dagger for the same xp and items as bot.smithAtAnvil',
    async () => {
        const viaOp = await withFixtureBot(anvilKit(1), async ({ sdk }) => {
            const before = smithingXp(sdk);
            const r = await runLive(sdk, ctx => smith(ctx, anvilNear(sdk), 'dagger', BRONZE_BAR));
            expect(r, JSON.stringify(r)).toMatchObject({ ok: true, product: 'dagger' });
            return {
                ok: r.ok,
                xp: smithingXp(sdk) - before,
                bars: count(sdk, BRONZE_BAR),
                daggers: count(sdk, DAGGER),
            };
        });
        const viaBot = await withFixtureBot(anvilKit(1), async ({ sdk, bot }) => {
            const before = smithingXp(sdk);
            const r = await bot.smithAtAnvil('dagger', { barPattern: BRONZE_BAR });
            await sdk.waitForCondition(s => countItems(s, DAGGER) > 0, 5000).catch(() => null);
            return {
                ok: r.success,
                xp: smithingXp(sdk) - before,
                bars: count(sdk, BRONZE_BAR),
                daggers: count(sdk, DAGGER),
            };
        });
        expect(viaOp.xp).toBeGreaterThan(0);
        expect(viaOp).toEqual({ ok: true, xp: viaOp.xp, bars: 0, daggers: 1 });
        expect(viaOp).toEqual(viaBot);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);

test(
    'under the interface and dialog guards, the anvil interface is left to the op and two daggers are made',
    async () => {
        await withFixtureBot(anvilKit(2), async ({ sdk }) => {
            const iface = counted(interfaceGuard, sdk);
            const dialog = counted(dialogGuard, sdk);
            for (let i = 0; i < 2; i++) {
                const r = await runLive(sdk, ctx => smith(ctx, anvilNear(sdk), 'dagger', BRONZE_BAR), [
                    dialog.guard,
                    iface.guard,
                ]);
                expect(r.ok, JSON.stringify(r)).toBe(true);
            }
            expect(count(sdk, DAGGER)).toBe(2);
            // The first dagger levels Smithing up; that box was the dialog guard's, the interface never the
            // interface guard's.
            expect(dialog.runs()).toBeGreaterThan(0);
            expect(iface.runs()).toBe(0);
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);

test(
    'cancelled with the anvil interface open, smith closes it before it returns',
    async () => {
        await withFixtureBot(anvilKit(1), async ({ sdk }) => {
            const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
            const abort: Guard = {
                name: 'abort',
                policy: 'abort',
                when: anvilOpen,
                run: () => ({ fail: 'test abort' }),
            };
            try {
                const r = await interpret(smith(driver, anvilNear(sdk), 'dagger', BRONZE_BAR), {
                    driver,
                    guards: [abort],
                });
                expect(r.kind).toBe('aborted');
            } finally {
                driver.close();
            }
            await sdk.waitForTicks(2);
            expect(anvilOpen(sdk.getState()!)).toBe(false);
            // Cancelled before the click: nothing was made.
            expect(count(sdk, BRONZE_BAR)).toBe(1);
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);

test(
    'smelt makes a bronze bar for the same xp and items as using the ore on the furnace (the legacy task)',
    async () => {
        const viaOp = await withFixtureBot(furnaceKit(), async ({ sdk }) => {
            const before = smithingXp(sdk);
            const r = await runLive(sdk, ctx => smelt(ctx, furnaceNear(sdk), 'Bronze'));
            expect(r, JSON.stringify(r)).toMatchObject({ ok: true, product: 'Bronze' });
            await sdk.waitForCondition(s => countItems(s, BRONZE_BAR) > 0, 5000).catch(() => null);
            return { ok: r.ok, xp: smithingXp(sdk) - before, ...held(sdk) };
        });
        const viaLegacy = await withFixtureBot(furnaceKit(), async ({ sdk, bot }) => {
            const before = smithingXp(sdk);
            const r = await bot.useItemOnLoc('Copper ore', furnaceNear(sdk));
            await sdk.waitForCondition(s => countItems(s, BRONZE_BAR) > 0, 6000).catch(() => null);
            return { ok: r.success, xp: smithingXp(sdk) - before, ...held(sdk) };
        });
        expect(viaOp.xp).toBeGreaterThan(0);
        expect(viaOp).toEqual({ ok: true, xp: viaOp.xp, copper: 0, tin: 0, bars: 1 });
        expect(viaOp).toEqual(viaLegacy);
    },
    itestTimeout({ extraMs: 2 * BODY_MS }) * 2,
);

test(
    'a bar the smelting menu does not offer is no-product, and the menu is closed again',
    async () => {
        await withFixtureBot(furnaceKit(), async ({ sdk }) => {
            const r = await runLive(sdk, ctx => smelt(ctx, furnaceNear(sdk), 'Bluerite'));
            expect(r, JSON.stringify(r)).toMatchObject({ ok: false, reason: 'no-product' });
            // The live menu's own labels, as the op read them.
            expect(r.ok ? '' : r.message).toContain(
                '"Bronze", "Iron", "Silver", "Steel", "Gold", "Mithril", "Adamant", "Rune"',
            );
            await sdk.waitForTicks(1);
            expect(isSkillMenu(sdk.getState()!.dialog)).toBe(false);
            expect(count(sdk, /^copper ore$/i)).toBe(1);
        });
    },
    itestTimeout({ extraMs: BODY_MS }),
);
