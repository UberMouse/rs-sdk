import { z } from 'zod/v4';
import {
    atDestination,
    castTeleport,
    missingRunes,
    TELEPORT_NAMES,
    TELEPORT_WAIT_TICKS,
    TELEPORTS,
} from '../actions/teleport';
import { log, wait } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { findSkill, TICK_MS } from '../lib/util';
import { wildernessLevel } from '../lib/wilderness';

const Params = z.object({
    /** The spell, by the town it goes to. */
    spell: z.enum(TELEPORT_NAMES),
});

type TeleportParams = z.infer<typeof Params>;
interface TeleportMemory {
    /** The tick the cast was sent on, or null: it is never sent again this run, whatever aborted the step. */
    castTick: number | null;
}
type Ctx = TaskContext<TeleportParams, TeleportMemory>;

/** The server refuses a teleport above this Wilderness level (teleport.rs2). */
const MAX_TELEPORT_WILDERNESS_LEVEL = 20;

const spellOf = (ctx: Ctx) => TELEPORTS[ctx.params.spell];

export default defineTask({
    name: 'teleport',
    description:
        'Cast one standard-spellbook teleport, once, to leave a place with no walkable exit (the Entrana dungeon, ' +
        'a one-way ladder): `spell` varrock | lumbridge | falador | camelot | ardougne | watchtower | trollheim. ' +
        'Needs the Magic level (varrock 25, lumbridge 31, falador 37, camelot 45, ardougne 51, watchtower 58, trollheim 61) ' +
        'and the runes in the inventory (a worn matching staff stands in for its rune; lumbridge: 3 air + 1 earth + 1 law). ' +
        "Ardougne, Watchtower and Trollheim also need their quests (Plague City, Watchtower, Eadgar's Ruse), which the server checks. " +
        'Ends done once the bot stands within 3 tiles of the destination with the Magic XP paid; done at once, casting nothing, ' +
        'when it already stands there (even without the level or runes). Fails on missing level or runes, ' +
        'or when the server refuses (quest, duel arena, Tutorial Island, Fishing Trawler, Castle Wars). ' +
        'It sends one cast per run and never resends: the once-only guarantee is per run, and a failed cast ' +
        '(no-teleport, send-failed) may have spent the runes, so a plan must not select teleport again after one ' +
        'without a changed condition (position, inventory). Never cast in the Wilderness: the shared wilderness guard ' +
        'fails any run that starts there (levels 1-20 included); the preflight refusal above level 20 is only a clearer message.',
    params: Params,
    memory: (): TeleportMemory => ({ castTick: null }),
    // One cast and one wait: the engine's defaults are far longer than the 4 s the cast can take.
    stepTimeoutMs: (TELEPORT_WAIT_TICKS + 5) * TICK_MS,

    preflight(ctx) {
        const spell = spellOf(ctx);
        const s = ctx.state();
        // Already there: the run ends done, casting nothing, so the level and runes do not matter.
        if (atDestination(s, spell)) return null;
        const magic = findSkill(s, 'Magic');
        if (!magic) return 'no Magic skill in state';
        if (magic.level < spell.level) return `${spell.name} needs Magic ${spell.level}, bot has ${magic.level}`;
        const missing = missingRunes(s, spell);
        if (missing.length > 0) return `${spell.name} needs ${missing.join(', ')}`;
        const p = s.player;
        if (p && wildernessLevel(p.level, p.worldX, p.worldZ) > MAX_TELEPORT_WILDERNESS_LEVEL)
            return `${spell.name} is blocked above Wilderness level ${MAX_TELEPORT_WILDERNESS_LEVEL}`;
        return null;
    },

    steps: [
        {
            name: 'arrived',
            when: ctx => atDestination(ctx.state(), spellOf(ctx)),
            run: ctx => ({
                done:
                    ctx.memory.castTick !== null
                        ? `cast ${spellOf(ctx).name}: arrived`
                        : `already at the ${spellOf(ctx).name} destination, nothing cast`,
            }),
        },
        {
            // A guard cut the cast's wait: the jump may still land, so wait out the rest of its window, never resend.
            name: 'cast-sent',
            when: ctx => ctx.memory.castTick !== null,
            *run(ctx) {
                const left = ctx.memory.castTick! + TELEPORT_WAIT_TICKS - ctx.state().tick;
                const w =
                    left > 0 ? yield* wait('teleport lands', s => atDestination(s, spellOf(ctx)), left) : undefined;
                if (w && atDestination(w.state, spellOf(ctx))) return;
                return {
                    fail: `no-teleport: ${spellOf(ctx).name} was cast and the bot is not at its destination; not casting again`,
                };
            },
        },
        {
            name: 'cast',
            when: () => true,
            *run(ctx) {
                const spell = spellOf(ctx);
                // Recorded before the send: an abort may land on the tick the effect does.
                ctx.memory.castTick = ctx.state().tick;
                const cast = yield* castTeleport(ctx, spell);
                if (cast.ok) return { done: `cast ${spell.name}: arrived, +${cast.xpGained} Magic xp` };
                yield* log(`cast failed: ${cast.message}`);
                return { fail: `${cast.reason}: ${cast.message}` };
            },
        },
    ],
});
