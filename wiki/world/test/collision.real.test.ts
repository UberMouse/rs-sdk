import { expect, test } from 'bun:test';
import { collisionPaths } from '../../../conductor/actions/paths';
import { reachCollision, siteCollision } from '../collision';
import { first, readConfigs } from '../sources/configs';
import { readAllMapSquares } from '../sources/maps';
import { readPack } from '../sources/packs';

// A Varrock West bank booth: `0 50 44: 2213 10 3` in server/content/maps/m49_53.jm2 (loc 2213 is
// bankbooth in server/content/pack/loc.pack), a 1x1 centrepiece turned to angle 3, with no forceapproach.
const booth = { level: 0, x: 3186, z: 3436, width: 1, length: 1, forceapproach: 0, shape: 10, rotation: 3 };

const from = (x: number, z: number): boolean => siteCollision.reached({ level: 0, x, z }, booth);

test('the booth blocks its tile and is reached from its open sides only', () => {
    expect(siteCollision.walkable(0, 3186, 3436)).toBe(false);
    expect([from(3185, 3436), from(3187, 3436), from(3186, 3437)]).toEqual([true, true, true]);
    // A diagonal never reaches a rectangle; a wall runs along this booth's south edge.
    expect([from(3185, 3435), from(3186, 3435)]).toEqual([false, false]);
});

test('a loc with forceapproach is refused from the sides it forbids', () => {
    // A closed chest (loc 375 in server/content/pack/loc.pack) at `0 44 20: 375 10` in
    // server/content/maps/m39_51.jm2, config forceapproach=north (server/content/scripts/general_use/configs/chests.loc),
    // which the packer turns into 0b1110. Its west neighbour is open ground that reaches it without the flag.
    const chest = { level: 0, x: 2540, z: 3284, width: 1, length: 1, forceapproach: 0b1110, shape: 10, rotation: 0 };
    const reach = (x: number, z: number, l = chest): boolean => siteCollision.reached({ level: 0, x, z }, l);
    expect(siteCollision.walkable(0, 2539, 3284)).toBe(true);
    expect(reach(2539, 3284, { ...chest, forceapproach: 0 })).toBe(true);
    expect(reach(2539, 3284)).toBe(false);
    expect(reach(2540, 3285)).toBe(true);
});

test('a tile in a zone with no collision data is not walkable', () => {
    expect(siteCollision.walkable(0, 1000, 1000)).toBe(false);
});

test('every placed closed diagonal door is a door the walk knows', () => {
    // The collision data's door list has no shape-9 door (conductor/actions/paths.ts EXTRA_DOORS), whose tile stays
    // blocked unless listed; the plain door script opens every door_closed loc (doors/scripts/doors.rs2:1).
    const locs = readConfigs('loc');
    const names = readPack('loc').name;
    const placed = readAllMapSquares().locs.filter(l => {
        const config = l.shape === 9 ? names.get(l.id) : undefined;
        return config !== undefined && first(locs.get(config), 'category') === 'door_closed';
    });
    expect(placed.length).toBeGreaterThan(10);
    for (const { tile, rotation } of placed)
        expect(collisionPaths.doorAt(tile.level, tile.x, tile.z), JSON.stringify(tile)).toMatchObject({
            shape: 9,
            angle: rotation,
        });
});

// A west-wall door in Lumbridge the bundle lists (sdk/collision-data.json doors, masked open), and the Wizards' Tower
// ground-layer door (EXTRA_DOORS), which edited opens as the walk does: whether a step goes through each.
const wall = (): boolean => reachCollision.canStep(0, 3213, 3220, -1, 0);
const STEPS_IN: [number, number][] = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
];
const ground = (): boolean => STEPS_IN.some(([dx, dz]) => reachCollision.canStep(0, 3107 - dx, 3162 - dz, dx, dz));
const doors = (): boolean[] => [wall(), reachCollision.edited({ close: [], open: [] }, ground)];

test('walled shuts every door for its run, a nested edit too, and opens them again after, also after a throw', () => {
    expect(collisionPaths.doorAt(0, 3213, 3220)).toBeDefined();
    expect(doors()).toEqual([true, true]);
    expect(reachCollision.walled!(() => [wall(), ground()])).toEqual([false, false]);
    const wizardsDoor = { tile: { level: 0, x: 3107, z: 3162 }, shape: 9, angle: 3 };
    const westDoor = { tile: { level: 0, x: 3213, z: 3220 }, shape: 0, angle: 0 };
    const nested = reachCollision.walled!(() => {
        const inside = reachCollision.edited({ close: [westDoor, wizardsDoor], open: [] }, () => [wall(), ground()]);
        return [...inside, wall(), ground()];
    });
    expect(nested).toEqual([false, false, false, false]);
    expect(doors()).toEqual([true, true]);
    expect(() =>
        reachCollision.walled!(() => {
            throw new Error('mid-run');
        }),
    ).toThrow('mid-run');
    expect(doors()).toEqual([true, true]);
});
