// A synthetic collision for the reach and distance tests: a grid of land with walls and blocked tiles.
import type { LocReach } from '../place';
import { wallTiles, type ReachCollision } from '../reach';
import type { Tile } from '../types';

export const at = (level: number, x: number, z: number): Tile => ({ level, x, z });
const key = (l: number, x: number, z: number) => `${l} ${x} ${z}`;

/**
 * A 32x32 world at x, z 3200-3231 on levels 0 and 1 (16 zones each), and a column of zones at x 3232-3239
 * the walker allocates but the data does not list (as sdk/pathfinding.ts's mainland fill): walkable, not land.
 * Walls sit on the edge between two tiles; a blocked tile can't be stood on; steps follow rsmod's rule (a
 * diagonal needs both orthogonal steps open).
 */
export class Grid implements ReachCollision {
    readonly zones: [number, number, number][] = [];
    private readonly blocked = new Set<string>();
    private readonly walls = new Set<string>();

    constructor() {
        for (const level of [0, 1])
            for (let x = 3200; x < 3232; x += 8) for (let z = 3200; z < 3232; z += 8) this.zones.push([level, x, z]);
    }

    private inData = (l: number, x: number, z: number) =>
        (l === 0 || l === 1) && x >= 3200 && x < 3232 && z >= 3200 && z < 3232;
    private allocated = (l: number, x: number, z: number) => this.inData(l, x, z) || (l === 0 && x >= 3232 && x < 3240);

    block(...tiles: Tile[]): this {
        for (const t of tiles) this.blocked.add(key(t.level, t.x, t.z));
        return this;
    }
    /** A wall between `t` and its neighbour by (dx, dz). */
    wall(t: Tile, dx: number, dz: number): this {
        this.walls.add(`${key(t.level, t.x, t.z)} ${dx} ${dz}`);
        this.walls.add(`${key(t.level, t.x + dx, t.z + dz)} ${-dx} ${-dz}`);
        return this;
    }
    /** A wall along the west edge of column x, from z1 to z2, but for the gaps. */
    wallColumn(x: number, z1: number, z2: number, gaps: number[] = []): this {
        for (let z = z1; z <= z2; z++) if (!gaps.includes(z)) this.wall(at(0, x, z), -1, 0);
        return this;
    }
    /** Walls all round the box (x1, z1)-(x2, z2) on level 0. */
    room(x1: number, z1: number, x2: number, z2: number): this {
        for (let x = x1; x <= x2; x++) this.wall(at(0, x, z1), 0, -1).wall(at(0, x, z2), 0, 1);
        for (let z = z1; z <= z2; z++) this.wall(at(0, x1, z), -1, 0).wall(at(0, x2, z), 1, 0);
        return this;
    }

    walkable = (l: number, x: number, z: number) => this.allocated(l, x, z) && !this.blocked.has(key(l, x, z));
    land = (l: number, x: number, z: number) => this.inData(l, x, z);
    private open = (l: number, x: number, z: number, dx: number, dz: number) =>
        this.walkable(l, x + dx, z + dz) && !this.walls.has(`${key(l, x, z)} ${dx} ${dz}`);
    canStep = (l: number, x: number, z: number, dx: number, dz: number): boolean => {
        if (!dx || !dz) return this.open(l, x, z, dx, dz);
        return (
            this.open(l, x, z, dx, 0) &&
            this.open(l, x, z, 0, dz) &&
            this.open(l, x + dx, z, 0, dz) &&
            this.open(l, x, z + dz, dx, 0)
        );
    };
    /**
     * A line of walk or sight (sources/dbrow-teleports.ts TeleportCollision), both read alike here: a run of
     * `canStep` steps from (x, z) to (tx, tz), diagonal while both coordinates differ.
     */
    line = (_kind: 'walk' | 'sight', l: number, x: number, z: number, tx: number, tz: number): boolean => {
        while (x !== tx || z !== tz) {
            const [dx, dz] = [Math.sign(tx - x), Math.sign(tz - z)];
            if (!this.canStep(l, x, z, dx, dz)) return false;
            [x, z] = [x + dx, z + dz];
        }
        return true;
    };
    /** A wall is used from its two tiles (place.ts's reach test); any other loc from a tile sharing an edge. */
    reached = (from: Tile, l: LocReach): boolean => {
        if (l.shape === 0) {
            const [a, b] = wallTiles({ tile: l, shape: 0, angle: l.rotation })!;
            return [a, b].some(t => t.x === from.x && t.z === from.z);
        }
        const [w, len] = l.rotation % 2 === 1 ? [l.length, l.width] : [l.width, l.length];
        const dx = from.x < l.x ? l.x - from.x : from.x > l.x + w - 1 ? from.x - (l.x + w - 1) : 0;
        const dz = from.z < l.z ? l.z - from.z : from.z > l.z + len - 1 ? from.z - (l.z + len - 1) : 0;
        return dx + dz === 1;
    };
    edited = <T>(edits: Parameters<ReachCollision['edited']>[0], f: () => T): T => {
        const added: string[] = [];
        const cleared: string[] = [];
        for (const { tile, shape, angle } of edits.close) {
            const [a, b] = wallTiles({ tile, shape, angle })!;
            const edge = `${key(a.level, a.x, a.z)} ${b.x - a.x} ${b.z - a.z}`;
            if (shape !== 0 || this.walls.has(edge)) continue;
            this.wall(a, b.x - a.x, b.z - a.z);
            added.push(edge, `${key(b.level, b.x, b.z)} ${a.x - b.x} ${a.z - b.z}`);
        }
        for (const { tile, width, length } of edits.open)
            for (let x = tile.x; x < tile.x + width; x++)
                for (let z = tile.z; z < tile.z + length; z++)
                    if (this.blocked.delete(key(tile.level, x, z))) cleared.push(key(tile.level, x, z));
        try {
            return f();
        } finally {
            for (const e of added) this.walls.delete(e);
            for (const t of cleared) this.blocked.add(t);
        }
    };
}
