import { z } from 'zod/v4';
import type { InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import {
    INTERACT_WAIT_TICKS,
    interact,
    SETTLE_MAX_TICKS,
    SETTLE_STABLE_TICKS,
    type InteractTarget,
    optionsOf,
    targetName,
    useOn,
    useOnNpc,
} from '../actions/interaction';
import { CONVERSE_MAX_TICKS, converse, type TalkProgress } from '../actions/talk';
import { log, send, ticks } from '../core/op';
import { foodCount } from '../lib/interrupts';
import {
    AtSchema,
    ItemSpec,
    itemLabel,
    missingItem,
    itemMatches,
    matcher,
    onTile,
    patternParam,
    TileSchema,
    walkToSpotSilentTicks,
    walkToSpotStep,
} from '../lib/spot';
import { failStreak, MISSING_WAIT_TICKS, missingTargetStreak } from '../lib/streak';
import { defineTask, type TaskContext } from '../lib/task';
import { squareReachesWilderness, WILDERNESS_MIN_FOOD, wildernessFoodRefusal } from '../lib/wilderness';

/** Failed walks or interactions in a row before the task fails. */
const FAIL_LIMIT = 3;
const MISSING = missingTargetStreak('missing');
// One failed interaction: the wait for its effect (INTERACT_WAIT_TICKS, which includes the walk up to the target).
const INTERACT_FAILS = failStreak({ name: 'interactFails', limit: FAIL_LIMIT, worstTicks: INTERACT_WAIT_TICKS });
/** One interaction wait, its settle and the dialog answers it opens (CONVERSE_MAX_TICKS) fit one step; the walk is a step of its own. */
const STEP_TIMEOUT_MS = 360_000;
const SILENT = [CONVERSE_MAX_TICKS, INTERACT_WAIT_TICKS, INTERACT_FAILS, MISSING, walkToSpotSilentTicks(FAIL_LIMIT)];

/** Options that destroy what they are used on: refused for an item target unless `opIndex` + `allowDestructiveOption` name the op. */
const DESTRUCTIVE_ITEM_OPTIONS = ['Drop', 'Destroy', 'Release', 'Empty'];
/** Whether a published option label destroys or releases the item ("Release All" counts: it starts with "Release"). */
const isDestructiveLabel = (label: string) =>
    DESTRUCTIVE_ITEM_OPTIONS.some(o => label.trim().toLowerCase().startsWith(o.toLowerCase()));
/** Combat has its own task (HP, food and threat checks); an NPC target is never attacked here. */
const ATTACK_OPTION = 'Attack';

const Params = z
    .object({
        target: z
            .enum(['loc', 'npc', 'item'])
            .describe('What is interacted with: an NPC or a loc standing near, or an item in the inventory.'),
        name: patternParam("The target's name."),
        option: patternParam('The option to send, by its text: "Open", "Search", "Wear", "Talk-to"...').optional(),
        at: AtSchema.optional(),
        expect: patternParam(
            'The outcome to wait for: only a game message or dialog page matching it after the send is the effect, so it ' +
                'is the way to wait for a specific later message. Without it the effect is any state change: a dialog or ' +
                'interface opened, a message box (the Chaos altar Check), the inventory or worn items changed (so any ' +
                'inventory change ends a `use`), an animation, the loc changed, or the player moved by the game (a ' +
                'teleport, swim, door pass-through, gangplank or whistle); a bare game message only when nothing else ' +
                'shows. Pass it (e.g. "you milk the cow") when the exact outcome matters.',
        ).optional(),
        tile: TileSchema.optional().describe(
            'The exact tile of the loc or NPC, instead of the nearest one of that name: one of six pillars, a crate beside plain crates, one of three "Ledge" locs. A loc\'s tile is its south-west corner.',
        ),
        npcId: z
            .union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)])
            .optional()
            .describe(
                'Only NPCs of this type id, or of one of these (NearbyNpc.id, the config id in server/content/pack/npc.pack), among those `name` matches: the woolly Sheep (43) beside a sheared one (42), both named "Sheep".',
            ),
        opIndex: z
            .number()
            .int()
            .min(1)
            .max(5)
            .optional()
            .describe(
                "Send the inventory op at this index (the `opIndex` of the item's published options) instead of the first option matching `option`, which still names the label expected there: the run fails naming the real label when the published op does not match it. For items whose server script differs from the label the client publishes.",
            ),
        allowDestructiveOption: z
            .boolean()
            .default(false)
            .describe(
                `Send an \`opIndex\` op whose published label destroys or releases the item (${DESTRUCTIVE_ITEM_OPTIONS.join(', ')}, or a label starting with one, such as Release All); without it such an op is refused.`,
            ),
        unreachable: z
            .boolean()
            .default(false)
            .describe(
                'Also take a target the client cannot route to (an islet in a river, a rock across water: a swim, a rope thrown across) and send the op from the stand tile `at`, leaving the reach check to the server.',
            ),
        use: z
            .object({ item: ItemSpec })
            .optional()
            .describe(
                `Use this inventory item on the loc or NPC instead of sending an option: a key on a door, a rope on a rock, a rune on a pillar, an empty bucket on a cow. A use the server discarded is sent again (to another match, for an NPC; "This sheep has already been shorn." also moves on to another), up to ${FAIL_LIMIT} tries in a row; one that got a message or no effect is not.`,
            ),
        choices: z
            .array(patternParam('The option to click at one multi-option page, by its text.'))
            .default([])
            .describe(
                "Answers the dialog the interaction itself opens, as `talk`'s `choices`: one per multi-option page, in order; continue pages pass by themselves. The task is done once that dialog has closed after the last choice; the interaction must open one (else the run fails saying it opened none), and the dialog guard is off for the run. Without it no dialog is answered: the guard clicks continue pages away and declines a choice (use `talk` to converse).",
            ),
        wilderness: z
            .boolean()
            .default(false)
            .describe(
                'Opt in to a target (and `at`) in the Wilderness: the Wilderness guard stands down, the bot eats at low HP and death still ends the run, as `travel` does. Carry only food and no valuables: the bot is left in the Wilderness, so whatever runs next (a plan phase, a `travel` out) must opt in too.',
            ),
        minFood: z
            .number()
            .int()
            .min(0)
            .default(WILDERNESS_MIN_FOOD)
            .describe('The food count for `wilderness` (at least 1 whatever is set).'),
    })
    .refine(p => (p.option === undefined) !== (p.use === undefined), 'give an option, or a use (not both)')
    .refine(p => p.use === undefined || p.target === 'loc' || p.target === 'npc', 'a use works on a loc or an NPC')
    .refine(p => p.tile === undefined || p.target !== 'item', 'a tile picks a loc or an NPC, not an inventory item')
    .refine(p => p.npcId === undefined || p.target === 'npc', 'npcId picks an NPC type, so it needs target "npc"')
    .refine(
        p => p.opIndex === undefined || p.target === 'item',
        'opIndex picks an inventory op, so it needs target "item"',
    )
    .refine(
        p => p.opIndex === undefined || p.option !== undefined,
        'opIndex needs `option`: the label expected at that index',
    )
    .refine(
        p => !p.allowDestructiveOption || p.opIndex !== undefined,
        'allowDestructiveOption only applies to an `opIndex` op: give opIndex, or drop it',
    )
    .refine(
        p => !p.unreachable || (p.at !== undefined && p.target !== 'item'),
        'unreachable needs `at` and a loc or NPC',
    );

type InteractParams = z.infer<typeof Params>;
interface Memory {
    /**
     * Indexes of NPCs a use was sent to that the server discarded (per run): the retry takes another.
     * When every match is refused the choice falls back to the nearest one. Option interactions never record here.
     */
    refusedNpcs: number[];
    /** The option or use landed (`choices` set only): a cut-off step must not send it again; only the `choices` are left to answer. */
    sent: boolean;
    /** The send was started (`choices` set only): a cut-off step that finds the dialog open treats it as landed. */
    tried: boolean;
    /** A destructive `opIndex` op was sent (set just before the send): a cut-off step must never send it again. */
    destructiveSent: boolean;
    /** Choices answered in the dialog the interaction opened. */
    progress: TalkProgress;
}
type Ctx = TaskContext<InteractParams, Memory>;

const byDistance = <T extends { distance: number }>(xs: T[]) => xs.sort((a, b) => a.distance - b.distance);

/** What matches `name` (and `tile`) in view, nearest first; `unreachable` counts those the client cannot route to and the task leaves. */
function candidates(ctx: Ctx): { targets: InteractTarget[]; unreachable: number } {
    const { target, name, tile, npcId, unreachable: takeUnreachable } = ctx.params;
    const ids = npcId === undefined ? undefined : [npcId].flat();
    const state = ctx.state();
    const rx = matcher(name);
    if (target === 'item') {
        const items: InventoryItem[] = state.inventory.filter(i => rx.test(i.name));
        return { targets: items.map(item => ({ kind: 'item', item })), unreachable: 0 };
    }
    if (target === 'npc') {
        const named: NearbyNpc[] = state.nearbyNpcs.filter(
            n => rx.test(n.name) && (!ids || ids.includes(n.id)) && (!tile || onTile(npcTile(n), tile)),
        );
        const usable = byDistance(named.filter(n => takeUnreachable || n.reachable !== false));
        return { targets: usable.map(npc => ({ kind: 'npc', npc })), unreachable: named.length - usable.length };
    }
    const named: NearbyLoc[] = state.nearbyLocs.filter(l => rx.test(l.name) && (!tile || onTile(l, tile)));
    const usable = byDistance(named.filter(l => takeUnreachable || l.reachable !== false));
    return { targets: usable.map(loc => ({ kind: 'loc', loc })), unreachable: named.length - usable.length };
}

/** The distinct problems of the held stacks, as one message (preflight and the step word it the same). */
const joinProblems = (problems: (string | null)[]) => [...new Set(problems)].filter(Boolean).join('; ');

/**
 * Why the inventory op at `opIndex` on `item` must not be sent, or null: no op there, a label that does not match
 * `option`, or a destructive label without the opt-in. Names the real label so a plan can be fixed.
 */
function opIndexProblem(
    item: InventoryItem,
    opIndex: number,
    option: RegExp,
    allowDestructive: boolean,
): string | null {
    const published = item.optionsWithIndex.find(o => o.opIndex === opIndex);
    const offered = item.optionsWithIndex.map(o => `${o.opIndex}=${o.text}`).join(' | ') || '(none)';
    if (!published) return `${item.name} has no op ${opIndex}; it offers: ${offered}`;
    if (!option.test(published.text))
        return `op ${opIndex} on ${item.name} is "${published.text}", which does not match /${option.source}/; it offers: ${offered}`;
    if (!allowDestructive && isDestructiveLabel(published.text))
        return `op ${opIndex} on ${item.name} is "${published.text}", which destroys or releases it; set allowDestructiveOption to send it`;
    return null;
}

/** A refusal that is about this one NPC, not the use: the next try takes another (a sheep already shorn). */
const NPC_SKIP = /already been shorn/i;

/** The tile an NPC stands on: its own tile when the state gives one, else the (x, z) it reports. */
const npcTile = (n: NearbyNpc) => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });

/** The tile an NPC or loc target stands on; items have none. */
const tileOf = (t: InteractTarget) =>
    t.kind === 'npc' ? npcTile(t.npc) : t.kind === 'loc' ? { x: t.loc.x, z: t.loc.z } : undefined;

/** The inventory item `use` names, if held. */
const heldItem = (ctx: Ctx) => {
    const spec = ctx.params.use?.item;
    return spec === undefined ? undefined : ctx.state().inventory.find(i => itemMatches(spec, i));
};

/** Answers the dialog the interaction opened with the task's `choices`; ends the run either way. */
function* answerDialog(ctx: Ctx, said = 'the interaction was sent earlier') {
    const r = yield* converse(ctx, ctx.params.choices.map(matcher), ctx.memory.progress);
    if (r.ok) return { done: `${said}; ${r.answered} choice${r.answered === 1 ? '' : 's'} made` };
    if (ctx.state().dialog.isOpen) yield* send({ type: 'closeModal', reason: 'close dialog after a failed choice' });
    // No choice answered and the dialog gone: the interaction opened none (a wrong `choices` for this target).
    if (r.reason === 'closed-early' && ctx.memory.progress.answered === 0)
        return { fail: `${said}, but it opened no dialog to answer with \`choices\` (${r.message})` };
    return { fail: r.message };
}

export default defineTask({
    name: 'interact',
    description:
        'One interaction with an NPC, a loc or an inventory item by option, or one item used on a loc or NPC, done when its effect is seen (see `expect`). ' +
        'It picks the nearest reachable match that offers the option. After a use, an `unreachable` op or a move the ' +
        `game made it waits for the world to settle (position, floor and animation unchanged for ${SETTLE_STABLE_TICKS} ` +
        `ticks, at most ${SETTLE_MAX_TICKS}; the effect says when the cap ended it), so a rope throw ends once the bot ` +
        'has landed. Fails with the options on offer when the target has none matching, and at once on "I can\'t reach ' +
        'that!", a refusal ("Nothing interesting happens.", "You need ...") or no effect; only a failed send or a ' +
        'discarded op is retried. Refuses a destructive option on an item, Attack on an NPC (use `combat`), and a ' +
        'target or `at` in the Wilderness unless `wilderness`.',
    rules: [
        'Give `option` or `use`, not both.',
        '`use` works on a loc or an NPC, and needs the item held at the start.',
        '`tile` picks a loc or an NPC, not an inventory item.',
        '`npcId` needs `target: "npc"`.',
        '`opIndex` needs `target: "item"` and `option`: the label expected at that index.',
        '`allowDestructiveOption` applies only to an `opIndex` op.',
        '`unreachable` needs `at` and a loc or NPC target.',
        '`wilderness` needs `minFood` food items held to start.',
    ],
    outcomes: {
        unreachable:
            'No target the bot can reach was found, and one or more stand in view that the bot has no route to from here.',
    },
    spots: [
        'Bloated toad (Big Chompy Bird Hunting), placed inside the bait zone x2631-2639, z2962-2971: {"target":"item","name":"^Bloated toad$","opIndex":1,"option":"^Drop$","allowDestructiveOption":true,"expect":"carefully place the bloated toad"}. The client publishes its op 1 as Drop but the server places the bait: the toad leaves the inventory and a Bloated toad NPC stands there.',
        'Ardougne sheep field, shearing: {"target":"npc","name":"^Sheep$","npcId":43,"use":{"item":"^Shears$"},"expect":"you get some wool"}.',
        'Coffin in the Lumbridge Chapel graveyard (Restless Ghost): {"target":"loc","name":"^Coffin$","option":"^Open$","at":{"x":3247,"z":3193}}.',
        'Rope on a rock across water: {"target":"loc","name":"^Rock$","use":{"item":"^Rope$"},"tile":{"x":2512,"z":3468},"unreachable":true,"at":{"x":2512,"z":3478,"tolerance":1}}.',
        "Port Sarim jeweller's Door at (3016,3246), Merlin's Crystal once the Lady of the Lake was asked for Excalibur: opening it starts the beggar's question, answered with `choices: [\"Yes certainly\"]` (wiki/quests/merlins-crystal.md).",
        'Used by wiki/quests/restless-ghost.md, wiki/quests/waterfall-quest.md.',
    ],
    params: Params,
    memory: (): Memory => ({
        refusedNpcs: [],
        sent: false,
        tried: false,
        destructiveSent: false,
        progress: { answered: 0 },
    }),
    // The dialog an interaction opens is answered by its own `choices`; the guard clicks under nothing then.
    allowGuards: params => (params.choices.length > 0 ? ['dialog'] : []),
    allowWilderness: params => params.wilderness,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    silent: SILENT,

    preflight(ctx) {
        const { at, target, option, use, name, wilderness, minFood, opIndex, allowDestructiveOption } = ctx.params;
        if (!wilderness && at && squareReachesWilderness(at.x, at.z, 0))
            return `(${at.x},${at.z}) is in the Wilderness`;
        // The pattern is checked against the option names themselves: refused if it could match one.
        const rx = option !== undefined ? matcher(option) : undefined;
        if (rx && opIndex !== undefined) {
            // An item not held yet is checked by the step; items held are checked now against their published op,
            // and refused only when none of them can be sent (the step takes the first that passes).
            const held = ctx.state().inventory.filter(i => matcher(name).test(i.name));
            const problems = held.map(i => opIndexProblem(i, opIndex, rx, allowDestructiveOption));
            if (problems.length > 0 && problems.every(p => p !== null)) return joinProblems(problems);
        } else if (rx && target === 'item' && DESTRUCTIVE_ITEM_OPTIONS.some(o => rx.test(o)))
            return `/${option}/ could send a destructive option (${DESTRUCTIVE_ITEM_OPTIONS.join(', ')}) on an item; use the drop task for dropping`;
        if (rx && target === 'npc' && rx.test(ATTACK_OPTION)) return 'attacking is the combat task, not interact';
        if (use && !heldItem(ctx)) return missingItem(use.item, name);
        if (!wilderness) return null;
        return wildernessFoodRefusal(foodCount(ctx.state()), minFood, 'a Wilderness trip');
    },

    steps: [
        walkToSpotStep<InteractParams, Memory>(FAIL_LIMIT),
        {
            name: 'interact',
            when: () => true,
            *run(ctx) {
                const {
                    target,
                    name,
                    option,
                    expect,
                    tile,
                    use,
                    unreachable: takeUnreachable,
                    wilderness,
                    opIndex,
                    allowDestructiveOption,
                } = ctx.params;
                const optionRx = option === undefined ? undefined : matcher(option);
                const what = use ? `use ${itemLabel(use.item)}` : option;
                const held = heldItem(ctx);
                // A step cut off after its send (a guard, a stop) finds the dialog it opened already showing.
                if (ctx.memory.tried && !ctx.memory.sent && ctx.state().dialog.isOpen) ctx.memory.sent = true;
                if (ctx.memory.sent) return yield* answerDialog(ctx);
                if (ctx.memory.destructiveSent) {
                    // The destructive op went out before a cut-off: never send it again, whatever the inventory shows.
                    const stillHeld = candidates(ctx).targets.length > 0;
                    return stillHeld
                        ? { fail: `op ${opIndex} (${option}) on ${name} was already sent; not sent twice` }
                        : { done: `op ${opIndex} (${option}) on ${name} was already sent and the item is gone` };
                }
                if (use && !held) return { fail: missingItem(use.item, name) };
                const { targets, unreachable } = candidates(ctx);
                const nearest = targets[0];
                if (!nearest) {
                    const failed = MISSING.missWith(
                        ctx,
                        `no ${takeUnreachable ? '' : 'reachable '}${target} /${name}/${tile ? ` at (${tile.x},${tile.z})` : ''} in sight` +
                            (unreachable > 0 ? ` (${unreachable} in view but unreachable from here)` : ''),
                    );
                    if (failed) return unreachable > 0 ? { ...failed, code: 'unreachable' } : failed;
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                MISSING.clear(ctx);
                let opItem: InventoryItem | undefined;
                if (opIndex !== undefined && optionRx) {
                    // The step re-checks what preflight saw: the item may arrive later, or its options may differ per stack.
                    const items = targets.flatMap(t => (t.kind === 'item' ? [t.item] : []));
                    const problems = items.map(i => opIndexProblem(i, opIndex, optionRx, allowDestructiveOption));
                    const ok = problems.findIndex(p => p === null);
                    if (ok < 0) return { fail: joinProblems(problems) || 'no item' };
                    opItem = items[ok];
                }
                const chosen = opItem
                    ? ({ kind: 'item', item: opItem } as InteractTarget)
                    : optionRx
                      ? targets.find(t => optionsOf(t).some(o => optionRx.test(o)))
                      : ctx.params.target === 'npc'
                        ? (targets.find(t => t.kind === 'npc' && !ctx.memory.refusedNpcs.includes(t.npc.index)) ??
                          nearest)
                        : targets.find(t => t.kind === 'loc');
                if (!chosen) {
                    const offered = optionsOf(nearest).join(' | ') || '(none)';
                    return { fail: `no ${optionRx} option on ${targetName(nearest)}; it offers: ${offered}` };
                }
                const where = tileOf(chosen);
                if (!wilderness && where && squareReachesWilderness(where.x, where.z, 0))
                    return { fail: `${targetName(chosen)} at (${where.x},${where.z}) is in the Wilderness` };
                const effects = {
                    settle: takeUnreachable,
                    ...(expect === undefined ? {} : { expect: matcher(expect) }),
                };
                // The params guarantee one of the two: a use (on a loc or an NPC) or an option.
                const attempt =
                    held && chosen.kind === 'loc'
                        ? useOn(ctx, held, chosen.loc, effects)
                        : held && chosen.kind === 'npc'
                          ? useOnNpc(ctx, held, chosen.npc, effects)
                          : optionRx && interact(ctx, chosen, opIndex ?? optionRx, effects);
                if (!attempt) return { fail: 'give an option or a use' };
                if (ctx.params.choices.length > 0) ctx.memory.tried = true;
                // Recorded before the send: a cut-off can land on the tick the op takes effect.
                if (opIndex !== undefined && chosen.kind === 'item') {
                    const label = chosen.item.optionsWithIndex.find(o => o.opIndex === opIndex)?.text;
                    if (label !== undefined && isDestructiveLabel(label)) ctx.memory.destructiveSent = true;
                }
                const r = yield* attempt;
                if (r.ok) {
                    INTERACT_FAILS.clear(ctx);
                    if (ctx.params.choices.length > 0) {
                        ctx.memory.sent = true;
                        return yield* answerDialog(ctx, `${what} on ${name}: ${r.effect}`);
                    }
                    return { done: `${what} on ${name}: ${r.effect}` };
                }
                yield* log(`${what} on ${name} failed (${r.reason}): ${r.message}`);
                // Repeat only a send that never landed (an option sent twice can undo itself: Open, Wear), or a use
                // refused over this one NPC, which the next try leaves for another.
                const skipped =
                    held !== undefined && chosen.kind === 'npc' && r.reason === 'refused' && NPC_SKIP.test(r.message);
                if (
                    (r.reason === 'rejected' || skipped) &&
                    held &&
                    chosen.kind === 'npc' &&
                    !ctx.memory.refusedNpcs.includes(chosen.npc.index)
                )
                    ctx.memory.refusedNpcs.push(chosen.npc.index);
                if (r.reason !== 'send-failed' && r.reason !== 'rejected' && !skipped)
                    return { fail: `${r.reason}: ${r.message}` };
                // A destructive op (the toad's "Drop") may already have landed unseen: never send it a second time.
                const sentLabel =
                    opIndex !== undefined && chosen.kind === 'item'
                        ? chosen.item.optionsWithIndex.find(o => o.opIndex === opIndex)?.text
                        : undefined;
                if (sentLabel !== undefined && isDestructiveLabel(sentLabel))
                    return {
                        fail: `${r.reason}: ${r.message} (op ${opIndex} "${sentLabel}" is destructive and is not sent twice)`,
                    };
                return INTERACT_FAILS.missWith(
                    ctx,
                    `${FAIL_LIMIT} tries in a row failed (last ${r.reason}: ${r.message})`,
                );
            },
        },
    ],
});
