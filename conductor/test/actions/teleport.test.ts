import { describe, expect, test } from 'bun:test';
import { atDestination, castTeleport, missingRunes, TELEPORT_WAIT_TICKS, TELEPORTS } from '../../actions/teleport';
import { world } from '../world';
import { refuse, runOp } from './harness';

const spell = TELEPORTS.lumbridge;
const base = world()
    .player({ at: { x: 3012, z: 3355 } })
    .skill('Magic', 31, 0)
    .inv('Air rune', 3)
    .inv('Earth rune', 1)
    .inv('Law rune', 1);
const run = (states: ReturnType<typeof base.series>, opts = {}) => runOp(states, ctx => castTeleport(ctx, spell), opts);
const arrived = (w: typeof base) => w.skill('Magic', 31, 410).player({ at: { x: 3222, z: 3219 } });

describe('castTeleport', () => {
    test('clicks the spell component once and succeeds on XP plus arrival', async () => {
        const { result, sends } = await run(base.series(10, (w, i) => (i >= 3 ? arrived(w) : w)));
        expect(result).toEqual({ ok: true, xpGained: 410 });
        expect(sends).toEqual([{ type: 'clickComponent', componentId: 1167, reason: 'cast Lumbridge Teleport' }]);
    });

    test('XP before the cast is no evidence', async () => {
        const { result } = await run(base.skill('Magic', 31, 410).series(1));
        expect(result).toMatchObject({ ok: false, reason: 'no-teleport' });
    });

    test('arrival without XP is not success', async () => {
        const { result } = await run(base.series(10, (w, i) => (i >= 3 ? w.player({ at: { x: 3222, z: 3219 } }) : w)));
        expect(result).toMatchObject({ ok: false, reason: 'no-teleport' });
    });

    test('a quiet wait ends no-teleport after its tick budget', async () => {
        const { result, driver } = await run(base.series(1));
        expect(result).toMatchObject({ ok: false, reason: 'no-teleport' });
        expect(driver.state().tick).toBe(TELEPORT_WAIT_TICKS);
    });

    test("the server's refusals map to reasons, and old messages are ignored", async () => {
        const cases: [string, 'no-runes' | 'level' | 'wilderness' | 'refused'][] = [
            ['You do not have enough Law Runes to cast this spell.', 'no-runes'],
            ['Your Magic level is not high enough for this spell.', 'level'],
            ['A mysterious force blocks your teleport spell!', 'wilderness'],
            ['You need to have completed the Watchtower Quest to use this spell.', 'refused'],
            ["You haven't learnt how to cast this spell yet.", 'refused'],
        ];
        for (const [msg, reason] of cases) {
            const { result } = await run([base.build(), base.tick(2).message(msg).build()]);
            expect(result).toEqual({ ok: false, reason, message: msg });
        }
        const old = base.message('A mysterious force blocks your teleport spell!').tick(1);
        const { result } = await run(old.series(1));
        expect(result).toMatchObject({ ok: false, reason: 'no-teleport' });
    });

    test('dialog-page refusals map to refused; an unrelated message does not', async () => {
        const msg = "Water and magic don't mix!";
        const { result } = await run([
            base.build(),
            base.tick(2).recentDialog([msg, "You can't teleport whilst swimming."]).build(),
        ]);
        expect(result).toMatchObject({ ok: false, reason: 'refused' });
        const other = 'You have completed the first stage of something.';
        const { result: r2 } = await run([
            base.build(),
            base.tick(2).message(other).build(),
            arrived(base.tick(3)).build(),
        ]);
        expect(r2).toMatchObject({ ok: true });
    });

    test('a refused send is send-failed', async () => {
        const { result } = await run(base.series(1), { respond: refuse });
        expect(result).toEqual({ ok: false, reason: 'send-failed', message: 'not connected' });
    });
});

describe('teleport helpers', () => {
    test('missingRunes counts the shortfall, and a matching worn staff covers its rune', () => {
        expect(missingRunes(base.build(), spell)).toEqual([]);
        expect(missingRunes(base.inv('Air rune', 1).build(), spell)).toEqual(['2 more Air rune']);
        const staffed = base.inv('Earth rune', 0).equipment({ name: 'Mystic lava staff', id: 6562 }).build();
        expect(missingRunes(staffed, spell)).toEqual([]);
    });

    test('atDestination is within 3 tiles on the same plane', () => {
        expect(atDestination(base.player({ at: { x: 3224, z: 3215 } }).build(), spell)).toBe(true);
        expect(atDestination(base.player({ at: { x: 3225, z: 3218 } }).build(), spell)).toBe(false);
        expect(atDestination(base.player({ at: { x: 3221, z: 3218, level: 1 } }).build(), spell)).toBe(false);
    });
});
