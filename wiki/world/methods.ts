// The training methods, curated: one record per way of training at a site that the conductor runs or has found. The
// build resolves each (model/method.ts: its site, sinks, legs and minimum level) and fails naming a record it can't;
// the cycle model (model/cycle.ts) turns a resolved method and a profile into its floor, the tick-perfect rate.
// - `at` is a tile in the site (site ids renumber when the data changes; tiles don't): one of the target's own
//   tiles, or any tile in the site's bbox.
// - A record's `measured` figures are copied from `bun conductor/tools/stats.ts` when a goal finishes, as the roadmap
//   rows are; run logs stay out of the repo. The levels are the ones at the start of the measured runs, read from the
//   runs' tick recordings.
// - A measured figure above the floor at its levels is a model bug to find, not a figure to edit.
import type { Loot } from './model/cycle';
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
    /**
     * The family's params: tree type, tool, fish ... A combat record's are `{ npc }` (the npc config, omitted when the
     * site has one kind of npc); the style is not a param, as the method swings the one that suits the skill it is
     * rated for (model/method.ts).
     */
    params: unknown;
    /**
     * Where the action's features are: the features of the site's kind within this many tiles of `at` (Chebyshev, on
     * `at`'s level), across sites, in place of the site's own. Omitted: the site's. A combat record's spawns of its npc
     * span sites (the Edgeville dungeon's hill giants are three).
     */
    area?: number;
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
    /**
     * The objs worn, by obj config name (a combat record's weapon and armour): the profile's `worn` when it names
     * none; a profile that names some wears those instead.
     */
    gear?: string[];
    /** What a kill's drops go to (model/cycle.ts Loot); a combat record with bones to bury trains Prayer too. */
    loot?: Loot;
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
    /**
     * The base level at the start of the measured runs, boosts excluded: of each skill the method trains, and for a
     * melee method every skill the combat level is taken from.
     */
    level: Partial<Record<Skill, number>>;
    /** The axe or pickaxe the runs used, when the family reads one from the profile. */
    tool?: string;
    /** The objs worn in the runs (Profile.worn): all of them, as stats.ts records it, or those a family reads. */
    worn?: string[];
    bot: string;
    /** YYYY-MM-DD. */
    date: string;
    /** Run time behind the figure. */
    hours: number;
    /** The stats.ts command (or commands) the figure is read from. */
    from: string;
}

/**
 * Worker runs against one npc, their measured figures per kill beside the model's at the runs' profile
 * (model/method.ts killFigures). A record opens the food gate for its npc (CALIBRATED_NPCS): its kills eat the
 * method's food. It is written only when its damage and fight ticks agree within CALIBRATION_TOLERANCE, and
 * test/combat-method.real.test.ts holds them there. The runs are the calibration smoke's
 * (conductor/test/integration/smoke/combat-calibration.itest.ts), measured with conductor/tools/combat-ledger.ts.
 */
export interface Calibration {
    /** The npc config. */
    npc: string;
    /** Where the runs fought, as a combat record's `at` and `area`. */
    at: Tile;
    area?: number;
    /** The base levels of the runs, 1 for a skill left out. */
    levels: Partial<Record<Skill, number>>;
    /** The objs worn. */
    worn: string[];
    /** The skill the runs trained: their style is the one styleParams gives for it. */
    skill: Skill;
    food: string;
    loot: Loot;
    /**
     * The runs' kills (combat-ledger.ts perKill, its interrupted kills left out): per kill the mean and its standard
     * error of the HP the npc's hitsplats took, the fight ticks (first swing to killing swing), the whole kill's ticks
     * (killing swing to killing swing) and the gap between (killing swing to the next kill's first swing).
     */
    measured: {
        kills: number;
        excluded: number;
        damage: number;
        damageSe: number;
        fight: number;
        fightSe: number;
        ticks: number;
        ticksSe: number;
        gap: number;
        gapSe: number;
    };
    /**
     * killFigures at the runs' profile when the record was written. Damage and fight are held within
     * CALIBRATION_TOLERANCE of the measured; ticks and gap are reported only (the gap is the combat task's overhead).
     */
    model: { damage: number; fight: number; ticks: number; gap: number };
    /** YYYY-MM-DD. */
    date: string;
    /** The runs, as `<bot>/<runId>` (conductor/runs/<bot>/<runId>.ticks.ndjson.gz). */
    runs: string[];
}

/** The calibrated npcs: at most one record each. */
export const CALIBRATIONS: Calibration[] = [
    {
        // Edgeville dungeon's hill giants, as the hill-giants plan fights them, at Defence 1 unarmoured.
        npc: 'giant',
        at: { level: 0, x: 3113, z: 9840 },
        area: 14,
        levels: { attack: 70, strength: 99, defence: 1, hitpoints: 99, prayer: 99 },
        worn: ['mithril_scimitar'],
        skill: 'strength',
        food: 'lobster',
        loot: { bones: 'bury' },
        measured: {
            kills: 72,
            excluded: 0,
            damage: 7.9861,
            damageSe: 0.5324,
            fight: 25.9444,
            fightSe: 1.1043,
            ticks: 42.1159,
            ticksSe: 1.6583,
            gap: 16.4348,
            gapSe: 1.1592,
        },
        model: { damage: 6.689157678, fight: 23.041069272, ticks: 30.541069272, gap: 7.5 },
        date: '2026-10-23',
        runs: [
            'itbxt3d6mz3d/2026-10-23T02-09-07-292Z-combat',
            'itjtbdy3yqle/2026-10-23T02-26-21-689Z-combat',
            'itfdyu1jmi8j/2026-10-23T02-38-12-489Z-combat',
        ],
    },
];

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
        plans: ['knight-thieve-bankfood'],
        measured: [
            {
                xpPerHour: { thieving: 2_958_274 },
                level: { thieving: 72 },
                bot: 'conductor3',
                date: '2026-10-23',
                hours: 0.2835,
                from: 'stats.ts conductor3 --methods',
            },
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
            'comes from its thieving and Ardougne South bank phases. knight-thieve-bankfood eats banked swordfish/tuna ' +
            '(any cooked fish) instead, with a one-time travel in from Catherby.',
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
        plans: ['gnome-agility', 'agility-from-ardougne'],
        measured: [
            {
                xpPerHour: { agility: 206_860 },
                level: { agility: 1 },
                bot: 'conductor3',
                date: '2026-10-23',
                hours: 0.1825,
                from: 'stats.ts conductor3 --methods (includes the 107 s travel in from Ardougne)',
            },
        ],
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
    {
        id: 'hill-giants-edgeville',
        name: 'Hill giants in the Edgeville dungeon, big bones buried, food from Edgeville',
        family: 'combat',
        at: { level: 0, x: 3113, z: 9840 },
        area: 14,
        params: { npc: 'giant' },
        gear: ['mithril_scimitar', 'iron_kiteshield'],
        food: 'trout',
        loot: { bones: 'bury' },
        sink: { mode: 'bank' },
        plans: ['hill-giants', 'giants-att-def'],
        notes:
            'The plans eat trout and salmon; the record names trout, the smaller heal of the two. A rune scimitar ' +
            "(Attack 40) is the next weapon tier. Unmeasured: the plans' runs (conductor2, 2026-10-16) fought on the " +
            'food they started with and never banked, so none is a whole cycle; test/methods.real.test.ts holds the ' +
            'fight-only floor above them.',
    },
    {
        id: 'moss-giants-varrock-sewers',
        name: 'Moss giants in the Varrock Sewers, big bones buried, food from Varrock East',
        family: 'combat',
        at: { level: 0, x: 3159, z: 9900 },
        area: 22,
        params: { npc: 'mossgiant' },
        gear: ['mithril_scimitar', 'iron_kiteshield'],
        food: 'trout',
        loot: { bones: 'bury' },
        sink: { mode: 'bank' },
        notes: "The four spawns of the sewers' west pocket. No promoted plan: a draft (moss-giants, 2026-10-16) named the hill giants' gear and food, and its first run failed on the path in.",
    },
    {
        id: 'chickens-lumbridge',
        name: 'Chickens north of Lumbridge, bones buried, feathers kept',
        family: 'combat',
        at: { level: 0, x: 3230, z: 3299 },
        params: { npc: 'chicken' },
        gear: ['bronze_scimitar'],
        loot: { bones: 'bury' },
        sink: { mode: 'drop' },
        plans: ['melee-chickens'],
        measured: [
            {
                xpPerHour: { attack: 29_915, defence: 28_206, strength: 28_206, hitpoints: 28_052, prayer: 27_881 },
                level: { attack: 1, defence: 1, strength: 1, hitpoints: 10, prayer: 1, ranged: 1, magic: 1 },
                bot: 'conductor3',
                date: '2026-10-23',
                hours: 0.117,
                from: 'stats.ts conductor3 --methods',
            },
        ],
        notes: 'A first melee method, no food. ranged-magic-chickens fights these chickens with a bow and spells, which come later, so it names no method.',
    },
    {
        id: 'net-draynor-drop',
        name: 'Shrimps netted at Draynor, dropped',
        family: 'fishing',
        at: { level: 0, x: 3085, z: 3230 },
        params: { spot: 'saltfish', tool: 'net' },
        sink: { mode: 'drop' },
        notes:
            'The small net on the Draynor sea spots (anchovies from 15), each catch dropped: Fishing from 1 to fly ' +
            'fishing at 20. No promoted plan (fish-cook-bank nets here but cooks and banks the catch); unmeasured.',
        source: 'research-gathering 2026-10-23: every fishing site rated with resolveMethods',
    },
    {
        id: 'lure-lumbridge-drop',
        name: 'Fly fishing at the River Lum, dropped',
        family: 'fishing',
        at: { level: 0, x: 3238, z: 3252 },
        params: { tool: 'fly_fishing_rod' },
        sink: { mode: 'drop' },
        notes:
            'Trout and salmon on the fly rod, a feather a catch, each catch dropped; every fly spot ties on a drop sink, ' +
            'and this one is nearest the spawn. No promoted plan (lure-cook-bank cooks and banks the catch); unmeasured.',
        source: 'research-gathering 2026-10-23',
    },
    {
        id: 'oak-draynor-drop',
        name: 'Oaks north of Draynor, dropped',
        family: 'woodcutting',
        at: { level: 0, x: 3097, z: 3285 },
        params: { tree: 'oak' },
        sink: { mode: 'drop' },
        plans: ['oak-draynor-drop'],
        notes:
            'The five oaks of tree:draynor-village:1, each log dropped as cut. Every oak site ties on a drop sink (no ' +
            'legs); this one is near the spawn. The plan chops the normal trees of the same cluster to 15 first, area ' +
            '(3095,3283) r16 (bbox 3084-3106 x 3275-3290 plus margin). The south cluster (tree:draynor-village:2) is ' +
            'out: the jail guards attack through the fence there (learnings/hazards.md). Runs: conductor3 2026-10-24, ' +
            'south site, steel axe, WC 15-50 in 143.6 s, ~775k/h; conductor3w1 2026-10-24, north site, adamant axe, ' +
            'WC 68-74, ~1.1M/h chopping (984k/h with the walk in), no attacks. Started above level 1, so left out of measured.',
        source: 'research-gathering 2026-10-23: every tree site rated with resolveMethods',
    },
    {
        id: 'iron-al-kharid-3rock-drop',
        name: 'Iron at the Al Kharid mine, the three rocks one tile reaches, dropped as mined',
        family: 'mining',
        at: { level: 0, x: 3295, z: 3310 },
        area: 1,
        params: { rock: 'iron' },
        sink: { mode: 'drop' },
        notes:
            '`at` is the stand tile, and area 1 takes the three iron rocks the reach test passes from it; respawn-bound ' +
            "from the mid 50s. No promoted plan. Unmeasured here: wiki/skills/mining.md's ~1.03M/h at 99 " +
            '(conductor2w1, 2026-10-11, 4-minute runs, adamant pickaxe) has no stats.ts --methods entry to seed it.',
        source: 'research-gathering 2026-10-23: rock clusters from reachTiles',
    },
    {
        id: 'man-catherby-pickpocket',
        name: 'Pickpocketing the men at Catherby, food from Catherby',
        family: 'pickpocket',
        at: { level: 0, x: 2804, z: 3430 },
        params: { npc: 'man' },
        food: 'shrimp',
        sink: { mode: 'bank' },
        notes:
            'Thieving 1-10: the highest man floor of the sites a walk reaches with no requirement, the bank 6 run ticks ' +
            'away. No promoted plan; unmeasured.',
        source: 'research-economy 2026-10-23: every pickpocket site rated with resolveMethods',
    },
    {
        id: 'man-lumbridge-pickpocket',
        name: 'Pickpocketing the men in the Lumbridge castle courtyard, food from Draynor',
        family: 'pickpocket',
        at: { level: 0, x: 3219, z: 3219 },
        params: { npc: 'man' },
        food: 'shrimp',
        sink: { mode: 'bank' },
        notes:
            'The men thieving-40 picks (area 3222,3218 r6), beside the spawn; about 10% under the Catherby floor for ' +
            'the 83-tick walk to Draynor bank. thieving-40 also fights chickens and picks Al-Kharid warriors, so it ' +
            'names no method; unmeasured.',
        source: 'research-economy 2026-10-23',
    },
    {
        id: 'farmer-ardougne-pickpocket',
        name: 'Pickpocketing the farmers north of East Ardougne, food from Ardougne North',
        family: 'pickpocket',
        at: { level: 0, x: 2648, z: 3360 },
        params: { npc: 'farmer1' },
        food: 'shrimp',
        sink: { mode: 'bank' },
        notes: 'Thieving 10-25 band. No promoted plan; unmeasured.',
        source: 'research-economy 2026-10-23',
    },
    {
        id: 'al-kharid-warrior-pickpocket',
        name: 'Pickpocketing the Al-Kharid warriors in the palace, food from Al Kharid',
        family: 'pickpocket',
        at: { level: 0, x: 3292, z: 3172 },
        params: { npc: 'al_kharid_warrior' },
        food: 'trout',
        sink: { mode: 'bank' },
        notes:
            'Thieving 25-40 band, beside the warrior women in Ardougne. thieving-40 picks them on shrimps among other ' +
            'phases, so it names no method; unmeasured.',
        source: 'research-economy 2026-10-23',
    },
    {
        id: 'warrior-woman-ardougne-pickpocket',
        name: 'Pickpocketing the warrior women in East Ardougne, food from Ardougne South',
        family: 'pickpocket',
        at: { level: 0, x: 2628, z: 3294 },
        params: { npc: 'warrior_woman' },
        food: 'trout',
        sink: { mode: 'bank' },
        notes: 'Thieving 25-40 band, beside the Al-Kharid warriors. No promoted plan; unmeasured.',
        source: 'research-economy 2026-10-23',
    },
    {
        id: 'ardougne-guard-north-pickpocket',
        name: 'Pickpocketing the Ardougne guards by Ardougne North bank',
        family: 'pickpocket',
        at: { level: 0, x: 2636, z: 3339 },
        params: { npc: 'ardougne_guard' },
        food: 'trout',
        sink: { mode: 'bank' },
        notes: 'Thieving 40-55 band, before the Knights of Ardougne. No promoted plan; unmeasured.',
        source: 'research-economy 2026-10-23',
    },
    {
        id: 'cows-falador-farm',
        name: 'Cows on the farm east of Falador, bones buried, food from Falador East',
        family: 'combat',
        at: { level: 0, x: 3027, z: 3307 },
        area: 10,
        params: { npc: 'cow' },
        gear: ['steel_scimitar', 'amulet_of_strength'],
        food: 'lobster',
        loot: { bones: 'bury' },
        sink: { mode: 'bank' },
        notes:
            'Melee 1-40 band: seven cows, max hit 1, none hunts; uncalibrated (no CALIBRATIONS record), so it eats ' +
            'nothing yet. Plan melee40 (conductor3 2026-10-24, combat targetRange visible, area radius 22, Mithril ' +
            'scimitar, bones not buried) ran Attack 28-40 and Defence 20-40 in 9.6 min with no idle waits; its rates ' +
            'beat the steel-scimitar floor because the scimitar was better.',
        plans: ['melee40'],
        source: 'research-combat 2026-10-23: a survey of every reachable npc site',
    },
    {
        id: 'scorpions-dwarven-mine',
        name: 'Scorpions in the Dwarven Mine, food from Falador East',
        family: 'combat',
        at: { level: 0, x: 3038, z: 9771 },
        area: 10,
        params: { npc: 'scorpion' },
        gear: ['adamant_scimitar', 'amulet_of_strength'],
        food: 'lobster',
        sink: { mode: 'bank' },
        notes:
            'Melee 30-50 band: eleven spawns, the best floor at 30-50 of the single-way sites a walk reaches with no ' +
            'quest. They hunt low combat levels and drop no bones (no Prayer). No promoted plan; unmeasured and ' +
            'uncalibrated.',
        source: 'research-combat 2026-10-23',
    },
    {
        id: 'moss-giants-kandarin',
        name: 'Moss giants in Kandarin north-west of Ardougne, big bones buried, food from Ardougne North',
        family: 'combat',
        at: { level: 0, x: 2549, z: 3408 },
        area: 10,
        params: { npc: 'mossgiant' },
        gear: ['rune_scimitar', 'amulet_of_strength'],
        food: 'lobster',
        loot: { bones: 'bury' },
        sink: { mode: 'bank' },
        notes:
            'Melee 50-99 band: four spawns, single-way (the Varrock Sewers pocket is not), a few percent over the hill ' +
            'giants on the floor. A rune scimitar needs Attack 40 and no shop sells one. No promoted plan; unmeasured ' +
            'and uncalibrated.',
        source: 'research-combat 2026-10-23',
    },
    {
        id: 'baby-blue-dragons-taverley',
        name: 'Baby blue dragons in Taverley Dungeon, baby dragon bones buried, food from Falador West',
        family: 'combat',
        at: { level: 0, x: 2895, z: 9765 },
        area: 12,
        params: { npc: 'babybluedragon' },
        gear: ['rune_scimitar', 'amulet_of_strength'],
        food: 'lobster',
        loot: { bones: 'bury' },
        sink: { mode: 'bank' },
        notes:
            "Prayer 60-99 band: the best Prayer floor the index rates. The way in needs the dusty key (the site's " +
            'Requires: carry Dusty key). Only adult dragons breathe fire (npc/scripts/dragon.rs2). No promoted plan; ' +
            'unmeasured and uncalibrated.',
        source: 'research-combat 2026-10-23',
    },
    {
        id: 'flax-gnome-spin-bank',
        name: 'Flax picked in the Gnome Stronghold, spun into bow strings at its wheel, banked there',
        family: 'pick',
        at: { level: 0, x: 2478, z: 3402 },
        params: {},
        sink: {
            mode: 'process',
            steps: [{ family: 'spinning', at: { level: 1, x: 2475, z: 3398 }, params: { obj: 'flax' } }],
            end: 'bank',
            bank: { level: 1, x: 2445, z: 3425 },
        },
        notes:
            "The Seers flax-spin method's Stronghold twin, a higher floor. Run 2026-10-24 by conductor3 as the flax " +
            'stage of plan crafting80 (Crafting 10-80): ~332k XP/h over the loop phases (68% of the floor), time split ' +
            'spin 42%, pick 33%, bank 14%, walk down to the field 11%. That plan also shears and spins wool, so it ' +
            'names no method; a flax-only plan would carry the measured entry.',
        source: 'research-artisan 2026-10-23',
    },
    {
        id: 'swordfish-catherby-cook-bank',
        name: 'Tuna and swordfish harpooned at Catherby, cooked on the Catherby range, banked at Catherby',
        family: 'fishing',
        at: { level: 0, x: 2841, z: 3430 },
        params: { spot: 'rarefish', tool: 'harpoon' },
        sink: {
            mode: 'process',
            steps: [
                {
                    family: 'cooking',
                    at: { level: 0, x: 2817, z: 3444 },
                    params: [{ food: 'raw_tuna' }, { food: 'raw_swordfish' }],
                },
            ],
            end: 'bank',
            bank: { level: 0, x: 2809, z: 3443 },
        },
        plans: ['catherby-swordfish', 'catherby-shark-fallback'],
        measured: [
            {
                xpPerHour: { fishing: 880_118 },
                level: { fishing: 91, cooking: 95 },
                bot: 'conductor3',
                date: '2026-10-23',
                hours: 0.4698,
                from: 'stats.ts conductor3 --methods --since 2026-10-23T09:20:00Z (plan catherby-shark-fallback; cooking left out: it stopped at 99 partway, so its rate counts fishing-only time)',
            },
        ],
        notes: 'Cooking 60-99 band, Fishing alongside. The plan buys a harpoon from Harry and travels in from Ardougne once; its runs include that prologue.',
        source: 'research-artisan 2026-10-23',
    },
    {
        id: 'shark-catherby-cook-bank',
        name: 'Sharks harpooned at Catherby, cooked on the Catherby range, banked at Catherby',
        family: 'fishing',
        at: { level: 0, x: 2841, z: 3430 },
        params: { spot: 'memberfish', tool: 'harpoon' },
        sink: {
            mode: 'process',
            steps: [
                {
                    family: 'cooking',
                    at: { level: 0, x: 2817, z: 3444 },
                    params: [{ food: 'raw_shark' }],
                },
            ],
            end: 'bank',
            bank: { level: 0, x: 2809, z: 3443 },
        },
        notes:
            'The Net/Harpoon spots (memberfish) at the Catherby shore, harpoon only: Fishing 76 for sharks, Cooking 80 to cook them. ' +
            'The spots move over the whole shore (fishing_movement_catherby_enum, 280 + random(250) ticks), which the floor does not model: ' +
            'it assumes a spot is always at hand. No promoted plan; unmeasured.',
        source: 'fishing-spot movement audit 2026-10-23 (conductor3 Catherby run)',
    },
    {
        id: 'swordfish-fishing-guild-cook-bank',
        name: 'Tuna and swordfish harpooned at the Fishing Guild, cooked on its range, banked in the guild',
        family: 'fishing',
        at: { level: 0, x: 2605, z: 3416 },
        params: { spot: 'rarefish', tool: 'harpoon' },
        sink: {
            mode: 'process',
            steps: [
                {
                    family: 'cooking',
                    at: { level: 0, x: 2616, z: 3396 },
                    params: [{ food: 'raw_tuna' }, { food: 'raw_swordfish' }],
                },
            ],
            end: 'bank',
            bank: { level: 0, x: 2585, z: 3420 },
        },
        notes: 'Fishing 68 to enter. The spots move over the guild shore (fishing_movement_fishing_guild_enum), which the floor does not model. No promoted plan; unmeasured.',
        source: 'fishing-spot movement audit 2026-10-23: the Fishing Guild layout against Catherby',
    },
    {
        id: 'shark-fishing-guild-cook-bank',
        name: 'Sharks harpooned at the Fishing Guild, cooked on its range, banked in the guild',
        family: 'fishing',
        at: { level: 0, x: 2605, z: 3416 },
        params: { spot: 'memberfish', tool: 'harpoon' },
        sink: {
            mode: 'process',
            steps: [
                {
                    family: 'cooking',
                    at: { level: 0, x: 2616, z: 3396 },
                    params: [{ food: 'raw_shark' }],
                },
            ],
            end: 'bank',
            bank: { level: 0, x: 2585, z: 3420 },
        },
        notes: 'Fishing 68 to enter. The spots move over the guild shore (fishing_movement_fishing_guild_enum), which the floor does not model. No promoted plan; unmeasured.',
        source: 'fishing-spot movement audit 2026-10-23: the Fishing Guild layout against Catherby',
    },

    // High-tier mining and smithing (Mining 85-99, Smithing 82-99). Superheating mithril ore takes 4 coal a cast (the bar's
    // smelting struct) and the superheat family reads the secondary ore, so it is modelled. Adamantite (6 coal a bar, 7 slots a
    // bar, smelted or superheated) is not: five bars of a platebody do not fit a 28 slot load, and the model has no whole
    // batch for it, so no adamant platebody record exists (resolveMethods fails on one).
    {
        id: 'coal-mining-guild-drop',
        name: 'Coal at the Mining Guild, dropped as mined',
        family: 'mining',
        at: { level: 0, x: 3041, z: 9739 },
        params: { rock: 'coal' },
        sink: { mode: 'drop' },
        notes: "Mining 60 to enter (ladder and door). The guild's 37 coal rocks are one site, so respawn does not bind. Assumes the best pickaxe usable and the server's player count scaling. No promoted plan; unmeasured.",
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'coal-mining-guild-bank',
        name: 'Coal at the Mining Guild, banked at Falador East',
        family: 'mining',
        at: { level: 0, x: 3041, z: 9739 },
        params: { rock: 'coal' },
        sink: { mode: 'bank' },
        notes: 'As coal-mining-guild-drop, banked at the nearest bank (Falador East, 29 run ticks each way). Banked coal supplies the mithril and adamant smelting and superheat records. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'mithril-mining-guild-drop',
        name: 'Mithril at the Mining Guild, dropped as mined',
        family: 'mining',
        at: { level: 0, x: 3041, z: 9739 },
        params: { rock: 'mithril' },
        sink: { mode: 'drop' },
        notes: 'Mining 60 to enter, 55 for the rock. Five mithril rocks with a 400 tick base respawn, so the rate is respawn-bound at high levels. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'mithril-mining-guild-bank',
        name: 'Mithril at the Mining Guild, banked at Falador East',
        family: 'mining',
        at: { level: 0, x: 3041, z: 9739 },
        params: { rock: 'mithril' },
        sink: { mode: 'bank' },
        notes: 'As mithril-mining-guild-drop, banked. Supplies the banked-ore smelting and superheat records. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'adamantite-dwarven-mine-drop',
        name: 'Adamantite at the Dwarven Mine, dropped as mined',
        family: 'mining',
        at: { level: 0, x: 3042, z: 9773 },
        params: { rock: 'adamantite' },
        sink: { mode: 'drop' },
        notes: 'The best adamantite site a walk from Lumbridge reaches with no requirement outside the Wilderness: three rocks with an 800 tick base respawn, so respawn-bound (Wilderness 3 has seven but is the Wilderness; Haunted Mine, Crandor and the Grand Tree tunnels need quests). Mining 70 for the rock. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'adamantite-dwarven-mine-bank',
        name: 'Adamantite at the Dwarven Mine, banked at Falador East',
        family: 'mining',
        at: { level: 0, x: 3042, z: 9773 },
        params: { rock: 'adamantite' },
        sink: { mode: 'bank' },
        notes: 'As adamantite-dwarven-mine-drop, banked (43 run ticks each way). Supplies the banked-ore adamant records. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'superheat-mithril-varrock-east-platebody',
        name: 'Banked mithril ore and coal superheated at Varrock East, smithed into platebodies at the south-east anvil',
        family: 'withdraw',
        at: { level: 0, x: 3253, z: 3418 },
        params: { obj: 'mithril_ore' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'superheat', at: 'here', params: { ore: 'mithril_ore' } },
                { family: 'smithing', at: { level: 0, x: 3246, z: 3404 }, params: { product: 'mithril_platebody' } },
            ],
            end: 'bank',
        },
        notes: 'Mirrors superheat-iron-varrock-east-platebody. A cast takes one ore, 4 coal and a nature rune; the coal is a supply carried by slot, so a trip holds few bars. Magic 43, Smithing 50 for the bar and 68 for the platebody. Assumes the ore and coal are banked. No promoted plan; unmeasured.',
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
    {
        id: 'smelt-mithril-falador-platebody',
        name: 'Banked mithril ore and coal smelted at the Falador furnace, smithed into platebodies at the Asgarnia anvil, banked at Falador West',
        family: 'withdraw',
        at: { level: 0, x: 2947, z: 3367 },
        params: { obj: 'mithril_ore' },
        sink: {
            mode: 'process',
            steps: [
                { family: 'smelting', at: { level: 0, x: 2975, z: 3368 }, params: { bar: 'mithril_bar' } },
                { family: 'smithing', at: { level: 0, x: 2950, z: 3452 }, params: { product: 'mithril_platebody' } },
            ],
            end: 'bank',
        },
        notes: "Smithing 50 for the bar, 68 for the platebody. The anvil (anvil:asgarnia:1) needs Doric's Quest (Doric's anvil); it is the nearest anvil to the furnace with a bank within reach; the cycle banks where it withdraws, Falador West. The coal is a supply carried by slot (4 a bar). No promoted plan; unmeasured.",
        source: 'high-tier mining and smithing 2026-10-24: Mining 85-99 and Smithing 82-99 routes rated from the world index',
    },
];
