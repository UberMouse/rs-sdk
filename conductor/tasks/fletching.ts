import { z } from 'zod/v4';
import { fletch } from '../actions/fletch';
import { useItemOnItem } from '../actions/use';
import { log, wait } from '../core/op';
import { defineTask, type TaskContext } from '../lib/task';
import { countItems, exactName, findSkill, TICK_MS } from '../lib/util';

const NORMAL_LOGS = 'logs';
const SHAFT_LEVEL = 1;
/**
 * Fletching levels per log type, from server/content/scripts/skill_fletching/configs/cut_logs/cut_logs.dbrow.
 * Only normal logs also make arrow shafts (level 1).
 */
const BOW_LEVELS: Record<string, { shortBow: number; longBow: number }> = {
    [NORMAL_LOGS]: { shortBow: 5, longBow: 10 },
    'oak logs': { shortBow: 20, longBow: 25 },
    'willow logs': { shortBow: 35, longBow: 40 },
    'maple logs': { shortBow: 50, longBow: 55 },
    'yew logs': { shortBow: 65, longBow: 70 },
    'magic logs': { shortBow: 80, longBow: 85 },
};

const KNIFE = /^knife$/i;
const FEATHERS = /^feathers?$/i;
const SHAFTS = /^arrow shafts?$/i;
const FLETCH_FAIL_LIMIT = 3;
/** How long the feathers get to take the shafts out of the inventory; the same 5s the make menu gets (FLETCH_MENU_TICKS). */
const FEATHER_WAIT_MS = 5000;
const FEATHER_WAIT_TICKS = Math.ceil(FEATHER_WAIT_MS / TICK_MS);

const Params = z.object({
    /** Product: "arrow shaft", "short bow" or "long bow" (the dialog labels). "shortbow (u)" / "longbow (u)" are accepted too. */
    product: z.string().min(1),
    /** Exact item name of the logs to cut. */
    logs: z.string().default('Logs'),
    /** Logs per make-menu click (10, 5 or 1); a level-up or interruption ends a batch early and the next cut step resumes. */
    batch: z.union([z.literal(1), z.literal(5), z.literal(10)]).default(10),
    /** After the logs are cut, attach Feathers to the Arrow shafts (needs product "arrow shaft"). */
    attachFeathers: z.boolean().default(false),
});

type FletchParams = z.infer<typeof Params>;
type Ctx = TaskContext<FletchParams>;

/** The dialog label for a product: "shortbow (u)" -> "short bow", "longbow" -> "long bow". */
const normalizeProduct = (product: string) =>
    product
        .toLowerCase()
        .replace(/\(u\)/g, '')
        .replace(/\b(short|long)\s*bow\b/, '$1 bow')
        .replace(/\s+/g, ' ')
        .trim();

/** Fletching level the product needs from these logs, or a reason it cannot be made. */
function requiredLevel(product: string, logs: string): { level: number } | { error: string } {
    const levels = BOW_LEVELS[logs.toLowerCase()];
    if (!levels) return { error: `unknown log type "${logs}" (known: ${Object.keys(BOW_LEVELS).join(', ')})` };
    if (/shaft/.test(product))
        return logs.toLowerCase() === NORMAL_LOGS
            ? { level: SHAFT_LEVEL }
            : { error: 'arrow shafts need normal "Logs"' };
    if (/long/.test(product)) return { level: levels.longBow };
    if (/short/.test(product)) return { level: levels.shortBow };
    return { error: `unknown product "${product}" (arrow shaft, short bow, long bow)` };
}

const wantsFeathers = (ctx: Ctx) => ctx.params.attachFeathers && /shaft/.test(normalizeProduct(ctx.params.product));

export default defineTask({
    name: 'fletching',
    description:
        'Use a knife on logs from the inventory to make `product` ("arrow shaft", "short bow", "long bow") ' +
        'until no `logs` (exact item name, default "Logs") are left. With attachFeathers and product "arrow shaft", ' +
        'then uses Feathers on the Arrow shafts to make Headless arrows (needs Feathers in the inventory). Members world only. Needs a knife (no nearby shop sells one: ' +
        'ground spawn near (3224,3202), or Shantay Pass shop), the logs and the Fletching level. Works anywhere; ' +
        'the run fails if something attacks the bot. Other log types in the inventory are left alone. ' +
        'Cuts `batch` logs (10 default, 5 or 1) per make-menu click, ~0.8 s per log.',
    params: Params,

    preflight(ctx) {
        const s = ctx.state();
        if (!s.inventory.some(i => KNIFE.test(i.name))) return 'no knife in inventory';
        const wanted = exactName(ctx.params.logs);
        if (countItems(s, wanted) === 0) return `no "${ctx.params.logs}" in inventory`;
        const need = requiredLevel(normalizeProduct(ctx.params.product), ctx.params.logs);
        if ('error' in need) return need.error;
        const skill = findSkill(s, 'Fletching');
        if (!skill) return 'no Fletching skill in state';
        if (skill.baseLevel < need.level)
            return `${ctx.params.product} from ${ctx.params.logs} needs fletching ${need.level}, bot has ${skill.baseLevel}`;
        if (ctx.params.attachFeathers && !wantsFeathers(ctx))
            return 'attachFeathers only works with product "arrow shaft"';
        if (wantsFeathers(ctx) && countItems(s, FEATHERS) === 0)
            return 'attachFeathers set but no Feathers in inventory';
        return null;
    },

    steps: [
        {
            name: 'attacked',
            when: ctx => !!ctx.state().player?.combat.inCombat,
            run(ctx) {
                const p = ctx.state().player;
                return { fail: `attacked while fletching at (${p?.worldX},${p?.worldZ})` };
            },
        },
        {
            name: 'cut',
            when: ctx => countItems(ctx.state(), exactName(ctx.params.logs)) > 0,
            *run(ctx) {
                if (!ctx.state().inventory.some(i => KNIFE.test(i.name))) return { fail: 'no knife in inventory' };
                const fails = ctx.streak('fletchFails');
                const cut = yield* fletch(
                    ctx,
                    exactName(ctx.params.logs),
                    normalizeProduct(ctx.params.product),
                    ctx.params.batch,
                );
                if (cut.ok) {
                    fails.reset();
                    return;
                }
                yield* log(`fletch failed: ${cut.message}`);
                if (fails.add() >= FLETCH_FAIL_LIMIT)
                    return { fail: `${FLETCH_FAIL_LIMIT} fletch attempts in a row failed (last: ${cut.message})` };
            },
        },
        {
            name: 'attach-feathers',
            when: ctx =>
                wantsFeathers(ctx) && countItems(ctx.state(), SHAFTS) > 0 && countItems(ctx.state(), FEATHERS) > 0,
            *run(ctx) {
                const s = ctx.state();
                const shafts = s.inventory.find(i => SHAFTS.test(i.name));
                const feathers = s.inventory.find(i => FEATHERS.test(i.name));
                if (!shafts || !feathers) return;
                const fails = ctx.streak('featherFails');
                const before = countItems(s, SHAFTS);
                const used = yield* useItemOnItem(ctx, feathers, shafts);
                // The op is satisfied by the first sign the game acted; the headless arrows are made when shafts leave.
                const consumed =
                    used.ok &&
                    (yield* wait('shafts consumed', st => countItems(st, SHAFTS) < before, FEATHER_WAIT_TICKS)).kind ===
                        'met';
                if (consumed) {
                    fails.reset();
                    return;
                }
                yield* log(`attaching feathers failed: ${used.ok ? 'no shafts consumed' : used.message}`);
                if (fails.add() >= FLETCH_FAIL_LIMIT) {
                    const last = ctx.state().gameMessages.at(-1)?.text ?? 'none';
                    return { fail: `${FLETCH_FAIL_LIMIT} feather attempts failed (last game message: ${last})` };
                }
            },
        },
        {
            name: 'finish',
            when: () => true,
            run(ctx) {
                const left = countItems(ctx.state(), SHAFTS);
                if (wantsFeathers(ctx) && left > 0)
                    return { done: `no ${ctx.params.logs} left to fletch; ${left} Arrow shafts left, no Feathers` };
                return { done: `no ${ctx.params.logs} left to fletch` };
            },
        },
    ],
});
