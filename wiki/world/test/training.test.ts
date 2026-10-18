// The training pages on a synthetic world: two made-up families with round numbers, so each rate is worked by hand
// from cycle.ts (in the comments) rather than from the real game data.
import { describe, expect, test } from 'bun:test';
import { renderWorld, type RenderData } from '../render';
import { compact, percent, renderTraining, type TrainingData } from '../render/training';
import { ModelError, type Family } from '../model/family';
import type { Item } from '../model/items';
import { XP_RATE } from '../model/server';
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
    sink: { mode: 'process-bank', process: { family: 'firemaking', at: range.centre, params: {} } },
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
    processor: range.id,
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
/** The table row of `id` on a page, as cells. */
const row = (page: string, id: string): string[] =>
    pages
        .get(page)!
        .split('\n')
        .find(l => l.startsWith(`| \`${id}\``))!
        .slice(2, -2)
        .split(' | ');

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
