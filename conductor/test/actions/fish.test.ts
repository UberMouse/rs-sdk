import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../../sdk/types';
import { FISH_RESUME_WAIT_TICKS, FISH_WAIT_TICKS, fish } from '../../actions/fish';
import { TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { world } from '../world';

const SHRIMPS = [/^raw shrimps$/i];
const NET = /^net$/i;
const shore = world().npc('Fishing spot', 3086, 3228, { index: 7, options: ['Net', 'Bait'] });
const spot = shore.build().nearbyNpcs[0]!;
/** The spot hopped to another tile (same npc index). */
const hopped = world().npc('Fishing spot', 3085, 3230, { index: 7, options: ['Net', 'Bait'] });

async function run(states: BotWorldState[], opts: TimelineOptions = {}, resume = false) {
    const driver = new TimelineDriver(states, opts);
    const r = await interpret(fish(driver, spot, NET, SHRIMPS, { resume }), { driver });
    if (r.kind !== 'returned') throw new Error(`fish did not return: ${JSON.stringify(r)}`);
    return { result: r.value, driver };
}

describe('fish', () => {
    test('sends Net on the spot and succeeds once a fish arrives', async () => {
        const { result, driver } = await run(shore.series(10, (w, i) => (i >= 4 ? w.inv('Raw shrimps', 1) : w)));
        expect(result).toEqual({ ok: true });
        expect(driver.commands).toEqual([
            { type: 'send', action: { type: 'interactNpc', npcIndex: 7, optionIndex: 1, reason: 'Net Fishing spot' } },
        ]);
        expect(driver.state().tick).toBe(4);
    });

    test('fish already carried, or of another kind, are not a catch', async () => {
        const { result } = await run(
            shore
                .inv('Raw shrimps', 3)
                .series(10, (w, i) => (i >= 3 ? hopped.inv('Raw shrimps', 3).inv('Raw herring', 1, { id: 345 }) : w)),
        );
        expect(result.ok === false && result.reason).toBe('spot-moved');
    });

    test('the spot hopping to another tile ends the wait as spot-moved', async () => {
        const { result } = await run(shore.series(10, (w, i) => (i >= 3 ? hopped : w)));
        expect(result).toEqual({
            ok: false,
            reason: 'spot-moved',
            message: 'fishing spot (3086,3228) moved away',
        });
    });

    test('the spot leaving view is spot-moved too', async () => {
        const { result } = await run(shore.series(10, (w, i) => (i >= 3 ? world() : w)));
        expect(result.ok === false && result.reason).toBe('spot-moved');
    });

    test('nothing within the wait is a timeout, after its tick budget', async () => {
        const { result, driver } = await run(shore.series(1));
        expect(result.ok === false && result.reason).toBe('timeout');
        expect(driver.state().tick).toBe(FISH_WAIT_TICKS);
    });

    test('resume sends nothing and waits the shorter budget', async () => {
        const { result, driver } = await run(shore.series(1), {}, true);
        expect(result.ok === false && result.reason).toBe('timeout');
        expect(driver.commands.filter(c => c.type === 'send')).toEqual([]);
        expect(driver.state().tick).toBe(FISH_RESUME_WAIT_TICKS);
    });

    test('a refused send is send-failed, with nothing waited for', async () => {
        const { result, driver } = await run(shore.series(1), {
            respond: () => ({ success: false, message: 'not connected' }),
        });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
        expect(driver.ticksElapsed).toBe(0);
    });

    test('a spot without the option is no-option, nothing sent', async () => {
        const driver = new TimelineDriver(shore.series(1));
        const r = await interpret(fish(driver, spot, /^harpoon$/i, SHRIMPS), { driver });
        expect(r).toEqual({
            kind: 'returned',
            value: { ok: false, reason: 'no-option', message: 'no /^harpoon$/i option on Fishing spot' },
        });
        expect(driver.commands).toEqual([]);
    });
});
