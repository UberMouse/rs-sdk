// The training pages on a synthetic world: two made-up families with round numbers, so each rate is worked by hand
// from cycle.ts (in the comments) rather than from the real game data.
import { describe, expect, test } from 'bun:test';
import { renderWorld, type RenderData } from '../render';
import { compact, percent, renderTraining, type TrainingData } from '../render/training';
import { ModelError, type Family } from '../model/family';
import type { Item } from '../model/items';
import { type Skill, XP_RATE } from '../model/server';
import { WORLD_FORMAT, type Site, type Tile, type World, type WorldMethod } from '../types';

const tile = (x: number, z: number): Tile => ({ level: 0, x, z });

const site = (id: string, areaPath: string[], x: number): Site => ({
    id,
    kind: id.slice(0, id.indexOf(':')) as Site['kind'],
    areaPath,
    centre: tile(x, 3200),
    bbox: { x1: x, z1: 3200, x2: x, z2: 3200, level: 0 },
    stand: tile(x, 3201),
    counts: {},
    features: [],
    f2p: false,
    multiway: false,
    wildernessLevel: 0,
    reach: [[]],
});

// Chopping: 4 ticks a log with the bronze axe, 2 with the rune axe (usable from Woodcutting 41 in this world), always
// a success, 10 XP (100 tenths) a log; needs Woodcutting 20 and an axe.
const woodcutting: Family = {
    id: 'woodcutting',
    skills: ['woodcutting'],
    kinds: ['tree'],
    model: (_site, _params, profile) => {
        if (profile.levels.woodcutting < 20) throw new ModelError('Woodcutting 20');
        if (!profile.axe) throw new ModelError('no axe');
        return {
            ticksPerAttempt: profile.axe === 'rune_axe' ? 2 : 4,
            success: 1,
            xpTenths: { woodcutting: 100 },
            products: [{ obj: 'logs', count: 1 }],
            consumes: [],
            tools: [profile.axe],
        };
    },
};

// Burning a log at the processor: 3 ticks, 40 XP (400 tenths), leaves ashes; needs Firemaking 30.
const firemaking: Family = {
    id: 'firemaking',
    skills: ['firemaking'],
    kinds: ['range'],
    model: (_site, _params, profile) => {
        if (profile.levels.firemaking < 30) throw new ModelError('Firemaking 30');
        return {
            ticksPerAttempt: 3,
            success: 1,
            xpTenths: { firemaking: 400 },
            products: [{ obj: 'ashes', count: 1 }],
            consumes: [{ obj: 'logs', count: 1 }],
        };
    },
};

// Shaking a tree for coins: 2 ticks, 10 XP, no tool, a stackable product (the inventory never fills).
const shaking: Family = {
    id: 'shaking',
    skills: ['thieving'],
    kinds: ['tree'],
    model: () => ({
        ticksPerAttempt: 2,
        success: 1,
        xpTenths: { thieving: 100 },
        products: [{ obj: 'coins', count: 1 }],
        consumes: [],
    }),
};

const ITEMS: Record<string, Item> = {
    coins: { stackable: true, cost: 1, wearable: false },
    logs: { stackable: false, cost: 10, wearable: false },
    ashes: { stackable: false, cost: 5, wearable: false },
    bronze_axe: { stackable: false, cost: 16, wearable: true },
    rune_axe: { stackable: false, cost: 12800, wearable: true },
};

const model: TrainingData['model'] = {
    families: new Map([
        ['woodcutting', woodcutting],
        ['firemaking', firemaking],
        ['shaking', shaking],
    ]),
    items: obj => {
        const item = ITEMS[obj];
        if (!item) throw new ModelError(`no obj ${obj}`);
        return item;
    },
    foods: new Map(),
    zones: { f2p: new Set(), multiway: new Set() },
    tools: {
        axe: [
            { obj: 'rune_axe', level: 41 },
            { obj: 'bronze_axe', level: 1 },
        ],
        pickaxe: [],
    },
};

const tree = site('tree:town:0', ['town'], 3200);
const range = site('range:town:0', ['town'], 3210);
const bank = site('bank:town-bank:0', ['town', 'town-bank'], 3220);

// Chopped and dropped; the tree is behind Agility 10.
const drop: WorldMethod = {
    id: 'tree-drop',
    name: 'Trees, dropped',
    family: 'woodcutting',
    at: tree.centre,
    params: {},
    sink: { mode: 'drop' },
    site: tree.id,
    stand: tree.stand!,
    skill: 'woodcutting',
    minLevel: 20,
    levels: { woodcutting: 20 },
    ways: [{ reach: ['skill:agility:10'], legs: [] }],
};

// Chopped, burnt at the range, banked: two skills, legs 10 + 5 + 15 run ticks.
const burn: WorldMethod = {
    id: 'tree-burn-bank',
    name: 'Trees, burnt, ashes banked',
    family: 'woodcutting',
    at: tree.centre,
    params: {},
    sink: { mode: 'process', steps: [{ family: 'firemaking', at: range.centre, params: {} }], end: 'bank' },
    plans: ['burn-plan'],
    measured: [
        {
            xpPerHour: { woodcutting: 185_000, firemaking: 700_000 },
            level: { woodcutting: 35, firemaking: 40 },
            tool: 'bronze_axe',
            bot: 'w1',
            date: '2026-10-01',
            hours: 0.5,
            from: 'stats.ts w1',
        },
    ],
    notes: 'A note.',
    site: tree.id,
    stand: tree.stand!,
    bank: bank.id,
    processors: [range.id],
    skill: 'woodcutting',
    minLevel: 30,
    levels: { woodcutting: 20, firemaking: 30 },
    ways: [
        {
            reach: [],
            legs: [
                { from: tree.id, to: range.id, runTicks: 10, requires: [] },
                { from: range.id, to: bank.id, runTicks: 5, requires: [] },
                { from: bank.id, to: tree.id, runTicks: 15, requires: [] },
            ],
        },
    ],
};

const world: World = {
    format: WORLD_FORMAT,
    generatedFrom: 'abc',
    areas: [
        { id: 'town', name: 'Town', rects: [{ x1: 3100, z1: 3100, x2: 3300, z2: 3300 }] },
        { id: 'town-bank', name: 'Town bank', parent: 'town', rects: [{ x1: 3220, z1: 3200, x2: 3220, z2: 3200 }] },
    ],
    features: [],
    sites: [bank, range, tree],
    npcSpawns: [],
    connectors: [],
    quests: [],
    loadoutRules: {},
    transports: [],
    gates: [],
    crossings: [],
    // The burn method first: the pages sort by Min, not by the file's order.
    methods: [burn, drop],
};

const data: TrainingData = {
    dbrows: [],
    npcConfigs: new Map(),
    objConfigs: new Map([
        ['bronze_axe', { name: ['Bronze axe'] }],
        ['rune_axe', { name: ['Rune axe'] }],
    ]),
    shopTitles: new Map(),
    questNames: new Map(),
    model,
};

const pages = new Map(renderTraining(world, data));
/** `n` copies of a cell. */
const times = (n: number, cell: string): string[] => Array.from({ length: n }, () => cell);
/** The method ids of a page's table rows, in order. */
const ids = (page: string) => [...pages.get(page)!.matchAll(/^\| `([a-z-]+)`/gm)].map(m => m[1]);
/** The bullet of `id` below a page's table and its sub-bullets, as lines. */
const bullets = (page: string, id: string): string[] => {
    const lines = pages.get(page)!.split('\n');
    const at = lines.indexOf(lines.find(l => l.startsWith(`- \`${id}\``))!);
    const end = lines.findIndex((l, i) => i > at && !l.startsWith('  - '));
    return lines.slice(at, end);
};
/** The table row of `id` in a page's text, as cells. */
const rowIn = (text: string, id: string): string[] =>
    text
        .split('\n')
        .find(l => l.startsWith(`| \`${id}\``))!
        .slice(2, -2)
        .split(' | ');
/** The table row of `id` on a page, as cells. */
const row = (page: string, id: string): string[] => rowIn(pages.get(page)!, id);

describe('the training pages', () => {
    test('a page per skill a method trains, and the README', () =>
        expect([...pages.keys()].sort()).toEqual([
            'wiki/training/README.md',
            'wiki/training/firemaking.md',
            'wiki/training/woodcutting.md',
        ]));

    test('are deterministic, and renderWorld renders them with the rest', () => {
        expect(new Map(renderTraining(world, data))).toEqual(pages);
        const all = renderWorld(world, { ...data, readmeBody: '' } satisfies RenderData);
        for (const [path, text] of pages) expect(all.get(path)).toBe(text);
    });

    test('rows sort by Min, then id', () => {
        expect(ids('wiki/training/woodcutting.md')).toEqual(['tree-drop', 'tree-burn-bank']);
        expect(ids('wiki/training/firemaking.md')).toEqual(['tree-burn-bank']);
    });

    test('a drop method: its reach, level and tool, the floor by level with the best axe usable there', () => {
        // Drop sink, 28 free slots (the axe is wielded), one log a success: a trip is 28 logs, then
        // dropTicks(28) = ceil((28 + 2) / 5) = 6 ticks. Bronze (under 41): 28 x 4 + 6 = 118 ticks, 28 x 9000 / 118 =
        // 2135.6 logs/h, x 10 XP x 25 = 533,898 (534k). Rune (41 up): 28 x 2 + 6 = 62 ticks, 4064.5 logs/h, 1,016,129
        // (1.02M). Logs dropped: 0 gp. Gather 56 ticks against 6 dropping: player.
        expect(row('wiki/training/woodcutting.md', 'tree-drop')).toEqual([
            '`tree-drop`',
            '[Town](../places/town.md) `tree:town:0`',
            '534k at 20',
            '-',
            ...times(3, '534k'),
            ...times(6, '1.02M'),
            '0',
            'player',
            '-',
        ]);
        expect(bullets('wiki/training/woodcutting.md', 'tree-drop')).toEqual([
            '- `tree-drop`: Trees, dropped.',
            '  - **Requires**: Reach: 10 Agility. Levels: Woodcutting 20. Tools: best axe (wielded).',
            '  - **Sink**: drop.',
            '  - **Supplies/hr** at 99: none.',
        ]);
    });

    test("a two-skill method on its gather skill's page: the other skill clamped to its own level", () => {
        // 28 logs a trip, each burnt (3 ticks), legs 10 + 5 + 15 = 30, banking 0. Bronze: 28 x 4 + 84 + 30 = 226
        // ticks, 28 x 9000 / 226 = 1115.04 logs/h: Woodcutting 1115.04 x 10 x 25 = 278,761 (279k), Firemaking x 40 x
        // 25 = 1,115,044 (1.12M). Rune: 56 + 84 + 30 = 170 ticks, 1482.35/h: 370,588 (371k) and 1,482,353 (1.48M);
        // ashes 1482.35 x 5 gp = 7,412 (7.41k). Column 20: Woodcutting 20, Firemaking raised to its 30, so it models.
        // Measured at Woodcutting 35 with the bronze axe: 185,000 / 278,761 = 66%.
        expect(row('wiki/training/woodcutting.md', 'tree-burn-bank')).toEqual([
            '`tree-burn-bank`',
            '[Town](../places/town.md) `tree:town:0`',
            '279k at 30',
            '-',
            ...times(3, '279k'),
            ...times(6, '371k'),
            '7.41k',
            'player',
            '185k at 35 (66%)',
        ]);
        expect(bullets('wiki/training/woodcutting.md', 'tree-burn-bank')).toEqual([
            '- `tree-burn-bank`: Trees, burnt, ashes banked. Plans: burn-plan. A note.',
            '  - **Requires**: Reach: none. Levels: Woodcutting 20, Firemaking 30, each with the other skills at 99; ' +
                'every skill at once: 30. Tools: best axe (wielded).',
            '  - **Sink**: firemaking at [Town](../places/town.md) `range:town:0`, then bank at [Town bank (Town)](../places/town-bank.md) `bank:town-bank:0`; legs 10 + 5 + 15 run ticks.',
            '  - **Supplies/hr** at 99: none.',
            '  - **Measured**: 185k at 35 by w1 on 2026-10-01, with the Bronze axe.',
        ]);
    });

    test('a leg over random landings, run at their mean, to one decimal', () => {
        const [first, ...rest] = burn.ways[0]!.legs;
        const mean: WorldMethod = {
            ...burn,
            ways: [{ reach: [], legs: [{ ...first!, runTicks: 53.92307692307692 }, ...rest] }],
        };
        const page = new Map(renderTraining({ ...world, methods: [mean] }, data)).get('wiki/training/woodcutting.md')!;
        expect(page).toContain('; legs 53.9 + 5 + 15 run ticks.');
    });

    test("the same method on its process skill's page: that skill's XP, `-` under its own level", () => {
        // Firemaking from the rates above: 1.12M with Woodcutting under 41 (columns 30 and 40), 1.48M from 50. Measured
        // 700,000 / 1,115,044 = 63%.
        expect(row('wiki/training/firemaking.md', 'tree-burn-bank').slice(2)).toEqual([
            '1.12M at 30',
            '-',
            '-',
            '1.12M',
            '1.12M',
            ...times(6, '1.48M'),
            '7.41k',
            'player',
            '700k at 40 (63%)',
        ]);
    });

    test('the header with the units, the Min note naming only the tool tiers the page uses, and the table', () => {
        const page = pages.get('wiki/training/woodcutting.md')!;
        expect(page).toContain('2 methods train Woodcutting');
        expect(page).toContain(`XP/hr is game XP, the server's XP rate (x${XP_RATE}) included; gp/hr is the products`);
        expect(page).toContain('item value (obj `cost`); Supplies/hr is how many of each supply an hour uses');
        expect(page).toContain("whichever is higher, with the best axe usable there, and `-` under the method's");
        expect(page).toContain(
            '| Method | Where | Min | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 99 | gp/hr | Binding | Measured |',
        );
        // Firemaking's page has the same chopping method, so the axe: a page with no tiered tool says none.
        expect(pages.get('wiki/training/firemaking.md')).toContain('with the best axe usable there');
        const shake: WorldMethod = { ...drop, id: 'tree-shake', family: 'shaking', skill: 'thieving' };
        const toolless = new Map(
            renderTraining({ ...world, methods: [{ ...shake, minLevel: 1, levels: { thieving: 1 } }] }, data),
        ).get('wiki/training/thieving.md')!;
        expect(toolless).toContain('whichever is higher, and `-` under');
        expect(toolless).toContain('Tools: none.');
        expect(pages.get('wiki/training/firemaking.md')).toContain('1 method trains Firemaking');
    });

    test('the README: the pages by skill, what the floor is, how to add a method', () => {
        const readme = pages.get('wiki/training/README.md')!;
        expect(readme).toContain('2 methods in [wiki/world/methods.ts](../world/methods.ts)');
        expect(readme).toContain(
            '| Skill | Methods |\n|---|---|\n| [Firemaking](firemaking.md) | 1 |\n| [Woodcutting](woodcutting.md) | 2 |',
        );
        expect(readme).toContain('The floor is the tick-perfect rate');
        expect(readme).toContain('It is not a forecast');
        expect(readme).toContain('## Adding a method');
    });

    test('a method naming a site world.json has not, or a stand that moved, throws naming it', () => {
        expect(() => renderTraining({ ...world, methods: [{ ...drop, site: 'tree:town:9' }] }, data)).toThrow(
            /^methods\.ts tree-drop: world\.json names no method site tree:town:9; world\.json is stale or hand-edited: run `bun run world`$/,
        );
        expect(() => renderTraining({ ...world, methods: [{ ...drop, stand: tile(1, 1) }] }, data)).toThrow(
            /^methods\.ts tree-drop: site tree:town:0's stand is not the method's/,
        );
        expect(() => renderTraining({ ...world, methods: [{ ...burn, bank: undefined }] }, data)).toThrow(
            /^methods\.ts tree-burn-bank: world\.json names no bank site/,
        );
    });

    test('a level column a family refuses (never rated by the build) throws naming the method', () => {
        // world.json claiming Woodcutting 10 where the family needs 20: the column at 10 is the first to throw.
        expect(() =>
            renderTraining({ ...world, methods: [{ ...drop, minLevel: 10, levels: { woodcutting: 10 } }] }, data),
        ).toThrow(/^methods\.ts tree-drop: Woodcutting 20$/);
    });

    test('no methods: the README alone', () => {
        const only = renderTraining({ ...world, methods: [] }, data);
        expect(only.map(([p]) => p)).toEqual(['wiki/training/README.md']);
        expect(only[0]![1]).toContain('0 methods in');
    });
});

describe('a kill method (a gather on an attack rate)', () => {
    // Fighting a rat: two swings of 4 ticks a kill (ticksPerAttempt 8, attackRate 4), 1 HP taken a kill. Accurate
    // gives 40 XP (400 tenths) to Attack, aggressive to Strength, defensive to Defence, each 13.3 (133) to Hitpoints.
    // Controlled gives 50 (500) to each of the three and 20 (200) to Hitpoints: more of every skill than any other
    // style, so only the fewest-skills rule (styleParams) keeps it off the Attack, Strength and Defence pages. A
    // `bones` param drops one bones a kill.
    const STYLE_XP: Record<string, Record<string, number>> = {
        accurate: { attack: 400, hitpoints: 133 },
        aggressive: { strength: 400, hitpoints: 133 },
        defensive: { defence: 400, hitpoints: 133 },
        controlled: { attack: 500, strength: 500, defence: 500, hitpoints: 200 },
    };
    const fighting: Family = {
        id: 'fighting',
        skills: ['attack', 'strength', 'defence', 'hitpoints'],
        kinds: ['npc'],
        styles: params => ({
            styles: Object.entries(STYLE_XP).map(([style, xp]) => ({
                params: { ...(params as object), style },
                skills: Object.keys(xp) as Skill[],
            })),
            quests: [],
        }),
        model: (_site, params) => ({
            ticksPerAttempt: 8,
            attackRate: 4,
            success: 1,
            xpTenths: STYLE_XP[(params as { style: string }).style]!,
            products: (params as { bones?: boolean }).bones ? [{ obj: 'bones', count: 1 }] : [],
            consumes: [],
            damage: 1,
        }),
    };
    const rats = site('npc:town:0', ['town'], 3230);
    const kill: WorldMethod = {
        id: 'rat-fight',
        name: 'Rats',
        family: 'fighting',
        at: rats.centre,
        params: { npc: 'rat' },
        sink: { mode: 'drop' },
        site: rats.id,
        stand: rats.stand!,
        skill: 'attack',
        minLevel: 1,
        levels: { attack: 1, strength: 1, defence: 1, hitpoints: 1 },
        ways: [{ reach: [], legs: [] }],
        npcs: { maxHit: 2, hunters: [{ npc: 'rat', upTo: 10 }], retreat: 1 },
    };
    // Banked for trout (here a meat, so consume.rs2's normal-food trigger eats it, healing 3 HP) over legs of 10 and
    // 10 run ticks.
    const fed: WorldMethod = {
        ...kill,
        id: 'rat-fight-fed',
        food: 'trout',
        sink: { mode: 'bank' },
        bank: bank.id,
        ways: [
            {
                reach: [],
                legs: [
                    { from: rats.id, to: bank.id, runTicks: 10, requires: [] },
                    { from: bank.id, to: rats.id, runTicks: 10, requires: [] },
                ],
            },
        ],
    };
    const killData = (calibrated: string[]): TrainingData => ({
        ...data,
        npcConfigs: new Map([['rat', { name: ['Rat'] }]]),
        objConfigs: new Map([...data.objConfigs, ['trout', { name: ['Trout'] }]]),
        model: {
            ...model,
            families: new Map([...model.families, ['fighting', fighting]]),
            items: obj =>
                obj === 'trout'
                    ? { stackable: false, cost: 5, wearable: false, category: 'meat' }
                    : obj === 'bones'
                      ? { stackable: false, cost: 1, wearable: false }
                      : model.items(obj),
            foods: new Map([['trout', 3]]),
            // Bones' bone_exp: 4.5 Prayer XP.
            boneXp: obj => (obj === 'bones' ? 45 : 0),
            calibrated: new Set(calibrated),
        },
    });
    const render = (methods: WorldMethod[], calibrated: string[] = []) =>
        new Map(renderTraining({ ...world, sites: [...world.sites, rats], methods }, killData(calibrated)));
    test('uncalibrated: kills/hr, each page on its own style, the hazard, Food/hr uncalibrated and the † row', () => {
        // The gate shut: no food, no drops, so the inventory never fills and a trip is one kill of 8 ticks:
        // 9000 / 8 = 1125 kills/h (1.13k). Attack (accurate) 1125 x 40 x 25 = 1,125,000 (1.13M) at every level;
        // Strength's page swings aggressive for the same.
        const rendered = render([kill]);
        const attack = rendered.get('wiki/training/attack.md')!;
        expect(attack).toContain('| 90 | 99 | kills/hr | gp/hr | Binding | Measured |');
        expect(attack).toContain('kills/hr, gp/hr, the binding term and Supplies/hr are at 99. A kill swings');
        expect(attack).toContain(
            'A † marks a kill whose damage no worker run has calibrated: its XP/hr and gp/hr leave out food trips. ',
        );
        expect(rowIn(attack, 'rat-fight')).toEqual([
            '`rat-fight` †',
            '[Town](../places/town.md) `npc:town:0`',
            '1.13M at 1',
            ...times(10, '1.13M'),
            '1.13k',
            '0',
            'player',
            '-',
        ]);
        expect(rowIn(rendered.get('wiki/training/strength.md')!, 'rat-fight')[2]).toBe('1.13M at 1');
        const page = attack.split('\n');
        expect(page.filter(l => l.startsWith('  - **Hazard**') || l.startsWith('  - **Supplies'))).toEqual([
            '  - **Hazard**: Rat hunts players of combat 10 and below; the npcs there hit for at most 2; single-way. ' +
                'The target retreats at 1 HP and stops hitting back; the floor prices the kill as if it fought on.',
            '  - **Supplies/hr** at 99: none; Food/hr uncalibrated: no worker run has checked the damage these kills ' +
                'take (wiki/world/methods.ts CALIBRATIONS), so the XP/hr leaves out food trips.',
        ]);
        // A kill that takes no damage has nothing to gate.
        const harmless: Family = { ...fighting, model: (...a) => ({ ...fighting.model(...a), damage: undefined }) };
        const safe = new Map(
            renderTraining(
                { ...world, sites: [...world.sites, rats], methods: [kill] },
                { ...killData([]), model: { ...killData([]).model, families: new Map([['fighting', harmless]]) } },
            ),
        ).get('wiki/training/attack.md')!;
        expect(safe).toContain('  - **Supplies/hr** at 99: none.\n');
        expect(rowIn(safe, 'rat-fight')[0]).toBe('`rat-fight`');
        expect(safe).not.toContain('†');
        // A page with no kill has no kills/hr column.
        expect(rendered.get('wiki/training/woodcutting.md')).toBeUndefined();
        expect(new Map(renderTraining(world, data)).get('wiki/training/woodcutting.md')).not.toContain('kills/hr');
    });

    test("each page's style: the one training fewest skills with it, every style for Hitpoints and Prayer", () => {
        // 1125 kills/h (as above). Attack swings accurate, Strength aggressive, Defence defensive, not controlled's
        // 50 XP: 1125 x 40 x 25 = 1,125,000 (1.13M), where controlled would make 1125 x 50 x 25 = 1,406,250 (1.41M).
        const rendered = render([kill]);
        for (const page of ['attack', 'strength', 'defence'])
            expect(rowIn(rendered.get(`wiki/training/${page}.md`)!, 'rat-fight')[2]).toBe('1.13M at 1');
        // Every style trains Hitpoints, so its page takes the best of all four by Hitpoints XP/hr: controlled's 20,
        // 1125 x 20 x 25 = 562,500 (563k), over the others' 1125 x 13.3 x 25 = 374,062.5 (374k).
        expect(rowIn(rendered.get('wiki/training/hitpoints.md')!, 'rat-fight')[2]).toBe('563k at 1');
    });

    test('a kill that buries its bones is on the Prayer page at the bones XP rate', () => {
        // One bones a kill, buried in place: BURY_SWING_GAP 1 + p_delay(0) + 2 = 3 ticks is under the attack rate of
        // 4, so the bury costs no tick and a kill stays 8 ticks: 1125 kills/h. Prayer 1125 x 4.5 x 25 = 126,562.5
        // (127k); no style trains Prayer, so every style is rated and they tie.
        const bury: WorldMethod = {
            ...kill,
            id: 'rat-bury',
            params: { npc: 'rat', bones: true },
            loot: { bones: 'bury' },
            levels: { ...kill.levels, prayer: 1 },
        };
        const prayer = render([bury]).get('wiki/training/prayer.md')!;
        const cells = rowIn(prayer, 'rat-bury');
        expect(cells[2]).toBe('127k at 1');
        expect(cells.slice(-4)).toEqual(['1.13k', '0', 'player', '-']);
    });

    test('the hazard: a Wilderness hunter hunts every level; an npc that cannot hit has no max hit or retreat', () => {
        const hazardOf = (m: WorldMethod, at: Site = rats): string | undefined =>
            new Map(renderTraining({ ...world, sites: [...world.sites, at], methods: [m] }, killData([])))
                .get('wiki/training/attack.md')!
                .split('\n')
                .find(l => l.startsWith('  - **Hazard**'));
        // methodHazard has a hunter aggressive at every combat level in the Wilderness, whatever its upTo.
        const wild = { ...rats, wildernessLevel: 12 };
        expect(hazardOf(kill, wild)).toBe(
            '  - **Hazard**: Rat hunts players of every combat level (Wilderness); the npcs there hit for at most 2; ' +
                'single-way, Wilderness level 12. The target retreats at 1 HP and stops hitting back; the floor ' +
                'prices the kill as if it fought on.',
        );
        // Max hit 0 (a chicken): no hit to state, and its retreat spares the player nothing.
        const harmless = { ...kill, npcs: { maxHit: 0, hunters: [], retreat: 1 } };
        expect(hazardOf(harmless)).toBe('  - **Hazard**: no npc there hunts players; single-way.');
    });

    test('calibrated: the food eaten and its trips are in the floor, and Food/hr is in the supplies', () => {
        // 28 free slots of trout (3 HP each) at 1 HP a kill: 84 kills a trip. Gather 84 x 8 = 672 ticks, 28 eats of
        // EAT_DELAY 3 past the kill's 0 free ticks = 84, legs 20: 776 ticks. 9000 x 84 / 776 = 974.23 kills/h (974);
        // Attack 974.23 x 40 x 25 = 974,227 (974k); trout 974.23 / 3 = 324.7 (325), x 5 gp = 1,624 (1.62k).
        const attack = render([fed], ['rat']).get('wiki/training/attack.md')!;
        const cells = rowIn(attack, 'rat-fight-fed');
        expect(cells.slice(2, 3)).toEqual(['974k at 1']);
        expect(cells.slice(-4)).toEqual(['974', '0', 'player', '-']);
        expect(attack).toContain(
            '  - **Supplies/hr** at 99: 325 Trout; 1.62k gp; eat ticks charged as if eaten between kills (a floor).\n',
        );
        expect(cells[0]).toBe('`rat-fight-fed`');
        expect(attack).not.toContain('†');
    });
});

describe('number formats', () => {
    test('compact keeps three significant figures with k and M, dropping trailing zeros', () => {
        expect([1_080_000, 1_016_129, 999_999, 659_300, 2_000_000, 7411.8, 984, 85.43, 0].map(compact)).toEqual([
            '1.08M',
            '1.02M',
            '1M',
            '659k',
            '2M',
            '7.41k',
            '984',
            '85.4',
            '0',
        ]);
    });

    test('percent is a whole percent', () => {
        expect(percent(185_000, 278_761)).toBe('66%');
        expect(percent(1, 2)).toBe('50%');
        // A floor of 0 (the model gives the skill no XP) has no ratio.
        expect(percent(1, 0)).toBe('-');
        expect(percent(0, 0)).toBe('-');
    });
});
