import { describe, expect, test } from 'bun:test';
import { closableInterface, DEATH_DICE_INTERFACE } from '../../actions/dismiss';
import { PRESS_CLICK_LIMIT, PRESS_EFFECT_TICKS } from '../../actions/press';
import talk from '../../tasks/talk';
import { diceGame, type DiceOptions, ROLL_BUTTON, withDice } from '../dice';
import { simulate } from '../simulate';
import { world } from '../world';

const harold = world().npcBeside('Harold', { options: ['Talk-to'] });
const PRESS = { component: 'death_dice:com_28', ready: 'Your roll', until: 'You (win|lose)' };
const params = { npc: 'Harold', choices: ['gamble'], amount: 101, press: PRESS };
const CUT_TICK = 30;
const sentTypes = (sends: { type: string }[]) => sends.map(a => a.type);

async function play(opts: DiceOptions = {}, p: unknown = params) {
    const game = diceGame(opts);
    const r = await simulate(talk, { params: p, timeline: harold.series(120), react: game.react });
    const sends = r.driver.commands.flatMap(c => (c.type === 'send' ? [c.action] : []));
    return { r, game, sends };
}

describe('talk: amount and press (Harold dice)', () => {
    test('answers the prompt, waits for the live button, rolls once, closes the table', async () => {
        const { r, game, sends } = await play({ win: true });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(
            'talk: talked to Harold, 1 choice made, amount 101, death_dice:com_28: "You win!"',
        );
        expect(game.log.amounts).toEqual([101]);
        expect(game.log.clicks).toHaveLength(1);
        expect(game.log.closes).toBe(1);
        expect(
            sentTypes(sends).filter(t => t === 'submitCountDialog' || t === 'clickComponent' || t === 'closeModal'),
        ).toEqual(['submitCountDialog', 'clickComponent', 'closeModal']);
        expect(r.steps).toEqual(['talk']);
    });

    test('the click waits for the "Your roll" caption: a hidden button drops it', async () => {
        const slow = await play({ readyAfter: 9 });
        const quick = await play({ readyAfter: 0 });
        expect(slow.game.log.clicks).toHaveLength(1);
        expect(slow.game.log.clicks[0]! - quick.game.log.clicks[0]!).toBeGreaterThanOrEqual(8);
    });

    test('a lost roll is done too (the plan reads the coins, not this result)', async () => {
        const { r } = await play({ win: false });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('"You lose!"');
    });

    test('pages between the amount and the table are clicked through', async () => {
        const { r, game } = await play({ win: true, betPages: 2 });
        expect(r.result.status).toBe('done');
        expect(game.log.clicks).toHaveLength(1);
    });

    test('a click the game ignores is repeated once, then the table is closed and the run fails', async () => {
        const { r, game } = await play({ deadRoll: true });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe(
            `talk: bet of 101 was placed and the stake may be forfeited: ${PRESS_CLICK_LIMIT} clicks on death_dice:com_28 showed no text matching /You (win|lose)/i`,
        );
        expect(game.log.clicks).toHaveLength(PRESS_CLICK_LIMIT);
        expect(game.log.closes).toBe(1);
        expect(PRESS_EFFECT_TICKS).toBeGreaterThan(4);
    });

    test('one ignored click is retried and the roll still lands', async () => {
        const { r, game } = await play({ win: true, ignoreClicks: 1 });
        expect(r.result.status).toBe('done');
        expect(game.log.clicks).toHaveLength(2);
    });

    test('a table that never opens fails after the wait, with nothing clicked', async () => {
        const { r, game } = await play({ noTable: true });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^talk: bet of 101 was placed and the stake may be forfeited: the interface of death_dice:com_28 did not open within \d+ ticks$/,
        );
        expect(game.log.clicks).toHaveLength(0);
    });

    test('a roll button that never goes live fails saying the bet stands', async () => {
        const { r, game } = await play({ readyAfter: 100 });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toMatch(
            /^talk: bet of 101 was placed and the stake may be forfeited: no text matching .* within \d+ ticks$/,
        );
        expect(game.log.clicks).toHaveLength(0);
        expect(game.log.closes).toBe(1);
    });

    test('a step cut off after the click resumes at the closing pages without pressing again', async () => {
        const game = diceGame({ win: true });
        const r = await simulate(talk, {
            params,
            timeline: harold
                .inv('Shrimps', 1)
                .series(160, (w, i) => w.player({ hp: i >= CUT_TICK && i < CUT_TICK + 3 ? 3 : 10 })),
            react: game.react,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(
            'talk: talked to Harold, 1 choice made, press resumed after a cut-off; outcome unread (bet 101 may be forfeited or played)',
        );
        expect(r.result.stepRuns['interrupt:low-hp']).toBe(1);
        expect(game.log.amounts).toEqual([101]);
        expect(game.log.clicks).toHaveLength(1);
    });

    test('a refused prompt answer fails with its message', async () => {
        const game = diceGame();
        const r = await simulate(talk, {
            params,
            timeline: harold.series(60),
            react: game.react,
            respond: a =>
                a.type === 'submitCountDialog'
                    ? { success: false, message: 'Timeout waiting for count dialog' }
                    : undefined,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('talk: the amount prompt was not answered: Timeout waiting for count dialog');
    });

    test('amount alone answers the prompt and passes the pages after it', async () => {
        const { r, game } = await play({ betPages: 1 }, { npc: 'Harold', choices: ['gamble'], amount: 5 });
        // No press: the table (opened by the game) is left for the next run's leftover close.
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe('talked to Harold, 1 choice made, amount 5'.replace(/^/, 'talk: '));
        expect(game.log.amounts).toEqual([5]);
        expect(game.log.clicks).toHaveLength(0);
    });

    test('a stop during the roll closes the table', async () => {
        const game = diceGame({ readyAfter: 30 });
        const r = await simulate(talk, {
            params,
            timeline: harold.series(120),
            react: game.react,
            externalStop: s => (s.tick >= 22 ? 'stopped' : null),
        });
        expect(r.result.reason).toBe('stopped');
        expect(game.log.closes).toBe(1);
        expect(game.log.clicks).toHaveLength(0);
    });

    test('the dice table is an op-owned interface: no guard or leftover close counts it closable', () => {
        const open = withDice(world().build(), 'Your roll...');
        expect(open.interface.interfaceId).toBe(DEATH_DICE_INTERFACE);
        expect(closableInterface(open)).toBe(false);
        expect(ROLL_BUTTON).toBeGreaterThan(0);
    });
});

describe('talk: amount and press params', () => {
    test('an unknown component is refused before anything is sent', async () => {
        const res = (
            await simulate(talk, {
                params: { ...params, press: { ...PRESS, component: 'death_dice:com_9999' } },
                timeline: harold.series(5),
            })
        ).result;
        expect(res.status).toBe('failed');
        expect(res.reason).toContain('death_dice:com_9999 is not a component in interface.pack');
    });

    test('press and amount need an npc and exclude travels', () => {
        expect(talk.params.safeParse({ continue: true, amount: 5 }).success).toBe(false);
        expect(talk.params.safeParse({ ...params, travels: true }).success).toBe(false);
        expect(talk.params.safeParse({ npc: 'Harold', press: { component: 'bad name', until: 'x' } }).success).toBe(
            false,
        );
        expect(talk.params.safeParse({ npc: 'Harold', amount: 0 }).success).toBe(false);
        expect(talk.params.safeParse({ npc: 'Harold', amount: 1001 }).success).toBe(false);
        expect(talk.params.safeParse({ npc: 'Harold', amount: 1000 }).success).toBe(true);
        expect(talk.params.safeParse(params).success).toBe(true);
    });
});
