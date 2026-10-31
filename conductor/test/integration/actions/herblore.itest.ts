import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { brewPotion, cleanHerb } from '../../../actions/herblore';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItemId } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

const GRIMY_GUAM = 199;
const GUAM = 249;
const VIAL = 227;
const GUAM_UNF = 91;
const NEWT = 221;
const ATTACK_POTION_3 = 121;
const GRIMY_IRIT = 209;
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };
const item = (s: BotWorldState, id: number) => s.inventory.find(i => i.id === id)!;

test(
    'cleanHerb and brewPotion make an attack potion from a grimy guam',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3222, z: 3218 },
                skills: { Herblore: 3 },
                inventory: [GRIMY_GUAM, VIAL, NEWT].map(id => ({ id, count: 1 })),
            },
            async ({ sdk }) => {
                const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
                try {
                    const clean = await interpret(cleanHerb(driver, item(sdk.getState()!, GRIMY_GUAM)), { driver });
                    expect(clean.kind === 'returned' && clean.value.ok, JSON.stringify(clean)).toBe(true);
                    expect(countItemId(sdk.getState()!, GUAM)).toBe(1);

                    const s1 = sdk.getState()!;
                    const unf = await interpret(brewPotion(driver, item(s1, GUAM), item(s1, VIAL), GUAM_UNF), {
                        driver,
                    });
                    expect(unf, 'unfinished').toEqual({ kind: 'returned', value: { ok: true, xpGained: 0 } });

                    const s2 = sdk.getState()!;
                    const done = await interpret(
                        brewPotion(driver, item(s2, NEWT), item(s2, GUAM_UNF), ATTACK_POTION_3),
                        { driver },
                    );
                    expect(done.kind === 'returned' && done.value.ok && done.value.xpGained, JSON.stringify(done)).toBe(
                        625,
                    );
                    expect(countItemId(sdk.getState()!, ATTACK_POTION_3)).toBe(1);
                } finally {
                    driver.close();
                }
            },
        );
    },
    itestTimeout({}),
);

test(
    'cleanHerb refuses a herb above the level and keeps it',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3222, z: 3218 },
                skills: { Herblore: 3 },
                inventory: [{ id: GRIMY_IRIT, count: 1 }],
            },
            async ({ sdk }) => {
                const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
                try {
                    const r = await interpret(cleanHerb(driver, item(sdk.getState()!, GRIMY_IRIT)), { driver });
                    expect(r.kind === 'returned' && !r.value.ok && r.value.reason, JSON.stringify(r)).toBe(
                        'level-too-low',
                    );
                    expect(countItemId(sdk.getState()!, GRIMY_IRIT)).toBe(1);
                } finally {
                    driver.close();
                }
            },
        );
    },
    itestTimeout({}),
);
