import { resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { Items } from '../../../../sdk/test/utils/save-generator';
import { StateDecoder, readRecording, recordingFile } from '../../../core/drivers/recording';
import { TICK_MS } from '../../../lib/util';
import { REPO_ROOT } from '../../../lib/env';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Inside the Lumbridge chicken coop: the verified spot in the combat task description.
const COOP = { x: 3231, z: 3295 };
const AREA = { x: COOP.x, z: COOP.z, radius: 8 };

test(
    'combat task kills chickens until the Attack XP target',
    async () => {
        await withFixtureBot(
            { position: COOP },
            async ({ name }) => {
                const run = await runTask(name, 'combat', { target: 'Chicken', skill: 'Attack', area: AREA }, [
                    'xp:Attack:1',
                    'minutes:3',
                ]);
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Attack, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'combat targetRange visible kills chickens in view beyond a tiny area',
    async () => {
        await withFixtureBot(
            { position: COOP },
            async ({ name }) => {
                // Radius 2 around the coop's west end: most of the coop's chickens stand outside it.
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Chicken',
                        skill: 'Attack',
                        targetRange: 'visible',
                        area: { x: COOP.x - 3, z: COOP.z, radius: 2 },
                    },
                    ['xp:Attack:100', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Attack, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'combat with chickens in view outside a tiny area idles and warns, naming the nearest one',
    async () => {
        await withFixtureBot(
            { position: COOP },
            async ({ name }) => {
                // Radius 2 at the coop's west fence: the coop's chickens stand in view, mostly beyond it. One may wander in
                // and be killed, so the run ends done at the stop or failed after twenty empty looks, either way idle first.
                const run = await runTask(
                    name,
                    'combat',
                    { target: 'Chicken', skill: 'Attack', area: { x: COOP.x - 6, z: COOP.z, radius: 2 } },
                    ['minutes:1'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(['done', 'failed'], detail).toContain(run.result.status);
                expect(run.result.diagnostics?.idleTicks, detail).toBeGreaterThan(0);
                expect(run.result.diagnostics?.seenOutsideAreaTicks, detail).toBeGreaterThan(0);
                expect(run.result.warnings?.[0], detail).toContain('seenOutsideArea');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

test(
    'combat task shoots chickens with a wielded bow and arrows until the Ranged XP target',
    async () => {
        await withFixtureBot(
            {
                position: COOP,
                inventory: [
                    { id: Items.SHORTBOW, count: 1 },
                    { id: Items.BRONZE_ARROW, count: 100 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Chicken',
                        skill: 'Ranged',
                        area: AREA,
                        weapon: 'Shortbow',
                        ammo: 'Bronze arrow',
                        loot: ['Bronze arrow'],
                    },
                    ['xp:Ranged:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Ranged, detail).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'combat task casts Wind Strike at chickens with inventory runes until the Magic XP target',
    async () => {
        await withFixtureBot(
            {
                position: COOP,
                inventory: [
                    { id: Items.AIR_RUNE, count: 50 },
                    { id: Items.MIND_RUNE, count: 50 },
                ],
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    { target: 'Chicken', skill: 'Magic', spell: 'Wind Strike', area: AREA },
                    ['xp:Magic:1', 'minutes:3'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Magic, detail).toBeGreaterThan(0);
                expect(run.result.inventoryDelta['Air rune'], detail).toBeLessThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'a stop that lands mid-fight ends after the fight settles, and the next run starts',
    async () => {
        await withFixtureBot(
            // Strength 1 hits a chicken (3 hp) for at most 1, 100 Attack XP a hit at the local stack's XP rate
            // (25): the stop needs a second hit, so it lands with the chicken alive and in the fight.
            { position: COOP, skills: { Attack: 20, Strength: 1 } },
            async ({ name }) => {
                const params = { target: 'Chicken', skill: 'Attack', area: AREA };
                const first = await runTask(name, 'combat', params, ['xp:Attack:150', 'minutes:3']);
                const detail = `${JSON.stringify(first.result)}\n${first.stderr}`;
                expect(first.result.status, detail).toBe('done');
                const settled = /^reached \+150 attack xp; fight settled in (\d+) ticks$/i.exec(first.result.reason);
                expect(settled, detail).not.toBeNull();
                expect(first.result.durationMs, detail).toBeGreaterThan(Number(settled![1]) * TICK_MS);

                const second = await runTask(name, 'combat', params, ['xp:Attack:1', 'minutes:3']);
                const again = `${JSON.stringify(second.result)}\n${second.stderr}`;
                expect(second.result.status, again).toBe('done');
                expect(second.result.xpGained.Attack, again).toBeGreaterThan(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);

// Quest fights. Same loadout as the library saves merlin-mordred and pip-monks: Att/Str/Def/HP 40, Prayer 43, a
// rune mace and adamant armour worn, 8 lobsters.
const QUEST_FIGHTER = {
    skills: { Attack: 40, Strength: 40, Defence: 40, Hitpoints: 40, Prayer: 43 },
    inventory: Array.from({ length: 8 }, () => ({ id: 379, count: 1 })),
    equipment: [
        { id: 1432, count: 1, slot: 3 }, // Rune mace
        { id: 1161, count: 1, slot: 0 }, // Adamant full helm
        { id: 1123, count: 1, slot: 4 }, // Adamant platebody
        { id: 1073, count: 1, slot: 7 }, // Adamant platelegs
        { id: 1199, count: 1, slot: 5 }, // Adamant kite shield
    ],
};

test(
    "combat stopOnDialog beats Sir Mordred and ends with Morgan Le Faye's choice open, unanswered",
    async () => {
        await withFixtureBot(
            { position: { x: 2769, z: 3401, level: 2 }, ...QUEST_FIGHTER, varps: { 14: 3 } },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Sir Mordred',
                        skill: 'Strength',
                        area: { x: 2769, z: 3403, level: 2, radius: 4 },
                        food: ['Lobster'],
                        stopOnDialog: true,
                        // An earlier run's Mordred may still be down (50-tick respawn).
                        respawnWaitTicks: 150,
                    },
                    ['minutes:5'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.reason, detail).toMatch(/^dialog-open: dialog opened:/);
                expect(run.result.xpGained.Strength, detail).toBeGreaterThan(0);
                // The dialog guard stayed out: nothing answered Morgan's choice.
                expect(run.result.stepRuns['interrupt:dialog'], detail).toBeUndefined();

                const talk = await runTask(
                    name,
                    'talk',
                    // The run returned at once, still under Mordred's attack: the open dialog is answered with `continue`.
                    { continue: true, choices: ['Tell me how to untrap Merlin', 'OK I will go do all that'] },
                    ['minutes:2'],
                );
                const talked = `${JSON.stringify(talk.result)}\n${talk.stderr}`;
                expect(talk.result.status, talked).toBe('done');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 8 }),
);

/** The combat levels of the NPCs the run attacked (resolved on the state each attack was sent on), and the prayers on at its end. */
function attacksAndPrayers(logFile: string) {
    const decoder = new StateDecoder();
    let state: ReturnType<StateDecoder['decode']> | undefined;
    const attacked: { name: string; combatLevel: number }[] = [];
    for (const rec of readRecording(recordingFile(resolve(REPO_ROOT, logFile))).records) {
        if (rec.k === 'p') state = decoder.decode(rec.d, rec.x);
        else if (rec.k === 'c' && rec.cmd.type === 'send' && rec.cmd.action.type === 'interactNpc' && state) {
            const { npcIndex } = rec.cmd.action;
            const npc = state.nearbyNpcs.find(n => n.index === npcIndex);
            attacked.push({ name: npc?.name ?? `npc ${npcIndex} not in view`, combatLevel: npc?.combatLevel ?? -1 });
        }
    }
    const prayersOn = (state?.prayers.activePrayers ?? []).flatMap((on, i) => (on ? [i] : []));
    return { attacked, prayersOn };
}

test(
    'combat level 30 attacks only the level-30 Monk of Zamorak, with Protect from Melee held and dropped',
    async () => {
        await withFixtureBot(
            { position: { x: 3413, z: 3488 }, ...QUEST_FIGHTER, varps: { 302: 4 } },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Monk of Zamorak',
                        level: 30,
                        skill: 'Strength',
                        area: { x: 3413, z: 3488, radius: 6 },
                        food: ['Lobster'],
                        prayers: ['Protect from Melee'],
                        // The temple is shared with other runs: a level-30 monk may be down for a while.
                        respawnWaitTicks: 300,
                    },
                    ['xp:Strength:150', 'minutes:5'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.xpGained.Strength, detail).toBeGreaterThan(0);
                expect(run.result.stepRuns['prayer-on'], detail).toBeGreaterThan(0);
                const { attacked, prayersOn } = attacksAndPrayers(run.result.logFile);
                expect(attacked.length, detail).toBeGreaterThan(0);
                for (const a of attacked) expect(a, detail).toEqual({ name: 'Monk of Zamorak', combatLevel: 30 });
                // The prayer held through the fight is dropped again at the end.
                expect(prayersOn, detail).toEqual([]);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);
