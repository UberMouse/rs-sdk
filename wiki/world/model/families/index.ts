// The formula families by id. Adding one is a module beside these, its line here, and its tests.
import type { Family } from '../family';
import type { FamilyFactory, GameData } from './common';
import { cooking } from './cooking';
import { fishing } from './fishing';
import { mining } from './mining';
import { pickpocket } from './pickpocket';
import { stall } from './stall';
import { woodcutting } from './woodcutting';

export { readGameData, type GameData } from './common';

export const FAMILIES: Readonly<Record<string, FamilyFactory>> = {
    cooking,
    fishing,
    mining,
    pickpocket,
    stall,
    woodcutting,
};

/** Every family built from `data`, by id; a module whose `id` is not its key throws. */
export function buildFamilies(data: GameData): Map<string, Family> {
    return new Map(
        Object.entries(FAMILIES).map(([id, make]) => {
            const family = make(data);
            if (family.id !== id) throw new Error(`Family registered as ${id} calls itself ${family.id}`);
            return [id, family];
        }),
    );
}
