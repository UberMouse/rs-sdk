import { z } from 'zod/v4';
import type { BotWorldState } from '../../sdk/types';
import { AreaSchema, refuseArea, walkToArea } from '../lib/area';
import { defineTask, type TaskContext } from '../lib/task';

const FAIL_LIMIT = 3;
/** Walks to a far bank outlast the engine's default step timeout. */
const STEP_TIMEOUT_MS = 300_000;

const Params = z.object({
    /** Walk here first (a bank, e.g. Varrock West (3185,3436)). Omit to use the nearest bank to where the bot stands. */
    area: AreaSchema.optional(),
    /** Inventory items to deposit, by exact name. Omit `count` to deposit all of that item. */
    deposit: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive().optional() })).default([]),
    /** Deposit every inventory item whose exact name is not listed here (tools stay). Runs after `deposit`. Worn gear is untouched. */
    depositAllExcept: z.array(z.string().min(1)).optional(),
    /** Bank items to withdraw, by exact name, after all deposits. Fails if the bank holds fewer than `count`. */
    withdraw: z.array(z.object({ item: z.string().min(1), count: z.number().int().positive() })).default([]),
});

type BankParams = z.infer<typeof Params>;
type Ctx = TaskContext<BankParams>;
type Op =
    | { kind: 'deposit'; item: string; count?: number }
    | { kind: 'depositAllExcept'; keep: string[] }
    | { kind: 'withdraw'; item: string; count: number };

const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const invCount = (state: BotWorldState, name: string) =>
    state.inventory.filter(i => sameName(i.name, name)).reduce((n, i) => n + i.count, 0);

/** Deposits first, then withdrawals, so freed slots can be refilled in one trip. */
const opsOf = (ctx: Ctx): Op[] => [
    ...ctx.params.deposit.map(d => ({ kind: 'deposit' as const, ...d })),
    ...(ctx.params.depositAllExcept ? [{ kind: 'depositAllExcept' as const, keep: ctx.params.depositAllExcept }] : []),
    ...ctx.params.withdraw.map(w => ({ kind: 'withdraw' as const, ...w })),
];

/** The next operation to make, or undefined when all are made. */
const nextOp = (ctx: Ctx): Op | undefined => opsOf(ctx)[ctx.counter('opsMade').add(0)];

/** Closes the bank (best effort) so a failed run does not leave a modal hiding the inventory. */
const failClosing = async (ctx: Ctx, msg: string) => {
    await ctx.bot.closeBank();
    return { fail: msg };
};

/** Returns a failure message, or null when the operation went through. */
async function perform(ctx: Ctx, op: Op): Promise<string | null> {
    if (op.kind === 'deposit') {
        const r = await ctx.bot.depositItem(exactName(op.item), op.count ?? -1);
        ctx.log(`deposit ${op.item}: ${r.message}`);
        return r.success ? null : `deposit ${op.item} failed (${r.reason ?? 'unknown'}): ${r.message}`;
    }
    if (op.kind === 'depositAllExcept') {
        const names = new Set<string>();
        for (const i of ctx.state().inventory) {
            if (!op.keep.some(k => sameName(k, i.name))) names.add(i.name);
        }
        for (const name of names) {
            const r = await ctx.bot.depositItem(exactName(name), -1);
            ctx.log(`deposit ${name}: ${r.message}`);
            if (!r.success) return `deposit ${name} failed (${r.reason ?? 'unknown'}): ${r.message}`;
        }
        return null;
    }
    const pattern = exactName(op.item);
    const banked = ctx.state().bank.items.filter(i => pattern.test(i.name));
    const have = banked.reduce((n, i) => n + i.count, 0);
    if (have < op.count) return `bank holds ${have} ${op.item}, need ${op.count}`;
    const r = await ctx.bot.withdrawItem(pattern, op.count);
    ctx.log(`withdraw ${op.item} x${op.count}: ${r.message}`);
    if (r.success) return null;
    return `withdraw ${op.item} x${op.count} failed (${r.reason ?? 'unknown'}, got ${r.amountWithdrawn ?? 0}): ${r.message}`;
}

export default defineTask({
    name: 'bank',
    description:
        'Walk to a bank (optional `area`, e.g. Varrock West {x:3185,z:3436,radius:6}; none = nearest to the bot), open it, deposit (`deposit` [{item,count?}], count omitted = all; ' +
        'then `depositAllExcept` [names] deposits everything else so tools stay), then withdraw (`withdraw` [{item,count}]), close the bank; done when every operation is made. ' +
        'Never sells or drops. Fails (no looping) if the bank holds fewer of an item than asked, or the inventory lacks a listed deposit. No bank in Lumbridge on this server (learnings/banking.md).',
    params: Params,
    stepTimeoutMs: STEP_TIMEOUT_MS,

    preflight(ctx) {
        const { deposit, depositAllExcept, withdraw, area } = ctx.params;
        if (deposit.length === 0 && !depositAllExcept && withdraw.length === 0) return 'nothing to deposit or withdraw';
        const refused = refuseArea(area);
        if (refused) return refused;
        const s = ctx.state();
        const requested = new Map<string, { entries: number; all: boolean; total: number }>();
        for (const t of deposit) {
            const have = invCount(s, t.item);
            if (have === 0) return `cannot deposit ${t.item}: not in inventory`;
            const key = t.item.toLowerCase();
            const acc = requested.get(key) ?? { entries: 0, all: false, total: 0 };
            acc.entries++;
            acc.all ||= !t.count;
            acc.total += t.count ?? 0;
            requested.set(key, acc);
            if (acc.entries > 1 && acc.all)
                return `cannot deposit ${t.item}: listed more than once and an entry has no count (all)`;
            if (acc.total > have) return `cannot deposit ${acc.total} ${t.item}: only ${have} in inventory`;
        }
        return null;
    },

    steps: [
        {
            // bot.openBank accepts any open bank; the run walks only while it is closed.
            name: 'walk-to-bank',
            when: ctx => {
                const { area } = ctx.params;
                return (
                    !!area && !ctx.state().bank.isOpen && !!nextOp(ctx) && ctx.distanceTo(area.x, area.z) > area.radius
                );
            },
            async run(ctx) {
                const { area } = ctx.params;
                // Narrowing only: when() guarantees it.
                if (!area) return;
                const failure = await walkToArea(ctx, area);
                if (failure) return { fail: failure };
            },
        },
        {
            name: 'open-bank',
            when: ctx => !!nextOp(ctx) && !ctx.state().bank.isOpen,
            async run(ctx) {
                const r = await ctx.bot.openBank();
                const fails = ctx.counter('openFails');
                if (r.success) return fails.reset();
                if (fails.add() >= FAIL_LIMIT)
                    return { fail: `cannot open bank (${r.reason ?? 'unknown'}): ${r.message}` };
            },
        },
        {
            name: 'operate',
            when: ctx => !!nextOp(ctx),
            async run(ctx) {
                const op = nextOp(ctx);
                // Narrowing only: when() guarantees it.
                if (!op) return;
                const failure = await perform(ctx, op);
                if (failure) return failClosing(ctx, failure);
                ctx.counter('opsMade').add();
            },
        },
        {
            name: 'finish',
            when: ctx => !nextOp(ctx),
            async run(ctx) {
                // The bank modal hides the inventory, so close it before ending.
                if (ctx.state().bank.isOpen) {
                    const c = await ctx.bot.closeBank();
                    if (!c.success) return { fail: `operations done but cannot close bank: ${c.message}` };
                }
                return { done: `all ${opsOf(ctx).length} bank operations made` };
            },
        },
    ],
});
