import { z } from 'zod/v4';
import { defineTask } from '../lib/task';

const TREES = {
    tree: { pattern: /^tree$/i, level: 1 },
    oak: { pattern: /^oak( tree)?$/i, level: 15 },
    willow: { pattern: /^willow( tree)?$/i, level: 30 },
} as const;

const AXE = /(^|\s)axe$/i;

const Params = z.object({
    tree: z.enum(['tree', 'oak', 'willow']).default('tree'),
    /** Stay near here; walk back when further than `radius`. Omit to chop wherever the bot is. */
    area: z.object({ x: z.number(), z: z.number(), radius: z.number().default(15) }).optional(),
    /** What to do with a full inventory. Only drop is supported so far. */
    onFull: z.enum(['drop']).default('drop'),
});

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export default defineTask({
    name: 'woodcutting',
    description:
        'Chop trees of one type and drop the logs when full. Needs an axe and the level for the tree. ' +
        'Known spots: Lumbridge trees (3195,3220); Varrock oaks (3190,3458); Draynor willows (3087,3235, dark wizards nearby).',
    params: Params,

    preflight(ctx) {
        const s = ctx.state();
        if (![...s.inventory, ...s.equipment].some(i => AXE.test(i.name))) return 'no axe in inventory or equipped';
        const need = TREES[ctx.params.tree].level;
        const have = s.skills.find(k => k.name === 'Woodcutting')?.baseLevel ?? 1;
        if (have < need) return `${ctx.params.tree} needs woodcutting ${need}, bot has ${have}`;
        return null;
    },

    steps: [
        {
            name: 'drop-logs',
            when: ctx => ctx.state().inventory.length >= 28,
            async run(ctx) {
                const r = await ctx.bot.dropItem(/logs$/i, 'all');
                if (ctx.state().inventory.length >= 28) {
                    return { fail: `inventory still full after dropping logs (${r.message})` };
                }
            },
        },
        {
            name: 'return-to-area',
            when: ctx => {
                const a = ctx.params.area;
                const p = ctx.state().player;
                return !!a && !!p && dist(p.worldX, p.worldZ, a.x, a.z) > a.radius;
            },
            async run(ctx) {
                const a = ctx.params.area!;
                const r = await ctx.bot.walkTo(a.x, a.z, 3);
                ctx.memory.walkFails = r.success ? 0 : (ctx.memory.walkFails ?? 0) + 1;
                if (ctx.memory.walkFails >= 3) return { fail: `can't walk to area (${r.message})` };
            },
        },
        {
            name: 'chop',
            when: () => true,
            async run(ctx) {
                const { pattern } = TREES[ctx.params.tree];
                const tree = ctx.sdk.findNearbyLoc(pattern, { reachable: true, withOption: /chop/i });
                if (!tree) {
                    ctx.memory.noTree = (ctx.memory.noTree ?? 0) + 1;
                    if (ctx.memory.noTree >= 10) return { fail: `no reachable ${ctx.params.tree} nearby` };
                    // Trees respawn; wait a few ticks, and drift back to the area centre if we have one.
                    const a = ctx.params.area;
                    if (a) await ctx.bot.walkTo(a.x, a.z, 3);
                    await ctx.sdk.waitForTicks(3);
                    return;
                }
                ctx.memory.noTree = 0;
                const r = await ctx.bot.chopTree(tree);
                ctx.memory.chopFails = r.success ? 0 : (ctx.memory.chopFails ?? 0) + 1;
                if (!r.success) ctx.log(`chop failed: ${r.message}`);
                if (ctx.memory.chopFails >= 8) return { fail: `8 chops in a row failed (last: ${r.message})` };
            },
        },
    ],
});
