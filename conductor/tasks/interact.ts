import { z } from 'zod/v4';
import type { InventoryItem, NearbyLoc, NearbyNpc } from '../../sdk/types';
import {
    INTERACT_WAIT_TICKS,
    interact,
    type InteractTarget,
    optionsOf,
    targetName,
    useOn,
    useOnNpc,
} from '../actions/interaction';
import { CONVERSE_MAX_TICKS, converse, type TalkProgress } from '../actions/talk';
import { WALK_MAX_TICKS } from '../actions/walk';
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
    Pattern,
    TileSchema,
    walkToSpotStep,
} from '../lib/spot';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness, WILDERNESS_MIN_FOOD, wildernessFoodRefusal } from '../lib/wilderness';

/** Failed walks or interactions in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Loops (2 ticks each) the target may be out of sight before the task fails. */
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
/** One interaction wait, its settle and the dialog answers it opens (CONVERSE_MAX_TICKS) fit one step; the walk is a step of its own. */
const STEP_TIMEOUT_MS = 360_000;
const STUCK_AFTER_MS = stuckWindowMs(
    CONVERSE_MAX_TICKS,
    INTERACT_WAIT_TICKS,
    failStreakTicks(FAIL_LIMIT, INTERACT_WAIT_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

/** Options that destroy what they are used on: an item target is never sent one. */
const DESTRUCTIVE_ITEM_OPTIONS = ['Drop', 'Destroy', 'Release', 'Empty'];
/** Combat has its own task (HP, food and threat checks); an NPC target is never attacked here. */
const ATTACK_OPTION = 'Attack';

const Params = z
    .object({
        /** What is interacted with: an NPC or a loc standing near, or an item in the inventory. */
        target: z.enum(['loc', 'npc', 'item']),
        /** Its name (case-insensitive regex). */
        name: Pattern,
        /** The option to send (regex on the option text): "Open", "Search", "Wear", "Talk-to"... Not with `use`. */
        option: Pattern.optional(),
        /** Where to stand first. */
        at: AtSchema.optional(),
        /**
         * A regex the outcome must match: a game message or dialog page after the send. Without it any state
         * change (a dialog or interface opening, the inventory or worn items changing, the player moved by the
         * game, the loc changing, ...) is the effect, and a bare message only after a moment with nothing else shown.
         */
        expect: Pattern.optional(),
        /**
         * The exact tile of the loc or NPC, instead of the nearest one of that name: one of six pillars, a crate
         * beside plain crates, one of three "Ledge" locs. A loc's tile is its south-west corner.
         */
        tile: TileSchema.optional(),
        /**
         * Only NPCs of this type id (NearbyNpc.id, the config id in server/content/pack/npc.pack), one or several, among
         * those `name` matches: the woolly Sheep (43) beside a sheared one (42), both named "Sheep". NPC targets only.
         */
        npcId: z.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)]).optional(),
        /**
         * Also take a target the client cannot route to (an islet in a river, a rock across water) and send the
         * op from the stand tile `at`, leaving the reach check to the server. Needs `at`.
         */
        unreachable: z.boolean().default(false),
        /**
         * Use an inventory item on the loc or NPC instead of sending an option: `item` is a name regex, or `{ id }` for
         * one exact item (when several share a name). Judged by the effects below; a use the server discarded
         * (no feedback at all) is sent again, up to FAIL_LIMIT tries, but one that got a message or no effect is not.
         */
        use: z.object({ item: ItemSpec }).optional(),
        /**
         * Answers the dialog the interaction itself opens (a door whose opening starts a beggar's question), as
         * `talk`'s `choices`: a regex on the option text per multi-option page, in order; "click here to continue"
         * pages pass by themselves. The task is then done once that dialog has closed after the last choice. Without
         * it the dialog guard clicks continue pages away and declines a choice nobody answers. With it the interaction
         * must open a dialog (else the run fails saying it opened none) and the dialog guard is off for the run.
         */
        choices: z.array(Pattern).default([]),
        /**
         * Opt in to a target (and `at`) in the Wilderness; the Wilderness guard then stands down (death still
         * ends the run) and the run needs `minFood` food to start, as `travel` does.
         */
        wilderness: z.boolean().default(false),
        /** Food items a `wilderness` run must carry to start (at least 1 whatever is set). */
        minFood: z.number().int().min(0).default(WILDERNESS_MIN_FOOD),
    })
    .refine(p => (p.option === undefined) !== (p.use === undefined), 'give an option, or a use (not both)')
    .refine(p => p.use === undefined || p.target === 'loc' || p.target === 'npc', 'a use works on a loc or an NPC')
    .refine(p => p.tile === undefined || p.target !== 'item', 'a tile picks a loc or an NPC, not an inventory item')
    .refine(p => p.npcId === undefined || p.target === 'npc', 'npcId picks an NPC type, so it needs target "npc"')
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
        'One interaction with an NPC, a loc or an inventory item by option, or one item used on a loc, done when its effect is seen. Params: `target` ("loc" | "npc" | "item"), ' +
        '`name` (regex), `option` (regex on the option text, e.g. "Open", "Search", "Wear", "Talk-to"), optional `at` {x,z,level?,tolerance?} ' +
        '(walked to first, across floors and through doors). Picks the nearest reachable match that offers the option; `npcId` (a number or list: the NPC type id, NearbyNpc.id) narrows an NPC match to those types (the woolly Sheep 43, not a sheared 42); "This sheep has already been shorn." on a `use` moves on to another NPC; `tile` {x,z,level?} picks the loc or NPC standing exactly there ' +
        "(one pillar of six, a crate beside plain crates; a loc's tile is its south-west corner); `unreachable: true` (needs `at`) also takes a loc or NPC the client cannot route to " +
        'and sends the op from the stand tile, the server owning the reach check (swim to a rock, throw a rope across water); ' +
        '`use` {item: name regex, or {id}} instead of `option` (loc or NPC targets) uses that inventory item on the loc or NPC ' +
        '(a key on a door, a rope on a rock, a rune on a pillar, an empty bucket on a cow); a use is re-sent only after a discarded op (on another match for an NPC), never after a message or no effect; without `expect` any inventory change ends the use as done, so pass `expect` (e.g. "you milk the cow") when the exact outcome matters. Done once the game shows an effect ' +
        '(a dialog or interface opened, the inventory or worn items changed, an animation, the loc changed, the player moved by the game: a teleport, swim, door pass-through, gangplank or whistle; a bare game message only when nothing else shows); after a use, an unreachable op or a move the game made it waits for the world to settle (position, floor and animation unchanged for 3 ticks) before it ends, so a rope throw ends once the bot has landed; it waits up to 16 ticks for the bot to stop moving, and a run that hits that cap says so in the effect; optional `expect` ' +
        '(regex) makes only a matching game message or dialog page count, and is the way to wait for a specific later message. Without `choices` it answers no dialog it opens (the guard clicks continue pages and declines a choice; use `talk` to converse); `choices` (regexes on the option text, one per multi-option page, in order, as `talk`) answers the dialog the interaction itself opens (the interaction must open one, else it fails saying so; the dialog guard is off for the run), e.g. the Port Sarim beggar question when opening the jeweller Door ("Yes certainly"), and the task is done when that dialog has closed. A message box the op opens (the Chaos altar Check) counts as the effect. Refuses the destructive options ' +
        '(Drop, Destroy, Release, Empty) on an item, Attack on an NPC (use `combat`), and a target or `at` in the Wilderness unless `wilderness: true` ' +
        '(then it needs `minFood` (default 3, at least 1) food items to start, eats at low HP, and death still ends the run; carry only food and no valuables; the bot is left in the Wilderness, so whatever runs next, a plan phase or a `travel` out, must opt in to the Wilderness too). Fails with the options on offer when the target has none matching, ' +
        'and at once on "I can\'t reach that!", a refusal message ("Nothing interesting happens.", "You need ...") or no effect; only a failed send or a discarded op is retried. ' +
        'E.g. {"target":"npc","name":"^Sheep$","npcId":43,"use":{"item":"^Shears$"},"expect":"you get some wool"} (Ardougne sheep field); {"target":"loc","name":"^Coffin$","option":"^Open$","at":{"x":3247,"z":3193}}; {"target":"loc","name":"^Rock$","use":{"item":"^Rope$"},"tile":{"x":2512,"z":3468},"unreachable":true,"at":{"x":2512,"z":3478,"tolerance":1}}. Uses: wiki/quests/restless-ghost.md, wiki/quests/waterfall-quest.md.',
    params: Params,
    memory: (): Memory => ({ refusedNpcs: [], sent: false, tried: false, progress: { answered: 0 } }),
    // The dialog an interaction opens is answered by its own `choices`; the guard clicks under nothing then.
    allowGuards: params => (params.choices.length > 0 ? ['dialog'] : []),
    allowWilderness: params => params.wilderness,
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const { at, target, option, use, name, wilderness, minFood } = ctx.params;
        if (!wilderness && at && squareReachesWilderness(at.x, at.z, 0))
            return `(${at.x},${at.z}) is in the Wilderness`;
        // The pattern is checked against the option names themselves: refused if it could match one.
        const rx = option !== undefined ? matcher(option) : undefined;
        if (rx && target === 'item' && DESTRUCTIVE_ITEM_OPTIONS.some(o => rx.test(o)))
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
                } = ctx.params;
                const optionRx = option === undefined ? undefined : matcher(option);
                const what = use ? `use ${itemLabel(use.item)}` : option;
                const held = heldItem(ctx);
                // A step cut off after its send (a guard, a stop) finds the dialog it opened already showing.
                if (ctx.memory.tried && !ctx.memory.sent && ctx.state().dialog.isOpen) ctx.memory.sent = true;
                if (ctx.memory.sent) return yield* answerDialog(ctx);
                if (use && !held) return { fail: missingItem(use.item, name) };
                const { targets, unreachable } = candidates(ctx);
                const missing = ctx.streak('missing');
                const nearest = targets[0];
                if (!nearest) {
                    if (missing.add() >= MISSING_LIMIT)
                        return {
                            fail:
                                `no ${takeUnreachable ? '' : 'reachable '}${target} /${name}/${tile ? ` at (${tile.x},${tile.z})` : ''} in sight` +
                                (unreachable > 0 ? ` (${unreachable} in view but unreachable from here)` : ''),
                        };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const chosen = optionRx
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
                          : optionRx && interact(ctx, chosen, optionRx, effects);
                if (!attempt) return { fail: 'give an option or a use' };
                if (ctx.params.choices.length > 0) ctx.memory.tried = true;
                const r = yield* attempt;
                const fails = ctx.streak('interactFails');
                if (r.ok) {
                    fails.reset();
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
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} tries in a row failed (last ${r.reason}: ${r.message})` };
            },
        },
    ],
});
