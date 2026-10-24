import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// Ship crossings as catalog tasks: `talk` with `travels` (the sailor or monk; the game carries the player onto the deck
// of the destination ship) then `interact` on the deck's gangplank ("Cross" lands on the quay). Sources: the sail procs
// (interface_boat/scripts/sail.rs2), areas/area_port_sarim/scripts/{sailors,monk_of_entrana}.rs2,
// areas/area_entrana/scripts/monk_of_entrana.rs2, areas/area_karamja/scripts/customs_officer.rs2,
// areas/area_ardougne_east/scripts/captain_barnaby.rs2, general_use/scripts/gangplank.rs2.
const COINS = { id: 995, count: 100 };
const CUSTOMS = ['Can I journey', 'Search away', '^Ok'];
const BRONZE_DAGGER = 1205;

type Dock = { x: number; z: number; level?: number };
interface Leg {
    npc: string;
    at?: { x: number; z: number; tolerance: number };
    choices: string[];
    /** The deck's gangplank (level 1) and where Cross leaves the player. */
    gangplank: Dock;
}

async function sail(name: string, leg: Leg, to: { x: number; z: number }) {
    const talk = await runTask(
        name,
        'talk',
        { npc: leg.npc, ...(leg.at && { at: leg.at }), choices: leg.choices, travels: true },
        ['minutes:2'],
    );
    const detail = (r: typeof talk) => `${JSON.stringify(r.result)}\n${r.stderr}`;
    expect(talk.result.status, detail(talk)).toBe('done');
    expect(talk.result.finalPos?.level, detail(talk)).toBe(1);
    const cross = await runTask(
        name,
        'interact',
        { target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { ...leg.gangplank, level: 1 } },
        ['minutes:1'],
    );
    expect(cross.result.status, detail(cross)).toBe('done');
    expect(cross.result.finalPos?.level, detail(cross)).toBe(0);
    expect(Math.abs((cross.result.finalPos?.x ?? 0) - to.x), detail(cross)).toBeLessThanOrEqual(3);
    expect(Math.abs((cross.result.finalPos?.z ?? 0) - to.z), detail(cross)).toBeLessThanOrEqual(3);
    return talk;
}

const toKaramja: Leg = {
    npc: 'Captain Tobias',
    at: { x: 3028, z: 3216, tolerance: 3 },
    choices: ['Yes please'],
    gangplank: { x: 2956, z: 3144 },
};
const fromKaramja: Leg = { npc: 'Customs officer', choices: CUSTOMS, gangplank: { x: 3031, z: 3217 } };
const toEntrana: Leg = {
    npc: 'Monk of Entrana',
    at: { x: 3047, z: 3236, tolerance: 2 },
    choices: ['Yes, okay'],
    gangplank: { x: 2834, z: 3333 },
};
const fromEntrana: Leg = {
    npc: 'Monk of Entrana',
    at: { x: 2835, z: 3336, tolerance: 2 },
    choices: ["Yes, I'm ready"],
    gangplank: { x: 3048, z: 3232 },
};
const toBrimhaven: Leg = {
    npc: 'Captain Barnaby',
    at: { x: 2679, z: 3275, tolerance: 3 },
    choices: ['Yes please'],
    gangplank: { x: 2774, z: 3234 },
};
const fromBrimhaven: Leg = {
    npc: 'Customs officer',
    at: { x: 2772, z: 3228, tolerance: 3 },
    choices: CUSTOMS,
    gangplank: { x: 2683, z: 3269 },
};

test(
    'Port Sarim to Musa Point (30 coins) and back (30 coins)',
    async () => {
        await withFixtureBot(
            { position: { x: 3029, z: 3212 }, inventory: [COINS] },
            async ({ name }) => {
                await sail(name, toKaramja, { x: 2956, z: 3146 });
                await sail(name, fromKaramja, { x: 3030, z: 3217 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);

test(
    'Port Sarim to Entrana and back, unarmed and free',
    async () => {
        await withFixtureBot(
            {
                position: { x: 3029, z: 3212 },
                inventory: [
                    { id: 329, count: 1 },
                    { id: 329, count: 1 },
                ],
            },
            async ({ name }) => {
                await sail(name, toEntrana, { x: 2834, z: 3335 });
                await sail(name, fromEntrana, { x: 3048, z: 3234 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);

test(
    'Ardougne to Brimhaven and back (30 coins each way)',
    async () => {
        await withFixtureBot(
            { position: { x: 2677, z: 3277 }, inventory: [COINS] },
            async ({ name }) => {
                await sail(name, toBrimhaven, { x: 2772, z: 3234 });
                await sail(name, fromBrimhaven, { x: 2683, z: 3271 });
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 6 }),
);

test(
    'the Monk of Entrana refuses a bronze dagger and the talk fails with no journey',
    async () => {
        await withFixtureBot(
            { position: { x: 3029, z: 3212 }, inventory: [{ id: BRONZE_DAGGER, count: 1 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'talk',
                    { npc: toEntrana.npc, at: toEntrana.at, choices: toEntrana.choices, travels: true },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('failed');
                expect(run.result.reason, detail).toContain('no journey followed');
                expect(run.result.finalPos?.x, detail).toBeGreaterThan(3000);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);

test(
    'a fare the account cannot pay fails the talk with no journey',
    async () => {
        await withFixtureBot(
            { position: { x: 3029, z: 3212 }, inventory: [{ id: 995, count: 10 }] },
            async ({ name }) => {
                const run = await runTask(
                    name,
                    'talk',
                    { npc: toKaramja.npc, at: toKaramja.at, choices: toKaramja.choices, travels: true },
                    ['minutes:2'],
                );
                const detail = `${JSON.stringify(run.result)}\n${run.stderr}`;
                expect(run.result.status, detail).toBe('failed');
                expect(run.result.reason, detail).toContain('no journey followed');
                expect(run.result.inventoryDelta['Coins'] ?? 0, detail).toBe(0);
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 3 }),
);
