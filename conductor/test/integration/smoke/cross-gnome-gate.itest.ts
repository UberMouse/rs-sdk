import { expect, test } from 'bun:test';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// South of the Gnome Stronghold gate (2459,3383), outside its fence, west of travel.itest's start (2506,3390); the
// south bank upstairs (gnome-stronghold-bank, stand 2445,3425 on level 1). The way in is the gate's scripted move
// (passGate answers Femi) and the staircase; out, the staircase and the gate outward.
const SOUTH = { x: 2470, z: 3360 };
const BANK = { level: 1, x: 2445, z: 3425 };

test(
    'walkTo passes the Gnome Stronghold gate inward to the south bank upstairs, and outward back',
    async () => {
        await withFixtureBot({ position: SOUTH }, async ({ sdk }) => {
            const into = await walkLive(sdk, BANK);
            expect(into.result.ok, detail(into)).toBe(true);
            expect(here(sdk).level, detail(into)).toBe(1);
            expect(into.logs, detail(into)).toContain('walk: passed the Gnome Stronghold gate');

            const out = await walkLive(sdk, SOUTH);
            expect(out.result.ok, detail(out)).toBe(true);
            expect(here(sdk).z, detail(out)).toBeLessThan(3383);
            expect(out.logs, detail(out)).toContain('walk: passed the Gnome Stronghold gate');
        });
    },
    itestTimeout({ extraMs: 2 * WALKS_MS }),
);
