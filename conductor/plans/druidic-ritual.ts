// Druidic Ritual from any account: kill/loot the four raw meats, Kaqemeex (start), Sanfew (start),
// Cauldron of Thunder in Taverley Dungeon (use the four meats), Sanfew (enchanted meats), Kaqemeex (finish).
// Phases are chosen from the held items and the quest tab. Needs ~3 food (Salmon/Trout/Lobster/Tuna/Swordfish).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import talk from '@conductor/tasks/talk';

const FOOD = ['Salmon', 'Trout', 'Tuna', 'Lobster', 'Swordfish'];
const kaqemeex = { npc: 'Kaqemeex', at: { x: 2925, z: 3486, level: 0, tolerance: 4 } };
const sanfew = { npc: 'Sanfew', at: { x: 2897, z: 3426, level: 1, tolerance: 2 } };
const raws = ['Raw beef', 'Raw chicken', 'Raw rat meat', 'Raw bear meat'];
const ench = ['Enchanted beef', 'Enchanted chicken', 'Enchanted rat', 'Enchanted bear'];
const food = (v: PlanView) => FOOD.reduce((n, f) => n + v.inv(f), 0);
const allRaw = (v: PlanView) => raws.every(r => v.inv(r) > 0);
const anyRaw = (v: PlanView) => raws.some(r => v.inv(r) > 0);
// Restart-safe: no v.runs()/v.last. "Sanfew has been spoken to" is read from position: the bot is in Sanfew's
// upstairs room or underground in Taverley Dungeon (it only goes there from Sanfew with the raws).
const atSanfewOrBelow = (v: PlanView) => {
    const p = v.state.player;
    if (!p) return false;
    if (p.worldZ > 9000) return true;
    return p.level === 1 && Math.abs(p.worldX - 2897) <= 6 && Math.abs(p.worldZ - 3426) <= 6;
};
const hunt = (name: string, target: string, meat: string, area: { x: number; z: number; radius: number }) =>
    phase(
        combat,
        { target, area, food: FOOD, loot: [meat], skill: 'Strength' },
        {
            name,
            when: v => v.inv(meat) === 0 && !anyEnch(v) && food(v) >= 3 && v.quest('druid') !== 'done',
            until: v => v.inv(meat) > 0,
        },
    );
const anyEnch = (v: PlanView) => ench.some(e => v.inv(e) > 0);

export default definePlan({
    name: 'druidic-ritual',
    description:
        'Druidic Ritual: four raw meats (Lumbridge chickens, cows, giant rats; Taverley bears), Kaqemeex, Sanfew, Cauldron of Thunder, Sanfew, Kaqemeex.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(
            bank,
            { withdraw: [{ item: 'Swordfish', count: 8, upTo: true }] },
            { name: 'bank-food', when: v => v.runs('bank-food') === 0 && food(v) < 3 },
        ),
        // The animated suit at the cauldron door: fight it before anything else underground.
        phase(
            combat,
            { target: 'Suit of armour', area: { x: 2887, z: 9830, radius: 6 }, food: FOOD, skill: 'Strength' },
            {
                name: 'suit',
                when: v =>
                    (v.state.player?.worldZ ?? 0) > 9000 &&
                    (v.state.player?.combat.inCombat === true ||
                        v.state.nearbyNpcs.some(n => /suit of armour/i.test(n.name))),
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...kaqemeex },
            {
                name: 'kaqemeex-finish',
                when: v => v.quest('druid') === 'started' && !anyRaw(v) && !anyEnch(v),
            },
        ),
        phase(talk, { ...sanfew }, { name: 'sanfew-turnin', when: v => ench.every(e => v.inv(e) > 0) }),
        phase(
            talk,
            {
                at: { x: 2892, z: 9830, level: 0, tolerance: 2 },
                use: { items: raws.map(r => `^${r}$`), onLoc: 'Cauldron of Thunder' },
            },
            {
                name: 'cauldron',
                when: v => anyRaw(v) && v.quest('druid') === 'started' && atSanfewOrBelow(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            talk,
            {
                ...sanfew,
                choices: ['sent to assist|help purify|assist you|meant to be doing', 'do that then|get on with it'],
            },
            {
                name: 'sanfew-start',
                when: v => allRaw(v) && v.quest('druid') === 'started',
            },
        ),
        phase(
            talk,
            { ...kaqemeex, choices: ['search of a quest', 'Ok, I will try'] },
            { name: 'kaqemeex-start', when: v => allRaw(v) && v.quest('druid') === 'none' },
        ),
        hunt('chicken', 'Chicken', 'Raw chicken', { x: 3231, z: 3295, radius: 8 }),
        hunt('cow', 'Cow', 'Raw beef', { x: 3253, z: 3290, radius: 12 }),
        hunt('rat', 'Giant rat', 'Raw rat meat', { x: 3208, z: 3178, radius: 10 }),
        hunt('bear', 'Bear', 'Raw bear meat', { x: 2965, z: 3470, radius: 12 }),
    ],
    until: v => v.questDone('druid'),
});
