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

/**
 * A curated method. The floor (model/cycle.ts) assumes axes and pickaxes are wielded and does not check their wield
 * level (a rune pickaxe needs Attack 40): a conductor reading a level column checks the tool's requirement itself.
 */
export interface MethodDef {
    /** Stable, kebab-case; plans name it. */
    id: string;
    name: string;
    /**
     * The family of the action at the site (model/families/index.ts), or `withdraw`: no action, the load is taken
     * from the bank `at` lies in (params `{ obj }`), and the cycle starts and ends there.
     */
    family: string;
    /** A tile in the site. */
    at: Tile;
    /** The family's params: tree type, tool, fish, npc ... */
    params: unknown;
    /**
     * Where the products go. `bank` omitted: the nearest bank of the site, or of the last process step's site. A
     * process sink runs its steps in order, each taking a product of the gather or of an earlier step, then (`end`)
     * banks, drops the end products at the last step, or keeps them (a stackable product: runes).
     */
    sink:
        | { mode: 'drop' }
        | { mode: 'bank'; bank?: Tile }
        | { mode: 'process'; steps: ProcessStepDef[]; end: 'bank' | 'drop' | 'keep'; bank?: Tile };
    /** The obj eaten to cover the action's damage (pickpocket stuns, agility falls), restocked at the bank. */
    food?: string;
    /** Promoted plans that run it (conductor/plans/). */
    plans?: string[];
    measured?: Measured[];
    notes?: string;
    /** Where the method came from (a goal report, a spot search). */
    source?: string;
}

/** One process step of a method. */
export interface ProcessStepDef {
    family: string;
    /**
     * `'here'`: where the previous action stands (superheat beside the rock); a tile: in a site of the family's kinds,
     * or, for a family with no kinds (firemaking), the tile itself; omitted: the nearest site of the first of its kinds
     * to the previous step's site (the gather's for the first), which a family with no kinds can't have.
     */
    at?: Tile | 'here';
    /** The family's params, or a list of them, one per input kind it takes (cooking: one per raw fish). */
    params: unknown;
}

export interface Measured {
    /** Game XP per hour, XP_RATE included, as stats.ts prints it. */
    xpPerHour: Partial<Record<Skill, number>>;
    /** At the start of the measured runs. */
    level: Partial<Record<Skill, number>>;
    /** The axe or pickaxe the runs used, when the family reads one from the profile. */
    tool?: string;
    /** The objs worn in the runs that a family reads (Profile.worn). */
    worn?: string[];
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
        measured: [
            {
                // iron-bulk's mine leg phases, its whole cycle: the mining phase alone (1,048,493/h) leaves out the bank and walk.
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
        notes:
            "Measured from iron-bulk's mine leg phases (the plan also smelts and smiths, so names no method): it carries " +
            'the pickaxe and banks 25 ore a trip; the floor wields it and fills 28.',
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
        notes: 'The four iron rocks; the mining task drops each ore as it is mined. No promoted plan.',
        source: 'conductor/roadmap.md Mining row: iron power-mine, drop each ore, a 4-rock layout',
    },
    {
        id: 'lure-lumbridge-cook-bank',
        name: 'Fly fishing at the River Lum, cooked on the Lumbridge pot, banked at Varrock East',
        family: 'fishing',
        at: { level: 0, x: 3238, z: 3252 },
        params: { tool: 'fly_fishing_rod' },
        sink: {
            mode: 'process',
            steps: [
                {
                    family: 'cooking',
                    at: { level: 0, x: 3232, z: 3238 },
                    params: [{ food: 'raw_trout' }, { food: 'raw_salmon' }],
                },
            ],
            end: 'bank',
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
        notes:
            'knight-thieve also fishes and cooks its lobsters at Catherby, so it names no method; the measured figure ' +
            'comes from its thieving and Ardougne South bank phases.',
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
