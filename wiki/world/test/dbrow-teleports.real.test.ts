// The runecrafting ruins and their temples' exit portals in the committed world.json (sources/dbrow-teleports.ts,
// gates.ts DBROW_TELEPORTS): a talisman on its ruins takes the player into the temple, each portal lands on its
// runecraft_table row's exit coords, and every altar is reached with its talisman held but the death altar, which no
// ruins lead to.
import { describe, expect, test } from 'bun:test';
import { EXPECTED_UNREACHED } from '../areas';
import { TRANSPORTS_OUT_OF_SCOPE } from '../gates';
import { loadWorld } from '../load';
import { readDbrows } from '../sources/dbrows';
import { coordTile } from '../sources/runescript';
import type { Crossing } from '../types';

const world = loadWorld();
const runes = new Map(
    readDbrows()
        .filter(r => r.table === 'runecraft_table')
        .map(r => [r.row.replace(/^runecraft_/, ''), r]),
);
const rows = world.crossings.filter(c => c.source.startsWith('skill_runecraft/scripts/runecraft.rs2:'));
/** The loc a row's act is done on, `''` for an act on none. */
const locOf = ({ act }: Crossing): string => ('loc' in act ? act.loc : '');
const ruins = (loc: string) => rows.find(c => c.act.kind === 'item-on-loc' && locOf(c) === loc);
/** The rc-altar site of each rune, by its subtype. */
const altars = new Map(
    world.sites.filter(s => s.kind === 'rc-altar').map(s => [world.features[s.features[0]!]!.subtype, s]),
);

describe('the runecrafting ruins', () => {
    test('the air talisman on the air ruins lands in the air temple, and the air altar is reached with it', () => {
        expect(ruins('airtemple_ruined')).toMatchObject({
            via: 'teleport',
            act: { kind: 'item-on-loc', obj: 'air_talisman', loc: 'airtemple_ruined' },
            at: { level: 0, x: 2984, z: 3291 },
            landings: [{ tile: { level: 0, x: 2841, z: 4830 }, spread: 0 }],
            requires: [['item:air_talisman:held']],
        });
        expect(altars.get('air')!.reach).toEqual([['item:air_talisman:held']]);
    });

    test('the law ruins need members and the law talisman; the altar, the boat to Entrana too', () => {
        expect(ruins('lawtemple_ruined')).toMatchObject({
            act: { kind: 'item-on-loc', obj: 'law_talisman', loc: 'lawtemple_ruined' },
            landings: [{ tile: { level: 0, x: 2464, z: 4819 } }],
            requires: [['item:law_talisman:held', 'members']],
        });
        // A members world meets `members` (reach.ts), so the altar's sets leave it out.
        expect(altars.get('law')!.reach).toEqual([['item:law_talisman:held', 'loadout:entrana']]);
    });

    test('every altar but death is reached, each way with its own talisman held', () => {
        const reached = [...altars].filter(([rune]) => rune !== 'death');
        expect(reached).toHaveLength(10);
        for (const [rune, site] of reached) {
            expect([rune, site.reach.length > 0]).toEqual([rune, true]);
            for (const set of site.reach)
                expect([rune, set]).toEqual([rune, expect.arrayContaining([`item:${rune}_talisman:held`])]);
        }
    });

    test('the death altar is not, and areas.ts says why', () => {
        expect(altars.get('death')!.reach).toEqual([]);
        expect(EXPECTED_UNREACHED.some(e => 'area' in e && e.area === 'death-altar')).toBe(true);
    });

    test('they are no longer out of scope', () =>
        expect(
            TRANSPORTS_OUT_OF_SCOPE.filter(o => o.script.startsWith('skill_runecraft/scripts/runecraft.rs2')),
        ).toEqual([]));
});

describe('the temples’ exit portals', () => {
    const portals = rows.filter(c => c.act.kind === 'loc-op' && locOf(c).endsWith('temple_exit_portal'));

    test('one row per placed portal, free', () => {
        expect(portals).toHaveLength(16);
        for (const p of portals) expect(p.requires).toEqual([[]]);
    });

    test("each lands on its row's exit coords: every landing in a coord's ring, every one-tile coord a landing", () => {
        for (const p of portals) {
            const rune = locOf(p).replace(/temple_exit_portal$/, '');
            const exits = runes.get(rune)!.data.exit_coord!.map(([c, lo, hi]) => ({
                tile: coordTile(c!),
                lo: Number(lo),
                hi: Number(hi),
            }));
            const inRing = (t: { level: number; x: number; z: number }) =>
                exits.some(e => {
                    const d = Math.max(Math.abs(t.x - e.tile.x), Math.abs(t.z - e.tile.z));
                    return t.level === e.tile.level && d >= e.lo && d <= e.hi;
                });
            for (const l of p.landings) expect([locOf(p), l.tile, inRing(l.tile)]).toEqual([locOf(p), l.tile, true]);
            for (const e of exits.filter(x => x.hi === 0))
                expect([locOf(p), p.landings.map(l => l.tile)]).toEqual([locOf(p), expect.arrayContaining([e.tile])]);
        }
    });

    test('the air portal lands beside the air ruins', () =>
        expect(portals.find(p => locOf(p) === 'airtemple_exit_portal')!.landings).toEqual([
            { tile: { level: 0, x: 2983, z: 3288 }, spread: 0 },
        ]));
});
