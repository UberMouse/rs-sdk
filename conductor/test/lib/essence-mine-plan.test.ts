// The planner on the real world index: the essence mine's portals return to the wizard the way came in by, so a plan
// never goes in by one wizard and out to another's (the Seers' bank walk looped Wizards' Tower -> mine -> Ardougne).
import { describe, expect, test } from 'bun:test';
import { ANY_CAME_FROM, cameFrom } from '../../../wiki/world/requirements';
import { walkAccount } from '../../actions/walk';
import { meetsToken, type Account } from '../../lib/account';
import { CONNECTORS, MAX_HOPS } from '../../lib/connectors';
import { world } from '../world';
import { nearestWay, type Hop } from '../../lib/walk-graph';

const account = (met: string[]): Account => ({
    levels: { magic: 1, runecraft: 1 },
    coins: 100,
    met: new Set(['quest:runemysteries', ...met]),
});
const plan = (from: { x: number; z: number }, to: { x: number; z: number }, met: string[] = []) =>
    nearestWay(
        { level: 0, x: from.x, z: from.z },
        Array.from({ length: 49 }, (_, i) => ({ level: 0, x: to.x + (i % 7) - 3, z: to.z + Math.floor(i / 7) - 3 })),
        {
            account: account(met),
            connectors: CONNECTORS,
            maxHops: MAX_HOPS,
        },
    );
const crossings = (hops: readonly Hop[] | undefined) => (hops ?? []).flatMap(h => (h.kind === 'cross' ? [h.move] : []));
const usesMine = (hops: readonly Hop[] | undefined) =>
    crossings(hops).some(
        m =>
            (m.act.kind === 'npc-op' && /wizard|aubury/.test(m.act.npc)) ||
            (m.act.kind === 'loc-op' && /exit_portal/.test(m.act.loc)),
    );

const out = (x: number, z: number, learned: string[] = []) =>
    walkAccount(world().player({ at: { x, z } }).build(), learned);

const SEERS_BANK = { x: 2617, z: 3331 };
const MINE = { x: 2884, z: 4850 };

describe('the essence mine in the planner', () => {
    test.each([
        ['Draynor', { x: 3092, z: 3243 }],
        ['Lumbridge', { x: 3222, z: 3218 }],
        ['the Wizards Tower', { x: 3109, z: 3162 }],
    ])('from %s to the Seers bank, the plan does not use the mine', (_, from) => {
        const w = plan(from, SEERS_BANK);
        expect(w).toBeDefined();
        expect(usesMine(w!.hops)).toBe(false);
    });

    test('a bot inside the mine with no wizard on record can plan its way out', () => {
        const w = plan(MINE, SEERS_BANK, [ANY_CAME_FROM]);
        expect(w).toBeDefined();
        expect(crossings(w!.hops).some(m => m.act.kind === 'loc-op' && /exit_portal/.test(m.act.loc))).toBe(true);
    });

    test('inside the mine and not known to be there, no portal is planned', () => {
        expect(plan(MINE, SEERS_BANK)).toBeUndefined();
    });

    test('a bot that came in by Sedridor plans out to Sedridor only', () => {
        const w = plan(MINE, SEERS_BANK, [cameFrom('head_wizard')]);
        expect(w).toBeDefined();
        const portal = w!.hops.find(h => h.kind === 'cross' && h.move.act.kind === 'loc-op');
        expect(portal?.kind).toBe('cross');
        if (portal?.kind !== 'cross') return;
        expect(portal.requires.flat()).toContain(cameFrom('head_wizard'));
        // It lands by the Wizards' Tower, not by the Ardougne wizard nearer the destination.
        expect(portal.landing.x).toBeGreaterThan(3000);
    });

    test("a walk's account meets a way out only inside the mine, or for the wizard it learned", () => {
        const portal = cameFrom('aubury');
        expect(meetsToken(out(3092, 3243), portal)).toBe(false);
        expect(meetsToken(out(2884, 4850), portal)).toBe(true);
        expect(meetsToken(out(2884, 4850, [cameFrom('head_wizard')]), portal)).toBe(false);
        expect(meetsToken(out(2884, 4850, [portal]), portal)).toBe(true);
    });
});
