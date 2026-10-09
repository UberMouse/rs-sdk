import { expect, test } from 'bun:test';
import type { BotSDK } from '../../../../sdk/index';
import type { ActionResult, BotAction, NearbyLoc } from '../../../../sdk/types';
import { WALK_MAX_TICKS, type WalkResult, walkTo } from '../../../actions/walk';
import { LiveDriver } from '../../../core/drivers/live';
import { interpret } from '../../../core/interpret';
import { TICK_STALL_MS } from '../../../lib/engine';
import type { Sinks } from '../../../lib/task';
import { TICK_MS } from '../../../lib/util';
import { itestTimeout, withFixtureBot } from '../harness';

const SINKS: Sinks = { event: () => {}, print: () => {}, screenshot: async () => null };

/** A live driver that keeps the reason of every send. */
class Recording extends LiveDriver {
    readonly sent: string[] = [];
    override async send(a: BotAction): Promise<ActionResult> {
        this.sent.push(a.reason);
        return super.send(a);
    }
}

/** Runs one walkTo on the live bot, with the SDK's collision data for routes. */
async function walk(sdk: BotSDK, x: number, z: number, tolerance: number) {
    const driver = new Recording(sdk, SINKS, TICK_STALL_MS);
    const startTick = sdk.getState()!.tick;
    try {
        const r = await interpret(walkTo(driver, x, z, tolerance), { driver });
        if (r.kind !== 'returned') throw new Error(`walk did not return: ${JSON.stringify(r)}`);
        return { result: r.value, sent: driver.sent, ticks: sdk.getState()!.tick - startTick };
    } finally {
        driver.close();
    }
}

const at = (sdk: BotSDK) => {
    const p = sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ };
};

// Lumbridge castle's front doors, a pair of Large doors at (3217,3218) and (3217,3219), closed at the
// start: the entrance hall behind them (x 3214..3216) is reachable only through them. No other test
// goes in; a run that leaves them open is undone by the next one's closeDoors.
const DOOR_TILES = [
    { x: 3217, z: 3218 },
    { x: 3217, z: 3219 },
];
const COURTYARD = { x: 3223, z: 3219 };
const HALL = { x: 3215, z: 3219 };
const CLOSE = /^close$/i;
const OPEN = /^open$/i;
const isCastleDoor = (l: NearbyLoc) =>
    /door/i.test(l.name) && DOOR_TILES.some(t => Math.abs(t.x - l.x) <= 1 && Math.abs(t.z - l.z) <= 1);
const bothShut = (locs: NearbyLoc[]) =>
    DOOR_TILES.every(t => locs.some(l => l.x === t.x && l.z === t.z && l.options.some(o => OPEN.test(o))));
/** A door's open/close wait, generous. */
const DOOR_WAIT_MS = 10_000;

/** Closes whichever of the castle doors an earlier run left open, so the walk has to open them. */
async function closeDoors(sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 4 && !bothShut(sdk.getState()!.nearbyLocs); i++) {
        const open = sdk.getState()!.nearbyLocs.find(l => isCastleDoor(l) && l.options.some(o => CLOSE.test(o)));
        if (!open) break;
        const option = open.optionsWithIndex.find(o => CLOSE.test(o.text))!;
        await sdk.sendInteractLoc(open.x, open.z, open.id, option.opIndex);
        await sdk
            .waitForCondition(
                s => !s.nearbyLocs.some(l => l.x === open.x && l.z === open.z && l.id === open.id),
                DOOR_WAIT_MS,
            )
            .catch(() => {});
    }
    expect(bothShut(sdk.getState()!.nearbyLocs), 'castle doors shut before the walk').toBe(true);
}

test(
    'walkTo opens the castle doors on its route; bot.walkTo gets back out through them',
    async () => {
        await withFixtureBot({ position: COURTYARD }, async ({ sdk, bot }) => {
            await closeDoors(sdk);
            const inward = await walk(sdk, HALL.x, HALL.z, 0);
            expect(inward.result, `sent ${JSON.stringify(inward.sent)}`).toEqual({ ok: true, message: 'Arrived' });
            expect(at(sdk)).toEqual(HALL);
            expect(inward.sent).toContain('Open Large door');

            // Parity: upstream's walkTo through the same doors, shut again, the other way.
            await closeDoors(sdk);
            const outward = await bot.walkTo(COURTYARD.x, COURTYARD.z, 0);
            expect(outward).toMatchObject({ success: true });
            expect(at(sdk)).toEqual(COURTYARD);
            await closeDoors(sdk);
        });
    },
    itestTimeout({ extraMs: 2 * WALK_MAX_TICKS * TICK_MS + 6 * DOOR_WAIT_MS }),
);

// Lumbridge to Varrock West bank: about 230 tiles of route north.
const LUMBRIDGE = { x: 3235, z: 3220 };
const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
/** Walks a long route may take: one runs out of its tick budget once run energy is gone. */
const MAX_WALKS = 3;

test(
    'walkTo walks from Lumbridge to Varrock West bank, a walk that runs out of ticks carrying on',
    async () => {
        await withFixtureBot({ position: LUMBRIDGE }, async ({ sdk }) => {
            const walks: { result: WalkResult; ticks: number; sent: string[] }[] = [];
            for (let i = 0; i < MAX_WALKS; i++) {
                const w = await walk(sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
                walks.push(w);
                if (w.result.ok || w.result.reason !== 'timeout') break;
            }
            const report = JSON.stringify(
                walks.map(w => ({
                    ...w.result,
                    ticks: w.ticks,
                    sends: w.sent.length,
                    opens: w.sent.filter(r => r.startsWith('Open')),
                })),
            );
            console.log(`walk-itest long walk: ${report}`);
            expect(walks.at(-1)!.result, report).toMatchObject({ ok: true });
            const p = at(sdk);
            expect(
                Math.max(Math.abs(p.x - VARROCK_WEST_BANK.x), Math.abs(p.z - VARROCK_WEST_BANK.z)),
            ).toBeLessThanOrEqual(3);
        });
    },
    itestTimeout({ extraMs: MAX_WALKS * WALK_MAX_TICKS * TICK_MS }),
);
