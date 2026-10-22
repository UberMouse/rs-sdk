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
    {
        id: 'iron-khazard-superheat-platebody-drop',
        name: 'Iron at Port Khazard, superheated at the rocks, smithed into platebodies and dropped',
        family: 'mining',
        at: { level: 0, x: 2625, z: 3150 },
        params: { rock: 'iron' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'superheat', at: 'here', params: { ore: 'iron_ore' } },
                { family: 'smithing', at: { level: 0, x: 2650, z: 3164 }, params: { product: 'iron_platebody' } },
            ],
            end: 'drop',
        },
        plans: ['khazard-superheat'],
        measured: [
            {
                xpPerHour: { mining: 524_994, magic: 771_141, smithing: 463_117 },
                level: { mining: 99, magic: 55, smithing: 60 },
                tool: 'adamant_pickaxe',
                worn: ['staff_of_fire'],
                bot: 'conductor2w2',
                date: '2026-10-16',
                hours: 0.1667,
                from: "stats.ts conductor2w2 --methods; the worn staff from the run's start state",
            },
        ],
        notes: 'The plan carries the pickaxe and the nature runes and mines until full; the floor wields the pickaxe. Neither carries coal: iron with coal superheats to steel from Smithing 30.',
    },
    {
        id: 'superheat-iron-varrock-east-platebody',
        name: 'Banked iron ore superheated at Varrock East, smithed into platebodies at the south-east anvil',
        family: 'withdraw',
        at: { level: 0, x: 3253, z: 3418 },
        params: { obj: 'iron_ore' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'superheat', at: 'here', params: { ore: 'iron_ore' } },
                { family: 'smithing', at: { level: 0, x: 3246, z: 3404 }, params: { product: 'iron_platebody' } },
            ],
            end: 'bank',
        },
        plans: ['superheat-banked'],
        measured: [
            {
                xpPerHour: { magic: 1_588_975, smithing: 1_124_275 },
                level: { magic: 55, smithing: 60 },
                worn: ['staff_of_fire'],
                bot: 'conductor2w2',
                date: '2026-10-16',
                hours: 0.1668,
                from: "stats.ts conductor2w2 --methods; the worn staff from the run's start state",
            },
        ],
        notes: 'The plan withdraws 25 ore and 30 nature runes a trip and casts at the bank.',
    },
    {
        id: 'iron-se-varrock-superheat-platebody-bank',
        name: 'Iron at the south-east Varrock mine, superheated there, smithed into platebodies, banked at Varrock East',
        family: 'mining',
        at: { level: 0, x: 3285, z: 3369 },
        params: { rock: 'iron' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'superheat', at: 'here', params: { ore: 'iron_ore' } },
                { family: 'smithing', at: { level: 0, x: 3246, z: 3404 }, params: { product: 'iron_platebody' } },
            ],
            end: 'bank',
            bank: { level: 0, x: 3253, z: 3418 },
        },
        plans: ['superheat-mine'],
        measured: [
            {
                xpPerHour: { mining: 393_746, magic: 596_244, smithing: 328_119 },
                level: { mining: 99, magic: 55, smithing: 60 },
                tool: 'adamant_pickaxe',
                worn: ['staff_of_fire'],
                bot: 'conductor2w2',
                date: '2026-10-16',
                hours: 0.1667,
                from: "stats.ts conductor2w2 --methods; the worn staff from the run's start state",
            },
        ],
        notes: 'The plan carries the pickaxe and walks to the anvil by a waypoint; the floor wields the pickaxe and runs the shortest way.',
    },
    {
        id: 'iron-se-varrock-smelt-lumbridge-kiteshield',
        name: 'Iron at the south-east Varrock mine, smelted at Lumbridge, smithed into kiteshields at Varrock West, banked there',
        family: 'mining',
        at: { level: 0, x: 3285, z: 3369 },
        params: { rock: 'iron' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'smelting', at: { level: 0, x: 3225, z: 3256 }, params: { bar: 'iron_bar' } },
                { family: 'smithing', at: { level: 0, x: 3188, z: 3421 }, params: { product: 'iron_kiteshield' } },
            ],
            end: 'bank',
            bank: { level: 0, x: 3186, z: 3436 },
        },
        plans: ['iron-smith'],
        notes: 'Kiteshields from Smithing 27; below that the plan smiths warhammers (24) and battleaxes (25), which this record leaves out. Unmeasured: its runs started below 27 or lasted under a cycle; seed it from stats.ts --methods after its next goal.',
    },
    {
        id: 'agility-wilderness-course',
        name: 'Laps of the Wilderness Agility Course, food from Edgeville',
        family: 'agility',
        at: { level: 0, x: 2994, z: 3936 },
        params: {},
        food: 'salmon',
        sink: { mode: 'bank', bank: { level: 0, x: 3095, z: 3489 } },
        plans: ['agility-wilderness'],
        measured: [
            {
                xpPerHour: { agility: 1_000_473 },
                level: { agility: 52 },
                bot: 'conductor2w4',
                date: '2026-10-16',
                hours: 0.4647,
                from: 'stats.ts conductor2w4 --methods (the run 2026-10-16T08-36-48-058Z, from Edgeville bank)',
            },
            {
                xpPerHour: { agility: 1_159_177 },
                level: { agility: 89 },
                bot: 'conductor2w4',
                date: '2026-10-16',
                hours: 0.5182,
                from: 'stats.ts conductor2w4 --methods (the run 2026-10-16T09-05-07-248Z, from the course)',
            },
        ],
        notes: "Each run is the plan's whole run, ended by SIGTERM before a bank trip. The plan crosses the ridge gates each lap (150 XP tenths each way); the floor's lap leaves them out (no obstacle of the lap), so the plan runs well under it. Skeleton hits on the course are not modelled.",
    },
    {
        id: 'agility-gnome-course',
        name: 'Laps of the Gnome Stronghold Agility Course',
        family: 'agility',
        at: { level: 0, x: 2474, z: 3435 },
        params: {},
        sink: { mode: 'drop' },
        plans: ['gnome-agility'],
        notes: "No obstacle rolls, so no food, and no product: the drop sink drops nothing. The plan's bank and travel from Varrock are a one-time prologue; unmeasured, as its runs' figures include it: seed it from stats.ts --phases (the agility phase) after its next goal.",
    },
    {
        id: 'agility-barbarian-course',
        name: 'Laps of the Barbarian Outpost Agility Course, food from the nearest bank',
        family: 'agility',
        at: { level: 0, x: 2538, z: 3545 },
        params: {},
        food: 'salmon',
        sink: { mode: 'bank' },
        notes: "No promoted plan. Falls hurt below Agility 93 (the log's roll is certain from there); the food covers them.",
    },
    {
        id: 'earth-runecraft-aubury-essence',
        name: "Essence from Aubury's mine, crafted into earth runes, the runes kept",
        family: 'mining',
        at: { level: 0, x: 2893, z: 4812 },
        params: {},
        sink: {
            mode: 'process',
            steps: [{ family: 'runecraft', at: { level: 0, x: 2657, z: 4840 }, params: {} }],
            end: 'keep',
        },
        plans: ['earth-runecraft-28'],
        notes: "In by Aubury's teleport (its landings' mean), out by the portal back to him. The plan's bank, wield-by-combat and bank are a one-time prologue; unmeasured, as its runs' figures include it: seed it from stats.ts --phases after its next goal. The record names the mine's rock with the fastest trip; the plan mines whichever rock its mining task finds.",
    },
    {
        id: 'flax-seers-spin-bank',
        name: "Flax picked at Seers' Village, spun into bow strings at the Seers wheel, banked at Seers",
        family: 'pick',
        at: { level: 0, x: 2743, z: 3445 },
        params: {},
        sink: {
            mode: 'process',
            steps: [{ family: 'spinning', at: { level: 1, x: 2711, z: 3471 }, params: { obj: 'flax' } }],
            end: 'bank',
            bank: { level: 0, x: 2722, z: 3494 },
        },
        plans: ['flax-spin'],
        measured: [
            {
                xpPerHour: { crafting: 291_801 },
                level: { crafting: 43 },
                bot: 'conductor2w1',
                date: '2026-10-16',
                hours: 0.1748,
                from: 'stats.ts conductor2w1 --methods',
            },
        ],
        notes: "The plan's to-seers travel is a one-time prologue (the measured runs started at Seers and never ran it).",
    },
    {
        id: 'willow-seers-longbow-bank',
        name: "Willows at Seers' Village, cut and strung into willow longbows there, banked at Seers",
        family: 'woodcutting',
        at: { level: 0, x: 2711, z: 3511 },
        params: { tree: 'willow' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'fletching', at: 'here', params: { product: 'unstrung_willow_longbow' } },
                { family: 'fletching', at: 'here', params: { product: 'willow_longbow' } },
            ],
            end: 'bank',
            bank: { level: 0, x: 2722, z: 3494 },
        },
        plans: ['willow-longbows'],
        measured: [
            {
                xpPerHour: { woodcutting: 758_139, fletching: 886_758 },
                level: { woodcutting: 80, fletching: 40 },
                tool: 'mithril_axe',
                bot: 'conductor2w3',
                date: '2026-10-16',
                hours: 0.2738,
                from: 'stats.ts conductor2w3 --methods',
            },
        ],
        notes: 'The plan carries 13 bow strings and chops 13 logs a trip; the floor cuts and strings each log as it is chopped, so the strings free their slots.',
    },
    {
        id: 'trees-lumbridge-burn',
        name: 'Trees west of Lumbridge, the logs burnt east of the general store',
        family: 'woodcutting',
        at: { level: 0, x: 3195, z: 3220 },
        params: { tree: 'normal' },
        sink: {
            mode: 'process',
            steps: [{ family: 'firemaking', at: { level: 0, x: 3230, z: 3240 }, params: { log: 'logs' } }],
            end: 'keep',
        },
        plans: ['chop-burn'],
        notes: 'Unmeasured: no run of the plan yet; seed it from stats.ts --methods after its next goal.',
    },
    {
        id: 'willow-draynor-burn',
        name: 'Willows at Draynor, the logs burnt by the bank',
        family: 'woodcutting',
        at: { level: 0, x: 3086, z: 3232 },
        params: { tree: 'willow' },
        sink: {
            mode: 'process',
            steps: [{ family: 'firemaking', at: { level: 0, x: 3088, z: 3247 }, params: { log: 'willow_logs' } }],
            end: 'keep',
        },
        plans: ['willow-burn'],
        measured: [
            {
                xpPerHour: { woodcutting: 666_900, firemaking: 767_945 },
                level: { woodcutting: 68, firemaking: 58 },
                tool: 'steel_axe',
                bot: 'conductor2',
                date: '2026-10-11',
                hours: 0.167,
                from: "stats.ts conductor2 --methods (the run 2026-10-11T07-40-20-953Z; the plan's runs that day started at different levels)",
            },
        ],
        notes: "The plan's fetch phase is a restock guard. The measured run carried its steel axe; the floor wields it.",
    },
];
