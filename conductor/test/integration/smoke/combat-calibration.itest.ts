// The damage calibration (conductor/docs/world-index-phase4-spec.md, Task 8): a fixture bot fights the Edgeville
// dungeon's hill giants with the combat task as the hill-giants plan runs it, and the kills in its recording
// (conductor/tools/combat-ledger.ts) are set beside the world index's model at the same profile (killFigures). It
// prints a RESULT line of each: damage, fight ticks (first swing to killing swing), whole-kill ticks and the gap
// between kills, the last two reported only. run.ts gives a file 10 minutes, so a run stops at 7 and gets a dozen-odd
// kills; the calibration pools several runs' recordings (`bun conductor/tools/combat-ledger.ts <recordings>... --npc
// Giant`).
// Each run's RESULT lines are also written to <runId>.calibration.ndjson beside its log. Damage and fight ticks that
// agree within CALIBRATION_TOLERANCE are copied into wiki/world/methods.ts CALIBRATIONS by hand. The 25% model gate
// lives on the pooled record (wiki/world/test/combat-method.real.test.ts): a single run's standard error (~0.9 HP on
// damage) is too wide to carry it. A run instead has to be consistent with the giant's record, within 3 combined
// standard errors on damage and on fight ticks (consistentWithRecord), so a game or engine change that moves the
// figures fails here. The model-vs-run agreement is printed, not asserted.
//
// The profile is the record's (RUN, read from CALIBRATIONS). The fixture's weapon and food ids and the task's params
// name its gear, skill and loot by hand, so the file throws when the record moves off them. It is Defence 1 and no
// armour, so most of the giant's swings hit and the damage a kill is large enough to measure; combat level 92, over the giants' hunt cutoff (56), so no second giant joins between kills. Strength,
// Hitpoints and Prayer, the skills the run trains, at 99: the local XP table levels them every few kills below it,
// which would move the max hit off the modelled profile, and a level-up's dialog interrupts the fight. A mithril
// scimitar on Strength (aggressive, which trains neither Attack nor Defence), as the plan; lobsters, more than the
// kills need.
import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { CALIBRATIONS } from '../../../../wiki/world/methods';
import { reachCollision } from '../../../../wiki/world/collision';
import { loadWorld } from '../../../../wiki/world/load';
import { readGameData } from '../../../../wiki/world/model/families/index';
import { legFinder } from '../../../../wiki/world/model/legs';
import {
    agrees,
    calibrationMethod,
    calibrationProfile,
    type CalibrationRun,
    killFigures,
    methodModel,
    resolveMethod,
} from '../../../../wiki/world/model/method';
import { locSizes } from '../../../../wiki/world/place';
import { reachGraph } from '../../../../wiki/world/reach';
import { questFacts } from '../../../../wiki/world/requirements';
import { readConfigs } from '../../../../wiki/world/sources/configs';
import { recordingFile } from '../../../core/drivers/recording';
import { consistentWithRecord, recordingLedger } from '../../../tools/combat-ledger';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

const GIANTS = { x: 3107, z: 9834 };
const WEAPON_SLOT = 3;
const MITHRIL_SCIMITAR = 1329;
const LOBSTER = 379;
/** Every free slot but one, which a big bone takes between its pickup and its bury. */
const LOBSTERS = 27;
const MIN_KILLS = 8;
const MINUTES = 7;

/** The hill giant's calibration record in wiki/world/methods.ts: the run repeats its profile. */
const CALIBRATION = CALIBRATIONS.find(c => c.npc === 'giant');
if (!CALIBRATION) throw new Error('wiki/world/methods.ts CALIBRATIONS has no hill giant (npc giant) record');
/** The run's profile, the record's. */
const RUN: CalibrationRun = {
    npc: CALIBRATION.npc,
    at: CALIBRATION.at,
    area: CALIBRATION.area,
    levels: CALIBRATION.levels,
    worn: CALIBRATION.worn,
    skill: CALIBRATION.skill,
    food: CALIBRATION.food,
    loot: CALIBRATION.loot,
};
// The fixture's weapon and food ids and the task's params below name these: a record on other gear needs them changed.
if (
    JSON.stringify(RUN.worn) !== '["mithril_scimitar"]' ||
    RUN.food !== 'lobster' ||
    RUN.skill !== 'strength' ||
    RUN.loot.bones !== 'bury'
)
    throw new Error(`the hill giant record's gear, skill or loot moved off the smoke's: ${JSON.stringify(RUN)}`);

/** The model's figures for RUN: the world index resolved over the committed world.json. */
function modelled() {
    const world = loadWorld();
    const model = methodModel(readGameData());
    const ctx = { world, ...model, quests: questFacts(world.quests) };
    const legs = legFinder(
        reachGraph({ world, collision: reachCollision, size: locSizes(readConfigs('loc')) }),
        world.crossings,
    );
    const m = resolveMethod(calibrationMethod(RUN), ctx, legs);
    return killFigures(m, calibrationProfile(RUN, model.tools), ctx, RUN.skill);
}

test(
    'hill giant kills: damage and fight ticks per kill beside the model',
    async () => {
        const model = modelled();
        await withFixtureBot(
            {
                position: GIANTS,
                skills: Object.fromEntries(Object.entries(RUN.levels).filter(([, l]) => l !== undefined)),
                equipment: [{ id: MITHRIL_SCIMITAR, count: 1, slot: WEAPON_SLOT }],
                inventory: Array.from({ length: LOBSTERS }, () => ({ id: LOBSTER, count: 1 })),
            },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'combat',
                    {
                        target: 'Giant',
                        skill: 'Strength',
                        weapon: 'Mithril scimitar',
                        food: ['Lobster'],
                        eatBelow: 0.5,
                        buryBones: true,
                        area: { ...GIANTS, radius: 12 },
                    },
                    [`minutes:${MINUTES}`],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr.split('\n').slice(-40).join('\n')}`;
                const ledger = recordingLedger(recordingFile(run.result.logFile), { npc: 'Giant', food: ['Lobster'] });
                const { perKill } = ledger;
                // The gate's figures: damage and fight ticks a kill. Whole-kill ticks and the gap are reported only.
                const agreement = {
                    damage: agrees(model.damage, perKill.damage.mean),
                    fight: agrees(model.fight, perKill.fight.mean),
                };
                const record = CALIBRATION.measured;
                const consistent = {
                    damage: consistentWithRecord(perKill.damage, { mean: record.damage, se: record.damageSe }),
                    fight: consistentWithRecord(perKill.fight, { mean: record.fight, se: record.fightSe }),
                };
                const lines = [
                    {
                        measured: perKill,
                        npcHitsplats: ledger.npcHitsplats,
                        unattributed: ledger.unattributed,
                        run: `${name}/${run.result.runId}`,
                    },
                    { model, agreement, consistent, status: run.result.status },
                ].map(o => `RESULT ${JSON.stringify(o)}`);
                // run.ts shows a passing file's output to no one: the lines go beside the run's log too.
                writeFileSync(run.result.logFile.replace(/\.ndjson$/, '.calibration.ndjson'), lines.join('\n') + '\n');
                for (const line of lines) console.log(line);
                expect(perKill.kills, detail).toBeGreaterThanOrEqual(MIN_KILLS);
                // Fewer than two kills leave no standard error: nothing to judge (MIN_KILLS above already fails that).
                if (consistent.damage === null || consistent.fight === null)
                    console.log('no standard error on this run: record consistency not asserted');
                else expect(consistent, detail).toEqual({ damage: true, fight: true });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: MINUTES, extraMs: 120_000 }),
);
