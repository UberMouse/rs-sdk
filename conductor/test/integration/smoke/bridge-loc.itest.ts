import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Locs on LinkBelow (bridge) tiles: the map file stores the Port Sarim "on" gangplank (loc 2593, 3047,3205) at
// level 1, GameMap.loadLocations lowers it to level 0, and the lite client's scene must list it there so the
// bot on the quay can click it (server/webclient/src/lite/world/SceneLite.ts). Script
// [oploc1,dragonshipgangplank_on] (quests/quest_dragon/scripts/lady_lumbridge.rs2) boards once %dragonquest
// (varp 176) has reached "bought ship" (3).
const QUAY = { x: 3047, z: 3203 };
const DRAGON_QUEST = 176;
const BOUGHT_SHIP = 3;

test(
    'interact finds the quay gangplank on a bridge tile and boards the ship',
    async () => {
        await withFixtureBot(
            { position: QUAY, varps: { [DRAGON_QUEST]: BOUGHT_SHIP } },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'interact',
                    { target: 'loc', name: '^Gangplank$', option: '^Cross$', tile: { x: 3047, z: 3205 } },
                    ['minutes:1'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('done');
                expect(run.result.finalPos?.level, detail).toBe(1);
                expect(run.result.finalPos?.z, detail).toBeGreaterThanOrEqual(3206);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 1 }),
);
