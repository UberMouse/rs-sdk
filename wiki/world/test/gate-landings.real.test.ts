// Where the real gated moves on objects land (sources/gate-landings.ts): the gate scan, its placed rows and
// their landings, built from the game scripts and the collision data, each checked against its script.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { siteCollision } from '../collision';
import { GATES, LOADOUT_PROCS, QUEST_OVERRIDES } from '../gates';
import { SCRIPTS } from '../paths';
import { locSizes } from '../place';
import { toolCheckers } from '../sources/conditions';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { deriveGateLandings, type GateLandingInput } from '../sources/gate-landings';
import { placeGates, scanGates, type GateScanInput } from '../sources/gate-scan';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';
import { deriveQuests, scanQuestCalls } from '../sources/quests';
import { coordTile } from '../sources/runescript';
import { parseCallables, parseTriggers, readScripts } from '../sources/triggers';
import type { Gate, Tile } from '../types';

// Built when the file loads, where no timeout applies (as world.real.test.ts does).
const scripts = readScripts();
const triggers = scripts.flatMap(([f, t]) => parseTriggers(f, t));
const callables = scripts.flatMap(([f, t]) => parseCallables(f, t));
const constants = readConstants();
const { quests } = deriveQuests({
    scan: scanQuestCalls(scripts),
    constants,
    varps: readPack('varp'),
    varbits: readConfigs('varbit'),
    overrides: QUEST_OVERRIDES,
    decreasing: {},
});
const locConfigs = readConfigs('loc');
const objConfigs = readConfigs('obj');
const { tools } = toolCheckers(
    callables,
    new Map([...objConfigs].flatMap(([obj, cfg]) => (cfg.category?.[0] ? [[obj, cfg.category[0]]] : []))),
);
const scan: GateScanInput = {
    triggers,
    callables,
    constants,
    quests,
    loadoutProcs: LOADOUT_PROCS,
    names: new Set([...objConfigs.keys(), ...locConfigs.keys(), ...readConfigs('npc').keys()]),
    tools,
};
const candidates = scanGates(scan);
const locPack = readPack('loc');
const placed = placeGates({
    curated: GATES,
    candidates,
    triggers,
    locConfigs,
    locs: readAllMapSquares().locs.flatMap(l => {
        const config = locPack.name.get(l.id);
        return config === undefined ? [] : [{ config, tile: l.tile, shape: l.shape, rotation: l.rotation }];
    }),
    quests,
    constants,
});
const input: GateLandingInput = {
    gates: placed.gates,
    scan,
    candidates,
    locConfigs,
    collision: siteCollision,
    size: locSizes(locConfigs),
};
const derived = deriveGateLandings(input);

const WALL_SHAPES = new Set([0, 1, 2, 3, 9]);
const walls = (gs: Gate[]): Gate[] => gs.filter(g => WALL_SHAPES.has(g.shape));
/** A gate row without its roll. */
const unrolled = (g: Gate): Gate => {
    const { roll: _, ...rest } = g;
    return rest;
};
const rowsOf = (trigger: string): Gate[] => derived.gates.filter(g => g.trigger === trigger);
const same = (a: Tile, b: Tile): boolean => a.level === b.level && a.x === b.x && a.z === b.z;
/** The text of a script line, `file:line` under server/content/scripts. */
const lineAt = (at: string): string => {
    const [file, n] = at.split(':') as [string, string];
    return readFileSync(join(SCRIPTS, file), 'utf8').split('\n')[Number(n) - 1]!.trim();
};

describe('every gate row on an object has an outcome', () => {
    test('to, landings or opens, or an underived reason; the counts add up', () => {
        // The rows in scope: on an object, and with no `to` written in gates.ts.
        const inScope = placed.gates.filter(g => !WALL_SHAPES.has(g.shape) && !g.to);
        const underived = new Set(derived.underived.map(u => `${u.trigger} ${u.tile.x} ${u.tile.z} ${u.tile.level}`));
        for (const g of derived.gates.filter(r => !WALL_SHAPES.has(r.shape) && r.kind === 'gate')) {
            const settled = g.to || g.landings?.length || g.opens;
            if (!settled) expect(underived.has(`${g.trigger} ${g.tile.x} ${g.tile.z} ${g.tile.level}`)).toBe(true);
        }
        for (const u of derived.underived) expect(u.reasons.length).toBeGreaterThan(0);
        const { to, landings, opens, underived: none, windows } = derived.counts;
        expect(to + landings + opens + none + windows).toBe(inScope.length);
    });

    test('walls are left as the scan placed them, but for the roll a skill check gives some', () => {
        expect(walls(derived.gates).map(unrolled)).toEqual(walls(placed.gates));
    });

    test("the Underground Pass railing's lock pick is behind its thieving roll; a failure leaves the player there", () => {
        expect(lineAt('quests/quest_upass/scripts/quest_upass.rs2:254')).toBe(
            'if (stat_random(thieving, 128, 400) = false) {',
        );
        const rows = rowsOf('oploc1,cave_railings5');
        expect(rows.length).toBeGreaterThan(0);
        for (const g of rows)
            expect(g.roll).toEqual({
                stat: 'thieving',
                low: 128,
                high: 400,
                source: 'quests/quest_upass/scripts/quest_upass.rs2:254',
                fail: { ticks: 0, damage: 0 },
            });
    });
});

describe('the landings, each with its script', () => {
    test('the Mining Guild ladder lands 6400 north of each stand, underground', () => {
        expect(lineAt('areas/area_falador/scripts/mining_guild.rs2:8')).toBe(
            '~climb_ladder(movecoord(coord, 0, 0, 6400), true);',
        );
        const rows = rowsOf('oploc1,miningguildladder');
        expect(rows.length).toBeGreaterThan(0);
        for (const g of rows) {
            expect(g.landings?.length).toBeGreaterThan(0);
            for (const { stand, landing } of g.landings!) expect(landing).toEqual({ ...stand, z: stand.z + 6400 });
        }
    });

    test("the monastery ladder lands one level above each stand, for members of the monks' order", () => {
        expect(lineAt('areas/monastery/scripts/prayer_guild.rs2:19')).toBe(
            '~climb_ladder(movecoord(coord, 0, 1, 0), true);',
        );
        const rows = rowsOf('oploc1,monasteryladder');
        expect(rows.length).toBeGreaterThan(0);
        for (const g of rows) {
            expect(g.landings?.length).toBeGreaterThan(0);
            for (const { stand, landing } of g.landings!) expect(landing).toEqual({ ...stand, level: stand.level + 1 });
        }
    });

    test('the Kharazi jungle bushes open: chopped, each turns into a bush that does not block', () => {
        expect(lineAt('quests/quest_legends/scripts/jungle_tree.rs2:135')).toBe(
            'loc_change(loc_param(next_loc_stage), $respawnrate);',
        );
        const rows = rowsOf('oploc1,_jungle_bush');
        expect(rows.length).toBe(132);
        for (const g of rows) expect([g.opens, g.to, g.landings]).toEqual([true, undefined, undefined]);
    });

    test("Trollheim's climbing rocks land on the tile across the rock (@rockslide_obstacle)", () => {
        expect(lineAt('quests/quest_troll/scripts/quest_troll.rs2:15')).toBe('@rockslide_obstacle;');
        expect(lineAt('quests/quest_upass/scripts/upass_obstacles.rs2:31')).toStartWith(
            '~agility_exactmove(human_walk_style, 0, 2, coord, $end, 0, 60, $dir, true);',
        );
        const rows = rowsOf('oploc1,troll_climbingrocks');
        expect(rows.length).toBe(7);
        for (const g of rows) {
            expect(g.landings?.length).toBeGreaterThan(0);
            // From a stand beside the rock, `$end` is the rock's tile moved one step away from the stand.
            for (const { stand, landing } of g.landings!)
                expect(landing).toEqual({
                    level: g.tile.level,
                    x: g.tile.x + Math.sign(g.tile.x - stand.x),
                    z: g.tile.z + Math.sign(g.tile.z - stand.z),
                });
        }
    });

    test('the Troll Stronghold secret door teleports to its literal tile, written and derived alike', () => {
        expect(lineAt('quests/quest_troll/scripts/quest_troll.rs2:113')).toBe('p_teleport(0_44_157_7_2);');
        const [door, ...more] = rowsOf('oploc1,troll_stronghold_entrance');
        expect(more).toEqual([]);
        expect(door!.to).toEqual(coordTile('0_44_157_7_2'));
        // gates.ts writes the jump; without it, the derivation finds the same tile.
        const { to: _, ...unwritten } = door!;
        const again = deriveGateLandings({ ...input, gates: [unwritten] });
        expect(again.gates[0]!.to).toEqual(coordTile('0_44_157_7_2'));
    });

    test('no landing is off walkable land', () => {
        for (const g of derived.gates)
            for (const { landing } of g.landings ?? [])
                expect(
                    siteCollision.land(landing.level, landing.x, landing.z) &&
                        siteCollision.walkable(landing.level, landing.x, landing.z),
                ).toBe(true);
        for (const o of derived.offLand)
            expect(
                derived.gates.some(g => g.landings?.some(l => same(l.landing, o.landing) && same(l.stand, o.stand))),
            ).toBe(false);
    });
});
