import { describe, expect, test } from 'bun:test';
import type { BotAction, BotWorldState } from '../../../sdk/types';
import { COMBOLOCK_MAX_TICKS } from '../../actions/combolock';
import { CONVERSE_MAX_TICKS } from '../../actions/talk';
import type { Effect } from '../../core/drivers/timeline';
import { stepBudgetTicks } from '../../lib/task';
import combolock, { PEER_RIDDLES } from '../../tasks/combolock';
import { lockReact, PEER_LOCK, SOLVED_MESSAGE, TRIBAL_LOCK, withLock } from '../lock';
import { walking } from '../react';
import { simulate } from '../simulate';
import { world } from '../world';

const PEER_DOOR = { x: 2631, z: 3667 };
const TRIBAL_DOOR = { x: 2634, z: 3323 };

const RIDDLE_FIRST_LINES = [
    'My first is in mage, but not in wizard.',
    'My first is in tar, but not in a swamp.',
    'My first is in the well, but not at sea.',
    'My first is in fish, but not in the sea.',
    'My first is in water, and also in tea.',
    'My first is in wizard, but not in a mage.',
];

/** The bot two tiles south of the door (`side` -2) or north of it (+2), which stands in view. */
const standing = (door: { x: number; z: number }, side = -2) =>
    world()
        .player({ at: { x: door.x, z: door.z + side } })
        .loc('Door', door.x, door.z, { options: ['Open'] });

/** Adds `lines` to the recorded dialog pages once (an effect applies every tick). */
const record = (s: BotWorldState, lines: string[]): BotWorldState =>
    s.recentDialogs.some(d => d.text.join() === lines.join()) ? s : world(s).recentDialog(lines).build();

interface PeerOptions {
    riddle?: number;
    /** What the Read / Solve choice shows; the lock opens after it. */
    start?: number[];
    answer?: string;
    /** The lock stays shut (no trial started). */
    noLock?: boolean;
    /** The lock shows beside the first riddle page (a stray lock open when the open step fails). */
    lockEarly?: boolean;
}

/** Peer's door: Open starts a message box, then Read / Solve / Forget; Read shows two riddle pages, then the lock opens. */
function peerDoor(opts: PeerOptions = {}) {
    const answer = opts.answer ?? PEER_RIDDLES[opts.riddle ?? 0]!.word;
    const lock = lockReact({ lock: PEER_LOCK, start: opts.start, answer });
    const choices: number[] = [];
    let page = -1;
    const show = (index: number): Effect => {
        return s => {
            if (index === 0) return world(s).dialog({ text: 'plaque', options: [] }).build();
            if (index === 1)
                return world(s)
                    .dialog({ text: 'choice', options: ['Read the riddle', 'Solve the riddle', 'Forget it'] })
                    .build();
            if (index === 2) {
                const first = record(world(s).dialog({ text: 'riddle 1', options: [] }).build(), [
                    RIDDLE_FIRST_LINES[opts.riddle ?? 0]!,
                    'My second in goblin, and also in lizard.',
                ]);
                return opts.lockEarly ? withLock(first, PEER_LOCK, [0, 0, 0, 0]) : first;
            }
            return world(s).dialog({ text: 'riddle 2', options: [] }).build();
        };
    };
    const opens: Effect = s =>
        opts.noLock
            ? world(s).dialog(false).build()
            : withLock(world(s).dialog(false).build(), PEER_LOCK, opts.start ?? [0, 0, 0, 0]);
    const react = (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'interactLoc' && /Open Door/.test(action.reason)) {
            lock.reset();
            return show((page = 0));
        }
        if (action.type === 'clickDialogOption') {
            if (page === 1) {
                choices.push(action.optionIndex);
                if (action.optionIndex === 1) {
                    page = 9;
                    return opens;
                }
                if (action.optionIndex === 0) return show((page = 2));
                return show((page = 9));
            }
            if (page === 0) return show((page = 1));
            if (page === 2) return show((page = 3));
            if (page === 3) {
                page = 9;
                return opens;
            }
            return undefined;
        }
        return lock.react(action) ?? walking()(action, state);
    };
    return { react, lock, choices };
}

/** The tribal door: Open shows the lock at once. */
function tribalDoor(start?: number[], answer = 'KURT') {
    const lock = lockReact({ lock: TRIBAL_LOCK, start, answer });
    const react = (action: BotAction, state: BotWorldState): Effect | undefined => {
        if (action.type === 'interactLoc' && /Open Door/.test(action.reason)) {
            lock.reset();
            return s => withLock(s, TRIBAL_LOCK, start ?? [0, 0, 0, 0]);
        }
        return lock.react(action) ?? walking()(action, state);
    };
    return { react, lock };
}

// Peer's door is worked from outside it (north), where the task walks to by default.
/** A solved tribal door: the Open lands as the loc changing (the open door), and no lock ever shows. */
const solvedDoorReact = (action: BotAction, state: BotWorldState): Effect | undefined => {
    if (action.type === 'interactLoc' && /Open Door/.test(action.reason))
        return s =>
            world({ ...s, nearbyLocs: [] })
                .loc('Open door', TRIBAL_DOOR.x, TRIBAL_DOOR.z, { options: ['Close'] })
                .build();
    return walking()(action, state);
};

const peerWorld = standing(PEER_DOOR, 2).series(400);
const tribalWorld = standing(TRIBAL_DOOR).series(400);

describe('combolock: Peer the Seer', () => {
    test.each(PEER_RIDDLES.map((r, i) => [i, r.word] as const))(
        'riddle %i: reads it, sets %s and is done',
        async (riddle, word) => {
            const door = peerDoor({ riddle });
            const r = await simulate(combolock, { params: { door: 'peer' }, timeline: peerWorld, react: door.react });
            expect(r.result.status).toBe('done');
            expect(r.result.reason).toBe(`solve: combination lock solved: ${word}: ${SOLVED_MESSAGE.combolockdoor}`);
            expect(door.lock.wheels.map(v => String.fromCharCode(65 + v)).join('')).toBe(word);
            // Choice 1 of 3 is "Read the riddle" (index 0).
            expect(door.choices).toEqual([0]);
            expect(r.steps).toEqual(['open', 'solve']);
        },
    );

    test('with a word it solves that word without reading the riddle', async () => {
        const door = peerDoor({ answer: 'TREE' });
        const r = await simulate(combolock, {
            params: { door: 'peer', word: 'tree' },
            timeline: peerWorld,
            react: door.react,
        });
        expect(r.result.status).toBe('done');
        expect(door.choices).toEqual([1]);
        expect(door.lock.wheels).toEqual([19, 17, 4, 4]);
    });

    test("a word the lock refuses fails with the game's message", async () => {
        const door = peerDoor({ riddle: 0 });
        const r = await simulate(combolock, {
            params: { door: 'peer', word: 'WIND' },
            timeline: peerWorld,
            react: door.react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('solve: wrong: WIND was refused: You have failed to solve the riddle.');
    });

    test('a riddle that is none of the six fails naming that', async () => {
        const door = peerDoor({ riddle: 0 });
        // The first page's clue line is unknown: the riddle pages say something else.
        RIDDLE_FIRST_LINES.splice(0, 1, 'My first is in nothing at all.');
        try {
            const r = await simulate(combolock, { params: { door: 'peer' }, timeline: peerWorld, react: door.react });
            expect(r.result.status).toBe('failed');
            expect(r.result.reason).toContain('not one of the six known');
        } finally {
            RIDDLE_FIRST_LINES.splice(0, 1, 'My first is in mage, but not in wizard.');
        }
    });

    test('a failure with a lock showing closes the lock first', async () => {
        const door = peerDoor({ riddle: 0, lockEarly: true });
        RIDDLE_FIRST_LINES.splice(0, 1, 'My first is in nothing at all.');
        try {
            const r = await simulate(combolock, { params: { door: 'peer' }, timeline: peerWorld, react: door.react });
            expect(r.result.status).toBe('failed');
            expect(r.sends).toContain('close combination lock');
            expect(door.lock.clicks).toContain('close');
        } finally {
            RIDDLE_FIRST_LINES.splice(0, 1, 'My first is in mage, but not in wizard.');
        }
    });

    test('with no `at` it walks to the tile outside the door (never opens it from inside)', async () => {
        const door = peerDoor({ riddle: 0 });
        const inside = standing(PEER_DOOR, -2).series(400);
        const r = await simulate(combolock, { params: { door: 'peer' }, timeline: inside, react: door.react });
        expect(r.steps[0]).toBe('walk');
        expect(r.result.status).toBe('done');
    });

    test('an explicit `at` overrides the outside default', async () => {
        const door = peerDoor({ riddle: 0 });
        const inside = standing(PEER_DOOR, -2).series(400);
        const r = await simulate(combolock, {
            params: { door: 'peer', at: { x: 2631, z: 3665, tolerance: 1 } },
            timeline: inside,
            react: door.react,
        });
        expect(r.steps[0]).toBe('open');
    });

    test('a door that opens no lock (trial not started) fails saying so', async () => {
        const door = peerDoor({ noLock: true });
        const r = await simulate(combolock, {
            params: { door: 'peer', word: 'MIND' },
            timeline: peerWorld,
            react: door.react,
        });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('trial not started or riddle already solved?');
    });
});

describe('combolock: Tribal Totem door', () => {
    test('opens the door and sets KURT, no dialog involved', async () => {
        const door = tribalDoor();
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline: tribalWorld, react: door.react });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toBe(`solve: combination lock solved: KURT: ${SOLVED_MESSAGE.tribal_door2}`);
        expect(door.lock.wheels).toEqual([10, 20, 17, 19]);
        expect(r.steps).toEqual(['open', 'solve']);
        expect(r.sends.filter(s => /dialog/.test(s))).toEqual([]);
    });

    test('a different word overrides the door’s own', async () => {
        const door = tribalDoor(undefined, 'ABCD');
        const r = await simulate(combolock, {
            params: { door: 'tribal', word: 'ABCD' },
            timeline: tribalWorld,
            react: door.react,
        });
        expect(r.result.status).toBe('done');
        expect(door.lock.wheels).toEqual([0, 1, 2, 3]);
    });

    test('a lock that rejects the word fails wrong', async () => {
        const door = tribalDoor(undefined, 'ZZZZ');
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline: tribalWorld, react: door.react });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('solve: wrong: KURT was refused: This combination is incorrect.');
    });

    test('an already solved door just opens: done, no lock worked', async () => {
        // The Open lands as the loc changing (the open door), and no lock ever shows.
        const r = await simulate(combolock, {
            params: { door: 'tribal' },
            timeline: tribalWorld,
            react: solvedDoorReact,
        });
        expect(r.result.status).toBe('done');
        expect(r.result.reason).toContain('already solved');
        expect(r.sends.filter(s => /lock/.test(s))).toEqual([]);
    });

    test('a door already standing open (a restart after the door opened) is done without a send', async () => {
        const timeline = world()
            .player({ at: { x: TRIBAL_DOOR.x, z: TRIBAL_DOOR.z - 2 } })
            .loc('Door', TRIBAL_DOOR.x, TRIBAL_DOOR.z, { options: ['Close'] })
            .series(60);
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline });
        expect(r.result.status).toBe('done');
        expect(r.sends.filter(s => s === 'Open Door')).toEqual([]);
    });

    test('a door that does nothing at all fails: no lock and no change', async () => {
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline: tribalWorld });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toContain('showed no effect');
    });

    test('no door in sight fails after the missing limit', async () => {
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline: world().series(60) });
        expect(r.result.status).toBe('failed');
        expect(r.result.reason).toBe('open: no reachable Door with an Open option at (2634,3323) in sight');
    });

    test('a walk to `at` comes first', async () => {
        const door = tribalDoor();
        const far = world()
            .player({ at: { x: 2600, z: 3300 } })
            .loc('Door', TRIBAL_DOOR.x, TRIBAL_DOOR.z, { options: ['Open'] });
        const r = await simulate(combolock, {
            params: { door: 'tribal', at: { x: 2634, z: 3322, tolerance: 1 } },
            timeline: far.series(400),
            react: walking(door.react),
        });
        expect(r.steps.slice(0, 2)).toEqual(['walk', 'open']);
    });
});

describe('combolock: interruption', () => {
    test('low HP mid-wheel closes the lock first, eats, reopens the door and solves from A', async () => {
        const door = tribalDoor();
        const timeline = standing(TRIBAL_DOOR)
            .inv('Shrimps', 1)
            .series(400, (w, i) => w.player({ hp: i >= 30 && i < 34 ? 3 : 10 }));
        const r = await simulate(combolock, { params: { door: 'tribal' }, timeline, react: door.react });
        expect(r.result.status).toBe('done');
        // The solve was cut off with the lock open, the lock closed under the cancel, then the door was opened again.
        const sends = r.sends;
        const eat = sends.findIndex(s => /eat|shrimps/i.test(s));
        expect(eat).toBeGreaterThan(-1);
        expect(sends.slice(0, eat)).toContain('close combination lock');
        expect(r.steps).toContain('interrupt:low-hp');
        expect(sends.filter(s => s === 'Open Door')).toHaveLength(2);
        expect(door.lock.wheels).toEqual([10, 20, 17, 19]);
    });
});

describe('combolock: a lock this run cannot answer', () => {
    test('a lock open with no riddle read is closed again so the door is reopened', async () => {
        const sim = lockReact({ lock: PEER_LOCK, answer: 'MIND' });
        // No door in view; a lock appears by itself at tick 3 while the task is waiting for one.
        const timeline = world()
            .player({ at: { x: 2631, z: 3669 } })
            .series(80)
            .map((s, i) => (i >= 3 ? withLock(s, PEER_LOCK, [0, 0, 0, 0]) : s));
        const r = await simulate(combolock, { params: { door: 'peer' }, timeline, react: sim.react });
        expect(r.steps).toContain('reopen');
        expect(r.sends).toContain('close combination lock');
        expect(sim.clicks).toContain('close');
        expect(r.result.reason).toContain('no reachable Door');
    });
});

describe('combolock: step budget', () => {
    test('the step budget covers a dialog and a full solve', () => {
        // stepTimeoutMs is the task's own; both the converse and the worst-case solve fit it.
        const budget = stepBudgetTicks(360_000);
        expect(budget).toBeGreaterThan(CONVERSE_MAX_TICKS);
        expect(budget).toBeGreaterThan(COMBOLOCK_MAX_TICKS);
    });
});
