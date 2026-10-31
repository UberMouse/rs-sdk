// Pirate's Treasure (quest id hunt; server/content/scripts/quests/quest_hunt). Redbeard Frank (Port Sarim pub) wants Karamjan rum.
// Wydin hires you only while wearing a white apron (job needs hunt = 1), so: Frank, apron on, Wydin's job, boat to Karamja.
// On Karamja: Luthas (employment), rum from the Karamja Wines shop, rum into the plantation crate, 10 bananas on it, Luthas pays
// (crate_rum -> 2: the rum rides to Wydin's back room, no customs search since the pack is empty of rum). Boat back, open
// Wydin's back door (apron worn), search the back crate for the rum, rum to Frank for the chest key, Blue Moon Inn chest upstairs
// (3218,3396 level 1) gives the message, Read it, Dig at (2999,3383) in Falador park.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';

const ID = 'hunt';
const started = (v: PlanView) => v.quest(ID) === 'started';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const mainland = (v: PlanView) => px(v) > 3000 && lvl(v) === 0;
const karamja = (v: PlanView) => px(v) < 2990 && lvl(v) === 0;
const rum = (v: PlanView) => v.inv('Karamjan rum');
const R = { onFail: 'continue', maxFails: 6 } as const;
const GANGPLANK = (x: number, z: number) =>
    ({ target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { x, z, level: 1 } }) as const;

// Banana trees at the Karamja plantation (2x2 locs, five bananas each, then empty for a while).
const TREES = [
    [2912, 3161],
    [2909, 3161],
    [2912, 3158],
    [2909, 3158],
    [2909, 3164],
    [2912, 3164],
] as const;
const treePhase = (x: number, z: number) =>
    phase(
        interact,
        {
            target: 'loc',
            name: '^Banana Tree$',
            option: 'Search',
            tile: { x, z },
            at: { x: 2911, z: 3162, tolerance: 6 },
        },
        {
            name: `bananas-${x}-${z}`,
            when: v =>
                karamja(v) &&
                v.runs('crate-rum') > 0 &&
                v.runs('crate-banana') === 0 &&
                v.inv('Banana') < 10 &&
                v.runs(`bananas-${x}-${z}`) < 5,
            onFail: 'continue',
            maxFails: 12,
        },
    );

const hasMsg = (v: PlanView) => v.inv('Pirate message') > 0;
const gardenerNear = (v: PlanView) =>
    (v.state.nearbyNpcs ?? []).some(
        n => /^Gardener$/.test(n.name) && Math.max(Math.abs(n.x - 2999), Math.abs(n.z - 3383)) <= 10,
    );

export default definePlan({
    name: 'pirates-treasure',
    description:
        "Pirate's Treasure: Frank, apron + Wydin's job, boat to Karamja, rum and bananas in Luthas's crate, back to Wydin's crate, key, Blue Moon chest, dig in Falador park.",
    requires: QUEST_TAB_REQUIRED,
    until: v => v.questDone(ID),
    phases: [
        ...['', '-b'].flatMap(sfx => [
            phase(
                combat,
                {
                    target: '^Gardener$',
                    skill: 'Strength',
                    allowMaxed: true,
                    food: ['Swordfish'],
                    area: { x: 2999, z: 3383, radius: 10 },
                    maxLevelGap: 10,
                },
                {
                    name: `gardener${sfx}`,
                    when: v => hasMsg(v) && v.runs('read') > 0 && gardenerNear(v),
                    until: v => !gardenerNear(v),
                    onFail: 'continue',
                    maxFails: 6,
                },
            ),
            phase(
                interact,
                { target: 'item', name: '^Spade$', option: 'Dig', at: { x: 2999, z: 3383, level: 0, tolerance: 1 } },
                {
                    name: `dig${sfx}`,
                    when: v => hasMsg(v) && v.runs('read') > 0 && !gardenerNear(v),
                    onFail: 'continue',
                    maxFails: 6,
                },
            ),
        ]),
        phase(
            interact,
            { target: 'item', name: '^Pirate message$', option: 'Read' },
            { name: 'read', when: v => v.inv('Pirate message') > 0 && v.runs('read') === 0, ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                use: { item: '^Chest key$' },
                unreachable: true,
                at: { x: 3219, z: 3396, level: 1, tolerance: 0 },
            },
            { name: 'chest', when: v => v.inv('Chest key') > 0, ...R },
        ),
        phase(
            talk,
            { npc: 'Redbeard Frank', at: { x: 3053, z: 3250, tolerance: 3 }, choices: ['Ok thanks'] },
            { name: 'frank-rum', when: v => started(v) && rum(v) > 0 && mainland(v), ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: 'Search',
                tile: { x: 3009, z: 3207 },
                at: { x: 3010, z: 3206, tolerance: 2 },
                choices: ['^No'],
            },
            {
                name: 'take-rum',
                when: v => started(v) && mainland(v) && v.runs('crate-rum') > 0 && v.runs('door') > 0 && rum(v) === 0,
                until: v => rum(v) > 0,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: 'Open', tile: { x: 3012, z: 3204 } },
            { name: 'door', when: v => started(v) && mainland(v) && v.runs('pay') > 0 && v.runs('door') === 0, ...R },
        ),
        // Boat back from Karamja.
        phase(interact, GANGPLANK(3031, 3217), {
            name: 'cross-back',
            when: v => lvl(v) === 1 && px(v) > 3000 && (v.state.player?.worldZ ?? 0) < 3300,
            ...R,
        }),
        phase(
            talk,
            {
                npc: 'Customs officer',
                at: { x: 2956, z: 3146, tolerance: 8 },
                choices: ['Can I journey', 'Search away', '^Ok'],
                travels: true,
            },
            { name: 'sail-back', when: v => started(v) && karamja(v) && v.runs('pay') > 0, ...R },
        ),
        phase(
            talk,
            { npc: '^Luthas$', at: { x: 2939, z: 3154, tolerance: 3 }, choices: ['Thank you'] },
            {
                name: 'pay',
                when: v => karamja(v) && v.runs('crate-banana') > 0 && v.inv('Banana') === 0 && v.runs('pay') === 0,
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                use: { item: '^Banana$' },
                at: { x: 2943, z: 3152, tolerance: 2 },
            },
            {
                name: 'crate-banana',
                when: v =>
                    karamja(v) &&
                    v.inv('Banana') > 0 &&
                    v.runs('crate-rum') > 0 &&
                    (v.inv('Banana') >= 10 || v.runs('crate-banana') > 0),
                ...R,
                maxFails: 12,
            },
        ),
        ...TREES.map(([x, z]) => treePhase(x, z)),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                use: { item: '^Karamjan rum$' },
                at: { x: 2943, z: 3152, tolerance: 2 },
            },
            { name: 'crate-rum', when: v => karamja(v) && rum(v) > 0 && v.runs('luthas') > 0, ...R },
        ),
        phase(
            shop,
            { npc: 'Zambo', at: { x: 2925, z: 3143 }, buy: [{ item: 'Karamjan rum', count: 1 }] },
            {
                name: 'buy-rum',
                when: v => karamja(v) && v.runs('luthas') > 0 && rum(v) === 0 && v.runs('crate-rum') === 0,
                ...R,
            },
        ),
        phase(
            talk,
            {
                npc: '^Luthas$',
                at: { x: 2939, z: 3154, tolerance: 3 },
                choices: ['Could you offer me employment'],
            },
            { name: 'luthas', when: v => started(v) && karamja(v) && v.runs('luthas') === 0, ...R },
        ),
        // Deck of Karamja after the first sailing.
        phase(interact, GANGPLANK(2956, 3144), {
            name: 'cross-out',
            when: v => lvl(v) === 1 && px(v) < 2990,
            ...R,
        }),
        phase(
            talk,
            {
                npc: 'Captain Tobias',
                at: { x: 3028, z: 3216, tolerance: 3 },
                choices: ['Yes please'],
                travels: true,
            },
            {
                name: 'sail-out',
                when: v => started(v) && mainland(v) && v.runs('job') > 0 && v.runs('luthas') === 0,
                ...R,
            },
        ),
        phase(
            talk,
            { npc: 'Wydin', at: { x: 3014, z: 3204, tolerance: 3 }, choices: ['job'] },
            { name: 'job', when: v => started(v) && mainland(v) && v.runs('apron') > 0 && v.runs('job') === 0, ...R },
        ),
        phase(
            items,
            { equip: ['White apron'] },
            { name: 'apron', when: v => started(v) && v.inv('White apron') > 0, ...R },
        ),
        phase(
            talk,
            {
                npc: 'Redbeard Frank',
                at: { x: 3053, z: 3250, tolerance: 3 },
                choices: ['in search of treasure'],
            },
            { name: 'frank-start', when: v => v.quest(ID) === 'none', ...R },
        ),
    ],
});
