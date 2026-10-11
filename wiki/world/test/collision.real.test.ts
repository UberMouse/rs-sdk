import { expect, test } from 'bun:test';
import { siteCollision } from '../collision';

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
