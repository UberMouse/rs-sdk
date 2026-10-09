import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { defineTask, type TaskContext } from '../lib/task';
import { findSkill } from '../lib/util';

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

const Params = z.object({
    /** Product: "arrow shaft", "short bow" or "long bow" (the dialog labels). "shortbow (u)" / "longbow (u)" are accepted too. */
    product: z.string().min(1),
    /** Exact item name of the logs to cut. */
    logs: z.string().default('Logs'),
    /** After the logs are cut, attach Feathers to the Arrow shafts (needs product "arrow shaft"). */
    attachFeathers: z.boolean().default(false),
});

type FletchParams = z.infer<typeof Params>;
type Ctx = TaskContext<FletchParams>;

const isWantedLogs = (name: string, wanted: string) => name.toLowerCase() === wanted.toLowerCase();
const isAnyLogs = (name: string) => /logs$/i.test(name);

const countOf = (state: BotWorldState, pattern: RegExp) =>
    state.inventory.filter(i => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
const countLogs = (state: BotWorldState, wanted: string) =>
    state.inventory.filter(i => isWantedLogs(i.name, wanted)).reduce((n, i) => n + i.count, 0);

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
        'the run fails if something attacks the bot. Inventory must not hold other log types than `logs`.',
    params: Params,

    preflight(ctx) {
        const s = ctx.state();
        if (!s.inventory.some(i => KNIFE.test(i.name))) return 'no knife in inventory';
        if (countLogs(s, ctx.params.logs) === 0) return `no "${ctx.params.logs}" in inventory`;
        // bot.fletchLogs cuts the first logs stack it finds, so a different type could be cut instead.
        if (s.inventory.some(i => isAnyLogs(i.name) && !isWantedLogs(i.name, ctx.params.logs)))
            return `inventory also holds other logs than "${ctx.params.logs}"; fletchLogs would pick the wrong stack`;
        const need = requiredLevel(normalizeProduct(ctx.params.product), ctx.params.logs);
        if ('error' in need) return need.error;
        const skill = findSkill(s, 'Fletching');
        if (!skill) return 'no Fletching skill in state';
        if (skill.baseLevel < need.level)
            return `${ctx.params.product} from ${ctx.params.logs} needs fletching ${need.level}, bot has ${skill.baseLevel}`;
        if (ctx.params.attachFeathers && !wantsFeathers(ctx))
            return 'attachFeathers only works with product "arrow shaft"';
        if (wantsFeathers(ctx) && countOf(s, FEATHERS) === 0) return 'attachFeathers set but no Feathers in inventory';
        return null;
    },

    steps: [
        {
            name: 'attacked',
            when: ctx => !!ctx.state().player?.combat.inCombat,
            run: async ctx => {
                const p = ctx.state().player;
                return { fail: `attacked while fletching at (${p?.worldX},${p?.worldZ})` };
            },
        },
        {
            name: 'cut',
            when: ctx => countLogs(ctx.state(), ctx.params.logs) > 0,
            async run(ctx) {
                if (!ctx.state().inventory.some(i => KNIFE.test(i.name))) return { fail: 'no knife in inventory' };
                const fails = ctx.counter('fletchFails');
                const r = await ctx.bot.fletchLogs(normalizeProduct(ctx.params.product));
                if (!r.success) {
                    ctx.log(`fletch failed: ${r.message}`);
                    if (fails.add() >= FLETCH_FAIL_LIMIT)
                        return { fail: `${FLETCH_FAIL_LIMIT} fletch attempts in a row failed (last: ${r.message})` };
                    return;
                }
                // bot.fletchLogs clicks the make-1 button: one log per call (an SDK quantity option is a roadmap follow-up).
                fails.reset();
            },
        },
        {
            name: 'attach-feathers',
            when: ctx => wantsFeathers(ctx) && countOf(ctx.state(), SHAFTS) > 0 && countOf(ctx.state(), FEATHERS) > 0,
            async run(ctx) {
                const s = ctx.state();
                const shafts = s.inventory.find(i => SHAFTS.test(i.name));
                const feathers = s.inventory.find(i => FEATHERS.test(i.name));
                if (!shafts || !feathers) return;
                const fails = ctx.counter('featherFails');
                const before = countOf(s, SHAFTS);
                // No bot.* porcelain exists for feather-on-shaft, so use the raw call.
                const res = await ctx.sdk.sendUseItemOnItem(feathers.slot, shafts.slot);
                const consumed =
                    res.success &&
                    (await ctx.sdk
                        .waitForCondition(st => countOf(st, SHAFTS) < before, 5000)
                        .then(
                            () => true,
                            () => false,
                        ));
                if (consumed) {
                    fails.reset();
                    return;
                }
                ctx.log(`attaching feathers failed: ${res.success ? 'no shafts consumed' : res.message}`);
                if (fails.add() >= FLETCH_FAIL_LIMIT) {
                    const last = ctx.state().gameMessages.at(-1)?.text ?? 'none';
                    return { fail: `${FLETCH_FAIL_LIMIT} feather attempts failed (last game message: ${last})` };
                }
            },
        },
        {
            name: 'finish',
            when: () => true,
            run: async ctx => {
                const left = countOf(ctx.state(), SHAFTS);
                if (wantsFeathers(ctx) && left > 0)
                    return { done: `no ${ctx.params.logs} left to fletch; ${left} Arrow shafts left, no Feathers` };
                return { done: `no ${ctx.params.logs} left to fletch` };
            },
        },
    ],
});
