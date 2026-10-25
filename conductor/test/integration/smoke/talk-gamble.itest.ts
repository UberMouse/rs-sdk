import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Death Plateau, stage 50 (Harold given the ale): Harold's bedroom above the Toad and Chicken inn, Burthorpe. The
// gamble is a coin flip (Harold wins ties: the player wins 15 times in 36), so the test plays games with the
// plan's bets until one wins the IOU: Harold's gold is 100 plus what he has won off us, and a win beats it, and
// so earns the IOU, once the bet is larger (death_guard_equiproom.rs2). Each game is its own `talk` run.
const START_COINS = 5000;
const HAROLD_START_GOLD = 100;
const MAX_BET = 1000;
const GAMES = 10;
/** One game is a talk run: about 20 s of play plus the client's connect and the RESULT. */
const GAME_BUDGET_MS = 45_000;
// varps: death_equiproom (314) = 50 (given_ale); death_bits (316): Harold's gold in bits 9-23.
const VARPS = { 314: 50, 316: HAROLD_START_GOLD << 9 };

test(
    'talk bets with Harold and rolls the dice until the IOU is won',
    async () => {
        await withFixtureBot(
            {
                position: { x: 2906, z: 3541, level: 1 },
                skills: { Attack: 40, Strength: 54, Defence: 40, Hitpoints: 47 },
                inventory: [{ id: 995, count: START_COINS }],
                varps: VARPS,
            },
            async ({ name }) => {
                let coins = START_COINS;
                let iou = false;
                const games: string[] = [];
                for (let game = 0; game < GAMES && !iou; game++) {
                    const bet = Math.min(MAX_BET, HAROLD_START_GOLD + (START_COINS - coins) + 1);
                    const run = await runTask(
                        name,
                        'talk',
                        {
                            npc: 'Harold',
                            choices: ['gamble'],
                            amount: bet,
                            press: { component: 'death_dice:com_28', ready: 'Your roll', until: 'You (win|lose)' },
                        },
                        ['minutes:2'],
                    );
                    const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                    expect(run.result.status, detail).toBe('done');
                    const won = run.result.reason.includes('You win!');
                    expect(run.result.reason, detail).toContain(won ? 'You win!' : 'You lose!');
                    const delta = run.result.inventoryDelta['Coins'] ?? 0;
                    iou = (run.result.inventoryDelta['Iou'] ?? 0) === 1;
                    // A win pays the bet, or all Harold has left when the bet is larger; a loss costs the bet.
                    if (won) expect(delta, detail).toBeGreaterThan(0);
                    else expect(delta, detail).toBe(-bet);
                    // The IOU comes exactly with a win over Harold's gold.
                    expect(iou, detail).toBe(won && bet > HAROLD_START_GOLD + (START_COINS - coins));
                    coins += delta;
                    games.push(`${bet}:${won ? 'win' : 'lose'}`);
                }
                expect(iou, `no IOU in ${GAMES} games: ${games.join(' ')}`).toBe(true);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2, extraMs: GAMES * GAME_BUDGET_MS }),
);
