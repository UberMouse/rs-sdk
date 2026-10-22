// The formula families by id. Adding one is a module beside these, its line here, and its tests.
import type { Family } from '../family';
import type { FamilyFactory, GameData } from './common';
import { agility } from './agility';
import { cooking } from './cooking';
import { firemaking } from './firemaking';
import { fishing } from './fishing';
import { fletching } from './fletching';
import { mining } from './mining';
import { pick } from './pick';
import { pickpocket } from './pickpocket';
import { smelting } from './smelting';
import { smithing } from './smithing';
import { spinning } from './spinning';
import { stall } from './stall';
import { superheat } from './superheat';
import { woodcutting } from './woodcutting';

export { readGameData, type GameData } from './common';

export const FAMILIES: Readonly<Record<string, FamilyFactory>> = {
    agility,
    cooking,
    firemaking,
    fishing,
    fletching,
    mining,
    pick,
    pickpocket,
    smelting,
    smithing,
    spinning,
    stall,
    superheat,
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
