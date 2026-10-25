import { z } from 'zod/v4';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../sdk/types';
import {
    CONVERSE_MAX_TICKS,
    converse,
    startTalk,
    TALK_OPEN_TICKS,
    TALK_OPTION,
    type TalkProgress,
} from '../actions/talk';
import { CLEANUP_CLOSE_WAIT_TICKS, closeModalUntil } from '../actions/modal';
import {
    COMPONENT_NAME,
    interfaceOpen,
    PRESS_MAX_TICKS,
    type PressProgress,
    pressComponent,
    resolveComponent,
} from '../actions/press';
import { useItemOnLoc } from '../actions/use';
import { WALK_MAX_TICKS } from '../actions/walk';
import { log, type Op, send, ticks, wait } from '../core/op';
import {
    AtSchema,
    atSpot,
    ItemSpec,
    missingItem,
    itemMatches,
    matcher,
    onTile,
    Pattern,
    TileSchema,
    walkToSpotStep,
} from '../lib/spot';
import { isLevelUp, isUnlockPage } from '../lib/interrupts';
import { defineTask, type TaskContext } from '../lib/task';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';
import { squareReachesWilderness } from '../lib/wilderness';

/** Failed walks, talks or uses in a row before the task fails. */
const FAIL_LIMIT = 3;
/** Loops (2 ticks each) the NPC, loc or dialog may be missing before the task fails. */
const MISSING_LIMIT = 3;
const MISSING_WAIT_TICKS = 2;
/**
 * Ticks a conversation that `travels` gets to carry the player away after its dialog closes: the sail proc's
 * p_delay is 7 ticks on the sailors' routes and 13-14 on the Entrana monks' (interface_boat/scripts/sail.rs2:22,
 * areas/area_entrana/scripts/monk_of_entrana.rs2), plus slack.
 */
export const TRAVEL_WAIT_TICKS = 24;
/** Tiles the game must move the player (or a plane change) for a journey to count as made. */
export const TRAVEL_MIN_JUMP = 8;
/** Ticks the game gets to open the interface (or the next page) a conversation's amount leads to. */
const FOLLOW_UP_OPEN_TICKS = 10;
/** A walk, then a conversation of up to CONVERSE_MAX_TICKS, a press and the pages around it: all fit one step. */
const STEP_TIMEOUT_MS = 480_000;
/** A conversation changes nothing the watchdog sees until its item arrives: outlast the longest. */
const STUCK_AFTER_MS = stuckWindowMs(
    CONVERSE_MAX_TICKS + PRESS_MAX_TICKS,
    failStreakTicks(FAIL_LIMIT, TALK_OPEN_TICKS),
    failStreakTicks(FAIL_LIMIT, WALK_MAX_TICKS),
);

const Params = z
    .object({
        /** Name (case-insensitive regex) of the NPC to talk to; omit for a run that only uses items. */
        npc: Pattern.optional(),
        /** Where to stand first. */
        at: AtSchema.optional(),
        /** The NPC option that starts the conversation (regex on its text); default "Talk-to". */
        option: Pattern.default(TALK_OPTION.source),
        /**
         * The choices of the conversation, in order: a regex on the text of the option to click at each
         * multi-option page. "Click here to continue" pages need no entry.
         */
        choices: z.array(Pattern).default([]),
        /**
         * Inventory items to use, one each in order, on a loc (name regex) before the conversation: raw
         * meats on the Cauldron of Thunder. An item is a name regex, or `{ id }` for one exact item (the
         * murky, blessed and plain buckets of water share a name). `tile` picks the loc standing on that
         * tile instead of the nearest of that name (one of several monuments).
         */
        use: z.object({ items: z.array(ItemSpec).min(1), onLoc: Pattern, tile: TileSchema.optional() }).optional(),
        /**
         * Continue a dialog that is already open (a previous step opened it: a crate's "Hide-in", a drop that
         * left an NPC talking): answer `choices` and click through, never look for anyone. Alone: no `npc`,
         * `at` or `use`. Fails after a short wait when no dialog is open.
         */
        continue: z.boolean().default(false),
        /**
         * The conversation ends in a journey (a sailor, the Monk of Entrana): once its dialog has closed, wait for
         * the game to carry the player away (at least TRAVEL_MIN_JUMP tiles or to another plane) and be done on
         * arrival, so the next task starts at the destination. Fails when no journey follows (fare unaffordable,
         * armour or weapons refused on the way to Entrana).
         */
        travels: z.boolean().default(false),
        /**
         * The conversation ends in an "Enter amount" prompt (Harold's bet): once its dialog has closed after the
         * last choice, answer the prompt with this number (1 to 1000, the game's maximum bet). Without `press` the
         * amount is verified only by the send succeeding and the pages after it being clicked through: it is meant
         * for the gamble prompt, nothing reads that the bet was taken.
         */
        amount: z.number().int().min(1).max(1000).optional(),
        /**
         * After the conversation (and its `amount`), click one component of the interface it opens, and close the
         * interface: Harold's dice table, where `death_dice:com_28` rolls. `component` is named as in interface.pack;
         * `ready` is a text the interface shows when the button is live (a hidden button drops the click) and `until`
         * the text it shows once the click took effect. The pages the game shows after the interface closes (the
         * winnings box, an IOU) are clicked through. Done with the matched text in the reason.
         */
        press: z
            .object({
                component: z.string().regex(COMPONENT_NAME),
                ready: Pattern.optional(),
                until: Pattern,
            })
            .optional(),
    })
    .refine(p => p.continue || p.npc !== undefined || p.use !== undefined, 'give an npc to talk to, a use, or both')
    .refine(
        p => !p.continue || (p.npc === undefined && p.use === undefined && p.at === undefined),
        '`continue` takes the open dialog as it is: give no npc, use or at',
    )
    .refine(
        p => !p.travels || (!p.continue && p.npc !== undefined),
        '`travels` needs an npc to talk to and not `continue`: a teleport inside an open dialog (the Merlin crate) is done when the dialog closes',
    )
    .refine(
        p => !p.press || (p.npc !== undefined && !p.travels),
        '`press` follows a conversation with an `npc` and cannot be combined with `travels`',
    )
    .refine(
        p => p.amount === undefined || (p.npc !== undefined && !p.travels),
        '`amount` answers a prompt the conversation with an `npc` ends in; not with `travels`',
    );

type TalkParams = z.infer<typeof Params>;
interface TalkMemory {
    /** Items of `use` already used. */
    used: number;
    /** Choices answered in the open conversation (converse updates it at each click). */
    progress: TalkProgress;
    /** Where the open conversation began, to tell a journey from standing still. */
    from: { x: number; z: number; level: number } | null;
    /** The conversation of a `travels` talk is over; only the journey is left to wait for (a cut-off step must not talk again). */
    talked: boolean;
    /** The amount prompt's answer was sent (recorded before the send: a cut-off step must not answer twice). */
    counted: boolean;
    /** Progress of the `press` click, kept across a cut-off step. */
    pressed: PressProgress;
}
type Ctx = TaskContext<TalkParams, TalkMemory>;

const here = (ctx: Ctx) => atSpot(ctx.params.at, ctx.state());
const usesLeft = (ctx: Ctx) => ctx.params.use !== undefined && ctx.memory.used < ctx.params.use.items.length;

/** Leaves no dialog open behind a failed step. */
function* closeDialog(ctx: Ctx, reason: string): Op<void> {
    if (ctx.state().dialog.isOpen) yield* send({ type: 'closeModal', reason });
}

const followsUp = (p: TalkParams) => p.amount !== undefined || p.press !== undefined;

/** Pages (and interfaces between them) a follow-up may pass before it gives up. */
const FOLLOW_UP_PASSES = 10;

type FollowUp = { ok: true; note: string } | { ok: false; message: string };

/**
 * What a conversation leads to after its choices: the amount prompt, the pages that follow, and the pressed
 * interface (opened, clicked, always closed again), then the pages the game shows once it closes. Resumable from
 * `ctx.memory`: the prompt is answered once, the click is not repeated.
 */
function* followUp(ctx: Ctx): Op<FollowUp> {
    const { amount, press } = ctx.params;
    const m = ctx.memory;
    const notes: string[] = [];
    // Once the amount was sent the bet stands: a failure after it may have cost the stake (closing the table
    // before the roll settles counts as a loss), and the message says so.
    const fail = (message: string): FollowUp => ({
        ok: false,
        message:
            amount !== undefined && m.counted
                ? `bet of ${amount} was placed and the stake may be forfeited: ${message}`
                : message,
    });
    if (amount !== undefined && !m.counted) {
        m.counted = true;
        const sent = yield* send({
            type: 'submitCountDialog',
            value: amount,
            reason: `answer the amount prompt with ${amount}`,
        });
        if (!sent.success) return { ok: false, message: `the amount prompt was not answered: ${sent.message}` };
    }
    if (amount !== undefined) notes.push(`amount ${amount}`);
    const target = press && resolveComponent(press.component);
    if (press && target) {
        const open = (st: BotWorldState) => interfaceOpen(st, target.interfaceId);
        if (m.pressed.clicked && !open(ctx.state())) {
            // A cut-off step resumed after the click was sent and the table is gone: the roll is not read again.
            const tail = yield* converse(ctx, [], { answered: 0 });
            if (!tail.ok) return fail(tail.message);
            return {
                ok: true,
                note: `press resumed after a cut-off; outcome unread (bet ${amount} may be forfeited or played)`,
            };
        }
        // The game talks a little more after the amount before the interface opens: click those pages through.
        for (let pass = 0; !open(ctx.state()); pass++) {
            if (pass === FOLLOW_UP_PASSES) return fail(`${press.component} did not open`);
            if (ctx.state().dialog.isOpen) {
                const pages = yield* converse(ctx, [], { answered: 0 });
                if (!pages.ok) return fail(pages.message);
                continue;
            }
            const w = yield* wait(`${press.component} opens`, st => open(st) || st.dialog.isOpen, FOLLOW_UP_OPEN_TICKS);
            if (w.kind === 'timeout')
                return fail(`the interface of ${press.component} did not open within ${FOLLOW_UP_OPEN_TICKS} ticks`);
        }
        try {
            const pressed = yield* pressComponent(
                ctx,
                {
                    component: press.component,
                    ready: press.ready === undefined ? undefined : matcher(press.ready),
                    until: matcher(press.until),
                },
                m.pressed,
            );
            if (!pressed.ok) return fail(pressed.message);
            notes.push(`${press.component}: "${pressed.text}"`);
        } finally {
            // Under a cancel this runs in the interpreter's bounded cleanup.
            if (open(ctx.state()))
                yield* closeModalUntil(ctx, 'dice interface', st => !open(st), CLEANUP_CLOSE_WAIT_TICKS);
        }
    }
    // Whatever the game shows next (the winnings box, an IOU): clicked through; a choice here is unexpected.
    const tail = yield* converse(ctx, [], { answered: 0 });
    if (!tail.ok) return fail(tail.message);
    return { ok: true, note: notes.join(', ') };
}

/** The nearest reachable NPC of that name that has the conversation's option. */
function findNpc(ctx: Ctx): NearbyNpc | undefined {
    const name = ctx.params.npc && matcher(ctx.params.npc);
    const option = matcher(ctx.params.option);
    return ctx
        .state()
        .nearbyNpcs.filter(
            n => name && name.test(n.name) && n.reachable !== false && n.options.some(o => option.test(o)),
        )
        .sort((a, b) => a.distance - b.distance)[0];
}

/** ", N out of reach" when matching NPCs stand in view but the client cannot route to them (walk closer, or open the way). */
function unreachableNote(ctx: Ctx): string {
    const name = ctx.params.npc && matcher(ctx.params.npc);
    const n = ctx.state().nearbyNpcs.filter(x => name && name.test(x.name) && x.reachable === false).length;
    return n > 0 ? ` (${n} in view but unreachable from here)` : '';
}

function findLoc(ctx: Ctx): NearbyLoc | undefined {
    const name = ctx.params.use && matcher(ctx.params.use.onLoc);
    const tile = ctx.params.use?.tile;
    return ctx
        .state()
        .nearbyLocs.filter(l => name && name.test(l.name) && l.reachable === true && (!tile || onTile(l, tile)))
        .sort((a, b) => a.distance - b.distance)[0];
}

export default defineTask({
    name: 'talk',
    description:
        'Talk to an NPC (or, with `continue: true` alone, continue the dialog a previous step left open: answers `choices`, fails after a short wait if none is open; also starts while the bot is under attack, since the open dialog is the way out of the fight, and then the low-HP eat waits until the dialog is answered, above the HP floor) and answer its dialog from a list of choices, e.g. to do a quest step. Params: `npc` (name regex), `at` {x,z,level?,tolerance?,met?} ' +
        '(walked to first, across floors and through doors; `met` [tokens] are the requirements the walk may plan through, as `travel`), `option` (default "Talk-to"), `choices` (regexes on the option text, one per multi-option page, in order; ' +
        '"click here to continue" pages pass by themselves), optional `use` {items, onLoc} (uses each inventory item (a name regex or `{id}`) on a nearby loc first, the one at `tile` {x,z,level?} if given; with no `npc` the run ends after the uses; a message box a use opens is clicked through, ' +
        'continue pages only, and a menu it offers is answered only by `choices`, otherwise closed). ' +
        "Done once the dialog has closed after the last choice. Fails with the dialog's options when an expected option is missing or an unexpected choice appears, " +
        'and when the dialog closes with choices left. `travels: true` for a conversation that ends in a ship journey: waits for the arrival (the game moves the player), ' +
        'so the next task (interact Cross on the gangplank) starts there; fails when no journey follows. `amount` answers the "Enter amount" prompt the conversation ends in, and `press` {component, ready?, until} then clicks one component of the interface it opens (named as in interface.pack, once its `ready` text shows), waits for the `until` text, closes the interface and clicks through the pages after: the Death Plateau dice game with Harold (stage 50+, gamble open; Harold wins ties, 15 of 36 rolls win, his gold is 100 plus the net losses of the player, the IOU comes with a win over a bet larger than that, max bet 1000 (`amount` is capped at 1000), ~47 ticks a game; the reason ends with "You win!" or "You lose!", the plan reads the coins and IOU; a failure after the bet says it was placed and the stake may be forfeited; `amount` without `press` is verified only by the send, for the gamble prompt): {"npc":"Harold","choices":["gamble"],"amount":1000,"press":{"component":"death_dice:com_28","ready":"Your roll","until":"You (win|lose)"}}; the door of his bedroom (upstairs in the Burthorpe inn) knocks with a dialog, so enter the room first. E.g. {"npc":"Duke Horacio","at":{"x":3210,"z":3220,"level":1},"choices":["quests for me","Sure"]}. ' +
        'Recipes and hazards: wiki/quests/rune-mysteries.md, learnings/hazards.md (Varrock stone circle dark wizards).',
    params: Params,
    memory: (): TalkMemory => ({
        used: 0,
        progress: { answered: 0 },
        from: null,
        talked: false,
        counted: false,
        pressed: { clicked: false },
    }),
    // The conversation is a dialog this task opens and answers itself: the dialog guard must not click under it.
    allow: ['dialog'],
    stepTimeoutMs: STEP_TIMEOUT_MS,
    stuckAfterMs: STUCK_AFTER_MS,
    // An open dialog is the way out of a fight (a kill can open one); the engine's refusal would strand it.
    startInCombat: (p, s) => p.continue && s.dialog.isOpen,
    // Under attack the low-hp eat would close the dialog `continue` answers (combat `stopOnDialog` leaves Morgan Le
    // Faye's choice open under Sir Mordred's attack), so the eat waits until it is answered. A level-up or unlock
    // page is not one: the dialog guard clicks it away, and an eat closing it costs nothing.
    holdsDialog: (p, s) =>
        p.continue && s.dialog.isOpen && !!s.player?.combat.inCombat && !isLevelUp(s) && !isUnlockPage(s),

    preflight(ctx) {
        const { at } = ctx.params;
        if (at && squareReachesWilderness(at.x, at.z, 0)) return `(${at.x},${at.z}) is in the Wilderness`;
        const { press } = ctx.params;
        if (press && !resolveComponent(press.component))
            return `${press.component} is not a component in interface.pack`;
        return null;
    },

    steps: [
        {
            name: 'continue-dialog',
            when: ctx => ctx.params.continue,
            *run(ctx) {
                const { progress } = ctx.memory;
                // answered > 0: a cut-off step resumed; converse waits out the grace for a dialog that just closed.
                if (!ctx.state().dialog.isOpen && progress.answered === 0) {
                    // The dialog may open a tick after the step that caused it.
                    if (ctx.streak('noDialog').add() >= MISSING_LIMIT) return { fail: 'no dialog is open to continue' };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                const r = yield* converse(ctx, ctx.params.choices.map(matcher), progress);
                if (r.ok)
                    return {
                        done: `continued the open dialog, ${r.answered} choice${r.answered === 1 ? '' : 's'} made`,
                    };
                yield* closeDialog(ctx, 'close dialog after a failed continue');
                return { fail: r.message };
            },
        },
        walkToSpotStep<TalkParams, TalkMemory>(FAIL_LIMIT),
        {
            name: 'use-items',
            when: usesLeft,
            *run(ctx) {
                const use = ctx.params.use;
                // Narrowing only: when() guarantees it.
                const pattern = use?.items[ctx.memory.used];
                if (!use || pattern === undefined) return;
                const item = ctx.state().inventory.find(i => itemMatches(pattern, i));
                if (!item) return { fail: missingItem(pattern, use.onLoc) };
                const loc = findLoc(ctx);
                const missing = ctx.streak('noLoc');
                if (!loc) {
                    if (missing.add() >= MISSING_LIMIT)
                        return {
                            fail: `no reachable ${use.onLoc}${use.tile ? ` at (${use.tile.x},${use.tile.z})` : ''} in sight`,
                        };
                    yield* ticks(MISSING_WAIT_TICKS);
                    return;
                }
                missing.reset();
                const used = yield* useItemOnLoc(ctx, item, loc);
                const fails = ctx.streak('useFails');
                if (used.ok) {
                    fails.reset();
                    ctx.memory.used++;
                    yield* log(`used ${item.name} on ${loc.name}`);
                    return;
                }
                yield* log(`using ${item.name} on ${loc.name} failed: ${used.message}`);
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `${FAIL_LIMIT} uses in a row failed (last: ${used.message})` };
            },
        },
        {
            name: 'finish',
            when: ctx => ctx.params.npc === undefined,
            *run(ctx) {
                // A use can open a message box (the skull put in the coffin) whose pages carry the effect: click through it.
                if (ctx.state().dialog.isOpen) {
                    ctx.memory.progress.answered = 0;
                    const r = yield* converse(ctx, ctx.params.choices.map(matcher), ctx.memory.progress);
                    if (!r.ok) {
                        yield* closeDialog(ctx, 'close dialog after a use');
                        // Without choices the dialog was only a side effect of the uses, which did succeed.
                        if (ctx.params.choices.length > 0) return { fail: r.message };
                    }
                }
                return {
                    done: `used ${ctx.memory.used} item${ctx.memory.used === 1 ? '' : 's'} on ${ctx.params.use?.onLoc}`,
                };
            },
        },
        {
            name: 'talk',
            when: () => true,
            *run(ctx) {
                const { progress } = ctx.memory;
                // A stray dialog (not our conversation) while the walk or the uses are still due: close it, let those steps run.
                if (ctx.state().dialog.isOpen && progress.answered === 0 && (!here(ctx) || usesLeft(ctx))) {
                    yield* send({ type: 'closeModal', reason: 'close a stray dialog before walking or using' });
                    yield* ticks(1);
                    return;
                }
                if (!ctx.memory.talked && !ctx.state().dialog.isOpen) {
                    // A new conversation; an open dialog is one a cut-off step left, resumed where it was.
                    progress.answered = 0;
                    const npc = findNpc(ctx);
                    const missing = ctx.streak('noNpc');
                    if (!npc) {
                        if (missing.add() >= MISSING_LIMIT)
                            return { fail: `no reachable /${ctx.params.npc}/ in sight${unreachableNote(ctx)}` };
                        yield* ticks(MISSING_WAIT_TICKS);
                        return;
                    }
                    missing.reset();
                    const started = yield* startTalk(ctx, npc, matcher(ctx.params.option));
                    const fails = ctx.streak('talkFails');
                    if (!started.ok) {
                        yield* log(`talking to ${npc.name} failed: ${started.message}`);
                        if (fails.add() >= FAIL_LIMIT)
                            return {
                                fail: `${FAIL_LIMIT} tries to talk to ${npc.name} failed (last: ${started.message})`,
                            };
                        return;
                    }
                    fails.reset();
                    // Recorded once the dialog is open: the walk to the NPC is not the journey.
                    const me = ctx.state().player;
                    ctx.memory.from = me ? { x: me.worldX, z: me.worldZ, level: me.level } : null;
                }
                if (ctx.memory.from === null) {
                    // A resumed conversation: the journey has not begun while its dialog is open.
                    const me = ctx.state().player;
                    if (me) ctx.memory.from = { x: me.worldX, z: me.worldZ, level: me.level };
                }
                const choices = ctx.params.choices.map(matcher);
                const r = ctx.memory.talked
                    ? { ok: true as const, answered: progress.answered }
                    : yield* converse(ctx, choices, progress);
                if (r.ok) {
                    ctx.memory.talked = ctx.params.travels || followsUp(ctx.params);
                    const said = `talked to ${ctx.params.npc}, ${r.answered} choice${r.answered === 1 ? '' : 's'} made`;
                    if (followsUp(ctx.params)) {
                        const f = yield* followUp(ctx);
                        if (f.ok) return { done: `${said}, ${f.note}` };
                        yield* closeDialog(ctx, 'close dialog after a failed follow-up');
                        return { fail: f.message };
                    }
                    if (!ctx.params.travels) return { done: said };
                    const from = ctx.memory.from;
                    const away = (s: BotWorldState) => {
                        const p = s.player;
                        if (!p || from === null) return false;
                        return (
                            p.level !== from.level ||
                            Math.max(Math.abs(p.worldX - from.x), Math.abs(p.worldZ - from.z)) >= TRAVEL_MIN_JUMP
                        );
                    };
                    const w = yield* wait('journey', away, TRAVEL_WAIT_TICKS);
                    if (w.kind === 'timeout')
                        return {
                            fail: `no journey followed the talk with ${ctx.params.npc} (fare unpaid, or weapons or armour refused?)`,
                        };
                    // The arrival message box ("The ship arrives at ...") is the next task's to start from, not to trip over.
                    yield* closeDialog(ctx, 'close the arrival message');
                    return { done: `${said}, arrived at (${w.state.player?.worldX},${w.state.player?.worldZ})` };
                }
                yield* closeDialog(ctx, 'close dialog after a failed talk');
                return { fail: r.message };
            },
        },
    ],
});
