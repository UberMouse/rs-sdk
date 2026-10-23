// Cook's Assistant (server/content/scripts/quests/quest_cook, general_use/scripts/windmills.rs2, npc/scripts/cow_milking.rs2):
// Cook (start) -> egg (farm ground spawn), empty bucket and pot (General Store) ->
// milk the bucket on a cow -> grain from the wheat field, into the Lumbridge mill hopper (level 2), Hopper controls,
// take the flour with the pot from the Flour bin (level 0) -> Cook (hand in).
// Phases are chosen from held items, the quest tab and where the bot stands; the mill steps that fail when their
// stage is not reached (empty hopper, empty bin) use onFail 'continue' so the neighbouring step gets the turn.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import pick from '@conductor/tasks/pick';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';

const ID = 'cook';
const cook = { npc: 'Cook', at: { x: 3209, z: 3215, level: 0, tolerance: 3 } };
const MILL = { x: 3166, z: 3306 };

const near = (v: PlanView, c: { x: number; z: number }, r: number, level?: number) => {
    const p = v.state.player;
    return (
        !!p &&
        (level === undefined || p.level === level) &&
        Math.max(Math.abs(p.worldX - c.x), Math.abs(p.worldZ - c.z)) <= r
    );
};
const level = (v: PlanView) => v.state.player?.level ?? 0;
const potEmpty = (v: PlanView) => v.inv('Pot') > 0 && v.inv('Pot of flour') === 0;
const needsShop = (v: PlanView) =>
    (v.inv('Pot') === 0 && v.inv('Pot of flour') === 0) || (v.inv('Bucket') === 0 && v.inv('Bucket of milk') === 0);
const R = { onFail: 'continue', maxFails: 8 } as const;

export default definePlan({
    name: 'cooks-assistant',
    description:
        "Cook's Assistant: Cook, egg + bucket + pot (ground spawns), milk the bucket on a cow, grain into the Lumbridge mill and flour into the pot, hand in.",
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(
            talk,
            { ...cook },
            {
                name: 'hand-in',
                when: v =>
                    v.quest(ID) === 'started' &&
                    v.inv('Egg') > 0 &&
                    v.inv('Bucket of milk') > 0 &&
                    v.inv('Pot of flour') > 0,
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Hopper$',
                use: { item: '^Grain$' },
                at: { x: 3166, z: 3306, level: 2, tolerance: 3 },
            },
            { name: 'grain-in-hopper', when: v => v.inv('Grain') > 0, ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Hopper controls$',
                option: '^Operate$',
                expect: 'slides down the chute',
                at: { x: 3166, z: 3306, level: 2, tolerance: 3 },
            },
            { name: 'operate', when: v => potEmpty(v) && level(v) === 2, ...R },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Flour bin$',
                use: { item: '^Pot$' },
                at: { x: 3166, z: 3309, level: 0, tolerance: 2 },
            },
            {
                name: 'take-flour',
                when: v => potEmpty(v) && v.inv('Grain') === 0 && (level(v) === 2 || near(v, MILL, 5, 0)),
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^cow$',
                use: { item: '^bucket$' },
                expect: 'you milk the cow',
                at: { x: 3253, z: 3270, tolerance: 3 },
            },
            { name: 'milk', when: v => v.inv('Bucket') > 0 && v.inv('Bucket of milk') === 0, ...R },
        ),
        phase(
            pick,
            { loc: 'Wheat', item: 'Grain', count: 1, area: { x: 3158, z: 3298, radius: 8 } },
            { name: 'grain', when: v => potEmpty(v) && v.inv('Grain') === 0, ...R },
        ),
        phase(
            talk,
            { ...cook, choices: ["What's wrong", "Yes, I'll help you"] },
            { name: 'cook-start', when: v => v.quest(ID) === 'none' },
        ),
        // The pot and the bucket lie on blocked tiles (kitchen counter, farm), which pickup skips as unreachable:
        // buy them at the Lumbridge General Store, selling a few Salmon first when the bot has no coins.
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3212, z: 3247 }, sell: [{ item: 'Salmon', count: 3 }] },
            { name: 'sell-salmon', when: v => needsShop(v) && v.inv('Coins') < 10, ...R },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3212, z: 3247 }, buy: [{ item: 'Pot', count: 1 }] },
            {
                name: 'buy-pot',
                when: v => v.inv('Pot') === 0 && v.inv('Pot of flour') === 0 && v.inv('Coins') >= 10,
                ...R,
            },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3212, z: 3247 }, buy: [{ item: 'Bucket', count: 1 }] },
            {
                name: 'buy-bucket',
                when: v => v.inv('Bucket') === 0 && v.inv('Bucket of milk') === 0 && v.inv('Coins') >= 10,
                ...R,
            },
        ),
        phase(
            pickup,
            { area: { x: 3227, z: 3298, radius: 6 }, items: [{ item: 'Egg', count: 1 }] },
            { name: 'egg', when: v => v.inv('Egg') === 0, ...R },
        ),
    ],
    until: v => v.questDone(ID),
});
