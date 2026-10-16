import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { Spells } from '../../../../sdk/spells';
import { CAST_ITEM_WAIT_TICKS, castOnItem } from '../../../actions/cast-item';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { countItems, TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

// Varrock West bank: open ground, and a cast touches only the caster's own inventory.
const SPAWN = { x: 3185, z: 3436 };
const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };
const IRON_ORE = 440;

test(
    'castOnItem superheats iron ore into a bar, paying runes and XP',
    async () => {
        await withFixtureBot(
            {
                position: SPAWN,
                skills: { Magic: 43, Smithing: 15 },
                inventory: [
                    { id: IRON_ORE, count: 1 },
                    { id: Items.NATURE_RUNE, count: 2 },
                    { id: Items.FIRE_RUNE, count: 8 },
                ],
            },
            async ({ sdk }) => {
                const ore = sdk.getState()!.inventory.find(i => i.id === IRON_ORE)!;
                const driver = new LiveDriver(sdk, SINKS, TICK_STALL_MS);
                try {
                    const r = await interpret(castOnItem(driver, ore, Spells.SUPERHEAT, 'Superheat Item', 1), {
                        driver,
                    });
                    expect(r).toMatchObject({ kind: 'returned', value: { ok: true } });
                } finally {
                    driver.close();
                }
                const s = sdk.getState()!;
                expect(countItems(s, /^iron ore$/i)).toBe(0);
                expect(countItems(s, /^iron bar$/i)).toBe(1);
                expect(countItems(s, /^nature rune$/i)).toBe(1);
                expect(countItems(s, /^fire rune$/i)).toBe(4);
            },
        );
    },
    itestTimeout({ extraMs: CAST_ITEM_WAIT_TICKS * TICK_MS }),
);
