// Reads wiki/world.json, which build.ts writes, as a typed World. The file is generated and committed,
// so a reader needs neither the game data nor the collision data the build loads.
import { readFileSync } from 'fs';
import { WORLD_JSON } from './paths';
import { WORLD_FORMAT, type World } from './types';

/** The world in `file` (default wiki/world.json); throws when it is not a world.json of this format. */
export function loadWorld(file: string = WORLD_JSON): World {
    const world = JSON.parse(readFileSync(file, 'utf8')) as Partial<World>;
    if (world.format !== WORLD_FORMAT)
        throw new Error(
            `${file} has format ${world.format ?? 'none'}, this code reads format ${WORLD_FORMAT}: regenerate it with bun run world`,
        );
    const lists = [world.areas, world.features, world.sites];
    if (typeof world.generatedFrom !== 'string' || !lists.every(Array.isArray))
        throw new Error(`${file} is not a world.json: it needs generatedFrom, areas, features and sites`);
    return world as World;
}
