// Reads wiki/world.json, which build.ts writes, as a typed World. The file is generated and committed,
// so a reader needs neither the game data nor the collision data the build loads.
import { readFileSync } from 'fs';
import { WORLD_JSON } from './paths';
import type { World } from './types';

/** The world in `file` (default wiki/world.json); throws when it is not a world.json. */
export function loadWorld(file: string = WORLD_JSON): World {
    const world = JSON.parse(readFileSync(file, 'utf8')) as Partial<World>;
    const lists = [world.areas, world.features, world.sites];
    if (typeof world.generatedFrom !== 'string' || !lists.every(Array.isArray))
        throw new Error(`${file} is not a world.json: it needs generatedFrom, areas, features and sites`);
    return world as World;
}
