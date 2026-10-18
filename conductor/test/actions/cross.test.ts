// cross: one move of the walk graph, by its act, read against the state the game answers with.
import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { Items } from '../../../sdk/test/utils/save-generator';
import { CROSS_MAX_ATTEMPTS, cross, crossWaitTicks } from '../../actions/cross';
import { type Effect, TimelineDriver, type TimelineOptions } from '../../core/drivers/timeline';
import { interpret } from '../../core/interpret';
import { configId } from '../../lib/packs';
import type { Move } from '../../lib/walk-graph';
import { world, type World } from '../world';

const tile = (x: number, z: number, level = 0) => ({ level, x, z });
const STAND = { x: 2461, z: 3381 };
const LANDING = tile(2461, 3385);
/** A scripted loc op move across a gate. */
const gateMove: Move = {
    via: 'scripted',
    act: { kind: 'loc-op', loc: 'gnome_areagate', op: 1 },
    at: tile(2459, 3383),
    landings: [LANDING],
    source: 'gnome_gate.rs2:59',
};
const GATE_ID = configId('loc', 'gnome_areagate')!;
const base = world()
    .player({ at: STAND })
    .loc('Gate', 2459, 3383, { options: ['Open'], id: GATE_ID });

/** Moves the player to `to` from the next tick on. */
const moveTo =
    (to: { x: number; z: number; level?: number }): Effect =>
    s => ({ ...s, player: { ...s.player!, worldX: to.x, worldZ: to.z, level: to.level ?? s.player!.level } });
/** A world change from the next tick on. */
const change =
    (f: (w: World) => World): Effect =>
    s =>
        f(world(s)).build();

/** A choice dialog shown from the next tick on. */
const asks = (options: string[]) => change(w => w.dialog({ options }));
/** Each Open on a loc slips (a fall message) until the `n`th, which lands. */
const fallsUntil = (n: number): TimelineOptions['react'] => {
    let sent = 0;
    return a => {
        if (a.type !== 'interactLoc') return undefined;
        sent++;
        return sent < n ? change(w => w.message('You slip and fall.')) : moveTo(LANDING);
    };
};

async function run(m: Move, first: BotWorldState, opts: TimelineOptions = {}, retry?: () => boolean) {
    const driver = new TimelineDriver([first], opts);
    const r = await interpret(cross(driver, m, retry ? { retry } : {}), { driver });
    if (r.kind !== 'returned') throw new Error(`cross did not return: ${JSON.stringify(r)}`);
    const sends = driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    return { result: r.value, sends, driver };
}
const reactTo =
    (type: BotAction['type'], effect: Effect): TimelineOptions['react'] =>
    a =>
        a.type === type ? effect : undefined;

describe('cross: a loc op move', () => {
    test("sends the act's op on the loc found by its config id, and is crossed on a landing", async () => {
        const { result, sends } = await run(gateMove, base.build(), { react: reactTo('interactLoc', moveTo(LANDING)) });
        expect(result).toEqual({ ok: true, at: LANDING, attempts: 1 });
        expect(sends).toEqual([
            { type: 'interactLoc', x: 2459, z: 3383, locId: GATE_ID, optionIndex: 1, reason: 'Open Gate' },
        ]);
    });

    test('a move that never comes is no-move after its wait; one the server discards is refused', async () => {
        const still = await run(gateMove, base.build());
        expect(still.result).toMatchObject({ ok: false, reason: 'no-move' });
        expect(still.driver.state().tick).toBe(crossWaitTicks(gateMove));
        const rejected = await run(gateMove, base.build(), {
            react: reactTo('interactLoc', s => ({
                ...s,
                opFeedback: {
                    mapFlagUnsetCount: 1,
                    lastMapFlagUnsetTick: 1,
                    opRejectedCount: 1,
                    lastOpRejectedTick: 1,
                },
            })),
        });
        expect(rejected.result).toMatchObject({
            ok: false,
            reason: 'refused',
            message: expect.stringMatching(/discarded/),
        });
    });

    test("a refusal message ends it at once: obstacle.ts's, the can't-reach, a refusal", async () => {
        for (const said of [
            'You can not do that from here.',
            "I can't reach that!",
            'You need an Agility level of 50.',
        ]) {
            const { result, driver } = await run(gateMove, base.build(), {
                react: reactTo(
                    'interactLoc',
                    change(w => w.message(said)),
                ),
            });
            expect(result).toEqual({ ok: false, reason: 'refused', message: expect.stringContaining(said) });
            expect(driver.state().tick).toBe(1);
        }
    });

    test('no loc in sight, after a scan: no-target, nothing sent', async () => {
        const { result, sends, driver } = await run(gateMove, world().player({ at: STAND }).build());
        expect(result).toMatchObject({ ok: false, reason: 'no-target' });
        expect(sends).toEqual([]);
        expect(driver.commands.some(c => c.type === 'scan')).toBe(true);
    });
});

describe('cross: dialogue choices', () => {
    const POSTER = "Yeah, that poster doesn't scare me!";
    const pass: Move = { ...gateMove, act: { kind: 'loc-op', loc: 'gnome_areagate', op: 1, choices: [POSTER] } };

    test("the row's choice is clicked when shown, and the move goes on", async () => {
        const { result, sends } = await run(pass, base.build(), {
            react: a =>
                a.type === 'interactLoc'
                    ? asks(['No thanks.', POSTER])
                    : a.type === 'clickDialogOption'
                      ? s => moveTo(LANDING)({ ...s, dialog: { isOpen: false, options: [], isWaiting: false } })
                      : undefined,
        });
        expect(result).toMatchObject({ ok: true, at: LANDING });
        expect(sends[1]).toEqual({ type: 'clickDialogOption', optionIndex: 1, reason: POSTER });
    });

    test('a choice the row does not answer is refused with its text, not waited out', async () => {
        const { result, driver } = await run(gateMove, base.build(), {
            react: reactTo('interactLoc', asks(['Sure, I will help.', "Sorry, I'm a bit busy."])),
        });
        expect(result).toEqual({
            ok: false,
            reason: 'refused',
            message: expect.stringContaining("Sure, I will help. / Sorry, I'm a bit busy."),
        });
        expect(driver.state().tick).toBeLessThan(crossWaitTicks(gateMove));
    });
});

describe('cross: teleports', () => {
    test('a talisman used on the ruins: useItemOnLoc with its slot, crossed on the landing', async () => {
        const ruins: Move = {
            via: 'teleport',
            act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
            at: tile(2984, 3291),
            landings: [tile(2841, 4830)],
            source: 'runecraft.rs2:45',
        };
        const id = configId('loc', 'airtemple_ruined')!;
        const at = world()
            .player({ at: { x: 2984, z: 3289 } })
            .inv('Bronze axe')
            .inv('Air talisman')
            .loc('Mysterious ruins', 2984, 3291, { id });
        const { result, sends } = await run(ruins, at.build(), {
            react: reactTo('useItemOnLoc', moveTo(tile(2841, 4830))),
        });
        expect(result).toMatchObject({ ok: true, at: tile(2841, 4830) });
        expect(sends).toEqual([
            {
                type: 'useItemOnLoc',
                itemSlot: 1,
                x: 2984,
                z: 3291,
                locId: id,
                reason: 'use Air talisman on Mysterious ruins',
            },
        ]);
        expect(Items.AIR_TALISMAN).toBe(configId('obj', 'air_talisman')!);
        const without = await run(ruins, world(at.build()).inv('Air talisman', 0).build());
        expect(without.result).toMatchObject({ ok: false, reason: 'no-item' });
        expect(without.sends).toEqual([]);
    });

    test("an npc's op, by its config id; a random landing off the row's list still counts once it has moved far", async () => {
        const wizard: Move = {
            via: 'teleport',
            act: { kind: 'npc-op', npc: 'aubury', op: 4 },
            at: tile(3253, 3402),
            landings: [tile(2911, 4832)],
            source: 'essence_mine.rs2:25',
        };
        const at = world()
            .player({ at: { x: 3253, z: 3400 } })
            .npc('Aubury', 3253, 3402, { id: configId('npc', 'aubury')!, options: ['Talk-to', 'Trade', 'Teleport'] });
        const { result, sends } = await run(wizard, at.build(), {
            react: reactTo('interactNpc', moveTo(tile(2930, 4820))),
        });
        expect(result).toMatchObject({ ok: true, at: tile(2930, 4820) });
        expect(sends[0]).toMatchObject({ type: 'interactNpc', optionIndex: 4 });
    });
});

describe('cross: rolled moves', () => {
    const shortcut: Move = {
        ...gateMove,
        via: 'gate',
        roll: { stat: 'agility', low: 50, high: 250, source: 'a.rs2:2', fail: { ticks: 3, damage: 2 } },
    };
    test('a failed roll is tried again while retry holds, and counts its attempts', async () => {
        const { result, sends } = await run(shortcut, base.build(), { react: fallsUntil(3) }, () => true);
        expect(result).toEqual({ ok: true, at: LANDING, attempts: 3 });
        expect(sends).toHaveLength(3);
    });

    test('a failed roll the plan no longer prices as the better way is fell, not tried again', async () => {
        const { result, sends } = await run(shortcut, base.build(), { react: fallsUntil(3) }, () => false);
        expect(result).toMatchObject({ ok: false, reason: 'fell', message: expect.stringMatching(/slip/) });
        expect(sends).toHaveLength(1);
    });

    test('a fall onto the fail tile counts as one without a message; the attempts are bounded', async () => {
        const away = tile(2461, 3378);
        const toBank: Move = { ...shortcut, roll: { ...shortcut.roll!, fail: { ...shortcut.roll!.fail, to: away } } };
        const { result, sends } = await run(
            toBank,
            base.build(),
            { react: reactTo('interactLoc', moveTo(away)) },
            () => true,
        );
        expect(result).toMatchObject({ ok: false, reason: 'fell', message: expect.stringMatching(/fail tile/) });
        expect(sends).toHaveLength(CROSS_MAX_ATTEMPTS);
    });
});
