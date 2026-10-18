// The training methods, curated: one record per way of training at a site that the conductor runs or has found. The
// build resolves each (model/method.ts: its site, sinks, legs and minimum level) and fails naming a record it can't;
// the cycle model (model/cycle.ts) turns a resolved method and a profile into its floor, the tick-perfect rate.
// - `at` is a tile in the site (site ids renumber when the data changes; tiles don't): one of the target's own
//   tiles, or any tile in the site's bbox.
// - A record's `measured` figures are copied from `bun conductor/tools/stats.ts` when a goal finishes, as the roadmap
//   rows are; run logs stay out of the repo. The levels are the ones at the start of the measured runs, read from the
//   runs' tick recordings.
// - A measured figure above the floor at its levels is a model bug to find, not a figure to edit.
import type { Skill } from './model/server';
import type { Tile } from './types';

export interface MethodDef {
    /** Stable, kebab-case; plans name it. */
    id: string;
    name: string;
    /** The family of the action at the site (model/families/index.ts). */
    family: string;
    /** A tile in the site. */
    at: Tile;
    /** The family's params: tree type, tool, fish, npc ... */
    params: unknown;
    /**
     * Where the products go. `bank` omitted: the site's nearest bank. A process step's `at` omitted: the site's
     * nearest processor of the step's kind; its `params` are the family's params, or a list of them, one per gathered
     * product it takes (cooking: one per raw fish). A process-bank's `bank` omitted: the processor's nearest bank.
     */
    sink:
        | { mode: 'drop' }
        | { mode: 'bank'; bank?: Tile }
        | { mode: 'process-bank'; process: { family: string; at?: Tile; params: unknown }; bank?: Tile };
    /** The obj eaten to cover a family's failure damage (pickpocket stuns), restocked at the bank. */
    food?: string;
    /** Promoted plans that run it (conductor/plans/). */
    plans?: string[];
    measured?: Measured[];
    notes?: string;
    /** Where the method came from (a goal report, a spot search). */
    source?: string;
}

export interface Measured {
    /** Game XP per hour, XP_RATE included, as stats.ts prints it. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** At the start of the measured runs. */
    level: Partial<Record<Skill, number>>;
    /** The axe or pickaxe the runs used, when the family reads one from the profile. */
    tool?: string;
    bot: string;
    /** YYYY-MM-DD. */
    date: string;
    /** Run time behind the figure. */
    hours: number;
    /** The stats.ts command (or commands) the figure is read from. */
    from: string;
}

export const METHODS: MethodDef[] = [
    {
        id: 'iron-se-varrock-bank',
        name: 'Iron at the south-east Varrock mine, banked at Varrock East',
        family: 'mining',
        at: { level: 0, x: 3285, z: 3369 },
        params: { rock: 'iron' },
        sink: { mode: 'bank' },
        plans: ['iron-bulk'],
        measured: [
            {
                // The mine leg's whole cycle: the mining phase alone (1,048,493/h) leaves out the bank and walk.
                xpPerHour: { mining: 543_631 },
                level: { mining: 99 },
                tool: 'adamant_pickaxe',
                bot: 'conductor2',
                date: '2026-10-16',
                hours: 0.2012,
                from:
                    'stats.ts conductor2 --phases --since 2026-10-16: --task mining (iron, area 3285,3365 r10) 109,375 XP ' +
                    'in 0.1043 h, + --task bank (Varrock East r3, deposit all but pickaxe) 0.0398 h, + --task travel ' +
                    '(to 3286,3368) 0.0571 h',
            },
        ],
        notes: "iron-bulk's mine leg carries the pickaxe and banks 25 ore a trip; the floor wields it and fills 28.",
    },
    {
        id: 'iron-se-varrock-drop',
        name: 'Iron at the south-east Varrock mine, dropped as mined',
        family: 'mining',
        at: { level: 0, x: 3285, z: 3369 },
        params: { rock: 'iron' },
        sink: { mode: 'drop' },
        measured: [
            {
                xpPerHour: { mining: 1_168_071 },
                level: { mining: 99 },
                tool: 'adamant_pickaxe',
                bot: 'conductor2w1',
                date: '2026-10-11',
                hours: 0.0667,
                from: 'stats.ts conductor2w1 --task mining (iron, area 3286,3369 r4, onFull drop)',
            },
        ],
        notes: 'The four iron rocks; the mining task drops each ore as it is mined (02b861cd5). No promoted plan.',
        source: 'conductor/roadmap.md Mining row: iron power-mine, drop each ore, a 4-rock layout',
    },
    {
        id: 'lure-lumbridge-cook-bank',
        name: 'Fly fishing at the River Lum, cooked on the Lumbridge pot, banked at Varrock East',
        family: 'fishing',
        at: { level: 0, x: 3238, z: 3252 },
        params: { tool: 'fly_fishing_rod' },
        sink: {
            mode: 'process-bank',
            process: {
                family: 'cooking',
                at: { level: 0, x: 3232, z: 3238 },
                params: [{ food: 'raw_trout' }, { food: 'raw_salmon' }],
            },
            bank: { level: 0, x: 3254, z: 3418 },
        },
        plans: ['lure-cook-bank'],
        measured: [
            {
                xpPerHour: { fishing: 489_817, cooking: 758_050 },
                level: { fishing: 67, cooking: 68 },
                bot: 'conductor2',
                date: '2026-10-11',
                hours: 0.3,
                from: 'stats.ts conductor2 --task plan:lure-cook-bank (fishing area 3239,3248 r10)',
            },
        ],
        notes:
            'The measured Cooking includes 16 raw fish held from an earlier run (30,500 XP); without them ~656k/h. ' +
            'The plan drops burnt fish; the floor banks them.',
    },
    {
        id: 'guard-falador-pickpocket',
        name: 'Pickpocketing the Falador guards, food from Falador East',
        family: 'pickpocket',
        at: { level: 0, x: 3006, z: 3322 },
        params: { npc: 'guard1' },
        food: 'trout',
        sink: { mode: 'bank' },
        plans: ['guard-thieve'],
        measured: [
            {
                xpPerHour: { thieving: 2_073_294 },
                level: { thieving: 82, hitpoints: 36 },
                bot: 'conductor2',
                date: '2026-10-11',
                hours: 0.33,
                from: 'stats.ts conductor2 --task plan:guard-thieve (food Trout/Salmon, eatBelow 0.6)',
            },
        ],
        notes: 'The plan eats trout and salmon; the record names trout, the smaller heal of the two.',
    },
    {
        id: 'knight-ardougne-pickpocket',
        name: 'Pickpocketing the Knights of Ardougne in the market, food from Ardougne South',
        family: 'pickpocket',
        at: { level: 0, x: 2659, z: 3308 },
        params: { npc: 'knight_of_ardougne' },
        food: 'lobster',
        sink: { mode: 'bank' },
        plans: ['knight-thieve'],
        measured: [
            {
                xpPerHour: { thieving: 3_711_068 },
                level: { thieving: 99, hitpoints: 46 },
                bot: 'conductor2w3',
                date: '2026-10-16',
                hours: 0.635,
                from: 'stats.ts conductor2w3 --task plan:knight-thieve (thieving and Ardougne South bank phases only)',
            },
        ],
        notes: "The plan's Catherby lobster phases did not run in the measured runs.",
    },
    {
        id: 'willow-draynor-bank',
        name: 'Willows at Draynor, banked at Draynor',
        family: 'woodcutting',
        at: { level: 0, x: 3086, z: 3232 },
        params: { tree: 'willow' },
        sink: { mode: 'bank' },
        notes: 'willow-burn chops these willows but burns the logs; no run has banked them, so it is unmeasured.',
    },
];
