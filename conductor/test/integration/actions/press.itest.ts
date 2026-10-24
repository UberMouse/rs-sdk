import { expect, test } from 'bun:test';
import type { BotWorldState } from '../../../../sdk/types';
import { DEATH_DICE_INTERFACE } from '../../../actions/dismiss';
import { interfaceOpen, interfaceSays, pressComponent, type PressProgress } from '../../../actions/press';
import { converse, startTalk, TALK_OPTION } from '../../../actions/talk';
import { send, wait } from '../../../core/op';
import { itestTimeout, withFixtureBot } from '../harness';
import { runLive } from './live';

// Death Plateau, stage 50 (Harold given the ale): Harold's bedroom above the Toad and Chicken inn, Burthorpe
// (the spot of the talk gamble smoke). The dice table opens after the bet; its roll button (death_dice:com_28)
// is hidden until Harold has rolled and the caption reads "Your roll".
const HAROLD_SPOT = { x: 2906, z: 3541, level: 1 };
const VARPS = { 314: 50, 316: 100 << 9 };
const ROLL = 'death_dice:com_28';
const READY = /your roll/i;
const RESULT = /you (win|lose)/i;
const BET = 5;
const WAIT_MS = 30_000;
const BODY_MS = 90_000;
const TABLE_TICKS = 30;

const harold = (s: BotWorldState) => s.nearbyNpcs.find(n => /^harold$/i.test(n.name) && n.reachable !== false);
const tableOpen = (s: BotWorldState) => interfaceOpen(s, DEATH_DICE_INTERFACE);

/** Talks to Harold, bets, and waits (clicking pages through) until the table is open. */
async function openTable(sdk: Parameters<typeof runLive>[0]) {
    const ready = await sdk.waitForCondition(s => !!harold(s), WAIT_MS);
    const npc = harold(ready);
    if (!npc) throw new Error('no Harold after wait');
    expect(await runLive(sdk, ctx => startTalk(ctx, npc, TALK_OPTION))).toEqual({ ok: true });
    const talked = await runLive(sdk, ctx => converse(ctx, [/gamble/i], { answered: 0 }));
    expect(talked, JSON.stringify(talked)).toMatchObject({ ok: true });
    await runLive(sdk, function* () {
        return yield* send({ type: 'submitCountDialog', value: BET, reason: 'bet' });
    });
    for (let pass = 0; pass < 10 && !tableOpen(sdk.getState()!); pass++) {
        if (sdk.getState()!.dialog.isOpen) await runLive(sdk, ctx => converse(ctx, [], { answered: 0 }));
        else
            await runLive(sdk, function* () {
                return yield* wait('table or page', s => tableOpen(s) || s.dialog.isOpen, TABLE_TICKS);
            });
    }
    expect(tableOpen(sdk.getState()!)).toBe(true);
}

test(
    'pressComponent waits for the live roll button, then the click shows the result',
    async () => {
        await withFixtureBot(
            { position: HAROLD_SPOT, inventory: [{ id: 995, count: 1000 }], varps: VARPS },
            async ({ sdk }) => {
                await openTable(sdk);
                // The button is hidden while Harold rolls: the ready gate must have held the click back.
                const progress: PressProgress = { clicked: false };
                const r = await runLive(sdk, ctx =>
                    pressComponent(ctx, { component: ROLL, ready: READY, until: RESULT }, progress),
                );
                expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
                expect(r.ok && r.text).toMatch(RESULT);
                expect(progress.clicked).toBe(true);
                expect(interfaceSays(sdk.getState()!, RESULT)).toBeDefined();
            },
        );
    },
    itestTimeout({ extraMs: WAIT_MS + BODY_MS }),
);

test(
    'pressComponent reports not-ready when the ready text never shows',
    async () => {
        await withFixtureBot(
            { position: HAROLD_SPOT, inventory: [{ id: 995, count: 1000 }], varps: VARPS },
            async ({ sdk }) => {
                await openTable(sdk);
                const progress: PressProgress = { clicked: false };
                const r = await runLive(sdk, ctx =>
                    pressComponent(ctx, { component: ROLL, ready: /never shown/i, until: RESULT }, progress),
                );
                expect(r, JSON.stringify(r)).toMatchObject({ ok: false });
                // Either the gate timed out, or (a slow game) the table closed: never a click.
                expect(['not-ready', 'closed']).toContain(r.ok ? '' : r.reason);
                expect(progress.clicked).toBe(false);
            },
        );
    },
    itestTimeout({ extraMs: WAIT_MS + BODY_MS }),
);
