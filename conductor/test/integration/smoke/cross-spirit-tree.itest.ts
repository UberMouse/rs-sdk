import { expect, test } from 'bun:test';
import { itestTimeout, withFixtureBot } from '../harness';
import { detail, here, walkLive, WALKS_MS } from './crossing';

// Tree Gnome Village done (%treequest, varp 111, at ^tree_complete): its spirit tree (stronghold_ent) sends the player
// to the trees its menu names (areas/area_gnome/scripts/spirit_tree.rs2:42), on a members world. Beside the tree, where
// its own teleport lands (^village_tree); the young tree north of Varrock's landing (^varrock_tree).
const TREE_GNOME_VILLAGE = { 111: 9 };
const VILLAGE_TREE = { x: 2542, z: 3170 };
const VARROCK_TREE = { x: 3179, z: 3507 };

test(
    'walkTo asks the Tree Gnome Village spirit tree for the forest north of Varrock, answering its menu',
    async () => {
        await withFixtureBot({ position: VILLAGE_TREE, varps: TREE_GNOME_VILLAGE }, async ({ sdk }) => {
            const way = await walkLive(sdk, VARROCK_TREE, { tolerance: 3, met: ['quest:tree'] });
            expect(way.result.ok, detail(way)).toBe(true);
            expect(here(sdk).x, detail(way)).toBeGreaterThan(3100);
            expect(
                way.logs.some(l => /crossed loc-op 1 stronghold_ent/.test(l)),
                detail(way),
            ).toBe(true);
            expect(way.sent, detail(way)).toContain('Forest north of Varrock.');
        });
    },
    itestTimeout({ extraMs: WALKS_MS }),
);
