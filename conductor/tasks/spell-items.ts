import { z } from 'zod/v4';
import { Spells } from '../../sdk/spells';
import { CAST_ITEM_WAIT_TICKS, castOnItem } from '../actions/cast-item';
import { log } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { findSkill } from '../lib/util';
import { failStreakTicks, stuckWindowMs } from '../lib/watchdog';

interface SpellInfo {
    name: string;
    component: number;
    level: number;
    hold: number;
}

/**
 * The item spells: the SDK's component id and the Magic level the server requires
 * (server/content/scripts/skill_magic/configs/magic_spells.dbrow `levelrequired`), and the ticks its script
 * holds the player after a cast (`p_delay` in skill_magic/scripts/spells/).
 */
const SPELLS: Record<(typeof SPELL_NAMES)[number], SpellInfo> = {
    superheat: { name: 'Superheat Item', component: Spells.SUPERHEAT, level: 43, hold: 1 },
    'low-alchemy': { name: 'Low Level Alchemy', component: Spells.LOW_ALCHEMY, level: 21, hold: 1 },
    'high-alchemy': { name: 'High Level Alchemy', component: Spells.HIGH_ALCHEMY, level: 55, hold: 3 },
    'enchant-1': { name: 'Lvl-1 Enchant', component: Spells.ENCHANT_LVL1, level: 7, hold: 1 },
    'enchant-2': { name: 'Lvl-2 Enchant', component: Spells.ENCHANT_LVL2, level: 27, hold: 1 },
    'enchant-3': { name: 'Lvl-3 Enchant', component: Spells.ENCHANT_LVL3, level: 49, hold: 1 },
    'enchant-4': { name: 'Lvl-4 Enchant', component: Spells.ENCHANT_LVL4, level: 57, hold: 1 },
    'enchant-5': { name: 'Lvl-5 Enchant', component: Spells.ENCHANT_LVL5, level: 68, hold: 1 },
};

/** Consecutive casts with no effect (no XP, no refusal) before the task fails. */
const CAST_FAIL_LIMIT = 3;
/** Nothing changes while a cast times out, so the watchdog must outlast the failures in a row. */
const STUCK_AFTER_MS = stuckWindowMs(failStreakTicks(CAST_FAIL_LIMIT, CAST_ITEM_WAIT_TICKS));

const regexSource = z.string().refine(
    s => {
        try {
            RegExp(s, 'i');
            return true;
        } catch {
            return false;
        }
    },
    { message: 'not a valid regular expression' },
);

const SPELL_NAMES = [
    'superheat',
    'low-alchemy',
    'high-alchemy',
    'enchant-1',
    'enchant-2',
    'enchant-3',
    'enchant-4',
    'enchant-5',
] as const;

const Params = z.object({
    spell: z.enum(SPELL_NAMES),
    /** Regular expression (case-insensitive) matched against inventory item names, e.g. "^iron ore$". */
    item: regexSource,
    /** Stop after this many casts; omit to cast until no matching item is left. */
    count: z.number().int().positive().optional(),
});

type SpellParams = z.infer<typeof Params>;
interface SpellMemory {
    /** Casts that landed this run. */
    casts: number;
}
type Ctx = TaskContext<SpellParams, SpellMemory>;

/** Coins and runes are never a target, whatever the regex: alchemy would turn spare runes into coins. */
const PROTECTED = /^coins$| runes?$/i;
const pattern = (ctx: Ctx) => new RegExp(ctx.params.item, 'i');
const isTarget = (ctx: Ctx, name: string) => pattern(ctx).test(name) && !PROTECTED.test(name);
const itemsLeft = (ctx: Ctx) => ctx.state().inventory.filter(i => isTarget(ctx, i.name)).length;

export default defineTask({
    name: 'spell-items',
    description:
        'Cast one spell on inventory items again and again: `spell` superheat | low-alchemy | high-alchemy | enchant-1..5, ' +
        '`item` a regex on item names (e.g. "^iron ore$"), `count` optional (default: until no matching item is left). ' +
        'Never targets coins or runes. Needs the Magic level and the runes in the inventory (a worn Staff of fire stands in for fire runes). ' +
        'Superheat Item on iron ore never fails and pays Smithing XP and Magic XP per cast (with 2+ coal held and Smithing 30+ it makes steel instead and uses up 2 coal per cast, so do not carry coal unless steel is wanted); ' +
        'it needs Magic 43, 1 nature rune and 4 fire runes per cast. It does not bank or fetch more: ends done when the items or the count run out, ' +
        'fails when runes run out or the server refuses ("You need..."). Stays where the bot stands.',
    params: Params,
    memory: (): SpellMemory => ({ casts: 0 }),
    stuckAfterMs: STUCK_AFTER_MS,

    preflight(ctx) {
        const spell = SPELLS[ctx.params.spell];
        const s = ctx.state();
        const magic = findSkill(s, 'Magic');
        if (!magic) return 'no Magic skill in state';
        if (magic.baseLevel < spell.level)
            return `${spell.name} needs magic ${spell.level}, bot has ${magic.baseLevel}`;
        if (itemsLeft(ctx) === 0) return `no inventory item matches /${ctx.params.item}/i`;
        return null;
    },

    steps: [
        {
            name: 'stop-count',
            when: ctx => ctx.params.count !== undefined && ctx.memory.casts >= ctx.params.count,
            run: ctx => ({ done: `cast ${SPELLS[ctx.params.spell].name} ${ctx.memory.casts} times` }),
        },
        {
            name: 'stop-none',
            when: ctx => itemsLeft(ctx) === 0,
            run: ctx => ({
                done: `no /${ctx.params.item}/i left after ${ctx.memory.casts} casts of ${SPELLS[ctx.params.spell].name}`,
            }),
        },
        {
            name: 'cast',
            when: () => true,
            *run(ctx) {
                const item = ctx.state().inventory.find(i => isTarget(ctx, i.name));
                if (!item) return { fail: 'no target item left (stop-none should have ended the run)' };
                const spell = SPELLS[ctx.params.spell];
                const cast = yield* castOnItem(ctx, item, spell.component, spell.name, spell.hold);
                const fails = ctx.streak('castFails');
                if (cast.ok) {
                    fails.reset();
                    ctx.memory.casts++;
                    return;
                }
                yield* log(`cast failed: ${cast.message}`);
                // A server refusal repeats until something changes, so it ends the run at once.
                if (cast.reason === 'no-runes' || cast.reason === 'level' || cast.reason === 'refused')
                    return { fail: cast.message };
                if (fails.add() >= CAST_FAIL_LIMIT)
                    return { fail: `${CAST_FAIL_LIMIT} casts in a row failed (last: ${cast.message})` };
            },
        },
    ],
});
