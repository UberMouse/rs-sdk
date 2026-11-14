// The promoted plans that branch on why the previous phase ended read its outcome code, not its reason.
import { describe, expect, test } from 'bun:test';
import type { PlanDef, PlanView } from '../../lib/plan';
import clockTower from '../../plans/clock-tower';
import monksFriend from '../../plans/monks-friend';
import trollStronghold from '../../plans/troll-stronghold';

type Last = NonNullable<PlanView['last']>;

/** A view with only what these predicates read: a player on `at`, no dialog unless `dialogOpen`. */
const view = (last: Last | null, opts: { at?: [number, number]; dialogOpen?: boolean } = {}): PlanView => {
    const [worldX, worldZ] = opts.at ?? [3200, 3200];
    return {
        state: {
            player: { worldX, worldZ, level: 0, combat: { inCombat: false } },
            dialog: { isOpen: opts.dialogOpen ?? false },
            recentDialogs: [],
            gameMessages: [],
            nearbyNpcs: [],
        },
        runs: () => 0,
        last,
    } as unknown as PlanView;
};

const when = (plan: PlanDef, phase: string, v: PlanView): boolean => {
    const p = plan.phases.find(x => x.name === phase);
    if (!p?.when) throw new Error(`${plan.name} has no phase "${phase}" with a when`);
    return p.when(v);
};

const fight = (last: Last) => when(clockTower, 'fight', view(last));

describe('clock-tower: a fetch cut short by an attack goes to the fight', () => {
    test("pickup's attacked failure", () => {
        const last: Last = {
            phase: 'get-red',
            status: 'failed',
            reason: 'attacked: attacked while picking up at (2583,9613)',
            code: 'attacked',
        };
        expect(fight(last)).toBe(true);
    });

    test("the under-attack guard's wording the reason match missed", () => {
        const reason = 'interrupt:under-attack: under attack by an unknown attacker for 40 ticks at (2613,9639)';
        expect(fight({ phase: 'get-black', status: 'failed', reason, code: 'attacked' })).toBe(true);
        expect(fight({ phase: 'get-black', status: 'failed', reason, endedBy: 'interrupt:under-attack' })).toBe(false);
    });

    test('a failure with another code, or none, does not', () => {
        const reason = 'attacked: attacked while picking up at (2583,9613)';
        expect(fight({ phase: 'get-red', status: 'failed', reason })).toBe(false);
        expect(fight({ phase: 'get-red', status: 'failed', reason: 'x', code: 'died' })).toBe(false);
    });
});

describe("troll-stronghold: Dad's fight ending on his dialog", () => {
    const DAD_DIALOG = 'dad: dialog opened: Not hurt Dad! | Click here to continue';
    const outsideArena = { at: [2900, 3590] as [number, number], dialogOpen: true };

    test('the dialog-coded ending with his line goes to dad-end, not the generic dialog phase', () => {
        const v = view({ phase: 'dad', status: 'done', reason: DAD_DIALOG, code: 'dialog' }, outsideArena);
        expect(when(trollStronghold, 'dad-end', v)).toBe(true);
        expect(when(trollStronghold, 'dialog', v)).toBe(false);
    });

    test('his line in a reason without the code, or another dialog with it, does not', () => {
        const uncoded = view({ phase: 'dad', status: 'failed', reason: DAD_DIALOG }, outsideArena);
        expect(when(trollStronghold, 'dad-end', uncoded)).toBe(false);
        expect(when(trollStronghold, 'dialog', uncoded)).toBe(true);
        const other = view(
            { phase: 'dad', status: 'done', reason: 'dad: dialog opened: Who goes there?', code: 'dialog' },
            outsideArena,
        );
        expect(when(trollStronghold, 'dad-end', other)).toBe(false);
    });
});

describe('monks-friend: Omad out of reach behind the chapel door sends the plan to open it', () => {
    const inside = { at: [2604, 3209] as [number, number] };
    const door = (last: Last) => when(monksFriend, 'omad-door', view(last, inside));

    test("talk's and interact's unreachable failures", () => {
        const talk = 'talk: no reachable /^Brother Omad$/ in sight (1 in view but unreachable from here)';
        expect(door({ phase: 'party', status: 'failed', reason: talk, code: 'unreachable' })).toBe(true);
        const interact = 'interact: no reachable loc /^Door$/ in sight (1 in view but unreachable from here)';
        expect(door({ phase: 'omad-door', status: 'failed', reason: interact, code: 'unreachable' })).toBe(true);
    });

    test("a walk's no-path failure, whose reason says unreachable but has no code, does not", () => {
        const reason =
            'walk: No path to (2614, 3259) from (2604, 3209): Destination (2614, 3259) is unreachable — path ends 3 tiles away';
        expect(door({ phase: 'cedric-ask', status: 'failed', reason })).toBe(false);
    });
});
