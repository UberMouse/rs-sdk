// Reads wiki/world.json, which build.ts writes, as a typed World. The file is generated and committed,
// so a reader needs neither the game data nor the collision data the build loads.
import { readFileSync } from 'fs';
import { contentHash } from './content-hash';
import { WORLD_JSON } from './paths';
import { WORLD_FORMAT, type World } from './types';

/** A parsed JSON object, its fields not yet checked. */
type Parsed = { [key: string]: unknown };

const isObject = (x: unknown): x is Parsed => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Whether `x` is a world.json of this format: its format, a string generatedFrom, the eight lists and
 * the loadoutRules object. Their items are taken as build.ts wrote them.
 */
const isWorld = (x: Parsed): x is Parsed & World =>
    x.format === WORLD_FORMAT &&
    typeof x.generatedFrom === 'string' &&
    [x.areas, x.features, x.sites, x.npcSpawns, x.connectors, x.quests, x.transports, x.gates].every(Array.isArray) &&
    isObject(x.loadoutRules);

/** The world in `file` (default wiki/world.json); throws when it is not a world.json of this format. */
export function loadWorld(file: string = WORLD_JSON): World {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        throw new Error(`${file} is not valid JSON (${e.message}): regenerate it with bun run world`, { cause: e });
    }
    const world: Parsed = isObject(parsed) ? parsed : {};
    if (world.format !== WORLD_FORMAT)
        throw new Error(
            `${file} has format ${String(world.format ?? 'none')}, this code reads format ${WORLD_FORMAT}: regenerate it with bun run world`,
        );
    if (!isWorld(world))
        throw new Error(
            `${file} is not a world.json: it needs generatedFrom, areas, features, sites, npcSpawns, connectors, quests, loadoutRules, transports and gates`,
        );
    return world;
}

/**
 * The world in `file`, refusing one built from other game data than server/content holds now (`hash`,
 * default contentHash()): its locations would be stale. The generators of wiki/npcs and wiki/shops
 * read it through here.
 */
export function loadFreshWorld(file: string = WORLD_JSON, hash: () => string = contentHash): World {
    const world = loadWorld(file);
    const now = hash();
    if (world.generatedFrom !== now)
        throw new Error(
            `${file} was built from server/content at ${world.generatedFrom}, which is now at ${now} ` +
                `(server/content may have uncommitted changes): regenerate it with bun run world`,
        );
    return world;
}
