// The generated world index (wiki/world.json, `bun run world`), read once, synchronously, when this module is first
// imported. lib/connectors.ts and lib/banks.ts are views of it. A missing file, one of another format, or one built
// from other game data than server/content holds now throws here, at import, with the regenerate hint: a stale index
// would walk bots to stairs and banks that are not there.
import { loadFreshWorld } from '../../wiki/world/load';
import type { World } from '../../wiki/world/types';

export const WORLD: World = loadFreshWorld();
