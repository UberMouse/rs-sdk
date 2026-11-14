import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WALK_MAX_TICKS } from '../../actions/walk';
import { loadTask, taskNames } from '../../lib/catalog';
import { DEFAULT_STUCK_AFTER_MS } from '../../lib/engine';
import { TICK_MS } from '../../lib/util';
import type { FailStreak } from '../../lib/streak';
import { failStreakTicks, STUCK_MARGIN_MS, stuckWindowMs } from '../../lib/watchdog';
import bank from '../../tasks/bank';
import combat from '../../tasks/combat';
import firemaking from '../../tasks/firemaking';
import mining from '../../tasks/mining';
import pickup from '../../tasks/pickup';
import shop from '../../tasks/shop';
import woodcutting from '../../tasks/woodcutting';

describe('the watchdog helpers', () => {
    test('a window is the longest silent stretch in wall-clock time plus the margin', () => {
        expect(stuckWindowMs(10, 300, 20)).toBe(300 * TICK_MS + STUCK_MARGIN_MS);
    });

    test('a fail streak is the limit and one more attempt', () => {
        expect(failStreakTicks(4, 200)).toBe(1000);
    });
});

/** Migrated tasks declare their streaks in `silent`; the table reads them as ticks. */
const silentTicks = (task: { silent?: readonly (FailStreak | number)[] }) =>
    (task.silent ?? []).map(s => (typeof s === 'number' ? s : s.silentTicks));

/** A walk that never moves the bot, WALK_FAIL_LIMIT (3) times, and one more: 4 * 200 ticks. */
const WALK_STREAK = 4 * WALK_MAX_TICKS;

describe('a migrated task lists the silent stretches it must outlast', () => {
    // [task, ticks its silent must contain]; the window is computed from the list, and the stuck windows
    // describe below holds every task to its floor.
    const pinned = [
        ['bank', bank, [WALK_STREAK]],
        ['combat', combat, [WALK_STREAK, 7 * (WALK_MAX_TICKS + 15)]],
        ['shop', shop, [WALK_STREAK, 4 * (25 + 2 * 4 + 1 + WALK_MAX_TICKS)]],
        ['firemaking', firemaking, [WALK_STREAK]],
        ['woodcutting', woodcutting, [WALK_STREAK]],
        ['mining', mining, [WALK_STREAK]],
        ['pickup', pickup, [WALK_STREAK, 750]],
    ] as const;

    test.each(pinned)('%s', (_name, task, ticks) => {
        for (const pin of ticks) expect(silentTicks(task)).toContain(pin);
    });
});

describe('every walking task outlasts each fail streak it has', () => {
    test('combat', () => {
        const stuckAfterMs = combat.stuckAfterMs;
        expect(stuckAfterMs).toBeDefined();
        for (const ticks of silentTicks(combat))
            expect(stuckAfterMs ?? 0).toBeGreaterThanOrEqual(ticks * TICK_MS + STUCK_MARGIN_MS);
        expect(stuckAfterMs).toBe(stuckWindowMs(...silentTicks(combat)));
    });

    test('the walking tasks outlast a full run of failed walks, as the engine default does not', () => {
        for (const [name, task] of [
            ['bank', bank],
            ['shop', shop],
            ['combat', combat],
            ['firemaking', firemaking],
        ] as const) {
            expect(task.stuckAfterMs ?? 0, name).toBeGreaterThan(WALK_STREAK * TICK_MS);
            expect(task.stuckAfterMs ?? 0, name).toBeGreaterThan(DEFAULT_STUCK_AFTER_MS);
        }
    });
});

// Declaring a task's silent stretches may widen its stuck window, never narrow it. The fixture is each task's
// stuckAfterMs (null for the engine default) as it was before `silent` existed. Regenerate it only for a
// deliberate change: `UPDATE_STUCK_WINDOWS=1 bun test conductor/test/lib/watchdog.test.ts` rewrites it (formatted
// with oxfmt) from the current defs.
const FIXTURE = resolve(import.meta.dir, '../fixtures/stuck-windows.json');

async function currentWindows(): Promise<Record<string, number | null>> {
    const windows: Record<string, number | null> = {};
    for (const name of taskNames()) windows[name] = (await loadTask(name)).stuckAfterMs ?? null;
    return windows;
}

if (process.env.UPDATE_STUCK_WINDOWS) {
    writeFileSync(FIXTURE, JSON.stringify(await currentWindows(), null, 4) + '\n');
    const fmt = Bun.spawnSync(['bunx', 'oxfmt', FIXTURE], { cwd: resolve(import.meta.dir, '../../..') });
    if (fmt.exitCode !== 0) throw new Error(`oxfmt failed: ${String(fmt.stderr)}`);
}

describe('stuck windows', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, number | null>;

    test('the fixture covers every task', () => {
        expect(Object.keys(fixture).sort()).toEqual(taskNames());
    });

    for (const name of taskNames())
        test(name, async () => {
            const def = await loadTask(name);
            const window = def.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
            expect(window).toBeGreaterThanOrEqual(fixture[name] ?? DEFAULT_STUCK_AFTER_MS);
            for (const s of def.silent ?? [])
                if (typeof s !== 'number')
                    expect(window, s.name).toBeGreaterThanOrEqual(s.silentTicks * TICK_MS + STUCK_MARGIN_MS);
        });
});
