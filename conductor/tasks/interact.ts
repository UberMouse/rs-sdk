import { z } from 'zod/v4';
import type { InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { INTERACT_WAIT_TICKS, interact, type InteractTarget, optionsOf, targetName } from '../actions/interaction';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, ticks } from '../core/op';
import { AtSchema, matcher, Pattern, walkToSpotStep } from '../lib/spot';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

/** Failed walks or interactions in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Loops (2 ticks each) the target may be out of sight before the task fails. */
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
/** A walk, then one interaction wait: both fit one step. */
const STEP_TIMEOUT_MS = 240_000;
const STUCK_AFTER_MS = stuckWindowMs(
    INTERACT_WAIT_TICKS,
    failStreakTicks(FAIL_LIMIT, INTERACT_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

/** Options that destroy what they are used on: an item target is never sent one. */
const DESTRUCTIVE_ITEM_OPTIONS = ['Drop', 'Destroy', 'Release', 'Empty'];
/** Combat has its own task (HP, food and threat checks); an NPC target is never attacked here. */
const ATTACK_OPTION = 'Attack';

const Params = z.object({
    /** What is interacted with: an NPC or a loc standing near, or an item in the inventory. */
    target: z.enum(['loc', 'npc', 'item']),
    /** Its name (case-insensitive regex). */
    name: Pattern,
    /** The option to send (regex on the option text): "Open", "Search", "Wear", "Talk-to"... */
    option: Pattern,
    /** Where to stand first. */
    at: AtSchema.optional(),
    /**
     * A regex the outcome must match: a game message or dialog page after the send. Without it any state
     * change (a dialog or interface opening, the inventory or worn items changing, ...) is the effect, and
     * a bare message only after a moment with nothing else shown.
     */
    expect: Pattern.optional(),
});

type InteractParams = z.infer<typeof Params>;
type Ctx = TaskContext<InteractParams, object>;

const byDistance = <T extends { distance: number }>(xs: T[]) => xs.sort((a, b) => a.distance - b.distance);

/** What matches `name` in view, nearest first; `unreachable` counts those the client cannot route to. */
function candidates(ctx: Ctx): { targets: InteractTarget[]; unreachable: number } {
    const { target, name } = ctx.params;
    const state = ctx.state();
    const rx = matcher(name);
    if (target === 'item') {
        const items: InventoryItem[] = state.inventory.filter(i => rx.test(i.name));
        return { targets: items.map(item => ({ kind: 'item', item })), unreachable: 0 };
    }
    if (target === 'npc') {
        const named: NearbyNpc[] = state.nearbyNpcs.filter(n => rx.test(n.name));
        const reachable = byDistance(named.filter(n => n.reachable !== false));
        return {
            targets: reachable.map(npc => ({ kind: 'npc', npc })),
            unreachable: named.length - reachable.length,
        };
    }
    const named: NearbyLoc[] = state.nearbyLocs.filter(l => rx.test(l.name));
    const reachable = byDistance(named.filter(l => l.reachable !== false));
    return { targets: reachable.map(loc => ({ kind: 'loc', loc })), unreachable: named.length - reachable.length };
}

/** The tile an NPC or loc target stands on; items have none. */
const tileOf = (t: InteractTarget) =>
    t.kind === 'npc' ? { x: t.npc.x, z: t.npc.z } : t.kind === 'loc' ? { x: t.loc.x, z: t.loc.z } : undefined;

export default defineTask({
    name: 'interact',
    description:
        'One interaction with an NPC, a loc or an inventory item by option, done when its effect is seen. Params: `target` ("loc" | "npc" | "item"), ' +
        '`name` (regex), `option` (regex on the option text, e.g. "Open", "Search", "Wear", "Talk-to"), optional `at` {x,z,level?,tolerance?} ' +
        '(walked to first, across floors and through doors). Picks the nearest reachable match that offers the option. Done once the game shows an effect ' +
        '(a dialog or interface opened, the inventory or worn items changed, an animation, the loc changed; a bare game message only when nothing else shows); optional `expect` ' +
        '(regex) makes only a matching game message or dialog page count. It answers no dialog it opens (use `talk` to converse). Refuses the destructive options ' +
        '(Drop, Destroy, Release, Empty) on an item and Attack on an NPC (use `combat`), and a target in the Wilderness. Fails with the options on offer when the target has none matching, ' +
        'and at once on "I can\'t reach that!", a refusal message ("Nothing interesting happens.", "You need ...") or no effect; only a failed send or a discarded op is retried. ' +
        'E.g. {"target":"loc","name":"^Coffin$","option":"^Open$","at":{"x":3247,"z":3193}}. Uses: wiki/quests/restless-ghost.md.',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const { at, target, option } = ctx.params;
        if (at && squareReachesWilderness(at.x, at.z, 0)) return `(${at.x},${at.z}) is in the Wilderness`;
        // The pattern is checked against the option names themselves: refused if it could match one.
        const rx = matcher(option);
        if (target === 'item' && DESTRUCTIVE_ITEM_OPTIONS.some(o => rx.test(o)))
            return `/${option}/ could send a destructive option (${DESTRUCTIVE_ITEM_OPTIONS.join(', ')}) on an item; use the drop task for dropping`;
        if (target === 'npc' && rx.test(ATTACK_OPTION)) return 'attacking is the combat task, not interact';
        return null;
    },

    steps: [
        walkToSpotStep<InteractParams, object>(FAIL_LIMIT),
        {
            name: 'interact',
            when: () => true,
            *run(ctx) {
                const { target, name, option, expect } = ctx.params;
                const optionRx = matcher(option);
                const { targets, unreachable } = candidates(ctx);
                const missing = ctx.streak('missing');
                const nearest = targets[0];
                if (!nearest) {
                    if (missing.add() >= MISSING_LIMIT)
                        return {
                            fail: `no reachable ${target} /${name}/ in sight${unreachable > 0 ? ` (${unreachable} in view but unreachable from here)` : ''}`,
                        };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const chosen = targets.find(t => optionsOf(t).some(o => optionRx.test(o)));
                if (!chosen) {
                    const offered = optionsOf(nearest).join(' | ') || '(none)';
                    return { fail: `no ${optionRx} option on ${targetName(nearest)}; it offers: ${offered}` };
                }
                const tile = tileOf(chosen);
                if (tile && squareReachesWilderness(tile.x, tile.z, 0))
                    return { fail: `${targetName(chosen)} at (${tile.x},${tile.z}) is in the Wilderness` };
                const r = yield* interact(
                    ctx,
                    chosen,
                    optionRx,
                    expect === undefined ? {} : { expect: matcher(expect) },
                );
                const fails = ctx.streak('interactFails');
                if (r.ok) {
                    fails.reset();
                    return { done: `${option} on ${name}: ${r.effect}` };
                }
                yield* log(`${option} on ${name} failed (${r.reason}): ${r.message}`);
                // Only a send that never landed is worth repeating: an option sent twice can undo itself (Open, Wear).
                if (r.reason !== 'send-failed' && r.reason !== 'rejected') return { fail: `${r.reason}: ${r.message}` };
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} tries in a row failed (last ${r.reason}: ${r.message})` };
            },
        },
    ],
});
