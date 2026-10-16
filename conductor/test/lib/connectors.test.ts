import { describe, expect, test } from 'bun:test';
import { collisionPaths } from '../../actions/paths';
import { CONNECTORS, MAX_HOPS, planConnectors, planeOf, type Tile } from '../../lib/connectors';

const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const names = (chain: readonly { name: string; direction: string }[] | null) =>
    chain?.map(c => `${c.direction} ${c.name}`);

describe('planeOf', () => {
    test('is the level, with underground (z >= 6400) apart', () => {
        expect(planeOf(0, 3222, 3222)).toBe('0');
        expect(planeOf(1, 3222, 3222)).toBe('1');
        expect(planeOf(0, 3222, 6400)).toBe('0u');
        expect(planeOf(0, 3222, 6399)).toBe('0');
    });

    test("the Dwarven Mine and the Wizards' Tower basement are different underground planes", () => {
        expect(planeOf(0, 2998, 9844)).toBe('0u-mine');
        expect(planeOf(0, 3058, 9776)).toBe('0u-mine');
        expect(planeOf(0, 3104, 9576)).toBe('0u-basement');
        expect(planeOf(0, 3104, 9577)).not.toBe(planeOf(0, 3058, 9776));
        // Underground elsewhere (the Edgeville dungeon) is neither.
        expect(planeOf(0, 3100, 9930)).toBe('0u');
    });
});

describe('planConnectors', () => {
    test('is empty on the destination plane and null where nothing leads', () => {
        expect(planConnectors(at(0, 3222, 3222), at(0, 3300, 3300))).toEqual([]);
        expect(planConnectors(at(0, 3222, 3222), at(3, 3205, 3209))).toBeNull();
        expect(planConnectors(at(1, 3070, 3380), at(0, 2998, 9844))).toBeNull();
    });

    test('an upper floor far from every connector has no plan (Falador castle level 1)', () => {
        expect(planConnectors(at(0, 3222, 3222), at(1, 2965, 3380))).toBeNull();
    });

    test('Lumbridge castle: ground to first floor is one climb, to the top two, and back', () => {
        expect(names(planConnectors(at(0, 3222, 3222), at(1, 3205, 3228)))).toEqual(['up Lumbridge castle stairs']);
        expect(names(planConnectors(at(0, 3222, 3222), at(2, 3205, 3228)))).toEqual([
            'up Lumbridge castle stairs',
            'up Lumbridge castle stairs',
        ]);
        expect(names(planConnectors(at(2, 3205, 3209), at(0, 3222, 3222)))).toEqual([
            'down Lumbridge castle stairs',
            'down Lumbridge castle stairs',
        ]);
        expect(names(planConnectors(at(1, 3205, 3209), at(0, 3222, 3222)))).toEqual(['down Lumbridge castle stairs']);
    });

    test('the Dwarven Mine from the surface is the Falador stairs down, and the way out is up', () => {
        const down = planConnectors(at(0, 3222, 3222), at(0, 2998, 9844));
        expect(names(down)).toEqual(['down Falador mine stairs']);
        expect(down?.[0]?.stand).toEqual(at(0, 3062, 3376));
        expect(names(planConnectors(at(0, 2998, 9844), at(0, 3222, 3222)))).toEqual(['up Falador mine stairs']);
    });

    test("the Wizards' Tower basement by its ladder, from the tower's ground floor or from the first floor", () => {
        expect(names(planConnectors(at(0, 3110, 3165), at(0, 3104, 9577)))).toEqual(["down Wizards' Tower ladder"]);
        expect(names(planConnectors(at(1, 3105, 3160), at(0, 3104, 9577)))).toEqual([
            "down Wizards' Tower stairs",
            "down Wizards' Tower ladder",
        ]);
    });

    test("the basement's way to Falador is the tower ladder, never the mine stairs", () => {
        const out = planConnectors(at(0, 3104, 9577), at(0, 3060, 3380));
        expect(names(out)).toEqual(["up Wizards' Tower ladder"]);
        expect(out?.[0]?.stand).toEqual(at(0, 3104, 9576));
    });

    test('between the two underground areas the chain goes up to the surface and down again', () => {
        expect(names(planConnectors(at(0, 3058, 9780), at(0, 3104, 9577)))).toEqual([
            'up Falador mine stairs',
            "down Wizards' Tower ladder",
        ]);
        expect(names(planConnectors(at(0, 3104, 9577), at(0, 2998, 9844)))).toEqual([
            "up Wizards' Tower ladder",
            'down Falador mine stairs',
        ]);
    });

    test("Taverley: Sanfew's first floor is the herb-house stairs, and the dungeon its own area by the ladder", () => {
        const up = planConnectors(at(0, 2924, 3485), at(1, 2897, 3426));
        expect(names(up)).toEqual(["up Taverley Sanfew's house stairs"]);
        expect(up?.[0]?.stand).toEqual(at(0, 2897, 3428));
        expect(names(planConnectors(at(1, 2897, 3426), at(0, 2924, 3485)))).toEqual([
            "down Taverley Sanfew's house stairs",
        ]);
        expect(names(planConnectors(at(0, 2924, 3485), at(0, 2890, 9830)))).toEqual(['down Taverley Dungeon ladder']);
        expect(names(planConnectors(at(0, 2890, 9830), at(0, 2924, 3485)))).toEqual(['up Taverley Dungeon ladder']);
        // Not the Dwarven Mine: its stairs are in Falador, the dungeon is a separate area. The mine's north-west
        // pocket (x 2962..2975, z 9806..9819) sits inside the dungeon's x range but is the mine.
        expect(planeOf(0, 2970, 9812)).toBe(planeOf(0, 2998, 9844));
        expect(planeOf(0, 2960, 9780)).toBe(planeOf(0, 2890, 9830));
        expect(planeOf(0, 2850, 9700)).toBe(planeOf(0, 2890, 9830));
        expect(planeOf(0, 2890, 9830)).not.toBe(planeOf(0, 2998, 9844));
        expect(planConnectors(at(0, 2890, 9830), at(0, 2998, 9844))?.map(c => c.name)).toEqual([
            'Taverley Dungeon ladder',
            'Falador mine stairs',
        ]);
    });

    test('an underground area no connector leads to is no-connector (null), not an empty chain', () => {
        expect(planConnectors(at(0, 3058, 9780), at(0, 3100, 9930))).toBeNull();
        expect(planConnectors(at(0, 3104, 9577), at(0, 3100, 9930))).toBeNull();
    });

    test('the mine stairs and the tower top floor carry a hazard note, in both directions', () => {
        for (const c of CONNECTORS.filter(k => k.name === 'Falador mine stairs'))
            expect(c.hazard, c.direction).toMatch(/scorpion/);
        const top = CONNECTORS.filter(k => k.loc.level === 2 || k.to.level === 2).filter(k => k.name.startsWith('Wiz'));
        expect(top.length).toBe(2);
        for (const c of top) expect(c.hazard).toMatch(/lesser demon/);
        expect(CONNECTORS.find(k => k.name === 'Lumbridge castle stairs')?.hazard).toBeUndefined();
    });

    test("an upper floor of a far building does not reach this one's stairs", () => {
        expect(planConnectors(at(1, 3500, 3500), at(0, 3222, 3222))).toBeNull();
    });

    test('picks the cheaper of two chains and never uses a connector twice', () => {
        const near = {
            name: 'near',
            direction: 'up' as const,
            loc: at(0, 10, 10),
            stand: at(0, 10, 10),
            to: at(1, 10, 10),
        };
        const far = { ...near, name: 'far', loc: at(0, 90, 90), stand: at(0, 90, 90), to: at(1, 90, 90) };
        expect(planConnectors(at(0, 0, 0), at(1, 0, 0), [far, near])).toEqual([near]);
        const loop = {
            ...near,
            name: 'loop',
            direction: 'down' as const,
            loc: at(1, 10, 10),
            stand: at(1, 10, 10),
            to: at(0, 10, 10),
        };
        expect(planConnectors(at(0, 0, 0), at(2, 0, 0), [near, loop])).toBeNull();
        expect(MAX_HOPS).toBeGreaterThanOrEqual(2);
    });
});

describe('the table against the collision data', () => {
    test('every stand tile and landing is walkable, on the plane of its loc or landing', () => {
        for (const c of CONNECTORS) {
            const label = `${c.name} ${c.direction} (${c.loc.x}, ${c.loc.z})`;
            expect(planeOf(c.stand.level, c.stand.x, c.stand.z), label).toBe(planeOf(c.loc.level, c.loc.x, c.loc.z));
            expect(collisionPaths.walkable(c.stand.level, c.stand.x, c.stand.z), `${label}: stand`).toBe(true);
            expect(collisionPaths.walkable(c.to.level, c.to.x, c.to.z), `${label}: landing`).toBe(true);
        }
    });

    test("every connector has a way back, landing on the other side's stand tile", () => {
        for (const c of CONNECTORS) {
            const back = CONNECTORS.find(
                k =>
                    k.direction !== c.direction &&
                    k.loc.level === c.to.level &&
                    planeOf(k.loc.level, k.loc.x, k.loc.z) === planeOf(c.to.level, c.to.x, c.to.z) &&
                    k.stand.x === c.to.x &&
                    k.stand.z === c.to.z &&
                    k.to.x === c.stand.x &&
                    k.to.z === c.stand.z,
            );
            expect(back, `${c.name} ${c.direction} at (${c.loc.x}, ${c.loc.z})`).toBeDefined();
        }
    });

    test("the landing of each connector reaches the next one's stand tile, in the real collision data", () => {
        // The mine: from the landing under Falador to Nurmof's shop (2998, 9844).
        const r = collisionPaths.findPath({ level: 0, x: 3058, z: 9776 }, { x: 2998, z: 9844 }, []);
        expect(r.success && r.reachedDestination).toBe(true);
        // The Taverley Dungeon: from the ladder's landing to the cauldron room.
        const dungeon = collisionPaths.findPath({ level: 0, x: 2884, z: 9798 }, { x: 2890, z: 9830 }, []);
        expect(dungeon.success && dungeon.reachedDestination).toBe(true);
        // Lumbridge castle's first floor from the landing to the north end.
        const up = collisionPaths.findPath({ level: 1, x: 3205, z: 3209 }, { x: 3205, z: 3228 }, []);
        expect(up.success && up.reachedDestination).toBe(true);
    });
});
