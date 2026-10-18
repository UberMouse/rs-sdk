import { describe, expect, test } from 'bun:test';
import { type Account, NO_ACCOUNT } from '../../lib/account';
import { BANKS, bankArea, nearestBank } from '../../lib/banks';
import { CONNECTORS, MAX_HOPS } from '../../lib/connectors';
import { nearestWay } from '../../lib/walk-graph';
import { WORLD } from '../../lib/world-index';

const at = (level: number, x: number, z: number) => ({ level, x, z });
const bank = (name: string) => {
    const b = BANKS.find(k => k.name === name);
    if (!b) throw new Error(`no bank ${name}`);
    return b;
};
const account = (a: Partial<Account>): Account => ({ ...NO_ACCOUNT, ...a });

describe('BANKS is every bank site of world.json', () => {
    test('one per site with a stand, named by its area, on any level, members ones included', () => {
        const sites = WORLD.sites.filter(s => s.kind === 'bank' && s.stand);
        expect(BANKS.map(b => b.id)).toEqual(sites.map(s => s.id));
        const names = BANKS.map(b => b.name);
        for (const n of ['Varrock West', 'Varrock East', 'Falador West', 'Falador East', 'Edgeville', 'Al Kharid'])
            expect(names).toContain(n);
        // Members-only, upstairs and underground banks are rows too.
        expect(bank('Catherby').stand).toEqual(at(0, 2809, 3441));
        expect(bank("Legends' Guild").stand.level).toBe(2);
        expect(bank('Zanaris').stand.z).toBeGreaterThan(6400);
    });

    test('the curated facts stay: Draynor is never picked, Varrock West keeps its stand; Al Kharid is not curated out', () => {
        expect(bank('Draynor')).toMatchObject({ auto: false, skip: expect.stringMatching(/dark wizards/) });
        expect(bank('Varrock West').stand).toEqual(at(0, 3185, 3436));
        expect(bank('Al Kharid')).toMatchObject({ auto: true, reach: [[]] });
        expect(BANKS.filter(b => !b.auto).map(b => b.name)).toEqual(['Draynor']);
    });

    test('bankArea is the stand, on its level, with the walk radius', () => {
        expect(bankArea(bank("Legends' Guild"))).toEqual({ ...bank("Legends' Guild").stand, radius: 3 });
    });
});

describe('nearestBank: the fewest run ticks a walk takes, to a bank the account can use', () => {
    test('never Draynor, even from its booths', () => {
        expect(nearestBank(at(0, 3092, 3243))?.name).toBe('Falador East');
    });

    test('Al Kharid from its own booths: the toll is a requirement of the way there, not a reason to skip it', () => {
        expect(nearestBank(at(0, 3269, 3167))?.name).toBe('Al Kharid');
    });

    test('from Lumbridge: Varrock West on foot, Al Kharid through the toll gate with 10 coins', () => {
        expect(nearestBank(at(0, 3222, 3222))?.name).toBe('Varrock West');
        expect(nearestBank(at(0, 3222, 3222), account({ coins: 9 }))?.name).toBe('Varrock West');
        expect(nearestBank(at(0, 3222, 3222), account({ coins: 10 }))?.name).toBe('Al Kharid');
    });

    test('a bank inside a town picks itself; a members town its own bank', () => {
        expect(nearestBank(at(0, 3182, 3436))?.name).toBe('Varrock West');
        expect(nearestBank(at(0, 2950, 3370))?.name).toBe('Falador West');
        expect(nearestBank(at(0, 2743, 3445))?.name).toBe("Seers' Village");
    });

    test("a bank behind a skill door only with the level: the Fishing Guild's at Fishing 68", () => {
        const outside = at(0, 2603, 3405);
        expect(nearestBank(outside)?.name).toBe('Ardougne North');
        expect(nearestBank(outside, account({ levels: { fishing: 67 } }))?.name).toBe('Ardougne North');
        expect(nearestBank(outside, account({ levels: { fishing: 68 } }))?.name).toBe('Fishing Guild');
    });

    test("a quest's bank only when the caller says it is done: the Legends' Guild, upstairs", () => {
        const gate = at(0, 2729, 3345);
        expect(nearestBank(gate)?.name).toBe('Ardougne South');
        expect(nearestBank(gate, account({ met: new Set(['quest:legends']) }))?.name).toBe("Legends' Guild");
    });

    test('Zanaris is through the shed, a jump the walker makes (actions/cross.ts) with a dramen staff worn', () => {
        const shed = at(0, 3201, 3169);
        expect(nearestBank(shed, account({ worn: new Set(['dramen_staff']) }))?.name).toBe('Zanaris');
        expect(nearestBank(shed)?.name).not.toBe('Zanaris');
    });

    test("from a booth's own tile a step leads off it; from the bankers' side or off the map there is none", () => {
        // Varrock West's booths stand at x 3186: a blocked tile, but the line of walk off it is open.
        expect(nearestBank(at(0, 3186, 3438))?.name).toBe('Varrock West');
        // Behind the counter (the bankers' side, x 3187..3190) no walk leads out.
        expect(nearestBank(at(0, 3190, 3440))).toBeUndefined();
        expect(nearestBank(at(0, 0, 0))).toBeUndefined();
    });

    test('underground: the Edgeville Dungeon to Edgeville by the trapdoor ladder', () => {
        expect(nearestBank(at(0, 3108, 9835))?.name).toBe('Edgeville');
    });

    test('from inside the Wilderness the way out is walked (only a walk from outside never crosses it)', () => {
        expect(nearestBank(at(0, 3092, 3530))?.name).toBe('Edgeville');
    });
});

describe("the walk's ticks are wiki/world/distance.ts's", () => {
    // wiki/world/distance.ts computed each site's nearest bank over the same graph; the walk agrees where its way
    // takes only what a walk does. The banks as world.json has them (no curated stand).
    const stands = WORLD.sites.filter(s => s.kind === 'bank' && s.stand && s.reach.length).map(s => s.stand!);
    const ids = WORLD.sites.filter(s => s.kind === 'bank' && s.stand && s.reach.length).map(s => s.id);
    for (const id of [
        'tree:draynor-willows:0',
        'range:catherby:0',
        'furnace:falador:0',
        'fishing-spot:al-kharid-river:0',
        'tree:east-ardougne:9',
        'range:edgeville:0',
        'rock:edgeville-dungeon:0',
        'rock:varrock-west-mine:0',
    ])
        test(id, () => {
            const site = WORLD.sites.find(s => s.id === id)!;
            const way = nearestWay(site.stand!, stands, {
                account: NO_ACCOUNT,
                connectors: CONNECTORS,
                maxHops: MAX_HOPS,
            });
            expect({ site: ids[way!.target], runTicks: way!.runTicks }).toEqual({
                site: site.nearest!.bank!.site,
                runTicks: site.nearest!.bank!.runTicks,
            });
        });
});
