import { describe, expect, test } from 'bun:test';
import { WALK_MAX_TICKS } from '../../actions/walk';
import { DEFAULT_STUCK_AFTER_MS } from '../../lib/engine';
import { TICK_MS } from '../../lib/util';
import { failStreakTicks, STUCK_MARGIN_MS, stuckWindowMs } from '../../lib/watchdog';
import bank, { SILENT_STREAK_TICKS as bankStreaks } from '../../tasks/bank';
import combat, { SILENT_STREAK_TICKS as combatStreaks } from '../../tasks/combat';
import firemaking, { SILENT_STREAK_TICKS as firemakingStreaks } from '../../tasks/firemaking';
import mining, { SILENT_STREAK_TICKS as miningStreaks } from '../../tasks/mining';
import pickup, { SILENT_STREAK_TICKS as pickupStreaks } from '../../tasks/pickup';
import shop, { SILENT_STREAK_TICKS as shopStreaks } from '../../tasks/shop';
import smithing, { SILENT_STREAK_TICKS as smithingStreaks } from '../../tasks/smithing';
import woodcutting, { SILENT_STREAK_TICKS as woodcuttingStreaks } from '../../tasks/woodcutting';

describe('the watchdog helpers', () => {
    test('a window is the longest silent stretch in wall-clock time plus the margin', () => {
        expect(stuckWindowMs(10, 300, 20)).toBe(300 * TICK_MS + STUCK_MARGIN_MS);
    });

    test('a fail streak is the limit and one more attempt', () => {
        expect(failStreakTicks(4, 200)).toBe(1000);
    });
});

/** A walk that never moves the bot, WALK_FAIL_LIMIT (3) times, and one more: 4 * 200 ticks. */
const WALK_STREAK = 4 * WALK_MAX_TICKS;

describe('every walking task outlasts each fail streak it has', () => {
    // [task, its stuckAfterMs, its streak windows in ticks, ticks that must be among them (pinned)]
    const table = [
        ['bank', bank.stuckAfterMs, bankStreaks, [WALK_STREAK]],
        ['shop', shop.stuckAfterMs, shopStreaks, [WALK_STREAK, 4 * (25 + 2 * 4 + 1 + WALK_MAX_TICKS)]],
        ['combat', combat.stuckAfterMs, combatStreaks, [WALK_STREAK, 7 * (WALK_MAX_TICKS + 15)]],
        ['firemaking', firemaking.stuckAfterMs, firemakingStreaks, [WALK_STREAK]],
        ['smithing', smithing.stuckAfterMs, smithingStreaks, []],
        ['woodcutting', woodcutting.stuckAfterMs, woodcuttingStreaks, [WALK_STREAK]],
        ['mining', mining.stuckAfterMs, miningStreaks, [WALK_STREAK]],
        ['pickup', pickup.stuckAfterMs, pickupStreaks, [WALK_STREAK, 750]],
    ] as const;

    test.each(table)('%s', (_name, stuckAfterMs, streaks, pinned) => {
        expect(stuckAfterMs).toBeDefined();
        for (const ticks of streaks)
            expect(stuckAfterMs ?? 0).toBeGreaterThanOrEqual(ticks * TICK_MS + STUCK_MARGIN_MS);
        for (const ticks of pinned) expect(streaks).toContain(ticks);
        expect(stuckAfterMs).toBe(stuckWindowMs(...streaks));
    });

    test('the walking tasks outlast a full run of failed walks, as the engine default does not', () => {
        for (const [name, stuckAfterMs] of table.slice(0, 4)) {
            expect(stuckAfterMs ?? 0, name).toBeGreaterThan(WALK_STREAK * TICK_MS);
            expect(stuckAfterMs ?? 0, name).toBeGreaterThan(DEFAULT_STUCK_AFTER_MS);
        }
    });
});
