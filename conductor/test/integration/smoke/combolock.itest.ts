import { expect, test } from 'bun:test';
import { itestTimeout, runTask, withFixtureBot } from '../harness';

// varp ids from server/content/pack/varp.pack: viking (Fremennik Trials) 347, viking_bits 348, handelmort_traps_disabled 201.
// viking_bits: the riddle id in bits 3-5, Peer's trial progress in bits 18-19 (peer_started = 1).
const VIKING = 347;
const VIKING_BITS = 348;
const peerStarted = (riddle: number) => (1 << 18) | (riddle << 3);

// Outside Peer the Seer's puzzle-room door in Rellekka (north of it) and in Handelmort Mansion, a tile south of the
// Tribal Totem lock door: no other integration test uses either.
const PEER = { x: 2631, z: 3669 };
const MANSION = { x: 2634, z: 3322 };

const detail = (run: { result: unknown; stderr: string }) => `${JSON.stringify(run.result)}\n${run.stderr}`;

test(
    "Peer's riddle door: reads the server's riddle, sets its word and the lock accepts it",
    async () => {
        await withFixtureBot(
            { position: PEER, varps: { [VIKING]: 1, [VIKING_BITS]: peerStarted(5) } },
            async ({ name }) => {
                const run = await runTask(name, 'combolock', { door: 'peer' }, ['minutes:2']);
                expect(run.result.status, detail(run)).toBe('done');
                expect(run.result.reason, detail(run)).toContain('WIND: You have solved the riddle!');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

test(
    "Peer's riddle door: a given word is set without reading the riddle",
    async () => {
        await withFixtureBot(
            { position: PEER, varps: { [VIKING]: 1, [VIKING_BITS]: peerStarted(0) } },
            async ({ name }) => {
                const run = await runTask(name, 'combolock', { door: 'peer', word: 'MIND' }, ['minutes:2']);
                expect(run.result.status, detail(run)).toBe('done');
                expect(run.result.reason, detail(run)).toContain('MIND: You have solved the riddle!');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 2 }),
);

test(
    'the Tribal Totem door: KURT is accepted, a wrong word is refused',
    async () => {
        await withFixtureBot(
            { position: MANSION, varps: { 200: 2 } },
            async ({ name }) => {
                const wrong = await runTask(name, 'combolock', { door: 'tribal', word: 'ABCD' }, ['minutes:2']);
                expect(wrong.result.status, detail(wrong)).toBe('failed');
                expect(wrong.result.reason, detail(wrong)).toContain(
                    'wrong: ABCD was refused: This combination is incorrect.',
                );
                const run = await runTask(name, 'combolock', { door: 'tribal' }, ['minutes:2']);
                expect(run.result.status, detail(run)).toBe('done');
                expect(run.result.reason, detail(run)).toContain('KURT: The combination seems correct!');
            },
            { connect: false },
        );
    },
    itestTimeout({ taskMinutes: 4 }),
);
