// The damage calibration (conductor/docs/world-index-phase4-spec.md, Task 8): a fixture bot fights the Edgeville
// dungeon's hill giants with the combat task as the hill-giants plan runs it, and the kills in its recording
// (conductor/tools/combat-ledger.ts) are set beside the world index's model at the same profile (killFigures). It
// prints a RESULT line of each. run.ts gives a file 10 minutes, so a run stops at 7 and gets a dozen-odd kills; the
// calibration pools several runs' recordings (`bun conductor/tools/combat-ledger.ts <recordings>... --npc Giant`).
// Each run's RESULT lines are also written to <runId>.calibration.ndjson beside its log. Figures that agree within
// CALIBRATION_TOLERANCE are copied into wiki/world/methods.ts CALIBRATIONS by hand; once the giant is calibrated, the
// model must still agree with each run.
//
// The profile: Defence 1 and no armour, so most of the giant's swings hit and the damage a kill is large enough to
// measure; combat level 92, over the giants' hunt cutoff (56), so no second giant joins between kills. Strength,
// Hitpoints and Prayer, the skills the run trains, at 99: the local XP table levels them every few kills below it,
// which would move the max hit off the modelled profile, and a level-up's dialog interrupts the fight. A mithril
// scimitar on Strength (aggressive, which trains neither Attack nor Defence), as the plan; lobsters, more than the
// kills need.
import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { reachCollision } from '../../../../wiki/world/collision';
import { loadWorld } from '../../../../wiki/world/load';
import { readGameData } from '../../../../wiki/world/model/families/index';
import { legFinder } from '../../../../wiki/world/model/legs';
import {
    agrees,
    CALIBRATED_NPCS,
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
import { recordingLedger } from '../../../tools/combat-ledger';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

const GIANTS = { x: 3107, z: 9834 };
const WEAPON_SLOT = 3;
const MITHRIL_SCIMITAR = 1329;
const LOBSTER = 379;
/** Every free slot but one, which a big bone takes between its pickup and its bury. */
const LOBSTERS = 27;
const MIN_KILLS = 8;
const MINUTES = 7;

/** The run's profile, as a calibration record holds it. */
const RUN: CalibrationRun = {
    npc: 'giant',
    at: { level: 0, x: 3113, z: 9840 },
    area: 14,
    levels: { attack: 70, strength: 99, defence: 1, hitpoints: 99, prayer: 99 },
    worn: ['mithril_scimitar'],
    skill: 'strength',
    food: 'lobster',
    loot: { bones: 'bury' },
};

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
    'hill giant kills: damage and ticks per kill beside the model',
    async () => {
        const model = modelled();
        await withFixtureBot(
            {
                position: GIANTS,
                skills: { Attack: 70, Strength: 99, Defence: 1, Hitpoints: 99, Prayer: 99 },
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
                const agreement = {
                    damage: agrees(model.damage, perKill.damage.mean),
                    ticks: agrees(model.ticks, perKill.ticks.mean),
                };
                const lines = [
                    { measured: perKill, npcHitsplats: ledger.npcHitsplats, run: `${name}/${run.result.runId}` },
                    { model: { damage: model.damage, ticks: model.ticks }, agreement, status: run.result.status },
                ].map(o => `RESULT ${JSON.stringify(o)}`);
                // run.ts shows a passing file's output to no one: the lines go beside the run's log too.
                writeFileSync(run.result.logFile.replace(/\.ndjson$/, '.calibration.ndjson'), lines.join('\n') + '\n');
                for (const line of lines) console.log(line);
                expect(perKill.kills, detail).toBeGreaterThanOrEqual(MIN_KILLS);
                if (CALIBRATED_NPCS.has(RUN.npc)) expect(agreement, detail).toEqual({ damage: true, ticks: true });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: MINUTES, extraMs: 120_000 }),
);
